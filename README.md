# Pure Insights Command Center

[![CI](https://github.com/tridibjena/pure-insights-command-center/actions/workflows/ci.yml/badge.svg)](https://github.com/tridibjena/pure-insights-command-center/actions/workflows/ci.yml)

**Platform operational analytics for the custom analytics portal** — Case Study 3. The final version is tagged
[`v1.0`](https://github.com/tridibjena/pure-insights-command-center/tree/v1.0).

After the move from Tableau Server to a custom React / Node.js / Snowflake / AWS portal, the business lost native
admin visibility. The Command Center restores it:

* **Report health.** Load latency, refresh failures and ownership for every report.
* **Real-time alerts.** A WebSocket channel notifies operators when a dashboard load exceeds 15 s or an automated refresh fails.
* **Cost attribution.** Snowflake credits are attributed to individual reports from `ACCOUNT_USAGE` logs and turned into a unit cost per active user view.

**Stack:** CSV → **PostgreSQL 16** → **Node.js / Express 5** → **React 19**. A Python pipeline handles the data layer.

| Task / deliverable | Where |
|---|---|
| **Task 1**: full-stack dashboard with RBAC (system health, orphaned reports) | [`server/`](server) · [`client/`](client) · [docs/RBAC.md](docs/RBAC.md) |
| **Task 2**: real-time WebSocket alerting (> 15 s latency, failed refreshes) | [`server/src/services/`](server/src/services) · [docs/API_SPEC.md §5–6](docs/API_SPEC.md#5-alerting-rules-task-2) |
| **Task 3**: Snowflake `ACCOUNT_USAGE` cost attribution, unit cost per active view | [`sql/snowflake/`](sql/snowflake/README.md) · [docs/COST_ALLOCATION_METHODOLOGY.md](docs/COST_ALLOCATION_METHODOLOGY.md) |
| **Deliverable 1**: runnable full-stack codebase | this repository ([Quick start](#quick-start)) |
| **Deliverable 2**: REST API & WebSocket technical specification | [docs/API_SPEC.md](docs/API_SPEC.md) · [openapi.yaml](docs/openapi.yaml) · [asyncapi.yaml](docs/asyncapi.yaml) |
| **Deliverable 3**: Snowflake cost allocation SQL script suite | [`sql/snowflake/00–09`](sql/snowflake/README.md) |
| Injected data anomalies, identified, cleaned and documented | [`pipeline/pic_pipeline/quality_rules.py`](pipeline/pic_pipeline/quality_rules.py) · [docs/DATA_QUALITY.md](docs/DATA_QUALITY.md) (generated) |
| Business synthesis | [docs/BUSINESS_FINDINGS.md](docs/BUSINESS_FINDINGS.md) (generated from live queries) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

**Where each rubric criterion is addressed**

| Criterion | Where to look |
|---|---|
| **Full-Stack Web Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (layers, request path, scaling and limits) · [`server/src/app.js`](server/src/app.js) (every route mount and its permission guard) · [`server/src/auth/permissions.js`](server/src/auth/permissions.js) (RBAC matrix) · [`db/migrations/`](db/migrations) (raw → app → cost schemas) |
| **Real-time Alerting & Telemetry** | [`alertRules.js`](server/src/services/alertRules.js) (rules: > 15 s latency, failed refreshes) · [`alertService.js`](server/src/services/alertService.js) (incident lifecycle, de-duplication) · [`telemetryIngest.js`](server/src/services/telemetryIngest.js) (single ingest path) · [`wsHub.js`](server/src/services/wsHub.js) (cookie-authenticated WebSocket, per-user filtering) · [`client/src/realtime/`](client/src/realtime) (reducer, reconnect, resync) · [API_SPEC.md §5–6](docs/API_SPEC.md#5-alerting-rules-task-2) · [asyncapi.yaml](docs/asyncapi.yaml) |
| **Cloud Cost SQL Attribution** | [`sql/snowflake/00–09`](sql/snowflake/README.md) · [COST_ALLOCATION_METHODOLOGY.md](docs/COST_ALLOCATION_METHODOLOGY.md) · `npm run verify` (reconciliation on PostgreSQL) · `npm run verify:snowflake` (Snowflake dialect, on an emulator) |
| **Code Quality & System Docs** | [CI](.github/workflows/ci.yml) (lint, all tests, reconciliation, Snowflake check and build, on two Node/Python versions) · tests in [`pipeline/tests`](pipeline/tests), [`server/test`](server/test), [`client/src/test`](client/src/test) · [`openapi.contract.test.js`](server/test/openapi.contract.test.js) (routes match the spec) · [`docs/`](docs) |

---

## Quick start

**Prerequisites:** Node.js ≥ 20.19, Python ≥ 3.11, and PostgreSQL 16: either Docker (Desktop running), which setup
uses to start the bundled container, or an existing server ([without Docker](#without-docker)).

```bash
cp .env.example .env          # local defaults; change JWT_SECRET for anything beyond local use
npm install
npm run setup                 # PostgreSQL (existing server, or docker compose) → Python venv → pipeline → demo users
npm run dev                   # API on :4000, dashboard on http://localhost:5173
```

Sign in with any demo account. The password is `SEED_DEMO_PASSWORD` from `.env` (default `PureInsights!2026`).

| Account | Role | Sees |
|---|---|---|
| `admin@pureinsights.local` | Administrator | everything, plus owner reassignment, accounts and the audit log |
| `sre@pureinsights.local` | Platform Engineer | health, alerts (ack/resolve), reports, orphans, data quality, replay control |
| `finops@pureinsights.local` | FinOps Analyst | cost allocation, chargeback, data quality, read-only health and alerts |
| `user_7@company.com` | Report Owner | only the 7 reports user_7 currently owns, and their alerts |

**To see the real-time alerting:** sign in as `sre@…` or `admin@…`, open **Alerts**, and click **Start replay**.
The 2,000 CSV observations stream through the live ingest → alert → WebSocket path, one snapshot at a time.

| Command | What it does |
|---|---|
| `npm run setup` | Uses the PostgreSQL server in `.env` (starting the Docker container if none is reachable), creates both databases, creates the Python venv, runs the full pipeline, seeds users (idempotent; safe to re-run) |
| `npm run pipeline` | migrate → ingest → clean → forensic checks → simulate ACCOUNT_USAGE → cost SQL suite → verify → export → Snowflake-dialect check (emulator) → DQ report → findings |
| `npm run dev` | API (`node --watch`) and Vite dev server |
| `npm start` | Production build: Express serves the built React app on :4000 |
| `npm test` | pytest (52) + server `node:test` (39) + client Vitest (16) |
| `npm run verify` | Rebuilds the `cost.*` views from `sql/snowflake/01–09` and asserts all reconciliation checks pass |
| `npm run verify:snowflake` | Parses the suite as Snowflake SQL and executes it on the Snowflake emulator; checks must match PostgreSQL |
| `npm run lint` | ruff + eslint (server and client) |
| `npm run screenshots` | Re-captures the README screenshots from the running app (Playwright; first run `pipeline/.venv/bin/playwright install chromium`) |

### Without Docker

Docker is only one way to get PostgreSQL. To use a server you already have (a local install, a managed instance):

1. Point `PGHOST`, `PGPORT`, `PGUSER` and `PGPASSWORD` in `.env` at it.
2. Run `npm run setup` as above. It finds the server, skips Docker, and creates `pure_insights` and
   `pure_insights_test` if they don't exist. If the user lacks `CREATEDB`, create both first with `createdb`.

`npm run db:setup` runs just this step.

---

## What the data actually contains

All figures below come from programmatic checks: [`quality_rules.py`](pipeline/pic_pipeline/quality_rules.py)
and the tests in [`pipeline/tests/`](pipeline/tests).

* **Shape.** 2,000 rows, but only **100 distinct `report_id`s**, each appearing exactly 20 times in identical order. There is no timestamp. The rows are modelled as **100 reports × 20 monthly snapshots**. This is tested, not assumed: consecutive passes have lag-1 autocorrelation ≈ 0 (overlapping daily windows would give ≈ +0.97), so each pass is its own 30-day period. The calendar anchor is the last complete month before the data was received (CSV delivered 2026-10-09), giving **Feb 2025 → Sep 2026**.
* **Orphaned owners: 245 rows.** `nan` × 128 and `ORPHANED_REPORT` × 117. These are nulled and flagged. **14 reports** are orphaned right now (latest snapshot). Admins can reassign owners, and every reassignment is audited.
* **Negative Snowflake credits: 24 rows**, from −13.6 to −0.8 (total −161.04). These are **quarantined**: excluded from attribution, not abs()'d and not zeroed. Clean total: **1,206,352.48** credits.
* **Load latency up to 55 s.** The alert threshold is **> 15 s**, from the brief. **55 s is the dataset's extreme, not a threshold**: 6 readings sit exactly at 55.0 s. Spikes are kept unchanged and alerted on. 7 readings of exactly 15.0 s correctly do *not* alert. 1,490 rows (74.5 %) breach.
* **Active users vs AWS cost.**
  * The correlation is **−0.027**, so hosting cost does not track usage.
  * 4 zero-view months still carry cost.
  * 93 rows report more peak concurrent users than monthly views, which is impossible.
  * 135 rows exceed the robust Q3 + 3×IQR cost-per-view fence ($2.06/view).
* **Not in the brief: investigated with statistical tests** (see [forensic checks](docs/DATA_QUALITY.md#7--forensic-checks), also on the Data Quality page).
  * **`UNKNOWN` refresh status (100 rows)** is missing telemetry, not a hidden failure. It is no more likely after a failed month (4.8 % vs 5.0 % base) and has the same latency, credits and views as other rows, so it raises a telemetry-gap warning rather than counting as a failure.
  * **Ownership churn** (about 10 owners per report over 20 months) is random reassignment. A report keeps last month's owner 6.5 % of the time, against 7.2 % for pure chance among 14 owners, and orphaning doesn't persist either.
  * **Anomaly overlaps** are chance or arithmetic. Negative credits ∧ orphaned: 3 observed vs 2.94 expected. Zero-view months carry credits because 98.8 % of rows do. The only significant pairs follow from very low view counts.
  * **Report identity explains none of the variance** (permutation ANOVA p = 0.14–0.88). Portfolio findings are robust, but per-report rankings are illustrative in this dataset.

---

## Screenshots

All 15 screenshots come from the running application with the real dataset (`npm run screenshots`), across all four roles. The UI is
dark-only, set in Geist, with the **Everpure brand orange** (`#ff7023`, from everpuredata.com's
`--ps-color-brand-500` token) as the single accent and its darker step `#d55d1d` for chart marks. The layout takes
inspiration from a two-tone analytics dashboard concept: a top pill navigation, large light-weight titles and
numbers, rounded charcoal cards for tables and charts, lighter glass cards for KPIs, pill filter groups, gradient bars
with a solid cap, and a glow callout. The most severe tier is called out in red: the Critical card and critical
pop-up notifications use a red background. Severity is always shown with an icon and a label, never by colour alone.
Every page header shows the live alert counts and the WebSocket state; the **Mute notifications** button in the top
bar silences pop-ups.

### 1 · Sign in

![Sign-in page](docs/screenshots/01-login.png)

Local accounts stored in PostgreSQL with bcrypt hashes. A successful sign-in sets an httpOnly,
`SameSite=Strict` session cookie; the token never reaches JavaScript. The same cookie authenticates the
WebSocket. The list below the form has one demo account per role. Failed sign-ins are rate-limited and audited.

### 2 · System Health (Task 1)

![System Health](docs/screenshots/02-system-health.png)

The landing page for operators.

* **Headline:** **76 of 100 reports** breach the 15 s load SLO in the latest snapshot, and 74.5 % of all 2,000 report-months do.
* **Latency histogram:** the 15 s threshold marks where the bins turn from OK to Warning. The values run evenly up to the 55 s ceiling, which shows the latency problem is systemic rather than a few outliers.
* **Trend chart:** breach rate and refresh-failure rate per snapshot (~28 % of refreshes fail).
* **Platform self-health:** database latency, API p95, WebSocket clients and replay state.

### 3 · Real-time alerting (Task 2)

![Live alerting](docs/screenshots/03-live-alerting.png)

Mid-replay, as the Platform Engineer.

* **Toasts:** WebSocket messages arrive as toasts. An "Escalated · …" toast is an existing incident moving up a severity band, not a new alert. Bursts are capped at 3 toasts plus a "+N more" summary.
* **One incident per report and rule:** the capture uses the replay's `pauseAfterSnapshot: 3` setting, so the replayer stops itself at exactly 300 events and these numbers reproduce. At that point there are **108 live incidents** (41 critical, 29 high, 38 warning) and **86 auto-resolved** ones, and **134 repeat breaches** were folded into existing incidents instead of producing new notifications.

### 4 · Alert lifecycle

![Alert detail](docs/screenshots/04-alert-detail.png)

One incident's full history, for RPT_299:

1. **RAISED** at HIGH (37.4 s).
2. **REPEATED** at WARNING (21.8 s).
3. **ESCALATED** to CRITICAL at **55.0 s**, the dataset's most extreme load. The value is alerted on as-is, never capped.
4. **ACKNOWLEDGED** by the engineer.

Every transition, with its actor, is stored in `app.alert_events`. When latency returns to ≤ 15 s (or a refresh
succeeds) the incident resolves automatically.

### 5 · Orphaned reports (Task 1)

![Orphaned reports](docs/screenshots/05-orphaned-reports.png)

The 14 reports with no owner in their latest snapshot. Each row shows the raw source marker (`nan` /
`ORPHANED_REPORT`), the last known owner, and the lifetime spend accumulated while it had no owner. In total,
orphaned report-months carry **$480.9K** across 245 rows. The admin-only dialog assigns an owner. The change is
an audited override, so the source data is never edited, and it is pushed live to the new owner's session.

### 6 · Report drill-down

![Report drill-down](docs/screenshots/06-report-drilldown.png)

RPT_265 ties several anomalies together:

* **Latency:** 14 of 20 snapshots above 15 s, each point coloured by its severity band.
* **Refresh outcomes:** 7 failed refreshes in the outcome strip.
* **Ownership:** 9 different owners, with orphan spans showing the raw values.
* **Data quality:** a −8.43 credit reading quarantined in snapshot 10.
* **Cost:** fully loaded cost of **$3.45 per active view** (FinOps/Admin only).

### 7 · Cost allocation (Task 3)

![Cost allocation](docs/screenshots/07-cost-allocation.png)

Snowflake credits attributed per report from `QUERY_ATTRIBUTION_HISTORY` via `QUERY_TAG`, using the same SQL as
[`sql/snowflake/`](sql/snowflake/README.md).

* **Unit cost:** at $3/credit (Snowflake Enterprise, on-demand, AWS US East), a view costs **$2.74 fully loaded** ($2.43 Snowflake + $0.31 AWS). The edition table shows Standard ($1.93) and Business Critical ($3.55) as well.
* **Reconciliation:** all six checks **PASS**. Method A equals the clean source credits to the cent, and the quarantined amount equals the −161.04 of negatives.
* **Ranking:** the top 15 reports by cost per view; ★ marks decommission candidates.
* **AWS scatter:** shows hosting cost does not follow usage, with flagged report-months in copper.
* **Chargeback:** spend by owner, with orphaned spend (11.8 %) as the largest "owner".

### 8 · Data quality

![Data quality](docs/screenshots/08-data-quality.png)

The anomaly register: 10 rules, each with its detection logic, severity, action (NULLIFY / QUARANTINE /
ANNOTATE) and the number of rows and reports affected. Selecting a rule lists the offending CSV rows with their
raw values. The callout spells out the 15 s threshold vs 55 s extreme distinction. The same register drives the
generated [docs/DATA_QUALITY.md](docs/DATA_QUALITY.md).

### 9 · RBAC in action

![Report owner scope](docs/screenshots/09a-rbac-report-owner-scope.png)

Signed in as the Report Owner `user_7@company.com`:

* **Navigation:** only Alerts and Reports.
* **Data:** the table holds exactly the **7 reports** user_7 currently owns, and the top bar shows the scope.
* **Real-time:** alerts and WebSocket messages are filtered to those reports on the server.

![Forbidden](docs/screenshots/09b-rbac-forbidden.png)

Opening `/costs` directly shows a 403 page that names the missing permission (`costs:read`). The API rejects the
same request with a 403 and records the denial in the audit log.

### 10 · Administration

![Administration](docs/screenshots/10-administration.png)

* **Permission matrix:** the role → permission matrix that the API enforces (◐ = row-scoped).
* **Replay controls:** start, pause, reset and speed.
* **Accounts.**
* **Audit trail:** sign-ins, the alert acknowledgement and the replay actions from the session above.

### 11 · Platform Engineer: report inventory

![Platform engineer reports](docs/screenshots/11-platform-engineer-reports.png)

Signed in as `sre@pureinsights.local`. The engineer sees all **100 reports**: latest load time, severity band, refresh outcome, views, how many of the 20 snapshots breached 15 s, failed refreshes and live alerts. Every column sorts and the filters combine. Orphaned reports are tinted. The navigation has no **Cost Allocation** or **Administration** tabs, because those need `costs:read` and `users:read`.

### 12 · FinOps Analyst: orphaned reports, read-only

![FinOps orphaned reports](docs/screenshots/12-finops-orphaned-read-only.png)

Signed in as `finops@pureinsights.local`. FinOps sees the same **14 orphaned reports** and **$480.9K unowned spend** as the administrator in screenshot 5, but without the **Assign owner** actions: reassignment needs `owners:reassign`, which only the administrator has. The server enforces this too (`POST /api/orphans/{id}/assign-owner` returns 403 for this role).

### 13 · Report Owner: alerts for their own reports only

![Report owner alerts](docs/screenshots/13-report-owner-alerts.png)

Signed in as `user_7@company.com`. Of the 108 live incidents in screenshot 3, this user receives only the **8 on reports they currently own** (1 critical, 2 high, 5 warning), over REST and over the WebSocket alike. There is no replay panel (`replay:control`) and alerts can't be acknowledged (`alerts:ack`). The scope chip in the top bar shows whose reports these are.

### 14 · Report Owner: drill-down of an owned report

![Report owner drill-down](docs/screenshots/14-report-owner-drilldown.png)

RPT_273, one of user_7's reports. The owner gets the full 20-snapshot latency history, refresh outcomes, owner timeline and that report's alerts. They don't get the **cost per view** tile (`costs:read`) or the **data-quality findings** panel (`dq:read`) that the administrator sees in screenshot 6. The open alerts reflect the replay's current position (snapshot 3, where the load was 25.0 s); the history chart shows all 20 snapshots, ending at 8.5 s.

---

## Key findings (summary)

The full write-up, generated from live queries, is in [docs/BUSINESS_FINDINGS.md](docs/BUSINESS_FINDINGS.md).

1. **The latency SLO is broken across the whole platform.** 74.5 % of report-months exceed 15 s, with a median of 27.8 s. Fixing a handful of slow dashboards will not help, so the fix belongs in shared layers: warehouse sizing, caching, payload size.
2. **28.2 % of refreshes fail or time out.** Latency is the same whether a refresh failed or succeeded, so the two problems have independent causes.
3. **Unowned spend is $480.9K**, the largest "owner" in the chargeback. Mandatory ownership at publish time would close it.
4. **AWS hosting cost is decoupled from usage** (r = −0.027), which points to rightsizing. The decommission ranking demonstrates the method; in this dataset report identity carries no statistical signal, so it should be re-run on production data.
5. **Snowflake dominates unit cost.** At the Enterprise price of $3/credit it is $2.43 of the $2.74 per view ($1.62 to $3.25 across editions).
6. **Failed refreshes sit behind $1.14M of spend:** 564 report-months whose refresh failed or timed out carried 337,131 credits ($1.01M) plus $129K of AWS hosting.

## Assumptions

Each assumption is either tested against the data or tied to an external source:

* **Timeline.** Monthly cadence is *tested* (lag-1 autocorrelation ≈ 0). Only the calendar anchor is a convention: the last complete month before the data was received, Sep 2026. It's configurable via `DATA_AS_OF_MONTH`.
* **Credit price.** `CREDIT_PRICE_USD = 3.00` is Snowflake's on-demand list price for **Enterprise edition on AWS US East**; Standard is $2 and Business Critical $4. The brief puts the portal on AWS, and Enterprise is the edition that provides the multi-cluster warehouses a portal of this concurrency needs. The SQL suite reports unit cost at all three prices (`cost.v_unit_cost_price_sensitivity`).
* **Simulated ACCOUNT_USAGE logs.** The brief asks for simulated logs. They are derived from the CSV and **add no spend of their own**: the CSV has no evidence of warehouse idle time or untagged work, so none is invented, and failed-refresh spend is reported from the CSV itself. The SQL still measures idle and untagged spend; the tests switch both on to prove it.
* **Snowflake execution.** Every statement in `sql/snowflake/00–09` parses as Snowflake SQL, and the whole suite **executes in Snowflake dialect** on the fakesnow emulator with all 6 reconciliation checks passing and figures identical to PostgreSQL (`python -m pic_pipeline.cli snowflake`, also in the test suite). The same script runs against a real account with `python -m pic_pipeline.cli snowflake-live` once `SNOWFLAKE_ACCOUNT/USER/PASSWORD` are set. That last step is the only one not yet run.
* **Severity tiers.** The 30 s and 45 s tiers are configurable display bands. Only the 15 s threshold comes from the brief.

## Repository layout

```
├─ data/raw/                 source CSV (data/simulated/ is generated)
├─ db/migrations/            idempotent PostgreSQL DDL
├─ pipeline/                 Python: ingest · quality rules · simulation · SQL-suite runner · docs generators · screenshots
├─ sql/snowflake/            Deliverable 3 — cost allocation SQL suite (00–09)
├─ server/                   Node.js/Express API, RBAC, alerting, WebSocket hub, replay (+ tests)
├─ client/                   React dashboard (+ tests)
└─ docs/                     API spec (MD + OpenAPI + AsyncAPI), architecture, RBAC, methodology,
                             generated data-quality and findings reports, screenshots
```
