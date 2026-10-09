# Cloud Cost Allocation Methodology (Task 3)

**Goal (from the brief):** write SQL against simulated Snowflake `ACCOUNT_USAGE` logs that attributes
credit consumption to individual reports, and calculate the unit cost per active user view.

The scripts are in [`sql/snowflake/`](../sql/snowflake/README.md). The same files run on Snowflake and on
PostgreSQL. In this repository they create the `cost.*` views that the Cost Allocation page and `/api/costs/*`
read, so the dashboard and the deliverable SQL cannot drift apart.

## 1. Why the logs are simulated, and how

The CSV has per-report, per-period totals (`snowflake_credits_consumed`, `query_count_last_30d`,
`monthly_active_views`, `aws_hosting_cost_usd`). It has **no** warehouse, hour or query detail, but real
`ACCOUNT_USAGE` views are at that grain. `pipeline/pic_pipeline/simulate_account_usage.py` therefore generates
query-level logs **from** the CSV. It uses a fixed seed, so the output is identical on every run. The column
names follow Snowflake's documented views.

| Simulated view | Grain | How it is derived |
|---|---|---|
| `QUERY_HISTORY` | one row per representative query batch (≈ 1 per 1,000 executions; ≥ 1 per report-month) → 25,830 rows | `QUERY_TAG = 'pure-insights:report=<id>'`; each report pinned to one of 3 warehouses; execution time follows the credits each batch burns at the warehouse's hourly rate, with lognormal jitter for concurrency |
| `QUERY_ATTRIBUTION_HISTORY` | one row per query | the report-month's CSV credits split across its batches in proportion to execution weight, so they **reconcile exactly** to the CSV. The 24 negative-credit report-months keep their negative values, so the injected defect exists at source |
| `WAREHOUSE_METERING_HISTORY` | warehouse × hour → 19,323 rows | valid (non-negative) attributed credits booked to the hour each batch starts, plus idle time at a fixed per-warehouse ratio (S 12 %, M 8 %, L 5 %). `CREDITS_ATTRIBUTED_COMPUTE_QUERIES` excludes idle, as in Snowflake |
| (ad-hoc work) | 600 untagged analyst queries ≈ 3 % of report credits | gives the suite unattributable spend to separate out |
| `PORTAL.REPORT_USAGE_MONTHLY` | report × month (2,000) | the portal's own facts: owner, views, peak users, AWS cost, credits as reported by the legacy export |
| `PORTAL.CREDIT_PRICING` | one row | `CREDIT_PRICE_USD` (default **$3.00**). Not in the data; this is an assumption standing in for `ORGANIZATION_USAGE.RATE_SHEET_DAILY` |

Simulated-only figures (idle, untagged spend, failed-query spend) are labelled as such wherever they are shown.
Every figure that traces back to the CSV reconciles to it exactly.

## 2. Attribution

### Method A: per-query attribution via `QUERY_TAG` (primary)

```sql
SELECT SPLIT_PART(query_tag, 'report=', 2) AS report_id,
       CAST(DATE_TRUNC('month', start_time) AS DATE) AS period_month,
       SUM(credits_attributed_compute)
FROM   account_usage.query_attribution_history
WHERE  <classified VALID>          -- see 02_anomaly_quarantine.sql
GROUP  BY 1, 2;
```

`QUERY_ATTRIBUTION_HISTORY` is Snowflake's concurrency-aware, per-query compute attribution. Summing it by the
tag the portal stamps on every dashboard query attributes credits to individual reports. It excludes warehouse
idle time.

### Method B: proportional allocation of the metered bill (cross-check)

This is the classic approach. Each warehouse-hour's `CREDITS_USED_COMPUTE` (the bill, idle included) is split
across the queries that ran in that hour by their share of `EXECUTION_TIME`. Untagged work goes to
`UNATTRIBUTED`, and metered hours with no queries are reported as unallocated idle. Method B allocates the
entire bill but is less precise per report, because execution time is only a proxy for credits under
concurrency. The per-report A vs B difference is shown on the Cost page.

## 3. Anomaly filtering (before any money is computed)

`02_anomaly_quarantine.sql` classifies every attribution row:

| Status | Rule | Rows | Treatment |
|---|---|---|---|
| `VALID` | tagged, known report, credits ≥ 0 | 24,934 | attributed |
| `NEGATIVE_CREDITS` | credits < 0 | 296 rows / 24 reports / **−161.04** credits | **quarantined**, not abs()'d (that would invent spend) and not zeroed (that would understate cost per view) |
| `UNTAGGED` | no portal tag | 600 | reported separately as unattributable |
| `UNKNOWN_REPORT` / `NULL_CREDITS` | tag for a report the portal doesn't know / NULL | 0 | quarantined |

## 4. Unit cost per active user view

```
snowflake_cost_per_view   = Method-A credits × credit_price ÷ monthly_active_views
aws_cost_per_view         = aws_hosting_cost_usd ÷ monthly_active_views
fully_loaded_cost_per_view = (Method-A credits × credit_price + aws_hosting_cost_usd) ÷ monthly_active_views
```

* **Zero views:** `NULLIF(monthly_active_views, 0)` makes the unit cost NULL, with status `ZERO_VIEWS` (4 report-months). It is never a divide-by-zero and never silently 0.
* **Quarantined credits:** the month's Snowflake unit cost is NULL (`CREDITS_QUARANTINED`, 24 report-months). Lifetime and portfolio ratios exclude those months from **both** the numerator and the denominator.
* Grains: report-month (`v_unit_cost_report_month`), report lifetime (`v_unit_cost_report`), portfolio (`v_unit_cost_portfolio`).

| Portfolio result (at $3/credit) | Value |
|---|---|
| Credits attributed to reports | 1,206,352.48 |
| Snowflake cost / active view | **$2.434** |
| AWS hosting cost / active view | **$0.307** |
| Fully loaded cost / active view | **$2.740** |
| Per-report fully loaded range | $1.83 – $4.99 (median $2.72) |

## 5. Discrepancies between active users and AWS cost (`07_…`)

* Pearson correlation of views vs AWS cost is **−0.027** (Spearman with tie-aware ranks −0.027; −0.083 at report grain). Hosting cost does not follow usage.
* `ZERO_VIEW_COST`: 4 report-months with cost and no views.
* `PEAK_EXCEEDS_VIEWS`: 93 report-months where peak concurrent users exceed monthly views, which is impossible, so the usage counters are unreliable there.
* `COST_PER_VIEW_OUTLIER`: AWS cost/view above **Q3 + 3×IQR = $2.064**. That is 135 report-months. `PERCENTILE_CONT` is the same linear interpolation pandas uses, so SQL and Python agree on all 135.

## 6. Reconciliation (`09_reconciliation_checks.sql`)

| # | Check | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Method A = source credits ≥ 0 | 1,206,352.48 | 1,206,352.48 | PASS |
| 2 | Quarantined = source negatives | −161.04 | −161.04 | PASS |
| 3 | Every report-month reconciles (±0.0001) | 0 mismatches | 0 | PASS |
| 4 | Method B + unallocated = metered compute | 1,344,783.71 | 1,344,783.71 | PASS |
| 5 | Metered query credits = all non-negative attribution | 1,242,543.05 | 1,242,543.05 | PASS |
| 6 | No unit cost on zero-view months | 0 | 0 | PASS |

`npm run verify` re-runs the suite and fails if any check is not `PASS`. The pytest suite also runs it against
the test database.

## 7. Assumptions

1. The 20 passes over the 100 reports are 20 consecutive monthly snapshots (2025-01 → 2026-08). The CSV has no timestamp.
2. The credit price is $3.00 (configurable).
3. Warehouse assignment, idle ratios, ad-hoc volume and execution-time jitter are simulation parameters. Only the per-report credits come from the data.
4. The query tag format `pure-insights:report=<id>` is a portal convention. On a live account it would be set per request (`ALTER SESSION SET QUERY_TAG`).
