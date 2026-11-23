import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { createTransaction } from '../ledger.js';
import { pick, requireFields, oneOf, paging, insertSql, updateSql, wrap, notFound, bad, toInt } from '../util.js';

const router = Router();
const STATUSES = ['ACTIVE', 'SUSPENDED', 'LOST', 'EXPIRED'];

export function generateCardNo() {
  for (;;) {
    let no = '9410';
    for (let i = 0; i < 12; i++) no += crypto.randomInt(0, 10);
    if (!db.prepare('SELECT 1 FROM cards WHERE card_no = ?').get(no)) return no;
  }
}

const SELECT = `
  SELECT k.*, c.name AS corporation_name
  FROM cards k JOIN corporations c ON c.id = k.corporation_id`;

router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(k.card_no LIKE ? OR k.holder_name LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q);
  }
  if (req.query.corporation_id) { where.push('k.corporation_id = ?'); params.push(req.query.corporation_id); }
  if (req.query.status) { where.push('k.status = ?'); params.push(req.query.status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM cards k ${w}`).get(...params).n;
  const sum = db.prepare(`SELECT COALESCE(SUM(k.balance),0) s FROM cards k ${w}`).get(...params).s;
  const rows = db.prepare(`${SELECT} ${w} ORDER BY k.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size, totalBalance: sum });
}));

router.get('/options', (req, res) => {
  res.json(db.prepare(`
    SELECT k.id, k.card_no, k.holder_name, k.balance, k.status, c.name AS corporation_name
    FROM cards k JOIN corporations c ON c.id = k.corporation_id ORDER BY k.id DESC`).all());
});

router.get('/:id', wrap((req, res) => {
  const row = db.prepare(`${SELECT} WHERE k.id = ?`).get(req.params.id);
  if (!row) throw notFound('선불카드');
  res.json(row);
}));

/** 카드 발급 (초기 충전 금액 옵션) */
router.post('/', wrap((req, res) => {
  const data = pick(req.body, ['corporation_id', 'holder_name', 'limit_amount', 'expires_at', 'memo']);
  requireFields(data, { corporation_id: '법인', holder_name: '사용자명' });
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(data.corporation_id);
  if (!corp) throw notFound('법인');
  if (corp.status !== 'ACTIVE') throw bad('비활성화된 법인에는 카드를 발급할 수 없습니다.');
  data.limit_amount = data.limit_amount ? toInt(data.limit_amount, '충전 한도') : 0;
  data.card_no = generateCardNo();
  data.issued_at = new Date().toISOString().slice(0, 10);
  if (!data.expires_at) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 5);
    data.expires_at = d.toISOString().slice(0, 10);
  }
  const { sql, params } = insertSql('cards', data);
  const id = Number(db.prepare(sql).run(...params).lastInsertRowid);

  const initial = Number(req.body.initial_amount || 0);
  if (initial > 0) {
    try {
      createTransaction({ card_id: id, type: 'CHARGE', amount: initial, memo: '발급 시 초기 충전', created_by: req.user.id });
    } catch (e) {
      db.prepare('DELETE FROM cards WHERE id = ?').run(id);
      throw e;
    }
  }
  res.status(201).json(db.prepare(`${SELECT} WHERE k.id = ?`).get(id));
}));

router.put('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM cards WHERE id = ?').get(id)) throw notFound('선불카드');
  const data = pick(req.body, ['holder_name', 'limit_amount', 'status', 'expires_at', 'memo']);
  oneOf(data.status, STATUSES, '카드 상태');
  if (data.limit_amount !== undefined) data.limit_amount = data.limit_amount ? toInt(data.limit_amount, '충전 한도') : 0;
  if (Object.keys(data).length) {
    const { sql, params } = updateSql('cards', data, id);
    db.prepare(sql).run(...params);
  }
  res.json(db.prepare(`${SELECT} WHERE k.id = ?`).get(id));
}));

/** 충전 */
router.post('/:id/charge', wrap((req, res) => {
  const txId = createTransaction({
    card_id: Number(req.params.id),
    pg_id: req.body.pg_id || null,
    type: 'CHARGE',
    amount: req.body.amount,
    memo: req.body.memo,
    created_by: req.user.id,
  });
  res.status(201).json({ transaction_id: txId, card: db.prepare(`${SELECT} WHERE k.id = ?`).get(req.params.id) });
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM transactions WHERE card_id = ?').get(id).n;
  if (used) throw bad(`거래내역(${used}건)이 있어 삭제할 수 없습니다. 상태 변경(정지/분실)을 이용하세요.`);
  const r = db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  if (!r.changes) throw notFound('선불카드');
  res.json({ ok: true });
}));

export default router;
