import { describe, expect, it } from 'vitest';
import { alertsReducer, backoffDelay, initialAlertsState, liveCounts, sortAlerts } from '../realtime/alertsReducer.js';

const alert = (id, patch = {}) => ({
  alert_id: id,
  severity: 'WARNING',
  status: 'OPEN',
  updated_at: '2026-01-01T00:00:00Z',
  ...patch,
});

describe('alertsReducer', () => {
  it('replaces the list on initial sync', () => {
    const s = alertsReducer(initialAlertsState, { type: 'replace', alerts: [alert(1), alert(2)], serverTime: 't1' });
    expect(Object.keys(s.byId)).toEqual(['1', '2']);
    expect(s.lastSync).toBe('t1');
  });

  it('applies escalations and ignores stale (out-of-order) events', () => {
    let s = alertsReducer(initialAlertsState, { type: 'upsert', alert: alert(1) });
    s = alertsReducer(s, { type: 'upsert', alert: alert(1, { severity: 'CRITICAL', updated_at: '2026-01-01T00:00:05Z' }) });
    expect(s.byId[1].severity).toBe('CRITICAL');
    const stale = alertsReducer(s, { type: 'upsert', alert: alert(1, { severity: 'HIGH', updated_at: '2026-01-01T00:00:01Z' }) });
    expect(stale).toBe(s);
  });

  it('merges a reconnect resync without dropping newer local state', () => {
    let s = alertsReducer(initialAlertsState, { type: 'upsert', alert: alert(1, { status: 'RESOLVED', updated_at: '2026-01-01T00:00:09Z' }) });
    s = alertsReducer(s, { type: 'merge', alerts: [alert(1), alert(2)], serverTime: 't2' });
    expect(s.byId[1].status).toBe('RESOLVED');
    expect(s.byId[2]).toBeDefined();
  });

  it('clears on replay reset', () => {
    const s = alertsReducer({ byId: { 1: alert(1) }, lastSync: 't' }, { type: 'clear' });
    expect(s.byId).toEqual({});
  });

  it('counts only live alerts by severity', () => {
    const s = { byId: { 1: alert(1, { severity: 'CRITICAL' }), 2: alert(2), 3: alert(3, { status: 'RESOLVED' }), 4: alert(4, { status: 'ACKNOWLEDGED', severity: 'HIGH' }) } };
    expect(liveCounts(s)).toEqual({ WARNING: 1, HIGH: 1, CRITICAL: 1, total: 3 });
  });

  it('sorts live before resolved, then by severity', () => {
    const sorted = sortAlerts([alert(1, { status: 'RESOLVED', severity: 'CRITICAL' }), alert(2), alert(3, { severity: 'CRITICAL' })]);
    expect(sorted.map((a) => a.alert_id)).toEqual([3, 2, 1]);
  });
});

describe('reconnect backoff', () => {
  it('grows exponentially and is capped', () => {
    const max = (a) => backoffDelay(a, { random: () => 1 });
    expect(max(0)).toBe(1000);
    expect(max(3)).toBe(8000);
    expect(max(10)).toBe(30000);
    expect(backoffDelay(2, { random: () => 0 })).toBe(2000);
  });
});
