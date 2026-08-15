## Selected API

- Product details endpoint: `https://www.argos.co.uk/product-api/pdp-service/partNumber/<PART_NUMBER>`
- Reviews endpoint: `https://www.argos.co.uk/product-api/bazaar-voice-reviews/partNumber/<PART_NUMBER>`
- Method: `GET`
- Auth: No explicit token required, but Argos blocks plain terminal HTTP in this environment. The same endpoints work from a real browser context.
- Pagination:
    - `Limit=<page size>`
    - `Offset=<zero-based offset>`
    - `Sort=<sort expression>`
    - `returnMeta=true`
- Working sort confirmed from the live site: `SubmissionTime:Desc`

## Fields Available

- Product API:
    - Product name
    - Brand
    - Description
    - EAN
    - Price
    - Delivery flags
    - Review summary stats
    - Media
    - Breadcrumb taxonomy
    - Variants
- Reviews API:
    - Review ID
    - Submission and moderation timestamps
    - Title
    - Review text
    - Overall rating
    - Secondary ratings
    - Recommendation flag
    - Reviewer nickname
    - Reviewer context attributes
    - Photos and videos
    - Helpfulness counts
    - Client responses
    - Included product metadata for reviewed variants
    - AI review summary
    - Total review count

## Field Count Comparison

- Existing actor: 7 job fields from an unrelated Remote.co scraper
- New Argos actor: 30+ review and product fields without HTML selectors

## Why This API Was Chosen

- Returns structured JSON directly
- Supports pagination and sorting
- Returns richer review data than JSON-LD or rendered markup
- Includes product context and review summary
- Matches the live Argos product page data

## Rejected Candidates

- `window.__data` hydration payload:
    - Useful for discovery, but it is page state rather than the underlying source API
- JSON-LD:
    - Only exposes aggregate rating and product metadata, not full review records
- Social feed endpoint on CloudFront:
    - Unrelated to reviews for this actor

## Implementation Decision

- Direct terminal HTTP requests to Argos were blocked with `Access Denied`
- Browser-context `fetch()` calls to both selected endpoints succeeded
- The actor therefore uses Playwright Firefox only to open the product page and call the JSON APIs from the browser context
- No HTML review parsing or DOM selector extraction is used for dataset output
