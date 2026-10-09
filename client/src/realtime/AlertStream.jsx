// Live connection to /ws: keeps the alert list current, raises toasts, exposes replay/
// telemetry state, and resyncs over REST after every (re)connect so nothing is missed.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, qs } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { alertsReducer, backoffDelay, initialAlertsState, liveCounts } from './alertsReducer.js';

const AlertStreamContext = createContext(null);
const MAX_TOASTS = 3;
const TOAST_MS = 7000;

export function AlertStreamProvider({ children }) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(alertsReducer, initialAlertsState);
  const [connection, setConnection] = useState('offline');
  const [replay, setReplay] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [overflow, setOverflow] = useState(0);
  const [muted, setMuted] = useState(false);
  const listeners = useRef(new Set());
  const lastSync = useRef(null);
  const mutedRef = useRef(muted);
  const toastsRef = useRef([]);
  useEffect(() => {
    lastSync.current = state.lastSync;
    mutedRef.current = muted;
  });

  const setToastList = useCallback((next) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id) => setToastList(toastsRef.current.filter((t) => t.id !== id)),
    [setToastList],
  );

  // At most MAX_TOASTS on screen; the rest are summarised as "+N more" so a burst of
  // alerts during a replay never buries the page.
  const pushToast = useCallback(
    (toast) => {
      if (mutedRef.current) return;
      if (toastsRef.current.length >= MAX_TOASTS) {
        setOverflow((n) => n + 1);
        return;
      }
      setToastList([...toastsRef.current, toast]);
      setTimeout(() => dismiss(toast.id), TOAST_MS);
    },
    [setToastList, dismiss],
  );
  const clearOverflow = useCallback(() => setOverflow(0), []);

  const resync = useCallback(async (full) => {
    const since = full ? undefined : lastSync.current;
    const res = await api(`/api/alerts${qs({ status: since ? 'all' : 'live', since, limit: 500 })}`);
    dispatch({ type: since ? 'merge' : 'replace', alerts: res.alerts, serverTime: res.serverTime });
  }, []);

  useEffect(() => {
    if (!user?.permissions.includes('alerts:read')) return undefined;
    let ws;
    let attempt = 0;
    let timer;
    let closedByUs = false;
    let first = true;

    function handle(msg) {
      const { type, data } = msg;
      if (type.startsWith('alert.')) {
        dispatch({ type: 'upsert', alert: data });
        if (type === 'alert.raised' || type === 'alert.escalated') {
          pushToast({ id: msg.id, kind: type, severity: data.severity, title: data.title, message: data.message, alertId: data.alert_id });
        } else if (type === 'alert.resolved' && data.resolved_by !== 'system:auto-recovery') {
          pushToast({ id: msg.id, kind: type, severity: 'OK', title: `Resolved · ${data.title}`, message: data.resolution, alertId: data.alert_id });
        }
      } else if (type === 'alerts.cleared') {
        dispatch({ type: 'clear' });
        setSnapshots([]);
      } else if (type === 'replay.status') {
        setReplay(data);
      } else if (type === 'telemetry.snapshot') {
        setSnapshots((s) => [...s.slice(-19), data]);
      }
      for (const fn of listeners.current) fn(msg);
    }

    function connect() {
      setConnection(first ? 'connecting' : 'reconnecting');
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.onopen = () => {
        attempt = 0;
        setConnection('open');
        resync(first).catch(() => {});
        first = false;
      };
      ws.onmessage = (e) => {
        try {
          handle(JSON.parse(e.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closedByUs) return;
        setConnection('reconnecting');
        timer = setTimeout(connect, backoffDelay(attempt++));
      };
    }

    connect();
    if (user.permissions.includes('health:read')) api('/api/telemetry/replay').then(setReplay).catch(() => {});
    return () => {
      closedByUs = true;
      clearTimeout(timer);
      ws?.close();
      setConnection('offline');
    };
  }, [user, resync, pushToast]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      counts: liveCounts(state),
      connection,
      replay,
      setReplay,
      snapshots,
      toasts,
      overflow,
      dismiss,
      clearOverflow,
      muted,
      setMuted,
      subscribe,
      resync,
    }),
    [state, connection, replay, snapshots, toasts, overflow, dismiss, clearOverflow, muted, subscribe, resync],
  );
  return <AlertStreamContext.Provider value={value}>{children}</AlertStreamContext.Provider>;
}

export function useAlertStream() {
  const ctx = useContext(AlertStreamContext);
  if (!ctx) throw new Error('useAlertStream must be used inside <AlertStreamProvider>');
  return ctx;
}

/** Re-run `fn` whenever a WebSocket message of one of `types` arrives. */
export function useStreamEvent(types, fn) {
  const { subscribe } = useAlertStream();
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const key = types.join('|');
  useEffect(() => subscribe((msg) => key.split('|').includes(msg.type) && fnRef.current(msg)), [subscribe, key]);
}
