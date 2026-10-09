"""Stage 2 (load) — run the quality rules over raw rows and write the cleaned model."""

from __future__ import annotations

from .db import connect, copy_dataframe, query_df
from .quality_rules import assess, rules_frame

OBS_COLUMNS = [
    "source_row_number",
    "report_id",
    "snapshot_seq",
    "period_month",
    "owner_raw",
    "owner_email",
    "is_orphaned",
    "refresh_status",
    "is_refresh_failure",
    "is_status_unknown",
    "monthly_active_views",
    "credits_raw",
    "credits_clean",
    "is_negative_credits",
    "avg_load_time_sec",
    "latency_band",
    "is_latency_breach",
    "is_latency_invalid",
    "aws_hosting_cost_usd",
    "aws_cost_per_view",
    "is_zero_view_cost",
    "is_peak_exceeds_views",
    "is_aws_cost_per_view_outlier",
    "query_count_last_30d",
    "concurrent_user_peak",
]
REPORT_COLUMNS = [
    "report_id",
    "report_name",
    "current_owner_email",
    "is_currently_orphaned",
    "latest_snapshot_seq",
    "orphaned_snapshot_count",
    "distinct_owner_count",
    "owner_change_count",
]
ISSUE_COLUMNS = [
    "source_row_number",
    "report_id",
    "snapshot_seq",
    "rule_code",
    "column_name",
    "raw_value",
    "detail",
    "action_taken",
]


def run(test: bool = False) -> dict[str, int]:
    with connect(test) as conn:
        raw = query_df(conn, "SELECT * FROM raw.report_monitoring_csv ORDER BY source_row_number")
        if raw.empty:
            raise RuntimeError("raw.report_monitoring_csv is empty — run the ingest stage first")
        result = assess(raw)
        with conn.cursor() as cur:
            cur.execute("TRUNCATE app.dq_issues, app.report_observations, app.dq_rules")
            # Reports are upserted (not truncated) so admin owner overrides survive a rebuild.
            cur.execute("CREATE TEMP TABLE stage_reports (LIKE app.reports) ON COMMIT DROP")
            copy_dataframe(cur, "stage_reports", result.reports, REPORT_COLUMNS)
            cur.execute(
                """INSERT INTO app.reports SELECT * FROM stage_reports
                   ON CONFLICT (report_id) DO UPDATE SET
                     report_name = EXCLUDED.report_name,
                     current_owner_email = EXCLUDED.current_owner_email,
                     is_currently_orphaned = EXCLUDED.is_currently_orphaned,
                     latest_snapshot_seq = EXCLUDED.latest_snapshot_seq,
                     orphaned_snapshot_count = EXCLUDED.orphaned_snapshot_count,
                     distinct_owner_count = EXCLUDED.distinct_owner_count,
                     owner_change_count = EXCLUDED.owner_change_count"""
            )
            copy_dataframe(cur, "app.dq_rules", rules_frame())
            copy_dataframe(cur, "app.report_observations", result.observations, OBS_COLUMNS)
            copy_dataframe(cur, "app.dq_issues", result.issues, ISSUE_COLUMNS)
    return {
        "reports": len(result.reports),
        "observations": len(result.observations),
        "dq_issues": len(result.issues),
    }
