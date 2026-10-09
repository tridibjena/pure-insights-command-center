// Task 2 alert rules — pure functions, no I/O.
//
//   LATENCY_SLO_BREACH  avg load latency strictly > 15 s  (WARNING ≤ 30 < HIGH ≤ 45 < CRITICAL)
//   REFRESH_FAILURE     refresh status FAILED (CRITICAL) or TIMED_OUT (HIGH)
//   TELEMETRY_GAP       refresh status UNKNOWN (WARNING) — no outcome reported, not a failure
//   RUM_SLOW_LOAD       the React dashboard itself took > 15 s to load a route
//
// Each evaluation returns *signals*: { breached: true } opens/updates an incident,
// { breached: false } clears it. The 15 s value is the only threshold from the brief;
// the 30/45 s tiers are configurable severity bands. Readings that are not valid
// measurements (≤ 0, non-finite, above the sanity ceiling) never raise alerts.

export const SEVERITY_RANK = Object.freeze({ WARNING: 1, HIGH: 2, CRITICAL: 3 });
export const RULES = Object.freeze(['LATENCY_SLO_BREACH', 'REFRESH_FAILURE', 'TELEMETRY_GAP', 'RUM_SLOW_LOAD']);

const FAILURE_SEVERITY = { FAILED: 'CRITICAL', TIMED_OUT: 'HIGH' };
const KNOWN_STATUSES = new Set(['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN']);

export function latencyBand(seconds, t) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'INVALID';
  if (seconds <= 0 || seconds > t.latencyInvalidAboveSec) return 'INVALID';
  if (seconds <= t.latencyAlertSec) return 'OK';
  if (seconds <= t.latencyHighAboveSec) return 'WARNING';
  if (seconds <= t.latencyCriticalAboveSec) return 'HIGH';
  return 'CRITICAL';
}

export function normaliseStatus(status) {
  if (status == null) return null;
  const s = String(status).trim().toUpperCase();
  return KNOWN_STATUSES.has(s) ? s : 'UNKNOWN';
}

const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

function latencySignal(reportId, seconds, t) {
  const band = latencyBand(seconds, t);
  if (band === 'INVALID') return null;
  const base = { ruleCode: 'LATENCY_SLO_BREACH', dedupeKey: `LATENCY_SLO_BREACH:${reportId}`, reportId, metricValue: seconds, threshold: t.latencyAlertSec };
  if (band === 'OK') return { ...base, breached: false, resolution: `Load latency recovered to ${fmt(seconds)} s` };
  return {
    ...base,
    breached: true,
    severity: band,
    title: `${reportId}: dashboard load ${fmt(seconds)} s`,
    message: `Average load latency ${fmt(seconds)} s exceeds the ${t.latencyAlertSec} s threshold (${band}).`,
  };
}

function refreshSignals(reportId, status) {
  const failureKey = { ruleCode: 'REFRESH_FAILURE', dedupeKey: `REFRESH_FAILURE:${reportId}`, reportId, metricValue: null, threshold: null };
  const gapKey = { ruleCode: 'TELEMETRY_GAP', dedupeKey: `TELEMETRY_GAP:${reportId}`, reportId, metricValue: null, threshold: null };
  if (status === 'SUCCESS') {
    return [
      { ...failureKey, breached: false, resolution: 'Automated refresh succeeded' },
      { ...gapKey, breached: false, resolution: 'Refresh status reported again' },
    ];
  }
  if (status in FAILURE_SEVERITY) {
    const severity = FAILURE_SEVERITY[status];
    return [
      {
        ...failureKey,
        breached: true,
        severity,
        title: `${reportId}: automated refresh ${status === 'FAILED' ? 'failed' : 'timed out'}`,
        message: `The scheduled data refresh ended with status ${status}; the report may be serving stale data.`,
      },
      { ...gapKey, breached: false, resolution: 'Refresh status reported again' },
    ];
  }
  if (status === 'UNKNOWN') {
    // No outcome reported: open a telemetry-gap warning but leave any failure incident as-is.
    return [
      {
        ...gapKey,
        breached: true,
        severity: 'WARNING',
        title: `${reportId}: refresh status not reported`,
        message: 'The refresh pipeline reported no outcome (UNKNOWN). Treated as a monitoring gap, not a failure.',
      },
    ];
  }
  return [];
}

function rumSignal(route, seconds, t) {
  const band = latencyBand(seconds, t);
  if (band === 'INVALID') return null;
  const base = { ruleCode: 'RUM_SLOW_LOAD', dedupeKey: `RUM_SLOW_LOAD:${route}`, reportId: null, metricValue: seconds, threshold: t.latencyAlertSec };
  if (band === 'OK') return { ...base, breached: false, resolution: `Route ${route} loaded in ${fmt(seconds)} s` };
  return {
    ...base,
    breached: true,
    severity: band,
    title: `Command Center page ${route} took ${fmt(seconds)} s`,
    message: `Real-user monitoring measured a ${fmt(seconds)} s load for ${route}, above the ${t.latencyAlertSec} s threshold.`,
  };
}

export function evaluate(event, thresholds) {
  if (event.type === 'client.load') {
    const s = rumSignal(event.route, event.loadTimeSec, thresholds);
    return s ? [s] : [];
  }
  const signals = [];
  if (event.avgLoadTimeSec != null) {
    const s = latencySignal(event.reportId, event.avgLoadTimeSec, thresholds);
    if (s) signals.push(s);
  }
  const status = normaliseStatus(event.refreshStatus);
  if (status) signals.push(...refreshSignals(event.reportId, status));
  return signals;
}
