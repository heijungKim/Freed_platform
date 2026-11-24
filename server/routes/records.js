/**
 * 거래내역 (수동 입력)
 * 관리자가 날짜·법인(·PG)별 거래건수와 총 금액을 직접 입력한다.
 */
import { Router } from 'express';
import { db, tx } from '../db.js';
import { paging, wrap, notFound, bad, dateParam, csvEscape, columnFilters, toInt } from '../util.js';
import { allocateRecord, revertAllocation, addAllocation, updateAllocation, removeAllocation } from '../allocation.js';

const router = Router();

const ALLOC_COUNT = "(SELECT COUNT(*) FROM transactions WHERE record_id = r.id AND status = 'APPROVED')";
const ALLOC_AMOUNT = "(SELECT COALESCE(SUM(amount),0) FROM transactions WHERE record_id = r.id AND status = 'APPROVED')";
const ALLOC_CARDS = "(SELECT COUNT(DISTINCT card_id) FROM transactions WHERE record_id = r.id AND status = 'APPROVED')";

const SELECT = `
  SELECT r.*, c.name AS corporation_name, p.name AS pg_name, u.name AS created_by_name,
    ${ALLOC_COUNT} AS alloc_count, ${ALLOC_AMOUNT} AS alloc_amount, ${ALLOC_CARDS} AS alloc_cards
  FROM tx_records r
  JOIN corporations c ON c.id = r.corporation_id
  LEFT JOIN pgs p ON p.id = r.pg_id
  LEFT JOIN users u ON u.id = r.created_by`;

const COLUMN_FILTERS = {
  record_date: 'r.record_date', corporation_name: 'c.name', pg_name: 'p.name',
  tx_count: { sql: 'r.tx_count', num: true }, total_amount: { sql: 'r.total_amount', num: true },
  memo: 'r.memo', created_by_name: 'u.name',
};

function buildFilter(q) {
  const where = [];
  const params = [];
  const from = dateParam(q.from, '시작일');
  const to = dateParam(q.to, '종료일');
  if (from) { where.push('r.record_date >= ?'); params.push(from); }
  if (to) { where.push('r.record_date <= ?'); params.push(to); }
  if (q.corporation_id) { where.push('r.corporation_id = ?'); params.push(q.corporation_id); }
  if (q.pg_id) { where.push('r.pg_id = ?'); params.push(q.pg_id); }
  if (q.q) {
    where.push('(c.name LIKE ? OR r.memo LIKE ?)');
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  columnFilters(q, COLUMN_FILTERS, where, params);
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** 입력 내역 목록 */
router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const { w, params } = buildFilter(req.query);
  const base = `FROM tx_records r JOIN corporations c ON c.id = r.corporation_id
    LEFT JOIN pgs p ON p.id = r.pg_id LEFT JOIN users u ON u.id = r.created_by ${w}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...params).n;
  const summary = db.prepare(`
    SELECT COALESCE(SUM(r.tx_count),0) AS tx_count, COALESCE(SUM(r.total_amount),0) AS total_amount,
      COUNT(DISTINCT r.corporation_id) AS corporations ${base}`).get(...params);
  const rows = db.prepare(`${SELECT} ${w} ORDER BY r.record_date DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size, summary });
}));

/** 법인별 합계 (기간 내 입력이 없는 활성 법인도 0으로 표시) */
router.get('/by-corporation', wrap((req, res) => {
  const from = dateParam(req.query.from, '시작일');
  const to = dateParam(req.query.to, '종료일');
  const cond = ['r.corporation_id = c.id'];
  const params = [];
  if (from) { cond.push('r.record_date >= ?'); params.push(from); }
  if (to) { cond.push('r.record_date <= ?'); params.push(to); }
  if (req.query.pg_id) { cond.push('r.pg_id = ?'); params.push(req.query.pg_id); }
  const rows = db.prepare(`
    SELECT c.id AS corporation_id, c.name AS corporation_name, c.status,
      COALESCE(SUM(r.tx_count),0) AS tx_count,
      COALESCE(SUM(r.total_amount),0) AS total_amount,
      COUNT(r.id) AS entries,
      MAX(r.record_date) AS last_date
    FROM corporations c
    LEFT JOIN tx_records r ON ${cond.join(' AND ')}
    GROUP BY c.id
    HAVING c.status = 'ACTIVE' OR COUNT(r.id) > 0
    ORDER BY total_amount DESC, c.name`).all(...params);
  const summary = rows.reduce((s, r) => ({
    tx_count: s.tx_count + r.tx_count, total_amount: s.total_amount + r.total_amount, entries: s.entries + r.entries,
  }), { tx_count: 0, total_amount: 0, entries: 0 });
  res.json({ rows, summary });
}));

router.get('/export.csv', wrap((req, res) => {
  const { w, params } = buildFilter(req.query);
  const rows = db.prepare(`${SELECT} ${w} ORDER BY r.record_date DESC, r.id DESC LIMIT 100000`).all(...params);
  const header = ['ID', '거래일', '법인', 'PG', '거래건수', '총 금액', '메모', '입력자', '입력일시'];
  const lines = rows.map((r) => [
    r.id, r.record_date, r.corporation_name, r.pg_name, r.tx_count, r.total_amount, r.memo, r.created_by_name, r.created_at,
  ].map(csvEscape).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tx_records_${Date.now()}.csv"`);
  res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
}));

function validItem(item, i) {
  const label = (f) => (i === undefined ? f : `${i + 1}번째 줄 ${f}`);
  if (!item.corporation_id) throw bad(`${label('법인')}을(를) 선택해 주세요.`);
  const corp = db.prepare('SELECT id FROM corporations WHERE id = ?').get(item.corporation_id);
  if (!corp) throw notFound('법인');
  const clean = (v) => (typeof v === 'string' ? v.replace(/[,\s원]/g, '') : v);
  return {
    corporation_id: Number(item.corporation_id),
    tx_count: toInt(clean(item.tx_count), label('거래건수')),
    total_amount: toInt(clean(item.total_amount), label('총 금액')),
    memo: item.memo ? String(item.memo).slice(0, 500) : null,
  };
}

function validPg(pgId) {
  if (!pgId) return null;
  if (!db.prepare('SELECT 1 FROM pgs WHERE id = ?').get(pgId)) throw notFound('PG');
  return Number(pgId);
}

/**
 * 입력 (여러 법인 한 번에)
 * body: { record_date, pg_id?, allocate?: true, items: [{ corporation_id, tx_count, total_amount, memo }] }
 * allocate=true(기본) 이면 각 법인의 정상 카드에 충전 거래로 자동 배분 (건수·합계 일치)
 */
router.post('/', wrap((req, res) => {
  const b = req.body || {};
  const date = dateParam(b.record_date, '거래일');
  if (!date) throw bad('거래일을 입력해 주세요.');
  const pgId = validPg(b.pg_id);
  const allocate = b.allocate !== false && b.allocate !== 'false';
  const items = Array.isArray(b.items) ? b.items : [b];
  if (!items.length) throw bad('입력할 내용이 없습니다.');
  const clean = items.map(validItem);
  const result = tx(() => clean.map((it) => {
    const id = Number(db.prepare(`
      INSERT INTO tx_records (record_date, corporation_id, pg_id, tx_count, total_amount, memo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(date, it.corporation_id, pgId, it.tx_count, it.total_amount, it.memo, req.user.id).lastInsertRowid);
    const alloc = allocate ? allocateRecord({ id, record_date: date, pg_id: pgId, ...it }, req.user.id) : null;
    return { id, alloc };
  }));
  res.status(201).json({
    ids: result.map((r) => r.id),
    count: result.length,
    allocated: result.reduce((s, r) => s + (r.alloc?.count || 0), 0),
    allocated_amount: result.reduce((s, r) => s + (r.alloc?.amount || 0), 0),
  });
}));

/** 배분된 카드 충전 내역 */
router.get('/:id/allocations', wrap((req, res) => {
  const id = Number(req.params.id);
  const record = db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
  if (!record) throw notFound('거래내역');
  const rows = db.prepare(`
    SELECT t.id, t.card_id, t.amount, t.transacted_at, t.approval_no, t.memo, k.card_no, k.holder_name, i.name AS issuer_name
    FROM transactions t JOIN cards k ON k.id = t.card_id LEFT JOIN issuers i ON i.id = k.issuer_id
    WHERE t.record_id = ? AND t.status = 'APPROVED' ORDER BY t.transacted_at, t.id`).all(id);
  const byCard = new Map();
  for (const t of rows) {
    const c = byCard.get(t.card_id) || { card_id: t.card_id, card_no: t.card_no, holder_name: t.holder_name, issuer_name: t.issuer_name, count: 0, amount: 0 };
    c.count += 1;
    c.amount += t.amount;
    byCard.set(t.card_id, c);
  }
  const corpCards = db.prepare(`SELECT k.id, k.card_no, k.holder_name, k.balance, k.limit_amount, k.status
    FROM cards k WHERE k.corporation_id = ? ORDER BY k.status = 'ACTIVE' DESC, k.id`).all(record.corporation_id);
  res.json({ record, rows, cards: [...byCard.values()].sort((a, b) => b.amount - a.amount), corp_cards: corpCards });
}));

/** 배분 충전 개별 편집 — 입력의 거래건수/총 금액이 배분 합계로 자동 갱신됨 */
function loadRecord(id) {
  const r = db.prepare('SELECT * FROM tx_records WHERE id = ?').get(Number(id));
  if (!r) throw notFound('거래내역');
  return r;
}
const recordOut = (id) => db.prepare(`${SELECT} WHERE r.id = ?`).get(id);

router.post('/:id/allocations', wrap((req, res) => {
  const rec = loadRecord(req.params.id);
  tx(() => addAllocation(rec, req.body || {}, req.user.id));
  res.status(201).json(recordOut(rec.id));
}));

router.put('/:id/allocations/:txId', wrap((req, res) => {
  const rec = loadRecord(req.params.id);
  tx(() => updateAllocation(rec, Number(req.params.txId), req.body || {}));
  res.json(recordOut(rec.id));
}));

router.delete('/:id/allocations/:txId', wrap((req, res) => {
  const rec = loadRecord(req.params.id);
  tx(() => removeAllocation(rec, Number(req.params.txId)));
  res.json(recordOut(rec.id));
}));

router.put('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
  if (!cur) throw notFound('거래내역');
  const b = req.body || {};
  const date = dateParam(b.record_date, '거래일');
  if (!date) throw bad('거래일을 입력해 주세요.');
  const it = validItem(b);
  const pgId = validPg(b.pg_id);
  // 배분 여부: 지정 없으면 기존 상태 유지
  const allocate = b.allocate === undefined ? cur.alloc_count > 0 : b.allocate !== false && b.allocate !== 'false';
  tx(() => {
    revertAllocation(id);
    db.prepare(`UPDATE tx_records SET record_date = ?, corporation_id = ?, pg_id = ?, tx_count = ?, total_amount = ?, memo = ?,
      updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(date, it.corporation_id, pgId, it.tx_count, it.total_amount, it.memo, id);
    if (allocate) allocateRecord({ id, record_date: date, pg_id: pgId, ...it }, req.user.id);
  });
  res.json(db.prepare(`${SELECT} WHERE r.id = ?`).get(id));
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM tx_records WHERE id = ?').get(id)) throw notFound('거래내역');
  const cancelled = tx(() => {
    const n = revertAllocation(id);
    db.prepare('DELETE FROM tx_records WHERE id = ?').run(id);
    return n;
  });
  res.json({ ok: true, cancelled });
}));

export default router;
