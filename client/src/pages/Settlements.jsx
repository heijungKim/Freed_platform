import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useOptions } from '../hooks.js';
import { Badge, DataTable, FormModal, PageHeader, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { LABELS, num, today, toDateStr, won } from '../format.js';

const STATUS_OPTS = Object.entries(LABELS.settle).filter(([k]) => k !== 'NONE').map(([value, label]) => ({ value, label }));
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const shift = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
};
const withWeek = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${date} (${WEEK[new Date(y, m - 1, d).getDay()]})`;
};
const nowLocal = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${toDateStr(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const PRESETS = [
  { label: '7일', days: 7 },
  { label: '14일', days: 14 },
  { label: '30일', days: 30 },
  { label: '90일', days: 90 },
];

export default function Settlements() {
  const yesterday = shift(today(), -1);
  const [baseDate, setBaseDate] = useState(yesterday); // 거래일 (정산일 = +1)
  const [day, setDay] = useState(null);
  const [range, setRange] = useState({ from: shift(yesterday, -13), to: yesterday, corporation_id: '' });
  const [view, setView] = useState('daily');
  const [daily, setDaily] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [settling, setSettling] = useState(null);
  const [version, setVersion] = useState(0);
  const [corps] = useOptions('/corporations/options');
  const confirm = useConfirm();
  const toast = useToast();

  const loadDay = useCallback(() => {
    api.get('/settlements/summary', { date: baseDate }).then(setDay).catch((e) => setError(e.message));
  }, [baseDate]);
  const loadRange = useCallback(() => {
    api.get('/settlements/daily', range).then(setDaily).catch((e) => setError(e.message));
    api.get('/settlements', range).then(setDetail).catch((e) => setError(e.message));
  }, [range]);
  useEffect(() => { loadDay(); }, [loadDay, version]);
  useEffect(() => { loadRange(); }, [loadRange, version]);
  const refresh = () => setVersion((v) => v + 1);

  const bulk = async () => {
    const targets = (day?.rows || []).filter((r) => ['UNPAID', 'SCHEDULED', 'PARTIAL'].includes(r.status));
    const amount = targets.reduce((s, r) => s + r.tx_amount, 0);
    if (!(await confirm(`${baseDate} 거래 미정산 ${targets.length}개 법인을 거래 금액 전액으로 정산 처리할까요?\n정산 금액 합계: ${won(amount)}`, { okLabel: '일괄 정산' }))) return;
    try {
      const r = await api.post('/settlements/bulk', { tx_date: baseDate });
      toast(`${r.count}개 법인 ${won(r.amount)} 정산 처리되었습니다.`);
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  const cancel = async (r) => {
    if (!(await confirm(`${r.tx_date} ${r.corporation_name} 정산(${won(r.paid_amount)})을 취소할까요?`, { danger: true, okLabel: '정산 취소' }))) return;
    try {
      await api.del(`/settlements/${r.settlement_id}`);
      toast('정산이 취소되었습니다.');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  const exportCsv = async () => {
    try { await api.download('/settlements/export.csv', range, 'settlements.csv'); } catch (e) { toast(e.message, 'error'); }
  };

  const rowActions = (r) => (
    <div className="row-actions">
      {r.tx_amount > 0 || r.settlement_id ? (
        <button className={`btn btn-sm ${r.settlement_id ? '' : 'btn-primary-soft'}`} onClick={(e) => { e.stopPropagation(); setSettling(r); }}>
          {r.settlement_id ? '수정' : '정산 처리'}
        </button>
      ) : null}
      {r.settlement_id && <button className="btn btn-sm btn-ghost-danger" onClick={(e) => { e.stopPropagation(); cancel(r); }}>취소</button>}
    </div>
  );

  const corpColumns = (withDate) => [
    ...(withDate ? [
      { key: 'tx_date', label: '거래일', filter: true },
      { key: 'settle_date', label: '정산일', filter: true },
    ] : []),
    { key: 'corporation_name', label: '법인', filter: true, render: (r) => <strong>{r.corporation_name}</strong> },
    { key: 'tx_count', label: '거래건수', align: 'right', filter: true, render: (r) => `${num(r.tx_count)}건` },
    { key: 'tx_amount', label: '거래 금액', align: 'right', filter: true, render: (r) => won(r.tx_amount) },
    { key: 'paid_amount', label: '정산 금액', align: 'right', filter: true, render: (r) => <strong>{r.settlement_id ? won(r.paid_amount) : '-'}</strong> },
    { key: 'unpaid_amount', label: '미정산', align: 'right', filter: true,
      render: (r) => (r.unpaid_amount ? <span className="neg-text">{won(r.unpaid_amount)}</span> : r.diff > 0 ? <span className="muted">+{won(r.diff)} 초과</span> : '-') },
    { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} kind="settle" /> },
    { key: 'paid_at', label: '지급일시', filter: true, render: (r) => r.paid_at?.slice(0, 16) || '-' },
    { key: 'memo', label: '메모', render: (r) => r.memo || '-' },
    { key: 'actions', label: '', align: 'right', render: rowActions },
  ];

  const pendingCount = (day?.rows || []).filter((r) => ['UNPAID', 'SCHEDULED', 'PARTIAL'].includes(r.status)).length;
  const isYesterday = baseDate === yesterday;
  const ds = daily?.summary || {};

  return (
    <>
      <PageHeader
        title="정산 내역"
        desc="거래일 다음 날(D+1) 법인별로 정산 지급한 내역을 관리합니다. 정산 대상 금액은 거래내역 입력 금액입니다."
        actions={<button className="btn" onClick={exportCsv}>CSV 다운로드</button>}
      />
      {error && <div className="alert">{error}</div>}

      {/* ---------- 전날 거래 정산 ---------- */}
      <div className="card settle-hero">
        <div className="card-head">
          <div className="settle-title">
            <h2>{isYesterday ? '전날 거래 정산' : '거래일 정산'}</h2>
            <span className="muted">거래일 <b>{withWeek(baseDate)}</b> → 정산일 <b>{withWeek(shift(baseDate, 1))}</b></span>
          </div>
          <div className="day-nav">
            <button className="btn btn-sm" onClick={() => setBaseDate((d) => shift(d, -1))} aria-label="이전 날">‹ 이전 날</button>
            <input type="date" value={baseDate} max={today()} onChange={(e) => e.target.value && setBaseDate(e.target.value)} />
            <button className="btn btn-sm" onClick={() => setBaseDate((d) => shift(d, 1))} disabled={baseDate >= today()} aria-label="다음 날">다음 날 ›</button>
            {!isYesterday && <button className="btn btn-sm" onClick={() => setBaseDate(yesterday)}>전날로</button>}
          </div>
        </div>
        <div className="stat-grid settle-stats">
          <StatCard label="거래" value={won(day?.tx_amount)} sub={`${num(day?.tx_count)}건 · ${num(day?.corporations)}개 법인`} tone="blue" />
          <StatCard label="정산 완료 금액" value={won(day?.paid_amount)} sub={`${num(day?.paid_corporations)}개 법인 정산`} tone="green" />
          <StatCard label="미정산 금액" value={won(day?.unpaid_amount)} sub={`${num(day?.unpaid_corporations)}개 법인 남음`} tone={day?.unpaid_amount ? 'red' : undefined} />
          <StatCard label="정산률" value={day?.tx_amount ? `${((Math.min(day.paid_amount, day.tx_amount) / day.tx_amount) * 100).toFixed(1)}%` : '-'}
            sub={<div className="share"><div className="share-bar"><span style={{ width: `${day?.tx_amount ? Math.min(100, (day.paid_amount / day.tx_amount) * 100) : 0}%` }} /></div></div>} />
        </div>
        <div className="settle-actions">
          <span className="muted">{pendingCount ? `미정산 ${pendingCount}개 법인이 있습니다.` : day?.corporations ? '이 날 거래는 모두 정산되었습니다.' : '이 날 입력된 거래가 없습니다.'}</span>
          <button className="btn btn-primary" disabled={!pendingCount} onClick={bulk}>미정산 {pendingCount}곳 일괄 정산</button>
        </div>
        <DataTable rows={day?.rows || []} loading={!day} empty="이 날 입력된 거래가 없습니다." columns={corpColumns(false)} />
      </div>

      {/* ---------- 기간별 정산 현황 ---------- */}
      <div className="card">
        <div className="card-head">
          <h2>기간별 정산 현황</h2>
          <div className="seg">
            <button className={view === 'daily' ? 'on' : ''} onClick={() => setView('daily')}>일자별</button>
            <button className={view === 'detail' ? 'on' : ''} onClick={() => setView('detail')}>법인별 상세</button>
          </div>
        </div>
        <div className="filter-bar flat">
          <div className="range-picker">
            {PRESETS.map((p) => (
              <button key={p.label} type="button"
                className={`btn btn-sm ${range.to === yesterday && range.from === shift(yesterday, -(p.days - 1)) ? 'btn-primary' : ''}`}
                onClick={() => setRange((r) => ({ ...r, from: shift(yesterday, -(p.days - 1)), to: yesterday }))}>{p.label}</button>
            ))}
            <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <span>~</span>
            <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <select value={range.corporation_id} onChange={(e) => setRange((r) => ({ ...r, corporation_id: e.target.value }))}>
            <option value="">전체 법인</option>
            {corps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="total-row total-row-4">
          <span>기간 합계</span>
          <span>거래 <b>{won(ds.tx_amount)}</b></span>
          <span>정산 <b>{won(ds.paid_amount)}</b></span>
          <span>미정산 <b className={ds.unpaid_amount ? 'neg-text' : ''}>{won(ds.unpaid_amount)}</b></span>
        </div>
        {view === 'daily' ? (
          <DataTable
            loading={!daily}
            rows={daily?.rows || []}
            onRowClick={(r) => { setBaseDate(r.tx_date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            rowTitle="클릭하면 위에서 그날 법인별 정산을 볼 수 있습니다"
            empty="기간 내 입력된 거래가 없습니다."
            columns={[
              { key: 'tx_date', label: '거래일', filter: true, render: (r) => <strong className="link-text">{withWeek(r.tx_date)}</strong> },
              { key: 'settle_date', label: '정산일', filter: true },
              { key: 'corporations', label: '법인', align: 'right', render: (r) => `${num(r.paid_corporations)} / ${num(r.corporations)}곳` },
              { key: 'tx_count', label: '거래건수', align: 'right', filter: true, render: (r) => `${num(r.tx_count)}건` },
              { key: 'tx_amount', label: '거래 금액', align: 'right', filter: true, render: (r) => won(r.tx_amount) },
              { key: 'paid_amount', label: '정산 금액', align: 'right', filter: true, render: (r) => <strong>{won(r.paid_amount)}</strong> },
              { key: 'unpaid_amount', label: '미정산', align: 'right', filter: true, render: (r) => (r.unpaid_amount ? <span className="neg-text">{won(r.unpaid_amount)}</span> : '-') },
              { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} kind="settle" /> },
            ]}
          />
        ) : (
          <DataTable loading={!detail} rows={detail?.rows || []} empty="기간 내 정산 대상이 없습니다." columns={corpColumns(true)} />
        )}
      </div>

      {settling && (
        <FormModal
          title={`${settling.settlement_id ? '정산 수정' : '정산 처리'} · ${settling.tx_date} ${settling.corporation_name}`}
          submitLabel={settling.settlement_id ? '저장' : '정산 처리'}
          initial={{
            tx_amount: `${won(settling.tx_amount)} (${num(settling.tx_count)}건)`,
            paid_amount: settling.settlement_id ? settling.paid_amount : settling.tx_amount,
            paid_at: settling.paid_at ? settling.paid_at.slice(0, 16).replace(' ', 'T') : nowLocal(),
            memo: settling.memo || '',
          }}
          fields={[
            { name: 'tx_amount', label: '정산 대상 (거래 금액)', disabled: true, full: true },
            { name: 'paid_amount', label: '정산 금액 (원)', type: 'number', min: '0', required: true, hint: '실제 지급한 금액. 거래 금액과 다르면 부분/초과 정산으로 표시됩니다.' },
            { name: 'paid_at', label: '지급일시', type: 'datetime-local', required: true },
            { name: 'memo', label: '메모', type: 'textarea' },
          ]}
          onClose={() => setSettling(null)}
          onSubmit={async (v) => {
            await api.post('/settlements', { tx_date: settling.tx_date, corporation_id: settling.corporation_id, paid_amount: v.paid_amount, paid_at: v.paid_at, memo: v.memo });
            toast(settling.settlement_id ? '정산이 수정되었습니다.' : '정산 처리되었습니다.');
            setSettling(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
