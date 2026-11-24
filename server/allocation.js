/**
 * 거래내역(수동 입력) → 법인 선불카드 충전 자동 배분
 *
 * 거래건수 N, 총 금액 A 를 입력하면 해당 법인의 정상(ACTIVE) 카드들에
 * 금액이 서로 다른 충전 거래 N건을 만들어 합계가 정확히 A 가 되도록 나눈다.
 *  - 금액: 1,000원 단위(불가능하면 100원/1원 단위), 작은 금액이 많고 큰 금액이 가끔 있는 분포
 *  - 카드: 가능한 한 고르게(카드별 건수 균등) 배정, 카드 충전 한도 준수
 *  - 시각: 거래일 09:00~21:59 사이 무작위 (오늘이면 현재 시각 이전)
 */
import crypto from 'node:crypto';
import { db } from './db.js';
import { applyTransaction } from './ledger.js';
import { bad } from './util.js';

export const MAX_ALLOC_COUNT = 5000;

const rnd = () => crypto.randomInt(0, 1_000_000) / 1_000_000;
const pad = (n) => String(n).padStart(2, '0');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 합계가 정확히 total 이 되는 count 개의 서로 다른 금액 */
export function splitAmount(total, count) {
  if (count < 1) throw bad('거래건수는 1건 이상이어야 합니다.');
  if (total < count) throw bad(`총 금액(${total.toLocaleString()}원)은 거래건수(${count.toLocaleString()}건) 이상이어야 합니다.`);
  const unit = total >= count * 1000 ? 1000 : total >= count * 100 ? 100 : 1;
  const units = Math.floor(total / unit);
  const leftover = total - units * unit;

  // 가중치: 작은 값이 많고 큰 값이 가끔 (0.3 ~ 3.0)
  const weights = Array.from({ length: count }, () => 0.3 + rnd() ** 2 * 2.7);
  const wsum = weights.reduce((s, w) => s + w, 0);
  const extra = units - count; // 각 1단위씩 먼저 배정
  const parts = weights.map((w) => 1 + Math.floor((extra * w) / wsum));
  let remain = units - parts.reduce((s, v) => s + v, 0);
  while (remain > 0) { parts[crypto.randomInt(0, count)] += 1; remain--; }

  const amounts = parts.map((p) => p * unit);
  if (leftover) {
    const maxIdx = amounts.indexOf(Math.max(...amounts));
    amounts[maxIdx] += leftover;
  }
  return amounts;
}

function randomTimes(date, count) {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const start = 9 * 3600;
  let end = 22 * 3600 - 1;
  if (date === today) end = Math.max(start + 60, Math.min(end, now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()));
  if (date > today) end = 22 * 3600 - 1;
  return Array.from({ length: count }, () => start + crypto.randomInt(0, end - start + 1))
    .sort((a, b) => a - b)
    .map((s) => `${date} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`);
}

/**
 * 거래내역 1건을 카드 충전으로 배분 (DB 트랜잭션 안에서 호출)
 * @returns {{ count, amount, cards }}
 */
export function allocateRecord(record, userId) {
  const count = Number(record.tx_count);
  const total = Number(record.total_amount);
  if (!total && !count) return { count: 0, amount: 0, cards: 0 };
  if (count > MAX_ALLOC_COUNT) throw bad(`카드 배분은 1회 입력당 최대 ${MAX_ALLOC_COUNT.toLocaleString()}건까지 가능합니다.`);
  const corpName = db.prepare('SELECT name FROM corporations WHERE id = ?').get(record.corporation_id)?.name || '';

  const cards = db.prepare("SELECT id, balance, limit_amount FROM cards WHERE corporation_id = ? AND status = 'ACTIVE'")
    .all(record.corporation_id)
    .map((c) => ({ id: c.id, room: c.limit_amount > 0 ? Math.max(0, c.limit_amount - c.balance) : Infinity, n: 0, r: rnd() }));
  if (!cards.length) throw bad(`${corpName}: 정상 상태의 발급 카드가 없어 배분할 수 없습니다. 먼저 카드를 발급하세요.`);
  const capacity = cards.reduce((s, c) => s + c.room, 0);
  if (capacity < total) {
    throw bad(`${corpName}: 카드 충전 한도 여유(${capacity.toLocaleString()}원)가 총 금액보다 적습니다. 한도를 늘리거나 카드를 추가 발급하세요.`);
  }

  const amounts = splitAmount(total, count);
  // 큰 금액부터 한도 여유가 있는 카드 중 배정 건수가 가장 적은 카드에
  const order = amounts.map((a, i) => i).sort((a, b) => amounts[b] - amounts[a]);
  const assign = new Array(count);
  for (const i of order) {
    let best = null;
    for (const c of cards) {
      if (c.room < amounts[i]) continue;
      if (!best || c.n < best.n || (c.n === best.n && c.r < best.r)) best = c;
    }
    if (!best) throw bad(`${corpName}: 카드별 충전 한도 때문에 ${amounts[i].toLocaleString()}원을 배정할 카드가 없습니다.`);
    best.room -= amounts[i];
    best.n += 1;
    best.r = rnd();
    assign[i] = best.id;
  }

  const idx = shuffle(amounts.map((_, i) => i));
  const times = randomTimes(record.record_date, count);
  idx.forEach((i, k) => {
    applyTransaction({
      card_id: assign[i], pg_id: record.pg_id || null, type: 'CHARGE', amount: amounts[i],
      memo: `거래내역 #${record.id} 배분`, transacted_at: times[k], created_by: userId, record_id: record.id,
    });
  });
  return { count, amount: total, cards: cards.filter((c) => c.n > 0).length };
}

/** 배분된 충전 거래를 취소하고 카드 잔액을 되돌린다 (DB 트랜잭션 안에서 호출) */
export function revertAllocation(recordId) {
  const txs = db.prepare("SELECT id, card_id, amount FROM transactions WHERE record_id = ? AND status = 'APPROVED' AND type = 'CHARGE'").all(recordId);
  if (!txs.length) return 0;
  const byCard = new Map();
  for (const t of txs) byCard.set(t.card_id, (byCard.get(t.card_id) || 0) + t.amount);
  for (const [cardId, amt] of byCard) {
    const card = db.prepare('SELECT card_no, balance FROM cards WHERE id = ?').get(cardId);
    if (card.balance < amt) {
      throw bad(`카드 ${card.card_no.slice(-4)}의 잔액(${card.balance.toLocaleString()}원)이 배분된 충전액(${amt.toLocaleString()}원)보다 적어 되돌릴 수 없습니다.`);
    }
  }
  for (const [cardId, amt] of byCard) db.prepare('UPDATE cards SET balance = balance - ? WHERE id = ?').run(amt, cardId);
  db.prepare("UPDATE transactions SET status = 'CANCELLED' WHERE record_id = ? AND status = 'APPROVED'").run(recordId);
  return txs.length;
}
