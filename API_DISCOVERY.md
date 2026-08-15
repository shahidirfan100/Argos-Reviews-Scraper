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
| `www.argos.co.uk/product-api/pdp-service` | Desktop request with JSON accept, UK language, referer, and origin | `200`, JSON, product `data` and `included` | 20+ product, price, review-statistics, media, taxonomy, and variant fields | Single product request | Selected |
| `www.argos.co.uk/product-api/bazaar-voice-reviews` | Desktop request with JSON accept, UK language, referer, and origin | `200`, JSON, `data.Results` and `TotalResults` | 30+ review, product, response, media, and rating fields | `Limit`, `Offset`, `Sort` | Selected |
| Same endpoints with iOS Safari profile | iOS Safari accept and language headers plus referer and origin | `200`, expected JSON markers present | Same payload shape | Same | Confirmed fallback profile |
| Same endpoints with Android `okhttp` profile | Android app-style headers | `403` | 0 | Unknown | Rejected |
| `m.argos.co.uk` API paths | Desktop and iOS profiles | `200`, same JSON payloads | Same fields | Same | Equivalent host, not needed |
| `api.argos.co.uk` API paths | Desktop profile | `403` | 0 | Unknown | Rejected |
| Browser-context `fetch()` | Patchright Chrome page context | `403` on product API after page navigation | 0 from API call | Not reached | Rejected for API transport |

The direct JSON endpoints score above the 50-point selection threshold: JSON response, rich field count, no explicit authentication, pagination support for reviews, and full coverage of the existing dataset fields. The actor should use the direct HTTP path for API retrieval and reserve browser automation only if future discovery proves that cookies or JavaScript-generated tokens become mandatory.

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

- Existing actor: 30+ review and product fields
- Selected Argos sources: 20+ product fields and 30+ review fields before mapping and null pruning
- The selected sources preserve the existing dataset structure and provide the full product and review payloads needed by the current mapper.

## Why This API Was Chosen

- Returns structured JSON directly
- Supports review pagination and sorting
- Returns richer review data than JSON-LD or rendered markup
- Includes product context, review statistics, media, variants, responses, and review summary
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

## Implementation Decision

- Use direct `impit` HTTP requests with Chrome TLS and browser-header impersonation, product-page referer, and Argos origin.
- Pass the configured Apify proxy URL to each request when proxying is enabled.
- Retry temporary network failures, timeouts, `429`, and `5xx` responses with bounded backoff.
- Validate the product `data` object and review `data.Results` structure before mapping records.
- Keep the existing input fields, pagination controls, output mapping, null pruning, and dataset structure unchanged.
- No HTML review parsing or DOM selector extraction is used for dataset output.
