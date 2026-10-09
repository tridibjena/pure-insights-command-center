-- Forensic checks on the dataset's structure (populated by pipeline/pic_pipeline/forensics.py).
-- Each row records a question about the data, the statistical test used, its result and the
-- treatment the pipeline applies as a consequence.
CREATE TABLE IF NOT EXISTS app.dq_forensics (
    check_code   TEXT PRIMARY KEY,
    ordinal      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    question     TEXT NOT NULL,
    method       TEXT NOT NULL,
    result       TEXT NOT NULL,
    conclusion   TEXT NOT NULL,
    treatment    TEXT NOT NULL,
    metrics      JSONB NOT NULL DEFAULT '{}'::jsonb
);
