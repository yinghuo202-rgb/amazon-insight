# Replenishment and advertising design

## Scope

Build one shared decision system for weekly inventory actions and monthly sales/advertising refreshes. Keep recommendations separate from approved actions and generated documents.

## Inventory positions

Store quantities by `snapshot_date`, `market`, `sku`, `location`, and `status`.

- FBA `sellable`: immediately available for demand.
- FBA `reserved_transfer` and `reserved_processing`: track separately; do not count as sellable.
- AWD `available`: upstream stock that may be transferred to FBA.
- AWD `outbound_to_fba`: confirmed transfer in progress.
- AWD `inbound`: stock not yet available; require an availability date.
- Sea/air `in_transit`: shipment line with ship date, ETA, actual arrival and status.
- Factory `ready`: quantity available to allocate to a new shipment.
- Purchase order `open`: ordered but not ready; require production-ready date.

Use the FBA export as the authority for FBA quantities. Use the FBA value embedded in the AWD export only as a reconciliation check to avoid double counting.

## Forecast

Calculate at `market + base_sku` level.

1. Build daily/monthly sales facts from platform exports.
2. Calculate a configurable recency-weighted baseline from the latest complete months.
3. Apply bounded trend and seasonality factors when sufficient history exists.
4. Apply explicit promotion/new-product overrides.
5. Mark stockout-distorted history and low-data forecasts for review.

Persist forecast components, version, confidence, and effective date. Do not store only the final number.

## 75-day fulfillment model

Keep these parameters configurable by market and route:

- ocean lead time: default 75 days;
- review cycle: default 7 days;
- target cover after arrival;
- safety-stock days or service-level method;
- receiving buffer;
- carton quantity, MOQ and route capacity.

For each SKU:

1. Calculate projected demand through ETA.
2. Calculate inventory expected to be available before ETA without double counting.
3. Calculate desired stock at ETA for target cover plus safety stock.
4. Recommend `max(0, demand_through_eta + target_stock_at_eta - eligible_inventory_position)`.
5. Round to carton quantity and apply MOQ/capacity limits.
6. Limit a shipment recommendation by factory-ready quantity.

Classify the action:

- `AWD_TRANSFER`: FBA is low but AWD can cover the gap.
- `SEA_SHIP`: sea can arrive before projected stockout or within approved risk tolerance.
- `URGENT_AIR_OR_TRANSFER`: projected stockout occurs before the 75-day sea ETA.
- `PURCHASE_REQUIRED`: factory-ready and open-order supply are insufficient.
- `HOLD_EXCESS`: inventory cover exceeds the configured ceiling.
- `REVIEW_DATA`: forecast or inventory inputs are missing/low confidence.

## Purchase planning

Do not mix purchase quantity with shipment quantity.

- Shipment planning allocates factory-ready goods to FBA/AWD.
- Purchase planning covers supplier production lead time plus transport lead time and target cover.
- Track ordered, produced, allocated, shipped, received and canceled quantities per purchase-order line.

## Advertising recommendations

Join campaigns to base SKU, market, product margin, forecast, and inventory cover.

Calculate:

- spend, sales, orders, clicks, impressions, CTR, CVR, CPC, ACOS and ROAS;
- contribution margin before ads;
- break-even ACOS and configurable target ACOS;
- stock-cover guardrail and stockout date;
- month-over-month changes.

Suggested rule classes:

- `PAUSE_STOCK_RISK`: profitable or not, expected stockout is too close.
- `REDUCE_BID_OR_BUDGET`: enough clicks/spend but ACOS exceeds break-even/target.
- `INCREASE_BUDGET`: profitable conversion, budget constrained, and inventory is healthy.
- `NO_ORDER_REVIEW`: spend exceeds configurable CPA multiple with zero orders.
- `SEARCH_TERM_NEGATIVE_REVIEW`: poor search term with sufficient evidence.
- `EXPAND_WINNER`: strong CVR and ACOS with adequate inventory.
- `NO_CHANGE_LOW_DATA`: insufficient clicks/spend.

Never apply ad changes directly in phase one. Generate the current value, proposed value, reason, evidence window, confidence, and approval status.

Campaign reports support campaign-level budget/status recommendations. Search-term and advertised-product reports are required for negative keywords, target-level bids, and SKU attribution.

## Data-quality gates

- Identify a report month from internal start/end dates, not download filename.
- Reject duplicate market-month-report-type imports unless the content fingerprint matches exactly.
- Require both FBA and AWD snapshot dates to align within the configured tolerance.
- Reject stale inventory snapshots.
- Reconcile FBA values between FBA and AWD reports without summing them.
- Block final documents when SKU, carton quantity, supplier, route or quantity is unresolved.

## Outputs

Generate operational views from normalized data:

1. Weekly action queue: SKU, market, action, quantity, stockout date, ETA and reason.
2. Fulfillment plan: AWD transfers, sea shipments, urgent actions and holds.
3. Purchase plan: recommended quantity, supplier, ready date and order status.
4. Advertising action queue: campaign/search term, current metrics, proposal and evidence.
5. Exception queue: missing mappings, stale data, duplicates and reconciliation failures.
6. Approved document pack: purchase orders, shipment lists, customs documents and upload templates.
