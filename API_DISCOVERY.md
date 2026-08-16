## Selected API

- Product details endpoint: `https://www.argos.co.uk/product-api/pdp-service/partNumber/<PART_NUMBER>`
- Reviews endpoint: `https://www.argos.co.uk/product-api/bazaar-voice-reviews/partNumber/<PART_NUMBER>`
- Method: `GET`
- Auth: No explicit token required
- Working request profile: `Accept: application/json`, `Accept-Language: en-GB,en;q=0.9`, a product-page `Referer`, and `Origin: https://www.argos.co.uk`; HTTP/2 disabled for proxy compatibility
- Pagination:
    - `Limit=<page size>`
    - `Offset=<zero-based offset>`
    - `Sort=<sort expression>`
    - `returnMeta=true`
- Working sort confirmed from the live site: `SubmissionTime:Desc`

## Candidate Matrix

| Candidate                                                                        | Header profile                                                          |                             Status/body marker |                                                                     Fields | Pagination                | Decision                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------: | -------------------------------------------------------------------------: | ------------------------- | ------------------------------------------------------------------------- |
| `www.argos.co.uk/product-api/pdp-service`                                        | Desktop request with JSON accept, UK language, referer, and origin      |     `200`, JSON, product `data` and `included` | 20+ product, price, review-statistics, media, taxonomy, and variant fields | Single product request    | Documented, not used at runtime                                           |
| `www.argos.co.uk/product-api/bazaar-voice-reviews` through local Cloudflare WARP | Impit Chrome profile with JSON accept, UK language, referer, and origin | `200`, JSON, `data.Results` and `TotalResults` |                    30+ review, product, response, media, and rating fields | `Limit`, `Offset`, `Sort` | Selected for runtime; this result does not prove Apify Cloud reachability |
| Same endpoints with iOS Safari profile                                           | iOS Safari accept and language headers plus referer and origin          |           `200`, expected JSON markers present |                                                         Same payload shape | Same                      | Confirmed fallback profile                                                |
| Same endpoints with Android `okhttp` profile                                     | Android app-style headers                                               |                                          `403` |                                                                          0 | Unknown                   | Rejected                                                                  |
| `m.argos.co.uk` API paths                                                        | Desktop and iOS profiles                                                |                      `200`, same JSON payloads |                                                                Same fields | Same                      | Equivalent host, not needed                                               |
| `api.argos.co.uk` API paths                                                      | Desktop profile                                                         |                                          `403` |                                                                          0 | Unknown                   | Rejected                                                                  |
| Browser-context `fetch()`                                                        | Browser page context                                                    |     `403` on product API after page navigation |                                                            0 from API call | Not reached               | Rejected for API transport                                                |
| `www` and `m` through direct Apify Cloud egress                                  | Impit Chrome profile with the verified API headers                      | `403` on both hosts in run `Al7A78Cpa8dUXp1ZV` |                                                                          0 | Not reached               | Direct cloud egress rejected                                              |
| `www` and `m` through Apify Residential GB                                       | Same Impit profile; three valid proxy session IDs                       | `403` on both hosts in run `zjoIwAZ49kEv7LK7v` |                                                                          0 | Not reached               | Residential cloud egress rejected                                         |
| `www` and `m` through default Apify Proxy/datacenter routing                     | Same Impit profile; three valid proxy session IDs                       | `403` on both hosts in run `wS9JJhEm0UqV5Kwmp` |                                                                          0 | Not reached               | Datacenter cloud egress rejected                                          |
| User-provided custom `proxyUrls`                                                 | Same Impit profile                                                      |                                Not live-tested |                                                                    Unknown | Unknown                   | Configuration tested; requires a real proxy with known Argos access       |

The direct JSON endpoints score above the 50-point selection threshold: JSON response, rich field count, no explicit authentication, and pagination support for reviews. The actor uses the direct reviews HTTP path for runtime output and retains the product endpoint here for future discovery or recovery work. Browser automation is unnecessary unless future discovery proves that cookies or JavaScript-generated tokens become mandatory.

## Fields Available

- Product API:
    - Product name
    - Brand
    - Description
    - EAN
    - Price
    - Delivery and collection flags
    - Review summary statistics
    - Media
    - Breadcrumb taxonomy
    - Variants
    - Energy information
- Reviews API:
    - Review ID
    - Submission and moderation timestamps
    - Title
    - Review text
    - Overall rating
    - Secondary ratings
    - Recommendation flag
    - Reviewer nickname and context attributes
    - Photos and videos
    - Helpfulness counts
    - Client responses
    - Included product metadata for reviewed variants
    - Review summary
    - Total review count

## Field Count Comparison

- Runtime actor output: review fields plus the requested URL, canonical product URL, part number, sort mode, and page number
- Selected Argos reviews source: 30+ review, response, media, and rating fields before mapping and null pruning
- The PDP source remains documented for discovery, but its product enrichment fields are intentionally not emitted by this review scraper.

## Why This API Was Chosen

- Returns structured JSON directly
- Supports review pagination and sorting
- Returns richer review data than JSON-LD or rendered markup
- Includes review text, ratings, reviewer fields, media, responses, and review metadata
- Works with the direct HTTP request profile through the developer machine's Cloudflare WARP egress
- Avoids the browser-context API request that returned `403`

## Rejected Candidates

- Browser-context `fetch()`:
    - Product-page navigation eventually completed, but the same-origin API request returned `403` in the Apify run
- Android app-style headers:
    - Returned `403` for the product and review paths
- `api.argos.co.uk` host guesses:
    - Returned `403`
- `window.__data` hydration payload:
    - Useful for discovery, but it is page state rather than the underlying source API
- JSON-LD:
    - Only exposes aggregate rating and product metadata, not full review records
- Social feed endpoint on CloudFront:
    - Unrelated to reviews for this actor

## Runtime Request Pattern Audit

- Headers: the runtime sends the verified JSON `Accept`, UK `Accept-Language`, product-page `Referer`, and matching host `Origin` headers. Impit generates the User-Agent, TLS fingerprint, and other browser headers.
- Cookies and authentication: direct testing succeeded without cookies, tokens, or authorization headers, so the runtime does not create a browser session or cookie jar.
- Query parameters: runtime order and names match the working request: `Limit`, `Offset`, `Sort`, and `returnMeta=true`. The requested result limit and page cap are preserved.
- Request order: the reviews endpoint is called directly; no unnecessary product-page navigation or PDP request precedes it.
- Host variants: `www.argos.co.uk` is primary. The verified equivalent `m.argos.co.uk` host is used only after the primary host exhausts bounded recovery.
- Concurrency and pacing: the existing maximum of two products is preserved because discovery provided no evidence that concurrency caused blocking. Only inter-page pacing and retry backoff add delays, so successful requests are not slowed arbitrarily.
- Sessions and proxy behavior: one Impit client reuses one proxy session for all requests for a product. A blocked or temporary failure rotates to a new proxy session, and residential Argos traffic defaults to the UK when no country is supplied. UK geolocation is not treated as proof that Argos will accept the IP range.
- Desktop/mobile choice: the primary request uses Impit's Chrome profile. The mobile host is a verified endpoint variant, not an Android app-header spoof; Android `okhttp` headers were tested and rejected with `403`.

## Implementation Decision

- Keep both verified Argos API endpoints documented here for future discovery and recovery work.
- Use only the reviews endpoint at runtime because this actor returns review records, not product catalog enrichment.
- Keep the requested URL, canonical product URL, and part number only as source identifiers on each review record.
- Use direct `impit` HTTP requests with Chrome TLS and browser-header impersonation, product-page referer, and Argos origin.
- Add only the verified API headers `Accept: application/json` and `Accept-Language: en-GB,en;q=0.9`; Impit continues to generate the User-Agent and browser fingerprint headers.
- Pass the configured Apify proxy URL to each request when proxying is enabled.
- Prefer UK residential routing for this UK retailer; blocked proxy sessions are rotated a bounded number of times.
- Retry temporary network failures, timeouts, `429`, and `5xx` responses with bounded backoff. A `403` is tested once per host/session because repeating it through the same egress does not improve reachability.
- Validate the review `data` object and `data.Results` structure before mapping records.
- Keep the existing input fields, pagination controls, review mapping, null pruning, and dataset identifiers unchanged.
- No HTML review parsing or DOM selector extraction is used for dataset output.

## Cloud Egress Diagnosis

- Build `1.0.14` (`xDaNzzIKaRDwJhr6f`) was created on 2026-08-16 after build `1.0.13` (`isA4qjDfFMpUeUVhA`) and contains the new proxy normalization, safe diagnostics, and failure classification.
- The 2026-08-16 Apify Cloud runs show both verified hosts returning `403` through direct cloud egress, three Residential GB sessions, and three default Apify Proxy/datacenter sessions. The same Impit requests returned `200` with 20 review records per host for product `9973200` locally through Cloudflare WARP.
- This evidence isolates the current failure to the available Apify cloud/proxy egress, or to Argos's treatment of Impit's fingerprint when carried over that egress. It does not support adding arbitrary headers, cookies, mobile-app spoofing, or extra retries.
- Because the Origin, Referer, language, accept header, Impit browser profile, endpoint path, and query parameters were identical on the successful WARP check and failed cloud checks, the verified header combination is not the differentiating factor. Impit's Chrome TLS profile works through WARP; the available evidence cannot fully separate proxy IP-range rejection from the way the fingerprint is transported through Apify Proxy.
- Runtime diagnostics report only endpoint host, status, retry number, proxy presence, and session rotation state. Proxy URLs and credentials are never logged.
- `proxyConfiguration` accepts Apify Proxy UI fields (`useApifyProxy`, `apifyProxyGroups`, and `countryCode`) and custom `proxyUrls`. Custom URLs are normalized into a custom-only configuration before being passed to `Actor.createProxyConfiguration()`, and the resulting URL is supplied to Impit as `proxyUrl`.
- If both verified hosts return `403` for every configured session, the actor reports `Network egress blocked` and exits non-zero when no records were saved. A successful API response with an empty `Results` array is reported separately as a verified empty-review result.
- A cloud fix must not be claimed until an Apify run through a genuinely working external HTTP/HTTPS proxy produces dataset records. A dedicated Cloudflare Gateway/WARP-based egress exposed as a proxy URL is a suitable option to test.
