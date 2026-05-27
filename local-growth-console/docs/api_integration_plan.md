# API Integration Plan

This prototype stays local and static. No Amazon, Keepa, database, authentication, or scraping integration is active yet.

## Recommended Backend Shape

- Node.js / Express for the first backend because the current pipeline is Node-based.
- SQLite for local single-user persistence, then PostgreSQL or Supabase if multi-user access is required.
- Scheduled daily run through cron, GitHub Actions, or a server scheduled job.

## Backend Responsibilities

1. Store normalized store products and cost profiles.
2. Store candidate pools and generated store expansion candidates.
3. Run enrichment jobs for Keepa-like data, sales estimates, and review pain points.
4. Generate daily recommendations and recommendation history.
5. Persist feedback and watchlist records.
6. Keep API keys server-side only.

## API Key Rule

API keys must never be included in `index.html`, frontend JavaScript, or public JSON files. Enrichment must run in a local script or backend job.

## Migration Path

1. Keep the current JSON file pipeline as the source of truth.
2. Replace `data/keepa_enrichment_mock.json` with backend Keepa output.
3. Replace `data/review_samples_mock.json` with backend review summaries.
4. Move feedback and watchlist from `localStorage` to backend persistence.
5. Add scheduled execution for `npm run daily:recommendations`.

## Current Local Commands

```bash
npm run daily:recommendations
npm run audit:recommendations
npm run export:daily-report
```
