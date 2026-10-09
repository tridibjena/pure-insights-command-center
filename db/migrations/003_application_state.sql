-- ── Users & RBAC ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.users (
    user_id        SERIAL PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    display_name   TEXT NOT NULL,
    password_hash  TEXT NOT NULL,                    -- bcrypt
    role           TEXT NOT NULL CHECK (role IN ('ADMIN','PLATFORM_ENGINEER','FINOPS_ANALYST','REPORT_OWNER')),
    owner_email    TEXT,                             -- REPORT_OWNER: which owner identity they act as
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ,
    CHECK (role <> 'REPORT_OWNER' OR owner_email IS NOT NULL)
);

-- Admin owner reassignment for orphaned reports (applied on top of app.reports)
CREATE TABLE IF NOT EXISTS app.owner_overrides (
    report_id      TEXT PRIMARY KEY REFERENCES app.reports(report_id) ON DELETE CASCADE,
    owner_email    TEXT NOT NULL,
    assigned_by    TEXT NOT NULL,
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    note           TEXT
);

CREATE OR REPLACE VIEW app.v_report_current AS
SELECT r.report_id,
       r.report_name,
       COALESCE(o.owner_email, r.current_owner_email)           AS owner_email,
       (o.owner_email IS NULL AND r.is_currently_orphaned)      AS is_orphaned,
       r.is_currently_orphaned                                  AS was_orphaned_in_source,
       o.owner_email IS NOT NULL                                AS has_owner_override,
       r.latest_snapshot_seq,
       r.orphaned_snapshot_count,
       r.distinct_owner_count,
       r.owner_change_count
FROM app.reports r
LEFT JOIN app.owner_overrides o USING (report_id);

-- ── Audit trail ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.audit_log (
    audit_id      BIGSERIAL PRIMARY KEY,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_email   TEXT,
    actor_role    TEXT,
    action        TEXT NOT NULL,
    target        TEXT,
    outcome       TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILED')),
    ip            TEXT,
    detail        JSONB
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON app.audit_log (at DESC);

-- ── Telemetry (Task 2) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.telemetry_events (
    event_id            BIGSERIAL PRIMARY KEY,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    source              TEXT NOT NULL CHECK (source IN ('replay','collector','rum')),
    event_type          TEXT NOT NULL CHECK (event_type IN ('report.telemetry','client.load')),
    report_id           TEXT,
    snapshot_seq        INTEGER,
    avg_load_time_sec   NUMERIC(8,2),
    refresh_status      TEXT,
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_tel_received ON app.telemetry_events (received_at DESC);

CREATE TABLE IF NOT EXISTS app.alerts (
    alert_id          BIGSERIAL PRIMARY KEY,
    dedupe_key        TEXT NOT NULL,                  -- rule_code:report_id (or rule_code:route for RUM)
    rule_code         TEXT NOT NULL CHECK (rule_code IN ('LATENCY_SLO_BREACH','REFRESH_FAILURE','TELEMETRY_GAP','RUM_SLOW_LOAD')),
    report_id         TEXT,
    severity          TEXT NOT NULL CHECK (severity IN ('WARNING','HIGH','CRITICAL')),
    peak_severity     TEXT NOT NULL CHECK (peak_severity IN ('WARNING','HIGH','CRITICAL')),
    status            TEXT NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
    title             TEXT NOT NULL,
    message           TEXT NOT NULL,
    metric_value      NUMERIC(12,2),
    threshold         NUMERIC(12,2),
    occurrence_count  INTEGER NOT NULL DEFAULT 1,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by   TEXT,
    acknowledged_at   TIMESTAMPTZ,
    resolved_at       TIMESTAMPTZ,
    resolved_by       TEXT,
    resolution        TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one live (non-resolved) incident per dedupe key
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerts_live_key ON app.alerts (dedupe_key) WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS ix_alerts_updated ON app.alerts (updated_at DESC);

CREATE TABLE IF NOT EXISTS app.alert_events (
    alert_event_id  BIGSERIAL PRIMARY KEY,
    alert_id        BIGINT NOT NULL REFERENCES app.alerts(alert_id) ON DELETE CASCADE,
    at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type      TEXT NOT NULL CHECK (event_type IN ('RAISED','REPEATED','ESCALATED','ACKNOWLEDGED','RESOLVED')),
    severity        TEXT,
    actor           TEXT NOT NULL,
    metric_value    NUMERIC(12,2),
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_alert_events_alert ON app.alert_events (alert_id, at);
