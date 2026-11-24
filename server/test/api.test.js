import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
let base;
let cookie = '';

async function call(method, url, body, useCookie = true) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(useCookie && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  const { ensureAdmin, seedDemo } = await import('../seed.js');
  const { createApp } = await import('../app.js');
  ensureAdmin();
  seedDemo();
  const server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
  server.unref();
});

test('비로그인 접근 차단', async () => {
  assert.equal((await call('GET', '/corporations', null, false)).status, 401);
});

test('일반 사용자(USER) 로그인 거부', async () => {
  const r = await call('POST', '/auth/login', { username: 'user01', password: 'user12345' }, false);
  assert.equal(r.status, 403);
  cookie = '';
});

test('잘못된 비밀번호 거부', async () => {
  assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
});

test('관리자 로그인 및 거래/잔액 처리', async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin1234' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'SUPER_ADMIN');

  const corp = await call('POST', '/corporations', { name: '테스트법인', biz_no: '999-99-99999', status: 'ACTIVE' });
  assert.equal(corp.status, 201);
  const card = await call('POST', '/cards', { corporation_id: corp.body.id, holder_name: '홍길동', initial_amount: 10000 });
  assert.equal(card.body.balance, 10000);

  const pg = (await call('GET', '/pgs/options')).body[0];
  const over = await call('POST', '/transactions', { card_id: card.body.id, type: 'PAYMENT', amount: 20000, pg_id: pg.id });
  assert.equal(over.status, 400); // 잔액 부족

  const pay = await call('POST', '/transactions', { card_id: card.body.id, type: 'PAYMENT', amount: 4000, pg_id: pg.id });
  assert.equal(pay.status, 201);
  assert.equal(pay.body.fee, Math.round(4000 * pg.fee_rate / 100));
  assert.equal((await call('GET', `/cards/${card.body.id}`)).body.balance, 6000);

  await call('POST', `/transactions/${pay.body.id}/cancel`);
  assert.equal((await call('GET', `/cards/${card.body.id}`)).body.balance, 10000);
});

test('테이블 헤더 필터 (서버)', async () => {
  const corps = await call('GET', '/corporations?f_name=' + encodeURIComponent('테스트'));
  assert.equal(corps.body.total, 1);
  assert.equal(corps.body.rows[0].name, '테스트법인');
  const active = await call('GET', '/cards?f_status=ACTIVE');
  assert.ok(active.body.rows.every((r) => r.status === 'ACTIVE'));
  const byCorpName = await call('GET', '/cards?f_corporation_name=' + encodeURIComponent('테스트법인'));
  assert.equal(byCorpName.body.total, 1);
  const amt = await call('GET', '/transactions?f_amount=' + encodeURIComponent('10,000') + '&f_type=CHARGE&from=2000-01-01');
  assert.ok(amt.body.total >= 1);
  assert.ok(amt.body.rows.every((r) => String(r.amount).includes('10000') && r.type === 'CHARGE'));
  const pct = await call('GET', '/corporations?f_name=' + encodeURIComponent('%'));
  assert.equal(pct.body.total, 0); // % 는 와일드카드가 아닌 글자로 취급
});

test('집계 API', async () => {
  const r = await call('GET', '/stats/summary');
  assert.equal(r.status, 200);
  assert.ok(r.body.totals.cards > 0);
});

test('로그아웃 후 접근 차단', async () => {
  await call('POST', '/auth/logout');
  assert.equal((await call('GET', '/auth/me')).status, 401);
});
