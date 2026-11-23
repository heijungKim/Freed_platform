import { Router } from 'express';
import { db } from '../db.js';
import {
  COOKIE_NAME, ADMIN_ROLES, verifyPassword, hashPassword, validatePassword, createSession,
  destroySession, requireAdmin, loginRateLimited, recordLoginFailure, clearLoginFailures,
} from '../auth.js';
import { bad, wrap } from '../util.js';

const router = Router();

router.post('/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw bad('아이디와 비밀번호를 입력해 주세요.');
  const key = `${req.ip}:${String(username).toLowerCase()}`;
  if (loginRateLimited(key)) {
    return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    recordLoginFailure(key);
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  if (user.status !== 'ACTIVE') {
    return res.status(403).json({ error: '비활성화된 계정입니다. 최고 관리자에게 문의하세요.' });
  }
  if (!ADMIN_ROLES.includes(user.role)) {
    return res.status(403).json({ error: '관리자 계정만 로그인할 수 있습니다.' });
  }

  clearLoginFailures(key);
  db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(user.id);
  const { token, maxAge } = createSession(user.id);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge,
  });
  res.json({ user: { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role } });
}));

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => res.json({ user: req.user }));

router.post('/password', requireAdmin, wrap((req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(currentPassword || ''), row.password_hash)) throw bad('현재 비밀번호가 올바르지 않습니다.');
  const err = validatePassword(newPassword);
  if (err) throw bad(err);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  // 현재 세션을 제외한 다른 세션 종료
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.cookies[COOKIE_NAME]);
  res.json({ ok: true });
}));

export default router;
