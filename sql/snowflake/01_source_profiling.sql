/*
   01 · Source profiling — what do the ACCOUNT_USAGE logs cover?
   Portable: runs unchanged on Snowflake and PostgreSQL.
*/

SELECT 'QUERY_HISTORY'               AS source_view,
       COUNT(*)                      AS row_count,
       MIN(start_time)               AS first_event,
       MAX(start_time)               AS last_event,
       SUM(CASE WHEN query_tag IS NULL OR query_tag = '' THEN 1 ELSE 0 END) AS untagged_rows,
       SUM(CASE WHEN execution_status <> 'SUCCESS' THEN 1 ELSE 0 END)       AS failed_rows
FROM account_usage.query_history
UNION ALL
SELECT 'QUERY_ATTRIBUTION_HISTORY', COUNT(*), MIN(start_time), MAX(start_time),
       SUM(CASE WHEN query_tag IS NULL OR query_tag = '' THEN 1 ELSE 0 END),
       SUM(CASE WHEN credits_attributed_compute < 0 THEN 1 ELSE 0 END)
FROM account_usage.query_attribution_history
UNION ALL
SELECT 'WAREHOUSE_METERING_HISTORY', COUNT(*), MIN(start_time), MAX(start_time), 0, 0
FROM account_usage.warehouse_metering_history
UNION ALL
SELECT 'PORTAL.REPORT_USAGE_MONTHLY', COUNT(*),
       CAST(MIN(period_month) AS TIMESTAMP), CAST(MAX(period_month) AS TIMESTAMP),
       SUM(CASE WHEN owner_email IS NULL THEN 1 ELSE 0 END),
       SUM(CASE WHEN monthly_active_views = 0 THEN 1 ELSE 0 END)
FROM portal.report_usage_monthly;
