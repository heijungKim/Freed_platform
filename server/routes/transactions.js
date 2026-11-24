import { Router } from 'express';
import { db } from '../db.js';
import { createTransaction, cancelTransaction } from '../ledger.js';
import { paging, wrap, notFound, dateParam, csvEscape, requireFields, columnFilters } from '../util.js';

const router = Router();

const SELECT = `
  SELECT t.*, k.card_no, k.holder_name, c.name AS corporation_name, p.name AS pg_name, u.name AS created_by_name
  FROM transactions t
  JOIN cards k ON k.id = t.card_id
  JOIN corporations c ON c.id = t.corporation_id
  LEFT JOIN pgs p ON p.id = t.pg_id
  LEFT JOIN users u ON u.id = t.created_by`;

const COLUMN_FILTERS = {
  transacted_at: 't.transacted_at', approval_no: 't.approval_no', type: { sql: 't.type', exact: true },
  corporation_name: 'c.name', card: "k.card_no || ' ' || k.holder_name", pg_name: 'p.name', card_no: 'k.card_no', holder_name: 'k.holder_name',
  merchant_name: 't.merchant_name', amount: { sql: 't.amount', num: true }, fee: { sql: 't.fee', num: true },
  status: { sql: 't.status', exact: true },
};

function buildFilter(q) {
  const where = [];
  const params = [];
  const from = dateParam(q.from, '시작일');
  const to = dateParam(q.to, '종료일');
  if (from) { where.push('t.transacted_at >= ?'); params.push(`${from} 00:00:00`); }
  if (to) { where.push('t.transacted_at <= ?'); params.push(`${to} 23:59:59`); }
  if (q.records_only === '1' || q.records_only === 'true') where.push('t.record_id IS NOT NULL');
  if (q.record_id) { where.push('t.record_id = ?'); params.push(q.record_id); }
  for (const key of ['corporation_id', 'pg_id', 'card_id', 'type', 'status']) {
    if (q[key]) { where.push(`t.${key} = ?`); params.push(q[key]); }
  }
  if (q.q) {
    where.push('(t.approval_no LIKE ? OR t.merchant_name LIKE ? OR k.card_no LIKE ? OR k.holder_name LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like, like);
  }
  columnFilters(q, COLUMN_FILTERS, where, params);
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const { w, params } = buildFilter(req.query);
  const base = `FROM transactions t JOIN cards k ON k.id = t.card_id JOIN corporations c ON c.id = t.corporation_id
    LEFT JOIN pgs p ON p.id = t.pg_id ${w}`;
  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...params).n;
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.status='APPROVED' AND t.type='CHARGE' THEN t.amount END),0) AS charge,
      COALESCE(SUM(CASE WHEN t.status='APPROVED' AND t.type='PAYMENT' THEN t.amount END),0) AS payment,
      COALESCE(SUM(CASE WHEN t.status='APPROVED' AND t.type='REFUND' THEN t.amount END),0) AS refund,
      COALESCE(SUM(CASE WHEN t.status='APPROVED' THEN t.fee END),0) AS fee
    ${base}`).get(...params);
  const rows = db.prepare(`${SELECT} ${w} ORDER BY t.transacted_at DESC, t.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size, summary });
}));

router.get('/export.csv', wrap((req, res) => {
  const { w, params } = buildFilter(req.query);
  const rows = db.prepare(`${SELECT} ${w} ORDER BY t.transacted_at DESC, t.id DESC LIMIT 100000`).all(...params);
  const TYPE = { CHARGE: '충전', PAYMENT: '결제', REFUND: '환불' };
  const STATUS = { APPROVED: '승인', CANCELLED: '취소', FAILED: '실패' };
  const header = ['거래ID', '거래일시', '승인번호', '유형', '상태', '법인', '카드번호', '사용자', 'PG', '가맹점', '금액', '수수료', '메모'];
  const lines = rows.map((r) => [
    r.id, r.transacted_at, r.approval_no, TYPE[r.type], STATUS[r.status], r.corporation_name, r.card_no,
    r.holder_name, r.pg_name, r.merchant_name, r.amount, r.fee, r.memo,
  ].map(csvEscape).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions_${Date.now()}.csv"`);
  res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
}));

router.get('/:id', wrap((req, res) => {
  const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id);
  if (!row) throw notFound('거래');
  res.json(row);
}));

/** 수기 거래 등록 (충전/결제/환불) */
router.post('/', wrap((req, res) => {
  const b = req.body || {};
  requireFields(b, { card_id: '카드', type: '거래 유형', amount: '금액' });
  const id = createTransaction({
    card_id: Number(b.card_id),
    pg_id: b.pg_id ? Number(b.pg_id) : null,
    type: b.type,
    amount: b.amount,
    merchant_name: b.merchant_name || null,
    memo: b.memo || null,
    created_by: req.user.id,
  });
  res.status(201).json(db.prepare(`${SELECT} WHERE t.id = ?`).get(id));
}));

router.post('/:id/cancel', wrap((req, res) => {
  cancelTransaction(Number(req.params.id));
  res.json(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id));
}));

export default router;
