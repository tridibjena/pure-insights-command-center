"""Verify the cost-allocation SQL suite as Snowflake SQL.

Three levels of evidence, strongest last:

1. ``parse``    — every statement in sql/snowflake/00-09 parses as Snowflake SQL (sqlglot).
2. ``emulate``  — the suite *executes* in Snowflake dialect on fakesnow (a Snowflake emulator on
                  DuckDB): 00's DDL builds PURE_INSIGHTS_SIM, the exported logs are loaded, 01-09
                  run, and all reconciliation checks must PASS with the same figures as PostgreSQL.
3. ``live``     — the same run against a real Snowflake account, when SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER
                  and SNOWFLAKE_PASSWORD (optionally SNOWFLAKE_WAREHOUSE / SNOWFLAKE_ROLE) are set.
"""

from __future__ import annotations

import os
import warnings
from pathlib import Path

import sqlglot

from .config import SIMULATED_DIR, SQL_SUITE_DIR
from .sql_suite import split_statements

SUITE = sorted(SQL_SUITE_DIR.glob("0[0-9]_*.sql"))
LOADS = {
    "query_history.csv": "ACCOUNT_USAGE.QUERY_HISTORY",
    "query_attribution_history.csv": "ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY",
    "warehouse_metering_history.csv": "ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY",
    "portal_report_usage_monthly.csv": "PORTAL.REPORT_USAGE_MONTHLY",
    "portal_credit_pricing.csv": "PORTAL.CREDIT_PRICING",
}
# Statements in 00 that touch the file system / account rather than define objects.
# fakesnow has no stages and no ALTER SESSION; on a live account they all run.
EMULATOR_SKIP = ("COPY INTO", "CREATE OR REPLACE FILE FORMAT", "CREATE OR REPLACE STAGE", "USE ROLE", "ALTER SESSION")


def _code(stmt: str) -> str:
    return "\n".join(line for line in stmt.splitlines() if not line.strip().startswith("--")).strip().upper()


def parse() -> list[tuple[str, int]]:
    """Parse every statement as Snowflake SQL; raises on the first failure."""
    counts = []
    for path in SUITE:
        stmts = split_statements(path.read_text())
        for stmt in stmts:
            sqlglot.parse_one(stmt, read="snowflake", error_level=sqlglot.ErrorLevel.RAISE)
        counts.append((path.name, len(stmts)))
    return counts


def _run_suite(cur, skip: tuple[str, ...]) -> dict[str, int]:
    ran = {}
    for path in SUITE:
        n = 0
        for stmt in split_statements(path.read_text()):
            if path.name.startswith("00_") and _code(stmt).startswith(skip):
                continue
            cur.execute(stmt)
            n += 1
        ran[path.name] = n
    return ran


def _results(cur) -> dict:
    cur.execute(
        "SELECT check_no, check_name, expected, actual, status FROM cost.v_reconciliation_checks ORDER BY check_no"
    )
    checks = [tuple(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT snowflake_credits, snowflake_cost_per_view_usd, fully_loaded_cost_per_view_usd "
        "FROM cost.v_unit_cost_portfolio"
    )
    portfolio = tuple(float(v) for v in cur.fetchone())
    return {"checks": checks, "portfolio": portfolio}


def emulate(simulated_dir: Path = SIMULATED_DIR) -> dict:
    """Run 00 (DDL) + 01-09 in Snowflake dialect on the fakesnow emulator."""
    import fakesnow
    import snowflake.connector

    warnings.filterwarnings("ignore", module="snowflake.connector")
    missing = [f for f in LOADS if not (simulated_dir / f).exists()]
    if missing:
        raise FileNotFoundError(f"run `python -m pic_pipeline.cli export` first; missing {missing}")
    with fakesnow.patch():
        conn = snowflake.connector.connect(database="PURE_INSIGHTS_SIM", schema="PORTAL")
        cur = conn.cursor()
        # Bootstrap: 00 is split so the CSVs can be loaded between DDL and COPY (which the emulator lacks).
        boot = SUITE[0]
        for stmt in split_statements(boot.read_text()):
            if not _code(stmt).startswith(EMULATOR_SKIP):
                cur.execute(stmt)
        duck = conn._duck_conn  # bulk load stands in for PUT + COPY INTO
        for file, table in LOADS.items():
            schema, name = table.split(".")
            duck.execute(
                f"INSERT INTO PURE_INSIGHTS_SIM.{schema}.{name} BY NAME "
                f"SELECT * FROM read_csv('{(simulated_dir / file).as_posix()}', header = true)"
            )
        ran = {}
        for path in SUITE[1:]:
            n = 0
            for stmt in split_statements(path.read_text()):
                cur.execute(stmt)
                n += 1
            ran[path.name] = n
        out = _results(cur)
        out["ran"] = ran
        conn.close()
    return out


def live() -> dict:
    """Run the full suite, including PUT + COPY INTO, against a real Snowflake account."""
    import snowflake.connector

    for var in ("SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD"):
        if not os.getenv(var):
            raise RuntimeError(f"{var} is not set — live verification needs a Snowflake account")
    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        role=os.getenv("SNOWFLAKE_ROLE", "SYSADMIN"),
    )
    cur = conn.cursor()
    boot = split_statements(SUITE[0].read_text())
    copy_stmts = [s for s in boot if _code(s).startswith("COPY INTO")]
    for stmt in boot:
        if not _code(stmt).startswith("COPY INTO"):
            cur.execute(stmt)
    for file in LOADS:
        cur.execute(
            f"PUT file://{(SIMULATED_DIR / file).as_posix()} @PURE_INSIGHTS_SIM.PORTAL.PIC_STAGE "
            "AUTO_COMPRESS=TRUE OVERWRITE=TRUE"
        )
    for stmt in copy_stmts:
        cur.execute(stmt)
    ran = {}
    for path in SUITE[1:]:
        n = 0
        for stmt in split_statements(path.read_text()):
            cur.execute(stmt)
            n += 1
        ran[path.name] = n
    out = _results(cur)
    out["ran"] = ran
    conn.close()
    return out
