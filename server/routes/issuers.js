/**
 * 선불사업자 (선불전자지급수단 발행업자) 관리
 */
import { Router } from 'express';
import { db } from '../db.js';
import { pick, requireFields, oneOf, paging, insertSql, updateSql, wrap, notFound, bad, toInt, columnFilters } from '../util.js';

const router = Router();
const FIELDS = ['name', 'biz_no', 'reg_no', 'ceo_name', 'phone', 'email', 'address', 'bin', 'protection_type',
  'protection_amount', 'registered_at', 'manager_name', 'manager_phone', 'status', 'memo'];
const BIZ_NO_RE = /^\d{3}-\d{2}-\d{5}$/;

const CARD_COUNT = '(SELECT COUNT(*) FROM cards WHERE issuer_id = i.id)';
const ACTIVE_CARDS = "(SELECT COUNT(*) FROM cards WHERE issuer_id = i.id AND status = 'ACTIVE')";
const BALANCE = '(SELECT COALESCE(SUM(balance),0) FROM cards WHERE issuer_id = i.id)';
const CORP_COUNT = '(SELECT COUNT(DISTINCT corporation_id) FROM cards WHERE issuer_id = i.id)';
const EXTRA = `${CARD_COUNT} AS card_count, ${ACTIVE_CARDS} AS active_card_count, ${BALANCE} AS total_balance, ${CORP_COUNT} AS corporation_count`;

const COLUMN_FILTERS = {
  name: 'i.name', biz_no: 'i.biz_no', reg_no: 'i.reg_no', bin: 'i.bin', ceo_name: 'i.ceo_name',
  protection_type: { sql: 'i.protection_type', exact: true }, protection_amount: { sql: 'i.protection_amount', num: true },
  card_count: { sql: CARD_COUNT, num: true }, total_balance: { sql: BALANCE, num: true },
  registered_at: 'i.registered_at', status: { sql: 'i.status', exact: true },
};

function validate(data, isCreate) {
  if (isCreate) requireFields(data, { name: '사업자명', biz_no: '사업자등록번호', bin: '카드 BIN' });
  if (data.biz_no && !BIZ_NO_RE.test(data.biz_no)) throw bad('사업자등록번호 형식은 000-00-00000 입니다.');
  if (data.bin !== undefined && !/^\d{4,6}$/.test(String(data.bin))) throw bad('카드 BIN은 숫자 4~6자리입니다.');
  oneOf(data.protection_type, ['TRUST', 'GUARANTEE', 'DEPOSIT'], '선불충전금 보호방식');
  oneOf(data.status, ['ACTIVE', 'INACTIVE'], '상태');
  if (data.protection_amount === null || (isCreate && data.protection_amount === undefined)) data.protection_amount = 0;
  if (data.protection_amount !== undefined) {
    data.protection_amount = toInt(String(data.protection_amount).replace(/[,\s원]/g, ''), '보호 금액');
  }
}

function checkUnique(data, id = 0) {
  if (data.biz_no && db.prepare('SELECT 1 FROM issuers WHERE biz_no = ? AND id != ?').get(data.biz_no, id)) {
    throw bad('이미 등록된 사업자등록번호입니다.');
  }
  if (data.bin && db.prepare('SELECT 1 FROM issuers WHERE bin = ? AND id != ?').get(String(data.bin), id)) {
    throw bad('이미 사용 중인 카드 BIN입니다.');
  }
}

router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(i.name LIKE ? OR i.biz_no LIKE ? OR i.reg_no LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  if (req.query.status) { where.push('i.status = ?'); params.push(req.query.status); }
  columnFilters(req.query, COLUMN_FILTERS, where, params);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM issuers i ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT i.*, ${EXTRA} FROM issuers i ${w} ORDER BY i.id LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size });
}));

/** 드롭다운/카드 관리 화면용 (카드 수·잔액 포함) */
router.get('/options', (req, res) => {
  res.json(db.prepare(`SELECT i.*, ${EXTRA} FROM issuers i ORDER BY i.id`).all());
});

router.get('/:id', wrap((req, res) => {
  const row = db.prepare(`SELECT i.*, ${EXTRA} FROM issuers i WHERE i.id = ?`).get(req.params.id);
  if (!row) throw notFound('선불사업자');
  res.json(row);
}));

router.post('/', wrap((req, res) => {
  const data = pick(req.body, FIELDS);
  validate(data, true);
  checkUnique(data);
  const { sql, params } = insertSql('issuers', data);
  const r = db.prepare(sql).run(...params);
  res.status(201).json(db.prepare(`SELECT i.*, ${EXTRA} FROM issuers i WHERE i.id = ?`).get(r.lastInsertRowid));
}));

router.put('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM issuers WHERE id = ?').get(id);
  if (!cur) throw notFound('선불사업자');
  const data = pick(req.body, FIELDS);
  validate(data, false);
  checkUnique(data, id);
  if (data.bin && String(data.bin) !== cur.bin && db.prepare('SELECT 1 FROM cards WHERE issuer_id = ?').get(id)) {
    throw bad('발급된 카드가 있어 카드 BIN을 변경할 수 없습니다.');
  }
  if (Object.keys(data).length) {
    const { sql, params } = updateSql('issuers', data, id);
    db.prepare(sql).run(...params);
  }
  res.json(db.prepare(`SELECT i.*, ${EXTRA} FROM issuers i WHERE i.id = ?`).get(id));
}));

router.delete('/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM cards WHERE issuer_id = ?').get(id).n;
  if (used) throw bad(`발행한 선불카드(${used}건)가 있어 삭제할 수 없습니다. 비활성화를 이용하세요.`);
  const r = db.prepare('DELETE FROM issuers WHERE id = ?').run(id);
  if (!r.changes) throw notFound('선불사업자');
  res.json({ ok: true });
}));

export default router;
