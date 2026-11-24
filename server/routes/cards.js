import { Router } from 'express';
import crypto from 'node:crypto';
import { db, tx } from '../db.js';
import { createTransaction, applyTransaction } from '../ledger.js';
import { pick, requireFields, oneOf, paging, insertSql, updateSql, wrap, notFound, bad, toInt, columnFilters } from '../util.js';

const router = Router();
const STATUSES = ['ACTIVE', 'SUSPENDED', 'LOST', 'EXPIRED'];

/** 카드번호 생성: 선불사업자 BIN + 난수 (총 16자리) */
export function generateCardNo(bin = '9410') {
  for (;;) {
    let no = String(bin);
    while (no.length < 16) no += crypto.randomInt(0, 10);
    if (!db.prepare('SELECT 1 FROM cards WHERE card_no = ?').get(no)) return no;
  }
}

const COLUMN_FILTERS = {
  card_no: 'k.card_no', corporation_name: 'c.name', issuer_name: 'i.name', holder_name: 'k.holder_name', balance: { sql: 'k.balance', num: true },
  limit_amount: { sql: 'k.limit_amount', num: true }, issued_at: 'k.issued_at', expires_at: 'k.expires_at',
  status: { sql: 'k.status', exact: true },
};

const SELECT = `
  SELECT k.*, c.name AS corporation_name, i.name AS issuer_name, i.bin AS issuer_bin, i.reg_no AS issuer_reg_no
  FROM cards k JOIN corporations c ON c.id = k.corporation_id
  LEFT JOIN issuers i ON i.id = k.issuer_id`;

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
  if (req.query.issuer_id) { where.push('k.issuer_id = ?'); params.push(req.query.issuer_id); }
  if (req.query.status) { where.push('k.status = ?'); params.push(req.query.status); }
  columnFilters(req.query, COLUMN_FILTERS, where, params);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM cards k JOIN corporations c ON c.id = k.corporation_id LEFT JOIN issuers i ON i.id = k.issuer_id';
  const total = db.prepare(`SELECT COUNT(*) n ${from} ${w}`).get(...params).n;
  const sum = db.prepare(`SELECT COALESCE(SUM(k.balance),0) s ${from} ${w}`).get(...params).s;
  const rows = db.prepare(`${SELECT} ${w} ORDER BY k.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size, totalBalance: sum });
}));

router.get('/options', (req, res) => {
  res.json(db.prepare(`
    SELECT k.id, k.card_no, k.holder_name, k.balance, k.status, c.name AS corporation_name, i.name AS issuer_name
    FROM cards k JOIN corporations c ON c.id = k.corporation_id LEFT JOIN issuers i ON i.id = k.issuer_id
    ORDER BY k.id DESC`).all());
});

router.get('/:id', wrap((req, res) => {
  const row = db.prepare(`${SELECT} WHERE k.id = ?`).get(req.params.id);
  if (!row) throw notFound('선불카드');
  res.json(row);
}));

const BULK_MAX = 1000;

/** 발급 공통 검증: 선불사업자/법인/한도/초기충전/유효기간 */
function prepareIssue(body) {
  const base = pick(body, ['corporation_id', 'issuer_id', 'limit_amount', 'expires_at', 'memo']);
  requireFields(base, { issuer_id: '선불사업자', corporation_id: '법인' });
  const issuer = db.prepare('SELECT * FROM issuers WHERE id = ?').get(base.issuer_id);
  if (!issuer) throw notFound('선불사업자');
  if (issuer.status !== 'ACTIVE') throw bad('비활성화된 선불사업자는 카드를 발행할 수 없습니다.');
  const corp = db.prepare('SELECT * FROM corporations WHERE id = ?').get(base.corporation_id);
  if (!corp) throw notFound('법인');
  if (corp.status !== 'ACTIVE') throw bad('비활성화된 법인에는 카드를 발급할 수 없습니다.');
  base.issuer_id = issuer.id;
  base.corporation_id = corp.id;
  base.limit_amount = base.limit_amount ? toInt(base.limit_amount, '충전 한도') : 0;
  if (base.expires_at && !/^\d{4}-\d{2}-\d{2}$/.test(base.expires_at)) throw bad('유효기간 형식이 올바르지 않습니다.');
  if (!base.expires_at) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 5);
    base.expires_at = d.toISOString().slice(0, 10);
  }
  base.issued_at = new Date().toISOString().slice(0, 10);
  const initial = body.initial_amount ? toInt(body.initial_amount, '초기 충전 금액') : 0;
  if (initial > 0 && base.limit_amount > 0 && initial > base.limit_amount) {
    throw bad(`초기 충전 금액이 충전 한도(${base.limit_amount.toLocaleString()}원)를 초과합니다.`);
  }
  return { base, issuer, initial };
}

/** 카드 1장 발급 (트랜잭션 안에서 호출) */
function issueOne({ base, issuer, initial }, holderName, userId, chargeMemo) {
  const data = { ...base, holder_name: holderName, card_no: generateCardNo(issuer.bin) };
  const { sql, params } = insertSql('cards', data);
  const id = Number(db.prepare(sql).run(...params).lastInsertRowid);
  if (initial > 0) applyTransaction({ card_id: id, type: 'CHARGE', amount: initial, memo: chargeMemo, created_by: userId });
  return id;
}

/** 카드 발급 (초기 충전 금액 옵션) */
router.post('/', wrap((req, res) => {
  const prep = prepareIssue(req.body || {});
  const holder = String(req.body.holder_name || '').trim();
  if (!holder) throw bad('사용자명은(는) 필수 입력 항목입니다.');
  const id = tx(() => issueOne(prep, holder, req.user.id, '발급 시 초기 충전'));
  res.status(201).json(db.prepare(`${SELECT} WHERE k.id = ?`).get(id));
}));

/**
 * 일괄 발급 (최대 1,000장, 전부 성공 또는 전부 취소)
 * body: 공통값 + { holder_names: ['홍길동', ...] } 또는 { quantity, holder_prefix, start_no }
 */
router.post('/bulk', wrap((req, res) => {
  const b = req.body || {};
  const prep = prepareIssue(b);
  let names;
  if (Array.isArray(b.holder_names) && b.holder_names.length) {
    names = b.holder_names.map((n) => String(n ?? '').trim()).filter(Boolean);
    if (!names.length) throw bad('사용자 명단이 비어 있습니다.');
    if (names.some((n) => n.length > 50)) throw bad('사용자명은 50자 이하여야 합니다.');
  } else {
    const qty = toInt(b.quantity, '발급 수량', { min: 1 });
    if (qty > BULK_MAX) throw bad(`한 번에 최대 ${BULK_MAX.toLocaleString()}장까지 발급할 수 있습니다.`);
    const prefix = String(b.holder_prefix ?? '').trim();
    if (!prefix) throw bad('사용자명 앞글자를 입력해 주세요.');
    const start = b.start_no === undefined || b.start_no === '' ? 1 : toInt(b.start_no, '시작 번호');
    const width = Math.max(3, String(start + qty - 1).length);
    names = Array.from({ length: qty }, (_, i) => `${prefix}-${String(start + i).padStart(width, '0')}`);
  }
  if (names.length > BULK_MAX) throw bad(`한 번에 최대 ${BULK_MAX.toLocaleString()}장까지 발급할 수 있습니다.`);

  const batch = `일괄발급 ${new Date().toISOString().slice(0, 10)} (${names.length}장)`;
  if (!prep.base.memo) prep.base.memo = batch;
  const ids = tx(() => names.map((n) => issueOne(prep, n, req.user.id, `${batch} 초기 충전`)));
  const rows = db.prepare(`${SELECT} WHERE k.id IN (${ids.map(() => '?').join(',')}) ORDER BY k.id`).all(...ids);
  res.status(201).json({
    count: rows.length,
    total_initial: prep.initial * rows.length,
    rows,
  });
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
