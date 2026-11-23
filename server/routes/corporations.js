import { Router } from 'express';
import { db } from '../db.js';
import { pick, requireFields, oneOf, paging, insertSql, updateSql, wrap, notFound, bad } from '../util.js';

const router = Router();
const FIELDS = ['name', 'biz_no', 'ceo_name', 'phone', 'email', 'address', 'contract_date', 'status', 'memo'];
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
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM corporations c ${w}`).get(...params).n;
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM cards WHERE corporation_id = c.id) AS card_count,
      (SELECT COALESCE(SUM(balance),0) FROM cards WHERE corporation_id = c.id) AS total_balance
    FROM corporations c ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size });
}));

router.get('/options', (req, res) => {
  res.json(db.prepare('SELECT id, name, status FROM corporations ORDER BY name').all());
});

router.get('/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM corporations WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('법인');
  res.json(row);
}));

router.post('/', wrap((req, res) => {
  const data = pick(req.body, FIELDS);
  validate(data, true);
  if (db.prepare('SELECT 1 FROM corporations WHERE biz_no = ?').get(data.biz_no)) throw bad('이미 등록된 사업자등록번호입니다.');
  const { sql, params } = insertSql('corporations', data);
  const r = db.prepare(sql).run(...params);
  res.status(201).json(db.prepare('SELECT * FROM corporations WHERE id = ?').get(r.lastInsertRowid));
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
  res.json(db.prepare('SELECT * FROM corporations WHERE id = ?').get(id));
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM cards WHERE corporation_id = ?').get(id).n;
  if (used) throw bad(`발급된 선불카드(${used}건)가 있어 삭제할 수 없습니다. 비활성화를 이용하세요.`);
  const r = db.prepare('DELETE FROM corporations WHERE id = ?').run(id);
  if (!r.changes) throw notFound('법인');
  res.json({ ok: true });
}));

export default router;
