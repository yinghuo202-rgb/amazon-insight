# Jungle Scout Browser-Assisted Import

This workflow adds a low-cost candidate data source for the local Amazon Growth Console MVP. Jungle Scout is used only as a browser/export data source. Final recommendations still pass through local duplicate filtering, store-fit scoring, seasonality checks, risk scoring, feedback, and audit.

## Purpose

Use a user-owned Jungle Scout account and browser export capability to produce CSV files, then import those files into the local candidate pool.

The importer does not call the Jungle Scout API, Amazon API, Keepa API, or any external service.

## User Prerequisites

- Log in to Jungle Scout in the browser yourself.
- Complete any captcha, MFA, or account verification yourself.
- Confirm the target marketplace is Amazon US.
- Provide keywords, categories, or ASIN targets for export.

Codex must not store account credentials, cookies, sessions, tokens, or exported sensitive account data.

## Allowed Codex Actions

- Open Jungle Scout or Amazon pages in the browser after user authorization.
- Use the user's already logged-in browser session.
- Search by provided keywords, categories, or ASINs.
- Use visible export buttons to download CSV files.
- Move downloaded CSV files into `input/browser_exports/jungle_scout/`.
- Run `npm run import:jungle-scout`.
- Run `npm run audit:all`.
- Report import counts, warnings, and audit status.

## Disallowed Actions

- Save Jungle Scout username or password.
- Store cookies, access tokens, refresh tokens, sessions, or account secrets.
- Modify Jungle Scout account settings.
- Purchase, upgrade, cancel, or change subscriptions.
- Bypass captcha, MFA, or login restrictions.
- Scrape Amazon at high frequency.
- Write raw browser page data directly into core JSON files without the importer.

## Single Keyword Workflow

1. User logs in to Jungle Scout.
2. Codex opens the requested Jungle Scout tool or Amazon page with the Jungle Scout extension.
3. Codex searches one keyword, for example `garden hose quick connect`.
4. Codex applies agreed filters, such as Amazon US, price `$20-$80`, monthly sales `30+`.
5. Codex exports CSV.
6. CSV is saved to `input/browser_exports/jungle_scout/`.
7. Codex runs:

```bash
npm run import:jungle-scout
npm run audit:all
```

## Store-Based Keyword Planning

Generate keyword tasks from the normalized store profile and expansion opportunities:

```bash
npm run plan:jungle-scout
```

The planner writes:

```text
data/product_research/jungle_scout_keyword_tasks.json
input/browser_exports/jungle_scout/README.md
```

Each task includes a keyword, priority, suggested filters, and a target CSV path. Use these tasks when exporting from the logged-in Jungle Scout browser extension.

## Multi Keyword Workflow

Repeat the export for each keyword:

- `rv winterization kit`
- `garden hose quick connect`
- `trailer wheel chock`
- `garage wall hook`
- `outdoor faucet cover`

Save all CSV files under `input/browser_exports/jungle_scout/`, then run the import once.

## CSV Save Directory

```text
input/browser_exports/jungle_scout/
```

Suggested filename:

```text
garden_hose_quick_connect_2026-05-25.csv
```

## Import Command

```bash
npm run import:jungle-scout
```

The importer writes:

```text
data/product_research/candidate_products_raw.json
data/product_research/candidate_products.json
data/product_research/candidate_data_report.json
data/product_research/import_reports/jungle_scout_import_latest.json
```

It also keeps legacy compatible snapshots under `data/candidate_products*.json`.

## Optional API Provider Placeholder

The local MVP includes a disabled Jungle Scout API provider shell for future integration:

```bash
npm run check:jungle-scout-api
```

The provider reads the API key only from an environment variable:

```powershell
$env:JUNGLE_SCOUT_API_KEY="..."
```

Local API settings can be placed in `config/jungle_scout.config.local.json`, which is gitignored. The default provider does not make external requests unless the API importer explicitly enables it.

When the official credentials are available, use the product database API importer:

```powershell
$env:JUNGLE_SCOUT_AUTH="KEY_NAME:API_KEY"
npm run import:jungle-scout-api -- --limit=3
```

As a local-only convenience, the importer can also read `C:\Users\syf\Desktop\api.txt` when it contains `KEY_NAME:API_KEY`. The key is used in memory only; reports store only masked credential status.

## Audit Command

```bash
npm run audit:all
```

The audit checks importer files, report readability, directory existence, sensitive field leakage, and whether recommendations still produce 5 products.

## Supported Field Aliases

| Target field | CSV aliases |
|---|---|
| `asin` | `ASIN`, `asin`, `Product ASIN` |
| `parent_asin` | `Parent ASIN`, `Parent`, `parent_asin` |
| `title` | `Title`, `Product Name`, `Name`, `Product` |
| `brand` | `Brand`, `brand` |
| `category` | `Category`, `category`, `Product Category` |
| `reference_price` | `Price`, `Current Price`, `Avg Price`, `Average Price` |
| `estimated_monthly_sales` | `Monthly Sales`, `Est. Sales`, `Estimated Sales`, `Sales` |
| `estimated_monthly_revenue` | `Monthly Revenue`, `Est. Revenue`, `Revenue` |
| `rating` | `Rating`, `Star Rating` |
| `review_count` | `Reviews`, `Review Count`, `Ratings` |
| `bsr` | `BSR`, `Rank`, `Sales Rank` |
| `jungle_scout_opportunity_score` | `Opportunity Score`, `Opportunity`, `Score` |
| `fulfillment_fee_estimate` | `FBA Fees`, `FBA Fee`, `Fees` |
| `net_profit_estimate` | `Net`, `Net Profit`, `Profit` |
| `weight` | `Weight` |
| `dimensions` | `Dimensions` |
| `seller_type` | `Seller`, `Seller Type` |

## Error Handling

- Missing ASIN rows are skipped and counted.
- Duplicate ASINs in the same import are deduplicated.
- Existing candidates are merged instead of blindly replaced.
- Existing notes, Keepa enrichment, and review analysis fields are preserved where possible.
- Before a real import, the current candidate pool is backed up under:

```text
data/product_research/backups/
```

## Data Safety

The importer scans rows and reports for sensitive terms:

```text
password
apiKey
secret
accessToken
refreshToken
cookie
session
```

If sensitive-looking fields appear, the importer records a warning. The browser workflow must not export or save credential/session data.
