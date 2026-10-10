// Real-user monitoring: how long did this dashboard page take to become usable?
// Each page calls useRouteLoaded(ready); the first time it turns true we send the
// elapsed time since navigation to /api/telemetry/rum, where > 15 s raises RUM_SLOW_LOAD.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api/client.js';

// performance.now() is measured from navigation start, so the first page's clock starts at 0.
let routeStartedAt = 0;
let firstRoute = true;

export function useRouteTimer() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (firstRoute) firstRoute = false; // initial load is measured from navigation start (t = 0)
    else routeStartedAt = performance.now();
  }, [pathname]);
}

export function useRouteLoaded(ready, route) {
  const sent = useRef(false);
  useEffect(() => {
    if (!ready || sent.current) return;
    sent.current = true;
    const loadTimeSec = Math.round((performance.now() - routeStartedAt) / 10) / 100;
    api('/api/telemetry/rum', { method: 'POST', body: { route, loadTimeSec } }).catch(() => {});
  }, [ready, route]);
}
