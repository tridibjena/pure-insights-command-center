"""The cost SQL suite is valid Snowflake SQL and produces the same answers on a Snowflake emulator."""

import warnings

import pytest

from pic_pipeline import export_snowflake_csv, snowflake_check
from pic_pipeline.db import connect

warnings.filterwarnings("ignore", module="snowflake.connector")


def test_every_statement_parses_as_snowflake_sql():
    parsed = dict(snowflake_check.parse())
    assert set(parsed) == {p.name for p in snowflake_check.SUITE}
    assert all(n > 0 for n in parsed.values())


def test_suite_executes_on_snowflake_emulator_and_matches_postgres(loaded_test_db, tmp_path):
    export_snowflake_csv.run(test=True, out_dir=tmp_path)
    result = snowflake_check.emulate(tmp_path)
    assert {c[4] for c in result["checks"]} == {"PASS"}
    assert len(result["checks"]) == 6
    with connect(test=True) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT snowflake_credits, snowflake_cost_per_view_usd, fully_loaded_cost_per_view_usd "
            "FROM cost.v_unit_cost_portfolio"
        )
        pg = tuple(float(v) for v in cur.fetchone())
    assert result["portfolio"] == pytest.approx(pg, rel=1e-9)
