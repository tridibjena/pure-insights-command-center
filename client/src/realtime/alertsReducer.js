// Pure state for the live alert list, fed by REST (initial load / resync) and WebSocket events.
export const SEVERITY_RANK = { WARNING: 1, HIGH: 2, CRITICAL: 3 };

export const initialAlertsState = { byId: {}, lastSync: null };

const newer = (a, b) => !b || new Date(a.updated_at) >= new Date(b.updated_at);

export function alertsReducer(state, action) {
  switch (action.type) {
    case 'replace': {
      const byId = {};
      for (const a of action.alerts) byId[a.alert_id] = a;
      return { byId, lastSync: action.serverTime ?? state.lastSync };
    }
    case 'merge': {
      const byId = { ...state.byId };
      for (const a of action.alerts) if (newer(a, byId[a.alert_id])) byId[a.alert_id] = a;
      return { byId, lastSync: action.serverTime ?? state.lastSync };
    }
    case 'upsert': {
      const prev = state.byId[action.alert.alert_id];
      if (!newer(action.alert, prev)) return state;
      return { ...state, byId: { ...state.byId, [action.alert.alert_id]: action.alert } };
    }
    case 'clear':
      return { ...initialAlertsState, lastSync: state.lastSync };
    default:
      return state;
  }
}

export function sortAlerts(alerts) {
  return [...alerts].sort(
    (a, b) =>
      (a.status === 'RESOLVED') - (b.status === 'RESOLVED') ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      new Date(b.updated_at) - new Date(a.updated_at),
  );
}

export function liveCounts(state) {
  const counts = { WARNING: 0, HIGH: 0, CRITICAL: 0, total: 0 };
  for (const a of Object.values(state.byId)) {
    if (a.status === 'RESOLVED') continue;
    counts[a.severity] += 1;
    counts.total += 1;
  }
  return counts;
}

// Reconnect delay: exponential with full jitter, capped.
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 30_000, random = Math.random } = {}) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
