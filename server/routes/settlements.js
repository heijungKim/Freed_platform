/**
 * 정산 내역
 *  - 정산 대상: 거래내역(tx_records)의 법인별·거래일별 합계
 *  - 정산일: 거래일 다음 날 (D+1)
 *  - 정산 처리: 실제 지급 금액/일시를 기록 (settlements), 거래 금액과 비교해 상태 산출
 */
import { Router } from 'express';
import { db, tx } from '../db.js';
import { wrap, bad, notFound, dateParam, toInt, csvEscape } from '../util.js';

const router = Router();

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => fmt(new Date());
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return fmt(dt);
}
const nowStr = () => {
  const d = new Date();
  return `${fmt(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 정산 상태: 거래금액 vs 지급금액 */
export function settleStatus(txAmount, paid, settleDate) {
  if (paid === null || paid === undefined) {
    if (!txAmount) return 'NONE';
    return settleDate > todayStr() ? 'SCHEDULED' : 'UNPAID';
  }
  if (paid === txAmount) return 'PAID';
  return paid < txAmount ? 'PARTIAL' : 'OVER';
}

function range(q) {
  const to = dateParam(q.to, '종료일') || addDays(todayStr(), -1);
  const from = dateParam(q.from, '시작일') || addDays(to, -13);
  if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  return { from, to };
}

/** (거래일, 법인) 단위 정산 행 */
function settlementRows({ from, to, corporation_id: corpId }) {
  const cond = ['r.record_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (corpId) { cond.push('r.corporation_id = ?'); params.push(corpId); }
  const txs = db.prepare(`
    SELECT r.record_date AS tx_date, r.corporation_id, c.name AS corporation_name,
      SUM(r.tx_count) AS tx_count, SUM(r.total_amount) AS tx_amount, COUNT(*) AS entries,
      GROUP_CONCAT(DISTINCT p.name) AS pg_names
    FROM tx_records r JOIN corporations c ON c.id = r.corporation_id LEFT JOIN pgs p ON p.id = r.pg_id
    WHERE ${cond.join(' AND ')}
    GROUP BY r.record_date, r.corporation_id`).all(...params);

  const sCond = ['s.tx_date BETWEEN ? AND ?'];
  const sParams = [from, to];
  if (corpId) { sCond.push('s.corporation_id = ?'); sParams.push(corpId); }
  const sets = db.prepare(`
    SELECT s.*, c.name AS corporation_name, u.name AS created_by_name
    FROM settlements s JOIN corporations c ON c.id = s.corporation_id LEFT JOIN users u ON u.id = s.created_by
    WHERE ${sCond.join(' AND ')}`).all(...sParams);

  const map = new Map();
  const key = (d, c) => `${d}|${c}`;
  for (const t of txs) {
    map.set(key(t.tx_date, t.corporation_id), { ...t, settlement: null });
  }
  for (const s of sets) {
    const k = key(s.tx_date, s.corporation_id);
    const row = map.get(k) || {
      tx_date: s.tx_date, corporation_id: s.corporation_id, corporation_name: s.corporation_name,
      tx_count: 0, tx_amount: 0, entries: 0, pg_names: null,
    };
    row.settlement = s;
    map.set(k, row);
  }
  return [...map.values()].map((r) => {
    const settleDate = addDays(r.tx_date, 1);
    const paid = r.settlement ? r.settlement.paid_amount : null;
    return {
      id: `${r.tx_date}-${r.corporation_id}`,
      ...r,
      settle_date: settleDate,
      settlement_id: r.settlement?.id ?? null,
      paid_amount: paid ?? 0,
      paid_at: r.settlement?.paid_at ?? null,
      memo: r.settlement?.memo ?? null,
      created_by_name: r.settlement?.created_by_name ?? null,
      unpaid_amount: Math.max(0, r.tx_amount - (paid ?? 0)),
      diff: (paid ?? 0) - r.tx_amount,
      status: settleStatus(r.tx_amount, paid, settleDate),
    };
  }).sort((a, b) => (a.tx_date === b.tx_date ? b.tx_amount - a.tx_amount : b.tx_date.localeCompare(a.tx_date)));
}

function summarize(rows) {
  const s = { tx_count: 0, tx_amount: 0, paid_amount: 0, unpaid_amount: 0, corporations: 0, paid_corporations: 0, unpaid_corporations: 0 };
  for (const r of rows) {
    s.tx_count += r.tx_count;
    s.tx_amount += r.tx_amount;
    s.paid_amount += r.paid_amount;
    s.unpaid_amount += r.unpaid_amount;
    s.corporations += 1;
    if (r.status === 'PAID' || r.status === 'OVER') s.paid_corporations += 1;
    if (r.status === 'UNPAID' || r.status === 'PARTIAL' || r.status === 'SCHEDULED') s.unpaid_corporations += 1;
  }
  return s;
}

/** 전날 거래 → 오늘 정산 요약 (기준일 지정 가능: date = 거래일) */
router.get('/summary', wrap((req, res) => {
  const txDate = dateParam(req.query.date, '거래일') || addDays(todayStr(), -1);
  const rows = settlementRows({ from: txDate, to: txDate });
  res.json({ tx_date: txDate, settle_date: addDays(txDate, 1), ...summarize(rows), rows });
}));

/** 거래일별 정산 현황 */
router.get('/daily', wrap((req, res) => {
  const { from, to } = range(req.query);
  const rows = settlementRows({ from, to, corporation_id: req.query.corporation_id });
  const byDate = new Map();
  for (const r of rows) {
    const d = byDate.get(r.tx_date) || [];
    d.push(r);
    byDate.set(r.tx_date, d);
  }
  const days = [...byDate.entries()].map(([date, list]) => {
    const s = summarize(list);
    const status = list.every((r) => r.status === 'PAID' || r.status === 'NONE') ? 'PAID'
      : list.some((r) => r.status === 'UNPAID' || r.status === 'PARTIAL') ? (s.paid_amount ? 'PARTIAL' : 'UNPAID')
        : list.some((r) => r.status === 'OVER') ? 'OVER' : 'SCHEDULED';
    return { id: date, tx_date: date, settle_date: addDays(date, 1), ...s, status };
  }).sort((a, b) => b.tx_date.localeCompare(a.tx_date));
  res.json({ from, to, rows: days, summary: summarize(rows) });
}));

/** (거래일, 법인) 단위 목록 */
router.get('/', wrap((req, res) => {
  const { from, to } = range(req.query);
  let rows = settlementRows({ from, to, corporation_id: req.query.corporation_id });
  if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
  res.json({ from, to, rows, summary: summarize(rows) });
}));

router.get('/export.csv', wrap((req, res) => {
  const { from, to } = range(req.query);
  const rows = settlementRows({ from, to, corporation_id: req.query.corporation_id });
  const ST = { PAID: '정산완료', PARTIAL: '부분정산', OVER: '초과정산', UNPAID: '미정산', SCHEDULED: '정산예정', NONE: '-' };
  const header = ['거래일', '정산일', '법인', '거래건수', '거래금액', '정산금액', '미정산금액', '상태', '지급일시', '메모'];
  const lines = rows.map((r) => [r.tx_date, r.settle_date, r.corporation_name, r.tx_count, r.tx_amount, r.paid_amount,
    r.unpaid_amount, ST[r.status], r.paid_at, r.memo].map(csvEscape).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="settlements_${from}_${to}.csv"`);
  res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
}));

function txAmountOf(corpId, date) {
  return db.prepare('SELECT COALESCE(SUM(total_amount),0) a FROM tx_records WHERE corporation_id = ? AND record_date = ?').get(corpId, date).a;
}

/** 정산 처리 (없으면 생성, 있으면 수정). paid_amount 미입력 시 거래 금액 전액 */
router.post('/', wrap((req, res) => {
  const b = req.body || {};
  const date = dateParam(b.tx_date, '거래일');
  if (!date) throw bad('거래일을 입력해 주세요.');
  const corp = db.prepare('SELECT id FROM corporations WHERE id = ?').get(b.corporation_id);
  if (!corp) throw notFound('법인');
  const amount = b.paid_amount === undefined || b.paid_amount === ''
    ? txAmountOf(corp.id, date)
    : toInt(String(b.paid_amount).replace(/[,\s원]/g, ''), '정산 금액');
  const paidAt = b.paid_at ? String(b.paid_at).replace('T', ' ').slice(0, 19) : nowStr();
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(paidAt)) throw bad('지급일시 형식이 올바르지 않습니다.');
  db.prepare(`
    INSERT INTO settlements (corporation_id, tx_date, paid_amount, paid_at, memo, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (corporation_id, tx_date) DO UPDATE SET paid_amount = excluded.paid_amount, paid_at = excluded.paid_at,
      memo = excluded.memo, updated_at = datetime('now','localtime')`)
    .run(corp.id, date, amount, paidAt.length === 16 ? `${paidAt}:00` : paidAt, b.memo || null, req.user.id);
  const row = settlementRows({ from: date, to: date, corporation_id: corp.id })[0];
  res.status(201).json(row);
}));

/** 거래일 하나의 미정산 법인 일괄 정산 (거래 금액 전액) */
router.post('/bulk', wrap((req, res) => {
  const date = dateParam(req.body?.tx_date, '거래일');
  if (!date) throw bad('거래일을 입력해 주세요.');
  const targets = settlementRows({ from: date, to: date }).filter((r) => r.status === 'UNPAID' || r.status === 'SCHEDULED' || r.status === 'PARTIAL');
  if (!targets.length) throw bad('정산할 대상이 없습니다.');
  const paidAt = nowStr();
  tx(() => {
    for (const r of targets) {
      db.prepare(`
        INSERT INTO settlements (corporation_id, tx_date, paid_amount, paid_at, memo, created_by) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (corporation_id, tx_date) DO UPDATE SET paid_amount = excluded.paid_amount, paid_at = excluded.paid_at,
          updated_at = datetime('now','localtime')`)
        .run(r.corporation_id, date, r.tx_amount, paidAt, '일괄 정산', req.user.id);
    }
  });
  res.status(201).json({ count: targets.length, amount: targets.reduce((s, r) => s + r.tx_amount, 0) });
}));

/** 정산 취소 */
router.delete('/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM settlements WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) throw notFound('정산 내역');
  res.json({ ok: true });
}));

export default router;
