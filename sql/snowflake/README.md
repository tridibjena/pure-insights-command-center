# Snowflake Cloud Cost Allocation — SQL Script Suite

Attributes Snowflake credit consumption to individual Pure Insights reports and computes the unit cost per
active user view. It runs against simulated `ACCOUNT_USAGE` logs. Methodology, figures and assumptions are in
[`docs/COST_ALLOCATION_METHODOLOGY.md`](../../docs/COST_ALLOCATION_METHODOLOGY.md).

| Script | Creates | Purpose |
|---|---|---|
| `00_bootstrap_simulation_snowflake.sql` | DB `PURE_INSIGHTS_SIM`, tables, stage | **Snowflake only.** Loads the simulated logs exported to `data/simulated/*.csv` |
| `01_source_profiling.sql` | — | Coverage, untagged queries, failed queries, negative attributions |
| `02_anomaly_quarantine.sql` | `cost.v_query_attribution_classified`, `v_quarantine_summary`, `v_failed_query_spend` | Classifies every credit as VALID / NEGATIVE_CREDITS / UNTAGGED / UNKNOWN_REPORT |
| `03_attribution_query_tag.sql` | `v_report_month_credits_method_a`, `v_report_credits_method_a` | **Method A**: per-query attribution by `QUERY_TAG` |
| `04_attribution_metering_proportional.sql` | `v_query_hour_share`, `v_report_month_credits_method_b`, `v_metering_unallocated`, `v_attribution_method_comparison`, `v_warehouse_idle` | **Method B**: hourly metered bill allocated by execution-time share; idle analysis |
| `05_unit_cost_per_active_view.sql` | `v_unit_cost_report_month`, `v_unit_cost_report`, `v_unit_cost_portfolio`, `v_unit_cost_price_sensitivity` | Snowflake, AWS and fully loaded cost per active view; zero-view and quarantine safe; unit cost at Standard / Enterprise / Business Critical list prices |
| `06_orphaned_cost_exposure.sql` | `v_orphaned_cost_exposure`, `v_orphaned_cost_summary` | Spend with no accountable owner |
| `07_aws_cost_vs_usage_discrepancy.sql` | `v_aws_cost_per_view_fence`, `v_aws_usage_discrepancy(_summary)`, `v_aws_usage_correlation` | Usage vs AWS cost discrepancies (IQR fence, zero views, peak > views, Pearson/Spearman) |
| `08_chargeback_and_ranking.sql` | `v_chargeback_owner(_month)`, `v_report_cost_ranking`, `v_report_cost_mom`, `v_cost_trend_month` | Chargeback, ranking, decommission candidates, month-over-month change |
| `09_reconciliation_checks.sql` | `v_reconciliation_checks` | Six invariants. Every row must be `PASS` |

## Portability

Scripts 01–09 use one ANSI subset: CTEs, window functions, `PERCENTILE_CONT … WITHIN GROUP`, `CORR`,
`SPLIT_PART`, `NULLIF`, `DATE_TRUNC`, and `CAST(… AS NUMERIC(p,s))`. They avoid PostgreSQL-only syntax (`::`,
`FILTER`, `ILIKE`) and Snowflake-only syntax (`QUALIFY`, `IFF`, `FLATTEN`). A pytest guard
(`test_suite_is_portable_subset`) fails if any of those tokens appear. Unqualified schemas (`account_usage`,
`portal`, `cost`) resolve inside the current database on both engines.

## Run on PostgreSQL (this repository)

```bash
npm run verify        # rebuilds the cost.* views from 01-09 and asserts every reconciliation check
```

## Run on Snowflake (simulated data)

```bash
npm run pipeline      # also exports data/simulated/*.csv
snowsql -f sql/snowflake/00_bootstrap_simulation_snowflake.sql   # after the PUT shown in the script
# then, in PURE_INSIGHTS_SIM with ALTER SESSION SET TIMEZONE = 'UTC':
snowsql -d PURE_INSIGHTS_SIM -f sql/snowflake/01_source_profiling.sql   # … through 09
```

### Verified as Snowflake SQL

```bash
npm run verify:snowflake      # or: cd pipeline && .venv/bin/python -m pic_pipeline.cli snowflake
```

1. **Parse.** Every statement in `00–09` parses as Snowflake SQL with `sqlglot`.
2. **Execute.** The suite runs in Snowflake dialect on [fakesnow](https://github.com/tekumara/fakesnow), a Snowflake
   emulator backed by DuckDB. `00`'s DDL builds `PURE_INSIGHTS_SIM`, the exported logs are loaded, `01–09` execute, and all 6
   reconciliation checks pass with figures identical to PostgreSQL. The emulator has no stages and no `ALTER SESSION`, so
   `00`'s `PUT`/`COPY INTO` are replaced by a bulk load there. Both are covered by the live run below.
3. **Live.** `python -m pic_pipeline.cli snowflake-live` runs the complete script, including `PUT` and `COPY INTO`, against a real account
   when `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER` and `SNOWFLAKE_PASSWORD` (optionally `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_ROLE`) are set.
   This needs an account, for example a free trial, and is the only step not yet run.

## Run against a live Snowflake account

`SNOWFLAKE.ACCOUNT_USAGE` is read-only, so create a shim schema with the same names in your own database and run
01–09 there:

```sql
CREATE SCHEMA IF NOT EXISTS ANALYTICS.ACCOUNT_USAGE;
CREATE OR REPLACE VIEW ANALYTICS.ACCOUNT_USAGE.QUERY_HISTORY              AS SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY;
CREATE OR REPLACE VIEW ANALYTICS.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY  AS SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY;
CREATE OR REPLACE VIEW ANALYTICS.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY AS SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY;
-- plus PORTAL.REPORT_USAGE_MONTHLY (the portal's usage facts) and PORTAL.CREDIT_PRICING
```

This requires the portal to set `QUERY_TAG = 'pure-insights:report=<REPORT_ID>'` on every dashboard query.
