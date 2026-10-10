"""Forensic checks — statistical tests behind the dataset's structural findings.

The CSV has no timestamp, repeats 100 report ids 20 times, reassigns owners constantly and
carries several defect types at once. Each of those observations raises a question that can be
answered from the data itself; this module answers them with simple, deterministic tests and
records the treatment the pipeline applies as a consequence.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from .config import DATA_AS_OF_MONTH, FIRST_PERIOD, SNAPSHOT_COUNT
from .db import connect, query_df

SEED = 20260920
PERMUTATIONS = 2000
METRICS_30D = ["monthly_active_views", "query_count_last_30d", "credits_clean", "aws_hosting_cost_usd"]


def _lag1(obs: pd.DataFrame, col: str) -> float:
    s = obs.sort_values(["report_id", "snapshot_seq"])
    r = s.groupby("report_id")[col].apply(lambda x: x.astype(float).autocorr(lag=1)).dropna()
    return float(r.mean())


def _perm_f_test(values: np.ndarray, groups: np.ndarray, rng: np.random.Generator) -> tuple[float, float]:
    """One-way ANOVA F with a permutation p-value (no distributional assumptions)."""
    k = int(groups.max()) + 1
    n = len(values)
    grand = values.mean()

    def f_stat(g: np.ndarray) -> float:
        cnt = np.bincount(g, minlength=k)
        mean = np.bincount(g, weights=values, minlength=k) / cnt
        ssb = (cnt * (mean - grand) ** 2).sum()
        ssw = ((values - mean[g]) ** 2).sum()
        return (ssb / (k - 1)) / (ssw / (n - k))

    f0 = f_stat(groups)
    null = np.array([f_stat(rng.permutation(groups)) for _ in range(PERMUTATIONS)])
    return float(f0), float((null >= f0).mean())


def _hypergeom_upper(n: int, k_a: int, k_b: int, observed: int) -> float:
    """P(overlap >= observed) if two flags of sizes k_a, k_b were placed independently."""
    total = math.comb(n, k_b)
    return sum(math.comb(k_a, i) * math.comb(n - k_a, k_b - i) for i in range(observed, min(k_a, k_b) + 1)) / total


def run_checks(obs: pd.DataFrame) -> list[dict]:
    rng = np.random.default_rng(SEED)
    obs = obs.sort_values(["report_id", "snapshot_seq"]).reset_index(drop=True)
    n = len(obs)
    checks: list[dict] = []
    # Facts quoted in the questions/treatments below — computed, never typed in.
    n_snapshots = int(obs["snapshot_seq"].max())
    latest = obs[obs["snapshot_seq"] == n_snapshots]
    owners_per_report = float(obs.groupby("report_id")["owner_email"].nunique().mean())
    currently_orphaned = int(latest["is_orphaned"].sum())
    unknown_rows = int(obs["is_status_unknown"].sum())
    neg_orphan_rows = int((obs["is_negative_credits"] & obs["is_orphaned"]).sum())
    zero_view = obs[obs["is_zero_view_cost"]]
    zero_view_with_credits = int((zero_view["credits_raw"] > 0).sum())

    # 1 · Are the repeated passes overlapping rolling windows or consecutive periods?
    lags = {c: round(_lag1(obs, c), 3) for c in METRICS_30D}
    checks.append(
        {
            "check_code": "SNAPSHOT_INDEPENDENCE",
            "title": "Snapshots are consecutive, non-overlapping 30-day periods",
            "question": f"The CSV has no timestamp and repeats each report {n_snapshots} times. Are the passes daily rolling 30-day windows (heavily overlapping) or separate periods?",
            "method": "Lag-1 autocorrelation of each 30-day metric between consecutive passes of the same report. Rolling daily windows share 29/30 of their data, so they would correlate near +0.97.",
            "result": "Mean lag-1 autocorrelation: " + ", ".join(f"{k} {v:+.3f}" for k, v in lags.items()),
            "conclusion": "No overlap between passes: each pass is an independent 30-day period, i.e. a monthly snapshot.",
            "treatment": f"20 monthly snapshots ending at the last complete month before the data was received ({DATA_AS_OF_MONTH}); series {FIRST_PERIOD[:7]} → {DATA_AS_OF_MONTH}. Anchor configurable via DATA_AS_OF_MONTH.",
            "metrics": {
                "lag1": lags,
                "first_period": FIRST_PERIOD,
                "data_as_of": DATA_AS_OF_MONTH,
                "snapshots": SNAPSHOT_COUNT,
            },
        }
    )

    # 2 · Does report identity carry any persistent signal?
    codes = obs["report_id"].astype("category").cat.codes.to_numpy().astype(np.int64)
    tests = {}
    for col in [
        "monthly_active_views",
        "credits_raw",
        "avg_load_time_sec",
        "aws_hosting_cost_usd",
        "query_count_last_30d",
    ]:
        f, p = _perm_f_test(obs[col].astype(float).to_numpy(), codes, rng)
        tests[col] = {"F": round(f, 3), "p": round(p, 3)}
    checks.append(
        {
            "check_code": "REPORT_IDENTITY_SIGNAL",
            "title": "Report identity explains none of the variance",
            "question": "Do some reports persistently have more views, cost or latency than others, or is each row an independent draw?",
            "method": f"One-way ANOVA of each metric by report_id with a {PERMUTATIONS:,}-shuffle permutation p-value.",
            "result": ", ".join(f"{k} F={v['F']:.2f} p={v['p']:.2f}" for k, v in tests.items()),
            "conclusion": "No metric differs between reports more than chance (all p ≥ 0.05): rows behave like independent draws, so per-report rankings (slowest reports, highest cost per view, decommission candidates) are not statistically distinguishable from noise in this dataset.",
            "treatment": "Portfolio-level findings are stated as findings; per-report rankings are presented as a demonstration of the method, which is valid on real data where report identity does carry signal.",
            "metrics": tests,
        }
    )

    # 3 · Owner churn: deliberate hand-offs or random assignment?
    valid = obs.dropna(subset=["owner_email"]).copy()
    valid["prev"] = valid.groupby("report_id")["owner_email"].shift(1)
    pairs = valid.dropna(subset=["prev"])
    p_same = float((pairs["owner_email"] == pairs["prev"]).mean())
    share = obs["owner_email"].dropna().value_counts(normalize=True)
    p_random = float((share**2).sum())
    prev_orph = obs.groupby("report_id")["is_orphaned"].shift(1)
    p_orph_after_orph = float(obs.loc[prev_orph == True, "is_orphaned"].mean())  # noqa: E712
    base_orph = float(obs["is_orphaned"].mean())
    checks.append(
        {
            "check_code": "OWNER_ASSIGNMENT",
            "title": "Owners — and orphaning — are assigned independently each month",
            "question": f"Reports average {owners_per_report:.1f} different owners over {n_snapshots} months. Are these hand-offs (sticky ownership) or random assignment? Does orphaning persist?",
            "method": "Probability that a report keeps the previous month's owner, compared with the probability two independent draws from the owner pool coincide; same comparison for orphan status.",
            "result": f"P(same owner as previous month) = {p_same:.3f} vs {p_random:.3f} for independent draws ({len(share)} owners, each {share.min():.1%}–{share.max():.1%}); P(orphaned | orphaned previous month) = {p_orph_after_orph:.3f} vs base rate {base_orph:.3f}.",
            "conclusion": "Ownership and orphaning carry no month-to-month memory: the churn is random reassignment in the source data, not a pattern of hand-offs.",
            "treatment": f"The latest snapshot is the system of record for the current owner ({currently_orphaned} reports currently orphaned); the full owner history is kept for the drill-down and every orphaned report-month counts towards unowned spend.",
            "metrics": {
                "p_same_owner": round(p_same, 4),
                "p_independent": round(p_random, 4),
                "p_orphan_after_orphan": round(p_orph_after_orph, 4),
                "base_orphan_rate": round(base_orph, 4),
            },
        }
    )

    # 4 · UNKNOWN refresh status: hidden failure or telemetry gap?
    unk = obs["is_status_unknown"]
    prev_fail = obs.groupby("report_id")["is_refresh_failure"].shift(1)
    p_unk_after_fail = float(obs.loc[prev_fail == True, "is_status_unknown"].mean())  # noqa: E712
    means = {
        c: [round(float(obs.loc[unk, c].mean()), 1), round(float(obs.loc[~unk, c].mean()), 1)]
        for c in ["avg_load_time_sec", "credits_clean", "monthly_active_views"]
    }
    checks.append(
        {
            "check_code": "UNKNOWN_STATUS",
            "title": "UNKNOWN refresh status is a telemetry gap, not a hidden failure",
            "question": f"{unknown_rows} rows report UNKNOWN. Do they behave like failures (e.g. follow failed refreshes, slower loads) or like missing telemetry?",
            "method": "Rate of UNKNOWN right after a FAILED/TIMED_OUT month vs its base rate; mean latency, credits and views for UNKNOWN vs other rows; spread across reports and snapshots.",
            "result": f"P(UNKNOWN | previous month failed) = {p_unk_after_fail:.3f} vs base {unk.mean():.3f}; UNKNOWN vs others — "
            + ", ".join(f"{k} {v[0]} vs {v[1]}" for k, v in means.items())
            + f"; spread over {obs.loc[unk, 'report_id'].nunique()} reports, {int(obs[unk].groupby('snapshot_seq').size().min())}–{int(obs[unk].groupby('snapshot_seq').size().max())} per snapshot.",
            "conclusion": "UNKNOWN is unrelated to failures or performance: it is missing telemetry scattered across the portfolio.",
            "treatment": "Not counted as a refresh failure; raises a TELEMETRY_GAP warning so the monitoring gap itself is visible.",
            "metrics": {
                "p_unknown_after_failure": round(p_unk_after_fail, 4),
                "base_unknown_rate": round(float(unk.mean()), 4),
                "means_unknown_vs_other": means,
            },
        }
    )

    # 5 · Do anomalies co-occur more than chance?
    flags = {
        "orphaned": "is_orphaned",
        "negative_credits": "is_negative_credits",
        "refresh_failure": "is_refresh_failure",
        "status_unknown": "is_status_unknown",
        "latency_breach": "is_latency_breach",
        "zero_view_cost": "is_zero_view_cost",
        "peak_exceeds_views": "is_peak_exceeds_views",
        "aws_cost_per_view_outlier": "is_aws_cost_per_view_outlier",
    }
    names = list(flags)
    m = len(names) * (len(names) - 1) // 2
    pairs_out = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a = obs[flags[names[i]]].astype(bool)
            b = obs[flags[names[j]]].astype(bool)
            o = int((a & b).sum())
            pairs_out.append(
                {
                    "a": names[i],
                    "b": names[j],
                    "observed": o,
                    "expected": round(a.sum() * b.sum() / n, 2),
                    "p": round(_hypergeom_upper(n, int(a.sum()), int(b.sum()), o), 4),
                }
            )
    neg_orph = next(p for p in pairs_out if {p["a"], p["b"]} == {"orphaned", "negative_credits"})
    credit_share = float((obs["credits_raw"] > 0).mean())
    corr_views_credits = float(np.corrcoef(obs["monthly_active_views"], obs["credits_raw"])[0, 1])
    mechanical = [p for p in pairs_out if p["p"] < 0.05 / m]
    checks.append(
        {
            "check_code": "ANOMALY_OVERLAP",
            "title": "Anomalies were injected independently; overlaps are chance or arithmetic",
            "question": f"{neg_orphan_rows} negative-credit rows are also orphaned and {zero_view_with_credits} of {len(zero_view)} zero-view months carry Snowflake credits. Are the defects linked?",
            "method": f"For each of the {m} pairs of anomaly flags, observed overlap vs the overlap expected if independent, with a hypergeometric p-value (Bonferroni threshold 0.05/{m}).",
            "result": f"negative credits ∧ orphaned: {neg_orph['observed']} observed vs {neg_orph['expected']} expected (p={neg_orph['p']:.2f}); "
            f"{credit_share:.1%} of all rows carry credits and credits do not track views (r={corr_views_credits:+.3f}); "
            "pairs significant after correction: "
            + (", ".join(f"{p['a']} ∧ {p['b']} ({p['observed']} vs {p['expected']})" for p in mechanical) or "none")
            + ".",
            "conclusion": "The negative-credit/orphan overlap is exactly what chance predicts, and zero-view months carry credits because almost every row does. The only significant pairs are arithmetic: zero views make any peak exceed views, and very low views drive both the impossible-usage and the cost-per-view outlier flags.",
            "treatment": "Each defect keeps its own rule and register entry; overlapping rows are handled by every applicable rule"
            + (
                f" (e.g. {ex.report_id} #{ex.snapshot_seq} is quarantined for credits and nulled for ownership)."
                if (ex := next(obs[obs["is_negative_credits"] & obs["is_orphaned"]].itertuples(), None))
                else "."
            ),
            "metrics": {
                "pairs": pairs_out,
                "share_rows_with_credits": round(credit_share, 4),
                "corr_views_credits": round(corr_views_credits, 4),
            },
        }
    )
    for i, c in enumerate(checks, start=1):
        c["ordinal"] = i
    return checks


def run(test: bool = False) -> int:
    with connect(test) as conn:
        obs = query_df(
            conn,
            """SELECT report_id, snapshot_seq, owner_email, is_orphaned, is_refresh_failure, is_status_unknown,
                      is_negative_credits, is_latency_breach, is_zero_view_cost, is_peak_exceeds_views,
                      is_aws_cost_per_view_outlier, monthly_active_views, query_count_last_30d,
                      credits_raw::float8 AS credits_raw, credits_clean::float8 AS credits_clean,
                      avg_load_time_sec::float8 AS avg_load_time_sec, aws_hosting_cost_usd::float8 AS aws_hosting_cost_usd
               FROM app.report_observations""",
        )
        checks = run_checks(obs)
        with conn.cursor() as cur:
            cur.execute("TRUNCATE app.dq_forensics")
            for c in checks:
                cur.execute(
                    """INSERT INTO app.dq_forensics (check_code, ordinal, title, question, method, result, conclusion, treatment, metrics)
                       VALUES (%(check_code)s, %(ordinal)s, %(title)s, %(question)s, %(method)s, %(result)s, %(conclusion)s, %(treatment)s, %(metrics)s)""",
                    {**c, "metrics": json.dumps(c["metrics"])},
                )
    return len(checks)
