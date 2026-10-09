-- Pure Insights Command Center — schema layout
--   raw            : CSV landed verbatim as text (lineage, no coercion)
--   app            : cleaned operational model + application state (users, alerts, audit)
--   portal         : portal-side usage facts consumed by the Snowflake cost SQL suite
--   account_usage  : simulated Snowflake SNOWFLAKE.ACCOUNT_USAGE views (Task 3)
--   cost           : views created by sql/snowflake/03-09 (rebuilt by the pipeline)
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS account_usage;
CREATE SCHEMA IF NOT EXISTS cost;
