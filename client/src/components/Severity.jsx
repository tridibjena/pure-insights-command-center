import { SEVERITY_COLOR } from '../theme/chart.js';

// Shape + text + colour: severity is never conveyed by colour alone.
export function SeverityIcon({ severity, size = 12 }) {
  const c = SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.INVALID;
  const s = size;
  switch (severity) {
    case 'OK':
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5.5" fill={c} />
          <path d="M3.4 6.2l1.7 1.7 3.5-3.6" fill="none" stroke="#0b0d10" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'WARNING':
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 .8l5.4 10H.6z" fill={c} />
          <path d="M6 4.3v3" stroke="#0b0d10" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="6" cy="9" r=".8" fill="#0b0d10" />
        </svg>
      );
    case 'HIGH':
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 .5L11.5 6 6 11.5.5 6z" fill={c} />
          <path d="M6 3.4v3.2" stroke="#0b0d10" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="6" cy="8.4" r=".8" fill="#0b0d10" />
        </svg>
      );
    case 'CRITICAL':
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.6.5h4.8L11.5 3.6v4.8L8.4 11.5H3.6L.5 8.4V3.6z" fill={c} />
          <path d="M4.2 4.2l3.6 3.6M7.8 4.2L4.2 7.8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" stroke={c} strokeWidth="1.5" />
        </svg>
      );
  }
}

const LABEL = { OK: 'OK', WARNING: 'Warning', HIGH: 'High', CRITICAL: 'Critical', INVALID: 'Invalid' };

export function SeverityBadge({ severity, label }) {
  return (
    <span className={`sev sev-${severity}`}>
      <SeverityIcon severity={severity} />
      {label ?? LABEL[severity] ?? severity}
    </span>
  );
}

const STATUS_SEVERITY = { SUCCESS: 'OK', FAILED: 'CRITICAL', TIMED_OUT: 'HIGH', UNKNOWN: 'WARNING' };
const STATUS_LABEL = { SUCCESS: 'Success', FAILED: 'Failed', TIMED_OUT: 'Timed out', UNKNOWN: 'Unknown' };

export function RefreshStatus({ status }) {
  return <SeverityBadge severity={STATUS_SEVERITY[status] ?? 'INVALID'} label={STATUS_LABEL[status] ?? status} />;
}
export const refreshSeverity = (status) => STATUS_SEVERITY[status] ?? 'INVALID';
