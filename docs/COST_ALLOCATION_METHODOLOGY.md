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
| `QUERY_HISTORY` | one row per representative query batch (≈ 1 per 1,000 executions; ≥ 1 per report-month) → 25,230 rows | `QUERY_TAG = 'pure-insights:report=<id>'`; each report pinned to one of 3 warehouses; execution time follows the credits each batch burns at the warehouse's hourly rate. Failed and timed-out refreshes in the CSV leave a failed batch (`000630` statement timeout / `002003` missing object) |
| `QUERY_ATTRIBUTION_HISTORY` | one row per query | the report-month's CSV credits split across its batches in proportion to execution weight, so they **reconcile exactly** to the CSV. The 24 negative-credit report-months keep their negative values, so the injected defect exists at source |
| `WAREHOUSE_METERING_HISTORY` | warehouse × hour → 18,999 rows | valid (non-negative) attributed credits booked to the hour each batch starts. `CREDITS_ATTRIBUTED_COMPUTE_QUERIES` excludes idle, as in Snowflake |
| `PORTAL.REPORT_USAGE_MONTHLY` | report × month (2,000) | the portal's own facts: owner, views, peak users, AWS cost, credits as reported by the legacy export |
| `PORTAL.CREDIT_PRICING` | one row | `CREDIT_PRICE_USD` = **$3.00**, Snowflake's on-demand list price for Enterprise edition on AWS US East (stand-in for `ORGANIZATION_USAGE.RATE_SHEET_DAILY`) |

**The simulated layer adds no spend of its own.** The CSV carries no evidence of warehouse idle time, untagged ad-hoc
work or concurrency effects, so none is invented. Every cost figure therefore traces back to the CSV, and Method A and
Method B agree to within ±0.07 % per report. The only difference comes from hours where a quarantined negative-credit
batch shares the warehouse. The SQL still measures idle time (`v_warehouse_idle`), untagged spend (the `UNTAGGED`
quarantine class) and A/B divergence. `test_suite_measures_idle_untagged_and_method_divergence_when_present` switches
those effects on (`SimulationKnobs`: 8 % idle, 3 % untagged, execution-time jitter) and checks the SQL detects all three
while every reconciliation check still passes.

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
concurrency. On a live account the per-report A vs B gap (shown on the Cost page) measures that imprecision plus each
report's share of idle time. On this dataset the gap is ≤ 0.07 %, because the CSV implies neither.

## 3. Anomaly filtering (before any money is computed)

`02_anomaly_quarantine.sql` classifies every attribution row:

| Status | Rule | Rows | Treatment |
|---|---|---|---|
| `VALID` | tagged, known report, credits ≥ 0 | 24,934 | attributed |
| `NEGATIVE_CREDITS` | credits < 0 | 296 rows / 24 reports / **−161.04** credits | **quarantined**, not abs()'d (that would invent spend) and not zeroed (that would understate cost per view) |
| `UNTAGGED` | no portal tag | 0 here (600 when switched on in tests) | reported separately as unattributable |
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

> **Why $2.434 + $0.307 is not $2.740.** The gap is only $0.001, a rounding-level difference, but it comes from the
> denominators rather than from rounding. A unit cost is only meaningful when cost and views cover the same months.
> The 24 quarantined report-months have no valid Snowflake cost, so counting their views would spread the remaining
> spend over views it did not pay for and understate the cost per view. The Snowflake and fully loaded figures therefore
> both use the 1,486,905 views in months with valid credits, and the fully loaded AWS component over those months is
> $0.306: $2.434 + $0.306 = $2.740 (2.7401 before rounding). The standalone AWS row can use every month, because AWS
> cost has no quarantined values: $0.307 over all 1,503,281 views. Adding the two standalone rows gives $2.741, which
> mixes two denominators and is not the cost per view of any set of months.

**Price sensitivity** (`v_unit_cost_price_sensitivity`, on-demand list prices, AWS US East):

| Edition | $/credit | Snowflake $/view | Fully loaded $/view |
|---|---|---|---|
| Standard | $2.00 | $1.623 | $1.929 |
| Enterprise *(in use)* | $3.00 | $2.434 | $2.740 |
| Business Critical | $4.00 | $3.245 | $3.551 |

> **Statistical caveat.** Report identity explains none of the variance in this dataset (permutation ANOVA p = 0.14–0.88;
> see forensic check 2). The per-report range and rankings demonstrate the method; the portfolio figures are robust.

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
| 4 | Method B + unallocated = metered compute | 1,206,352.48 | 1,206,352.48 | PASS |
| 5 | Metered query credits = all non-negative attribution | 1,206,352.48 | 1,206,352.48 | PASS |
| 6 | No unit cost on zero-view months | 0 | 0 | PASS |

`npm run verify` re-runs the suite on PostgreSQL and fails if any check is not `PASS`. `npm run verify:snowflake`
parses every statement as Snowflake SQL and executes the suite in Snowflake dialect on the fakesnow emulator. All six
checks pass there with figures identical to PostgreSQL. Both runs are part of the pytest suite. `python -m
pic_pipeline.cli snowflake-live` runs the same verification on a real account when `SNOWFLAKE_*` credentials are set.

## 7. Inputs and how each is grounded

1. **Timeline.** The 20 passes are consecutive monthly snapshots. This is tested: lag-1 autocorrelation of the 30-day metrics is ≈ 0, where rolling daily windows would give ≈ +0.97. They are anchored to the last complete month before the data was received: Feb 2025 → Sep 2026 (`DATA_AS_OF_MONTH`).
2. **Credit price.** $3.00 is Snowflake's on-demand list price for Enterprise edition on AWS US East; Standard is $2.00 and Business Critical $4.00. All three appear in `v_unit_cost_price_sensitivity`.
3. **Simulation structure.** Warehouse assignment, batch sampling and start times only shape the logs; they do not change any reported figure. Idle time, untagged work and jitter are 0 because the CSV carries no evidence of them.
4. **Query tag.** The format `pure-insights:report=<id>` is a portal convention. On a live account it would be set per request (`ALTER SESSION SET QUERY_TAG`).
