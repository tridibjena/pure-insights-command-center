/* =============================================================================
   05 · Unit cost per active user view
   -----------------------------------------------------------------------------
   snowflake_cost_per_view = Method-A credits x contracted $/credit
                             / monthly_active_views
   fully_loaded_cost_per_view adds the report's AWS hosting cost.

   Rules:
   * monthly_active_views = 0  → unit cost is undefined (NULL, status ZERO_VIEWS),
     never a divide-by-zero and never silently 0.
   * credits quarantined (negative in source) → NULL, status CREDITS_QUARANTINED;
     lifetime unit costs exclude those months from BOTH numerator and denominator
     so the ratio is not understated.
   ============================================================================= */

CREATE OR REPLACE VIEW cost.v_unit_cost_report_month AS
SELECT u.report_id,
       u.report_name,
       u.period_month,
       u.owner_email,
       u.monthly_active_views,
       u.aws_hosting_cost_usd,
       a.credits_attributed                                                   AS snowflake_credits,
       a.credits_attributed * p.credit_price_usd                              AS snowflake_cost_usd,
       a.credits_attributed / NULLIF(u.monthly_active_views, 0)               AS credits_per_view,
       a.credits_attributed * p.credit_price_usd
           / NULLIF(u.monthly_active_views, 0)                                AS snowflake_cost_per_view_usd,
       u.aws_hosting_cost_usd / NULLIF(u.monthly_active_views, 0)             AS aws_cost_per_view_usd,
       CASE WHEN a.credits_attributed IS NULL THEN NULL
            ELSE (a.credits_attributed * p.credit_price_usd + u.aws_hosting_cost_usd)
                 / NULLIF(u.monthly_active_views, 0) END                      AS fully_loaded_cost_per_view_usd,
       CASE WHEN u.monthly_active_views = 0      THEN 'ZERO_VIEWS'
            WHEN a.credits_attributed IS NULL    THEN 'CREDITS_QUARANTINED'
            ELSE 'OK' END                                                     AS unit_cost_status
FROM portal.report_usage_monthly u
CROSS JOIN portal.credit_pricing p
LEFT JOIN cost.v_report_month_credits_method_a a
       ON a.report_id = u.report_id
      AND a.period_month = u.period_month;

CREATE OR REPLACE VIEW cost.v_unit_cost_report AS
WITH agg AS (
    SELECT report_id,
           MAX(report_name)                                                    AS report_name,
           COUNT(*)                                                            AS months,
           SUM(CASE WHEN unit_cost_status = 'CREDITS_QUARANTINED' THEN 1 ELSE 0 END) AS months_quarantined,
           SUM(CASE WHEN unit_cost_status = 'ZERO_VIEWS' THEN 1 ELSE 0 END)   AS months_zero_views,
           SUM(monthly_active_views)                                           AS total_views,
           SUM(CASE WHEN snowflake_credits IS NOT NULL THEN monthly_active_views ELSE 0 END) AS views_with_valid_credits,
           SUM(snowflake_credits)                                              AS snowflake_credits,
           SUM(snowflake_cost_usd)                                             AS snowflake_cost_usd,
           SUM(aws_hosting_cost_usd)                                           AS aws_cost_usd,
           SUM(CASE WHEN snowflake_credits IS NOT NULL THEN aws_hosting_cost_usd ELSE 0 END) AS aws_cost_valid_months
    FROM cost.v_unit_cost_report_month
    GROUP BY report_id
)
SELECT agg.*,
       snowflake_cost_usd + aws_cost_usd                                           AS total_cost_usd,
       snowflake_cost_usd / NULLIF(views_with_valid_credits, 0)                    AS snowflake_cost_per_view_usd,
       aws_cost_usd / NULLIF(total_views, 0)                                       AS aws_cost_per_view_usd,
       (snowflake_cost_usd + aws_cost_valid_months) / NULLIF(views_with_valid_credits, 0) AS fully_loaded_cost_per_view_usd
FROM agg;

CREATE OR REPLACE VIEW cost.v_unit_cost_portfolio AS
SELECT COUNT(*)                                                              AS reports,
       SUM(total_views)                                                      AS total_views,
       SUM(snowflake_credits)                                                AS snowflake_credits,
       SUM(snowflake_cost_usd)                                               AS snowflake_cost_usd,
       SUM(aws_cost_usd)                                                     AS aws_cost_usd,
       SUM(snowflake_cost_usd) / NULLIF(SUM(views_with_valid_credits), 0)    AS snowflake_cost_per_view_usd,
       SUM(aws_cost_usd) / NULLIF(SUM(total_views), 0)                       AS aws_cost_per_view_usd,
       (SUM(snowflake_cost_usd) + SUM(aws_cost_valid_months))
           / NULLIF(SUM(views_with_valid_credits), 0)                        AS fully_loaded_cost_per_view_usd
FROM cost.v_unit_cost_report;

SELECT report_id, report_name, total_views, snowflake_credits,
       ROUND(snowflake_cost_per_view_usd, 4)     AS snowflake_usd_per_view,
       ROUND(fully_loaded_cost_per_view_usd, 4)  AS fully_loaded_usd_per_view
FROM cost.v_unit_cost_report
ORDER BY fully_loaded_cost_per_view_usd DESC NULLS LAST
LIMIT 10;
