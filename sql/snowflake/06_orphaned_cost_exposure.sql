/* =============================================================================
   06 · Orphaned cost exposure — spend with no accountable owner
   -----------------------------------------------------------------------------
   A report-month is orphaned when the portal recorded no valid owner e-mail
   (source markers 'nan' / 'ORPHANED_REPORT' are cleaned to NULL upstream).
   "Currently orphaned" = orphaned in the report's latest period.
   ============================================================================= */

CREATE OR REPLACE VIEW cost.v_orphaned_cost_exposure AS
WITH latest AS (
    SELECT report_id,
           owner_email,
           ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY period_month DESC) AS rn
    FROM portal.report_usage_monthly
)
SELECT c.report_id,
       MAX(c.report_name)                                                     AS report_name,
       MAX(CASE WHEN l.owner_email IS NULL THEN 1 ELSE 0 END)                 AS is_currently_orphaned,
       COUNT(*)                                                               AS orphaned_months,
       SUM(c.monthly_active_views)                                            AS orphaned_views,
       SUM(c.snowflake_credits)                                               AS orphaned_credits,
       SUM(c.snowflake_cost_usd)                                              AS orphaned_snowflake_cost_usd,
       SUM(c.aws_hosting_cost_usd)                                            AS orphaned_aws_cost_usd,
       COALESCE(SUM(c.snowflake_cost_usd), 0) + SUM(c.aws_hosting_cost_usd)   AS orphaned_total_cost_usd
FROM cost.v_unit_cost_report_month c
JOIN latest l ON l.report_id = c.report_id AND l.rn = 1
WHERE c.owner_email IS NULL
GROUP BY c.report_id;

CREATE OR REPLACE VIEW cost.v_orphaned_cost_summary AS
SELECT COUNT(*)                                       AS reports_ever_orphaned,
       SUM(is_currently_orphaned)                     AS reports_currently_orphaned,
       SUM(orphaned_months)                           AS orphaned_report_months,
       SUM(orphaned_credits)                          AS orphaned_credits,
       SUM(orphaned_snowflake_cost_usd)               AS orphaned_snowflake_cost_usd,
       SUM(orphaned_aws_cost_usd)                     AS orphaned_aws_cost_usd,
       SUM(orphaned_total_cost_usd)                   AS orphaned_total_cost_usd
FROM cost.v_orphaned_cost_exposure;

SELECT * FROM cost.v_orphaned_cost_summary;
