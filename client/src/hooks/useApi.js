import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

// Fetch JSON; on refetch the previous data is kept (rendered "stale") — no flash.
// `loading` is derived: true until the request for the current key has settled.
export function useApi(url, { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [settledKey, setSettledKey] = useState(null);
  const [tick, setTick] = useState(0);
  const key = enabled && url ? `${url}#${tick}` : null;

  useEffect(() => {
    if (!key) return undefined;
    const c = new AbortController();
    api(url, { signal: c.signal })
      .then((d) => {
        setData(d);
        setError(null);
        setSettledKey(key);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e);
        setSettledKey(key);
      });
    return () => c.abort();
  }, [key, url]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading: Boolean(key) && settledKey !== key, reload };
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!ms) return undefined;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
