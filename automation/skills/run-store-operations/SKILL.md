---
name: run-store-operations
description: Run the local store operations automation for spreadsheet-based SKU synchronization, identifier mapping, exception audits, purchase and shipment workflows, and repeatable operational reporting. Use when Codex is asked to audit store workbooks, sync operational data, inspect automation status, explain exceptions, or extend the local operations jobs without relying on long conversation history.
---

# Run Store Operations

Use the persisted project configuration and CLI as the source of truth. Do not reconstruct business state from prior conversation turns.

## Run a workflow

1. Read `../../../AGENTS.md` and obey its safety boundaries.
2. Run `scripts/run.ps1 status` before a mutation-capable workflow.
3. Use the narrowest registered command for the request.
4. Read the generated JSON report and query the exception queue before summarizing.
5. Never overwrite source workbooks; produce drafts under `runtime/`.

Commands:

- `scripts/run.ps1 init`
- `scripts/run.ps1 audit-skus`
- `scripts/run.ps1 build-inventory-dashboard-data`
- `scripts/run.ps1 status`

## Extend the automation

Read `references/architecture.md` before adding a job. Add deterministic work under `src/store_ops/jobs/`, register its command in the CLI, persist run state, and emit structured exceptions. Add workbook paths and authority levels through `config/project.json`.

Read `references/source-authority.md` before changing SKU or field precedence. Treat ambiguous mappings as exceptions requiring review.

Read `references/workflow-roadmap.md` when selecting the next workflow to implement or changing task dependencies.

Read `references/replenishment-advertising-design.md` before implementing or running inventory planning, shipment recommendations, purchase planning, sales refreshes, or advertising adjustments.

## Guardrails

- Keep original business workbooks read-only.
- Store generated state only in `runtime/`.
- Require human confirmation for new SKU creation, mapping changes, prices, purchase orders, shipments, and Listing publication.
- Test deterministic rules before declaring a workflow reusable.
