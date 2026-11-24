import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LABELS, toneOf } from '../format.js';

/* ---------- Badge ---------- */
export function Badge({ value, kind = 'status' }) {
  const label = LABELS[kind]?.[value] ?? value;
  return <span className={`badge badge-${toneOf(value)}`}>{label}</span>;
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, width = 560 }) {
  const ref = useRef(null);
  useEffect(() => {
    // 팝업이 겹쳐 있으면 맨 위 팝업만 Esc 로 닫힘
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return; // 한 번의 Esc 는 한 팝업만 처리
      const all = document.querySelectorAll('.modal-backdrop');
      if (all[all.length - 1] === ref.current) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div ref={ref} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
export function FormModal({ title, fields, initial = {}, onSubmit, onClose, submitLabel = '저장', children, footerLeft, width }) {
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
      width={width}
      footer={(
        <>
          {footerLeft && <div className="foot-left">{footerLeft}</div>}
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" form="form-modal" className="btn btn-primary" disabled={busy}>
            {busy ? '처리 중…' : submitLabel}
          </button>
        </>
      )}
    >
      <form id="form-modal" className="form-grid" onSubmit={submit}>
        {fields.map((f) => (
          React.createElement(
            f.type === 'checks' ? 'div' : 'label',
            { key: f.name, className: `field ${f.full || f.type === 'textarea' || f.type === 'checks' ? 'full' : ''}` },
            <span className="field-label">{f.label}{f.required && <em>*</em>}</span>,
            <Input field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />,
            f.hint && <small className="hint">{f.hint}</small>,
          )
        ))}
        {error && <div className="form-error full">{error}</div>}
      </form>
      {children}
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
  if (f.type === 'checks') {
    const selected = new Set((Array.isArray(value) ? value : []).map(String));
    const toggle = (v) => {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v); else next.add(v);
      onChange([...next]);
    };
    if (!f.options.length) return <span className="muted">선택할 항목이 없습니다.</span>;
    return (
      <div className="check-chips" role="group" aria-label={f.label}>
        {f.options.map((o) => {
          const v = String(o.value);
          return (
            <label key={v} className={`check-chip ${selected.has(v) ? 'on' : ''} ${o.muted ? 'muted-chip' : ''}`}>
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    );
  }
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
/**
 * columns: [{ key, label, render?(row), align?, width?, filter?: true | [{value,label}], filterValue?(row) }]
 *   filter: true → 텍스트 부분일치, 배열 → 선택형(정확히 일치). 지정하지 않으면 필터 없음.
 * 헤더 필터 동작:
 *   - colFilters + onColFilter 를 넘기면 서버 필터(부모가 API 호출)
 *   - 넘기지 않으면 현재 rows 를 화면에서 바로 거른다 (집계·팝업 등 전체가 로드된 표)
 */
export function DataTable({ columns, rows, loading, empty = '데이터가 없습니다.', onRowClick, colFilters, onColFilter, rowTitle }) {
  const [localFilters, setLocalFilters] = useState({});
  const serverMode = Boolean(onColFilter);
  const values = serverMode ? colFilters || {} : localFilters;
  const hasFilter = columns.some((c) => c.filter);
  const active = Object.values(values).some((v) => v !== '' && v !== undefined);

  const setValue = (key, v) => {
    if (serverMode) onColFilter(key, v);
    else setLocalFilters((f) => ({ ...f, [key]: v }));
  };
  const clearAll = () => {
    for (const c of columns) if (values[c.key]) setValue(c.key, '');
  };

  let shown = rows;
  if (!serverMode && active) {
    shown = rows.filter((r) => columns.every((c) => {
      const v = localFilters[c.key];
      if (!c.filter || v === '' || v === undefined) return true;
      const raw = c.filterValue ? c.filterValue(r) : r[c.key];
      if (Array.isArray(c.filter)) return String(raw) === String(v);
      const needle = String(v).trim().toLowerCase();
      const hay = String(raw ?? '').toLowerCase();
      return hay.includes(needle) || hay.includes(needle.replace(/[,원%\s]/g, ''));
    }));
  }

  const activeCount = columns.filter((c) => c.filter && values[c.key]).length;

  return (
    <>
    {activeCount > 0 && (
      <div className="filter-status">
        <span>헤더 필터 <b>{activeCount}</b>개 적용 중{!serverMode && ` · ${shown.length.toLocaleString()} / ${rows.length.toLocaleString()}건`}</span>
        <button type="button" className="btn btn-sm filter-clear" onClick={clearAll}>필터 모두 해제</button>
      </div>
    )}
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align }}>{c.label}</th>)}</tr>
          {hasFilter && (
            <tr className="filter-row">
              {columns.map((c) => (
                <th key={c.key}>
                  {c.filter && <ColumnFilter column={c} value={values[c.key] ?? ''} onChange={(v) => setValue(c.key, v)} />}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {loading && !shown.length ? (
            <tr><td colSpan={columns.length} className="table-empty">불러오는 중…</td></tr>
          ) : !shown.length ? (
            <tr><td colSpan={columns.length} className="table-empty">{active ? '필터 조건에 맞는 데이터가 없습니다.' : empty}</td></tr>
          ) : shown.map((r, i) => (
            <tr
              key={r.id ?? i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={onRowClick ? 'clickable' : ''}
              title={onRowClick ? rowTitle : undefined}
            >
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
    </>
  );
}

/** 헤더 필터 입력칸 (텍스트는 입력 후 0.3초 뒤 적용) */
function ColumnFilter({ column, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (Array.isArray(column.filter) || text === value) return undefined;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  if (Array.isArray(column.filter)) {
    return (
      <select className={`col-filter ${value ? 'on' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${column.label} 필터`}>
        <option value="">전체</option>
        {column.filter.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input
      className={`col-filter ${value ? 'on' : ''}`}
      value={text}
      placeholder="필터"
      aria-label={`${column.label} 필터`}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onChange(text); } }}
    />
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
