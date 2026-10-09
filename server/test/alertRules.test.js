import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, latencyBand, normaliseStatus } from '../src/services/alertRules.js';

const t = { latencyAlertSec: 15, latencyHighAboveSec: 30, latencyCriticalAboveSec: 45, latencyInvalidAboveSec: 300 };
const latency = (v) => evaluate({ type: 'report.telemetry', reportId: 'RPT_1', avgLoadTimeSec: v }, t);

test('15 s is the threshold: exactly 15.0 does not alert, anything above does', () => {
  assert.equal(latencyBand(15, t), 'OK');
  assert.equal(latencyBand(15.01, t), 'WARNING');
  assert.equal(latency(15)[0].breached, false);
  assert.equal(latency(15.1)[0].breached, true);
});

test('severity bands above the threshold', () => {
  assert.equal(latencyBand(30, t), 'WARNING');
  assert.equal(latencyBand(30.01, t), 'HIGH');
  assert.equal(latencyBand(45, t), 'HIGH');
  assert.equal(latencyBand(45.01, t), 'CRITICAL');
});

test('the 55 s dataset extreme is a CRITICAL alert and the value is preserved', () => {
  const [s] = latency(55);
  assert.equal(s.severity, 'CRITICAL');
  assert.equal(s.metricValue, 55);
  assert.equal(s.threshold, 15);
});

test('invalid latency readings never raise alerts', () => {
  for (const v of [0, -1, 301, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(latency(v), []);
});

test('refresh outcomes', () => {
  const ev = (status) => evaluate({ type: 'report.telemetry', reportId: 'RPT_1', refreshStatus: status }, t);
  const failed = ev('FAILED');
  assert.equal(failed[0].ruleCode, 'REFRESH_FAILURE');
  assert.equal(failed[0].severity, 'CRITICAL');
  assert.equal(failed[1].ruleCode, 'TELEMETRY_GAP');
  assert.equal(failed[1].breached, false);
  assert.equal(ev('TIMED_OUT')[0].severity, 'HIGH');
  const unknown = ev('UNKNOWN');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].ruleCode, 'TELEMETRY_GAP');
  assert.equal(unknown[0].severity, 'WARNING');
  assert.ok(ev('SUCCESS').every((s) => s.breached === false));
});

test('status normalisation treats unrecognised values as UNKNOWN', () => {
  assert.equal(normaliseStatus(' failed '), 'FAILED');
  assert.equal(normaliseStatus('weird'), 'UNKNOWN');
  assert.equal(normaliseStatus(null), null);
});

test('RUM slow page load uses the same threshold', () => {
  const [s] = evaluate({ type: 'client.load', route: '/health', loadTimeSec: 16 }, t);
  assert.equal(s.ruleCode, 'RUM_SLOW_LOAD');
  assert.equal(s.dedupeKey, 'RUM_SLOW_LOAD:/health');
  assert.equal(s.breached, true);
});
