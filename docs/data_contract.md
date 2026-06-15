# Amazon Growth Console Data Contract

This contract fixes the local MVP data boundaries before real providers are connected. JSON remains the readable snapshot format. SQLite is reserved for local state, approvals, logs, and history indexes.

Legend:

- Required: whether the field should exist on normalized records.
- Empty: whether `""`, `null`, or `[]` is acceptable.
- Display: whether the frontend may show the field.
- Scoring: whether recommendation or optimization logic may use the field.
- Audit: whether audit scripts should validate the field.

## store_product_profile_merged

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| sku | string | yes | no | Excel | Store product join key | yes | yes | yes | RV-001 |
| asin | string | yes | yes | Excel/API | Existing listing identity | no | yes | yes | B0STORE001 |
| parent_asin | string | yes | yes | Excel/API | Variation duplicate filter | no | yes | yes | B0PARENT01 |
| title_cn | string | yes | no | Excel | Product naming and type inference | yes | yes | yes | 房车减压阀 |
| amazon_title | string | yes | yes | API/manual | Listing title | yes | yes | no | RV regulator |
| brand | string | yes | yes | API/manual | Brand context | yes | no | no | Brand A |
| category_cn | string | yes | yes | Excel | Store category | yes | yes | yes | 房车配件 |
| product_type | string | yes | no | derived | Duplicate and expansion logic | yes | yes | yes | pressure_regulator |
| sub_scenario | string | yes | no | derived | Scenario concentration | yes | yes | yes | water_pressure_control |
| current_price_usd | number | yes | yes | US cost/sales | Price band | yes | yes | yes | 34.99 |
| cost_usd | number | yes | yes | US cost | Profit estimate | no | yes | yes | 12.4 |
| estimated_profit_usd | number | yes | yes | US cost | Profit band | yes | yes | yes | 8.2 |
| estimated_profit_margin | number | yes | yes | US cost | Profit band | yes | yes | yes | 0.28 |
| monthly_sales_units | number | yes | yes | sales snapshot | Store strength | yes | yes | yes | 43 |
| inventory_units | number | yes | yes | sales snapshot | Inventory risk | yes | yes | yes | 120 |
| product_weight_g | number | yes | yes | Excel | Size risk | no | yes | no | 380 |
| gross_weight_kg | number | yes | yes | Excel/US cost | Size risk | yes | yes | yes | 0.8 |
| carton_volume_cbm | number | yes | yes | Excel/US cost | Size risk and FBA exposure | yes | yes | yes | 0.03 |
| packaging | string | yes | yes | Excel | Operational context | yes | no | no | carton |
| competitor_asin | string | yes | yes | US cost | Reference competitor | yes | no | no | B0COMP001 |
| keywords | array | yes | yes | derived | Similarity and search matching | no | yes | yes | ["rv","valve"] |
| price_band | string | yes | no | derived | Store profile | yes | yes | yes | 20_80 |
| profit_band | string | yes | no | derived | Store profile | yes | yes | yes | medium |
| size_risk | string | yes | no | derived | Risk scoring | yes | yes | yes | low |
| store_existing_product | boolean | yes | no | derived | Existing product exclusion | no | yes | yes | true |

## store_profile_summary

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| marketplace | string | yes | no | script | Store profile marketplace | yes | yes | yes | US |
| total_products | number | yes | no | script | Profile size | yes | no | yes | 86 |
| main_categories | array | yes | yes | script | Category strengths | yes | yes | yes | ["房车配件"] |
| main_product_types | array | yes | yes | script | Type strengths | yes | yes | yes | ["valve"] |
| main_sub_scenarios | array | yes | yes | script | Scenario strengths | yes | yes | yes | ["flow_control"] |
| price_band_distribution | object | yes | yes | script | Price profile | yes | yes | yes | {"20_80": 50} |
| profit_band_distribution | object | yes | yes | script | Profit profile | yes | yes | yes | {"medium": 20} |
| size_risk_distribution | object | yes | yes | script | Size profile | yes | yes | yes | {"low": 40} |
| top_profit_product_types | array | yes | yes | script | Expansion scoring | yes | yes | yes | ["connector"] |
| low_profit_product_types | array | yes | yes | script | Caution list | yes | yes | yes | ["cover"] |
| high_inventory_low_sales_products | array | yes | yes | script | Risk notes | yes | yes | yes | [{"sku":"A"}] |
| strong_store_scenarios | array | yes | yes | script | Store fit | yes | yes | yes | ["garden_watering"] |
| weak_store_scenarios | array | yes | yes | script | Avoidance hints | yes | yes | yes | ["large_storage"] |
| recommended_expansion_themes | array | yes | yes | script | Expansion themes | yes | yes | yes | ["RV water adjacent"] |
| risk_notes | array | yes | yes | script | Warnings | yes | no | yes | ["High inventory"] |

## store_exclusion_rules

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| marketplace | string | yes | no | script | Rule scope | no | yes | yes | US |
| asin_set | array | yes | yes | script | Exact ASIN exclusion | no | yes | yes | ["B0STORE001"] |
| parent_asin_set | array | yes | yes | script | Parent ASIN exclusion | no | yes | yes | ["B0PARENT01"] |
| product_type_set | array | yes | yes | script | Core type exclusion | no | yes | yes | ["pressure_regulator"] |
| keyword_profiles | array | yes | yes | script | Near duplicate filter | no | yes | yes | [{"sku":"A","keywords":["rv"]}] |
| cosmetic_difference_terms | array | yes | yes | static/script | Minor variant detection | no | yes | yes | ["color","size"] |

## store_expansion_opportunities

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| marketplace | string | yes | no | script | Expansion scope | yes | yes | yes | US |
| opportunities | array | yes | yes | script | Expansion themes | yes | yes | yes | [] |
| opportunities[].theme_id | string | yes | no | script | Theme identity | yes | yes | yes | rv_water_adjacent |
| opportunities[].label | string | yes | no | script | Theme label | yes | yes | yes | RV water adjacent |
| opportunities[].target_product_types | array | yes | yes | script | Candidate matching | no | yes | yes | ["filter"] |
| opportunities[].target_sub_scenarios | array | yes | yes | script | Candidate matching | no | yes | yes | ["water_filtration"] |
| opportunities[].rationale | string | yes | yes | script | Explanation | yes | no | no | Adjacent to store strengths |

## candidate_product

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| asin | string | yes | yes | manual/Keepa/API | Product identity | yes | yes | yes | B0ABC12345 |
| parent_asin | string | yes | yes | manual/API | Variation duplicate filter | no | yes | yes | B0PARENT12 |
| idea_id | string | no | yes | script | Product idea identity | yes | yes | yes | IDEA-001 |
| candidate_level | string | yes | no | script | ASIN or idea | yes | yes | yes | asin_product |
| title | string | yes | no | manual/API | Display and similarity | yes | yes | yes | Garden Hose Connector |
| brand | string | yes | yes | manual/API | Listing context | yes | no | no | Brand A |
| category | string | yes | yes | manual/API | Category context | yes | yes | yes | Garden |
| product_type | string | yes | no | derived/manual | Duplicate and scoring | yes | yes | yes | hose_connector |
| sub_scenario | string | yes | no | derived/manual | Scenario cap | yes | yes | yes | connection_fitting |
| reference_price | number | yes | yes | manual/API | Price rules | yes | yes | yes | 29.99 |
| estimated_monthly_sales | number | yes | yes | manual/API | Sales rule | yes | yes | yes | 120 |
| sales_confidence | string | yes | yes | manual/API | Data quality | yes | yes | yes | medium |
| rating | number | no | yes | manual/API | Market signal | yes | yes | no | 4.4 |
| review_count | number | no | yes | manual/API | Competition signal | yes | yes | yes | 420 |
| bsr | number | no | yes | manual/API | Demand signal | no | yes | no | 12000 |
| recommendation_sources | array | yes | yes | script/manual | Source badges | yes | yes | yes | ["market_opportunity"] |
| store_fit | string | yes | no | script | Store fit badge | yes | yes | yes | high |
| opportunity_type | string | yes | no | script | Opportunity label | yes | yes | yes | current_opportunity |
| timing_window | string | yes | no | script | Seasonality timing | yes | yes | yes | early_layout |
| seasonal_attribute | string | yes | yes | script | Timing explanation | yes | yes | no | Winter window |
| market_score | number | yes | no | script/manual | Total score input | no | yes | yes | 20 |
| seasonality_score | number | yes | no | script/manual | Total score input | no | yes | yes | 12 |
| store_fit_score | number | yes | no | script/manual | Total score input | no | yes | yes | 18 |
| profit_potential_score | number | yes | no | script/manual | Total score input | no | yes | yes | 16 |
| risk_score | number | yes | no | script/manual | Total score input | no | yes | yes | 6 |
| keywords | array | yes | yes | manual/derived | Similarity and search matching | no | yes | yes | ["hose","quick"] |

## daily_recommendation

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| date | string | yes | no | script | Daily snapshot date | yes | no | yes | 2026-05-22 |
| marketplace | string | yes | no | script | Scope | yes | no | yes | Amazon US |
| recommendations | array | yes | no | recommender | Final top 5 | yes | no | yes | [] |
| summary | object | yes | yes | recommender | Brief metrics | yes | no | yes | {"final_count":5} |
| debug | object | yes | yes | recommender | Audit diagnostics | no | no | yes | {"over_80_selected_count":0} |

## asin_screening_result

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| asin | string | yes | no | input | Screened product | yes | yes | yes | B0ABC12345 |
| mode | string | yes | no | app | sample, candidate, or data_missing | yes | no | yes | data_missing |
| label | string | yes | yes | app | UI label | yes | no | no | Data missing |
| product | object | yes | yes | app/provider | Product snapshot | yes | yes | yes | {} |
| analysis | object | yes | yes | app/provider | Screening judgment | yes | yes | yes | {} |
| queue_record | object | no | yes | app | Missing data queue link | yes | no | yes | {} |

## watchlist_item

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| asin | string | yes | yes | user action | Product identity | yes | yes | yes | B0ABC12345 |
| title | string | yes | no | recommendation | Watchlist display | yes | no | yes | Hose Connector |
| status | string | yes | no | user action | Active/removed state | yes | yes | yes | watching |
| reason_added | string | yes | yes | user action | User context | yes | yes | no | interested |
| added_at | string | yes | no | app | Audit timestamp | yes | no | yes | 2026-05-25T00:00:00Z |
| next_check_date | string | no | yes | app | Seasonal follow-up | yes | yes | yes | 2026-06-24 |

## feedback_record

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| asin | string | yes | yes | user action | Product identity | yes | yes | yes | B0ABC12345 |
| title | string | yes | no | recommendation | Feedback context | yes | no | yes | Hose Connector |
| action | string | yes | no | user action | Calibration signal | yes | yes | yes | rejected |
| reason | string | yes | yes | user action | Rejection reason | yes | yes | yes | too_competitive |
| timestamp | string | yes | no | app | Audit timestamp | no | no | yes | 2026-05-25T00:00:00Z |
| product_type | string | yes | yes | recommendation | Calibration dimension | no | yes | yes | connector |
| category | string | yes | yes | recommendation | Calibration dimension | no | yes | no | Garden |
| sub_scenario | string | yes | yes | recommendation | Calibration dimension | no | yes | yes | connection_fitting |
| reference_price | number | yes | yes | recommendation | Calibration dimension | no | yes | no | 29.99 |
| recommendation_sources | array | yes | yes | recommendation | Calibration dimension | no | yes | yes | ["store_expansion"] |

## ad_raw_report

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| report_type | string | yes | no | upload/mock/API | Report family | yes | yes | yes | search_term_report |
| source_file | string | yes | yes | upload/mock | Traceability | yes | no | yes | input/ads_reports/a.csv |
| rows | array | yes | yes | upload/mock/API | Original rows | no | yes | yes | [] |

## ad_cleaned_report

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| report_type | string | yes | no | cleaning | Report family | yes | yes | yes | search_term_report |
| date_range_start | string | yes | yes | cleaning | Time scope | yes | no | yes | 2026-05-01 |
| date_range_end | string | yes | yes | cleaning | Time scope | yes | no | yes | 2026-05-15 |
| campaign_name | string | yes | yes | cleaning | Campaign context | yes | yes | yes | SP Garden |
| ad_group_name | string | yes | yes | cleaning | Ad group context | yes | yes | yes | Exact |
| targeting | string | yes | yes | cleaning | Target or keyword | yes | yes | yes | hose connector |
| match_type | string | yes | yes | cleaning | Match type | yes | yes | no | exact |
| customer_search_term | string | yes | yes | cleaning | Search term | yes | yes | yes | garden hose quick connect |
| impressions | number | yes | no | cleaning | Metric | yes | yes | yes | 1000 |
| clicks | number | yes | no | cleaning | Metric | yes | yes | yes | 20 |
| spend | number | yes | no | cleaning | Metric | yes | yes | yes | 12.4 |
| sales | number | yes | no | cleaning | Metric | yes | yes | yes | 60 |
| orders | number | yes | no | cleaning | Metric | yes | yes | yes | 3 |
| acos | number/null | yes | yes | derived | Efficiency | yes | yes | yes | 0.2067 |
| cpc | number/null | yes | yes | derived | Bid signal | yes | yes | yes | 0.62 |
| conversion_rate | number/null | yes | yes | derived | Conversion signal | yes | yes | yes | 0.15 |
| source_file | string | yes | yes | cleaning | Traceability | yes | no | yes | input/ads_reports/a.csv |

## ad_recommendation

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| recommendation_id | string | yes | no | engine | Action identity | yes | no | yes | REC-001 |
| recommendation_type | string | yes | no | engine/LLM | Grouping | yes | yes | yes | bid_adjustment |
| suggested_action | string | yes | no | engine/LLM | Action type | yes | yes | yes | decrease_keyword_bid |
| suggested_change_pct | number | no | yes | engine | Risk capped change | yes | yes | yes | -0.15 |
| reason | string | yes | yes | engine/LLM | Explanation | yes | no | yes | High ACOS |
| risk_level | string | yes | no | risk control | Approval requirement | yes | yes | yes | medium |
| requires_approval | boolean | yes | no | risk control | Manual approval gate | yes | yes | yes | true |

## ad_action_payload

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| action_id | string | yes | no | action service | Payload identity | yes | no | yes | MOCK-ACT-001 |
| recommendation_id | string | yes | no | action service | Recommendation link | yes | no | yes | REC-001 |
| action_type | string | yes | no | action service | Intended operation | yes | no | yes | add_negative_exact |
| payload | object | yes | yes | action service | Future API body | no | no | yes | {} |
| dry_run | boolean | yes | no | action service | Safety flag | yes | no | yes | true |

## ad_adjustment_log

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| adjustment_id | string | yes | no | approval/action | Log identity | yes | no | yes | ADJ-001 |
| recommendation_id | string | yes | no | approval/action | Source recommendation | yes | no | yes | REC-001 |
| status | string | yes | no | approval/action | Execution state | yes | no | yes | queued_for_execution |
| request_payload_path | string | yes | yes | action service | Traceability | no | no | yes | data/ads/action_payloads/requests/A.json |
| response_payload_path | string | yes | yes | action service | Traceability | no | no | yes | data/ads/action_payloads/responses/A.json |
| created_at | string | yes | no | action service | Audit timestamp | yes | no | yes | 2026-05-25T00:00:00Z |

## ad_review_result

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| action_id | string | yes | no | review service | Action link | yes | no | yes | MOCK-ACT-001 |
| result_status | string | yes | no | review service | Outcome | yes | yes | yes | effective |
| before_window | object | yes | yes | review service | Baseline metrics | yes | yes | yes | {} |
| after_window | object | yes | yes | review service | Post metrics | yes | yes | yes | {} |
| summary | string | yes | yes | review service | Human summary | yes | no | yes | ACOS improved |

## llm_input

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| taskType | string | yes | no | app/service | LLM task route | no | no | yes | ads_optimization |
| input | object | yes | yes | app/service | Prompt payload | no | yes | yes | {} |
| provider | string | yes | no | provider | Provider name | no | no | yes | mock |
| model | string | yes | yes | provider | Model identity | no | no | yes | local_mock |
| created_at | string | yes | no | provider | Audit timestamp | no | no | yes | 2026-05-25T00:00:00Z |
| source_data_reference | string | yes | yes | provider | Traceability | no | no | yes | data/ads/cleaned_reports |

## llm_output

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| taskType | string | yes | no | provider | LLM task route | no | no | yes | ads_optimization |
| output | object | yes | yes | provider | Parsed LLM result | no | yes | yes | {} |
| provider | string | yes | no | provider | Provider name | no | no | yes | mock |
| model | string | yes | yes | provider | Model identity | no | no | yes | local_mock |
| created_at | string | yes | no | provider | Audit timestamp | no | no | yes | 2026-05-25T00:00:00Z |
| error | string | yes | yes | provider | Failure details | no | no | yes | "" |

## enrichment_queue_item

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| asin | string | yes | no | ASIN screening/import | Enrichment identity | yes | no | yes | B0XXXXXXX |
| source | string | yes | no | app/script | Queue source | yes | no | yes | asin_screening |
| status | string | yes | no | app/script | Queue state | yes | no | yes | pending |
| created_at | string | yes | no | app/script | First seen timestamp | yes | no | yes | 2026-05-25T00:00:00Z |
| updated_at | string | yes | no | app/script | Latest update | yes | no | yes | 2026-05-25T00:00:00Z |
| notes | string | yes | yes | app/script | Operator notes | yes | no | no | Data missing |
| attempt_count | number | yes | no | enrichment job | Retry count | yes | no | yes | 0 |
| last_error | string | yes | yes | enrichment job | Failure reason | yes | no | yes | "" |
| provider | string | no | yes | enrichment job | Provider used for latest attempt | yes | no | yes | mock_keepa |
| enrichment | object | no | yes | Keepa/manual/API | Normalized enrichment payload | no | yes | yes | {"bsr":12000} |
| external_request_made | boolean | no | yes | provider | Safety audit flag | no | no | yes | false |

## keepa_queue_enrichment_report

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| generated_at | string | yes | no | script | Run timestamp | yes | no | yes | 2026-05-25T00:00:00Z |
| mode | string | yes | no | provider | Local or real provider mode | yes | no | yes | mock_keepa_queue_only |
| external_requests_made | number | yes | no | provider | Safety boundary | no | no | yes | 0 |
| input_queue_count | number | yes | no | script | Queue size | yes | no | yes | 3 |
| pending_before_count | number | yes | no | script | Workload before run | yes | no | yes | 2 |
| enriched_queue_count | number | yes | no | script | Enriched total after run | yes | yes | yes | 1 |
| failed_queue_count | number | yes | no | script | Failed total after run | yes | no | yes | 1 |
| updated_candidate_count | number | yes | no | script | Candidate pool updates | yes | yes | yes | 1 |
| processed_asins | array | yes | yes | script | Per-ASIN status | yes | no | yes | [{"asin":"B0ABC12345","status":"enriched"}] |
| note | string | yes | yes | script | Safety note | yes | no | no | No real Keepa API call was made. |

## jungle_scout_import_report

| Field | Type | Required | Empty | Source | Purpose | Display | Scoring | Audit | Example |
|---|---|---:|---:|---|---|---:|---:|---:|---|
| imported_at | string | yes | no | importer | Import timestamp | yes | no | yes | 2026-05-25T00:00:00Z |
| files_processed | array | yes | yes | importer | Source CSV list | yes | no | yes | ["input/browser_exports/jungle_scout/a.csv"] |
| raw_rows | number | yes | no | importer | Total parsed rows | yes | no | yes | 240 |
| imported_count | number | yes | no | importer | Deduped imported ASINs | yes | yes | yes | 218 |
| skipped_missing_asin | number | yes | no | importer | Rows skipped by missing ASIN | yes | no | yes | 5 |
| duplicate_asin_count | number | yes | no | importer | Same-batch duplicate count | yes | no | yes | 17 |
| merged_existing_count | number | yes | no | importer | Existing candidates updated | yes | yes | yes | 42 |
| new_candidate_count | number | yes | no | importer | New candidates added | yes | yes | yes | 176 |
| missing_title_count | number | yes | no | importer | Quality warning count | yes | no | yes | 2 |
| missing_price_count | number | yes | no | importer | Quality warning count | yes | yes | yes | 8 |
| missing_sales_count | number | yes | no | importer | Quality warning count | yes | yes | yes | 12 |
| warnings | array | yes | yes | importer | Non-blocking issues | yes | no | yes | ["Skipped row without valid ASIN"] |
| errors | array | yes | yes | importer | Blocking or file-level issues | yes | no | yes | [] |
