import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useList, useOptions } from '../hooks.js';
import { DataTable, FormModal, Modal, PageHeader, Pagination, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { daysAgo, num, today, won } from '../format.js';

/** 이번 달 1일 */
const monthStart = () => `${today().slice(0, 8)}01`;

const PRESETS = [
  { label: '오늘', from: () => today() },
  { label: '이번 달', from: monthStart },
  { label: '30일', from: () => daysAgo(29) },
  { label: '90일', from: () => daysAgo(89) },
];

export default function Transactions() {
  const [range, setRange] = useState({ from: monthStart(), to: today(), pg_id: '' });
  const [view, setView] = useState('corp'); // corp | list
  const [corps] = useOptions('/corporations/options');
  const [pgs] = useOptions('/pgs/options');
  const [byCorp, setByCorp] = useState(null);
  const [error, setError] = useState('');
  const [entering, setEntering] = useState(false);
  const [detailCorp, setDetailCorp] = useState(null);
  const [version, setVersion] = useState(0); // 저장 후 새로고침용
  const toast = useToast();

  const loadSummary = useCallback(async () => {
    try {
      setByCorp(await api.get('/records/by-corporation', range));
      setError('');
    } catch (e) { setError(e.message); }
  }, [range]);
  useEffect(() => { loadSummary(); }, [loadSummary, version]);

  const refresh = () => setVersion((v) => v + 1);
  const s = byCorp?.summary || {};
  const rows = byCorp?.rows || [];
  const withRecords = rows.filter((r) => r.entries > 0).length;

  const exportCsv = async () => {
    try { await api.download('/records/export.csv', range, 'tx_records.csv'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader
        title="거래내역"
        desc="법인별 거래건수와 총 금액을 직접 입력하고 기간별로 확인합니다."
        actions={(
          <>
            <button className="btn" onClick={exportCsv}>CSV 다운로드</button>
            <button className="btn btn-primary" onClick={() => setEntering(true)}>+ 거래 입력</button>
          </>
        )}
      />

      <div className="filter-bar">
        <div className="range-picker">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-sm ${range.from === p.from() && range.to === today() ? 'btn-primary' : ''}`}
              onClick={() => setRange((r) => ({ ...r, from: p.from(), to: today() }))}
            >{p.label}</button>
          ))}
          <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <span>~</span>
          <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <select value={range.pg_id} onChange={(e) => setRange((r) => ({ ...r, pg_id: e.target.value }))}>
          <option value="">전체 PG</option>
          {pgs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label="총 거래건수" value={`${num(s.tx_count)}건`} tone="violet" />
        <StatCard label="총 금액" value={won(s.total_amount)} tone="blue" />
        <StatCard label="건당 평균 금액" value={won(s.tx_count ? Math.round(s.total_amount / s.tx_count) : 0)} />
        <StatCard label="입력된 법인" value={`${num(withRecords)} / ${num(rows.length)}`} sub={`입력 ${num(s.entries)}회`} tone="green" />
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="card">
        <div className="card-head">
          <h2>{view === 'corp' ? '법인별 거래 합계' : '입력 내역'}</h2>
          <div className="seg">
            <button className={view === 'corp' ? 'on' : ''} onClick={() => setView('corp')}>법인별 합계</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>입력 내역</button>
          </div>
        </div>
        {view === 'corp' ? (
          <CorpSummary rows={rows} summary={s} loading={!byCorp} onOpen={setDetailCorp} />
        ) : (
          <RecordList range={range} pgs={pgs} corps={corps} version={version} onChanged={refresh} />
        )}
      </div>

      {entering && (
        <EntryModal
          corps={corps}
          pgs={pgs}
          onClose={() => setEntering(false)}
          onSaved={(n) => { toast(`${n}건 입력되었습니다.`); setEntering(false); refresh(); }}
        />
      )}
      {detailCorp && (
        <CorpDetailModal
          corp={detailCorp}
          range={range}
          corps={corps}
          pgs={pgs}
          version={version}
          onClose={() => setDetailCorp(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/* ---------- 법인별 합계 ---------- */
function CorpSummary({ rows, summary, loading, onOpen }) {
  const total = summary.total_amount || 0;
  return (
    <>
      <DataTable
        loading={loading}
        rows={rows.map((r) => ({ ...r, id: r.corporation_id }))}
        onRowClick={onOpen}
        rowTitle="클릭하여 입력 내역 보기"
        empty="법인이 없습니다."
        columns={[
          { key: 'corporation_name', label: '법인', filter: true, render: (r) => <strong className="link-text">{r.corporation_name}</strong> },
          { key: 'tx_count', label: '거래건수', align: 'right', filter: true, render: (r) => `${num(r.tx_count)}건` },
          { key: 'total_amount', label: '총 금액', align: 'right', filter: true, render: (r) => <strong>{won(r.total_amount)}</strong> },
          { key: 'share', label: '금액 비중', width: 160, render: (r) => <Share value={r.total_amount} total={total} /> },
          { key: 'avg', label: '건당 평균', align: 'right', render: (r) => (r.tx_count ? won(Math.round(r.total_amount / r.tx_count)) : '-') },
          { key: 'entries', label: '입력 횟수', align: 'right', filter: true, render: (r) => (r.entries ? `${num(r.entries)}회` : <span className="muted">미입력</span>) },
          { key: 'last_date', label: '최근 거래일', filter: true, render: (r) => r.last_date || '-' },
        ]}
      />
      <div className="total-row">
        <span>합계</span>
        <span><b>{num(summary.tx_count)}</b>건</span>
        <span><b>{won(summary.total_amount)}</b></span>
      </div>
    </>
  );
}

function Share({ value, total }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="share">
      <div className="share-bar"><span style={{ width: `${pct}%` }} /></div>
      <small>{pct.toFixed(1)}%</small>
    </div>
  );
}

/* ---------- 입력 내역 (전체) ---------- */
function RecordList({ range, pgs, corps, version, onChanged, corporationId, compact }) {
  const list = useList('/records', { ...range, corporation_id: corporationId || '' }, compact ? 500 : 30);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();

  // 기간/PG 변경, 저장 후 다시 조회
  useEffect(() => {
    list.applyFilter('from', range.from);
    list.applyFilter('to', range.to);
    list.applyFilter('pg_id', range.pg_id);
  }, [range.from, range.to, range.pg_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (version) list.reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (r) => {
    if (!(await confirm(`${r.record_date} ${r.corporation_name} 입력(${num(r.tx_count)}건 / ${won(r.total_amount)})을 삭제할까요?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/records/${r.id}`);
      toast('삭제되었습니다.');
      onChanged();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'record_date', label: '거래일', filter: true },
    ...(corporationId ? [] : [{ key: 'corporation_name', label: '법인', filter: true }]),
    { key: 'pg_name', label: 'PG', filter: true, render: (r) => r.pg_name || '-' },
    { key: 'tx_count', label: '거래건수', align: 'right', filter: true, render: (r) => `${num(r.tx_count)}건` },
    { key: 'total_amount', label: '총 금액', align: 'right', filter: true, render: (r) => <strong>{won(r.total_amount)}</strong> },
    { key: 'memo', label: '메모', filter: true, render: (r) => r.memo || '-' },
    ...(compact ? [] : [{ key: 'created_by_name', label: '입력자', filter: true, render: (r) => r.created_by_name || '-' }]),
    { key: 'actions', label: '', align: 'right', render: (r) => (
      <div className="row-actions">
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>수정</button>
        <button className="btn btn-sm btn-ghost-danger" onClick={(e) => { e.stopPropagation(); remove(r); }}>삭제</button>
      </div>
    ) },
  ];

  const sum = list.data.summary || {};
  return (
    <>
      <DataTable
        columns={columns}
        rows={list.data.rows}
        loading={list.loading}
        colFilters={list.colFilters}
        onColFilter={list.onColFilter}
        empty="해당 기간에 입력된 거래내역이 없습니다."
      />
      <div className="total-row">
        <span>조회 합계 ({num(list.data.total)}회 입력)</span>
        <span><b>{num(sum.tx_count)}</b>건</span>
        <span><b>{won(sum.total_amount)}</b></span>
      </div>
      {!compact && <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />}
      {editing && (
        <FormModal
          title="거래내역 수정"
          initial={{ ...editing, pg_id: editing.pg_id ?? '' }}
          fields={[
            { name: 'record_date', label: '거래일', type: 'date', required: true },
            { name: 'corporation_id', label: '법인', type: 'select', required: true, options: corps.map((c) => ({ value: c.id, label: c.name })) },
            { name: 'pg_id', label: 'PG', type: 'select', options: pgs.map((p) => ({ value: p.id, label: p.name })) },
            { name: 'tx_count', label: '거래건수', type: 'number', min: '0', required: true },
            { name: 'total_amount', label: '총 금액 (원)', type: 'number', min: '0', required: true },
            { name: 'memo', label: '메모', type: 'textarea' },
          ]}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await api.put(`/records/${editing.id}`, v);
            toast('수정되었습니다.');
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

/* ---------- 법인 상세 (입력 내역) ---------- */
function CorpDetailModal({ corp, range, corps, pgs, version, onClose, onChanged }) {
  return (
    <Modal title={`${corp.corporation_name} · 거래 입력 내역`} width={900} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>닫기</button>}
    >
      <div className="mini-stats" style={{ marginBottom: 12 }}>
        <span>기간 <b>{range.from} ~ {range.to}</b></span>
      </div>
      <div className="modal-section" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
        <RecordList range={range} pgs={pgs} corps={corps} version={version} onChanged={onChanged} corporationId={corp.corporation_id} compact />
      </div>
    </Modal>
  );
}

/* ---------- 거래 입력 (여러 법인 한 번에) ---------- */
const emptyLine = () => ({ key: Math.random(), corporation_id: '', tx_count: '', total_amount: '', memo: '' });
const onlyDigits = (v) => v.replace(/[^\d]/g, '');
const withComma = (v) => (v === '' ? '' : Number(v).toLocaleString('ko-KR'));

function EntryModal({ corps, pgs, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [pgId, setPgId] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeCorps = corps.filter((c) => c.status === 'ACTIVE');

  const update = (key, field, value) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const fillAll = () => {
    const used = new Set(lines.map((l) => String(l.corporation_id)));
    const add = activeCorps.filter((c) => !used.has(String(c.id))).map((c) => ({ ...emptyLine(), corporation_id: String(c.id) }));
    setLines((ls) => [...ls.filter((l) => l.corporation_id || l.tx_count || l.total_amount), ...add]);
  };

  const filled = lines.filter((l) => l.corporation_id || l.tx_count !== '' || l.total_amount !== '');
  const sumCount = filled.reduce((s, l) => s + Number(l.tx_count || 0), 0);
  const sumAmount = filled.reduce((s, l) => s + Number(l.total_amount || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!filled.length) return setError('입력할 법인을 1개 이상 추가해 주세요.');
    for (const [i, l] of filled.entries()) {
      if (!l.corporation_id) return setError(`${i + 1}번째 줄: 법인을 선택해 주세요.`);
      if (l.tx_count === '' || l.total_amount === '') return setError(`${i + 1}번째 줄: 거래건수와 총 금액을 입력해 주세요.`);
    }
    const ids = filled.map((l) => l.corporation_id);
    if (new Set(ids).size !== ids.length) return setError('같은 법인이 두 번 입력되었습니다.');
    setBusy(true);
    try {
      const r = await api.post('/records', {
        record_date: date,
        pg_id: pgId || null,
        items: filled.map(({ corporation_id, tx_count, total_amount, memo }) => ({ corporation_id, tx_count, total_amount, memo })),
      });
      onSaved(r.count);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title="거래 입력"
      width={820}
      onClose={onClose}
      footer={(
        <>
          <div className="foot-left entry-sum">합계 <b>{num(sumCount)}</b>건 · <b>{won(sumAmount)}</b></div>
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" form="entry-form" className="btn btn-primary" disabled={busy}>{busy ? '저장 중…' : `${filled.length}건 저장`}</button>
        </>
      )}
    >
      <form id="entry-form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">거래일<em>*</em></span>
            <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">PG</span>
            <select value={pgId} onChange={(e) => setPgId(e.target.value)}>
              <option value="">선택 안 함</option>
              {pgs.filter((p) => p.status === 'ACTIVE').map((p) => <option key={p.id} value={p.id}>{p.name} ({p.fee_rate}%)</option>)}
            </select>
          </label>
        </div>

        <div className="entry-head">
          <span className="field-label">법인별 거래건수 / 총 금액</span>
          <button type="button" className="btn btn-sm" onClick={fillAll}>활성 법인 모두 불러오기</button>
        </div>
        <div className="entry-table">
          <div className="entry-row entry-row-head">
            <span>법인</span><span>거래건수</span><span>총 금액 (원)</span><span>메모</span><span />
          </div>
          {lines.map((l) => (
            <div className="entry-row" key={l.key}>
              <select aria-label="법인" value={l.corporation_id} onChange={(e) => update(l.key, 'corporation_id', e.target.value)}>
                <option value="">법인 선택</option>
                {activeCorps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input aria-label="거래건수" inputMode="numeric" placeholder="0" className="num"
                value={withComma(l.tx_count)} onChange={(e) => update(l.key, 'tx_count', onlyDigits(e.target.value))} />
              <input aria-label="총 금액" inputMode="numeric" placeholder="0" className="num"
                value={withComma(l.total_amount)} onChange={(e) => update(l.key, 'total_amount', onlyDigits(e.target.value))} />
              <input aria-label="메모" placeholder="선택" value={l.memo} onChange={(e) => update(l.key, 'memo', e.target.value)} />
              <button type="button" className="icon-btn" aria-label="줄 삭제" onClick={() => removeLine(l.key)} disabled={lines.length === 1}>×</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm entry-add" onClick={addLine}>+ 줄 추가</button>
        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
      </form>
    </Modal>
  );
}
