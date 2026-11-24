import { Router } from 'express';
import { db } from '../db.js';
import { pick, requireFields, oneOf, paging, insertSql, updateSql, wrap, notFound, bad, columnFilters } from '../util.js';

const router = Router();
const FIELDS = ['name', 'code', 'mid', 'manager_name', 'manager_phone', 'status', 'memo'];

// 거래내역(수동 입력) 기준 누적 거래건수 / 총 금액
const TX_COUNT = '(SELECT COALESCE(SUM(tx_count),0) FROM tx_records WHERE pg_id = p.id)';
const PAY_SUM = '(SELECT COALESCE(SUM(total_amount),0) FROM tx_records WHERE pg_id = p.id)';
const CORP_COUNT = '(SELECT COUNT(*) FROM corporation_pgs WHERE pg_id = p.id)';
const COLUMN_FILTERS = {
  id: { sql: 'p.id', num: true }, name: 'p.name', code: 'p.code', mid: 'p.mid',
  tx_count: { sql: TX_COUNT, num: true }, payment_amount: { sql: PAY_SUM, num: true },
  manager_name: 'p.manager_name', status: { sql: 'p.status', exact: true }, corporation_count: { sql: CORP_COUNT, num: true },
};

function validate(data, isCreate) {
  if (isCreate) requireFields(data, { name: 'PG사명', code: 'PG 코드' });
  if (data.code) data.code = String(data.code).toUpperCase();
  oneOf(data.status, ['ACTIVE', 'INACTIVE'], '상태');
}

router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.mid LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  if (req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
  columnFilters(req.query, COLUMN_FILTERS, where, params);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM pgs p ${w}`).get(...params).n;
  const rows = db.prepare(`
    SELECT p.*, ${TX_COUNT} AS tx_count, ${PAY_SUM} AS payment_amount, ${CORP_COUNT} AS corporation_count
    FROM pgs p ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size });
}));

router.get('/options', (req, res) => {
  res.json(db.prepare('SELECT id, name, code, mid, status FROM pgs ORDER BY name').all());
});

router.get('/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM pgs WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('PG');
  res.json(row);
}));

router.post('/', wrap((req, res) => {
  const data = pick(req.body, FIELDS);
  validate(data, true);
  if (db.prepare('SELECT 1 FROM pgs WHERE code = ?').get(data.code)) throw bad('이미 사용 중인 PG 코드입니다.');
  const { sql, params } = insertSql('pgs', data);
  const r = db.prepare(sql).run(...params);
  res.status(201).json(db.prepare('SELECT * FROM pgs WHERE id = ?').get(r.lastInsertRowid));
}));

router.put('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM pgs WHERE id = ?').get(id)) throw notFound('PG');
  const data = pick(req.body, FIELDS);
  validate(data, false);
  if (data.code && db.prepare('SELECT 1 FROM pgs WHERE code = ? AND id != ?').get(data.code, id)) {
    throw bad('이미 사용 중인 PG 코드입니다.');
  }
  if (Object.keys(data).length) {
    const { sql, params } = updateSql('pgs', data, id);
    db.prepare(sql).run(...params);
  }
  res.json(db.prepare('SELECT * FROM pgs WHERE id = ?').get(id));
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM transactions WHERE pg_id = ?').get(id).n
    + db.prepare('SELECT COUNT(*) n FROM tx_records WHERE pg_id = ?').get(id).n;
  if (used) throw bad(`거래내역(${used}건)이 있어 삭제할 수 없습니다. 비활성화를 이용하세요.`);
  const r = db.prepare('DELETE FROM pgs WHERE id = ?').run(id);
  if (!r.changes) throw notFound('PG');
  res.json({ ok: true });
}));

export default router;
