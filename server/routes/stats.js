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
  return { from, to, params: [`${from} 00:00:00`, `${to} 23:59:59`] };
}

const AGG = `
  COUNT(CASE WHEN t.status='APPROVED' THEN 1 END) AS tx_count,
  COALESCE(SUM(CASE WHEN t.status='APPROVED' AND t.type='CHARGE' THEN t.amount END),0) AS charge,
  COALESCE(SUM(CASE WHEN t.status='APPROVED' AND t.type='PAYMENT' THEN t.amount END),0) AS payment,
  COALESCE(SUM(CASE WHEN t.status='APPROVED' AND t.type='REFUND' THEN t.amount END),0) AS refund,
  COALESCE(SUM(CASE WHEN t.status='APPROVED' THEN t.fee END),0) AS fee,
  COUNT(CASE WHEN t.status='CANCELLED' THEN 1 END) AS cancel_count`;

router.get('/summary', wrap((req, res) => {
  const { from, to, params } = range(req.query);
  const period = db.prepare(`SELECT ${AGG} FROM transactions t WHERE t.transacted_at BETWEEN ? AND ?`).get(...params);
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
  const group = req.query.unit === 'month' ? "substr(t.transacted_at,1,7)" : "substr(t.transacted_at,1,10)";
  const rows = db.prepare(`
    SELECT ${group} AS period, ${AGG}
    FROM transactions t WHERE t.transacted_at BETWEEN ? AND ?
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
    LEFT JOIN transactions t ON t.corporation_id = c.id AND t.transacted_at BETWEEN ? AND ?
    GROUP BY c.id ORDER BY payment DESC, charge DESC`).all(...params);
  res.json({ from, to, rows });
}));

router.get('/by-pg', wrap((req, res) => {
  const { from, to, params } = range(req.query);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.code, p.fee_rate, ${AGG}
    FROM pgs p
    LEFT JOIN transactions t ON t.pg_id = p.id AND t.transacted_at BETWEEN ? AND ?
    GROUP BY p.id ORDER BY payment DESC`).all(...params);
  res.json({ from, to, rows });
}));

export default router;
