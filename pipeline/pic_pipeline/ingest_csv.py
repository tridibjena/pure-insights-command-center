"""Stage 1 — land the CSV verbatim in raw.report_monitoring_csv.

Every value is kept as text. Nothing is coerced here: the string 'nan' in owner_email
is a defect we need to *see*, and pandas would silently turn it into a float NaN.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd

from .config import RAW_CSV
from .db import connect, copy_dataframe

EXPECTED_COLUMNS = [
    "report_id",
    "report_name",
    "owner_email",
    "last_refresh_status",
    "monthly_active_views",
    "snowflake_credits_consumed",
    "avg_load_time_sec",
    "aws_hosting_cost_usd",
    "query_count_last_30d",
    "concurrent_user_peak",
]


def read_raw(path: Path = RAW_CSV) -> pd.DataFrame:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        if header != EXPECTED_COLUMNS:
            raise ValueError(f"Unexpected CSV header: {header}")
        rows = []
        for line_no, row in enumerate(reader, start=1):
            if len(row) != len(header):
                raise ValueError(f"Row {line_no} has {len(row)} fields, expected {len(header)}")
            rows.append(row)
    df = pd.DataFrame(rows, columns=header, dtype="object")
    df.insert(0, "source_row_number", range(1, len(df) + 1))
    df["source_file"] = path.name
    return df


def run(test: bool = False, path: Path = RAW_CSV) -> int:
    df = read_raw(path)
    with connect(test) as conn, conn.cursor() as cur:
        # Downstream tables reference raw rows; rebuild the whole chain from scratch.
        cur.execute("TRUNCATE raw.report_monitoring_csv CASCADE")
        return copy_dataframe(cur, "raw.report_monitoring_csv", df)
