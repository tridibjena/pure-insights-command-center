import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryReplayer } from '../src/services/telemetryReplayer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = Array.from({ length: 200 }, (_, i) => ({
  report_id: `RPT_${200 + (i % 100)}`,
  snapshot_seq: Math.floor(i / 100) + 1,
  avg_load_time_sec: 10,
  refresh_status: 'SUCCESS',
}));

function harness({ ingestMs }) {
  const sent = [];
  const pool = { query: async () => ({ rows }) };
  const ingest = async (events) => {
    await sleep(ingestMs);
    sent.push(...events.map((e) => `${e.reportId}#${e.snapshotSeq}`));
  };
  const config = { replay: { snapshotIntervalMs: 100, loop: false }, thresholds: { latencyAlertSec: 15 } };
  const replayer = createTelemetryReplayer({ pool, ingest, hub: null, config, logger: { error() {}, warn() {} } });
  return { replayer, sent };
}

async function untilPaused(replayer) {
  for (let i = 0; i < 300 && replayer.status().running; i++) await sleep(10);
}

test('pause → start while a batch is in flight never sends a batch twice', async () => {
  const { replayer, sent } = harness({ ingestMs: 40 }); // batches due every 10 ms, each takes 40 ms
  replayer.configure({ intervalMs: 100, pauseAfterSnapshot: 1 });
  await replayer.start();
  for (let i = 0; i < 5; i++) {
    await sleep(15); // a batch is now in flight
    replayer.stop();
    await replayer.start();
  }
  await untilPaused(replayer);
  assert.equal(replayer.status().position, 100);
  assert.equal(sent.length, 100, 'every observation sent exactly once');
  assert.equal(new Set(sent).size, 100);
});

test('reset while a batch is in flight discards that batch', async () => {
  const { replayer } = harness({ ingestMs: 40 });
  replayer.configure({ intervalMs: 100 });
  await replayer.start();
  await sleep(15);
  await replayer.reset({ clearAlerts: false });
  await sleep(80);
  assert.equal(replayer.status().position, 0);
  assert.equal(replayer.status().running, false);
});
