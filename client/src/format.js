const nf = new Intl.NumberFormat('en-US');
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtInt = (v) => (v == null ? '—' : nf.format(Math.round(v)));
export const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
export const fmtSec = (v, d = 1) => (v == null ? '—' : `${Number(v).toFixed(d)} s`);
export const fmtPct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
export const fmtUsd = (v, d = 2) =>
  v == null ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export function fmtUsdCompact(v) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
export function fmtCompact(v) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return nf.format(v);
}
// 'YYYY-MM-DD' → 'Aug 2026' (string parsing, no timezone shifts)
export function fmtMonth(d) {
  if (!d) return '—';
  const [y, m] = d.slice(0, 7).split('-');
  return `${months[Number(m) - 1]} ${y}`;
}
export const fmtMonthShort = (d) => (d ? `${months[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}` : '');
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtAgo(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
