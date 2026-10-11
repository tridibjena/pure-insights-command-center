/*
   02 · Anomaly quarantine — classify every attributed credit before it is used
   Credits cannot be negative. The injected negative values are QUARANTINED
   (excluded from attribution, kept for audit) — never abs()'d or zeroed.
   Untagged queries and tags pointing at unknown reports are separated too.
*/

CREATE OR REPLACE VIEW cost.v_query_attribution_classified AS
WITH known_reports AS (
    SELECT DISTINCT report_id FROM portal.report_usage_monthly
),
parsed AS (
    SELECT a.query_id,
           a.warehouse_name,
           a.start_time,
           CAST(DATE_TRUNC('month', a.start_time) AS DATE)                        AS period_month,
           a.query_tag,
           CASE WHEN a.query_tag LIKE 'pure-insights:report=%'
                THEN SPLIT_PART(a.query_tag, 'report=', 2) END                    AS tagged_report_id,
           a.credits_attributed_compute
    FROM account_usage.query_attribution_history a
)
SELECT p.query_id,
       p.warehouse_name,
       p.start_time,
       p.period_month,
       p.query_tag,
       p.tagged_report_id                                                          AS report_id,
       p.credits_attributed_compute,
       CASE WHEN p.credits_attributed_compute IS NULL       THEN 'NULL_CREDITS'
            WHEN p.credits_attributed_compute < 0           THEN 'NEGATIVE_CREDITS'
            WHEN p.tagged_report_id IS NULL                 THEN 'UNTAGGED'
            WHEN k.report_id IS NULL                        THEN 'UNKNOWN_REPORT'
            ELSE 'VALID' END                                                       AS attribution_status
FROM parsed p
LEFT JOIN known_reports k ON k.report_id = p.tagged_report_id;

CREATE OR REPLACE VIEW cost.v_quarantine_summary AS
SELECT attribution_status,
       COUNT(*)                                  AS query_rows,
       COUNT(DISTINCT report_id)                 AS reports_affected,
       SUM(credits_attributed_compute)           AS credits,
       MIN(credits_attributed_compute)           AS min_credits,
       MAX(credits_attributed_compute)           AS max_credits
FROM cost.v_query_attribution_classified
GROUP BY attribution_status;

-- Spend burned by refresh queries that failed or timed out (still billed by Snowflake)
CREATE OR REPLACE VIEW cost.v_failed_query_spend AS
SELECT c.report_id,
       c.period_month,
       h.error_code,
       COUNT(*)                                   AS failed_query_rows,
       SUM(c.credits_attributed_compute)          AS credits_on_failed_queries
FROM account_usage.query_history h
JOIN cost.v_query_attribution_classified c ON c.query_id = h.query_id
WHERE h.execution_status <> 'SUCCESS'
  AND c.attribution_status = 'VALID'
GROUP BY c.report_id, c.period_month, h.error_code;

SELECT * FROM cost.v_quarantine_summary ORDER BY attribution_status;
