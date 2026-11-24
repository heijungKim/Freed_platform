import { Router } from 'express';
import { db, tx } from '../db.js';
import { pick, requireFields, oneOf, paging, insertSql, updateSql, wrap, notFound, bad, columnFilters } from '../util.js';

const router = Router();
const FIELDS = ['name', 'biz_no', 'ceo_name', 'phone', 'email', 'address', 'contract_date', 'status', 'memo'];
const CARD_COUNT = '(SELECT COUNT(*) FROM cards WHERE corporation_id = c.id)';
const CARD_BALANCE = '(SELECT COALESCE(SUM(balance),0) FROM cards WHERE corporation_id = c.id)';
const PG_NAMES = `(SELECT GROUP_CONCAT(name, ', ') FROM (SELECT p.name FROM corporation_pgs cp JOIN pgs p ON p.id = cp.pg_id
  WHERE cp.corporation_id = c.id ORDER BY p.name))`;
const PG_IDS = '(SELECT GROUP_CONCAT(pg_id) FROM corporation_pgs WHERE corporation_id = c.id)';
const COLUMN_FILTERS = {
  id: { sql: 'c.id', num: true }, name: 'c.name', biz_no: 'c.biz_no', ceo_name: 'c.ceo_name', phone: 'c.phone',
  card_count: { sql: CARD_COUNT, num: true }, total_balance: { sql: CARD_BALANCE, num: true },
  contract_date: 'c.contract_date', status: { sql: 'c.status', exact: true }, pg_names: PG_NAMES,
};
const BIZ_NO_RE = /^\d{3}-\d{2}-\d{5}$/;

function validate(data, isCreate) {
  if (isCreate) requireFields(data, { name: '법인명', biz_no: '사업자등록번호' });
  if (data.biz_no && !BIZ_NO_RE.test(data.biz_no)) throw bad('사업자등록번호 형식은 000-00-00000 입니다.');
  oneOf(data.status, ['ACTIVE', 'INACTIVE'], '상태');
}

router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(c.name LIKE ? OR c.biz_no LIKE ? OR c.ceo_name LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  columnFilters(req.query, COLUMN_FILTERS, where, params);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM corporations c ${w}`).get(...params).n;
  const rows = db.prepare(`
    SELECT c.*, ${CARD_COUNT} AS card_count, ${CARD_BALANCE} AS total_balance, ${PG_NAMES} AS pg_names, ${PG_IDS} AS pg_ids
    FROM corporations c ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size });
}));

router.get('/options', (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.name, c.status, ${CARD_COUNT} AS card_count,
    (SELECT COUNT(*) FROM cards WHERE corporation_id = c.id AND status = 'ACTIVE') AS active_card_count,
    (SELECT CASE WHEN SUM(CASE WHEN limit_amount = 0 THEN 1 ELSE 0 END) > 0 THEN -1
      ELSE COALESCE(SUM(MAX(limit_amount - balance, 0)), 0) END
     FROM cards WHERE corporation_id = c.id AND status = 'ACTIVE') AS charge_room
    FROM corporations c ORDER BY c.name`).all());
});

const getOne = (id) => db.prepare(`SELECT c.*, ${PG_NAMES} AS pg_names, ${PG_IDS} AS pg_ids FROM corporations c WHERE c.id = ?`).get(id);

/** 사용 PG 저장 (전체 교체) */
function savePgs(corpId, pgIds) {
  if (pgIds === undefined) return;
  const ids = [...new Set((Array.isArray(pgIds) ? pgIds : String(pgIds || '').split(','))
    .map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
  for (const id of ids) if (!db.prepare('SELECT 1 FROM pgs WHERE id = ?').get(id)) throw notFound('PG');
  tx(() => {
    db.prepare('DELETE FROM corporation_pgs WHERE corporation_id = ?').run(corpId);
    const ins = db.prepare('INSERT INTO corporation_pgs (corporation_id, pg_id) VALUES (?, ?)');
    for (const id of ids) ins.run(corpId, id);
  });
}

router.get('/:id', wrap((req, res) => {
  const row = getOne(req.params.id);
  if (!row) throw notFound('법인');
  res.json(row);
}));

/** 법인의 PG별 사용 현황: 사용 PG로 지정됐거나 거래내역이 있는 PG */
router.get('/:id/pg-usage', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM corporations WHERE id = ?').get(id)) throw notFound('법인');
  const rows = db.prepare(`
    SELECT p.id, p.name, p.code, p.mid, p.status,
      EXISTS (SELECT 1 FROM corporation_pgs WHERE corporation_id = ? AND pg_id = p.id) AS linked,
      COALESCE(SUM(r.tx_count),0) AS tx_count, COALESCE(SUM(r.total_amount),0) AS total_amount,
      MAX(r.record_date) AS last_date
    FROM pgs p
    LEFT JOIN tx_records r ON r.pg_id = p.id AND r.corporation_id = ?
    GROUP BY p.id
    HAVING linked OR COUNT(r.id) > 0
    ORDER BY linked DESC, total_amount DESC`).all(id, id);
  res.json(rows);
}));

router.post('/', wrap((req, res) => {
  const data = pick(req.body, FIELDS);
  validate(data, true);
  if (db.prepare('SELECT 1 FROM corporations WHERE biz_no = ?').get(data.biz_no)) throw bad('이미 등록된 사업자등록번호입니다.');
  const { sql, params } = insertSql('corporations', data);
  const r = db.prepare(sql).run(...params);
  savePgs(Number(r.lastInsertRowid), req.body.pg_ids);
  res.status(201).json(getOne(r.lastInsertRowid));
}));

router.put('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM corporations WHERE id = ?').get(id)) throw notFound('법인');
  const data = pick(req.body, FIELDS);
  validate(data, false);
  if (data.biz_no && db.prepare('SELECT 1 FROM corporations WHERE biz_no = ? AND id != ?').get(data.biz_no, id)) {
    throw bad('이미 등록된 사업자등록번호입니다.');
  }
  if (Object.keys(data).length) {
    const { sql, params } = updateSql('corporations', data, id);
    db.prepare(sql).run(...params);
  }
  savePgs(id, req.body.pg_ids);
  res.json(getOne(id));
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM cards WHERE corporation_id = ?').get(id).n;
  if (used) throw bad(`발급된 선불카드(${used}건)가 있어 삭제할 수 없습니다. 비활성화를 이용하세요.`);
  const recs = db.prepare('SELECT COUNT(*) n FROM tx_records WHERE corporation_id = ?').get(id).n;
  if (recs) throw bad(`입력된 거래내역(${recs}건)이 있어 삭제할 수 없습니다. 비활성화를 이용하세요.`);
  db.prepare('DELETE FROM settlements WHERE corporation_id = ?').run(id);
  const r = db.prepare('DELETE FROM corporations WHERE id = ?').run(id);
  if (!r.changes) throw notFound('법인');
  res.json({ ok: true });
}));

export default router;
