"""Stage 2 — programmatic anomaly detection and cleaning.

Pure pandas, no database access, so every rule is unit-testable. `assess()` turns the raw
text rows into three frames:

* observations — one typed, flagged row per CSV row (nothing is dropped)
* reports      — one row per report_id with its current (latest-snapshot) ownership
* issues       — the anomaly register: one row per (CSV row, rule) hit

Cleaning policy, by defect:

* Orphaned owner ('nan' / 'ORPHANED_REPORT' / blank / malformed) → owner set to NULL, flagged.
* Negative Snowflake credits → physically impossible, so the value is quarantined
  (credits_clean = NULL). Not abs()'d, not zeroed. The row's other metrics stay usable.
* Load latency spikes (up to 55 s) → kept exactly as reported. They are real
  performance signal for the >15 s alert; they are annotated with a severity band,
  never capped or removed. Only non-numeric, <= 0 or absurd (> 300 s) values are invalid.
* Active users vs AWS cost discrepancies → annotated (zero-view cost, peak concurrent users
  above monthly views, IQR outlier on cost per view) so FinOps can investigate them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import FIRST_PERIOD, THRESHOLDS, Thresholds

EMAIL_RE = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$")
ORPHAN_MARKERS = {"", "nan", "none", "null", "orphaned_report"}
FAILURE_STATUSES = {"FAILED", "TIMED_OUT"}
KNOWN_STATUSES = {"SUCCESS", "FAILED", "TIMED_OUT", "UNKNOWN"}


@dataclass(frozen=True)
class Rule:
    code: str
    title: str
    category: str
    column: str
    severity: str
    action: str
    detection: str
    remediation: str


RULES: tuple[Rule, ...] = (
    Rule(
        "DQ_ORPHANED_OWNER",
        "Report has no owner",
        "OWNERSHIP",
        "owner_email",
        "HIGH",
        "NULLIFY",
        "owner_email is 'nan', 'ORPHANED_REPORT', blank, or not a valid e-mail address",
        "owner_email set to NULL; report surfaced on the Orphaned Reports page for reassignment",
    ),
    Rule(
        "DQ_NEGATIVE_CREDITS",
        "Negative Snowflake credit consumption",
        "COST",
        "snowflake_credits_consumed",
        "HIGH",
        "QUARANTINE",
        "snowflake_credits_consumed < 0 (credits cannot be negative)",
        "credits_clean set to NULL and excluded from cost attribution; raw value retained for audit",
    ),
    Rule(
        "DQ_LATENCY_SPIKE",
        "Load latency above the 15 s alert threshold",
        "PERFORMANCE",
        "avg_load_time_sec",
        "WARNING",
        "ANNOTATE",
        "avg_load_time_sec > 15 (strict); banded WARNING <= 30 < HIGH <= 45 < CRITICAL",
        "value kept unchanged (never capped); drives the LATENCY_SLO_BREACH real-time alert",
    ),
    Rule(
        "DQ_LATENCY_INVALID",
        "Load latency not a valid measurement",
        "INTEGRITY",
        "avg_load_time_sec",
        "HIGH",
        "QUARANTINE",
        "avg_load_time_sec non-numeric, <= 0, or > 300 s sanity ceiling",
        "latency set to NULL and band INVALID; not treated as a performance alert",
    ),
    Rule(
        "DQ_REFRESH_FAILURE",
        "Automated data refresh failed",
        "RELIABILITY",
        "last_refresh_status",
        "HIGH",
        "ANNOTATE",
        "last_refresh_status in ('FAILED', 'TIMED_OUT')",
        "kept; drives the REFRESH_FAILURE real-time alert",
    ),
    Rule(
        "DQ_STATUS_UNKNOWN",
        "Refresh status not reported",
        "RELIABILITY",
        "last_refresh_status",
        "WARNING",
        "ANNOTATE",
        "last_refresh_status = 'UNKNOWN' or an unrecognised value",
        "treated as a telemetry gap (not a failure); drives the TELEMETRY_GAP alert",
    ),
    Rule(
        "DQ_ZERO_VIEW_COST",
        "Cost incurred with zero active views",
        "COST",
        "monthly_active_views",
        "WARNING",
        "ANNOTATE",
        "monthly_active_views = 0 while AWS hosting cost or Snowflake credits > 0",
        "unit cost per view left NULL (undefined) and listed as pure waste",
    ),
    Rule(
        "DQ_PEAK_EXCEEDS_VIEWS",
        "Peak concurrent users exceed monthly views",
        "INTEGRITY",
        "concurrent_user_peak",
        "WARNING",
        "ANNOTATE",
        "concurrent_user_peak > monthly_active_views (each concurrent user implies >= 1 view)",
        "kept; usage counters for the report flagged as unreliable",
    ),
    Rule(
        "DQ_AWS_COST_PER_VIEW_OUTLIER",
        "AWS hosting cost out of line with active usage",
        "COST",
        "aws_hosting_cost_usd",
        "WARNING",
        "ANNOTATE",
        "aws_hosting_cost_usd / monthly_active_views > Q3 + 3 x IQR across all rows with views > 0",
        "kept; listed as a rightsizing / decommission candidate",
    ),
    Rule(
        "DQ_OWNER_CHURN",
        "Report owner changed between snapshots",
        "OWNERSHIP",
        "owner_email",
        "INFO",
        "ANNOTATE",
        "valid owner differs from the report's previous valid owner",
        "kept; current owner = owner in the latest snapshot",
    ),
)
RULES_BY_CODE = {r.code: r for r in RULES}

NUMERIC_COLUMNS = {
    "monthly_active_views": "int",
    "snowflake_credits_consumed": "float",
    "aws_hosting_cost_usd": "float",
    "query_count_last_30d": "int",
    "concurrent_user_peak": "int",
}


@dataclass
class Assessment:
    observations: pd.DataFrame
    reports: pd.DataFrame
    issues: pd.DataFrame
    aws_cpv_fence: float


def latency_band(seconds: float | None, t: Thresholds = THRESHOLDS) -> str:
    """Classify a latency reading. The alert threshold is strictly > t.latency_alert_sec."""
    if seconds is None or (isinstance(seconds, float) and np.isnan(seconds)):
        return "INVALID"
    if seconds <= 0 or seconds > t.latency_invalid_above_sec:
        return "INVALID"
    if seconds <= t.latency_alert_sec:
        return "OK"
    if seconds <= t.latency_high_above_sec:
        return "WARNING"
    if seconds <= t.latency_critical_above_sec:
        return "HIGH"
    return "CRITICAL"


def normalise_owner(value: str) -> str | None:
    v = (value or "").strip().lower()
    if v in ORPHAN_MARKERS or not EMAIL_RE.match(v):
        return None
    return v


def _parse_numeric(raw: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=raw.index)
    for col, kind in NUMERIC_COLUMNS.items():
        parsed = pd.to_numeric(raw[col].str.strip(), errors="coerce")
        bad = parsed.isna()
        if bad.any():
            rows = raw.loc[bad, "source_row_number"].tolist()[:10]
            raise ValueError(f"Column {col} has unparseable values at rows {rows}")
        if kind == "int":
            if not (parsed == parsed.round()).all():
                raise ValueError(f"Column {col} has non-integer values")
            parsed = parsed.astype("int64")
        out[col] = parsed
    # Latency is parsed leniently: invalid readings are a data-quality outcome, not a crash.
    out["avg_load_time_sec"] = pd.to_numeric(raw["avg_load_time_sec"].str.strip(), errors="coerce")
    return out


def assess(raw: pd.DataFrame, t: Thresholds = THRESHOLDS) -> Assessment:
    raw = raw.sort_values("source_row_number").reset_index(drop=True)
    num = _parse_numeric(raw)

    obs = pd.DataFrame(
        {
            "source_row_number": raw["source_row_number"].astype("int64"),
            "report_id": raw["report_id"].str.strip(),
            "report_name": raw["report_name"].str.strip(),
            "owner_raw": raw["owner_email"],
        }
    )

    # The CSV has no timestamp: each report appears once per pass, so the n-th occurrence
    # of a report is its n-th snapshot. Every report must have the same number of snapshots.
    obs["snapshot_seq"] = obs.groupby("report_id").cumcount() + 1
    per_report = obs.groupby("report_id")["snapshot_seq"].max()
    if per_report.nunique() != 1:
        raise ValueError("Reports have differing snapshot counts; snapshot model does not hold")
    first = pd.Period(FIRST_PERIOD, freq="M")
    obs["period_month"] = obs["snapshot_seq"].map(lambda k: (first + int(k) - 1).start_time.date())

    # Ownership
    obs["owner_email"] = obs["owner_raw"].map(normalise_owner)
    obs["is_orphaned"] = obs["owner_email"].isna()

    # Refresh status
    status = raw["last_refresh_status"].str.strip().str.upper()
    obs["refresh_status"] = status.where(status.isin(KNOWN_STATUSES), "UNKNOWN")
    obs["is_refresh_failure"] = status.isin(FAILURE_STATUSES)
    obs["is_status_unknown"] = ~status.isin(KNOWN_STATUSES - {"UNKNOWN"})

    # Usage & cost
    for col in ("monthly_active_views", "aws_hosting_cost_usd", "query_count_last_30d", "concurrent_user_peak"):
        obs[col] = num[col]
    obs["credits_raw"] = num["snowflake_credits_consumed"]
    obs["is_negative_credits"] = obs["credits_raw"] < 0
    obs["credits_clean"] = obs["credits_raw"].where(~obs["is_negative_credits"])

    # Latency: never capped. Only invalid readings are nulled.
    lat = num["avg_load_time_sec"]
    obs["latency_band"] = lat.map(lambda v: latency_band(v, t))
    obs["is_latency_invalid"] = obs["latency_band"].eq("INVALID")
    obs["avg_load_time_sec"] = lat.where(~obs["is_latency_invalid"])
    obs["is_latency_breach"] = obs["latency_band"].isin(["WARNING", "HIGH", "CRITICAL"])

    # Active users vs AWS cost
    views = obs["monthly_active_views"]
    obs["aws_cost_per_view"] = (obs["aws_hosting_cost_usd"] / views.where(views > 0)).round(6)
    obs["is_zero_view_cost"] = views.eq(0) & ((obs["aws_hosting_cost_usd"] > 0) | (obs["credits_raw"] > 0))
    obs["is_peak_exceeds_views"] = obs["concurrent_user_peak"] > views
    cpv = obs["aws_cost_per_view"].dropna()
    q1, q3 = cpv.quantile(0.25), cpv.quantile(0.75)  # linear interpolation = PERCENTILE_CONT
    fence = float(q3 + t.aws_cost_per_view_iqr_k * (q3 - q1))
    obs["is_aws_cost_per_view_outlier"] = obs["aws_cost_per_view"].gt(fence).fillna(False).astype(bool)

    # Ownership churn: compare each valid owner with the report's previous valid owner
    prev_owner = obs.groupby("report_id")["owner_email"].transform(lambda s: s.ffill().shift(1))
    obs["is_owner_change"] = obs["owner_email"].notna() & prev_owner.notna() & obs["owner_email"].ne(prev_owner)

    reports = _build_reports(obs)
    issues = _build_issues(raw, obs, t, fence)
    return Assessment(observations=obs, reports=reports, issues=issues, aws_cpv_fence=fence)


def _build_reports(obs: pd.DataFrame) -> pd.DataFrame:
    latest = obs.loc[obs.groupby("report_id")["snapshot_seq"].idxmax()].set_index("report_id")
    g = obs.groupby("report_id")
    reports = pd.DataFrame(
        {
            "report_name": g["report_name"].first(),
            "current_owner_email": latest["owner_email"],
            "is_currently_orphaned": latest["is_orphaned"],
            "latest_snapshot_seq": latest["snapshot_seq"],
            "orphaned_snapshot_count": g["is_orphaned"].sum().astype("int64"),
            "distinct_owner_count": g["owner_email"].nunique().astype("int64"),
            "owner_change_count": g["is_owner_change"].sum().astype("int64"),
        }
    )
    if (g["report_name"].nunique() != 1).any():
        raise ValueError("A report_id maps to more than one report_name")
    return reports.reset_index()


def _build_issues(raw: pd.DataFrame, obs: pd.DataFrame, t: Thresholds, fence: float) -> pd.DataFrame:
    frames = []

    def add(code: str, mask: pd.Series, raw_col: str, detail: pd.Series | str) -> None:
        rule = RULES_BY_CODE[code]
        hit = obs.loc[mask]
        if hit.empty:
            return
        detail_values = detail.loc[mask] if isinstance(detail, pd.Series) else detail
        frames.append(
            pd.DataFrame(
                {
                    "source_row_number": hit["source_row_number"],
                    "report_id": hit["report_id"],
                    "snapshot_seq": hit["snapshot_seq"],
                    "rule_code": code,
                    "column_name": rule.column,
                    "raw_value": raw.loc[mask, raw_col],
                    "detail": detail_values,
                    "action_taken": rule.action,
                }
            )
        )

    add(
        "DQ_ORPHANED_OWNER",
        obs["is_orphaned"],
        "owner_email",
        "owner marker '" + obs["owner_raw"].astype(str) + "' → NULL",
    )
    add(
        "DQ_NEGATIVE_CREDITS",
        obs["is_negative_credits"],
        "snowflake_credits_consumed",
        "credits quarantined from attribution",
    )
    add(
        "DQ_LATENCY_SPIKE",
        obs["is_latency_breach"],
        "avg_load_time_sec",
        "band " + obs["latency_band"] + f" (alert threshold > {t.latency_alert_sec:g} s)",
    )
    add("DQ_LATENCY_INVALID", obs["is_latency_invalid"], "avg_load_time_sec", "invalid latency reading")
    add("DQ_REFRESH_FAILURE", obs["is_refresh_failure"], "last_refresh_status", "refresh " + obs["refresh_status"])
    add("DQ_STATUS_UNKNOWN", obs["is_status_unknown"], "last_refresh_status", "no refresh outcome reported")
    add(
        "DQ_ZERO_VIEW_COST",
        obs["is_zero_view_cost"],
        "monthly_active_views",
        "AWS $" + obs["aws_hosting_cost_usd"].map("{:.2f}".format) + " with 0 views",
    )
    add(
        "DQ_PEAK_EXCEEDS_VIEWS",
        obs["is_peak_exceeds_views"],
        "concurrent_user_peak",
        "peak " + obs["concurrent_user_peak"].astype(str) + " > views " + obs["monthly_active_views"].astype(str),
    )
    add(
        "DQ_AWS_COST_PER_VIEW_OUTLIER",
        obs["is_aws_cost_per_view_outlier"],
        "aws_hosting_cost_usd",
        "$" + obs["aws_cost_per_view"].map(lambda v: f"{v:.3f}" if pd.notna(v) else "") + f"/view > fence ${fence:.3f}",
    )
    add("DQ_OWNER_CHURN", obs["is_owner_change"], "owner_email", "owner changed from previous snapshot")

    issues = pd.concat(frames, ignore_index=True)
    return issues.sort_values(["rule_code", "source_row_number"]).reset_index(drop=True)


def rules_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "rule_code": r.code,
                "title": r.title,
                "category": r.category,
                "column_name": r.column,
                "severity": r.severity,
                "action": r.action,
                "detection": r.detection,
                "remediation": r.remediation,
            }
            for r in RULES
        ]
    )
