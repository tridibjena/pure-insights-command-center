-- ── Simulated SNOWFLAKE.ACCOUNT_USAGE (column names follow Snowflake docs; subset)
-- Populated by pipeline/pic_pipeline/simulate_account_usage.py
CREATE TABLE IF NOT EXISTS account_usage.query_history (
    query_id                     TEXT PRIMARY KEY,
    query_text                   TEXT,
    database_name                TEXT,
    schema_name                  TEXT,
    query_type                   TEXT,
    session_id                   BIGINT,
    user_name                    TEXT,
    role_name                    TEXT,
    warehouse_id                 BIGINT,
    warehouse_name               TEXT,
    warehouse_size               TEXT,
    warehouse_type               TEXT,
    query_tag                    TEXT,
    execution_status             TEXT,     -- SUCCESS | FAIL
    error_code                   TEXT,
    error_message                TEXT,
    start_time                   TIMESTAMPTZ NOT NULL,
    end_time                     TIMESTAMPTZ NOT NULL,
    total_elapsed_time           BIGINT,   -- ms
    compilation_time             BIGINT,   -- ms
    execution_time               BIGINT,   -- ms
    queued_overload_time         BIGINT,   -- ms
    bytes_scanned                BIGINT,
    rows_produced                BIGINT,
    credits_used_cloud_services  NUMERIC(18,9)
);
CREATE INDEX IF NOT EXISTS ix_qh_wh_start ON account_usage.query_history (warehouse_name, start_time);

CREATE TABLE IF NOT EXISTS account_usage.query_attribution_history (
    query_id                         TEXT PRIMARY KEY,
    parent_query_id                  TEXT,
    root_query_id                    TEXT,
    warehouse_id                     BIGINT,
    warehouse_name                   TEXT,
    query_hash                       TEXT,
    query_parameterized_hash         TEXT,
    query_tag                        TEXT,
    user_name                        TEXT,
    start_time                       TIMESTAMPTZ NOT NULL,
    end_time                         TIMESTAMPTZ NOT NULL,
    credits_attributed_compute       NUMERIC(18,9),
    credits_used_query_acceleration  NUMERIC(18,9)
);

CREATE TABLE IF NOT EXISTS account_usage.warehouse_metering_history (
    start_time                          TIMESTAMPTZ NOT NULL,
    end_time                            TIMESTAMPTZ NOT NULL,
    warehouse_id                        BIGINT NOT NULL,
    warehouse_name                      TEXT NOT NULL,
    credits_used                        NUMERIC(18,9),
    credits_used_compute                NUMERIC(18,9),
    credits_used_cloud_services         NUMERIC(18,9),
    credits_attributed_compute_queries  NUMERIC(18,9),
    PRIMARY KEY (warehouse_name, start_time)
);

-- ── Portal-side usage facts (what the React portal itself records) ─────────
-- In Snowflake this is a table loaded from data/simulated/portal_report_usage_monthly.csv;
-- in PostgreSQL it is a view over the cleaned observations.
CREATE OR REPLACE VIEW portal.report_usage_monthly AS
SELECT o.report_id,
       r.report_name,
       o.period_month,
       o.snapshot_seq,
       o.owner_email,
       o.refresh_status,
       o.avg_load_time_sec,
       o.monthly_active_views,
       o.concurrent_user_peak,
       o.query_count_last_30d,
       o.aws_hosting_cost_usd,
       -- Credits as reported by the legacy monitoring export (incl. the injected negatives).
       -- Used only to reconcile the ACCOUNT_USAGE attribution back to the source.
       o.credits_raw AS snowflake_credits_reported
FROM app.report_observations o
JOIN app.reports r USING (report_id);

-- Contracted Snowflake price (stand-in for ORGANIZATION_USAGE.RATE_SHEET_DAILY)
CREATE TABLE IF NOT EXISTS portal.credit_pricing (
    pricing_id        INTEGER PRIMARY KEY DEFAULT 1 CHECK (pricing_id = 1),
    currency          TEXT NOT NULL DEFAULT 'USD',
    credit_price_usd  NUMERIC(10,4) NOT NULL CHECK (credit_price_usd > 0)
);
