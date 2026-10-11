/*
   09 · Reconciliation checks — every row must report status = 'PASS'
   Proves the attribution neither loses nor invents credits:
     1  Method A (valid) = credits the source reported as >= 0
     2  Quarantined negatives = credits the source reported as < 0
     3  Every report-month with valid reported credits reconciles within 0.0001
     4  Method B + unallocated idle = total metered compute (bill fully allocated)
     5  Metering's query-attributed credits = all non-negative attributions
     6  No unit cost computed for a zero-view month
*/

CREATE OR REPLACE VIEW cost.v_reconciliation_checks AS
WITH
src AS (
    SELECT SUM(CASE WHEN snowflake_credits_reported >= 0 THEN snowflake_credits_reported ELSE 0 END) AS reported_valid,
           SUM(CASE WHEN snowflake_credits_reported <  0 THEN snowflake_credits_reported ELSE 0 END) AS reported_negative
    FROM portal.report_usage_monthly
),
a AS (
    SELECT SUM(CASE WHEN attribution_status = 'VALID'            THEN credits_attributed_compute ELSE 0 END) AS a_valid,
           SUM(CASE WHEN attribution_status = 'NEGATIVE_CREDITS' THEN credits_attributed_compute ELSE 0 END) AS a_negative,
           SUM(CASE WHEN credits_attributed_compute >= 0          THEN credits_attributed_compute ELSE 0 END) AS a_non_negative
    FROM cost.v_query_attribution_classified
),
rm AS (
    SELECT COUNT(*) AS mismatched_report_months
    FROM portal.report_usage_monthly u
    LEFT JOIN cost.v_report_month_credits_method_a m
           ON m.report_id = u.report_id AND m.period_month = u.period_month
    WHERE u.snowflake_credits_reported >= 0
      AND ABS(COALESCE(m.credits_attributed, 0) - u.snowflake_credits_reported) > 0.0001
),
b AS (SELECT SUM(credits_allocated) AS b_total FROM cost.v_report_month_credits_method_b),
un AS (SELECT COALESCE(SUM(credits_used_compute), 0) AS unallocated FROM cost.v_metering_unallocated),
mt AS (
    SELECT SUM(credits_used_compute)               AS metered,
           SUM(credits_attributed_compute_queries) AS metered_attributed
    FROM account_usage.warehouse_metering_history
),
z AS (
    SELECT COUNT(*) AS zero_view_unit_costs
    FROM cost.v_unit_cost_report_month
    WHERE monthly_active_views = 0
      AND (snowflake_cost_per_view_usd IS NOT NULL OR fully_loaded_cost_per_view_usd IS NOT NULL)
),
checks AS (
    SELECT 1 AS check_no, 'METHOD_A_EQUALS_SOURCE_VALID_CREDITS' AS check_name,
           src.reported_valid AS expected, a.a_valid AS actual FROM src CROSS JOIN a
    UNION ALL
    SELECT 2, 'QUARANTINE_EQUALS_SOURCE_NEGATIVE_CREDITS', src.reported_negative, a.a_negative FROM src CROSS JOIN a
    UNION ALL
    SELECT 3, 'REPORT_MONTHS_RECONCILE', 0, rm.mismatched_report_months FROM rm
    UNION ALL
    SELECT 4, 'METHOD_B_PLUS_UNALLOCATED_EQUALS_METERED', mt.metered, b.b_total + un.unallocated
    FROM mt CROSS JOIN b CROSS JOIN un
    UNION ALL
    SELECT 5, 'METERED_QUERY_CREDITS_EQUAL_ATTRIBUTION', mt.metered_attributed, a.a_non_negative FROM mt CROSS JOIN a
    UNION ALL
    SELECT 6, 'NO_UNIT_COST_ON_ZERO_VIEWS', 0, z.zero_view_unit_costs FROM z
)
SELECT check_no,
       check_name,
       CAST(expected AS NUMERIC(20,4))              AS expected,
       CAST(actual AS NUMERIC(20,4))                AS actual,
       CAST(actual - expected AS NUMERIC(20,6))     AS difference,
       CASE WHEN ABS(actual - expected) <= 0.001 THEN 'PASS' ELSE 'FAIL' END AS status
FROM checks;

SELECT * FROM cost.v_reconciliation_checks ORDER BY check_no;
