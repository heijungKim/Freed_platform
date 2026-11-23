import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LABELS, toneOf } from '../format.js';

/* ---------- Badge ---------- */
export function Badge({ value, kind = 'status' }) {
  const label = LABELS[kind]?.[value] ?? value;
  return <span className={`badge badge-${toneOf(value)}`}>{label}</span>;
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, width = 560 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Form ---------- */
/**
 * fields: [{ name, label, type: text|number|date|email|select|textarea|password, options:[{value,label}], required, placeholder, full, hint }]
 */
export function FormModal({ title, fields, initial = {}, onSubmit, onClose, submitLabel = '저장' }) {
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of fields) v[f.name] = initial[f.name] ?? f.default ?? '';
    return v;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" form="form-modal" className="btn btn-primary" disabled={busy}>
            {busy ? '처리 중…' : submitLabel}
          </button>
        </>
      )}
    >
      <form id="form-modal" className="form-grid" onSubmit={submit}>
        {fields.map((f) => (
          <label key={f.name} className={`field ${f.full || f.type === 'textarea' ? 'full' : ''}`}>
            <span className="field-label">{f.label}{f.required && <em>*</em>}</span>
            <Input field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
            {f.hint && <small className="hint">{f.hint}</small>}
          </label>
        ))}
        {error && <div className="form-error full">{error}</div>}
      </form>
    </Modal>
  );
}

function Input({ field: f, value, onChange }) {
  const common = { value: value ?? '', required: f.required, placeholder: f.placeholder, disabled: f.disabled };
  if (f.type === 'select') {
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)}>
        {!f.required && <option value="">선택 안 함</option>}
        {f.required && !value && <option value="">선택하세요</option>}
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.type === 'textarea') return <textarea rows={3} {...common} onChange={(e) => onChange(e.target.value)} />;
  return (
    <input
      type={f.type || 'text'}
      step={f.step}
      min={f.min}
      autoComplete={f.type === 'password' ? 'new-password' : 'off'}
      {...common}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ---------- Confirm ---------- */
const ConfirmCtx = createContext(null);
const ToastCtx = createContext(null);

export function FeedbackProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);

  const confirm = useCallback((message, { danger = false, okLabel = '확인' } = {}) => new Promise((resolve) => {
    setConfirmState({ message, danger, okLabel, resolve });
  }), []);

  const toast = useCallback((message, tone = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const close = (v) => { confirmState.resolve(v); setConfirmState(null); };

  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={toast}>
        {children}
        {confirmState && (
          <Modal
            title="확인"
            width={420}
            onClose={() => close(false)}
            footer={(
              <>
                <button className="btn" onClick={() => close(false)}>취소</button>
                <button className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
                  {confirmState.okLabel}
                </button>
              </>
            )}
          >
            <p className="confirm-msg">{confirmState.message}</p>
          </Modal>
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>)}
        </div>
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

/* ---------- Table ---------- */
/** columns: [{ key, label, render?(row), align?, width? }] */
export function DataTable({ columns, rows, loading, empty = '데이터가 없습니다.', onRowClick }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading && !rows.length ? (
            <tr><td colSpan={columns.length} className="table-empty">불러오는 중…</td></tr>
          ) : !rows.length ? (
            <tr><td colSpan={columns.length} className="table-empty">{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }} data-label={c.label}>
                  {c.render ? c.render(r) : r[c.key] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, size, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <div className="pagination"><span className="muted">총 {total.toLocaleString()}건</span></div>;
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = [];
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  return (
    <div className="pagination">
      <span className="muted">총 {total.toLocaleString()}건</span>
      <div className="pages">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(1)}>«</button>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
        {nums.map((n) => (
          <button key={n} className={`btn btn-sm ${n === page ? 'btn-primary' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>›</button>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(pages)}>»</button>
      </div>
    </div>
  );
}

export function PageHeader({ title, desc, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {desc && <p className="muted">{desc}</p>}
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}

export function StatCard({ label, value, sub, tone }) {
  return (
    <div className={`stat-card ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Filter bar: controlled inputs */
export function FilterBar({ children, onSubmit, onReset }) {
  return (
    <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      {children}
      <div className="filter-actions">
        {onReset && <button type="button" className="btn" onClick={onReset}>초기화</button>}
        <button type="submit" className="btn btn-primary">검색</button>
      </div>
    </form>
  );
}
