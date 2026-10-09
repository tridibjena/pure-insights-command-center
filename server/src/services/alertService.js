// Alert lifecycle with incident de-duplication.
//
// At most one live (OPEN or ACKNOWLEDGED) alert exists per dedupe key (rule + report),
// enforced by a partial unique index. Repeated breaches update that incident instead of
// creating new ones; a higher severity escalates it; recovery auto-resolves it.
import { SEVERITY_RANK } from './alertRules.js';

const higher = (a, b) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

async function recordEvent(client, alertId, eventType, { severity = null, actor, metricValue = null, detail = {} }) {
  await client.query(
    `INSERT INTO app.alert_events (alert_id, event_type, severity, actor, metric_value, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [alertId, eventType, severity, actor, metricValue, detail],
  );
}

/** Apply one signal inside an open transaction. Returns a broadcast message or null. */
export async function applySignal(client, signal, actor) {
  const { rows } = await client.query(
    `SELECT * FROM app.alerts WHERE dedupe_key = $1 AND status <> 'RESOLVED' FOR UPDATE`,
    [signal.dedupeKey],
  );
  const live = rows[0];

  if (!signal.breached) {
    if (!live) return null;
    const { rows: [alert] } = await client.query(
      `UPDATE app.alerts
          SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2, resolution = $3,
              metric_value = COALESCE($4, metric_value), updated_at = now()
        WHERE alert_id = $1 RETURNING *`,
      [live.alert_id, 'system:auto-recovery', signal.resolution, signal.metricValue],
    );
    await recordEvent(client, alert.alert_id, 'RESOLVED', { actor: 'system:auto-recovery', metricValue: signal.metricValue, detail: { resolution: signal.resolution } });
    return { type: 'alert.resolved', alert };
  }

  if (!live) {
    const { rows: [alert] } = await client.query(
      `INSERT INTO app.alerts (dedupe_key, rule_code, report_id, severity, peak_severity, status, title, message,
                               metric_value, threshold)
       VALUES ($1, $2, $3, $4, $4, 'OPEN', $5, $6, $7, $8) RETURNING *`,
      [signal.dedupeKey, signal.ruleCode, signal.reportId, signal.severity, signal.title, signal.message,
        signal.metricValue, signal.threshold],
    );
    await recordEvent(client, alert.alert_id, 'RAISED', { severity: signal.severity, actor, metricValue: signal.metricValue });
    return { type: 'alert.raised', alert };
  }

  const escalated = SEVERITY_RANK[signal.severity] > SEVERITY_RANK[live.severity];
  const { rows: [alert] } = await client.query(
    `UPDATE app.alerts
        SET severity = $2, peak_severity = $3, occurrence_count = occurrence_count + 1, last_seen_at = now(),
            metric_value = $4, title = $5, message = $6, updated_at = now()
      WHERE alert_id = $1 RETURNING *`,
    [live.alert_id, signal.severity, higher(live.peak_severity, signal.severity), signal.metricValue, signal.title, signal.message],
  );
  await recordEvent(client, alert.alert_id, escalated ? 'ESCALATED' : 'REPEATED', {
    severity: signal.severity, actor, metricValue: signal.metricValue, detail: { from: live.severity },
  });
  return { type: escalated ? 'alert.escalated' : 'alert.updated', alert };
}

export async function acknowledge(client, alertId, user, note) {
  const { rows: [alert] } = await client.query(
    `UPDATE app.alerts SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now(), updated_at = now()
      WHERE alert_id = $1 AND status = 'OPEN' RETURNING *`,
    [alertId, user.email],
  );
  if (alert) await recordEvent(client, alertId, 'ACKNOWLEDGED', { actor: user.email, detail: note ? { note } : {} });
  return alert ?? null;
}

export async function resolveManually(client, alertId, user, resolution) {
  const { rows: [alert] } = await client.query(
    `UPDATE app.alerts SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2, resolution = $3, updated_at = now()
      WHERE alert_id = $1 AND status <> 'RESOLVED' RETURNING *`,
    [alertId, user.email, resolution],
  );
  if (alert) await recordEvent(client, alertId, 'RESOLVED', { actor: user.email, detail: { resolution } });
  return alert ?? null;
}
