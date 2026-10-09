-- Separate database for the automated integration tests, so `npm test`
-- never touches the data that the running dashboard is serving.
CREATE DATABASE pure_insights_test;
