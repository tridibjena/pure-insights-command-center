/*
   07 · AWS hosting cost vs active usage — discrepancy detection
   Hosting cost should scale with usage. Three rules flag where it does not:
     ZERO_VIEW_COST      cost incurred while monthly_active_views = 0
     PEAK_EXCEEDS_VIEWS  concurrent_user_peak > monthly_active_views (impossible)
     COST_PER_VIEW_OUTLIER  aws cost / view > Q3 + 3 x IQR (robust fence)
   plus Pearson and Spearman (tie-aware rank) correlation of views vs cost.
*/

CREATE OR REPLACE VIEW cost.v_aws_cost_per_view_fence AS
SELECT PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY aws_hosting_cost_usd / monthly_active_views) AS q1,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY aws_hosting_cost_usd / monthly_active_views) AS median,
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY aws_hosting_cost_usd / monthly_active_views) AS q3
FROM portal.report_usage_monthly
WHERE monthly_active_views > 0;

CREATE OR REPLACE VIEW cost.v_aws_usage_discrepancy AS
SELECT u.report_id,
       u.report_name,
       u.period_month,
       u.owner_email,
       u.monthly_active_views,
       u.concurrent_user_peak,
       u.aws_hosting_cost_usd,
       u.aws_hosting_cost_usd / NULLIF(u.monthly_active_views, 0)              AS aws_cost_per_view_usd,
       f.q3 + 3 * (f.q3 - f.q1)                                               AS outlier_fence_usd,
       CASE WHEN u.monthly_active_views = 0 AND u.aws_hosting_cost_usd > 0 THEN 1 ELSE 0 END AS is_zero_view_cost,
       CASE WHEN u.concurrent_user_peak > u.monthly_active_views THEN 1 ELSE 0 END           AS is_peak_exceeds_views,
       CASE WHEN u.monthly_active_views > 0
             AND u.aws_hosting_cost_usd / u.monthly_active_views > f.q3 + 3 * (f.q3 - f.q1)
            THEN 1 ELSE 0 END                                                  AS is_cost_per_view_outlier
FROM portal.report_usage_monthly u
CROSS JOIN cost.v_aws_cost_per_view_fence f;

CREATE OR REPLACE VIEW cost.v_aws_usage_discrepancy_summary AS
SELECT SUM(is_zero_view_cost)                                       AS zero_view_cost_rows,
       SUM(is_peak_exceeds_views)                                   AS peak_exceeds_views_rows,
       SUM(is_cost_per_view_outlier)                                AS cost_per_view_outlier_rows,
       SUM(CASE WHEN is_cost_per_view_outlier = 1 OR is_zero_view_cost = 1
                THEN aws_hosting_cost_usd ELSE 0 END)               AS aws_cost_in_flagged_rows_usd,
       MAX(outlier_fence_usd)                                       AS outlier_fence_usd
FROM cost.v_aws_usage_discrepancy;

CREATE OR REPLACE VIEW cost.v_aws_usage_correlation AS
WITH ranked AS (
    SELECT monthly_active_views,
           aws_hosting_cost_usd,
           concurrent_user_peak,
           RANK() OVER (ORDER BY monthly_active_views)
             + (COUNT(*) OVER (PARTITION BY monthly_active_views) - 1) / 2.0   AS r_views,
           RANK() OVER (ORDER BY aws_hosting_cost_usd)
             + (COUNT(*) OVER (PARTITION BY aws_hosting_cost_usd) - 1) / 2.0   AS r_cost
    FROM portal.report_usage_monthly
),
per_report AS (
    SELECT report_id, SUM(monthly_active_views) AS views, SUM(aws_hosting_cost_usd) AS cost
    FROM portal.report_usage_monthly
    GROUP BY report_id
)
SELECT 'report-month' AS grain,
       CAST(CORR(monthly_active_views, aws_hosting_cost_usd) AS NUMERIC(10,4)) AS pearson_views_vs_aws_cost,
       CAST(CORR(r_views, r_cost) AS NUMERIC(10,4))                            AS spearman_views_vs_aws_cost,
       CAST(CORR(concurrent_user_peak, aws_hosting_cost_usd) AS NUMERIC(10,4)) AS pearson_peak_users_vs_aws_cost
FROM ranked
UNION ALL
SELECT 'report', CAST(CORR(views, cost) AS NUMERIC(10,4)), NULL, NULL
FROM per_report;

SELECT * FROM cost.v_aws_usage_discrepancy_summary;
SELECT * FROM cost.v_aws_usage_correlation;
