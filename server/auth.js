import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8시간
export const COOKIE_NAME = 'erp_session';
export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
  return null;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token, userId, Date.now() + SESSION_TTL_MS,
  );
  return { token, maxAge: SESSION_TTL_MS };
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** 쿠키의 세션을 검증하고 관리자 권한(SUPER_ADMIN/ADMIN)인 경우에만 통과 */
export function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.email, u.role, u.status, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row || row.expires_at < Date.now()) {
    destroySession(token);
    return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.' });
  }
  if (row.status !== 'ACTIVE' || !ADMIN_ROLES.includes(row.role)) {
    destroySession(token);
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  }
  // sliding expiration
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + SESSION_TTL_MS, token);
  const { expires_at, ...user } = row;
  req.user = user;
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ error: '최고 관리자 권한이 필요합니다.' });
  next();
}

// 간단한 로그인 시도 제한 (IP+아이디 기준 15분 10회)
const attempts = new Map();
export function loginRateLimited(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) return false;
  return rec.count >= 10;
}
export function recordLoginFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) attempts.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
  else rec.count++;
}
export function clearLoginFailures(key) {
  attempts.delete(key);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
