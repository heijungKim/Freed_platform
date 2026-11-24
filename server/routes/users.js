import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, validatePassword, requireSuperAdmin, destroyUserSessions } from '../auth.js';
import { pick, requireFields, oneOf, paging, wrap, notFound, bad, insertSql, updateSql, columnFilters } from '../util.js';

const router = Router();
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'USER'];
const COLUMN_FILTERS = {
  id: { sql: 'id', num: true }, username: 'username', name: 'name', email: 'email', role: { sql: 'role', exact: true },
  status: { sql: 'status', exact: true }, last_login_at: 'last_login_at', created_at: 'created_at',
};
const COLS = 'id, username, name, email, role, status, last_login_at, created_at';

/** 남아있는 활성 최고관리자 수 (본인 제외) */
function otherActiveSuperAdmins(id) {
  return db.prepare("SELECT COUNT(*) n FROM users WHERE role='SUPER_ADMIN' AND status='ACTIVE' AND id != ?").get(id).n;
}

router.get('/', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(username LIKE ? OR name LIKE ? OR email LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  if (req.query.role) { where.push('role = ?'); params.push(req.query.role); }
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  columnFilters(req.query, COLUMN_FILTERS, where, params);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM users ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT ${COLS} FROM users ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  res.json({ rows, total, page, size });
}));

router.post('/', requireSuperAdmin, wrap((req, res) => {
  const data = pick(req.body, ['username', 'name', 'email', 'role', 'status']);
  requireFields({ ...data, password: req.body.password }, { username: '아이디', name: '이름', password: '비밀번호' });
  if (!/^[a-zA-Z0-9_.-]{4,30}$/.test(data.username)) throw bad('아이디는 영문/숫자/._- 4~30자입니다.');
  oneOf(data.role, ROLES, '권한');
  oneOf(data.status, ['ACTIVE', 'INACTIVE'], '상태');
  const pwErr = validatePassword(req.body.password);
  if (pwErr) throw bad(pwErr);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(data.username)) throw bad('이미 사용 중인 아이디입니다.');
  data.password_hash = hashPassword(req.body.password);
  const { sql, params } = insertSql('users', data);
  const r = db.prepare(sql).run(...params);
  res.status(201).json(db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(r.lastInsertRowid));
}));

router.put('/:id', requireSuperAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('사용자');
  const data = pick(req.body, ['name', 'email', 'role', 'status']);
  oneOf(data.role, ROLES, '권한');
  oneOf(data.status, ['ACTIVE', 'INACTIVE'], '상태');
  const losingSuper = user.role === 'SUPER_ADMIN' && user.status === 'ACTIVE'
    && ((data.role && data.role !== 'SUPER_ADMIN') || data.status === 'INACTIVE');
  if (losingSuper && otherActiveSuperAdmins(id) === 0) throw bad('최소 1명의 활성 최고 관리자가 필요합니다.');
  if (Object.keys(data).length) {
    const { sql, params } = updateSql('users', data, id);
    db.prepare(sql).run(...params);
  }
  if (data.status === 'INACTIVE' || (data.role && data.role !== user.role)) destroyUserSessions(id);
  res.json(db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id));
}));

router.post('/:id/reset-password', requireSuperAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound('사용자');
  const err = validatePassword(req.body.password);
  if (err) throw bad(err);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
  if (id !== req.user.id) destroyUserSessions(id);
  res.json({ ok: true });
}));

router.delete('/:id', requireSuperAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw bad('본인 계정은 삭제할 수 없습니다.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('사용자');
  if (user.role === 'SUPER_ADMIN' && otherActiveSuperAdmins(id) === 0) throw bad('최소 1명의 활성 최고 관리자가 필요합니다.');
  db.prepare('UPDATE transactions SET created_by = NULL WHERE created_by = ?').run(id);
  db.prepare('UPDATE tx_records SET created_by = NULL WHERE created_by = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
}));

export default router;
