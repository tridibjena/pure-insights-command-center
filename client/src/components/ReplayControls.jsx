import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAlertStream } from '../realtime/AlertStream.jsx';

const SPEEDS = [
  { label: '2 s / snapshot', value: 2000 },
  { label: '5 s / snapshot', value: 5000 },
  { label: '10 s / snapshot', value: 10000 },
  { label: '30 s / snapshot', value: 30000 },
];

export function ReplayControls({ compact = false }) {
  const { can } = useAuth();
  const { replay, setReplay } = useAlertStream();
  const [busy, setBusy] = useState(false);
  const allowed = can('replay:control');

  async function call(path, body) {
    setBusy(true);
    try {
      setReplay(await api(`/api/telemetry/replay/${path}`, { method: 'POST', body }));
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.round((replay?.progress ?? 0) * 100);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`pill ${replay?.running ? 'live ok' : ''}`}>{replay?.running ? 'Streaming' : 'Paused'}</span>
        <span className="muted num" style={{ fontSize: 12 }}>
          snapshot {replay?.currentSnapshot ?? '—'} / {replay?.snapshotsTotal ?? 20} · {replay?.eventsSent ?? 0} events
        </span>
      </div>
      <div className="meter" aria-label="Replay progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {allowed && (
        <div className="row">
          {replay?.running ? (
            <button type="button" className="btn" disabled={busy} onClick={() => call('stop')}>Pause</button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={() => call('start')}>Start replay</button>
          )}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => call('reset', { clearAlerts: true })}>Reset</button>
          {!compact && (
            <select
              className="select"
              aria-label="Replay speed"
              value={replay?.intervalMs ?? 10000}
              onChange={(e) => call('config', { intervalMs: Number(e.target.value) })}
            >
              {SPEEDS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
