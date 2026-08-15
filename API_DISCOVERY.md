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

| Candidate | Header profile | Status/body marker | Fields | Pagination | Decision |
|---|---|---:|---:|---|---|
| `www.argos.co.uk/product-api/pdp-service` | Desktop request with JSON accept, UK language, referer, and origin | `200`, JSON, product `data` and `included` | 20+ product, price, review-statistics, media, taxonomy, and variant fields | Single product request | Documented, not used at runtime |
| `www.argos.co.uk/product-api/bazaar-voice-reviews` | Desktop request with JSON accept, UK language, referer, and origin | `200`, JSON, `data.Results` and `TotalResults` | 30+ review, product, response, media, and rating fields | `Limit`, `Offset`, `Sort` | Selected for runtime |
| Same endpoints with iOS Safari profile | iOS Safari accept and language headers plus referer and origin | `200`, expected JSON markers present | Same payload shape | Same | Confirmed fallback profile |
| Same endpoints with Android `okhttp` profile | Android app-style headers | `403` | 0 | Unknown | Rejected |
| `m.argos.co.uk` API paths | Desktop and iOS profiles | `200`, same JSON payloads | Same fields | Same | Equivalent host, not needed |
| `api.argos.co.uk` API paths | Desktop profile | `403` | 0 | Unknown | Rejected |
| Browser-context `fetch()` | Browser page context | `403` on product API after page navigation | 0 from API call | Not reached | Rejected for API transport |

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
- Works with a direct HTTP request profile from the Apify environment's target domain
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
- Sessions and proxy behavior: one Impit client reuses one proxy session for all requests for a product. A blocked or temporary failure rotates to a new proxy session, and residential Argos traffic defaults to the UK when no country is supplied.
- Desktop/mobile choice: the primary request uses Impit's Chrome profile. The mobile host is a verified endpoint variant, not an Android app-header spoof; Android `okhttp` headers were tested and rejected with `403`.

## Implementation Decision

- Keep both verified Argos API endpoints documented here for future discovery and recovery work.
- Use only the reviews endpoint at runtime because this actor returns review records, not product catalog enrichment.
- Keep the requested URL, canonical product URL, and part number only as source identifiers on each review record.
- Use direct `impit` HTTP requests with Chrome TLS and browser-header impersonation, product-page referer, and Argos origin.
- Add only the verified API headers `Accept: application/json` and `Accept-Language: en-GB,en;q=0.9`; Impit continues to generate the User-Agent and browser fingerprint headers.
- Pass the configured Apify proxy URL to each request when proxying is enabled.
- Prefer UK residential routing for this UK retailer; blocked proxy sessions are rotated a bounded number of times.
- Retry temporary network failures, timeouts, `403`, `429`, and `5xx` responses with bounded backoff.
- Validate the review `data` object and `data.Results` structure before mapping records.
- Keep the existing input fields, pagination controls, review mapping, null pruning, and dataset identifiers unchanged.
- No HTML review parsing or DOM selector extraction is used for dataset output.
