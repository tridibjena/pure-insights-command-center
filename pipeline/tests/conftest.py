import pandas as pd
import psycopg
import pytest

from pic_pipeline import clean, forensics, ingest_csv, migrate, simulate_account_usage, sql_suite
from pic_pipeline.db import connect
from pic_pipeline.ingest_csv import read_raw
from pic_pipeline.quality_rules import assess


@pytest.fixture(scope="session")
def raw() -> pd.DataFrame:
    return read_raw()


@pytest.fixture(scope="session")
def assessment(raw):
    return assess(raw)


def make_raw(rows: list[dict]) -> pd.DataFrame:
    """Build a raw (all-text) frame from partial rows, filling sensible defaults."""
    base = {
        "report_id": "RPT_900",
        "report_name": "Test Dashboard",
        "owner_email": "owner@company.com",
        "last_refresh_status": "SUCCESS",
        "monthly_active_views": "100",
        "snowflake_credits_consumed": "10.0",
        "avg_load_time_sec": "5.0",
        "aws_hosting_cost_usd": "20.0",
        "query_count_last_30d": "1000",
        "concurrent_user_peak": "10",
    }
    df = pd.DataFrame([{**base, **r} for r in rows], dtype="object")
    df.insert(0, "source_row_number", range(1, len(df) + 1))
    df["source_file"] = "synthetic.csv"
    return df


@pytest.fixture(scope="session")
def loaded_test_db():
    try:
        with connect(test=True):
            pass
    except psycopg.OperationalError as exc:  # pragma: no cover
        pytest.skip(f"test database unavailable: {exc}")
    migrate.run(test=True)
    ingest_csv.run(test=True)
    clean.run(test=True)
    forensics.run(test=True)
    simulate_account_usage.run(test=True)
    sql_suite.run(test=True)
