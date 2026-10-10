"""Generate docs/BUSINESS_FINDINGS.md — the strategic synthesis — from live query results."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from .config import CREDIT_PRICE_USD, DATA_AS_OF_MONTH, DOCS_DIR, FIRST_PERIOD, THRESHOLDS
from .db import connect, query_df


def _to_float(v: object) -> object:
    return float(v) if isinstance(v, Decimal) else v


def build(test: bool = False) -> str:
    t = THRESHOLDS
    with connect(test) as conn:
        q = lambda sql: query_df(conn, sql).map(_to_float)  # noqa: E731
        one = lambda sql: q(sql).iloc[0]  # noqa: E731
        ops = one(f"""
            SELECT COUNT(*) AS rows,
                   AVG(CASE WHEN is_latency_breach THEN 1.0 ELSE 0 END) AS breach_rate,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_load_time_sec) AS p50,
                   PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec) AS p95,
                   AVG(CASE WHEN is_refresh_failure THEN 1.0 ELSE 0 END) AS failure_rate,
                   SUM(CASE WHEN refresh_status = 'TIMED_OUT' THEN 1 ELSE 0 END) AS timed_out,
                   SUM(CASE WHEN refresh_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
                   AVG(CASE WHEN avg_load_time_sec > {t.latency_critical_above_sec} THEN 1.0 ELSE 0 END) AS critical_rate
            FROM app.report_observations""")
        latest = one("""
            SELECT COUNT(*) AS reports,
                   SUM(CASE WHEN is_latency_breach THEN 1 ELSE 0 END) AS breaching,
                   SUM(CASE WHEN is_refresh_failure THEN 1 ELSE 0 END) AS failing,
                   SUM(CASE WHEN is_orphaned THEN 1 ELSE 0 END) AS orphaned
            FROM app.report_observations WHERE snapshot_seq = (SELECT MAX(snapshot_seq) FROM app.report_observations)""")
        shape = one("""
            SELECT MIN(avg_load_time_sec) AS lat_min, MAX(avg_load_time_sec) AS lat_max,
                   MAX(snapshot_seq) AS snapshots,
                   SUM(CASE WHEN is_status_unknown THEN 1 ELSE 0 END) AS unknown
            FROM app.report_observations""")
        slow_fail = one("""
            SELECT AVG(CASE WHEN is_refresh_failure THEN avg_load_time_sec END) AS lat_fail,
                   AVG(CASE WHEN NOT is_refresh_failure THEN avg_load_time_sec END) AS lat_ok
            FROM app.report_observations""")
        port = one("SELECT * FROM cost.v_unit_cost_portfolio")
        # Spend tied to failed refreshes — derived from the CSV, not from the simulated query layer
        failed_spend = one(f"""
            SELECT COUNT(*) AS months, COUNT(DISTINCT report_id) AS reports,
                   SUM(credits_clean) AS credits, SUM(credits_clean) * {CREDIT_PRICE_USD} AS snowflake_usd,
                   SUM(aws_hosting_cost_usd) AS aws_usd
            FROM app.report_observations WHERE is_refresh_failure""")
        sensitivity = q("SELECT * FROM cost.v_unit_cost_price_sensitivity ORDER BY ordinal")
        forensics = q("SELECT check_code, title, conclusion FROM app.dq_forensics ORDER BY ordinal")
        identity = one("SELECT result FROM app.dq_forensics WHERE check_code = 'REPORT_IDENTITY_SIGNAL'")
        orphan = one("SELECT * FROM cost.v_orphaned_cost_summary")
        disc = one("SELECT * FROM cost.v_aws_usage_discrepancy_summary")
        corr = one("SELECT * FROM cost.v_aws_usage_correlation WHERE grain = 'report-month'")
        spread = one("""SELECT MIN(fully_loaded_cost_per_view_usd) AS lo, MAX(fully_loaded_cost_per_view_usd) AS hi,
                               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fully_loaded_cost_per_view_usd) AS med
                        FROM cost.v_unit_cost_report""")
        decom = q("""SELECT report_id, report_name, total_views,
                            ROUND(fully_loaded_cost_per_view_usd, 2) AS cpv, ROUND(total_cost_usd, 0) AS total
                     FROM cost.v_report_cost_ranking WHERE is_decommission_candidate = 1
                     ORDER BY fully_loaded_cost_per_view_usd DESC""")
        top_cpv = q("""SELECT report_id, report_name, total_views, ROUND(fully_loaded_cost_per_view_usd, 2) AS cpv
                       FROM cost.v_unit_cost_report ORDER BY fully_loaded_cost_per_view_usd DESC LIMIT 5""")
        churn = one("SELECT AVG(distinct_owner_count) AS owners FROM app.reports")

    price = CREDIT_PRICE_USD
    sf_cost, aws_cost = float(port.snowflake_cost_usd), float(port.aws_cost_usd)
    decom_rows = (
        "\n".join(
            f"| {r.report_id} | {r.report_name} | {int(r.total_views):,} | ${r.cpv} | ${int(r.total):,} |"
            for r in decom.itertuples()
        )
        or "| — | none met both criteria | | | |"
    )
    sens_rows = "\n".join(
        f"| {r.edition} | ${r.credit_price_usd:.2f} | ${r.snowflake_cost_usd:,.0f} | ${r.snowflake_cost_per_view_usd:.3f} | ${r.fully_loaded_cost_per_view_usd:.3f} |"
        for r in sensitivity.itertuples()
    )
    forensic_rows = "\n".join(f"| {r.title} | {r.conclusion} |" for r in forensics.itertuples())
    top_rows = "\n".join(
        f"| {r.report_id} | {r.report_name} | {int(r.total_views):,} | ${r.cpv} |" for r in top_cpv.itertuples()
    )
    return f"""# Business Findings & Recommendations — Pure Insights Command Center

> Generated by `python -m pic_pipeline.cli findings` on {datetime.now(UTC):%Y-%m-%d %H:%M UTC}. Figures are live query
> results over the cleaned data and the `cost.*` views from the Snowflake SQL suite. Every cost figure traces back to the
> CSV; the simulated ACCOUNT_USAGE layer adds no spend of its own.
>
> * **Credit price ${price:.2f}** = Snowflake's on-demand list price for **Enterprise edition on AWS US East** (Standard $2,
>   Business Critical $4); the sensitivity table below shows all three.
> * **Timeline {FIRST_PERIOD[:7]} → {DATA_AS_OF_MONTH}**: the 20 passes are statistically independent 30-day periods
>   (lag-1 autocorrelation ≈ 0), anchored to the last complete month before the data was received.

## Executive summary

1. **The latency SLO is broken platform-wide, not by a few outliers.** {ops.breach_rate:.1%} of report-months load slower
   than {t.latency_alert_sec:g} s; the median load is {ops.p50:.1f} s and p95 is {ops.p95:.1f} s. In the latest snapshot
   {int(latest.breaching)} of {int(latest.reports)} reports breach. Latency is spread almost evenly from {shape.lat_min:.1f} s to the {shape.lat_max:.0f} s ceiling, so fixing the
   slowest handful of dashboards will not restore the SLO.
2. **More than a quarter of automated refreshes fail.** Refresh failure rate is {ops.failure_rate:.1%}
   ({int(ops.failed)} FAILED, {int(ops.timed_out)} TIMED_OUT); {int(latest.failing)} reports are failing in the latest
   snapshot. Those {int(failed_spend.months)} report-months carried {failed_spend.credits:,.0f} credits
   (${failed_spend.snowflake_usd:,.0f}) and ${failed_spend.aws_usd:,.0f} of AWS hosting — spend behind dashboards that were
   serving stale data. On a live account `cost.v_failed_query_spend` isolates the credits burned by the failed runs themselves.
3. **Orphaned reports carry ${orphan.orphaned_total_cost_usd:,.0f} of unaccountable spend.** {int(orphan.reports_ever_orphaned)} reports
   had no owner in at least one month; {int(orphan.reports_currently_orphaned)} are orphaned right now. Orphaned report-months consumed
   {orphan.orphaned_credits:,.0f} credits (${orphan.orphaned_snowflake_cost_usd:,.0f}) plus ${orphan.orphaned_aws_cost_usd:,.0f}
   of AWS hosting — the single largest "owner" in the chargeback.
4. **AWS hosting cost is disconnected from usage.** Correlation between active views and AWS cost is
   {corr.pearson_views_vs_aws_cost} (Spearman {corr.spearman_views_vs_aws_cost}). {int(disc.cost_per_view_outlier_rows)} report-months
   breach the 3×IQR cost-per-view fence (${disc.outlier_fence_usd:.2f}/view), {int(disc.zero_view_cost_rows)} incur cost with zero
   views, and {int(disc.peak_exceeds_views_rows)} report impossible usage (peak concurrent users above monthly views).
5. **Snowflake, not AWS, dominates unit cost** (at ${price:.2f}/credit). Across the portfolio a report view costs
   **${port.snowflake_cost_per_view_usd:.2f} in Snowflake compute** and **${port.aws_cost_per_view_usd:.2f} in AWS hosting**
   (fully loaded **${port.fully_loaded_cost_per_view_usd:.2f}/view**). Snowflake spend totals ${sf_cost:,.0f} vs AWS ${aws_cost:,.0f}.
   Per-report fully loaded cost per view ranges from ${spread.lo:.2f} to ${spread.hi:.2f} (median ${spread.med:.2f}).

## Operational health (Task 1 / Task 2)

| Metric | Value |
|---|---|
| Report-months above {t.latency_alert_sec:g} s | {ops.breach_rate:.1%} |
| Report-months above {t.latency_critical_above_sec:g} s (CRITICAL band) | {ops.critical_rate:.1%} |
| Median / p95 load latency | {ops.p50:.1f} s / {ops.p95:.1f} s |
| Refresh failure rate (FAILED + TIMED_OUT) | {ops.failure_rate:.1%} |
| Mean latency when refresh failed vs succeeded | {slow_fail.lat_fail:.1f} s vs {slow_fail.lat_ok:.1f} s |
| Latest snapshot: breaching / failing / orphaned reports | {int(latest.breaching)} / {int(latest.failing)} / {int(latest.orphaned)} |

Mean latency is nearly identical whether or not a refresh failed, so the two problems have **independent root causes**
and need separate remediation tracks. With three-quarters of observations breaching, alert *deduplication* (one live
incident per report and rule, escalating on severity) is what keeps the real-time channel usable.

## Cost allocation (Task 3)

| Metric | Value |
|---|---|
| Credits attributed to reports (Method A, after quarantine) | {port.snowflake_credits:,.2f} |
| Snowflake cost attributed to reports | ${sf_cost:,.0f} |
| AWS hosting cost | ${aws_cost:,.0f} |
| Snowflake cost per active view | ${port.snowflake_cost_per_view_usd:.4f} |
| AWS cost per active view | ${port.aws_cost_per_view_usd:.4f} |
| Fully loaded cost per active view | ${port.fully_loaded_cost_per_view_usd:.4f} |
| Spend in report-months whose refresh failed | {failed_spend.credits:,.0f} credits (${failed_spend.snowflake_usd:,.0f}) + ${failed_spend.aws_usd:,.0f} AWS |

### Unit cost by Snowflake edition (on-demand list price, AWS US East)

| Edition | $/credit | Snowflake spend | Snowflake $/view | Fully loaded $/view |
|---|---|---|---|---|
{sens_rows}

Warehouse idle time and untagged ad-hoc work are real costs on a live account, but the CSV carries no evidence of either,
so none is simulated. The SQL suite measures both (`cost.v_warehouse_idle`, the `UNTAGGED` quarantine class) — the test
suite proves it by running the same SQL with idle and untagged usage switched on.

### Highest fully loaded cost per view

> **Statistical caveat.** In this dataset report identity explains none of the variance ({identity.result}), so the
> per-report rankings below are not distinguishable from noise. They demonstrate the method; the portfolio-level findings
> above are robust.

| Report | Name | Lifetime views | $/view |
|---|---|---|---|
{top_rows}

### Decommission candidates (top-decile cost per view **and** below-median usage)

| Report | Name | Lifetime views | $/view | Lifetime cost |
|---|---|---|---|---|
{decom_rows}

## Recommendations (prioritised)

1. **Treat latency as a platform problem.** Target the shared layers that every dashboard crosses — warehouse sizing and
   multi-cluster scaling for peak concurrency, result caching / materialised aggregates for the heaviest queries, and
   front-end payload size — rather than tuning individual reports. Keep the {t.latency_alert_sec:g} s alert as the SLO
   tripwire and track breach rate weekly.
2. **Fix refresh reliability next.** Timeouts point at long-running refresh SQL or undersized warehouses; outright
   failures point at broken dependencies. Use the `REFRESH_FAILURE` alert stream to open an incident per report and stop
   paying for failed runs.
3. **Close the ownership gap.** Assign an accountable owner to the {int(orphan.reports_currently_orphaned)} currently orphaned reports
   (the dashboard supports audited reassignment) and require an owner at publish time. Ownership in the source changes
   every month with no memory (reports average {churn.owners:.1f} different owners across {int(shape.snapshots)} periods), which makes
   chargeback meaningless until ownership is mastered in one place.
4. **Rightsize or retire.** Hosting spend that does not move with usage indicates fixed, over-provisioned capacity. Re-run
   the decommission ranking on production data (where report identity carries signal) and archive zero-view reports.
5. **Harden cost telemetry.** Enforce `QUERY_TAG` on every portal query so untagged work and idle time become measurable,
   alert on negative or missing credit records at ingestion, fix the usage counters that report more concurrent users than
   views, and restore the refresh status feed ({int(shape.unknown)} UNKNOWN outcomes).

## Forensic checks behind these findings

| Check | Conclusion |
|---|---|
{forensic_rows}
"""


def run(test: bool = False) -> str:
    path = DOCS_DIR / "BUSINESS_FINDINGS.md"
    path.write_text(build(test))
    return str(path)
