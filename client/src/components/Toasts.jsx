import { useNavigate } from 'react-router-dom';
import { useAlertStream } from '../realtime/AlertStream.jsx';
import { SeverityIcon } from './Severity.jsx';

export function Toasts() {
  const { toasts, overflow, dismiss, clearOverflow } = useAlertStream();
  const navigate = useNavigate();
  if (!toasts.length && !overflow) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.severity}`}>
          <span className="t-icon"><SeverityIcon severity={t.severity} size={14} /></span>
          <div className="t-title">
            {t.kind === 'alert.escalated' ? 'Escalated · ' : ''}
            {t.title}
          </div>
          <button type="button" className="t-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          <div className="t-msg">{t.message}</div>
        </div>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          className="toast more"
          onClick={() => {
            clearOverflow();
            navigate('/alerts');
          }}
        >
          +{overflow} more alert notification{overflow === 1 ? '' : 's'} — open Alerts
        </button>
      )}
    </div>
  );
}
