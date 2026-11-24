import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { bad, notFound } from './util.js';

const TYPES = ['CHARGE', 'PAYMENT', 'REFUND'];

/** 거래 유형별 잔액 증감 부호 */
const SIGN = { CHARGE: 1, PAYMENT: -1, REFUND: 1 };

export function newApprovalNo() {
  return String(crypto.randomInt(10_000_000, 99_999_999));
}

/**
 * 거래 생성 + 잔액 반영 (트랜잭션 없이). 이미 열린 DB 트랜잭션 안에서 호출할 때 사용.
 * @returns 생성된 거래 id
 */
export function applyTransaction({ card_id, pg_id, type, amount, merchant_name, memo, transacted_at, created_by }) {
  if (!TYPES.includes(type)) throw bad('거래 유형이 올바르지 않습니다.');
  amount = Number(amount);
  if (!Number.isInteger(amount) || amount <= 0) throw bad('금액은 1원 이상의 정수여야 합니다.');

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(card_id);
  if (!card) throw notFound('선불카드');
  if (card.status !== 'ACTIVE') throw bad('사용 가능한 상태의 카드가 아닙니다.');

  let pg = null;
  if (pg_id) {
    pg = db.prepare('SELECT * FROM pgs WHERE id = ?').get(pg_id);
    if (!pg) throw notFound('PG');
    if (pg.status !== 'ACTIVE') throw bad('비활성화된 PG입니다.');
  }
  if (type === 'PAYMENT' && !pg) throw bad('결제 거래는 PG를 선택해야 합니다.');

  const newBalance = card.balance + SIGN[type] * amount;
  if (newBalance < 0) throw bad(`잔액이 부족합니다. (현재 잔액 ${card.balance.toLocaleString()}원)`);
  if (SIGN[type] > 0 && card.limit_amount > 0 && newBalance > card.limit_amount) {
    throw bad(`충전 한도(${card.limit_amount.toLocaleString()}원)를 초과합니다.`);
  }

  const fee = type === 'PAYMENT' && pg ? Math.round((amount * pg.fee_rate) / 100) : 0;
  db.prepare('UPDATE cards SET balance = ? WHERE id = ?').run(newBalance, card.id);
  const r = db.prepare(`
    INSERT INTO transactions (card_id, corporation_id, pg_id, type, amount, fee, merchant_name, approval_no, status, memo, transacted_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, COALESCE(?, datetime('now','localtime')), ?)`).run(
    card.id, card.corporation_id, pg?.id ?? null, type, amount, fee,
    merchant_name ?? null, newApprovalNo(), memo ?? null, transacted_at ?? null, created_by ?? null,
  );
  return Number(r.lastInsertRowid);
}

/** 거래를 생성하고 카드 잔액을 반영한다. (원자적) */
export function createTransaction(input) {
  return tx(() => applyTransaction(input));
}

/** 승인된 거래를 취소하고 카드 잔액을 원복한다. */
export function cancelTransaction(id) {
  return tx(() => {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!t) throw notFound('거래');
    if (t.status !== 'APPROVED') throw bad('승인 상태의 거래만 취소할 수 있습니다.');
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(t.card_id);
    const newBalance = card.balance - SIGN[t.type] * t.amount;
    if (newBalance < 0) throw bad('카드 잔액이 부족하여 취소할 수 없습니다.');
    db.prepare('UPDATE cards SET balance = ? WHERE id = ?').run(newBalance, card.id);
    db.prepare("UPDATE transactions SET status = 'CANCELLED' WHERE id = ?").run(id);
  });
}
