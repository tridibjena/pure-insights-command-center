// In-process API latency telemetry (ring buffer) for the platform self-health panel.
const SIZE = 2000;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function createApiMetrics() {
  const samples = [];
  let total = 0;
  let errors = 0;

  function middleware(req, res, next) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const route = `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`;
      samples.push({ route, ms, status: res.statusCode });
      if (samples.length > SIZE) samples.shift();
      total += 1;
      if (res.statusCode >= 500) errors += 1;
    });
    next();
  }

  function summary() {
    const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
    const byRoute = {};
    for (const s of samples) (byRoute[s.route] ??= []).push(s.ms);
    const routes = Object.entries(byRoute)
      .map(([route, v]) => {
        v.sort((a, b) => a - b);
        return { route, count: v.length, p50Ms: percentile(v, 50), p95Ms: percentile(v, 95) };
      })
      .sort((a, b) => b.p95Ms - a.p95Ms)
      .slice(0, 8);
    return { totalRequests: total, serverErrors: errors, window: samples.length, p50Ms: percentile(ms, 50), p95Ms: percentile(ms, 95), p99Ms: percentile(ms, 99), slowestRoutes: routes };
  }

  return { middleware, summary };
}
