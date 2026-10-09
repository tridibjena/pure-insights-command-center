"""Rule-level tests: each injected anomaly is detected and cleaned as documented."""

import pandas as pd
import pytest

from pic_pipeline.quality_rules import RULES, assess, latency_band, normalise_owner
from tests.conftest import make_raw


# ── Profile of the real CSV (these are the documented counts) ────────────────
def test_structure_is_100_reports_by_20_snapshots(assessment):
    obs = assessment.observations
    assert len(obs) == 2000
    assert obs["report_id"].nunique() == 100
    assert obs.groupby("report_id").size().eq(20).all()
    # Row i is the (i // 100 + 1)-th snapshot — the order assumption holds for every row
    assert (obs["snapshot_seq"] == (obs["source_row_number"] - 1) // 100 + 1).all()
    assert str(obs["period_month"].min()) == "2025-02-01"
    assert str(obs["period_month"].max()) == "2026-09-01"


def test_orphaned_owner_markers(assessment):
    obs = assessment.observations
    orphaned = obs[obs["is_orphaned"]]
    assert len(orphaned) == 245
    assert orphaned["owner_raw"].value_counts().to_dict() == {"nan": 128, "ORPHANED_REPORT": 117}
    assert orphaned["owner_email"].isna().all()
    assert assessment.reports["is_currently_orphaned"].sum() == 14


def test_negative_credits_are_quarantined_not_zeroed(assessment):
    obs = assessment.observations
    neg = obs[obs["is_negative_credits"]]
    assert len(neg) == 24
    assert neg["credits_raw"].min() == pytest.approx(-13.6)
    assert neg["credits_raw"].max() == pytest.approx(-0.8)
    assert neg["credits_clean"].isna().all()
    assert obs["credits_clean"].sum() == pytest.approx(1_206_352.48, abs=1e-6)
    assert (obs["credits_clean"].dropna() >= 0).all()


def test_latency_spikes_are_kept_and_banded(assessment):
    obs = assessment.observations
    assert obs["avg_load_time_sec"].max() == 55.0  # never capped
    assert (obs["avg_load_time_sec"] == 55.0).sum() == 6
    assert obs["is_latency_breach"].sum() == 1490
    assert (obs["avg_load_time_sec"] == 15.0).sum() == 7
    assert not obs.loc[obs["avg_load_time_sec"] == 15.0, "is_latency_breach"].any()
    assert obs["latency_band"].value_counts().to_dict() == {"WARNING": 580, "HIGH": 552, "OK": 510, "CRITICAL": 358}
    assert obs["is_latency_invalid"].sum() == 0


def test_refresh_status(assessment):
    obs = assessment.observations
    assert obs["is_refresh_failure"].sum() == 564
    assert obs["is_status_unknown"].sum() == 100


def test_usage_vs_cost_discrepancies(assessment):
    obs = assessment.observations
    assert obs["is_zero_view_cost"].sum() == 4
    assert obs.loc[obs["monthly_active_views"] == 0, "aws_cost_per_view"].isna().all()
    assert obs["is_peak_exceeds_views"].sum() == 93
    assert assessment.aws_cpv_fence == pytest.approx(2.0641, abs=1e-3)
    assert obs["is_aws_cost_per_view_outlier"].sum() == 135


def test_issue_register_matches_flags(assessment):
    counts = assessment.issues["rule_code"].value_counts()
    obs = assessment.observations
    assert counts["DQ_ORPHANED_OWNER"] == obs["is_orphaned"].sum()
    assert counts["DQ_NEGATIVE_CREDITS"] == obs["is_negative_credits"].sum()
    assert counts["DQ_LATENCY_SPIKE"] == obs["is_latency_breach"].sum()
    assert set(counts.index) <= {r.code for r in RULES}


# ── Boundary behaviour on synthetic rows ─────────────────────────────────────
@pytest.mark.parametrize(
    ("seconds", "band"),
    [
        (15.0, "OK"),
        (15.01, "WARNING"),
        (30.0, "WARNING"),
        (30.01, "HIGH"),
        (45.0, "HIGH"),
        (45.01, "CRITICAL"),
        (55.0, "CRITICAL"),
        (0.0, "INVALID"),
        (-1.0, "INVALID"),
        (301.0, "INVALID"),
        (float("nan"), "INVALID"),
    ],
)
def test_latency_band_boundaries(seconds, band):
    assert latency_band(seconds) == band


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("nan", None),
        ("NaN", None),
        ("ORPHANED_REPORT", None),
        ("", None),
        ("  ", None),
        ("not-an-email", None),
        ("User_7@Company.com ", "user_7@company.com"),
    ],
)
def test_owner_normalisation(value, expected):
    assert normalise_owner(value) == expected


def test_invalid_latency_is_quarantined_not_alerted():
    a = assess(make_raw([{"avg_load_time_sec": "-1"}, {"avg_load_time_sec": "abc"}, {"avg_load_time_sec": "55"}]))
    obs = a.observations
    assert obs["latency_band"].tolist() == ["INVALID", "INVALID", "CRITICAL"]
    assert obs["avg_load_time_sec"].isna().tolist() == [True, True, False]
    assert obs["is_latency_breach"].tolist() == [False, False, True]
    assert (a.issues["rule_code"] == "DQ_LATENCY_INVALID").sum() == 2


def test_unrecognised_status_is_a_telemetry_gap():
    obs = assess(make_raw([{"last_refresh_status": "weird"}])).observations
    assert obs.loc[0, "refresh_status"] == "UNKNOWN"
    assert bool(obs.loc[0, "is_status_unknown"]) and not bool(obs.loc[0, "is_refresh_failure"])


def test_unparseable_required_numeric_fails_fast():
    with pytest.raises(ValueError, match="monthly_active_views"):
        assess(make_raw([{"monthly_active_views": "lots"}]))


def test_current_owner_is_latest_snapshot():
    rows = [{"owner_email": "a@company.com"}, {"owner_email": "b@company.com"}, {"owner_email": "nan"}]
    reports = assess(make_raw(rows)).reports
    r = reports.iloc[0]
    assert pd.isna(r["current_owner_email"]) and bool(r["is_currently_orphaned"])
    assert r["distinct_owner_count"] == 2 and r["owner_change_count"] == 1
