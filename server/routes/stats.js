/**
 * 집계: 수동 입력된 거래내역(tx_records) 기준
 */
import { Router } from 'express';
import { db } from '../db.js';
import { wrap, dateParam } from '../util.js';

const router = Router();

function range(q) {
  const today = new Date();
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const def = new Date(today);
  def.setDate(def.getDate() - 29);
  const from = dateParam(q.from, '시작일') || fmt(def);
  const to = dateParam(q.to, '종료일') || fmt(today);
  return { from, to, params: [from, to] };
}

/** PG 수수료 = 총 금액 × PG 수수료율 (PG 미지정 입력은 0) */
const FEE = 'COALESCE(ROUND(r.total_amount * p.fee_rate / 100.0), 0)';
const AGG = `
  COALESCE(SUM(r.tx_count),0) AS tx_count,
  COALESCE(SUM(r.total_amount),0) AS total_amount,
  CAST(COALESCE(SUM(${FEE}),0) AS INTEGER) AS fee,
  COUNT(r.id) AS entries`;

router.get('/summary', wrap((req, res) => {
  const { from, to, params } = range(req.query);
  const period = db.prepare(`
    SELECT ${AGG}, COUNT(DISTINCT r.corporation_id) AS corporations_with_records
    FROM tx_records r LEFT JOIN pgs p ON p.id = r.pg_id
    WHERE r.record_date BETWEEN ? AND ?`).get(...params);
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM corporations WHERE status='ACTIVE') AS active_corporations,
      (SELECT COUNT(*) FROM corporations) AS corporations,
      (SELECT COUNT(*) FROM pgs WHERE status='ACTIVE') AS active_pgs,
      (SELECT COUNT(*) FROM cards WHERE status='ACTIVE') AS active_cards,
      (SELECT COUNT(*) FROM cards) AS cards,
      (SELECT COALESCE(SUM(balance),0) FROM cards) AS total_balance`).get();
  res.json({ from, to, period, totals });
}));

router.get('/daily', wrap((req, res) => {
  const { from, to, params } = range(req.query);
  const group = req.query.unit === 'month' ? 'substr(r.record_date,1,7)' : 'r.record_date';
  const rows = db.prepare(`
    SELECT ${group} AS period, ${AGG}
    FROM tx_records r LEFT JOIN pgs p ON p.id = r.pg_id
    WHERE r.record_date BETWEEN ? AND ?
    GROUP BY period ORDER BY period`).all(...params);
  res.json({ from, to, rows });
}));

router.get('/by-corporation', wrap((req, res) => {
  const { from, to, params } = range(req.query);
  const rows = db.prepare(`
    SELECT c.id, c.name, ${AGG},
      (SELECT COUNT(*) FROM cards WHERE corporation_id = c.id) AS card_count,
      (SELECT COALESCE(SUM(balance),0) FROM cards WHERE corporation_id = c.id) AS balance
    FROM corporations c
    LEFT JOIN tx_records r ON r.corporation_id = c.id AND r.record_date BETWEEN ? AND ?
    LEFT JOIN pgs p ON p.id = r.pg_id
    GROUP BY c.id ORDER BY total_amount DESC, c.name`).all(...params);
  res.json({ from, to, rows });
}));

router.get('/by-pg', wrap((req, res) => {
  const { from, to, params } = range(req.query);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.code, p.fee_rate, ${AGG}
    FROM pgs p
    LEFT JOIN tx_records r ON r.pg_id = p.id AND r.record_date BETWEEN ? AND ?
    GROUP BY p.id ORDER BY total_amount DESC`).all(...params);
  res.json({ from, to, rows });
}));

export default router;
