/**
 * 거래내역(수동 입력) → 법인 선불카드 충전 자동 배분
 *
 * 거래건수 N, 총 금액 A 를 입력하면 해당 법인의 정상(ACTIVE) 카드들에
 * 금액이 서로 다른 충전 거래 N건을 만들어 합계가 정확히 A 가 되도록 나눈다.
 * 실제 사용처럼 '균등하지 않게' 나눈다:
 *  - 금액: 로그정규 분포(소액 다수 + 고액 일부), 100원 단위 금액도 섞임
 *  - 카드: 카드마다 사용량 가중치를 무작위로 부여(많이 쓰는 카드/적게 쓰는 카드/미사용 카드),
 *          가중치 비례 무작위 배정, 카드 충전 한도 준수
 *  - 시각: 거래일 09:00~21:59 사이 무작위 (오늘이면 현재 시각 이전)
 */
import crypto from 'node:crypto';
import { db } from './db.js';
import { applyTransaction } from './ledger.js';
import { bad } from './util.js';

export const MAX_ALLOC_COUNT = 5000;

const rnd = () => crypto.randomInt(0, 1_000_000) / 1_000_000;
/** 표준정규 난수 (Box-Muller) */
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd() * 0.999999)) * Math.cos(2 * Math.PI * rnd());
/** 로그정규 가중치: 평균 1 근처, sigma 클수록 편차 큼 */
const logNormal = (sigma) => Math.exp(gauss() * sigma);
const pad = (n) => String(n).padStart(2, '0');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 합계가 정확히 total 이 되는 count 개의 금액 (균등하지 않게)
 *  - 기본 100원 단위(불가능하면 1원), 약 70%는 1,000원 단위로 반올림해 자연스럽게
 */
export function splitAmount(total, count) {
  if (count < 1) throw bad('거래건수는 1건 이상이어야 합니다.');
  if (total < count) throw bad(`총 금액(${total.toLocaleString()}원)은 거래건수(${count.toLocaleString()}건) 이상이어야 합니다.`);
  const unit = total >= count * 100 ? 100 : 1;
  const units = Math.floor(total / unit);
  const leftover = total - units * unit;

  // 로그정규 가중치: 소액이 많고 고액이 가끔 (편차 큼)
  const weights = Array.from({ length: count }, () => logNormal(0.85));
  const wsum = weights.reduce((s, w) => s + w, 0);
  const extra = units - count; // 각 1단위씩 먼저 배정
  const parts = weights.map((w) => 1 + Math.floor((extra * w) / wsum));
  // 일부 금액은 1,000원 단위로 맞춤 (차액은 나머지로 이동)
  const free = []; // 1,000원 단위로 맞추지 않은 금액 (차액 조정용)
  for (let i = 0; i < count; i++) {
    if (unit === 100 && rnd() < 0.7 && parts[i] >= 10) parts[i] = Math.max(10, Math.round(parts[i] / 10) * 10);
    else free.push(i);
  }
  if (!free.length) free.push(crypto.randomInt(0, count));
  let diff = units - parts.reduce((s, v) => s + v, 0);
  // 차액 조정: 우선 단위를 맞추지 않은 금액에서, 1단위 미만으로 내려가지 않게
  let guard = 0;
  while (diff !== 0 && guard++ < 1_000_000) {
    const pool = guard > 10_000 ? null : free; // 조정이 오래 걸리면 전체에서
    const i = pool ? pool[crypto.randomInt(0, pool.length)] : crypto.randomInt(0, count);
    if (diff > 0) {
      const add = Math.min(diff, 1 + crypto.randomInt(0, Math.max(1, Math.ceil(diff / count))));
      parts[i] += add; diff -= add;
    } else if (parts[i] > 1) {
      const sub = Math.min(-diff, parts[i] - 1, 1 + crypto.randomInt(0, Math.max(1, Math.ceil(-diff / count))));
      parts[i] -= sub; diff += sub;
    }
  }

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
    .map((c) => ({ id: c.id, room: c.limit_amount > 0 ? Math.max(0, c.limit_amount - c.balance) : Infinity, n: 0, w: logNormal(1.1) }));
  if (!cards.length) throw bad(`${corpName}: 정상 상태의 발급 카드가 없어 배분할 수 없습니다. 먼저 카드를 발급하세요.`);
  const capacity = cards.reduce((s, c) => s + c.room, 0);
  if (capacity < total) {
    throw bad(`${corpName}: 카드 충전 한도 여유(${capacity.toLocaleString()}원)가 총 금액보다 적습니다. 한도를 늘리거나 카드를 추가 발급하세요.`);
  }

  const amounts = splitAmount(total, count);
  // 카드 사용량 가중치: 카드가 4장 이상이면 일부(약 20%)는 이번 배분에서 쉬게 함
  if (cards.length >= 4) {
    for (const c of cards) if (rnd() < 0.2) c.w = 0;
    if (!cards.some((c) => c.w > 0)) cards[crypto.randomInt(0, cards.length)].w = 1;
  }
  const pick = (list) => {
    const sumW = list.reduce((s, c) => s + c.w, 0);
    if (sumW <= 0) return list[crypto.randomInt(0, list.length)];
    let x = rnd() * sumW;
    for (const c of list) { x -= c.w; if (x <= 0) return c; }
    return list[list.length - 1];
  };
  // 큰 금액부터, 한도 여유가 있는 카드 중 가중치 비례 무작위 (쉬는 카드는 다른 카드에 여유가 없을 때만)
  const order = amounts.map((a, i) => i).sort((a, b) => amounts[b] - amounts[a]);
  const assign = new Array(count);
  for (const i of order) {
    const fit = cards.filter((c) => c.room >= amounts[i]);
    if (!fit.length) throw bad(`${corpName}: 카드별 충전 한도 때문에 ${amounts[i].toLocaleString()}원을 배정할 카드가 없습니다.`);
    const active = fit.filter((c) => c.w > 0);
    const c = pick(active.length ? active : fit);
    c.room -= amounts[i];
    c.n += 1;
    assign[i] = c.id;
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

/* ---------- 배분된 충전 개별 수정 ---------- */

/** 입력의 거래건수/총 금액을 현재 배분 합계로 맞춘다 */
export function syncRecordTotals(recordId) {
  const s = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) a FROM transactions
    WHERE record_id = ? AND status = 'APPROVED'`).get(recordId);
  db.prepare("UPDATE tx_records SET tx_count = ?, total_amount = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(s.n, s.a, recordId);
  return { tx_count: s.n, total_amount: s.a };
}

function loadCard(cardId, corporationId) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) throw bad('카드를 찾을 수 없습니다.');
  if (card.corporation_id !== corporationId) throw bad('이 법인에 발급된 카드만 선택할 수 있습니다.');
  return card;
}

function checkRoom(card, add) {
  if (card.limit_amount > 0 && card.balance + add > card.limit_amount) {
    throw bad(`카드 ${card.card_no.slice(-4)}의 충전 한도(${card.limit_amount.toLocaleString()}원)를 초과합니다. (현재 잔액 ${card.balance.toLocaleString()}원)`);
  }
}

function getAllocTx(recordId, txId) {
  const t = db.prepare("SELECT * FROM transactions WHERE id = ? AND record_id = ? AND status = 'APPROVED'").get(txId, recordId);
  if (!t) throw bad('배분된 충전 거래를 찾을 수 없습니다.');
  return t;
}

/** 충전 1건 추가 */
export function addAllocation(record, { card_id, amount, transacted_at }, userId) {
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt < 1) throw bad('금액은 1원 이상의 정수여야 합니다.');
  const card = loadCard(Number(card_id), record.corporation_id);
  if (card.status !== 'ACTIVE') throw bad('정상 상태의 카드에만 충전할 수 있습니다.');
  checkRoom(card, amt);
  const time = transacted_at || randomTimes(record.record_date, 1)[0];
  applyTransaction({
    card_id: card.id, pg_id: record.pg_id || null, type: 'CHARGE', amount: amt,
    memo: `거래내역 #${record.id} 배분 (수동 추가)`, transacted_at: time, created_by: userId, record_id: record.id,
  });
  return syncRecordTotals(record.id);
}

/** 충전 1건 수정: 금액 / 카드 변경 */
export function updateAllocation(record, txId, { card_id, amount }) {
  const t = getAllocTx(record.id, txId);
  const amt = amount === undefined || amount === '' ? t.amount : Number(amount);
  if (!Number.isInteger(amt) || amt < 1) throw bad('금액은 1원 이상의 정수여야 합니다.');
  const newCardId = card_id ? Number(card_id) : t.card_id;
  const oldCard = loadCard(t.card_id, record.corporation_id);

  if (newCardId === t.card_id) {
    const diff = amt - t.amount;
    if (diff < 0 && oldCard.balance < -diff) throw bad(`카드 잔액(${oldCard.balance.toLocaleString()}원)이 부족해 금액을 줄일 수 없습니다.`);
    if (diff > 0) checkRoom(oldCard, diff);
    db.prepare('UPDATE cards SET balance = balance + ? WHERE id = ?').run(diff, oldCard.id);
  } else {
    const newCard = loadCard(newCardId, record.corporation_id);
    if (newCard.status !== 'ACTIVE') throw bad('정상 상태의 카드로만 옮길 수 있습니다.');
    if (oldCard.balance < t.amount) throw bad(`기존 카드 잔액(${oldCard.balance.toLocaleString()}원)이 부족해 다른 카드로 옮길 수 없습니다.`);
    checkRoom(newCard, amt);
    db.prepare('UPDATE cards SET balance = balance - ? WHERE id = ?').run(t.amount, oldCard.id);
    db.prepare('UPDATE cards SET balance = balance + ? WHERE id = ?').run(amt, newCard.id);
  }
  db.prepare("UPDATE transactions SET amount = ?, card_id = ?, memo = ? WHERE id = ?")
    .run(amt, newCardId, `거래내역 #${record.id} 배분 (수정됨)`, t.id);
  return syncRecordTotals(record.id);
}

/** 충전 1건 삭제(취소) */
export function removeAllocation(record, txId) {
  const t = getAllocTx(record.id, txId);
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(t.card_id);
  if (card.balance < t.amount) throw bad(`카드 잔액(${card.balance.toLocaleString()}원)이 충전액보다 적어 삭제할 수 없습니다.`);
  db.prepare('UPDATE cards SET balance = balance - ? WHERE id = ?').run(t.amount, card.id);
  db.prepare("UPDATE transactions SET status = 'CANCELLED' WHERE id = ?").run(t.id);
  return syncRecordTotals(record.id);
}
