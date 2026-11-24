import crypto from 'node:crypto';
import { db, tx } from './db.js';
import { hashPassword } from './auth.js';
import { generateCardNo } from './routes/cards.js';
import { newApprovalNo } from './ledger.js';

/** 사용자가 한 명도 없으면 기본 최고 관리자 계정을 생성 */
export function ensureAdmin() {
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (n > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  db.prepare("INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, '최고관리자', 'SUPER_ADMIN')")
    .run(username, hashPassword(password));
  console.log(`[seed] 기본 관리자 계정 생성: ${username} (최초 로그인 후 비밀번호를 변경하세요)`);
}

const rand = (min, max) => crypto.randomInt(min, max + 1);
const choice = (arr) => arr[rand(0, arr.length - 1)];
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDateTime = (d) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 데이터가 비어있으면 데모 데이터를 생성 (가상의 법인/PG) */
export function seedDemo() {
  if (db.prepare('SELECT COUNT(*) n FROM corporations').get().n > 0) return;

  tx(() => {
    const corps = [
      ['(주)한결테크', '214-81-10001', '김한결', '서울 강남구 테헤란로 100'],
      ['(주)누리물류', '120-86-20002', '이누리', '경기 성남시 분당구 판교로 200'],
      ['바른식품(주)', '305-81-30003', '박바른', '대전 유성구 대학로 30'],
      ['(주)온새미로', '617-86-40004', '최온새', '부산 해운대구 센텀로 40'],
      ['(주)다솜건설', '410-81-50005', '정다솜', '광주 서구 상무대로 50'],
      ['(주)미리내소프트', '107-87-60006', '윤미리', '서울 마포구 월드컵북로 60'],
    ];
    const corpIds = corps.map(([name, biz, ceo, addr], i) => Number(db.prepare(`
      INSERT INTO corporations (name, biz_no, ceo_name, phone, email, address, contract_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      name, biz, ceo, `02-555-${1000 + i}`, `contact${i + 1}@example.com`, addr,
      `2025-${pad(i + 1)}-15`, i === 5 ? 'INACTIVE' : 'ACTIVE',
    ).lastInsertRowid));

    const pgs = [
      ['한빛페이먼츠', 'HANBIT', 'hanbit0001', 2.5, 'D+1'],
      ['누리PG', 'NURIPG', 'nuri_m_7781', 2.2, 'D+2'],
      ['바른결제', 'BAREUN', 'brn-55120', 2.8, 'D+1'],
      ['스마트정산', 'SMARTPAY', 'smt000912', 1.9, 'D+3'],
    ];
    const pgRows = pgs.map(([name, code, mid, fee, cycle], i) => {
      const id = Number(db.prepare(`
        INSERT INTO pgs (name, code, mid, fee_rate, settlement_cycle, manager_name, manager_phone, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`).run(name, code, mid, fee, cycle, `담당자${i + 1}`, `010-1234-${5000 + i}`).lastInsertRowid);
      return { id, fee };
    });

    const names = ['김민준', '이서연', '박도윤', '최하은', '정시우', '강지유', '조예준', '윤수아', '장주원', '임하린',
      '한지호', '오서윤', '서건우', '신채원', '권우진', '황지민', '안현우', '송다은', '류은우', '전소율'];
    const merchants = ['GS편의점', '스타벅스코리아', '이마트', '쿠팡', '카카오T', '배달의민족', 'CU편의점', '올리브영',
      '교보문고', '코레일', '대한항공', '롯데마트', '다이소', '맥도날드', '주유소'];

    const now = new Date();
    const cards = [];
    for (let i = 0; i < 24; i++) {
      const corpIdx = i % 5; // 비활성 법인 제외
      const issued = new Date(now);
      issued.setDate(issued.getDate() - 120 + rand(0, 10));
      const exp = new Date(issued);
      exp.setFullYear(exp.getFullYear() + 5);
      const status = i === 22 ? 'SUSPENDED' : i === 23 ? 'LOST' : 'ACTIVE';
      const id = Number(db.prepare(`
        INSERT INTO cards (card_no, corporation_id, holder_name, balance, limit_amount, status, issued_at, expires_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)`).run(
        generateCardNo(), corpIds[corpIdx], names[i % names.length], choice([0, 2_000_000, 5_000_000]),
        status, fmtDate(issued), fmtDate(exp),
      ).lastInsertRowid);
      cards.push({ id, corp: corpIds[corpIdx], balance: 0 });
    }

    // 최근 90일 거래 시뮬레이션 (시간순, 잔액 일관성 유지)
    const events = [];
    for (const card of cards) {
      const n = rand(15, 35);
      for (let k = 0; k < n; k++) {
        const d = new Date(now);
        d.setDate(d.getDate() - rand(0, 89));
        d.setHours(rand(8, 22), rand(0, 59), rand(0, 59));
        if (d > now) d.setTime(now.getTime() - rand(1, 600) * 60_000);
        events.push({ card, at: d });
      }
    }
    events.sort((a, b) => a.at - b.at);

    const ins = db.prepare(`
      INSERT INTO transactions (card_id, corporation_id, pg_id, type, amount, fee, merchant_name, approval_no, status, transacted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const { card, at } of events) {
      const pg = choice(pgRows);
      let type;
      let amount;
      if (card.balance < 50_000 || rand(1, 100) <= 15) {
        type = 'CHARGE';
        amount = choice([100_000, 200_000, 300_000, 500_000, 1_000_000]);
      } else if (rand(1, 100) <= 6) {
        type = 'REFUND';
        amount = rand(1, 50) * 1000;
      } else {
        type = 'PAYMENT';
        amount = Math.min(card.balance, rand(3, 150) * 1000);
      }
      const status = rand(1, 100) <= 4 ? 'CANCELLED' : 'APPROVED';
      if (status === 'APPROVED') card.balance += type === 'PAYMENT' ? -amount : amount;
      const fee = type === 'PAYMENT' ? Math.round((amount * pg.fee) / 100) : 0;
      ins.run(card.id, card.corp, type === 'CHARGE' && rand(0, 1) ? null : pg.id, type, amount, fee,
        type === 'CHARGE' ? null : choice(merchants), newApprovalNo(), status, fmtDateTime(at));
    }
    const upd = db.prepare('UPDATE cards SET balance = ? WHERE id = ?');
    for (const c of cards) upd.run(c.balance, c.id);

    // 거래내역(수동 입력) 데모: 최근 90일, 활성 법인별로 2~3일마다 거래건수/총 금액 입력
    const recIns = db.prepare(`
      INSERT INTO tx_records (record_date, corporation_id, pg_id, tx_count, total_amount, memo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const scale = [1.6, 1.2, 0.8, 1.0, 0.6]; // 법인별 규모 차이
    for (let day = 89; day >= 0; day--) {
      const d = new Date(now);
      d.setDate(d.getDate() - day);
      corpIds.slice(0, 5).forEach((corpId, ci) => {
        if (rand(1, 100) > 45) return;
        const count = Math.max(1, Math.round(rand(3, 40) * scale[ci]));
        const amount = count * rand(8, 60) * 1000;
        recIns.run(fmtDate(d), corpId, choice(pgRows).id, count, amount, null, `${fmtDate(d)} 18:00:00`);
      });
    }

    // 데모용 일반 사용자(로그인 불가) & 관리자 — 공개 배포 시에는 SEED_DEMO_USERS=false 로 생성하지 않음
    if (process.env.SEED_DEMO_USERS === 'false') return;
    db.prepare("INSERT INTO users (username, password_hash, name, email, role) VALUES ('manager01', ?, '운영관리자', 'manager01@example.com', 'ADMIN')")
      .run(hashPassword('manager1234'));
    db.prepare("INSERT INTO users (username, password_hash, name, email, role) VALUES ('user01', ?, '일반사용자', 'user01@example.com', 'USER')")
      .run(hashPassword('user12345'));
  });
  console.log('[seed] 데모 데이터 생성 완료');
}
