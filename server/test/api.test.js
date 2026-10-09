import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAlerts, client, login, openSocket, postTelemetry, startTestServer, USERS } from './helpers.js';

let ctx;
const as = {};

before(async () => {
  ctx = await startTestServer();
  for (const who of Object.keys(USERS)) as[who] = client(ctx, (await login(ctx, who)).cookie);
  as.anon = client(ctx, null);
});
after(async () => {
  await ctx.pool.query('DELETE FROM app.owner_overrides');
  await clearAlerts(ctx.pool);
  await ctx.close();
});

describe('authentication', () => {
  test('rejects unauthenticated requests', async () => {
    assert.equal((await as.anon('GET', '/api/reports')).status, 401);
  });

  test('rejects a wrong password with a generic error', async () => {
    const { res, body } = await login(ctx, 'admin', 'wrong-password');
    assert.equal(res.status, 401);
    assert.equal(body.error.code, 'INVALID_CREDENTIALS');
  });

  test('issues an httpOnly SameSite=Strict session cookie', async () => {
    const { res, body } = await login(ctx, 'finops');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /pic_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.equal(body.user.role, 'FINOPS_ANALYST');
    assert.ok(!('token' in body));
  });

  test('requires the CSRF header on state-changing requests', async () => {
    const { cookie } = await login(ctx, 'admin');
    const res = await fetch(`${ctx.baseUrl}/api/telemetry/replay/stop`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'CSRF_CHECK_FAILED');
  });
});

describe('role-based access control', () => {
  test('FinOps can read costs; platform engineers cannot (and the denial is audited)', async () => {
    assert.equal((await as.finops('GET', '/api/costs/summary')).status, 200);
    assert.equal((await as.sre('GET', '/api/costs/summary')).status, 403);
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'access.denied' AND actor_email = $1`,
      [USERS.sre],
    );
    assert.ok(rows[0].n >= 1);
  });

  test('report owners cannot see system health, data quality or admin', async () => {
    for (const url of ['/api/dashboard/summary', '/api/data-quality/rules', '/api/admin/users', '/api/costs/summary']) {
      assert.equal((await as.owner('GET', url)).status, 403, url);
    }
  });

  test('report owners only see the reports they own', async () => {
    const { status, body } = await as.owner('GET', '/api/reports?pageSize=100');
    assert.equal(status, 200);
    assert.equal(body.total, 7);
    assert.ok(body.reports.every((r) => r.owner_email === USERS.owner));
    const all = await as.admin('GET', '/api/reports?pageSize=100');
    assert.equal(all.body.total, 100);
    const notMine = all.body.reports.find((r) => r.owner_email !== USERS.owner);
    assert.equal((await as.owner('GET', `/api/reports/${notMine.report_id}`)).status, 404);
  });

  test('report filters', async () => {
    const orphaned = await as.admin('GET', '/api/reports?orphaned=true&pageSize=100');
    assert.equal(orphaned.body.total, 14);
    const search = await as.admin('GET', '/api/reports?search=Dashboard%2010&pageSize=100');
    assert.ok(search.body.reports.every((r) => r.report_name.includes('Dashboard 10')));
  });
});

describe('orphaned report reassignment', () => {
  test('only admins can reassign; the new owner gains access immediately', async () => {
    const { body } = await as.admin('GET', '/api/orphans');
    assert.equal(body.summary.orphaned_now, 14);
    const target = body.reports[0].report_id;

    const denied = await as.sre('POST', `/api/orphans/${target}/assign-owner`, { ownerEmail: USERS.owner });
    assert.equal(denied.status, 403);

    const bad = await as.admin('POST', `/api/orphans/${target}/assign-owner`, { ownerEmail: 'not-an-email' });
    assert.equal(bad.status, 400);

    const ok = await as.admin('POST', `/api/orphans/${target}/assign-owner`, { ownerEmail: USERS.owner, note: 'test' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.report.owner_email, USERS.owner);
    assert.equal(ok.body.report.is_orphaned, false);

    assert.equal((await as.admin('GET', '/api/orphans')).body.summary.orphaned_now, 13);
    assert.equal((await as.owner('GET', `/api/reports/${target}`)).status, 200);
    await ctx.pool.query('DELETE FROM app.owner_overrides WHERE report_id = $1', [target]);
  });
});

describe('real-time alerting over WebSocket', () => {
  beforeEach(() => clearAlerts(ctx.pool));

  test('rejects unauthenticated socket upgrades', async () => {
    await assert.rejects(openSocket(ctx, null), (err) => err.status === 401);
  });

  test('telemetry above 15 s raises, escalates, deduplicates and auto-resolves one incident', async () => {
    const { cookie } = await login(ctx, 'sre');
    const sock = await openSocket(ctx, cookie);
    await sock.next((m) => m.type === 'session.ready');
    const ev = (avgLoadTimeSec) => ({ type: 'report.telemetry', reportId: 'RPT_200', avgLoadTimeSec });

    const exactly = await postTelemetry(ctx, [ev(15)]);
    assert.equal(exactly.status, 202);
    assert.equal(exactly.body.transitions.length, 0, '15.0 s must not alert');

    await postTelemetry(ctx, [ev(16.2)]);
    const raised = await sock.next((m) => m.type === 'alert.raised');
    assert.equal(raised.data.rule_code, 'LATENCY_SLO_BREACH');
    assert.equal(raised.data.severity, 'WARNING');
    assert.ok(raised.id && raised.ts);

    await postTelemetry(ctx, [ev(55)]);
    const escalated = await sock.next((m) => m.type === 'alert.escalated');
    assert.equal(escalated.data.severity, 'CRITICAL');
    assert.equal(escalated.data.metric_value, 55);
    assert.equal(escalated.data.alert_id, raised.data.alert_id, 'same incident, not a new alert');

    await postTelemetry(ctx, [ev(40)]);
    const updated = await sock.next((m) => m.type === 'alert.updated');
    assert.equal(updated.data.occurrence_count, 3);
    assert.equal(updated.data.peak_severity, 'CRITICAL');

    await postTelemetry(ctx, [ev(9.5)]);
    const resolved = await sock.next((m) => m.type === 'alert.resolved');
    assert.equal(resolved.data.status, 'RESOLVED');
    assert.equal(resolved.data.resolved_by, 'system:auto-recovery');

    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM app.alerts');
    assert.equal(rows[0].n, 1);
    sock.close();
  });

  test('failed and timed-out refreshes raise REFRESH_FAILURE; UNKNOWN is a telemetry gap', async () => {
    const res = await postTelemetry(ctx, [
      { type: 'report.telemetry', reportId: 'RPT_201', refreshStatus: 'FAILED' },
      { type: 'report.telemetry', reportId: 'RPT_202', refreshStatus: 'TIMED_OUT' },
      { type: 'report.telemetry', reportId: 'RPT_203', refreshStatus: 'UNKNOWN' },
    ]);
    const t = res.body.transitions;
    assert.deepEqual(t.map((x) => [x.ruleCode, x.severity]), [
      ['REFRESH_FAILURE', 'CRITICAL'],
      ['REFRESH_FAILURE', 'HIGH'],
      ['TELEMETRY_GAP', 'WARNING'],
    ]);
  });

  test('report owners only receive alerts for their own reports', async () => {
    const mine = (await as.owner('GET', '/api/reports?pageSize=1')).body.reports[0].report_id;
    const { cookie } = await login(ctx, 'owner');
    const sock = await openSocket(ctx, cookie);
    const ready = await sock.next((m) => m.type === 'session.ready');
    assert.ok(ready.data.scopedReports.includes(mine));
    const other = ready.data.scopedReports.includes('RPT_299') ? 'RPT_298' : 'RPT_299';

    await postTelemetry(ctx, [
      { type: 'report.telemetry', reportId: other, avgLoadTimeSec: 50 },
      { type: 'report.telemetry', reportId: mine, avgLoadTimeSec: 50 },
    ]);
    const msg = await sock.next((m) => m.type === 'alert.raised');
    assert.equal(msg.data.report_id, mine);
    assert.ok(!sock.messages.some((m) => m.data?.report_id === other));
    const listed = await as.owner('GET', '/api/alerts');
    assert.deepEqual(listed.body.alerts.map((a) => a.report_id), [mine]);
    sock.close();
  });

  test('acknowledge workflow and permissions', async () => {
    const { body } = await postTelemetry(ctx, [{ type: 'report.telemetry', reportId: 'RPT_210', avgLoadTimeSec: 33 }]);
    const id = body.transitions[0].alertId;
    assert.equal((await as.finops('POST', `/api/alerts/${id}/acknowledge`, {})).status, 403);
    const ack = await as.sre('POST', `/api/alerts/${id}/acknowledge`, { note: 'investigating' });
    assert.equal(ack.status, 200);
    assert.equal(ack.body.alert.status, 'ACKNOWLEDGED');
    assert.equal((await as.sre('POST', `/api/alerts/${id}/acknowledge`, {})).status, 409);
    const detail = await as.sre('GET', `/api/alerts/${id}`);
    assert.deepEqual(detail.body.events.map((e) => e.event_type), ['RAISED', 'ACKNOWLEDGED']);
    const resolved = await as.sre('POST', `/api/alerts/${id}/resolve`, { resolution: 'cache warmed' });
    assert.equal(resolved.body.alert.status, 'RESOLVED');
  });

  test('telemetry ingestion requires a valid API key and valid events', async () => {
    assert.equal((await postTelemetry(ctx, [{ type: 'report.telemetry', reportId: 'RPT_200', avgLoadTimeSec: 20 }], 'wrong-key-000000')).status, 401);
    assert.equal((await postTelemetry(ctx, [{ type: 'report.telemetry', reportId: 'RPT_200' }])).status, 400);
    assert.equal((await postTelemetry(ctx, [{ type: 'nope' }])).status, 400);
  });

  test('browser RUM beacon above 15 s raises RUM_SLOW_LOAD', async () => {
    const res = await as.finops('POST', '/api/telemetry/rum', { route: '/costs', loadTimeSec: 17.4 });
    assert.equal(res.status, 202);
    assert.equal(res.body.transitions[0].ruleCode, 'RUM_SLOW_LOAD');
  });
});

describe('replay drives the same pipeline', () => {
  test('a replay batch produces alerts from the CSV observations', async () => {
    await clearAlerts(ctx.pool);
    await as.admin('POST', '/api/telemetry/replay/reset', { clearAlerts: true });
    await as.admin('POST', '/api/telemetry/replay/config', { intervalMs: 1000 });
    const started = await as.admin('POST', '/api/telemetry/replay/start');
    assert.equal(started.body.running, true);
    for (let i = 0; i < 40 && ctx.replayer.status().position < 100; i++) await new Promise((r) => setTimeout(r, 100));
    await as.admin('POST', '/api/telemetry/replay/stop');
    assert.ok(ctx.replayer.status().position >= 100);
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM app.alerts WHERE rule_code = 'LATENCY_SLO_BREACH'`,
    );
    // Snapshot 1 of the CSV: 77 of 100 reports load slower than 15 s
    assert.equal(rows[0].n, 77);
    assert.equal((await as.sre('POST', '/api/telemetry/replay/reset', {})).status, 200);
    assert.equal((await as.finops('POST', '/api/telemetry/replay/start')).status, 403);
  });
});
