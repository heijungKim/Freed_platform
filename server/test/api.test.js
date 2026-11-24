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
  assert.equal(pay.body.fee, 0);
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
  assert.equal(stats.body.period.fee, undefined);

  // 거래내역이 있는 법인은 삭제 불가
  assert.equal((await call('DELETE', `/corporations/${other.id}`)).status, 400);
  assert.equal((await call('DELETE', `/records/${rec.id}`)).status, 200);
  assert.equal((await call('GET', `/records?from=2030-01-01&to=2030-01-31&corporation_id=${corp.id}`)).body.total, 1);
});

test('카드 일괄 발급', async () => {
  const corp = (await call('GET', '/corporations?f_name=' + encodeURIComponent('테스트법인'))).body.rows[0];
  const issuer = (await call('GET', '/issuers/options')).body.find((i) => i.status === 'ACTIVE');
  const before = (await call('GET', `/cards?corporation_id=${corp.id}&size=1`)).body.total;

  // 자동 번호
  const r = await call('POST', '/cards/bulk', {
    issuer_id: issuer.id, corporation_id: corp.id, quantity: 25, holder_prefix: '영업팀', start_no: 8,
    limit_amount: 100000, initial_amount: 30000,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.count, 25);
  assert.equal(r.body.total_initial, 750000);
  assert.equal(r.body.rows[0].holder_name, '영업팀-008');
  assert.equal(r.body.rows[24].holder_name, '영업팀-032');
  assert.ok(r.body.rows.every((c) => c.card_no.startsWith(issuer.bin) && c.balance === 30000 && c.issuer_id === issuer.id));
  assert.equal(new Set(r.body.rows.map((c) => c.card_no)).size, 25);
  assert.ok(r.body.rows[0].memo.startsWith('일괄발급'));

  // 명단
  const r2 = await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, holder_names: ['김하나', ' ', '이두리', '박세나'] });
  assert.equal(r2.body.count, 3);
  assert.deepEqual(r2.body.rows.map((c) => c.holder_name), ['김하나', '이두리', '박세나']);

  // 검증 실패 → 한 장도 발급되지 않음
  assert.equal((await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 1001, holder_prefix: 'x' })).status, 400);
  assert.equal((await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 0, holder_prefix: 'x' })).status, 400);
  assert.equal((await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 3 })).status, 400);
  const over = await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 3, holder_prefix: 'x', limit_amount: 1000, initial_amount: 5000 });
  assert.equal(over.status, 400);
  assert.equal((await call('GET', `/cards?corporation_id=${corp.id}&size=1`)).body.total, before + 28);
});

test('거래내역 → 법인 카드 충전 자동 배분', async () => {
  const issuer = (await call('GET', '/issuers/options')).body.find((i) => i.status === 'ACTIVE');
  const corp = (await call('POST', '/corporations', { name: '배분테스트', biz_no: '555-55-55555', status: 'ACTIVE' })).body;
  const empty = (await call('POST', '/corporations', { name: '카드없음', biz_no: '444-44-44444', status: 'ACTIVE' })).body;
  // 카드 4장: 무제한 2, 한도 50만 2
  await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 2, holder_prefix: 'A' });
  await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 2, holder_prefix: 'B', limit_amount: 500000 });
  const cardsBefore = (await call('GET', `/cards?corporation_id=${corp.id}`)).body;
  assert.equal(cardsBefore.totalBalance, 0);

  const r = await call('POST', '/records', { record_date: '2030-02-01', items: [{ corporation_id: corp.id, tx_count: 37, total_amount: '12,345,670' }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.allocated, 37);
  assert.equal(r.body.allocated_amount, 12345670);
  const recId = r.body.ids[0];

  const al = (await call('GET', `/records/${recId}/allocations`)).body;
  assert.equal(al.rows.length, 37);
  assert.equal(al.rows.reduce((s, t) => s + t.amount, 0), 12345670);
  assert.ok(new Set(al.rows.map((t) => t.amount)).size > 10, '금액이 다양해야 함');
  assert.ok(al.rows.every((t) => t.transacted_at.startsWith('2030-02-01 ')));
  assert.ok(al.rows.every((t) => t.merchant_name), '모든 거래에 가맹점 상호');
  assert.ok(new Set(al.rows.map((t) => t.merchant_name)).size > 3, '가맹점이 다양해야 함');
  // 건별 상세: 거래내역 배분 거래만
  const items = (await call('GET', `/transactions?records_only=1&corporation_id=${corp.id}&from=2030-02-01&to=2030-02-01&size=100`)).body;
  assert.equal(items.total, 37);
  assert.ok(items.rows.every((t) => t.record_id === recId && t.merchant_name));
  const one = items.rows[0];
  const byMerchant = (await call('GET', `/transactions?records_only=1&corporation_id=${corp.id}&from=2030-02-01&to=2030-02-01&f_merchant_name=${encodeURIComponent(one.merchant_name)}`)).body;
  assert.ok(byMerchant.rows.every((t) => t.merchant_name.includes(one.merchant_name)));
  const byDate = (await call('GET', `/records/by-date?corporation_id=${corp.id}&from=2030-02-01&to=2030-02-28`)).body.rows;
  assert.equal(byDate[0].record_date, '2030-02-01');
  assert.equal(byDate[0].alloc_count, 37);
  assert.ok(al.cards.length >= 1 && al.cards.length <= 4);
  assert.equal(al.record.alloc_count, 37);
  const cards = (await call('GET', `/cards?corporation_id=${corp.id}`)).body;
  assert.equal(cards.totalBalance, 12345670);
  assert.ok(cards.rows.filter((c) => c.limit_amount).every((c) => c.balance <= c.limit_amount), '한도 준수');

  // 배분된 충전은 개별 취소 불가
  assert.equal((await call('POST', `/transactions/${al.rows[0].id}/cancel`)).status, 400);

  // 수정 → 기존 배분 취소 후 재배분
  const upd = await call('PUT', `/records/${recId}`, { record_date: '2030-02-02', corporation_id: corp.id, tx_count: 5, total_amount: 1003 });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.alloc_count, 5);
  assert.equal(upd.body.alloc_amount, 1003);
  assert.equal((await call('GET', `/cards?corporation_id=${corp.id}`)).body.totalBalance, 1003);

  // 오류: 카드 없음 / 한도 부족 / 금액 < 건수 → 같이 입력한 다른 법인도 모두 취소
  const before = (await call('GET', '/records?from=2030-02-01&to=2030-02-28')).body.total;
  const noCards = await call('POST', '/records', { record_date: '2030-02-03', items: [
    { corporation_id: corp.id, tx_count: 3, total_amount: 30000 }, { corporation_id: empty.id, tx_count: 1, total_amount: 1000 }] });
  assert.equal(noCards.status, 400);
  assert.match(noCards.body.error, /카드가 없어/);
  assert.equal((await call('GET', '/records?from=2030-02-01&to=2030-02-28')).body.total, before);
  assert.equal((await call('GET', `/cards?corporation_id=${corp.id}`)).body.totalBalance, 1003);
  assert.equal((await call('POST', '/records', { record_date: '2030-02-03', items: [{ corporation_id: corp.id, tx_count: 5, total_amount: 3 }] })).status, 400);

  // 배분 안 함
  const na = await call('POST', '/records', { record_date: '2030-02-04', allocate: false, items: [{ corporation_id: empty.id, tx_count: 2, total_amount: 5000 }] });
  assert.equal(na.status, 201);
  assert.equal(na.body.allocated, 0);

  // 배분 충전 개별 편집: 금액 수정 / 카드 이동 / 추가 / 삭제 → 입력 합계 자동 갱신
  let al2 = (await call('GET', `/records/${recId}/allocations`)).body;
  assert.equal(al2.corp_cards.length, 4);
  const t0 = al2.rows[0];
  let rec = (await call('PUT', `/records/${recId}/allocations/${t0.id}`, { amount: t0.amount + 500, merchant_name: '테스트상점 본점' })).body;
  assert.equal((await call('GET', `/records/${recId}/allocations`)).body.rows.find((x) => x.id === t0.id).merchant_name, '테스트상점 본점');
  assert.equal(rec.total_amount, 1503);
  assert.equal(rec.tx_count, 5);
  const otherCard = al2.corp_cards.find((c) => c.id !== t0.card_id && !c.limit_amount);
  rec = (await call('PUT', `/records/${recId}/allocations/${t0.id}`, { card_id: otherCard.id })).body;
  assert.equal(rec.total_amount, 1503);
  rec = (await call('POST', `/records/${recId}/allocations`, { card_id: otherCard.id, amount: 2000 })).body;
  assert.equal(rec.tx_count, 6);
  assert.equal(rec.total_amount, 3503);
  assert.equal(rec.alloc_amount, 3503);
  al2 = (await call('GET', `/records/${recId}/allocations`)).body;
  rec = (await call('DELETE', `/records/${recId}/allocations/${al2.rows[1].id}`)).body;
  assert.equal(rec.tx_count, 5);
  assert.equal(rec.total_amount, 3503 - al2.rows[1].amount);
  assert.equal((await call('GET', `/cards?corporation_id=${corp.id}`)).body.totalBalance, rec.total_amount);
  // 다른 법인 카드 / 한도 초과 / 잘못된 금액 거부
  const foreign = (await call('GET', '/cards?size=500')).body.rows.find((c) => c.corporation_id !== corp.id);
  assert.equal((await call('POST', `/records/${recId}/allocations`, { card_id: foreign.id, amount: 1000 })).status, 400);
  const limited = al2.corp_cards.find((c) => c.limit_amount);
  assert.equal((await call('POST', `/records/${recId}/allocations`, { card_id: limited.id, amount: 600000 })).status, 400);
  assert.equal((await call('PUT', `/records/${recId}/allocations/${al2.rows[0].id}`, { amount: 0 })).status, 400);

  // 삭제 → 배분 취소, 잔액 원복
  const del = await call('DELETE', `/records/${recId}`);
  assert.equal(del.body.cancelled, rec.tx_count);
  assert.equal((await call('GET', `/cards?corporation_id=${corp.id}`)).body.totalBalance, 0);
});

test('PG: 수수료율·정산주기 없이 등록/수정', async () => {
  const r = await call('POST', '/pgs', { name: '테스트PG', code: 'testpg', mid: 'm-1', fee_rate: 9, settlement_cycle: 'D+9' });
  assert.equal(r.status, 201);
  assert.equal(r.body.code, 'TESTPG');
  assert.equal(r.body.fee_rate, 0); // 전달해도 무시
  const u = await call('PUT', `/pgs/${r.body.id}`, { name: '테스트PG2', fee_rate: 5 });
  assert.equal(u.body.name, '테스트PG2');
  assert.equal(u.body.fee_rate, 0);
  assert.equal((await call('DELETE', `/pgs/${r.body.id}`)).status, 200);
});

test('배분은 균등하지 않아야 함 (카드별 합계·금액 편차)', async () => {
  const { splitAmount } = await import('../allocation.js');
  const cv = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m; };
  // 금액 편차: 30건 300만원 × 50회 평균 변동계수
  let amtCv = 0;
  for (let k = 0; k < 50; k++) {
    const a = splitAmount(3_000_000, 30);
    assert.equal(a.reduce((s, v) => s + v, 0), 3_000_000);
    amtCv += cv(a);
  }
  assert.ok(amtCv / 50 > 0.5, `금액 편차가 너무 작음: ${(amtCv / 50).toFixed(2)}`);

  // 카드별 합계 편차: 카드 5장 법인에 30건 × 10회
  const issuer = (await call('GET', '/issuers/options')).body.find((i) => i.status === 'ACTIVE');
  const corp = (await call('POST', '/corporations', { name: '편차테스트', biz_no: '333-33-33333', status: 'ACTIVE' })).body;
  await call('POST', '/cards/bulk', { issuer_id: issuer.id, corporation_id: corp.id, quantity: 5, holder_prefix: 'D' });
  let cardCv = 0;
  for (let k = 0; k < 10; k++) {
    const r = await call('POST', '/records', { record_date: '2030-03-01', items: [{ corporation_id: corp.id, tx_count: 30, total_amount: 3_000_000 }] });
    const al = (await call('GET', `/records/${r.body.ids[0]}/allocations`)).body;
    const per = al.corp_cards.map((c) => al.cards.find((x) => x.card_id === c.id)?.amount || 0);
    assert.equal(per.reduce((s, v) => s + v, 0), 3_000_000);
    cardCv += cv(per);
  }
  assert.ok(cardCv / 10 > 0.3, `카드별 합계가 너무 균등함: ${(cardCv / 10).toFixed(2)}`);
});

test('정산 내역 (D+1)', async () => {
  const corp = (await call('GET', '/corporations?f_name=' + encodeURIComponent('테스트법인'))).body.rows[0];
  await call('POST', '/records', { record_date: '2031-05-10', allocate: false, items: [{ corporation_id: corp.id, tx_count: 4, total_amount: 400000 }] });
  await call('POST', '/records', { record_date: '2031-05-10', allocate: false, items: [{ corporation_id: corp.id, tx_count: 1, total_amount: 50000 }] });

  let sum = (await call('GET', '/settlements/summary?date=2031-05-10')).body;
  assert.equal(sum.settle_date, '2031-05-11');
  const row = sum.rows.find((r) => r.corporation_id === corp.id);
  assert.equal(row.tx_count, 5);
  assert.equal(row.tx_amount, 450000);
  assert.equal(row.status, 'SCHEDULED'); // 미래 정산일
  assert.equal(row.unpaid_amount, 450000);

  // 부분 정산 → 전액 정산
  let r = await call('POST', '/settlements', { tx_date: '2031-05-10', corporation_id: corp.id, paid_amount: '400,000', memo: '1차' });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'PARTIAL');
  assert.equal(r.body.unpaid_amount, 50000);
  r = await call('POST', '/settlements', { tx_date: '2031-05-10', corporation_id: corp.id });
  assert.equal(r.body.status, 'PAID');
  assert.equal(r.body.paid_amount, 450000);
  // 정산 후 거래 추가 → 부분 정산으로 바뀜
  await call('POST', '/records', { record_date: '2031-05-10', allocate: false, items: [{ corporation_id: corp.id, tx_count: 1, total_amount: 7000 }] });
  sum = (await call('GET', '/settlements/summary?date=2031-05-10')).body;
  assert.equal(sum.rows.find((x) => x.corporation_id === corp.id).status, 'PARTIAL');
  // 일괄 정산
  const bulk = await call('POST', '/settlements/bulk', { tx_date: '2031-05-10' });
  assert.equal(bulk.status, 201);
  sum = (await call('GET', '/settlements/summary?date=2031-05-10')).body;
  assert.equal(sum.unpaid_amount, 0);
  assert.equal(sum.paid_amount, sum.tx_amount);
  assert.equal((await call('POST', '/settlements/bulk', { tx_date: '2031-05-10' })).status, 400);
  // 법인 선택
  const other = (await call('POST', '/corporations', { name: '정산법인B', biz_no: '222-22-22222', status: 'ACTIVE' })).body;
  await call('POST', '/records', { record_date: '2031-05-10', allocate: false, items: [{ corporation_id: other.id, tx_count: 2, total_amount: 20000 }] });
  const only = (await call('GET', `/settlements/summary?date=2031-05-10&corporation_id=${other.id}`)).body;
  assert.equal(only.rows.length, 1);
  assert.equal(only.unpaid_amount, 20000);
  const byCorp = (await call('GET', '/settlements/by-corporation?from=2031-05-01&to=2031-05-31')).body.rows;
  assert.equal(byCorp.find((r) => r.corporation_id === other.id).unpaid_amount, 20000);
  assert.equal(byCorp.find((r) => r.corporation_id === corp.id).unpaid_amount, 0);
  const bulkOne = await call('POST', '/settlements/bulk', { tx_date: '2031-05-10', corporation_id: other.id });
  assert.equal(bulkOne.body.count, 1);
  assert.equal((await call('GET', `/settlements/daily?from=2031-05-01&to=2031-05-31&corporation_id=${other.id}`)).body.rows[0].paid_amount, 20000);
  // 일자별
  const daily = (await call('GET', '/settlements/daily?from=2031-05-01&to=2031-05-31')).body;
  assert.equal(daily.rows[0].tx_date, '2031-05-10');
  assert.equal(daily.rows[0].status, 'PAID');
  // 정산 취소
  const id = sum.rows.find((x) => x.corporation_id === corp.id).settlement_id;
  assert.equal((await call('DELETE', `/settlements/${id}`)).status, 200);
  assert.equal((await call('GET', '/settlements/summary?date=2031-05-10')).body.rows.find((x) => x.corporation_id === corp.id).status, 'SCHEDULED');
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
