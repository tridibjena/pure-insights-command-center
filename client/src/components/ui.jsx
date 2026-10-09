import { useEffect } from 'react';

export function Panel({ title, sub, actions, children, flush = false, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, unit, foot, flag = false, children }) {
  return (
    <div className={`panel kpi ${flag ? 'flag' : ''}`}>
      <span className="label">{label}</span>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {children}
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function PageHead({ title, children, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Loading({ what = 'data' }) {
  return <div className="empty">Loading {what}…</div>;
}

export function ErrorState({ error }) {
  if (!error) return null;
  return <div className="error-box">{error.status ? `${error.status} · ` : ''}{error.message}</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function SortHeader({ label, field, sort, order, onSort, align }) {
  const active = sort === field;
  return (
    <th className={align === 'right' ? 'r' : undefined} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)}>
        {label}
        {active ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '12px 18px 4px' }}>
      <span className="muted num" style={{ fontSize: 12 }}>
        {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="row">
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="muted num" style={{ fontSize: 12 }}>{page} / {pages}</span>
        <button type="button" className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/** Chart tooltip: value leads, series name follows, keyed by a short line of the series colour. */
export function ChartTooltip({ active, payload, label, labelFormatter, rows }) {
  if (!active || !payload?.length) return null;
  const items = rows ? rows(payload) : payload.map((p) => ({ color: p.color, name: p.name, value: p.value }));
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {items.map((it) => (
        <div className="tt-row" key={it.name}>
          {it.color && <span className="tt-key" style={{ background: it.color }} />}
          <span className="tt-val">{it.value}</span>
          <span className="tt-name">{it.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Chart with an accessible table twin. */
export function ChartOrTable({ view, chart, table }) {
  return view === 'table' ? <div className="table-wrap">{table}</div> : chart;
}
