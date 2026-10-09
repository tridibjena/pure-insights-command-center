-- ── Raw landing table: every CSV value kept exactly as received ────────────
CREATE TABLE IF NOT EXISTS raw.report_monitoring_csv (
    source_row_number           INTEGER PRIMARY KEY,     -- 1-based data row in the CSV
    report_id                   TEXT,
    report_name                 TEXT,
    owner_email                 TEXT,
    last_refresh_status         TEXT,
    monthly_active_views        TEXT,
    snowflake_credits_consumed  TEXT,
    avg_load_time_sec           TEXT,
    aws_hosting_cost_usd        TEXT,
    query_count_last_30d        TEXT,
    concurrent_user_peak        TEXT,
    source_file                 TEXT NOT NULL,
    loaded_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Data-quality rule catalog (populated from pipeline/pic_pipeline/quality_rules.py)
CREATE TABLE IF NOT EXISTS app.dq_rules (
    rule_code     TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    category      TEXT NOT NULL,          -- OWNERSHIP | COST | PERFORMANCE | RELIABILITY | INTEGRITY
    column_name   TEXT NOT NULL,
    severity      TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','HIGH','CRITICAL')),
    action        TEXT NOT NULL CHECK (action IN ('NULLIFY','QUARANTINE','ANNOTATE','REJECT')),
    detection     TEXT NOT NULL,
    remediation   TEXT NOT NULL
);

-- ── Report dimension: one row per report_id (100) ─────────────────────────
CREATE TABLE IF NOT EXISTS app.reports (
    report_id                TEXT PRIMARY KEY,
    report_name              TEXT NOT NULL,
    current_owner_email      TEXT,                    -- owner in the latest snapshot; NULL = orphaned
    is_currently_orphaned    BOOLEAN NOT NULL,
    latest_snapshot_seq      INTEGER NOT NULL,
    orphaned_snapshot_count  INTEGER NOT NULL,
    distinct_owner_count     INTEGER NOT NULL,
    owner_change_count       INTEGER NOT NULL
);

-- ── Cleaned observation fact: one row per CSV row (2,000) ──────────────────
CREATE TABLE IF NOT EXISTS app.report_observations (
    source_row_number           INTEGER PRIMARY KEY REFERENCES raw.report_monitoring_csv(source_row_number),
    report_id                   TEXT NOT NULL REFERENCES app.reports(report_id),
    snapshot_seq                INTEGER NOT NULL CHECK (snapshot_seq BETWEEN 1 AND 1000),
    period_month                DATE NOT NULL,
    owner_raw                   TEXT,
    owner_email                 TEXT,                 -- NULL when orphaned
    is_orphaned                 BOOLEAN NOT NULL,
    refresh_status              TEXT NOT NULL,
    is_refresh_failure          BOOLEAN NOT NULL,     -- FAILED or TIMED_OUT
    is_status_unknown           BOOLEAN NOT NULL,
    monthly_active_views        INTEGER NOT NULL,
    credits_raw                 NUMERIC(12,2) NOT NULL,
    credits_clean               NUMERIC(12,2),        -- NULL when quarantined (negative)
    is_negative_credits         BOOLEAN NOT NULL,
    avg_load_time_sec           NUMERIC(8,2),         -- never capped: spikes are signal; NULL only if invalid
    latency_band                TEXT NOT NULL CHECK (latency_band IN ('OK','WARNING','HIGH','CRITICAL','INVALID')),
    is_latency_breach           BOOLEAN NOT NULL,     -- strictly > alert threshold (15 s)
    is_latency_invalid          BOOLEAN NOT NULL,
    aws_hosting_cost_usd        NUMERIC(12,2) NOT NULL,
    aws_cost_per_view           NUMERIC(14,6),        -- NULL when monthly_active_views = 0
    is_zero_view_cost           BOOLEAN NOT NULL,
    is_peak_exceeds_views       BOOLEAN NOT NULL,
    is_aws_cost_per_view_outlier BOOLEAN NOT NULL,
    query_count_last_30d        INTEGER NOT NULL,
    concurrent_user_peak        INTEGER NOT NULL,
    UNIQUE (report_id, snapshot_seq)
);
CREATE INDEX IF NOT EXISTS ix_obs_snapshot ON app.report_observations (snapshot_seq);
CREATE INDEX IF NOT EXISTS ix_obs_owner    ON app.report_observations (owner_email);

-- ── Anomaly register: one row per (observation, rule) hit ──────────────────
CREATE TABLE IF NOT EXISTS app.dq_issues (
    issue_id            BIGSERIAL PRIMARY KEY,
    source_row_number   INTEGER NOT NULL REFERENCES raw.report_monitoring_csv(source_row_number),
    report_id           TEXT NOT NULL,
    snapshot_seq        INTEGER NOT NULL,
    rule_code           TEXT NOT NULL REFERENCES app.dq_rules(rule_code),
    column_name         TEXT NOT NULL,
    raw_value           TEXT,
    detail              TEXT,
    action_taken        TEXT NOT NULL,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dq_issues_rule ON app.dq_issues (rule_code);
