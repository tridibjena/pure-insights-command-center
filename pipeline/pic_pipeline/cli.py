"""Command-line entry point: python -m pic_pipeline.cli <stage> [--test]

Stages: migrate · ingest · clean · simulate · cost · verify · export · dq-report · findings · all
"""

from __future__ import annotations

import argparse
import sys
import time

from . import clean, dq_report, export_snowflake_csv, findings, ingest_csv, migrate, simulate_account_usage, sql_suite


def _verify(test: bool) -> None:
    for no, name, expected, actual, diff, status in sql_suite.verify(test):
        print(f"  [{status}] {no}. {name:<45} expected={expected:>16} actual={actual:>16} diff={diff}")


STAGES = {
    "migrate": lambda test: print(f"  applied: {migrate.run(test) or 'up to date'}"),
    "ingest": lambda test: print(f"  raw rows landed: {ingest_csv.run(test)}"),
    "clean": lambda test: print(f"  {clean.run(test)}"),
    "simulate": lambda test: print(f"  {simulate_account_usage.run(test)}"),
    "cost": lambda test: print("  " + ", ".join(f"{r.script} ({r.statements})" for r in sql_suite.run(test))),
    "verify": _verify,
    "export": lambda test: print(f"  {export_snowflake_csv.run(test)}"),
    "dq-report": lambda test: print(f"  wrote {dq_report.run(test)}"),
    "findings": lambda test: print(f"  wrote {findings.run(test)}"),
}
ALL = ["migrate", "ingest", "clean", "simulate", "cost", "verify", "export", "dq-report", "findings"]
DATA_ONLY = ["migrate", "ingest", "clean", "simulate", "cost", "verify"]


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
