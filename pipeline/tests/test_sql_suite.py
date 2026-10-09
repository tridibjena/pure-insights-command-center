"""Run the full CSV → PostgreSQL pipeline and the Snowflake SQL suite against the test database."""

from pic_pipeline import simulate_account_usage, sql_suite
from pic_pipeline.config import SimulationKnobs
from pic_pipeline.db import connect
from pic_pipeline.sql_suite import split_statements


def test_split_statements_respects_quotes_and_comments():
    sql = """-- header; with semicolon
    SELECT 'a;b' AS x;
    /* block; comment */
    SELECT 2;
    -- trailing comment only
    """
    stmts = split_statements(sql)
    assert len(stmts) == 2
    assert "'a;b'" in stmts[0]


def test_suite_is_portable_subset():
    """Guard against PostgreSQL-only syntax creeping into the Snowflake scripts."""
    banned = ["::", " FILTER (", "ILIKE", "QUALIFY", " IFF(", "FLATTEN", "INTERVAL '"]
    for path in sql_suite.POSTGRES_SCRIPTS:
        code = "\n".join(line.split("--")[0] for line in path.read_text().splitlines())
        for token in banned:
            assert token not in code, f"{path.name} uses non-portable syntax {token!r}"


def test_reconciliation_checks_all_pass(loaded_test_db):
    rows = sql_suite.verify(test=True)
    assert len(rows) == 6
    assert {r[5] for r in rows} == {"PASS"}


def test_database_counts(loaded_test_db):
    with connect(test=True) as conn, conn.cursor() as cur:
        cur.execute("""SELECT (SELECT count(*) FROM raw.report_monitoring_csv),
                              (SELECT count(*) FROM app.reports),
                              (SELECT count(*) FROM app.report_observations),
                              (SELECT count(*) FROM app.dq_issues WHERE rule_code = 'DQ_ORPHANED_OWNER'),
                              (SELECT count(*) FROM app.dq_issues WHERE rule_code = 'DQ_NEGATIVE_CREDITS'),
                              (SELECT count(*) FROM app.report_observations WHERE avg_load_time_sec > 15),
                              (SELECT count(*) FROM app.reports WHERE is_currently_orphaned)""")
        assert cur.fetchone() == (2000, 100, 2000, 245, 24, 1490, 14)


def test_unit_cost_handles_zero_views(loaded_test_db):
    with connect(test=True) as conn, conn.cursor() as cur:
        cur.execute("""SELECT count(*), count(snowflake_cost_per_view_usd)
                       FROM cost.v_unit_cost_report_month WHERE unit_cost_status = 'ZERO_VIEWS'""")
        assert cur.fetchone() == (4, 0)
        cur.execute("SELECT count(*) FROM cost.v_unit_cost_report_month WHERE unit_cost_status = 'CREDITS_QUARANTINED'")
        assert cur.fetchone()[0] == 24


def test_sql_and_python_agree_on_outliers(loaded_test_db):
    with connect(test=True) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT SUM(is_cost_per_view_outlier), SUM(is_peak_exceeds_views), SUM(is_zero_view_cost) "
            "FROM cost.v_aws_usage_discrepancy"
        )
        assert tuple(int(v) for v in cur.fetchone()) == (135, 93, 4)


def test_suite_measures_idle_untagged_and_method_divergence_when_present(loaded_test_db):
    """The default data has no idle/untagged usage; prove the SQL measures them when they exist."""
    try:
        simulate_account_usage.run(
            test=True, knobs=SimulationKnobs(idle_ratio=0.08, untagged_share=0.03, exec_jitter=0.3)
        )
        sql_suite.run(test=True)
        assert {r[5] for r in sql_suite.verify(test=True)} == {"PASS"}
        with connect(test=True) as conn, conn.cursor() as cur:
            cur.execute("SELECT SUM(credits_idle) FROM cost.v_warehouse_idle")
            assert float(cur.fetchone()[0]) > 0
            cur.execute("SELECT query_rows FROM cost.v_quarantine_summary WHERE attribution_status = 'UNTAGGED'")
            assert cur.fetchone()[0] == 600
            cur.execute(
                "SELECT MAX(ABS(difference_pct)) FROM cost.v_attribution_method_comparison "
                "WHERE report_id <> 'UNATTRIBUTED'"
            )
            assert float(cur.fetchone()[0]) > 0.001
    finally:
        simulate_account_usage.run(test=True)
        sql_suite.run(test=True)


def test_price_sensitivity_scales_linearly(loaded_test_db):
    with connect(test=True) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT edition, credit_price_usd, snowflake_cost_per_view_usd "
            "FROM cost.v_unit_cost_price_sensitivity ORDER BY ordinal"
        )
        rows = [(e, float(p), float(v)) for e, p, v in cur.fetchall()]
    assert [r[0] for r in rows] == ["Standard", "Enterprise", "Business Critical"]
    per_credit = rows[0][2] / rows[0][1]
    assert all(abs(v / p - per_credit) < 1e-9 for _, p, v in rows)
