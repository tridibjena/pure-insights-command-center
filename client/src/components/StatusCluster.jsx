import { useAlertStream } from '../realtime/AlertStream.jsx';
import { SEVERITY_COLOR } from '../theme/chart.js';
import { SeverityIcon } from './Severity.jsx';

const CONN = {
  open: { color: SEVERITY_COLOR.OK, label: 'Live' },
  connecting: { color: SEVERITY_COLOR.WARNING, label: 'Connecting' },
  reconnecting: { color: SEVERITY_COLOR.HIGH, label: 'Reconnecting' },
  offline: { color: '#7c7c82', label: 'Offline' },
};

/** Live alert counts by severity + real-time channel state (shown in every page header). */
export function StatusCluster() {
  const { counts, connection } = useAlertStream();
  const conn = CONN[connection];
  return (
    <>
      <span className="chip" aria-live="polite" title="Live alerts by severity">
        {['CRITICAL', 'HIGH', 'WARNING'].map((s) => (
          <span key={s} className="row num" style={{ gap: 5 }} title={`${counts[s]} live ${s.toLowerCase()} alerts`}>
            <SeverityIcon severity={s} size={11} />
            {counts[s]}
          </span>
        ))}
      </span>
      <span className="chip conn" title="Real-time channel">
        <span className="dot" style={{ background: conn.color }} />
        WebSocket · {conn.label}
      </span>
    </>
  );
}
