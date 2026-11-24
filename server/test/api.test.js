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
  const noIssuer = await call('POST', '/cards', { corporation_id: corp.body.id, holder_name: '홍길동' });
  assert.equal(noIssuer.status, 400);
  const issuer = await call('POST', '/issuers', { name: '테스트선불', biz_no: '888-88-88888', bin: '9999', protection_type: 'TRUST', protection_amount: '1,000,000' });
  assert.equal(issuer.status, 201);
  assert.equal(issuer.body.protection_amount, 1000000);
  assert.equal((await call('POST', '/issuers', { name: '중복', biz_no: '777-77-77777', bin: '9999' })).status, 400);
  const blank = await call('POST', '/issuers', { name: '보호금액 미입력', biz_no: '666-66-66666', bin: '9998', protection_amount: '' });
  assert.equal(blank.status, 201);
  assert.equal(blank.body.protection_amount, 0);
  const card = await call('POST', '/cards', { corporation_id: corp.body.id, issuer_id: issuer.body.id, holder_name: '홍길동', initial_amount: 10000 });
  assert.equal(card.status, 201);
  assert.ok(card.body.card_no.startsWith('9999'));
  assert.equal(card.body.issuer_name, '테스트선불');
  const iss = await call('GET', `/issuers/${issuer.body.id}`);
  assert.equal(iss.body.card_count, 1);
  assert.equal(iss.body.total_balance, 10000);
  assert.equal((await call('DELETE', `/issuers/${issuer.body.id}`)).status, 400); // 카드 있으면 삭제 불가
  assert.equal((await call('GET', `/cards?issuer_id=${issuer.body.id}`)).body.total, 1);
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

test('거래내역 수동 입력 / 법인별 합계 / 수정 / 삭제', async () => {
  const corp = (await call('GET', '/corporations?f_name=' + encodeURIComponent('테스트법인'))).body.rows[0];
  const other = (await call('GET', '/corporations/options')).body.find((c) => c.id !== corp.id && c.status === 'ACTIVE');
  const pg = (await call('GET', '/pgs/options')).body[0];

  const bad = await call('POST', '/records', { record_date: '2030-01-05', items: [{ corporation_id: corp.id, tx_count: -1, total_amount: 100 }] });
  assert.equal(bad.status, 400);
  const noDate = await call('POST', '/records', { items: [{ corporation_id: corp.id, tx_count: 1, total_amount: 100 }] });
  assert.equal(noDate.status, 400);

  const created = await call('POST', '/records', {
    record_date: '2030-01-05', pg_id: pg.id,
    items: [
      { corporation_id: corp.id, tx_count: '12', total_amount: '1,200,000', memo: '1월 5일분' },
      { corporation_id: other.id, tx_count: 3, total_amount: 30000 },
    ],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.count, 2);
  await call('POST', '/records', { record_date: '2030-01-06', items: [{ corporation_id: corp.id, tx_count: 8, total_amount: 800000 }] });

  const byCorp = await call('GET', '/records/by-corporation?from=2030-01-01&to=2030-01-31');
  const mine = byCorp.body.rows.find((r) => r.corporation_id === corp.id);
  assert.equal(mine.tx_count, 20);
  assert.equal(mine.total_amount, 2000000);
  assert.equal(mine.entries, 2);
  assert.equal(mine.last_date, '2030-01-06');
  assert.equal(byCorp.body.summary.total_amount, 2030000);

  const list = await call('GET', `/records?from=2030-01-01&to=2030-01-31&corporation_id=${corp.id}`);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.summary.tx_count, 20);

  const rec = list.body.rows.find((r) => r.record_date === '2030-01-05');
  const upd = await call('PUT', `/records/${rec.id}`, { record_date: '2030-01-05', corporation_id: corp.id, pg_id: pg.id, tx_count: 10, total_amount: 1000000 });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.tx_count, 10);

  const stats = await call('GET', '/stats/summary?from=2030-01-01&to=2030-01-31');
  assert.equal(stats.body.period.tx_count, 21);
  assert.equal(stats.body.period.total_amount, 1830000);
  assert.equal(stats.body.period.fee, Math.round(1000000 * pg.fee_rate / 100) + Math.round(30000 * pg.fee_rate / 100));

  // 거래내역이 있는 법인은 삭제 불가
  assert.equal((await call('DELETE', `/corporations/${other.id}`)).status, 400);
  assert.equal((await call('DELETE', `/records/${rec.id}`)).status, 200);
  assert.equal((await call('GET', `/records?from=2030-01-01&to=2030-01-31&corporation_id=${corp.id}`)).body.total, 1);
});

test('법인 사용 PG', async () => {
  const corp = (await call('GET', '/corporations?f_name=' + encodeURIComponent('테스트법인'))).body.rows[0];
  const pgs = (await call('GET', '/pgs/options')).body;
  const upd = await call('PUT', `/corporations/${corp.id}`, { pg_ids: [pgs[0].id, pgs[1].id, pgs[0].id] });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.pg_ids.split(',').length, 2);
  const listed = (await call('GET', '/corporations?f_pg_names=' + encodeURIComponent(pgs[1].name))).body.rows.map((r) => r.id);
  assert.ok(listed.includes(corp.id));
  const usage = (await call('GET', `/corporations/${corp.id}/pg-usage`)).body;
  assert.ok(usage.filter((u) => u.linked).length === 2);
  assert.equal((await call('PUT', `/corporations/${corp.id}`, { pg_ids: [999999] })).status, 404);
  const cleared = await call('PUT', `/corporations/${corp.id}`, { pg_ids: [] });
  assert.equal(cleared.body.pg_ids, null);
  const pgList = (await call('GET', '/pgs?size=100')).body.rows;
  assert.ok(pgList.every((p) => typeof p.corporation_count === 'number'));
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
