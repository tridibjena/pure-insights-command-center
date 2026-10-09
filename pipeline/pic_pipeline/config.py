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
CREDIT_PRICE_USD = _float("CREDIT_PRICE_USD", 3.00)

# The CSV has no timestamp. Rows are 20 complete passes over the same 100 reports,
# so each pass is treated as one 30-day period starting at this month.
FIRST_PERIOD = "2025-01-01"


def dsn(test: bool = False) -> str:
    db = os.getenv("PGDATABASE_TEST" if test else "PGDATABASE", "pure_insights")
    return (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5433')} "
        f"user={os.getenv('PGUSER', 'pic')} password={os.getenv('PGPASSWORD', '')} dbname={db}"
    )
