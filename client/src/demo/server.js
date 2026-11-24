/**
 * GitHub Pages 데모: 실제 서버 라우트(server/routes/*)를 브라우저 안에서 실행하는 가짜 HTTP 계층.
 * server/app.js 와 같은 순서로 라우터를 연결하고, 같은 인증 미들웨어(requireAdmin)를 거친다.
 */
import { initDb, persist, resetStorage } from './db.js';
import { COOKIE_NAME, requireAdmin, purgeExpiredSessions } from '../../../server/auth.js';
import { ensureAdmin, seedDemo } from '../../../server/seed.js';
import authRoutes from '../../../server/routes/auth.js';
import corporationRoutes from '../../../server/routes/corporations.js';
import pgRoutes from '../../../server/routes/pgs.js';
import cardRoutes from '../../../server/routes/cards.js';
import transactionRoutes from '../../../server/routes/transactions.js';
import statsRoutes from '../../../server/routes/stats.js';
import userRoutes from '../../../server/routes/users.js';

const MOUNTS = [
  ['/api/corporations', corporationRoutes],
  ['/api/pgs', pgRoutes],
  ['/api/cards', cardRoutes],
  ['/api/transactions', transactionRoutes],
  ['/api/stats', statsRoutes],
  ['/api/users', userRoutes],
];

const SESSION_KEY = 'freed-erp-demo-session';
const cookieJar = {
  get() { try { return localStorage.getItem(SESSION_KEY) || sessionValue; } catch { return sessionValue; } },
  set(v) { sessionValue = v; try { localStorage.setItem(SESSION_KEY, v); } catch { /* ignore */ } },
  clear() { sessionValue = ''; try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } },
};
let sessionValue = '';

const ready = initDb().then((fresh) => {
  ensureAdmin();
  if (fresh) seedDemo();
  purgeExpiredSessions();
  persist();
});

/** 데모 데이터를 처음 상태로 되돌린다 */
export function resetDemo() {
  resetStorage();
  cookieJar.clear();
  window.location.reload();
}

function runChain(handlers, req, res) {
  return new Promise((resolve) => {
    let i = 0;
    res._resolve = resolve;
    const next = (err) => {
      if (res._sent) return;
      if (err) return resolve({ err });
      const h = handlers[i++];
      if (!h) return resolve({ passed: true });
      try {
        const r = h(req, res, next);
        if (r instanceof Promise) r.catch((e) => resolve({ err: e }));
      } catch (e) {
        resolve({ err: e });
      }
    };
    next();
  });
}

function makeRes() {
  const res = {
    statusCode: 200, headers: {}, body: undefined, _sent: false,
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    json(b) { res.body = b; res.headers['content-type'] = 'application/json'; res._finish(); },
    send(b) { res.body = b; res._finish(); },
    cookie(name, value) { if (name === COOKIE_NAME) cookieJar.set(value); },
    clearCookie(name) { if (name === COOKIE_NAME) cookieJar.clear(); },
    _finish() { res._sent = true; res._resolve?.({ done: true }); },
  };
  return res;
}

function errorResponse(err) {
  if (err.status && err.status < 500) return { status: err.status, body: { error: err.message } };
  console.error(err);
  return { status: 500, body: { error: '서버 오류가 발생했습니다.' } };
}

/**
 * fetch 대신 호출되는 요청 처리기
 * @returns {Promise<{status:number, body:any, headers:object}>}
 */
export async function handle(method, url, body) {
  await ready;
  const u = new URL(url, 'http://demo.local');
  const path = u.pathname;
  const req = {
    method, path,
    query: Object.fromEntries(u.searchParams.entries()),
    body: body ? JSON.parse(JSON.stringify(body)) : {},
    params: {},
    cookies: { [COOKIE_NAME]: cookieJar.get() || undefined },
    ip: 'browser',
  };
  const res = makeRes();

  try {
    if (path === '/api/health') return { status: 200, body: { ok: true } };

    let router;
    let sub;
    const handlers = [];
    if (path.startsWith('/api/auth')) {
      router = authRoutes;
      sub = path.slice('/api/auth'.length) || '/';
    } else {
      const mount = MOUNTS.find(([p]) => path === p || path.startsWith(`${p}/`));
      if (!mount) return { status: 404, body: { error: '존재하지 않는 API입니다.' } };
      [, router] = mount;
      sub = path.slice(mount[0].length) || '/';
      handlers.push(requireAdmin); // 이하 모든 API는 관리자 로그인 필요 (server/app.js 와 동일)
    }

    const m = router.match(method, sub);
    if (!m) {
      // 인증 먼저 검사 (서버와 동일하게 비로그인 시 401)
      if (handlers.length) {
        const r = await runChain(handlers, req, res);
        if (res._sent) return { status: res.statusCode, body: res.body, headers: res.headers };
        if (r.err) return errorResponse(r.err);
      }
      return { status: 404, body: { error: '존재하지 않는 API입니다.' } };
    }
    req.params = m.params;
    const r = await runChain([...handlers, ...m.handlers], req, res);
    if (r.err) return errorResponse(r.err);
    if (!res._sent) return { status: 404, body: { error: '존재하지 않는 API입니다.' } };
    return { status: res.statusCode, body: res.body, headers: res.headers };
  } finally {
    persist();
  }
}
