import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useList, useOptions } from '../hooks.js';
import { DataTable, FormModal, Modal, PageHeader, Pagination, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { daysAgo, fmtCard, num, today, won } from '../format.js';

/** 이번 달 1일 */
const monthStart = () => `${today().slice(0, 8)}01`;

const PRESETS = [
  { label: '오늘', from: () => today() },
  { label: '이번 달', from: monthStart },
  { label: '30일', from: () => daysAgo(29) },
  { label: '90일', from: () => daysAgo(89) },
];

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const corpId = params.get('corporation_id') || '';
  const selectCorp = (id) => setParams(id ? { corporation_id: String(id) } : {}, { replace: true });
  const [period, setPeriod] = useState({ from: monthStart(), to: today(), pg_id: '' });
  const range = { ...period, corporation_id: corpId };
  const setRange = (fn) => setPeriod((p) => { const n = fn(p); return { from: n.from, to: n.to, pg_id: n.pg_id }; });
  const [view, setView] = useState('summary'); // summary | list | items
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
      setByCorp(await api.get('/records/by-corporation', period));
      setError('');
    } catch (e) { setError(e.message); }
  }, [period]);
  useEffect(() => { loadSummary(); }, [loadSummary, version]);

  const refresh = () => setVersion((v) => v + 1);
  const rows = byCorp?.rows || [];
  const selected = rows.find((r) => String(r.corporation_id) === corpId)
    || (corpId ? { corporation_id: Number(corpId), corporation_name: corps.find((c) => String(c.id) === corpId)?.name || '', tx_count: 0, total_amount: 0, entries: 0 } : null);
  const s = selected || byCorp?.summary || {};
  const withRecords = rows.filter((r) => r.entries > 0).length;
  const tabs = rows.filter((r) => r.status === 'ACTIVE' || r.entries > 0 || String(r.corporation_id) === corpId);

  const exportCsv = async () => {
    try {
      if (view === 'items') await api.download('/transactions/export.csv', { ...range, records_only: 1 }, 'transaction_items.csv');
      else await api.download('/records/export.csv', range, 'tx_records.csv');
    } catch (e) { toast(e.message, 'error'); }
  };

  const VIEWS = [
    ['summary', corpId ? '일자별 합계' : '법인별 합계'],
    ['list', '입력 내역'],
    ['items', '거래 상세 (건별)'],
  ];

  return (
    <>
      <PageHeader
        title="거래내역"
        desc="법인별 거래건수와 총 금액을 입력하면 법인 선불카드에 건별 거래(가맹점·금액)로 나눠 기록됩니다."
        actions={(
          <>
            <button className="btn" onClick={exportCsv}>{view === 'items' ? '건별 CSV' : 'CSV 다운로드'}</button>
            <button className="btn btn-primary" onClick={() => setEntering(true)}>+ 거래 입력</button>
          </>
        )}
      />

      <div className="corp-tabs" role="tablist" aria-label="법인 선택">
        <button type="button" role="tab" aria-selected={!corpId} className={`corp-tab ${!corpId ? 'on' : ''}`} onClick={() => selectCorp('')}>
          전체 법인 <span className="cnt">{won(byCorp?.summary?.total_amount)}</span>
        </button>
        {tabs.map((c) => (
          <button
            key={c.corporation_id}
            type="button"
            role="tab"
            aria-selected={String(c.corporation_id) === corpId}
            className={`corp-tab ${String(c.corporation_id) === corpId ? 'on' : ''} ${c.status !== 'ACTIVE' ? 'inactive' : ''}`}
            onClick={() => selectCorp(c.corporation_id)}
            title={`${num(c.tx_count)}건 · ${won(c.total_amount)}`}
          >
            {c.corporation_name} <span className="cnt">{c.total_amount ? won(c.total_amount) : '0'}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="range-picker">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-sm ${period.from === p.from() && period.to === today() ? 'btn-primary' : ''}`}
              onClick={() => setRange((r) => ({ ...r, from: p.from(), to: today() }))}
            >{p.label}</button>
          ))}
          <input type="date" value={period.from} max={period.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <span>~</span>
          <input type="date" value={period.to} min={period.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <select value={period.pg_id} onChange={(e) => setRange((r) => ({ ...r, pg_id: e.target.value }))}>
          <option value="">전체 PG</option>
          {pgs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label={selected ? `${selected.corporation_name} · 거래건수` : '총 거래건수'} value={`${num(s.tx_count)}건`} tone="violet" />
        <StatCard label="총 금액" value={won(s.total_amount)} tone="blue" />
        <StatCard label="건당 평균 금액" value={won(s.tx_count ? Math.round(s.total_amount / s.tx_count) : 0)} />
        {selected ? (
          <StatCard label="입력 횟수" value={`${num(selected.entries)}회`} sub={selected.last_date ? `최근 거래일 ${selected.last_date}` : '기간 내 입력 없음'} tone="green" />
        ) : (
          <StatCard label="입력된 법인" value={`${num(withRecords)} / ${num(rows.length)}`} sub={`입력 ${num(s.entries)}회`} tone="green" />
        )}
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="card">
        <div className="card-head">
          <h2>{selected ? `${selected.corporation_name} · ` : ''}{VIEWS.find(([k]) => k === view)[1]}</h2>
          <div className="seg">
            {VIEWS.map(([k, label]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>)}
          </div>
        </div>
        {view === 'summary' && (corpId
          ? <DailySummary key={corpId} range={range} version={version} onOpenDate={(d) => setDetailCorp({ ...selected, date: d })} />
          : <CorpSummary rows={rows} summary={byCorp?.summary || {}} loading={!byCorp} onOpen={(r) => selectCorp(r.corporation_id)} />)}
        {view === 'list' && <RecordList key={corpId} range={range} pgs={pgs} corps={corps} version={version} onChanged={refresh} corporationId={corpId} />}
        {view === 'items' && <ItemList key={corpId} range={range} version={version} onChanged={refresh} corpSelected={Boolean(corpId)} pgs={pgs} corps={corps} />}
      </div>

      {entering && (
        <EntryModal
          corps={corps}
          pgs={pgs}
          defaultCorpId={corpId}
          onClose={() => setEntering(false)}
          onSaved={(r) => {
            toast(r.allocated ? `${r.count}건 입력 · 카드 거래 ${num(r.allocated)}건 생성 (${won(r.allocated_amount)})` : `${r.count}건 입력되었습니다.`);
            setEntering(false); refresh();
          }}
        />
      )}
      {detailCorp && (
        <CorpDetailModal
          corp={detailCorp}
          range={detailCorp.date ? { ...range, from: detailCorp.date, to: detailCorp.date } : range}
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

/* ---------- 일자별 합계 (법인 선택 시) ---------- */
function DailySummary({ range, version, onOpenDate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/records/by-date', range).then(setData).catch((e) => setError(e.message));
  }, [range.from, range.to, range.pg_id, range.corporation_id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = data?.rows || [];
  const sum = rows.reduce((a, r) => ({ c: a.c + r.tx_count, t: a.t + r.total_amount }), { c: 0, t: 0 });
  return (
    <>
      {error && <div className="alert">{error}</div>}
      <DataTable
        loading={!data}
        rows={rows}
        onRowClick={(r) => onOpenDate(r.record_date)}
        rowTitle="클릭하여 그날 입력 내역 보기"
        empty="기간 내 입력된 거래가 없습니다."
        columns={[
          { key: 'record_date', label: '거래일', filter: true, render: (r) => <strong className="link-text">{r.record_date}</strong> },
          { key: 'pg_names', label: 'PG', filter: true, render: (r) => r.pg_names || '-' },
          { key: 'tx_count', label: '거래건수', align: 'right', filter: true, render: (r) => `${num(r.tx_count)}건` },
          { key: 'total_amount', label: '총 금액', align: 'right', filter: true, render: (r) => <strong>{won(r.total_amount)}</strong> },
          { key: 'avg', label: '건당 평균', align: 'right', render: (r) => (r.tx_count ? won(Math.round(r.total_amount / r.tx_count)) : '-') },
          { key: 'alloc_count', label: '카드 거래', align: 'right', render: (r) => (r.alloc_count ? `${num(r.alloc_count)}건` : <span className="muted">미배분</span>) },
          { key: 'entries', label: '입력 횟수', align: 'right', render: (r) => `${num(r.entries)}회` },
        ]}
      />
      <div className="total-row">
        <span>합계 ({num(rows.length)}일)</span>
        <span><b>{num(sum.c)}</b>건</span>
        <span><b>{won(sum.t)}</b></span>
      </div>
    </>
  );
}

/* ---------- 거래 상세 (건별) ---------- */
function ItemList({ range, version, onChanged, corpSelected, pgs, corps }) {
  const list = useList('/transactions', { records_only: 1, ...range }, 50);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    list.applyFilter('from', range.from);
    list.applyFilter('to', range.to);
    list.applyFilter('pg_id', range.pg_id);
    list.applyFilter('corporation_id', range.corporation_id);
  }, [range.from, range.to, range.pg_id, range.corporation_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (version) list.reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = list.data.summary || {};
  const toast = useToast();
  const confirm = useConfirm();

  const removeRecord = async (r) => {
    if (!(await confirm(`${r.record_date} ${r.corporation_name} 입력(${num(r.tx_count)}건 / ${won(r.total_amount)})을 삭제할까요?\n카드 거래도 함께 취소됩니다.`, { danger: true, okLabel: '삭제' }))) return false;
    try { await api.del(`/records/${r.id}`); toast('삭제되었습니다.'); onChanged(); return true; } catch (e) { toast(e.message, 'error'); return false; }
  };

  return (
    <>
      <DataTable
        rows={list.data.rows}
        loading={list.loading}
        colFilters={list.colFilters}
        onColFilter={list.onColFilter}
        onRowClick={(t) => setViewing({ id: t.record_id, record_date: t.transacted_at.slice(0, 10), corporation_name: t.corporation_name, tx_count: 0, total_amount: 0, focusTx: t.id })}
        rowTitle="클릭하여 이 거래가 속한 입력 상세 보기"
        empty="기간 내 건별 거래가 없습니다. (카드에 배분된 거래내역만 표시됩니다)"
        columns={[
          { key: 'transacted_at', label: '거래일시', filter: true },
          ...(corpSelected ? [] : [{ key: 'corporation_name', label: '법인', filter: true }]),
          { key: 'merchant_name', label: '가맹점 상호', filter: true, render: (t) => <strong>{t.merchant_name || '-'}</strong> },
          { key: 'amount', label: '금액', align: 'right', filter: true, render: (t) => <strong>{won(t.amount)}</strong> },
          { key: 'card_no', label: '카드번호', filter: true, render: (t) => <span className="mono">{fmtCard(t.card_no)}</span> },
          { key: 'holder_name', label: '사용자', filter: true },
          { key: 'pg_name', label: 'PG', filter: true, render: (t) => t.pg_name || '-' },
          { key: 'approval_no', label: '승인번호', filter: true, render: (t) => <code>{t.approval_no}</code> },
        ]}
      />
      <div className="total-row">
        <span>조회 합계</span>
        <span><b>{num(list.data.total)}</b>건</span>
        <span><b>{won(sum.charge)}</b></span>
      </div>
      <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      {viewing && (
        <AllocationModal
          record={viewing}
          onClose={() => setViewing(null)}
          onEdit={(r) => { setViewing(null); setEditing(r); }}
          onDelete={async (r) => { if (await removeRecord(r)) setViewing(null); }}
          onChanged={() => { list.reload(); onChanged(); }}
        />
      )}
      {editing && <RecordEditModal record={editing} corps={corps} pgs={pgs} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); onChanged(); }} />}
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
        rowTitle="클릭하여 이 법인만 보기"
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
      <p className="table-hint">법인을 누르면 해당 법인 탭으로 이동해 일자별 합계·입력 내역·건별 거래(가맹점·금액)를 볼 수 있습니다.</p>
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
  const [viewing, setViewing] = useState(null);
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
    const extra = r.alloc_count ? `\n카드에 배분된 충전 ${num(r.alloc_count)}건(${won(r.alloc_amount)})도 함께 취소되고 카드 잔액이 차감됩니다.` : '';
    if (!(await confirm(`${r.record_date} ${r.corporation_name} 입력(${num(r.tx_count)}건 / ${won(r.total_amount)})을 삭제할까요?${extra}`, { danger: true, okLabel: '삭제' }))) return false;
    try {
      await api.del(`/records/${r.id}`);
      toast('삭제되었습니다.');
      onChanged();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  };

  const columns = [
    { key: 'record_date', label: '거래일', filter: true },
    ...(corporationId ? [] : [{ key: 'corporation_name', label: '법인', filter: true }]),
    { key: 'pg_name', label: 'PG', filter: true, render: (r) => r.pg_name || '-' },
    { key: 'tx_count', label: '거래건수', align: 'right', filter: true, render: (r) => `${num(r.tx_count)}건` },
    { key: 'total_amount', label: '총 금액', align: 'right', filter: true, render: (r) => <strong>{won(r.total_amount)}</strong> },
    { key: 'alloc', label: '카드 배분', render: (r) => <AllocBadge r={r} /> },
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
        onRowClick={setViewing}
        rowTitle="클릭하여 상세 보기 · 수정 · 삭제"
        empty="해당 기간에 입력된 거래내역이 없습니다."
      />
      {viewing && (
        <AllocationModal
          record={viewing}
          onClose={() => setViewing(null)}
          onEdit={(r) => { setViewing(null); setEditing(r); }}
          onDelete={async (r) => { if (await remove(r)) setViewing(null); }}
          onChanged={onChanged}
        />
      )}
      <div className="total-row">
        <span>조회 합계 ({num(list.data.total)}회 입력)</span>
        <span><b>{num(sum.tx_count)}</b>건</span>
        <span><b>{won(sum.total_amount)}</b></span>
      </div>
      {!compact && <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />}
      {editing && <RecordEditModal record={editing} corps={corps} pgs={pgs} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </>
  );
}

/** 거래내역(입력) 수정 */
function RecordEditModal({ record, corps, pgs, onClose, onSaved }) {
  const toast = useToast();
  return (
    <FormModal
      title="거래내역 수정"
      initial={{ ...record, pg_id: record.pg_id ?? '', allocate: record.alloc_count > 0 ? 'Y' : 'N' }}
      fields={[
        { name: 'record_date', label: '거래일', type: 'date', required: true },
        { name: 'corporation_id', label: '법인', type: 'select', required: true, options: corps.map((c) => ({ value: c.id, label: c.name })) },
        { name: 'pg_id', label: 'PG', type: 'select', options: pgs.map((p) => ({ value: p.id, label: p.name })) },
        { name: 'tx_count', label: '거래건수', type: 'number', min: '0', required: true },
        { name: 'total_amount', label: '총 금액 (원)', type: 'number', min: '0', required: true },
        { name: 'allocate', label: '카드 거래 생성', type: 'select', required: true, full: true,
          hint: '저장하면 기존 건별 거래는 취소되고, 수정한 건수·금액으로 다시 생성됩니다. (가맹점도 새로 배정)',
          options: [{ value: 'Y', label: '법인 선불카드에 건별 거래로 자동 배분' }, { value: 'N', label: '배분하지 않음 (기록만)' }] },
        { name: 'memo', label: '메모', type: 'textarea' },
      ]}
      onClose={onClose}
      onSubmit={async (v) => {
        await api.put(`/records/${record.id}`, { ...v, allocate: v.allocate === 'Y' });
        toast('수정되었습니다.');
        onSaved();
      }}
    />
  );
}

/* ---------- 법인 상세 (입력 내역) ---------- */
function CorpDetailModal({ corp, range, corps, pgs, version, onClose, onChanged }) {
  return (
    <Modal title={`${corp.corporation_name} · 거래 입력 내역${corp.date ? ` · ${corp.date}` : ''}`} width={900} onClose={onClose}
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

function EntryModal({ corps, pgs, defaultCorpId, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [pgId, setPgId] = useState('');
  const [allocate, setAllocate] = useState(true);
  const [lines, setLines] = useState([{ ...emptyLine(), corporation_id: defaultCorpId ? String(defaultCorpId) : '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeCorps = corps.filter((c) => c.status === 'ACTIVE');
  const corpById = (id) => corps.find((c) => String(c.id) === String(id));

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
      if (allocate) {
        const c = corpById(l.corporation_id);
        const cnt = Number(l.tx_count); const amt = Number(l.total_amount);
        if ((cnt || amt) && !c?.active_card_count) return setError(`${i + 1}번째 줄: ${c?.name || '법인'}에 정상 카드가 없어 배분할 수 없습니다.`);
        if (amt && !cnt) return setError(`${i + 1}번째 줄: 금액을 배분하려면 거래건수가 1건 이상이어야 합니다.`);
        if (cnt && amt < cnt) return setError(`${i + 1}번째 줄: 총 금액은 거래건수 이상이어야 합니다.`);
        if (c && c.charge_room >= 0 && amt > c.charge_room) return setError(`${i + 1}번째 줄: ${c.name} 카드의 충전 한도 여유(${won(c.charge_room)})보다 금액이 큽니다.`);
      }
    }
    const ids = filled.map((l) => l.corporation_id);
    if (new Set(ids).size !== ids.length) return setError('같은 법인이 두 번 입력되었습니다.');
    setBusy(true);
    try {
      const r = await api.post('/records', {
        record_date: date,
        pg_id: pgId || null,
        allocate,
        items: filled.map(({ corporation_id, tx_count, total_amount, memo }) => ({ corporation_id, tx_count, total_amount, memo })),
      });
      onSaved(r);
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
              {pgs.filter((p) => p.status === 'ACTIVE').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <label className={`alloc-toggle ${allocate ? 'on' : ''}`}>
          <input type="checkbox" checked={allocate} onChange={(e) => setAllocate(e.target.checked)} />
          <div>
            <strong>법인 선불카드에 건별 거래로 자동 배분</strong>
            <small>입력한 거래건수만큼 법인 카드에 가맹점·금액이 다른 거래를 만들고, 합계를 총 금액과 정확히 맞춥니다.</small>
          </div>
        </label>

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
              {allocate && l.corporation_id && <LineInfo corp={corpById(l.corporation_id)} line={l} />}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm entry-add" onClick={addLine}>+ 줄 추가</button>
        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
      </form>
    </Modal>
  );
}

/* ---------- 카드 배분 표시 ---------- */
function AllocBadge({ r }) {
  if (!r.alloc_count) return <span className="muted">미배분</span>;
  const ok = r.alloc_count === r.tx_count && r.alloc_amount === r.total_amount;
  return (
    <span className={`badge ${ok ? 'badge-green' : 'badge-amber'}`} title={ok ? '건수·금액 일치' : '입력값과 배분 결과가 다릅니다'}>
      {num(r.alloc_count)}건 · 카드 {num(r.alloc_cards)}장
    </span>
  );
}

/** 입력 줄 아래: 법인 카드 현황 + 1건 평균 */
function LineInfo({ corp, line }) {
  if (!corp) return null;
  const cnt = Number(line.tx_count || 0);
  const amt = Number(line.total_amount || 0);
  if (!corp.active_card_count) return <div className="line-info warn">정상 카드 없음 · 배분 불가 (선불카드 관리에서 먼저 발급하세요)</div>;
  const room = corp.charge_room < 0 ? '한도 무제한 카드 포함' : `충전 가능 ${won(corp.charge_room)}`;
  const over = corp.charge_room >= 0 && amt > corp.charge_room;
  return (
    <div className={`line-info ${over ? 'warn' : ''}`}>
      정상 카드 {num(corp.active_card_count)}장 · {room}
      {cnt > 0 && amt > 0 && <> · 건당 평균 {won(Math.round(amt / cnt))}</>}
      {over && ' · 한도 초과'}
    </div>
  );
}

/** 거래내역 1건 상세: 배분된 충전 조회·추가·수정·삭제 + 입력 수정/삭제 */
function AllocationModal({ record: initial, onClose, onEdit, onDelete, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('tx');
  const [editing, setEditing] = useState(null); // null | {} (추가) | tx (수정)
  const confirm = useConfirm();
  const toast = useToast();

  const load = useCallback(() => {
    api.get(`/records/${initial.id}/allocations`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [initial.id]);
  useEffect(() => { load(); }, [load]);

  const record = data?.record || initial;
  const rows = data?.rows || [];
  const sum = rows.reduce((s, t) => s + t.amount, 0);
  const amounts = rows.map((t) => t.amount);
  const ok = data && rows.length === record.tx_count && sum === record.total_amount;
  const activeCards = (data?.corp_cards || []).filter((c) => c.status === 'ACTIVE');
  const changed = (msg) => { toast(msg); load(); onChanged(); };

  const removeTx = async (t) => {
    if (!(await confirm(`${t.transacted_at} ${fmtCard(t.card_no)} 충전 ${won(t.amount)}을 삭제할까요?\n카드 잔액이 차감되고, 입력의 거래건수·총 금액이 함께 줄어듭니다.`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/records/${record.id}/allocations/${t.id}`);
      changed('충전 거래가 삭제되었습니다.');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Modal
      title={`거래내역 상세 · ${record.record_date} ${record.corporation_name}`}
      width={900}
      onClose={onClose}
      footer={(
        <>
          <div className="foot-left">
            <button className="btn btn-ghost-danger" onClick={() => onDelete(record)}>입력 삭제</button>
          </div>
          <button className="btn" onClick={() => onEdit(record)}>입력 수정</button>
          <button className="btn btn-primary" onClick={onClose}>닫기</button>
        </>
      )}
    >
      {error && <div className="alert">{error}</div>}
      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <StatCard label="입력" value={`${num(record.tx_count)}건`} sub={`${won(record.total_amount)}${record.pg_name ? ` · ${record.pg_name}` : ''}`} />
        <StatCard label="배분 결과" value={`${num(rows.length)}건`} sub={won(sum)} tone={data ? (ok ? 'green' : 'amber') : undefined} />
        <StatCard label="배분 카드" value={`${num(data?.cards.length || 0)}장`} />
        <StatCard label="건당 평균" value={rows.length ? won(Math.round(sum / rows.length)) : '-'}
          sub={rows.length ? `최소 ${won(Math.min(...amounts))} · 최대 ${won(Math.max(...amounts))}` : null} />
      </div>
      {data && !rows.length && (
        <div className="alert alert-info">
          이 입력은 카드에 배분되지 않았습니다. &apos;입력 수정&apos;에서 자동 배분을 선택하거나, 아래 &apos;충전 추가&apos;로 직접 넣을 수 있습니다.
        </div>
      )}
      {data && rows.length > 0 && !ok && <div className="alert">입력값과 배분 결과가 다릅니다.</div>}

      <div className="modal-section-head">
        <div className="seg">
          <button className={view === 'tx' ? 'on' : ''} onClick={() => setView('tx')}>건별 거래 {num(rows.length)}건</button>
          <button className={view === 'card' ? 'on' : ''} onClick={() => setView('card')}>카드별 합계</button>
        </div>
        <button className="btn btn-sm btn-primary-soft" disabled={!activeCards.length} onClick={() => setEditing({})}
          title={activeCards.length ? undefined : '정상 카드가 없습니다'}>+ 거래 추가</button>
      </div>
      <div className="modal-section" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
        {view === 'card' ? (
          <DataTable
            loading={!data}
            rows={(data?.cards || []).map((c) => ({ ...c, id: c.card_id }))}
            empty="배분된 카드가 없습니다."
            columns={[
              { key: 'card_no', label: '카드번호', filter: true, render: (c) => <span className="mono">{fmtCard(c.card_no)}</span> },
              { key: 'holder_name', label: '사용자', filter: true },
              { key: 'issuer_name', label: '선불사업자', render: (c) => c.issuer_name || '-' },
              { key: 'count', label: '충전 건수', align: 'right', render: (c) => `${num(c.count)}건` },
              { key: 'amount', label: '충전 금액', align: 'right', render: (c) => <strong>{won(c.amount)}</strong> },
            ]}
          />
        ) : (
          <DataTable
            loading={!data}
            rows={rows.map((t) => (t.id === initial.focusTx ? { ...t, _focus: true } : t))}
            empty="배분된 충전 거래가 없습니다."
            columns={[
              { key: 'transacted_at', label: '일시', filter: true },
              { key: 'merchant_name', label: '가맹점 상호', filter: true, render: (t) => t.merchant_name || '-' },
              { key: 'amount', label: '금액', align: 'right', filter: true, render: (t) => <strong>{won(t.amount)}</strong> },
              { key: 'card_no', label: '카드번호', filter: true, render: (t) => <span className="mono">{fmtCard(t.card_no)}</span> },
              { key: 'holder_name', label: '사용자', filter: true },
              { key: 'memo', label: '비고', render: (t) => (/수정됨|수동 추가/.test(t.memo || '') ? <span className="badge badge-amber">{t.memo.includes('수정됨') ? '수정됨' : '수동 추가'}</span> : '') },
              { key: 'actions', label: '', align: 'right', render: (t) => (
                <div className="row-actions">
                  <button className="btn btn-sm" onClick={() => setEditing(t)}>수정</button>
                  <button className="btn btn-sm btn-ghost-danger" onClick={() => removeTx(t)}>삭제</button>
                </div>
              ) },
            ]}
          />
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
        건별 거래를 추가·수정·삭제하면 입력의 거래건수와 총 금액이 합계에 맞게 자동으로 바뀝니다.
      </p>

      {editing && (
        <FormModal
          title={editing.id ? `거래 수정 · ${editing.transacted_at}` : '거래 추가'}
          submitLabel={editing.id ? '저장' : '추가'}
          initial={editing.id ? { card_id: editing.card_id, amount: editing.amount, merchant_name: editing.merchant_name || '' } : { card_id: activeCards[0]?.id ?? '' }}
          fields={[
            { name: 'card_id', label: '카드', type: 'select', required: true, full: true,
              options: (data?.corp_cards || [])
                .filter((c) => c.status === 'ACTIVE' || c.id === editing.card_id)
                .map((c) => ({ value: c.id, label: `${fmtCard(c.card_no)} · ${c.holder_name} · 잔액 ${won(c.balance)}${c.limit_amount ? ` / 한도 ${won(c.limit_amount)}` : ''}` })) },
            { name: 'merchant_name', label: '가맹점 상호', full: true, placeholder: editing.id ? '' : '비워두면 금액에 맞는 가맹점 자동 지정' },
            { name: 'amount', label: '금액 (원)', type: 'number', min: '1', required: true, full: true },
          ]}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing.id) await api.put(`/records/${record.id}/allocations/${editing.id}`, v);
            else await api.post(`/records/${record.id}/allocations`, v);
            setEditing(null);
            changed(editing.id ? '거래가 수정되었습니다.' : '거래가 추가되었습니다.');
          }}
        />
      )}
    </Modal>
  );
}
