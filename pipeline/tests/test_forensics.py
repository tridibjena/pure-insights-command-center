"""The structural findings are backed by deterministic statistical tests."""

import pytest

from pic_pipeline.forensics import run_checks


@pytest.fixture(scope="module")
def checks(assessment):
    obs = assessment.observations.assign(
        credits_clean=lambda d: d["credits_clean"].astype(float),
        credits_raw=lambda d: d["credits_raw"].astype(float),
    )
    return {c["check_code"]: c for c in run_checks(obs)}


def test_snapshots_are_non_overlapping_periods(checks):
    lags = checks["SNAPSHOT_INDEPENDENCE"]["metrics"]["lag1"]
    assert all(abs(v) < 0.15 for v in lags.values())  # rolling daily windows would be ~ +0.97


def test_report_identity_carries_no_signal(checks):
    assert all(t["p"] >= 0.05 for t in checks["REPORT_IDENTITY_SIGNAL"]["metrics"].values())


def test_owner_assignment_has_no_memory(checks):
    m = checks["OWNER_ASSIGNMENT"]["metrics"]
    assert abs(m["p_same_owner"] - m["p_independent"]) < 0.03
    assert m["p_orphan_after_orphan"] < m["base_orphan_rate"] + 0.05


def test_unknown_status_is_not_a_hidden_failure(checks):
    m = checks["UNKNOWN_STATUS"]["metrics"]
    assert abs(m["p_unknown_after_failure"] - m["base_unknown_rate"]) < 0.02


def test_anomaly_overlaps_are_chance(checks):
    pairs = checks["ANOMALY_OVERLAP"]["metrics"]["pairs"]
    neg_orph = next(p for p in pairs if {p["a"], p["b"]} == {"orphaned", "negative_credits"})
    assert neg_orph["observed"] == 3 and neg_orph["expected"] == pytest.approx(2.94, abs=0.01)
    assert neg_orph["p"] > 0.05


def test_checks_are_deterministic(assessment):
    obs = assessment.observations.assign(credits_clean=lambda d: d["credits_clean"].astype(float))
    a = run_checks(obs)
    b = run_checks(obs)
    assert [c["result"] for c in a] == [c["result"] for c in b]
