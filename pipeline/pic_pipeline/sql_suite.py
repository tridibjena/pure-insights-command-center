"""Run the Snowflake cost-allocation SQL suite (sql/snowflake/01-09) against PostgreSQL.

The scripts are written in a portable ANSI subset, so the very same files run on
Snowflake. Here they (re)create the `cost.*` views the Express API reads, and
`verify()` asserts every reconciliation check in 09 passes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .config import SQL_SUITE_DIR
from .db import connect

POSTGRES_SCRIPTS = [f for f in sorted(SQL_SUITE_DIR.glob("*.sql")) if not f.name.startswith("00_")]


def split_statements(sql: str) -> list[str]:
    """Split on top-level semicolons, ignoring those in quotes and comments."""
    out, buf = [], []
    i, n = 0, len(sql)
    in_single = in_line_comment = in_block_comment = False
    while i < n:
        c, nxt = sql[i], sql[i + 1] if i + 1 < n else ""
        if in_line_comment:
            if c == "\n":
                in_line_comment = False
        elif in_block_comment:
            if c == "*" and nxt == "/":
                in_block_comment = False
                buf.append("*/")
                i += 2
                continue
        elif in_single:
            if c == "'":
                in_single = False
        elif c == "-" and nxt == "-":
            in_line_comment = True
        elif c == "/" and nxt == "*":
            in_block_comment = True
        elif c == "'":
            in_single = True
        elif c == ";":
            stmt = "".join(buf).strip()
            if _has_code(stmt):
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    tail = "".join(buf).strip()
    if _has_code(tail):
        out.append(tail)
    return out


def _has_code(stmt: str) -> bool:
    lines = []
    in_block = False
    for line in stmt.splitlines():
        s = line.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if s.startswith("/*"):
            in_block = "*/" not in s
            continue
        if s and not s.startswith("--"):
            lines.append(s)
    return bool(lines)


@dataclass
class ScriptResult:
    script: str
    statements: int
    result_sets: list[tuple[list[str], list[tuple]]] = field(default_factory=list)


def run(test: bool = False, scripts: list[Path] | None = None) -> list[ScriptResult]:
    results: list[ScriptResult] = []
    with connect(test) as conn, conn.cursor() as cur:
        # Views are rebuilt from scratch so column changes in the scripts always apply.
        cur.execute("DROP SCHEMA IF EXISTS cost CASCADE")
        cur.execute("CREATE SCHEMA cost")
        for path in scripts or POSTGRES_SCRIPTS:
            stmts = split_statements(path.read_text())
            res = ScriptResult(path.name, len(stmts))
            for stmt in stmts:
                cur.execute(stmt)
                if cur.description:
                    res.result_sets.append(([d.name for d in cur.description], cur.fetchall()))
            results.append(res)
    return results


def verify(test: bool = False) -> list[tuple]:
    """Return reconciliation rows; raise if any check fails."""
    with connect(test) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT check_no, check_name, expected, actual, difference, status "
            "FROM cost.v_reconciliation_checks ORDER BY check_no"
        )
        rows = cur.fetchall()
    failed = [r for r in rows if r[5] != "PASS"]
    if failed:
        raise AssertionError(f"Reconciliation failed: {failed}")
    return rows
