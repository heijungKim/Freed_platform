import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { DataTable, PageHeader, StatCard } from '../components/ui.jsx';
import { daysAgo, num, today, won } from '../format.js';

const PRESETS = [
  { label: '오늘', from: () => today() },
  { label: '7일', from: () => daysAgo(6) },
  { label: '30일', from: () => daysAgo(29) },
  { label: '90일', from: () => daysAgo(89) },
];

export default function Stats() {
  const [range, setRange] = useState({ from: daysAgo(29), to: today() });
  const [unit, setUnit] = useState('day');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [summary, daily, byCorp, byPg] = await Promise.all([
        api.get('/stats/summary', range),
        api.get('/stats/daily', { ...range, unit }),
        api.get('/stats/by-corporation', range),
        api.get('/stats/by-pg', range),
      ]);
      setData({ summary, daily: daily.rows, byCorp: byCorp.rows, byPg: byPg.rows });
      setError('');
    } catch (e) { setError(e.message); }
  }, [range, unit]);

  useEffect(() => { load(); }, [load]);

  const p = data?.summary.period || {};
  const t = data?.summary.totals || {};
  const totalAmount = data?.byCorp.reduce((s, r) => s + r.total_amount, 0) || 0;
  const totalPgAmount = data?.byPg.reduce((s, r) => s + r.total_amount, 0) || 0;

  return (
    <>
      <PageHeader
        title="집계"
        desc="거래내역(수동 입력) 기준 기간별 실적과 법인·PG별 집계를 확인합니다."
        actions={(
          <div className="range-picker">
            {PRESETS.map((pr) => (
              <button
                key={pr.label}
                className={`btn btn-sm ${range.from === pr.from() && range.to === today() ? 'btn-primary' : ''}`}
                onClick={() => setRange({ from: pr.from(), to: today() })}
              >{pr.label}</button>
            ))}
            <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <span>~</span>
            <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
        )}
      />
      {error && <div className="alert">{error}</div>}

      <div className="stat-grid">
        <StatCard label="총 거래건수" value={`${num(p.tx_count)}건`} sub={`입력 ${num(p.entries)}회 · ${num(p.corporations_with_records)}개 법인`} tone="violet" />
        <StatCard label="총 금액" value={won(p.total_amount)} tone="blue" />
        <StatCard label="건당 평균 금액" value={won(p.tx_count ? Math.round(p.total_amount / p.tx_count) : 0)} tone="amber" />
        <StatCard label="법인당 평균 금액" value={won(p.corporations_with_records ? Math.round(p.total_amount / p.corporations_with_records) : 0)} sub={`거래 입력 법인 ${num(p.corporations_with_records)}곳 기준`} />
      </div>
      <div className="stat-grid">
        <StatCard label="전체 카드 잔액 (선수금)" value={won(t.total_balance)} tone="green" />
        <StatCard label="활성 법인" value={`${num(t.active_corporations)} / ${num(t.corporations)}`} />
        <StatCard label="정상 카드" value={`${num(t.active_cards)} / ${num(t.cards)}`} />
        <StatCard label="활성 PG" value={num(t.active_pgs)} />
      </div>

      <div className="card chart-card">
        <div className="card-head">
          <h2>{unit === 'day' ? '일별' : '월별'} 추이</h2>
          <div className="seg">
            <button className={unit === 'day' ? 'on' : ''} onClick={() => setUnit('day')}>일별</button>
            <button className={unit === 'month' ? 'on' : ''} onClick={() => setUnit('month')}>월별</button>
          </div>
        </div>
        <BarChart rows={data?.daily || []} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>법인별 집계</h2></div>
          <DataTable
            rows={data?.byCorp || []}
            columns={[
              { key: 'name', label: '법인', filter: true, render: (r) => <strong>{r.name}</strong> },
              { key: 'tx_count', label: '건수', align: 'right', filter: true, render: (r) => num(r.tx_count) },
              { key: 'total_amount', label: '총 금액', align: 'right', filter: true, render: (r) => won(r.total_amount) },
              { key: 'share', label: '금액 비중', width: 140, render: (r) => <Share value={r.total_amount} total={totalAmount} /> },
              { key: 'balance', label: '현재 잔액', align: 'right', filter: true, render: (r) => won(r.balance) },
            ]}
          />
        </div>
        <div className="card">
          <div className="card-head"><h2>PG별 집계</h2></div>
          <DataTable
            rows={data?.byPg || []}
            columns={[
              { key: 'name', label: 'PG', filter: true, render: (r) => <strong>{r.name}</strong> },
              { key: 'tx_count', label: '건수', align: 'right', filter: true, render: (r) => num(r.tx_count) },
              { key: 'total_amount', label: '총 금액', align: 'right', filter: true, render: (r) => won(r.total_amount) },
              { key: 'share', label: '금액 비중', width: 140, render: (r) => <Share value={r.total_amount} total={totalPgAmount} /> },
              { key: 'avg', label: '건당 평균', align: 'right', render: (r) => (r.tx_count ? won(Math.round(r.total_amount / r.tx_count)) : '-') },
            ]}
          />
        </div>
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

/** 총 금액 막대 차트 (SVG) */
function BarChart({ rows }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return <div className="table-empty">해당 기간에 입력된 거래내역이 없습니다.</div>;
  const W = 900;
  const H = 260;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const max = Math.max(1, ...rows.map((r) => r.total_amount));
  const niceMax = niceCeil(max);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / rows.length;
  const bw = Math.max(2, Math.min(28, slot * 0.6));
  const y = (v) => pad.t + ih - (v / niceMax) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const labelEvery = Math.ceil(rows.length / 10);

  return (
    <div className="chart">
      <div className="legend">
        <span><i className="sw sw-pay" />총 금액</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="거래 추이 차트">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} className="grid-line" />
            <text x={pad.l - 8} y={y(tv) + 4} textAnchor="end" className="axis-text">{shortWon(tv)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={r.period} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} className={hover === i ? 'hover-band' : 'band'} />
              <rect x={cx - bw / 2} y={y(r.total_amount)} width={bw} height={pad.t + ih - y(r.total_amount)} rx="2" className="bar-pay" />
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="axis-text">{r.period.length > 7 ? r.period.slice(5) : r.period}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{rows[hover].period}</strong>
          <div>총 금액 {won(rows[hover].total_amount)}</div>
          <div>건수 {num(rows[hover].tx_count)}</div>
        </div>
      )}
    </div>
  );
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function shortWon(v) {
  if (v >= 1e8) return `${+(v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${+(v / 1e4).toFixed(0)}만`;
  return String(v);
}
