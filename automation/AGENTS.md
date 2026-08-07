# Store Operations Automation

Work through the deterministic CLI before writing ad-hoc data scripts.

## Safety boundaries

- Treat every workbook outside `automation/runtime/` as read-only source material.
- Never overwrite, rename, move, or delete source workbooks.
- Write generated artifacts only under `automation/runtime/`.
- Default business documents to `draft`; require explicit human confirmation before final output.
- Record every run and exception in the local SQLite state database.
- Do not use conversation history as business state. Read configuration and persisted run state each time.
- Keep calculations and identifier normalization deterministic and covered by tests.

## Standard commands

- Initialize: `powershell -ExecutionPolicy Bypass -File .\ops.ps1 init`
- Audit SKUs: `powershell -ExecutionPolicy Bypass -File .\ops.ps1 audit-skus`
- Build content and creative drafts: `powershell -ExecutionPolicy Bypass -File .\ops.ps1 build-content-workflow`
- Check status: `powershell -ExecutionPolicy Bypass -File .\ops.ps1 status`
- Run tests: `python -m unittest discover -s tests -v`

## Change policy

- Add new workflows as a job module under `src/store_ops/jobs/`.
- Add source workbooks through `config/project.json`; do not hardcode absolute business paths.
- Keep import adapters separate from business rules.
- Emit structured exceptions instead of silently guessing when a mapping is ambiguous.
