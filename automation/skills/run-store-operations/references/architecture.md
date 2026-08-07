# Architecture

## Layers

1. Source adapters read workbooks without modifying them.
2. Normalizers convert identifiers and fields into deterministic forms.
3. Jobs orchestrate one bounded workflow.
4. SQLite persists runs, aliases, exceptions, and future approvals.
5. Reports and generated drafts are written under `runtime/`.
6. The Codex Skill selects commands and explains results.

## Job contract

Every job must:

- have a unique command and job name;
- create a run record before work starts;
- finish as `completed` or `failed`;
- be safe to retry;
- avoid source workbook mutations;
- write a structured report;
- emit reviewable exceptions instead of guessing;
- have representative automated tests.

## Planned jobs

- `audit-skus`: implemented.
- `build-inventory-dashboard-data`: implemented read-only operating dashboard adapter covering sales trend, advertising performance, inventory, replenishment and adjustable decision queues for `/inventory`.
- `sync-product-master`: consolidate product fields with provenance.
- `import-sales`: import platform transaction exports idempotently.
- `generate-purchase-order`: generate draft purchase orders from approved requests.
- `generate-shipment`: generate draft shipment and customs documents.
- `build-profit-report`: calculate monthly product profitability from imported facts.
