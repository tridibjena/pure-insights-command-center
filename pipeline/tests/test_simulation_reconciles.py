"""The simulated ACCOUNT_USAGE logs must reconcile exactly to the CSV credits."""

import numpy as np
import pytest

from pic_pipeline.config import SimulationKnobs
from pic_pipeline.simulate_account_usage import TAG_PREFIX, simulate


@pytest.fixture(scope="module")
def tables(assessment):
    obs = assessment.observations[
        ["source_row_number", "report_id", "period_month", "refresh_status", "query_count_last_30d", "credits_raw"]
    ]
    return simulate(obs)


def test_attribution_reconciles_per_observation(assessment, tables):
    qa = tables["account_usage.query_attribution_history"]
    tagged = qa[qa["query_tag"].notna()].copy()
    tagged["report_id"] = tagged["query_tag"].str.removeprefix(TAG_PREFIX)
    start_utc = tagged["start_time"].dt.tz_convert("UTC").dt.tz_localize(None)
    tagged["period_month"] = start_utc.dt.to_period("M").dt.start_time.dt.date
    got = tagged.groupby(["report_id", "period_month"])["credits_attributed_compute"].sum()
    want = assessment.observations.set_index(["report_id", "period_month"])["credits_raw"]
    assert np.allclose(got.loc[want.index].to_numpy(), want.to_numpy(), atol=1e-6)


def test_negative_defect_flows_into_logs(tables):
    qa = tables["account_usage.query_attribution_history"]
    neg = qa[qa["credits_attributed_compute"] < 0]
    assert neg["query_tag"].nunique() == 24
    assert neg["credits_attributed_compute"].sum() == pytest.approx(-161.04, abs=1e-6)


def test_metering_bills_only_valid_compute(tables):
    qa = tables["account_usage.query_attribution_history"]
    m = tables["account_usage.warehouse_metering_history"]
    valid = qa.loc[qa["credits_attributed_compute"] >= 0, "credits_attributed_compute"].sum()
    assert m["credits_attributed_compute_queries"].sum() == pytest.approx(valid, rel=1e-9)
    assert (m["credits_used_compute"] >= m["credits_attributed_compute_queries"]).all()


def test_failed_refreshes_leave_failed_queries(tables):
    qh = tables["account_usage.query_history"]
    assert (qh["execution_status"] == "FAIL").sum() == 564
    assert set(qh.loc[qh["execution_status"] == "FAIL", "error_code"]) == {"000630", "002003"}


def test_deterministic(assessment):
    obs = assessment.observations[
        ["source_row_number", "report_id", "period_month", "refresh_status", "query_count_last_30d", "credits_raw"]
    ].head(50)
    a = simulate(obs)["account_usage.query_history"]
    b = simulate(obs)["account_usage.query_history"]
    assert a["query_id"].equals(b["query_id"]) and a["execution_time"].equals(b["execution_time"])


def test_default_simulation_invents_no_spend(tables):
    """The CSV has no evidence of idle or untagged usage, so by default none is simulated."""
    qa = tables["account_usage.query_attribution_history"]
    m = tables["account_usage.warehouse_metering_history"]
    assert qa["query_tag"].notna().all()
    assert np.allclose(m["credits_used_compute"], m["credits_attributed_compute_queries"])


def test_knobs_switch_on_idle_untagged_and_jitter(assessment):
    obs = assessment.observations[
        ["source_row_number", "report_id", "period_month", "refresh_status", "query_count_last_30d", "credits_raw"]
    ].head(300)
    t = simulate(obs, knobs=SimulationKnobs(idle_ratio=0.1, untagged_share=0.03, exec_jitter=0.3))
    qa = t["account_usage.query_attribution_history"]
    m = t["account_usage.warehouse_metering_history"]
    assert qa["query_tag"].isna().sum() == 600
    assert m["credits_used_compute"].sum() == pytest.approx(
        m["credits_attributed_compute_queries"].sum() * 1.1, rel=1e-6
    )
