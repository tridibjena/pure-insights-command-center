# Role-Based Access Control

## Login

* **Accounts:** local accounts in PostgreSQL (`app.users`), with bcrypt password hashes (cost 12).
* **Session:** an HS256 JWT (8 h) in the httpOnly, `SameSite=Strict` cookie `pic_session` (also `Secure` in production).
* **One session for both channels:** the same cookie authenticates the REST API and the WebSocket upgrade.
* **Machine access:** telemetry collectors use `X-API-Key` and get the SERVICE role.

## Roles

| Role | Who | Can |
|---|---|---|
| ADMIN | Platform administrators | Everything, including assigning owners to orphaned reports, accounts and the audit log |
| PLATFORM_ENGINEER | SRE / on-call | System health, reports, orphans, data quality; acknowledge and resolve alerts; control the replay |
| FINOPS_ANALYST | Cloud cost / FinOps | Cost allocation, chargeback, unit costs, data quality, read-only health and alerts |
| REPORT_OWNER | Business owner of dashboards | Their own reports and the alerts on them, row-scoped |
| SERVICE | Telemetry collectors (API key) | `telemetry:ingest` only |

The full permission matrix is in [API_SPEC.md §3](API_SPEC.md#3-role-based-access-control). The single source of
truth is `server/src/auth/permissions.js`.

## Enforcement points

1. **REST:** every `/api` mount is wrapped in `authenticate` and `requirePermission`. Narrower actions (`owners:reassign`, `alerts:ack`, `replay:control`) add a second guard on the route.
2. **Row scope:** for REPORT_OWNER, queries are filtered to reports whose current owner is the user's `owner_email`. Requests for any other report return 404 rather than 403.
3. **WebSocket:**
   * The upgrade requires a valid session, `alerts:read`, and an allowed Origin.
   * Each message carries a required permission and an optional `report_id`.
   * Owner-scoped sockets receive only messages for reports they own. Their scope refreshes immediately after an owner reassignment, and every 60 s.
4. **UI:** navigation and buttons are hidden for missing permissions, and a direct URL shows the 403 page. This is a convenience only; the server enforces everything.
5. **Audit:** sign-ins (success and failure), every denied request and every privileged action are written to `app.audit_log`, which ADMIN can view.
