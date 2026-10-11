/*
   08 · Chargeback, ranking and trend
*/

-- Monthly chargeback by the owner recorded for that period; orphaned spend is explicit.
CREATE OR REPLACE VIEW cost.v_chargeback_owner_month AS
SELECT period_month,
       COALESCE(owner_email, 'UNOWNED (orphaned)')                   AS cost_owner,
       COUNT(*)                                                       AS reports,
       SUM(monthly_active_views)                                      AS views,
       SUM(snowflake_credits)                                         AS snowflake_credits,
       SUM(snowflake_cost_usd)                                        AS snowflake_cost_usd,
       SUM(aws_hosting_cost_usd)                                      AS aws_cost_usd,
       COALESCE(SUM(snowflake_cost_usd), 0) + SUM(aws_hosting_cost_usd) AS total_cost_usd
FROM cost.v_unit_cost_report_month
GROUP BY period_month, COALESCE(owner_email, 'UNOWNED (orphaned)');

CREATE OR REPLACE VIEW cost.v_chargeback_owner AS
SELECT cost_owner,
       SUM(views)               AS views,
       SUM(snowflake_credits)   AS snowflake_credits,
       SUM(snowflake_cost_usd)  AS snowflake_cost_usd,
       SUM(aws_cost_usd)        AS aws_cost_usd,
       SUM(total_cost_usd)      AS total_cost_usd
FROM cost.v_chargeback_owner_month
GROUP BY cost_owner;

-- Lifetime ranking; decommission candidates = top-decile cost per view AND below-median usage
CREATE OR REPLACE VIEW cost.v_report_cost_ranking AS
WITH r AS (
    SELECT u.*,
           RANK() OVER (ORDER BY total_cost_usd DESC)                                AS rank_total_cost,
           RANK() OVER (ORDER BY fully_loaded_cost_per_view_usd DESC)                AS rank_cost_per_view,
           NTILE(10) OVER (ORDER BY fully_loaded_cost_per_view_usd DESC)             AS cost_per_view_decile
    FROM cost.v_unit_cost_report u
),
m AS (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_views) AS median_views
    FROM cost.v_unit_cost_report
)
SELECT r.*,
       CASE WHEN r.cost_per_view_decile = 1 AND r.total_views < m.median_views THEN 1 ELSE 0 END
           AS is_decommission_candidate
FROM r CROSS JOIN m;

-- Month-over-month Snowflake spend per report
CREATE OR REPLACE VIEW cost.v_report_cost_mom AS
SELECT report_id,
       period_month,
       snowflake_cost_usd,
       LAG(snowflake_cost_usd) OVER (PARTITION BY report_id ORDER BY period_month)   AS prev_snowflake_cost_usd,
       snowflake_cost_usd
           - LAG(snowflake_cost_usd) OVER (PARTITION BY report_id ORDER BY period_month) AS mom_change_usd
FROM cost.v_unit_cost_report_month;

-- Portfolio trend by month
CREATE OR REPLACE VIEW cost.v_cost_trend_month AS
SELECT period_month,
       SUM(monthly_active_views)                                          AS views,
       SUM(snowflake_credits)                                             AS snowflake_credits,
       SUM(snowflake_cost_usd)                                            AS snowflake_cost_usd,
       SUM(aws_hosting_cost_usd)                                          AS aws_cost_usd,
       SUM(snowflake_cost_usd)
           / NULLIF(SUM(CASE WHEN snowflake_credits IS NOT NULL THEN monthly_active_views ELSE 0 END), 0)
                                                                          AS snowflake_cost_per_view_usd
FROM cost.v_unit_cost_report_month
GROUP BY period_month;

SELECT cost_owner, ROUND(total_cost_usd, 2) AS total_cost_usd
FROM cost.v_chargeback_owner
ORDER BY total_cost_usd DESC;
