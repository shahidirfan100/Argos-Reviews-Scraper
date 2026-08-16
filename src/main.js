import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { Impit } from 'impit';

const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_SORT = 'SubmissionTime:Desc';
const MAX_PRODUCTS = 50;
const FETCH_TIMEOUT_MS = 15_000;
const API_MAX_RETRIES = 3;
const API_RETRY_BASE_DELAY_MS = 500;
const MAX_PROXY_ROTATIONS = 2;
const API_BASE_URL = 'https://www.argos.co.uk';
const API_FALLBACK_BASE_URLS = ['https://m.argos.co.uk'];

class HttpStatusError extends Error {
    constructor(status, endpointHost) {
        super(`Argos endpoint returned HTTP ${status}`);
        this.name = 'HttpStatusError';
        this.status = status;
        this.endpointHost = endpointHost;
    }
}

export class NetworkEgressBlockedError extends Error {
    constructor(hosts, proxyConfigured) {
        super('Argos rejected every verified endpoint from the configured network egress');
        this.name = 'NetworkEgressBlockedError';
        this.hosts = hosts;
        this.proxyConfigured = proxyConfigured;
    }
}

function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unique(values) {
    return [...new Set(values)];
}

function parseProductUrlsInput(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .flatMap((item) => {
                if (!item) return [];
                if (typeof item === 'string') return [item];
                if (typeof item === 'object') {
                    if (typeof item.url === 'string') return [item.url];
                    if (typeof item.id === 'string' || typeof item.id === 'number') return [String(item.id)];
                    if (typeof item.productId === 'string' || typeof item.productId === 'number') {
                        return [String(item.productId)];
                    }
                }
                return [];
            })
            .map((item) => item.trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(/[\r\n,;]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
}

export function collectInputProducts(input) {
    return unique(
        [
            ...parseProductUrlsInput(input.products),
            ...parseProductUrlsInput(input.productUrls),
            ...parseProductUrlsInput(input.productIds),
            ...parseProductUrlsInput(input.startUrls),
            ...parseProductUrlsInput(input.urls),
            ...parseProductUrlsInput(input.productId),
            ...parseProductUrlsInput(input.productUrl),
            ...parseProductUrlsInput(input.startUrl),
            ...parseProductUrlsInput(input.url),
        ].filter(Boolean),
    );
}

export function extractPartNumber(inputValue) {
    const candidate = String(inputValue || '').trim();
    if (!candidate) return null;

    if (/^\d{7,8}$/.test(candidate)) return candidate;

    try {
        const parsedUrl = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`);
        const combinedUrlParts = decodeURIComponent(
            [parsedUrl.hostname, parsedUrl.pathname, parsedUrl.search, parsedUrl.hash].join(' '),
        );

        const productPathMatch = combinedUrlParts.match(/\/product\/(\d{7,8})(?:[/?#]|$)/i);
        if (productPathMatch) return productPathMatch[1];

        const queryParamMatch = combinedUrlParts.match(
            /(?:product(?:id)?|part(?:number)?|sku|item(?:id)?|prd)[=/:-]+(\d{7,8})(?:[^\d]|$)/i,
        );
        if (queryParamMatch) return queryParamMatch[1];

        const urlDigitMatch = combinedUrlParts.match(/(^|[^\d])(\d{7,8})(?:[^\d]|$)/);
        if (urlDigitMatch) return urlDigitMatch[2];
    } catch {
        // Continue with raw-text parsing below.
    }

    const productPathMatch = candidate.match(/\/product\/(\d{7,8})(?:[/?#]|$)/i);
    if (productPathMatch) return productPathMatch[1];

    const standaloneMatch = candidate.match(/(^|[^\d])(\d{7,8})(?:[^\d]|$)/);
    if (standaloneMatch) return standaloneMatch[2];

    return null;
}

function normalizeProductUrl(partNumber) {
    return `https://www.argos.co.uk/product/${partNumber}`;
}

export function parseProductInputs(productInputs) {
    const parsedProducts = unique(productInputs)
        .map((requestedInput) => {
            const partNumber = extractPartNumber(requestedInput);
            if (!partNumber) return null;
            return {
                requestedUrl: requestedInput,
                partNumber,
                normalizedUrl: normalizeProductUrl(partNumber),
            };
        })
        .filter(Boolean);

    return {
        products: parsedProducts.filter(
            (item, index, collection) =>
                collection.findIndex((entry) => entry.partNumber === item.partNumber) === index,
        ),
        invalidInputs: productInputs.filter((requestedInput) => !extractPartNumber(requestedInput)),
    };
}

export function normalizeProxyInput(proxyInput) {
    if (!proxyInput || typeof proxyInput !== 'object') return undefined;

    const options = { ...proxyInput };
    const proxyUrls = Array.isArray(options.proxyUrls)
        ? options.proxyUrls.filter((proxyUrl) => typeof proxyUrl === 'string' && proxyUrl.trim())
        : [];

    if (proxyUrls.length) {
        // Custom proxies cannot be combined with Apify Proxy groups or geolocation.
        return {
            useApifyProxy: false,
            proxyUrls,
        };
    }

    if (options.useApifyProxy === false) return { useApifyProxy: false };

    const groups =
        Array.isArray(options.groups) && options.groups.length > 0 ? options.groups : options.apifyProxyGroups || [];
    const countryCode = options.countryCode || options.apifyProxyCountry;

    delete options.apifyProxyGroups;
    delete options.apifyProxyCountry;
    delete options.proxyUrls;
    options.groups = groups;
    if (countryCode) options.countryCode = countryCode;
    if (groups.includes('RESIDENTIAL') && !countryCode) options.countryCode = 'GB';

    return options;
}

function normalizeSort(sortBy) {
    const value = String(sortBy || '')
        .trim()
        .toLowerCase();
    const mapping = {
        newest: 'SubmissionTime:Desc',
        oldest: 'SubmissionTime:Asc',
        highest_rating: 'Rating:Desc',
        lowest_rating: 'Rating:Asc',
    };

    return mapping[value] || DEFAULT_SORT;
}

function pruneValue(value) {
    if (value === null || value === undefined || value === '') return undefined;

    if (Array.isArray(value)) {
        const cleaned = value.map((item) => pruneValue(item)).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const cleaned = Object.fromEntries(
            Object.entries(value)
                .map(([key, item]) => [key, pruneValue(item)])
                .filter(([, item]) => item !== undefined),
        );
        return Object.keys(cleaned).length ? cleaned : undefined;
    }

    return value;
}

function pruneRecord(record) {
    return pruneValue(record) || {};
}

async function loadInput() {
    const actorInput = await Actor.getInput();
    if (actorInput && Object.keys(actorInput).length) return actorInput;

    try {
        const localInput = JSON.parse(await readFile(new URL('../INPUT.json', import.meta.url), 'utf8'));
        if (localInput && typeof localInput === 'object') return localInput;
    } catch {
        // Ignore local fallback errors.
    }

    return actorInput || {};
}

function mapReview(review, sourceContext, pageNumber, sortBy) {
    const secondaryRatings = Object.values(review.SecondaryRatings || {}).reduce((acc, item) => {
        if (item?.Label && item?.Value !== undefined && item?.Value !== null) acc[item.Label] = item.Value;
        return acc;
    }, {});
    const contextAttributes = Object.values(review.ContextDataValues || {}).reduce((acc, item) => {
        if (item?.DimensionLabel && item?.ValueLabel) acc[item.DimensionLabel] = item.ValueLabel;
        return acc;
    }, {});
    const syndication = review.SyndicationSource
        ? {
              name: review.SyndicationSource.Name,
              url: review.SyndicationSource.ContentLink,
              logoImageUrl: review.SyndicationSource.LogoImageUrl,
          }
        : undefined;

    return pruneRecord({
        ...sourceContext,
        sortBy,
        pageNumber,
        reviewId: Number.parseInt(review.Id, 10),
        submissionId: review.SubmissionId,
        submittedAt: review.SubmissionTime,
        lastModifiedAt: review.LastModificationTime,
        lastModeratedAt: review.LastModeratedTime,
        reviewLocale: review.ContentLocale,
        moderationStatus: review.ModerationStatus,
        title: review.Title,
        text: review.ReviewText,
        overallRating: review.Rating,
        ratingRange: review.RatingRange,
        recommended: review.IsRecommended,
        isFeatured: review.IsFeatured,
        isRatingsOnly: review.IsRatingsOnly,
        isSyndicated: review.IsSyndicated,
        syndication,
        reviewerName: review.UserNickname,
        reviewerLocation: review.UserLocation,
        reviewerContextAttributes: contextAttributes,
        badges: Object.values(review.Badges || {}).map((badge) => badge.Id),
        helpfulVotes: review.TotalPositiveFeedbackCount,
        unhelpfulVotes: review.TotalNegativeFeedbackCount,
        totalFeedbackCount: review.TotalFeedbackCount,
        totalCommentCount: review.TotalCommentCount,
        totalClientResponseCount: review.TotalClientResponseCount,
        secondaryRatings,
        photos: Array.isArray(review.Photos) ? review.Photos : undefined,
        videos: Array.isArray(review.Videos) ? review.Videos : undefined,
        pros: review.Pros,
        cons: review.Cons,
        additionalFields: review.AdditionalFields,
        clientResponses: Array.isArray(review.ClientResponses) ? review.ClientResponses : undefined,
    });
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isTransientError(error) {
    return (
        error?.name === 'AbortError' ||
        ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ETIMEDOUT'].includes(error?.code) ||
        error?.retryable === true ||
        /fetch|network|timeout|temporar|timed out/i.test(String(error?.message || error))
    );
}

function getRetryDelay(attempt, retryAfterHeader) {
    const retryAfterSeconds = Number.parseFloat(retryAfterHeader || '');
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
        ? Math.min(5_000, Math.max(0, retryAfterSeconds * 1_000))
        : 0;
    const exponentialDelay = Math.min(5_000, API_RETRY_BASE_DELAY_MS * 2 ** attempt);
    return Math.max(retryAfterMs, exponentialDelay + Math.random() * 250);
}

function isRetryableStatus(status) {
    // A 403 is an egress/fingerprint rejection, not a transient response worth
    // retrying repeatedly through the same proxy session.
    return status === 408 || status === 429 || status >= 500;
}

function isFallbackStatus(error) {
    return [403, 404, 408, 429].includes(error?.status) || error?.status >= 500 || isTransientError(error);
}

async function fetchApiJson(client, url, referer, diagnostics) {
    const endpointHost = new URL(url).hostname;

    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            let response;

            try {
                response = await client.fetch(url, {
                    method: 'GET',
                    headers: {
                        accept: 'application/json',
                        'accept-language': 'en-GB,en;q=0.9',
                        referer,
                        origin: new URL(url).origin,
                    },
                    redirect: 'follow',
                    signal: controller.signal,
                    timeout: FETCH_TIMEOUT_MS,
                });
            } finally {
                clearTimeout(timer);
            }

            if (!response.ok) {
                log.warning(
                    `Request diagnostic | host=${endpointHost} | status=${response.status} | retry=${attempt} | proxy=${diagnostics.proxyConfigured} | new_session=${diagnostics.newProxySession && attempt === 0}`,
                );
                if (!isRetryableStatus(response.status) || attempt === API_MAX_RETRIES) {
                    throw new HttpStatusError(response.status, endpointHost);
                }

                await delay(getRetryDelay(attempt, response.headers.get('retry-after')));
                continue;
            }

            let json;
            try {
                json = await response.json();
            } catch {
                const parseError = new Error('Argos endpoint returned invalid JSON');
                parseError.retryable = true;
                throw parseError;
            }

            if (!json || typeof json !== 'object' || Array.isArray(json)) {
                const shapeError = new Error('Argos endpoint returned an unexpected JSON shape');
                shapeError.retryable = true;
                throw shapeError;
            }

            return json;
        } catch (error) {
            if (!isTransientError(error) || attempt === API_MAX_RETRIES) throw error;
            await delay(getRetryDelay(attempt));
        }
    }

    throw new Error('Argos request retry limit reached');
}

function requireDataObject(payload, endpointName) {
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
        throw new Error(`Invalid ${endpointName} response: missing data object`);
    }

    return payload;
}

function requireReviewResults(payload) {
    if (!Array.isArray(payload.data.Results)) {
        throw new Error('Invalid review response: missing Results array');
    }

    return payload.data.Results;
}

function getHostProductUrl(productUrl, apiBaseUrl, partNumber) {
    try {
        const parsedProductUrl = new URL(productUrl);
        const apiOrigin = new URL(apiBaseUrl).origin;
        return `${apiOrigin}${parsedProductUrl.pathname}${parsedProductUrl.search}`;
    } catch {
        return `${apiBaseUrl}/product/${partNumber}`;
    }
}

async function fetchProductAndReviewsFromHost(
    client,
    { apiBaseUrl, partNumber, resultsWanted, maxPages, sortBy, productUrl, diagnostics },
) {
    const pageSize = Math.max(1, Math.min(50, resultsWanted));
    const reviewPages = [];
    let fetchedReviews = 0;
    let totalResults = 0;

    for (let pageIndex = 0; pageIndex < maxPages && fetchedReviews < resultsWanted; pageIndex++) {
        if (pageIndex > 0) {
            await delay(400 + Math.random() * 600);
        }

        const offset = pageIndex * pageSize;
        const limit = Math.min(pageSize, resultsWanted - fetchedReviews);
        const query = new URLSearchParams({
            Limit: String(limit),
            Offset: String(offset),
            Sort: sortBy,
            returnMeta: 'true',
        });
        const response = requireDataObject(
            await fetchApiJson(
                client,
                `${apiBaseUrl}/product-api/bazaar-voice-reviews/partNumber/${partNumber}?${query.toString()}`,
                getHostProductUrl(productUrl, apiBaseUrl, partNumber),
                {
                    ...diagnostics,
                    newProxySession: diagnostics.newProxySession && pageIndex === 0,
                },
            ),
            'review',
        );
        const results = requireReviewResults(response);

        totalResults = Number(response?.data?.TotalResults || totalResults || 0);
        reviewPages.push({
            pageNumber: pageIndex + 1,
            offset,
            limit,
            payload: response,
        });

        fetchedReviews += results.length;

        if (!results.length || results.length < limit || (totalResults && fetchedReviews >= totalResults)) {
            break;
        }
    }

    return {
        reviewPages,
        totalResults,
    };
}

export async function fetchProductAndReviews(client, params) {
    const apiBaseUrls = [API_BASE_URL, ...API_FALLBACK_BASE_URLS];
    let lastError;
    const hostErrors = [];

    for (let index = 0; index < apiBaseUrls.length; index++) {
        const apiBaseUrl = apiBaseUrls[index];

        try {
            return await fetchProductAndReviewsFromHost(client, {
                ...params,
                apiBaseUrl,
                diagnostics: {
                    ...params.diagnostics,
                    newProxySession: params.diagnostics.newProxySession && index === 0,
                },
            });
        } catch (error) {
            lastError = error;
            hostErrors.push({ host: new URL(apiBaseUrl).hostname, status: error?.status });
            const hasFallback = index < apiBaseUrls.length - 1;
            if (!hasFallback) break;
            if (!isFallbackStatus(error)) throw error;

            log.warning(
                `Endpoint fallback | host=${new URL(apiBaseUrl).hostname} | status=${error?.status || 'unavailable'} | proxy=${params.diagnostics.proxyConfigured}`,
            );
        }
    }

    if (hostErrors.length === apiBaseUrls.length && hostErrors.every(({ status }) => status === 403)) {
        throw new NetworkEgressBlockedError(
            hostErrors.map(({ host }) => host),
            params.diagnostics.proxyConfigured,
        );
    }

    throw lastError;
}

export async function runActor() {
    await Actor.init();

    try {
        const input = await loadInput();
        const productInputs = collectInputProducts(input);

        if (!productInputs.length) {
            throw new Error('Missing input. Provide a `productId` or `productUrl`.');
        }

        const { products: dedupedProducts, invalidInputs } = parseProductInputs(productInputs);

        if (!dedupedProducts.length) {
            throw new Error('No valid Argos product IDs or product URLs were found in the input.');
        }

        if (dedupedProducts.length > MAX_PRODUCTS) {
            log.warning(`Input contains ${dedupedProducts.length} products, capping to ${MAX_PRODUCTS}`);
            dedupedProducts.length = MAX_PRODUCTS;
        }

        for (const invalidInput of invalidInputs) {
            log.warning(`Skipping invalid product input: ${invalidInput}`);
        }

        const resultsWanted = toPositiveInteger(input.resultsWanted ?? input.results_wanted, DEFAULT_RESULTS_WANTED);
        const maxPages = toPositiveInteger(input.maxPages ?? input.max_pages, DEFAULT_MAX_PAGES);
        const sortBy = normalizeSort(input.sortBy ?? input.sort_by);
        const proxyOptions = normalizeProxyInput(input.proxyConfiguration);

        log.info(`Loaded ${dedupedProducts.length} product(s)`);

        let nextProductIndex = 0;
        let savedRecords = 0;
        const outcomes = [];
        const workerCount = Math.min(2, dedupedProducts.length);
        const processProduct = async ({ partNumber, requestedUrl, normalizedUrl }) => {
            log.info(`Processing product ${partNumber}`);
            let proxyConfiguration;

            try {
                proxyConfiguration = proxyOptions ? await Actor.createProxyConfiguration(proxyOptions) : undefined;
            } catch (error) {
                log.error(
                    `Proxy setup failed | product=${partNumber} | proxy=${Boolean(proxyOptions)} | reason=${error?.name || 'Error'}`,
                );
                return { kind: 'failed', partNumber };
            }

            for (let proxyRotation = 0; proxyRotation <= MAX_PROXY_ROTATIONS; proxyRotation++) {
                try {
                    const newProxySession = Boolean(proxyConfiguration);
                    const proxyUrl = proxyConfiguration
                        ? await proxyConfiguration.newUrl(`argos_${partNumber}_${proxyRotation}`)
                        : undefined;
                    const client = new Impit({
                        browser: 'chrome',
                        ignoreTlsErrors: true,
                        ...(proxyUrl && { proxyUrl }),
                    });
                    const apiPayload = await fetchProductAndReviews(client, {
                        partNumber,
                        resultsWanted,
                        maxPages,
                        sortBy,
                        productUrl: normalizedUrl,
                        diagnostics: {
                            proxyConfigured: Boolean(proxyUrl),
                            newProxySession,
                        },
                    });
                    const mappedReviews = apiPayload.reviewPages.flatMap((pageResult) => {
                        const payload = pageResult.payload?.data || {};
                        const reviews = Array.isArray(payload.Results) ? payload.Results : [];

                        return reviews.map((review) =>
                            mapReview(
                                review,
                                { requestedUrl, productUrl: normalizedUrl, partNumber },
                                pageResult.pageNumber,
                                sortBy,
                            ),
                        );
                    });

                    if (!mappedReviews.length) {
                        log.warning(
                            `Successful empty-review result | product=${partNumber} | proxy=${Boolean(proxyUrl)}`,
                        );
                        return { kind: 'empty', partNumber };
                    }

                    await Dataset.pushData(mappedReviews);
                    savedRecords += mappedReviews.length;
                    log.info(`Saved ${mappedReviews.length} reviews for ${partNumber}`);
                    return { kind: 'saved', partNumber, count: mappedReviews.length };
                } catch (error) {
                    const isBlockedEgress = error instanceof NetworkEgressBlockedError;
                    const canRotateProxy =
                        Boolean(proxyConfiguration) &&
                        proxyRotation < MAX_PROXY_ROTATIONS &&
                        (isBlockedEgress || isFallbackStatus(error));

                    if (canRotateProxy) {
                        log.warning(
                            `Proxy rotation | attempt=${proxyRotation + 1} | status=${isBlockedEgress ? 403 : error?.status || 'unavailable'} | proxy=true | new_session=true`,
                        );
                        continue;
                    }

                    if (isBlockedEgress) {
                        log.warning(
                            `Network egress blocked | hosts=${error.hosts.join(',')} | status=403 | proxy=${error.proxyConfigured} | sessions=${proxyConfiguration ? proxyRotation + 1 : 0}`,
                        );
                        return { kind: 'blocked', partNumber };
                    }

                    log.error(
                        `Product request failed | product=${partNumber} | status=${error?.status || 'unavailable'} | proxy=${Boolean(proxyConfiguration)} | reason=${error?.name || 'Error'}`,
                    );
                    return { kind: 'failed', partNumber };
                }
            }

            return { kind: 'failed', partNumber };
        };

        await Promise.all(
            Array.from({ length: workerCount }, async () => {
                while (nextProductIndex < dedupedProducts.length) {
                    const product = dedupedProducts[nextProductIndex++];
                    outcomes.push(await processProduct(product));
                }
            }),
        );

        const blockedProducts = outcomes.filter(({ kind }) => kind === 'blocked').length;
        const failedProducts = outcomes.filter(({ kind }) => kind === 'failed').length;
        const emptyProducts = outcomes.filter(({ kind }) => kind === 'empty').length;

        if (savedRecords === 0) {
            if (blockedProducts || failedProducts) {
                throw new Error(
                    `No records were saved: blocked=${blockedProducts}, failed=${failedProducts}, empty=${emptyProducts}. The run is not a successful data run.`,
                );
            }

            log.warning(
                `Run completed with a verified empty-review result | products=${emptyProducts} | saved=0 | requests_succeeded=true`,
            );
        } else {
            log.info(
                `Run completed | saved=${savedRecords} | blocked=${blockedProducts} | failed=${failedProducts} | empty=${emptyProducts}`,
            );
        }

        await Actor.exit();
    } catch (error) {
        log.error(`Actor run failed: ${error?.message || String(error)}`);
        await Actor.exit({ exitCode: 1 });
    }
}

const isExecutedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isExecutedDirectly) await runActor();
