# Source authority

Use field-level provenance. No workbook is authoritative for every field.

## Initial SKU authority

Canonical SKU membership is the union of product details, new-product progress, customs names, US and CA cost tables, and US and CA inventory tables.

Listing, shipment, purchase-order text, and monthly reports are observation sources. A SKU seen only in an observation source must enter the exception queue as `sku_not_in_master`.

## Identifier rules

- Normalize two letters plus three digits, such as `MA014`.
- Extract the base SKU from platform values such as `amzn.gr.MA014-...`.
- Extract SKU from business text such as `我司型号：MD068`.
- Preserve raw values as aliases with source and confidence.
- Treat a single FNSKU linked to multiple active SKUs as a high-severity conflict.
- Allow an active and explicitly retired (`作废`) SKU to retain the same historical FNSKU, but report it as a low-severity retired alias.
