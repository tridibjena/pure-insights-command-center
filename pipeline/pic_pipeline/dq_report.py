"""Generate docs/DATA_QUALITY.md from the live anomaly register (no hand-typed numbers)."""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from .config import DATA_AS_OF_MONTH, DOCS_DIR, FIRST_PERIOD, THRESHOLDS
from .db import connect, query_df


def _md_table(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join("" if pd.isna(v) else str(v) for v in row) + " |")
    return "\n".join(lines)


def build(test: bool = False) -> str:
    t = THRESHOLDS
    with connect(test) as conn:
        q = lambda sql: query_df(conn, sql)  # noqa: E731
        totals = q(
            "SELECT (SELECT count(*) FROM raw.report_monitoring_csv) AS raw_rows, "
            "(SELECT count(*) FROM app.report_observations) AS observations, "
            "(SELECT count(*) FROM app.reports) AS reports, "
            "(SELECT max(snapshot_seq) FROM app.report_observations) AS snapshots"
        ).iloc[0]
        register = q("""
            SELECT r.rule_code AS "Rule", r.title AS "Defect", r.column_name AS "Column",
                   r.severity AS "Severity", r.action AS "Action",
                   COUNT(i.issue_id) AS "Rows", COUNT(DISTINCT i.report_id) AS "Reports",
                   ROUND(100.0 * COUNT(i.issue_id) / (SELECT COUNT(*) FROM app.report_observations), 2) AS "% of rows"
            FROM app.dq_rules r LEFT JOIN app.dq_issues i USING (rule_code)
            GROUP BY r.rule_code, r.title, r.column_name, r.severity, r.action
            ORDER BY COUNT(i.issue_id) DESC""")
        rules = q(
            'SELECT rule_code AS "Rule", detection AS "Detection logic", remediation AS "Remediation" '
            "FROM app.dq_rules ORDER BY rule_code"
        )
        orphan_markers = q("""SELECT owner_raw AS "Raw owner_email value", COUNT(*) AS "Rows"
                              FROM app.report_observations WHERE is_orphaned GROUP BY owner_raw ORDER BY 2 DESC""")
        orphan = q("""SELECT SUM(CASE WHEN is_currently_orphaned THEN 1 ELSE 0 END) AS current,
                             SUM(CASE WHEN orphaned_snapshot_count > 0 THEN 1 ELSE 0 END) AS ever,
                             SUM(CASE WHEN orphaned_snapshot_count = latest_snapshot_seq THEN 1 ELSE 0 END) AS always
                      FROM app.reports""").iloc[0]
        neg = q("""SELECT COUNT(*) AS n, COUNT(DISTINCT report_id) AS reports, MIN(credits_raw) AS min,
                          MAX(credits_raw) AS max, SUM(credits_raw) AS total,
                          SUM(CASE WHEN is_orphaned THEN 1 ELSE 0 END) AS also_orphaned
                   FROM app.report_observations WHERE is_negative_credits""").iloc[0]
        credits = q(
            "SELECT SUM(credits_raw) AS raw, SUM(credits_clean) AS clean, "
            "MIN(credits_clean) AS min_valid FROM app.report_observations"
        ).iloc[0]
        neg_rows = q("""SELECT source_row_number AS "CSV row", report_id AS "Report", snapshot_seq AS "Snapshot",
                               credits_raw AS "Raw credits", 'NULL (quarantined)' AS "Clean credits"
                        FROM app.report_observations WHERE is_negative_credits ORDER BY credits_raw LIMIT 8""")
        lat = q("""SELECT MIN(avg_load_time_sec) AS min,
                          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_load_time_sec) AS median,
                          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec) AS p95,
                          MAX(avg_load_time_sec) AS max
                   FROM app.report_observations""").iloc[0]
        at_max = q(
            "SELECT COUNT(*) AS n FROM app.report_observations "
            "WHERE avg_load_time_sec = (SELECT MAX(avg_load_time_sec) FROM app.report_observations)"
        ).iloc[0]["n"]
        exactly_thr = q(
            f"SELECT COUNT(*) AS n FROM app.report_observations WHERE avg_load_time_sec = {t.latency_alert_sec}"
        ).iloc[0]["n"]
        bands = q("""SELECT latency_band AS "Band", COUNT(*) AS "Rows", MIN(avg_load_time_sec) AS "Min s", MAX(avg_load_time_sec) AS "Max s"
                     FROM app.report_observations GROUP BY latency_band
                     ORDER BY CASE latency_band WHEN 'OK' THEN 0 WHEN 'WARNING' THEN 1 WHEN 'HIGH' THEN 2
                                                WHEN 'CRITICAL' THEN 3 ELSE 4 END""")
        hist = q("""SELECT (FLOOR(avg_load_time_sec / 5) * 5)::int AS lo, COUNT(*) AS n
                    FROM app.report_observations GROUP BY 1 ORDER BY 1""")
        status = q("""SELECT refresh_status AS "Status", COUNT(*) AS "Rows",
                             ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM app.report_observations), 1) AS "%" FROM app.report_observations
                      GROUP BY refresh_status ORDER BY 2 DESC""")
        disc = q("""SELECT SUM(CASE WHEN is_zero_view_cost THEN 1 ELSE 0 END) AS zero_view,
                           SUM(CASE WHEN is_peak_exceeds_views THEN 1 ELSE 0 END) AS peak,
                           SUM(CASE WHEN is_aws_cost_per_view_outlier THEN 1 ELSE 0 END) AS outlier,
                           CORR(monthly_active_views, aws_hosting_cost_usd) AS r
                    FROM app.report_observations""").iloc[0]
        fence = q("SELECT q1, median, q3, q3 + 3 * (q3 - q1) AS fence FROM cost.v_aws_cost_per_view_fence").iloc[0]
        zero_rows = q("""SELECT source_row_number AS "CSV row", report_id AS "Report", monthly_active_views AS "Views",
                                aws_hosting_cost_usd AS "AWS $", credits_raw AS "Credits"
                         FROM app.report_observations WHERE is_zero_view_cost ORDER BY source_row_number""")
        forensic = q(
            "SELECT ordinal, title, question, method, result, conclusion, treatment FROM app.dq_forensics ORDER BY ordinal"
        )
        churn = q(
            "SELECT COUNT(*) AS n, ROUND(AVG(distinct_owner_count), 1) AS avg_owners FROM app.reports "
            "WHERE owner_change_count > 0"
        ).iloc[0]

    forensic_md = "\n\n".join(
        f"### {int(r.ordinal)} · {r.title}\n\n* **Question.** {r.question}\n* **Method.** {r.method}\n"
        f"* **Result.** {r.result}\n* **Conclusion.** {r.conclusion}\n* **Treatment.** {r.treatment}"
        for r in forensic.itertuples()
    )
    hist_line = " · ".join(f"{int(r.lo)}–{int(r.lo) + 5}s: {int(r.n)}" for r in hist.itertuples())
    return f"""# Data Quality Report — Pure Insights Command Center

> Generated by `python -m pic_pipeline.cli dq-report` on {datetime.now(UTC):%Y-%m-%d %H:%M UTC} from the live
> anomaly register (`app.dq_issues`). Every number below is a query result, not a hand-typed figure.

Source: `data/raw/Case_Study_3_Pure_Insights_Monitoring.csv` — **{int(totals.raw_rows):,} rows** landed verbatim in
`raw.report_monitoring_csv`, cleaned into **{int(totals.observations):,} observations** of **{int(totals.reports)} reports**
across **{int(totals.snapshots)} snapshots**. No row is dropped: defects are nulled, quarantined or annotated, and the
raw value is always kept.

## How the data is structured

The file has no timestamp. `report_id` takes only {int(totals.reports)} distinct values and each appears exactly
{int(totals.snapshots)} times, in the same order on every pass. The pipeline therefore treats the *n*-th occurrence of a
report as its *n*-th **snapshot**. The metrics are monthly/30-day aggregates (`monthly_active_views`,
`query_count_last_30d`). Their lag-1 autocorrelation between consecutive passes is ≈ 0 (see forensic check 1), so the
passes are consecutive, non-overlapping 30-day periods — monthly snapshots — not rolling daily windows. The calendar anchor
is the last complete month before the data was received: snapshot 1 = {FIRST_PERIOD[:7]} to snapshot 20 = {DATA_AS_OF_MONTH}
(configurable via `DATA_AS_OF_MONTH`). `report_name` is constant per report (verified); `owner_email` is not.

## Anomaly register

{_md_table(register)}

### Detection logic and remediation

{_md_table(rules)}

## 1 · Orphaned reports (owner missing)

{_md_table(orphan_markers)}

* Both markers — the literal string `nan` (what pandas writes for a missing value) and `ORPHANED_REPORT` — plus blank or
  malformed addresses are normalised to `NULL`. The CSV is read as text precisely so `nan` is seen as a defect rather than
  silently becoming a float.
* **{int(orphan.current)} reports are currently orphaned** (no owner in their latest snapshot). {int(orphan.ever)} reports were
  orphaned in at least one snapshot; {int(orphan.always)} were orphaned in every snapshot.
* Admins can reassign an owner from the Orphaned Reports page (`app.owner_overrides`, audited).

## 2 · Negative Snowflake credit consumption

* **{int(neg.n)} rows** on {int(neg.reports)} distinct reports, ranging **{neg["min"]} to {neg["max"]}** credits
  (sum {neg.total}); {int(neg.also_orphaned)} of them are also orphaned.
* Credits cannot be negative, so the value is **quarantined**: `credits_clean = NULL`, excluded from cost attribution
  and unit cost. It is *not* abs()'d (that would invent spend) and *not* zeroed (that would understate cost per view).
  Lifetime unit costs exclude quarantined months from both numerator and denominator.
* Raw total {credits.raw:,.2f} → clean total **{credits.clean:,.2f}** credits. Smallest valid value: {credits.min_valid}.
* The Snowflake SQL suite applies the same filter at source (`02_anomaly_quarantine.sql`) and proves the quarantined
  amount equals the negative source total (`09_reconciliation_checks.sql`, check 2).

{_md_table(neg_rows)}

## 3 · Extreme load-latency spikes (up to {lat["max"]:.0f} s)

* Observed range **{lat["min"]} s to {lat["max"]} s** (median {lat["median"]:.1f} s, p95 {lat["p95"]:.1f} s).
  **{int(at_max)} rows sit exactly at the {lat["max"]} s maximum.**
* **The alert threshold is {t.latency_alert_sec:g} s (strictly greater than), from Task 2.** {lat["max"]} s is the extreme of the
  injected spikes, *not* a threshold. {int(exactly_thr)} rows are exactly {t.latency_alert_sec:g} s and correctly do **not** alert.
* Spikes are **kept unchanged** — never capped, winsorised or removed — because a {lat["max"]:.0f}-second dashboard load is a real
  operational event and is exactly what the real-time alerting must catch. Only invalid readings (non-numeric, ≤ 0 or
  > {t.latency_invalid_above_sec:g} s) would be nulled; there are none.
* Distribution in 5-second bins (roughly uniform up to the ceiling, i.e. a systemic problem rather than a thin tail):
  {hist_line}.
* Severity tiers above the threshold are configurable display bands (`LATENCY_HIGH_ABOVE_SEC`,
  `LATENCY_CRITICAL_ABOVE_SEC`), not requirements of the brief:

{_md_table(bands)}

## 4 · Refresh status

{_md_table(status)}

`FAILED` and `TIMED_OUT` are refresh failures and raise `REFRESH_FAILURE` alerts. `UNKNOWN` is not in the brief's
anomaly list; it means no outcome was reported, so it is treated as a **telemetry gap** (`TELEMETRY_GAP` alert,
WARNING), not as a failure.

## 5 · Active users vs AWS hosting cost

* Pearson correlation between monthly active views and AWS hosting cost: **{disc.r:.3f}** — hosting spend does not
  track usage at all.
* **{int(disc.zero_view)} rows** incur cost with **zero** active views (unit cost undefined → NULL, never divide-by-zero):

{_md_table(zero_rows)}

* **{int(disc.peak)} rows** report `concurrent_user_peak` greater than `monthly_active_views`, which is logically
  impossible (each concurrent user implies at least one view) — usage counters for those report-months are unreliable.
* AWS cost per view: Q1 ${fence.q1:.3f}, median ${fence["median"]:.3f}, Q3 ${fence.q3:.3f}. Robust fence Q3 + 3×IQR =
  **${fence.fence:.3f}/view**; **{int(disc.outlier)} rows** exceed it.

## 6 · Ownership churn

{int(churn.n)} of {int(totals.reports)} reports change owner between snapshots (on average {churn.avg_owners} distinct owners
each). Forensic check 3 shows the churn is random reassignment with no month-to-month memory. The pipeline uses the owner in
the latest snapshot as the *current* owner and keeps the full history for the drill-down.

## 7 · Forensic checks

Each structural observation about the dataset raises a question the data itself can answer. These checks are recomputed by
`python -m pic_pipeline.cli forensics` and stored in `app.dq_forensics` (shown on the Data Quality page).

{forensic_md}
"""


def run(test: bool = False) -> str:
    path = DOCS_DIR / "DATA_QUALITY.md"
    path.write_text(build(test))
    return str(path)
