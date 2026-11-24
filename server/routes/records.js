/**
 * 거래내역 (수동 입력)
 * 관리자가 날짜·법인(·PG)별 거래건수와 총 금액을 직접 입력한다.
 */
import { Router } from 'express';
import { db, tx } from '../db.js';
import { paging, wrap, notFound, bad, dateParam, csvEscape, columnFilters, toInt } from '../util.js';

const router = Router();

const SELECT = `
  SELECT r.*, c.name AS corporation_name, p.name AS pg_name, p.fee_rate, u.name AS created_by_name
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

/** 입력 (여러 법인 한 번에) — body: { record_date, pg_id?, items: [{ corporation_id, tx_count, total_amount, memo }] } */
router.post('/', wrap((req, res) => {
  const b = req.body || {};
  const date = dateParam(b.record_date, '거래일');
  if (!date) throw bad('거래일을 입력해 주세요.');
  const pgId = validPg(b.pg_id);
  const items = Array.isArray(b.items) ? b.items : [b];
  if (!items.length) throw bad('입력할 내용이 없습니다.');
  const clean = items.map(validItem);
  const ids = tx(() => clean.map((it) => Number(db.prepare(`
    INSERT INTO tx_records (record_date, corporation_id, pg_id, tx_count, total_amount, memo, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(date, it.corporation_id, pgId, it.tx_count, it.total_amount, it.memo, req.user.id).lastInsertRowid)));
  res.status(201).json({ ids, count: ids.length });
}));

router.put('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM tx_records WHERE id = ?').get(id)) throw notFound('거래내역');
  const b = req.body || {};
  const date = dateParam(b.record_date, '거래일');
  if (!date) throw bad('거래일을 입력해 주세요.');
  const it = validItem(b);
  db.prepare(`UPDATE tx_records SET record_date = ?, corporation_id = ?, pg_id = ?, tx_count = ?, total_amount = ?, memo = ?,
    updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(date, it.corporation_id, validPg(b.pg_id), it.tx_count, it.total_amount, it.memo, id);
  res.json(db.prepare(`${SELECT} WHERE r.id = ?`).get(id));
}));

router.delete('/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM tx_records WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) throw notFound('거래내역');
  res.json({ ok: true });
}));

export default router;
