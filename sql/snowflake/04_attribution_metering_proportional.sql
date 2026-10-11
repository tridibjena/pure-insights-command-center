/*
   04 · METHOD B — proportional allocation of the warehouse bill (cross-check)
   The classic approach used before QUERY_ATTRIBUTION_HISTORY existed: take each
   warehouse-hour's metered compute credits (the bill, INCLUDING idle time) and
   split it across the queries that ran in that hour by execution-time share.
   Untagged work is allocated to 'UNATTRIBUTED'. Metered hours with no queries
   are reported as unallocated idle.

   Method B fully allocates the bill; Method A is more precise per query. The
   reconciliation in 09 proves: SUM(B) + unallocated = SUM(metering).
*/

CREATE OR REPLACE VIEW cost.v_query_hour_share AS
WITH q AS (
    SELECT h.query_id,
           h.warehouse_name,
           DATE_TRUNC('hour', h.start_time)                           AS hour_start,
           CAST(DATE_TRUNC('month', h.start_time) AS DATE)            AS period_month,
           CASE WHEN h.query_tag LIKE 'pure-insights:report=%'
                THEN SPLIT_PART(h.query_tag, 'report=', 2)
                ELSE 'UNATTRIBUTED' END                               AS report_id,
           CAST(h.execution_time AS NUMERIC(38,9))                    AS execution_ms
    FROM account_usage.query_history h
    WHERE h.warehouse_name IS NOT NULL
      AND h.execution_time > 0
)
SELECT q.*,
       q.execution_ms / SUM(q.execution_ms) OVER (PARTITION BY q.warehouse_name, q.hour_start) AS hour_time_share
FROM q;

CREATE OR REPLACE VIEW cost.v_report_month_credits_method_b AS
SELECT s.report_id,
       s.period_month,
       SUM(s.hour_time_share * m.credits_used_compute)   AS credits_allocated
FROM cost.v_query_hour_share s
JOIN account_usage.warehouse_metering_history m
  ON m.warehouse_name = s.warehouse_name
 AND m.start_time     = s.hour_start
GROUP BY s.report_id, s.period_month;

CREATE OR REPLACE VIEW cost.v_metering_unallocated AS
SELECT m.warehouse_name,
       m.start_time,
       m.credits_used_compute
FROM account_usage.warehouse_metering_history m
WHERE NOT EXISTS (
    SELECT 1 FROM cost.v_query_hour_share s
    WHERE s.warehouse_name = m.warehouse_name AND s.hour_start = m.start_time
);

-- Method A vs Method B per report (B includes a share of idle time, A does not)
CREATE OR REPLACE VIEW cost.v_attribution_method_comparison AS
WITH b AS (
    SELECT report_id, SUM(credits_allocated) AS credits_method_b
    FROM cost.v_report_month_credits_method_b
    GROUP BY report_id
)
SELECT COALESCE(a.report_id, b.report_id)                                   AS report_id,
       a.credits_attributed                                                  AS credits_method_a,
       b.credits_method_b,
       b.credits_method_b - COALESCE(a.credits_attributed, 0)                AS difference_b_minus_a,
       (b.credits_method_b - a.credits_attributed) / NULLIF(a.credits_attributed, 0) AS difference_pct
FROM cost.v_report_credits_method_a a
FULL OUTER JOIN b ON b.report_id = a.report_id;

-- Warehouse idle overhead (metered compute not attributed to any query)
CREATE OR REPLACE VIEW cost.v_warehouse_idle AS
SELECT warehouse_name,
       SUM(credits_used_compute)                                             AS credits_metered,
       SUM(credits_attributed_compute_queries)                               AS credits_attributed_to_queries,
       SUM(credits_used_compute) - SUM(credits_attributed_compute_queries)  AS credits_idle,
       (SUM(credits_used_compute) - SUM(credits_attributed_compute_queries))
           / NULLIF(SUM(credits_used_compute), 0)                            AS idle_share
FROM account_usage.warehouse_metering_history
GROUP BY warehouse_name;

SELECT * FROM cost.v_warehouse_idle ORDER BY warehouse_name;
