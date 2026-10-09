"""Central configuration, read from the repository-level .env file."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")

RAW_CSV = REPO_ROOT / "data" / "raw" / "Case_Study_3_Pure_Insights_Monitoring.csv"
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
SQL_SUITE_DIR = REPO_ROOT / "sql" / "snowflake"
SIMULATED_DIR = REPO_ROOT / "data" / "simulated"
DOCS_DIR = REPO_ROOT / "docs"


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


@dataclass(frozen=True)
class Thresholds:
    # Task 2 threshold: an alert fires when load latency is strictly greater than this.
    latency_alert_sec: float = _float("LATENCY_ALERT_THRESHOLD_SEC", 15)
    # Display tiers above the threshold. Configurable; not prescribed by the brief.
    latency_high_above_sec: float = _float("LATENCY_HIGH_ABOVE_SEC", 30)
    latency_critical_above_sec: float = _float("LATENCY_CRITICAL_ABOVE_SEC", 45)
    # Validity guard: <= 0 or above this is bad data rather than bad performance.
    latency_invalid_above_sec: float = _float("LATENCY_INVALID_ABOVE_SEC", 300)
    # AWS cost-per-view outlier fence: Q3 + k * IQR
    aws_cost_per_view_iqr_k: float = 3.0


THRESHOLDS = Thresholds()
CREDIT_PRICE_USD = _float("CREDIT_PRICE_USD", 3.00)  # see SNOWFLAKE_EDITION_PRICES below

# The CSV has no timestamp. Rows are 20 complete passes over the same 100 reports; their 30-day
# metrics show no lag-1 autocorrelation (see forensics), i.e. the passes are consecutive,
# non-overlapping 30-day periods. The calendar anchor is the last complete month before the data
# was received (file delivered 2026-10-09 → September 2026); override with DATA_AS_OF_MONTH.
DATA_AS_OF_MONTH = os.getenv("DATA_AS_OF_MONTH", "2026-09")
SNAPSHOT_COUNT = 20


def first_period(as_of: str = DATA_AS_OF_MONTH, snapshots: int = SNAPSHOT_COUNT) -> str:
    """First month of the series so that snapshot `snapshots` falls on `as_of`."""
    import pandas as pd

    return str((pd.Period(as_of, freq="M") - (snapshots - 1)).start_time.date())


FIRST_PERIOD = first_period()

# Snowflake price per credit: on-demand list price for Enterprise edition on AWS US East
# (Standard $2.00 · Enterprise $3.00 · Business Critical $4.00). Configurable.
SNOWFLAKE_EDITION_PRICES = {"Standard": 2.00, "Enterprise": 3.00, "Business Critical": 4.00}


@dataclass(frozen=True)
class SimulationKnobs:
    """Parameters for things the CSV carries no evidence of. Defaults are 0 so the simulated
    ACCOUNT_USAGE layer invents no spend; tests switch them on to prove the SQL handles them."""

    idle_ratio: float = _float("SIM_IDLE_RATIO", 0.0)  # warehouse idle as a share of busy credits
    untagged_share: float = _float("SIM_UNTAGGED_SHARE", 0.0)  # ad-hoc untagged credits vs report credits
    exec_jitter: float = _float("SIM_EXEC_JITTER", 0.0)  # lognormal sigma on execution time vs credits


SIM = SimulationKnobs()


def dsn(test: bool = False) -> str:
    db = os.getenv("PGDATABASE_TEST" if test else "PGDATABASE", "pure_insights")
    return (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5433')} "
        f"user={os.getenv('PGUSER', 'pic')} password={os.getenv('PGPASSWORD', '')} dbname={db}"
    )
