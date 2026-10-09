// Single ingestion path for every telemetry source (replay, external collectors, browser RUM):
// persist → evaluate rules → apply alert lifecycle → broadcast. Events are processed one at a
// time (in-process queue) so incident de-duplication never races.
import { z } from 'zod';
import { withTransaction } from '../db.js';
import { evaluate, normaliseStatus } from './alertRules.js';
import { applySignal } from './alertService.js';

export const reportEventSchema = z
  .object({
    type: z.literal('report.telemetry'),
    reportId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    avgLoadTimeSec: z.number().finite().nullable().optional(),
    refreshStatus: z.string().max(32).nullable().optional(),
    snapshotSeq: z.number().int().positive().optional(),
    observedAt: z.iso.datetime().optional(),
  })
  .refine((e) => e.avgLoadTimeSec != null || e.refreshStatus != null, {
    message: 'avgLoadTimeSec or refreshStatus is required',
  });

export const clientLoadSchema = z.object({
  type: z.literal('client.load'),
  route: z.string().min(1).max(200),
  loadTimeSec: z.number().finite().nonnegative(),
});

export function createTelemetryIngest({ pool, hub, thresholds, logger }) {
  let queue = Promise.resolve();

  async function processOne(event, source, actor) {
    const signals = evaluate(event, thresholds);
    const messages = await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO app.telemetry_events (source, event_type, report_id, snapshot_seq, avg_load_time_sec, refresh_status, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          source,
          event.type,
          event.reportId ?? null,
          event.snapshotSeq ?? null,
          event.avgLoadTimeSec ?? event.loadTimeSec ?? null,
          normaliseStatus(event.refreshStatus),
          event,
        ],
      );
      const out = [];
      for (const signal of signals) {
        const msg = await applySignal(client, signal, actor);
        if (msg) out.push(msg);
      }
      return out;
    });
    for (const msg of messages) {
      hub?.broadcast(msg.type, msg.alert, { reportId: msg.alert.report_id });
    }
    return messages;
  }

  /** Ingest a batch sequentially. Returns counts and the alert transitions produced. */
  function ingest(events, { source, actor }) {
    const run = queue.then(async () => {
      const transitions = [];
      for (const event of events) {
        const msgs = await processOne(event, source, actor);
        transitions.push(...msgs.map((m) => ({ type: m.type, alertId: m.alert.alert_id, ruleCode: m.alert.rule_code, reportId: m.alert.report_id, severity: m.alert.severity })));
      }
      return { accepted: events.length, transitions };
    });
    queue = run.catch((err) => logger.error({ err }, 'telemetry ingest failed'));
    return run;
  }

  return { ingest };
}
