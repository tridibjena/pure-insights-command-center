// Streams the 2,000 cleaned CSV observations, snapshot by snapshot, through the live
// ingestion path — turning the static dataset into a real-time telemetry feed for Task 2.
const BATCHES_PER_SNAPSHOT = 10;

function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function createTelemetryReplayer({ pool, ingest, hub, config, logger }) {
  let observations = null;
  let timer = null;
  const state = {
    running: false,
    position: 0,
    total: 0,
    snapshotsTotal: 0,
    intervalMs: config.replay.snapshotIntervalMs,
    loop: config.replay.loop,
    cycles: 0,
    eventsSent: 0,
    startedAt: null,
    lastSnapshotCompleted: null,
  };

  async function load() {
    if (observations) return observations;
    const { rows } = await pool.query(
      `SELECT report_id, snapshot_seq, avg_load_time_sec, refresh_status
         FROM app.report_observations ORDER BY snapshot_seq, report_id`,
    );
    observations = rows;
    state.total = rows.length;
    state.snapshotsTotal = new Set(rows.map((r) => r.snapshot_seq)).size;
    return rows;
  }

  const perSnapshot = () => state.total / Math.max(state.snapshotsTotal, 1);

  function status() {
    const snapshotSize = perSnapshot();
    return {
      ...state,
      currentSnapshot: state.total ? Math.min(Math.floor(state.position / snapshotSize) + 1, state.snapshotsTotal) : null,
      progress: state.total ? state.position / state.total : 0,
    };
  }

  const publishStatus = () => hub?.broadcast('replay.status', status(), { permission: 'health:read' });

  async function tick() {
    timer = null;
    if (!state.running) return;
    const rows = await load();
    const batchSize = Math.ceil(perSnapshot() / BATCHES_PER_SNAPSHOT);
    const batch = rows.slice(state.position, state.position + batchSize);
    const events = batch.map((r) => ({
      type: 'report.telemetry',
      reportId: r.report_id,
      avgLoadTimeSec: r.avg_load_time_sec,
      refreshStatus: r.refresh_status,
      snapshotSeq: r.snapshot_seq,
    }));
    try {
      await ingest(events, { source: 'replay', actor: 'system:telemetry-replay' });
    } catch (err) {
      logger.error({ err }, 'replay batch failed; stopping');
      state.running = false;
      publishStatus();
      return;
    }
    state.position += batch.length;
    state.eventsSent += batch.length;

    if (state.position % perSnapshot() === 0 || state.position >= state.total) {
      const seq = batch.at(-1)?.snapshot_seq;
      const snap = rows.filter((r) => r.snapshot_seq === seq);
      state.lastSnapshotCompleted = seq;
      hub?.broadcast(
        'telemetry.snapshot',
        {
          snapshotSeq: seq,
          reports: snap.length,
          latencyBreaches: snap.filter((r) => r.avg_load_time_sec > config.thresholds.latencyAlertSec).length,
          refreshFailures: snap.filter((r) => r.refresh_status === 'FAILED' || r.refresh_status === 'TIMED_OUT').length,
          medianLatencySec: median(snap.map((r) => r.avg_load_time_sec)),
        },
        { permission: 'health:read' },
      );
    }
    if (state.position >= state.total) {
      state.cycles += 1;
      if (state.loop) state.position = 0;
      else state.running = false;
    }
    publishStatus();
    schedule();
  }

  function schedule() {
    if (state.running && !timer) timer = setTimeout(tick, state.intervalMs / BATCHES_PER_SNAPSHOT);
  }

  return {
    status,
    preload: load,
    async start() {
      await load();
      if (state.position >= state.total) state.position = 0;
      if (!state.running) {
        state.running = true;
        state.startedAt = new Date().toISOString();
        schedule();
      }
      publishStatus();
      return status();
    },
    stop() {
      state.running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      publishStatus();
      return status();
    },
    async reset({ clearAlerts = true } = {}) {
      this.stop();
      Object.assign(state, { position: 0, cycles: 0, eventsSent: 0, startedAt: null, lastSnapshotCompleted: null });
      if (clearAlerts) {
        await pool.query('TRUNCATE app.alert_events, app.alerts, app.telemetry_events RESTART IDENTITY');
        hub?.broadcast('alerts.cleared', { reason: 'replay reset' }, { permission: 'alerts:read' });
      }
      publishStatus();
      return status();
    },
    configure({ intervalMs, loop }) {
      if (intervalMs != null) state.intervalMs = intervalMs;
      if (loop != null) state.loop = loop;
      publishStatus();
      return status();
    },
    shutdown() {
      state.running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
