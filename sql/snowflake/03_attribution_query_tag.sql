/* =============================================================================
   03 · METHOD A — per-query attribution via QUERY_TAG (primary method)
   -----------------------------------------------------------------------------
   Snowflake's QUERY_ATTRIBUTION_HISTORY assigns warehouse compute credits to
   each query (concurrency-aware, excludes idle time). The portal stamps every
   dashboard query with QUERY_TAG = 'pure-insights:report=<REPORT_ID>', so
   summing VALID rows by tag attributes credits to individual reports.
   ============================================================================= */

CREATE OR REPLACE VIEW cost.v_report_month_credits_method_a AS
SELECT report_id,
       period_month,
       COUNT(*)                          AS attributed_query_rows,
       SUM(credits_attributed_compute)   AS credits_attributed
FROM cost.v_query_attribution_classified
WHERE attribution_status = 'VALID'
GROUP BY report_id, period_month;

CREATE OR REPLACE VIEW cost.v_report_credits_method_a AS
SELECT report_id,
       COUNT(*)                          AS months_with_valid_credits,
       SUM(attributed_query_rows)        AS attributed_query_rows,
       SUM(credits_attributed)           AS credits_attributed
FROM cost.v_report_month_credits_method_a
GROUP BY report_id;

SELECT report_id, months_with_valid_credits, credits_attributed
FROM cost.v_report_credits_method_a
ORDER BY credits_attributed DESC
LIMIT 10;
