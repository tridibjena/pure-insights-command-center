"""Command-line entry point: python -m pic_pipeline.cli <stage> [--test]

Stages: migrate · ingest · clean · forensics · simulate · cost · verify · export · snowflake ·
snowflake-live · dq-report · findings · all
"""

from __future__ import annotations

import argparse
import sys
import time

from . import (
    clean,
    dq_report,
    export_snowflake_csv,
    findings,
    forensics,
    ingest_csv,
    migrate,
    simulate_account_usage,
    snowflake_check,
    sql_suite,
)


def _snowflake(test: bool, live: bool = False) -> None:
    for name, n in snowflake_check.parse():
        print(f"  parsed as Snowflake SQL: {name} ({n} statements)")
    res = snowflake_check.live() if live else snowflake_check.emulate()
    where = "live Snowflake account" if live else "fakesnow emulator (Snowflake dialect on DuckDB)"
    print(f"  executed on {where}: " + ", ".join(f"{k} ({v})" for k, v in res["ran"].items()))
    for no, name, expected, actual, status in res["checks"]:
        print(f"  [{status}] {no}. {name:<45} expected={float(expected):>16.4f} actual={float(actual):>16.4f}")
    credits, sf_view, full_view = res["portfolio"]
    print(f"  portfolio: {credits:,.2f} credits · ${sf_view:.4f} Snowflake/view · ${full_view:.4f} fully loaded/view")
    if any(c[4] != "PASS" for c in res["checks"]):
        raise SystemExit("reconciliation failed on Snowflake")


def _verify(test: bool) -> None:
    for no, name, expected, actual, diff, status in sql_suite.verify(test):
        print(f"  [{status}] {no}. {name:<45} expected={expected:>16} actual={actual:>16} diff={diff}")


STAGES = {
    "migrate": lambda test: print(f"  applied: {migrate.run(test) or 'up to date'}"),
    "ingest": lambda test: print(f"  raw rows landed: {ingest_csv.run(test)}"),
    "clean": lambda test: print(f"  {clean.run(test)}"),
    "forensics": lambda test: print(f"  {forensics.run(test)} forensic checks recorded"),
    "simulate": lambda test: print(f"  {simulate_account_usage.run(test)}"),
    "cost": lambda test: print("  " + ", ".join(f"{r.script} ({r.statements})" for r in sql_suite.run(test))),
    "verify": _verify,
    "export": lambda test: print(f"  {export_snowflake_csv.run(test)}"),
    "dq-report": lambda test: print(f"  wrote {dq_report.run(test)}"),
    "findings": lambda test: print(f"  wrote {findings.run(test)}"),
    "snowflake": lambda test: _snowflake(test),
    "snowflake-live": lambda test: _snowflake(test, live=True),
}
ALL = [
    "migrate",
    "ingest",
    "clean",
    "forensics",
    "simulate",
    "cost",
    "verify",
    "export",
    "snowflake",
    "dq-report",
    "findings",
]
DATA_ONLY = ["migrate", "ingest", "clean", "forensics", "simulate", "cost", "verify"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pic_pipeline", description=__doc__)
    parser.add_argument("stage", choices=[*STAGES, "all", "data"])
    parser.add_argument("--test", action="store_true", help="target the test database")
    args = parser.parse_args(argv)
    stages = ALL if args.stage == "all" else DATA_ONLY if args.stage == "data" else [args.stage]
    for stage in stages:
        started = time.perf_counter()
        print(f"▸ {stage}")
        STAGES[stage](args.test)
        print(f"  done in {time.perf_counter() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
