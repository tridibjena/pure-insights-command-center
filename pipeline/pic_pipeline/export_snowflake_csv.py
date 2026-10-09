"""Export the simulated logs + portal facts as CSV for loading into a real Snowflake account
(see sql/snowflake/00_bootstrap_simulation_snowflake.sql)."""

from __future__ import annotations

from pathlib import Path

from .config import SIMULATED_DIR
from .db import connect, query_df

EXPORTS = {
    "query_history.csv": "SELECT * FROM account_usage.query_history ORDER BY start_time, query_id",
    "query_attribution_history.csv": "SELECT * FROM account_usage.query_attribution_history ORDER BY start_time, query_id",
    "warehouse_metering_history.csv": "SELECT * FROM account_usage.warehouse_metering_history ORDER BY start_time, warehouse_name",
    "portal_report_usage_monthly.csv": "SELECT * FROM portal.report_usage_monthly ORDER BY period_month, report_id",
    "portal_credit_pricing.csv": "SELECT * FROM portal.credit_pricing",
}


def run(test: bool = False, out_dir: Path = SIMULATED_DIR) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    with connect(test) as conn:
        for name, sql in EXPORTS.items():
            df = query_df(conn, sql)
            for col in df.columns:
                if hasattr(df[col], "dt") and getattr(df[col].dt, "tz", None) is not None:
                    df[col] = df[col].dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")  # ISO-8601: parsed by Snowflake AUTO
            df.to_csv(out_dir / name, index=False)
            counts[name] = len(df)
    return counts
