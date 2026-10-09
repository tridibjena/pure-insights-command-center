"""Stage 3 — simulate Snowflake SNOWFLAKE.ACCOUNT_USAGE logs from the cleaned observations.

The CSV gives credits per report per 30-day period but no query-, warehouse- or hour-level
detail, which is what real ACCOUNT_USAGE exposes. This module generates that detail
deterministically (fixed seed) so the Task 3 SQL suite has realistic logs to attribute,
and so the attribution can be *proved* to reconcile back to the CSV.

Design (documented in docs/COST_ALLOCATION_METHODOLOGY.md):

* Three reporting warehouses; each report is pinned to one (report number mod 3).
* QUERY_HISTORY holds representative query batches: one row per ~1,000 executions in
  query_count_last_30d (minimum 1 per observation). Each row is tagged
  'pure-insights:report=<report_id>' — the portal sets QUERY_TAG per dashboard request.
* QUERY_ATTRIBUTION_HISTORY splits each observation's credits across its batches in
  proportion to execution time, so per-report Method A totals equal the CSV exactly.
  The 24 negative-credit observations are carried through as negative attributions:
  the injected defect exists in the source logs and the SQL suite must filter it.
* A small volume of untagged ad-hoc analyst queries shares the warehouses.
* WAREHOUSE_METERING_HISTORY is hourly: valid attributed credits (tagged + untagged) booked
  to the hour each batch starts, plus warehouse idle time at a fixed per-warehouse ratio.
  credits_attributed_compute_queries excludes idle, as in Snowflake.
* Failed refreshes leave a failed query batch (TIMED_OUT → error 000630 statement timeout).
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

from .db import connect, copy_dataframe, query_df

SEED = 20260101
EXECUTIONS_PER_ROW = 1_000
APP_USER = "SVC_PURE_INSIGHTS"
APP_ROLE = "PURE_INSIGHTS_APP"
TAG_PREFIX = "pure-insights:report="

WAREHOUSES = pd.DataFrame(
    {
        "warehouse_id": [101, 102, 103],
        "warehouse_name": ["PI_REPORTING_WH_S", "PI_REPORTING_WH_M", "PI_REPORTING_WH_L"],
        "warehouse_size": ["Small", "Medium", "Large"],
        "credits_per_hour": [2.0, 4.0, 8.0],
        "idle_ratio": [0.12, 0.08, 0.05],  # idle credits as a share of busy credits
    }
)
UNTAGGED_SHARE = 0.03  # ad-hoc credits relative to tagged report credits
ERRORS = {
    "TIMED_OUT": (
        "000630",
        "Statement reached its statement or warehouse timeout of 3,600 second(s) and was canceled.",
    ),
    "FAILED": ("002003", "SQL compilation error: Object 'PI_MART.REPORT_SOURCE' does not exist or not authorized."),
}


def _qid(*parts: object) -> str:
    h = hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()
    return f"01b{h[:5]}-0000-{h[5:9]}-0000-{h[9:21]}"


def _random_starts(rng: np.random.Generator, month_start: pd.Timestamp, n: int) -> pd.DatetimeIndex:
    month_end = month_start + pd.offsets.MonthBegin(1)
    span = (month_end - month_start).total_seconds() - 3_600
    offsets = np.sort(rng.uniform(0, span, n))
    return month_start + pd.to_timedelta(offsets, unit="s")


def simulate(obs: pd.DataFrame, seed: int = SEED) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    obs = obs.sort_values("source_row_number").reset_index(drop=True)
    report_num = obs["report_id"].str.extract(r"(\d+)$")[0].astype(int)
    wh = WAREHOUSES.iloc[(report_num % 3).to_numpy()].reset_index(drop=True)

    rows: list[dict] = []
    for i, o in obs.iterrows():
        w = wh.iloc[i]
        n = max(1, round(o["query_count_last_30d"] / EXECUTIONS_PER_ROW))
        month_start = pd.Timestamp(o["period_month"], tz="UTC")
        starts = _random_starts(rng, month_start, n)
        # Execution time follows the credits each batch burns at the warehouse's hourly rate,
        # with lognormal jitter for concurrency (why Method B only approximates Method A).
        weights = rng.lognormal(0.0, 0.6, n)
        weights /= weights.sum()
        credits = float(o["credits_raw"]) * weights
        busy_hours = np.abs(credits) / w["credits_per_hour"]
        exec_ms = np.maximum(1, (busy_hours * 3.6e6 * rng.lognormal(0.0, 0.3, n))).round().astype(np.int64)
        compile_ms = rng.integers(40, 900, n)
        queued_ms = np.where(rng.random(n) < 0.15, rng.integers(500, 30_000, n), 0)
        failed_idx = 0 if o["refresh_status"] in ERRORS else -1
        for j in range(n):
            status = "FAIL" if j == failed_idx else "SUCCESS"
            err = ERRORS.get(o["refresh_status"]) if status == "FAIL" else None
            elapsed = int(exec_ms[j] + compile_ms[j] + queued_ms[j])
            rows.append(
                {
                    "query_id": _qid(o["source_row_number"], j),
                    "query_text": f"/* {o['report_id']} batch {j + 1}/{n} */ SELECT ... FROM PI_MART.REPORT_SOURCE",
                    "database_name": "PI_ANALYTICS",
                    "schema_name": "PI_MART",
                    "query_type": "SELECT",
                    "session_id": 4_000_000 + int(o["source_row_number"]),
                    "user_name": APP_USER,
                    "role_name": APP_ROLE,
                    "warehouse_id": int(w["warehouse_id"]),
                    "warehouse_name": w["warehouse_name"],
                    "warehouse_size": w["warehouse_size"],
                    "warehouse_type": "STANDARD",
                    "query_tag": TAG_PREFIX + o["report_id"],
                    "execution_status": status,
                    "error_code": err[0] if err else None,
                    "error_message": err[1] if err else None,
                    "start_time": starts[j],
                    "end_time": starts[j] + pd.Timedelta(milliseconds=elapsed),
                    "total_elapsed_time": elapsed,
                    "compilation_time": int(compile_ms[j]),
                    "execution_time": int(exec_ms[j]),
                    "queued_overload_time": int(queued_ms[j]),
                    "bytes_scanned": int(rng.integers(5e6, 4e9)),
                    "rows_produced": int(rng.integers(10, 50_000)),
                    "credits_used_cloud_services": 0.0,
                    "credits_attributed_compute": credits[j],
                    "_source_row_number": int(o["source_row_number"]),
                }
            )

    # Untagged ad-hoc analyst queries sharing the same warehouses
    valid_total = obs["credits_raw"].clip(lower=0).sum()
    n_adhoc = 600
    adhoc_credits = rng.dirichlet(np.ones(n_adhoc)) * valid_total * UNTAGGED_SHARE
    months = sorted(obs["period_month"].unique())
    for k in range(n_adhoc):
        w = WAREHOUSES.iloc[k % 3]
        start = _random_starts(rng, pd.Timestamp(months[k % len(months)], tz="UTC"), 1)[0]
        exec_ms = max(1, round(adhoc_credits[k] / w["credits_per_hour"] * 3.6e6))
        rows.append(
            {
                "query_id": _qid("adhoc", k),
                "query_text": "SELECT ... FROM PI_MART.REPORT_SOURCE /* ad-hoc */",
                "database_name": "PI_ANALYTICS",
                "schema_name": "PI_MART",
                "query_type": "SELECT",
                "session_id": 9_000_000 + k,
                "user_name": f"ANALYST_{k % 7 + 1}",
                "role_name": "ANALYST",
                "warehouse_id": int(w["warehouse_id"]),
                "warehouse_name": w["warehouse_name"],
                "warehouse_size": w["warehouse_size"],
                "warehouse_type": "STANDARD",
                "query_tag": None,
                "execution_status": "SUCCESS",
                "error_code": None,
                "error_message": None,
                "start_time": start,
                "end_time": start + pd.Timedelta(milliseconds=exec_ms + 120),
                "total_elapsed_time": exec_ms + 120,
                "compilation_time": 120,
                "execution_time": exec_ms,
                "queued_overload_time": 0,
                "bytes_scanned": int(rng.integers(1e6, 1e9)),
                "rows_produced": int(rng.integers(1, 5_000)),
                "credits_used_cloud_services": 0.0,
                "credits_attributed_compute": adhoc_credits[k],
                "_source_row_number": None,
            }
        )

    q = pd.DataFrame(rows)
    q["credits_attributed_compute"] = q["credits_attributed_compute"].round(9)
    # Absorb rounding residue so each observation sums to its CSV value exactly.
    tagged = q["_source_row_number"].notna()
    target = obs.set_index("source_row_number")["credits_raw"]
    sums = q.loc[tagged].groupby("_source_row_number")["credits_attributed_compute"].sum()
    resid = (target.loc[sums.index] - sums).round(9)
    last_idx = q.loc[tagged].groupby("_source_row_number").tail(1).index
    q.loc[last_idx, "credits_attributed_compute"] += resid.loc[q.loc[last_idx, "_source_row_number"]].to_numpy()

    query_history = q.drop(columns=["credits_attributed_compute", "_source_row_number"])
    attribution = q.assign(
        parent_query_id=None,
        root_query_id=q["query_id"],
        query_hash=q["query_text"].map(lambda s: hashlib.md5(s.encode()).hexdigest()),
        query_parameterized_hash=q["query_tag"].fillna("adhoc").map(lambda s: hashlib.md5(s.encode()).hexdigest()),
        credits_used_query_acceleration=0.0,
    )[
        [
            "query_id",
            "parent_query_id",
            "root_query_id",
            "warehouse_id",
            "warehouse_name",
            "query_hash",
            "query_parameterized_hash",
            "query_tag",
            "user_name",
            "start_time",
            "end_time",
            "credits_attributed_compute",
            "credits_used_query_acceleration",
        ]
    ]

    # Hourly metering: only valid (non-negative) compute is ever billed.
    billable = q.loc[q["credits_attributed_compute"] >= 0].copy()
    billable["hour"] = billable["start_time"].dt.floor("h")
    metering = (
        billable.groupby(["warehouse_id", "warehouse_name", "hour"], as_index=False)["credits_attributed_compute"]
        .sum()
        .rename(columns={"credits_attributed_compute": "credits_attributed_compute_queries", "hour": "start_time"})
    )
    metering = metering.merge(WAREHOUSES[["warehouse_id", "idle_ratio"]], on="warehouse_id")
    busy = metering["credits_attributed_compute_queries"]
    metering["credits_used_compute"] = (busy * (1 + metering["idle_ratio"])).round(9)
    metering["credits_attributed_compute_queries"] = metering["credits_attributed_compute_queries"].round(9)
    metering["credits_used_cloud_services"] = 0.0
    metering["credits_used"] = metering["credits_used_compute"]
    metering["end_time"] = metering["start_time"] + pd.Timedelta(hours=1)
    metering = metering[
        [
            "start_time",
            "end_time",
            "warehouse_id",
            "warehouse_name",
            "credits_used",
            "credits_used_compute",
            "credits_used_cloud_services",
            "credits_attributed_compute_queries",
        ]
    ]
    return {
        "account_usage.query_history": query_history,
        "account_usage.query_attribution_history": attribution,
        "account_usage.warehouse_metering_history": metering,
    }


def run(test: bool = False, credit_price_usd: float | None = None) -> dict[str, int]:
    from .config import CREDIT_PRICE_USD

    with connect(test) as conn:
        obs = query_df(
            conn,
            """SELECT source_row_number, report_id, period_month, refresh_status,
                      query_count_last_30d, credits_raw::float8 AS credits_raw
               FROM app.report_observations ORDER BY source_row_number""",
        )
        tables = simulate(obs)
        counts = {}
        with conn.cursor() as cur:
            for table, df in tables.items():
                cur.execute(f"TRUNCATE {table}")
                counts[table] = copy_dataframe(cur, table, df)
            cur.execute(
                """INSERT INTO portal.credit_pricing (pricing_id, currency, credit_price_usd) VALUES (1, 'USD', %s)
                   ON CONFLICT (pricing_id) DO UPDATE SET credit_price_usd = EXCLUDED.credit_price_usd""",
                (credit_price_usd or CREDIT_PRICE_USD,),
            )
    return counts
