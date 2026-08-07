# Workflow roadmap

## Current first-edition bridge

`build-inventory-dashboard-data` is implemented as a read-only bridge while the normalized import jobs below are built. It discovers the latest FBA/AWD snapshots, joins the current product/carton master and sales baseline, applies the auditable replenishment rules, and writes `runtime/reports/inventory_dashboard.json` for the amazon-insight `/inventory` route. It does not replace the planned normalized inventory, sales, supply-order or shipment facts.

## Foundation

| Job | Trigger | Input | Output | Approval |
|---|---|---|---|---|
| `audit-skus` | Manual/daily | Configured workbooks | Alias map and exception queue | Review exceptions |
| `register-files` | Folder change | Business folders | File catalog and fingerprints | None |
| `sync-product-master` | After audit | Product, inventory, cost, customs, Listing | Field-level master with provenance | Confirm conflicts |
| `sync-supply-orders` | Order change | Purchase orders and status | Open supply quantities and dates | Confirm status |
| `sync-shipments` | Shipment change | Shipment records | In-transit quantities and ETA | Confirm milestones |

## Weekly cycle

| Job | Trigger | Input | Output | Approval |
|---|---|---|---|---|
| `import-inventory` | New weekly export | FBA and AWD exports | Dated inventory snapshot | Review unknown SKU |
| `build-demand-forecast` | After sales refresh or override | Sales history and seasonality | SKU-market daily forecast | Review low-confidence rows |
| `plan-fulfillment` | After inventory import | Snapshot, forecast, open supply, 75-day lead time | AWD transfer, sea, urgent and hold actions | Confirm quantities |
| `plan-purchases` | After fulfillment plan | Forecast, factory-ready stock, open orders | Purchase recommendations | Confirm quantity |
| `generate-shipment` | Approved action | SKU quantities and specs | Draft shipment/customs pack | Final approval |
| `generate-purchase-order` | Approved action | Supplier and product master | Draft purchase order | Final approval |

## Monthly cycle

| Job | Trigger | Input | Output | Approval |
|---|---|---|---|---|
| `import-sales` | New monthly export | Platform transactions/sales | Deduplicated daily and monthly facts | Review rejected rows |
| `import-advertising` | New monthly export | Campaign, product and search-term reports | Normalized ad facts | Review missing/duplicate month |
| `build-profit-report` | Imports complete | Sales, returns, costs, ads and fees | SKU-market profitability | Review reconciliation |
| `recommend-ad-actions` | Profit report complete | Ad facts, margins, inventory cover | Campaign and search-term actions | Final approval |
| `refresh-plans` | Monthly close complete | Updated sales and ad decisions | New forecast and weekly fulfillment plan | Review material changes |

## Dependency order

Implement in this order:

1. `register-files`
2. `sync-product-master`
3. `import-inventory`
4. `import-sales`
5. `sync-supply-orders` and `sync-shipments`
6. `build-demand-forecast`
7. `plan-fulfillment`
8. `plan-purchases`
9. document generators
10. advertising imports and recommendations

All planning jobs must consume shared normalized facts. They must not independently reinterpret source workbooks.
