## What does Argos Reviews Scraper do?

Argos Reviews Scraper collects public customer reviews from Argos product pages. Enter an Argos product ID or product URL, choose the review limit and sort order, and receive one structured dataset record per review with ratings, reviewer information, and feedback metrics.

The dataset is useful for product research, competitor analysis, voice-of-customer work, review monitoring, catalog enrichment, and sentiment workflows. Results can be downloaded from Apify or connected to other tools through datasets, webhooks, integrations, and the Apify API.

## Why use Argos Reviews Scraper?

- **Review-focused data** - Collect review titles, full text, ratings, recommendations, helpful votes, secondary ratings, photos, videos, and client responses when Argos publishes them.
- **Review-only output** - Keep product enrichment out of the dataset while retaining the requested URL, canonical URL, and part number as source identifiers.
- **Flexible collection** - Use a product ID or a full Argos URL, including URLs with query strings or tracking parameters.
- **Controlled volume** - Set a review limit and a page cap to balance collection depth and run time.
- **Repeatable monitoring** - Schedule recurring runs to track new reviews, rating changes, and changes in customer feedback.
- **Clean records** - Empty, null, and undefined values are removed from each dataset item.

## What data can you extract from Argos reviews?

Each saved item represents one customer review. The requested URL, canonical URL, and part number identify the source product without adding product catalog information to every review record. Optional review fields appear only when Argos provides a value.

| Field                                                        | Type            | Description                                           |
| ------------------------------------------------------------ | --------------- | ----------------------------------------------------- |
| `partNumber`                                                 | String          | Argos product identifier.                             |
| `requestedUrl`                                               | String          | Product value supplied in the run input.              |
| `productUrl`                                                 | String          | Canonical Argos product URL.                          |
| `sortBy`, `pageNumber`                                       | String, Integer | Sort mode and review page number.                     |
| `reviewId`, `submissionId`                                   | Integer, String | Review identifiers.                                   |
| `submittedAt`, `lastModifiedAt`, `lastModeratedAt`           | String          | Review timestamps.                                    |
| `title`, `text`                                              | String          | Review headline and full review text.                 |
| `overallRating`, `ratingRange`                               | Number          | Review score and available score range.               |
| `recommended`, `isFeatured`, `isRatingsOnly`, `isSyndicated` | Boolean         | Review status and recommendation flags.               |
| `reviewerName`, `reviewerLocation`                           | String          | Public reviewer information when available.           |
| `reviewerContextAttributes`                                  | Object          | Reviewer context values supplied by Argos.            |
| `secondaryRatings`                                           | Object          | Category-level scores such as quality or ease of use. |
| `helpfulVotes`, `unhelpfulVotes`, `totalFeedbackCount`       | Integer         | Feedback vote counts.                                 |
| `photos`, `videos`                                           | Array           | Review media links or metadata.                       |
| `pros`, `cons`, `additionalFields`                           | String, Object  | Additional review content when available.             |
| `clientResponses`                                            | Array           | Public responses attached to the review.              |

## How to use Argos Reviews Scraper

1. Open the Actor in Apify.
2. Enter an Argos product ID, product URL, or both.
3. Set the review limit, page cap, and sort order.
4. Optionally configure Apify Proxy for your run.
5. Start the run and inspect the dataset preview.
6. Download the results or connect the dataset to your workflow.

At least one valid product ID or product URL is required. If several inputs are supplied, duplicate product IDs are processed once and invalid entries are skipped when valid entries remain.

## Input Parameters

| Parameter            | Type    | Required | Default                   | Description                                                                                    |
| -------------------- | ------- | -------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `productId`          | String  | No*      | Example ID: `7953538`     | Argos product part number containing 7 or 8 digits.                                            |
| `productUrl`         | String  | No*      | Example Argos URL         | Argos product page URL. Query strings, tracking parameters, and trailing slashes are accepted. |
| `resultsWanted`      | Integer | No       | `20`                      | Maximum reviews to collect per product. Minimum is `1`.                                        |
| `maxPages`           | Integer | No       | `2`                       | Maximum review pages to request per product. Minimum is `1`.                                   |
| `sortBy`             | String  | No       | `newest`                  | One of `newest`, `oldest`, `highest_rating`, or `lowest_rating`.                               |
| `proxyConfiguration` | Object  | No       | Apify Proxy configuration | Optional proxy settings for the run.                                                           |

`*` Provide at least one of `productId` or `productUrl` for a successful run. If both are supplied for the same product, the duplicate is removed.

## Usage Examples

### Collect reviews from a product URL

Use a complete Argos product URL for a straightforward review collection.

```json
{
    "productUrl": "https://www.argos.co.uk/product/7953538",
    "resultsWanted": 20,
    "maxPages": 2,
    "sortBy": "newest"
}
```

### Collect reviews by product ID

Use the product ID when you already have an Argos product list.

```json
{
    "productId": "7953538",
    "resultsWanted": 50,
    "maxPages": 5,
    "sortBy": "highest_rating"
}
```

### Use proxy routing

The Actor accepts Apify Proxy settings, including group and country routing. A UK exit IP is not a guarantee that Argos will accept the provider's IP range.

```json
{
    "productUrl": "https://www.argos.co.uk/product/7953538?clickPR=plp:1:2",
    "resultsWanted": 100,
    "maxPages": 10,
    "sortBy": "oldest",
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"],
        "countryCode": "GB"
    }
}
```

You can instead supply a custom HTTP/HTTPS proxy through the proxy editor's `proxyUrls` field. Custom proxy URLs are passed to Impit but are never written to the Actor log.

```json
{
    "productId": "9973200",
    "proxyConfiguration": {
        "useApifyProxy": false,
        "proxyUrls": ["http://username:password@proxy.example:8000"]
    }
}
```

If every configured session receives `403` from both verified Argos hosts, the Actor reports that network egress is blocked and fails the run when no records were saved. A product with a successful API response and zero reviews is reported separately as a verified empty-review result.

## Sample Output

The following example shows one review record. Optional fields are omitted when Argos does not provide them.

```json
{
    "requestedUrl": "https://www.argos.co.uk/product/7953538",
    "productUrl": "https://www.argos.co.uk/product/7953538",
    "partNumber": "7953538",
    "sortBy": "newest",
    "pageNumber": 1,
    "reviewId": 182006575,
    "submittedAt": "2026-06-01T04:52:43.000+00:00",
    "title": "Good product",
    "text": "The product works well and is easy to use.",
    "overallRating": 5,
    "ratingRange": 5,
    "recommended": true,
    "reviewerName": "Customer",
    "helpfulVotes": 3,
    "unhelpfulVotes": 0,
    "secondaryRatings": {
        "Ease of use": 5
    }
}
```

## Data-quality behavior and limitations

- Reviews are returned in the selected source order until `resultsWanted` or `maxPages` is reached.
- A product with no available reviews produces a warning and no dataset item for that product.
- Fields are omitted when the source does not publish them. Missing optional fields do not indicate a failed run.
- Temporary network failures, timeouts, rate limits, and server errors are retried with bounded backoff.
- Public product pages and review data can change. Recheck scheduled datasets when source fields or review totals change.
- The Actor accepts product pages, not Argos category pages or search pages.

## Tips for best results

- Start with `resultsWanted: 20` and `maxPages: 2` to confirm the product and output shape.
- Use a canonical product URL or a 7 to 8 digit product ID.
- Increase `maxPages` when a product has a large review history.
- Use `text`, `pros`, `cons`, ratings, and `secondaryRatings` for review analysis.
- Schedule repeat runs when you need to monitor new feedback or rating changes.

## Integrations and export formats

- **Apify API** - Read dataset items from your own application.
- **Google Sheets or Airtable** - Review and filter customer feedback in shared tables.
- **Make or Zapier** - Trigger downstream workflows after a run.
- **Webhooks** - Notify another service when collection finishes.

Apify datasets can be exported as JSON, CSV, Excel, XML, and other supported formats.

## Frequently Asked Questions

### Can I run the Actor with only a product ID?

Yes. Set `productId` to the Argos part number and leave `productUrl` empty.

### Can I use a product URL with tracking parameters?

Yes. The Actor extracts the product ID from standard Argos product URLs, including URLs with query strings, fragments, and trailing slashes.

### Can I collect every available review?

Set `resultsWanted` and `maxPages` high enough for the product. The Actor stops when the requested limit is reached or when the source returns no additional reviews.

### Why are some fields missing?

Optional fields are omitted when Argos does not publish a value for a product or review. This is normal for media, reviewer context, secondary ratings, and responses.

### Do I need Apify Proxy?

No. Proxy configuration is optional. Argos currently rejects some cloud proxy ranges, including UK-addressed ranges, so use an external HTTP/HTTPS proxy with known-good Argos access if the Actor reports blocked network egress. A dedicated Cloudflare Gateway/WARP-based proxy egress is one option.

### Can I schedule repeat collections?

Yes. Use Apify Schedules to run the Actor hourly, daily, weekly, or at a custom interval, then compare datasets over time.

### Is collecting Argos review data legal?

Public web data may be subject to website terms, privacy rules, and other laws. You are responsible for using the data lawfully, respecting Argos terms and access controls, and collecting only information you have a legitimate reason to use.

## Related Actors

- [Target Reviews Scraper](https://apify.com/shahidirfan/target-reviews-scraper) - Collect product reviews and ratings from Target for ecommerce research and customer feedback analysis.
- [B&H Reviews Scraper](https://apify.com/shahidirfan/b-h-reviews-scraper) - Collect detailed reviews and product context from B&H Photo Video.
- [Walmart Reviews Scraper](https://apify.com/shahidirfan/walmart-reviews-scraper) - Collect Walmart product reviews, ratings, and reviewer details.
- [iHerb Reviews Scraper](https://apify.com/shahidirfan/iherb-reviews-scraper) - Collect iHerb reviews and customer feedback for product and market analysis.

## Support

For issues, field questions, or feature requests, use the Actor's Issues tab in Apify Console.

## Legal Notice

This Actor is intended for legitimate collection and analysis of publicly available Argos review data. Users are responsible for complying with Argos terms, applicable laws, privacy requirements, and any restrictions on storing, sharing, or using review content.
