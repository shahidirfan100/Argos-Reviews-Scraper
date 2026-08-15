import { readFile } from 'node:fs/promises';

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

function collectInputProducts(input) {
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

function extractPartNumber(inputValue) {
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

function normalizeProxyInput(proxyInput) {
    if (!proxyInput || typeof proxyInput !== 'object') return undefined;

    const options = { ...proxyInput };
    const groups = Array.isArray(options.groups) && options.groups.length > 0
        ? options.groups
        : options.apifyProxyGroups || [];
    const hasCustomProxyUrls = Array.isArray(options.proxyUrls) && options.proxyUrls.length > 0;
    const hasApifyProxy = options.useApifyProxy !== false && !hasCustomProxyUrls;
    const hasResidentialGroup = Array.isArray(groups) && groups.includes('RESIDENTIAL');
    const hasCountry = options.countryCode || options.apifyProxyCountry;

    if (hasApifyProxy && hasResidentialGroup && !hasCountry) {
        options.countryCode = 'GB';
    }

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
    return status === 403 || status === 408 || status === 429 || status >= 500;
}

function isFallbackStatus(error) {
    const statusCode = error?.message?.match(/\b(403|404|408|429|5\d{2})\b/)?.[1];
    return Boolean(statusCode) || isTransientError(error);
}

async function fetchApiJson(client, url, referer) {
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
                if (!isRetryableStatus(response.status) || attempt === API_MAX_RETRIES) {
                    throw new Error(`Request failed ${response.status} for ${url}`);
                }

                await delay(getRetryDelay(attempt, response.headers.get('retry-after')));
                continue;
            }

            let json;
            try {
                json = await response.json();
            } catch {
                const parseError = new Error(`Invalid JSON from ${url}`);
                parseError.retryable = true;
                throw parseError;
            }

            if (!json || typeof json !== 'object' || Array.isArray(json)) {
                const shapeError = new Error(`Unexpected JSON shape from ${url}`);
                shapeError.retryable = true;
                throw shapeError;
            }

            return json;
        } catch (error) {
            if (!isTransientError(error) || attempt === API_MAX_RETRIES) throw error;
            await delay(getRetryDelay(attempt));
        }
    }

    throw new Error(`Request retry limit reached for ${url}`);
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

async function fetchProductAndReviewsFromHost(client, { apiBaseUrl, partNumber, resultsWanted, maxPages, sortBy, productUrl }) {
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

async function fetchProductAndReviews(client, params) {
    const apiBaseUrls = [API_BASE_URL, ...API_FALLBACK_BASE_URLS];
    let lastError;

    for (let index = 0; index < apiBaseUrls.length; index++) {
        const apiBaseUrl = apiBaseUrls[index];

        try {
            return await fetchProductAndReviewsFromHost(client, { ...params, apiBaseUrl });
        } catch (error) {
            lastError = error;
            const hasFallback = index < apiBaseUrls.length - 1;
            if (!hasFallback || !isFallbackStatus(error)) throw error;

            log.warning(`Reviews endpoint unavailable on ${apiBaseUrl}; trying the fallback API host`);
        }
    }

    throw lastError;
}

await Actor.init();

let exitCode = 0;

try {
    const input = await loadInput();
    const productInputs = collectInputProducts(input);

    if (!productInputs.length) {
        throw new Error(
            'Missing input. Provide a `productId` or `productUrl`.',
        );
    }

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
    const dedupedProducts = parsedProducts.filter(
        (item, index, collection) => collection.findIndex((entry) => entry.partNumber === item.partNumber) === index,
    );

    if (!dedupedProducts.length) {
        throw new Error('No valid Argos product IDs or product URLs were found in the input.');
    }

    if (dedupedProducts.length > MAX_PRODUCTS) {
        log.warning(`Input contains ${dedupedProducts.length} products, capping to ${MAX_PRODUCTS}`);
        dedupedProducts.length = MAX_PRODUCTS;
    }

    const invalidInputs = productInputs.filter((requestedInput) => !extractPartNumber(requestedInput));
    for (const invalidInput of invalidInputs) {
        log.warning(`Skipping invalid product input: ${invalidInput}`);
    }

    const resultsWanted = toPositiveInteger(input.resultsWanted ?? input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toPositiveInteger(input.maxPages ?? input.max_pages, DEFAULT_MAX_PAGES);
    const sortBy = normalizeSort(input.sortBy ?? input.sort_by);
    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(normalizeProxyInput(input.proxyConfiguration))
        : undefined;

    log.info(`Loaded ${dedupedProducts.length} product(s)`);

    let nextProductIndex = 0;
    let savedRecords = 0;
    const workerCount = Math.min(2, dedupedProducts.length);
    const processProduct = async ({ partNumber, requestedUrl, normalizedUrl }) => {
        log.info(`Processing product ${partNumber}`);

        for (let proxyRotation = 0; proxyRotation <= MAX_PROXY_ROTATIONS; proxyRotation++) {
            try {
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
                    log.warning(`No reviews found for ${normalizedUrl}`);
                    return;
                }

                await Dataset.pushData(mappedReviews);
                savedRecords += mappedReviews.length;
                log.info(`Saved ${mappedReviews.length} reviews for ${partNumber}`);
                return;
            } catch (error) {
                const message = error?.message || String(error);
                const canRotateProxy =
                    Boolean(proxyConfiguration) &&
                    proxyRotation < MAX_PROXY_ROTATIONS &&
                    isFallbackStatus(error);

                if (canRotateProxy) {
                    log.warning(`Proxy attempt ${proxyRotation + 1} was blocked or unavailable; rotating proxy session`);
                    continue;
                }

                const statusCode = message.match(/\b(403|408|429|5\d{2})\b/)?.[1];
                if (statusCode) {
                    log.warning(`Request blocked or unavailable (${statusCode}) for ${normalizedUrl}: ${message}`);
                } else {
                    log.error(`Request failed for ${normalizedUrl}: ${message}`);
                }
                return;
            }
        }
    };

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextProductIndex < dedupedProducts.length) {
                const product = dedupedProducts[nextProductIndex++];
                await processProduct(product);
            }
        }),
    );
    if (savedRecords === 0) {
        log.warning('Run completed without dataset records');
    }
} catch (error) {
    exitCode = 1;
    log.error(`Actor run failed: ${error?.message || String(error)}`);
} finally {
    await Actor.exit({ exitCode });
}
