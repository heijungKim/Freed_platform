/** 공용 DB 스키마 (서버 / 브라우저 데모 공용) */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN','ADMIN','USER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS corporations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  biz_no TEXT NOT NULL UNIQUE,
  ceo_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  contract_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  mid TEXT,
  fee_rate REAL NOT NULL DEFAULT 0,
  settlement_cycle TEXT DEFAULT 'D+1',
  manager_name TEXT,
  manager_phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 선불사업자 (선불전자지급수단 발행업자)
CREATE TABLE IF NOT EXISTS issuers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  biz_no TEXT NOT NULL UNIQUE,
  reg_no TEXT,
  ceo_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  bin TEXT NOT NULL UNIQUE,
  protection_type TEXT NOT NULL DEFAULT 'TRUST' CHECK (protection_type IN ('TRUST','GUARANTEE','DEPOSIT')),
  protection_amount INTEGER NOT NULL DEFAULT 0,
  registered_at TEXT,
  manager_name TEXT,
  manager_phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_no TEXT NOT NULL UNIQUE,
  corporation_id INTEGER NOT NULL REFERENCES corporations(id),
  issuer_id INTEGER REFERENCES issuers(id),
  holder_name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  limit_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','LOST','EXPIRED')),
  issued_at TEXT,
  expires_at TEXT,
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id),
  corporation_id INTEGER NOT NULL REFERENCES corporations(id),
  pg_id INTEGER REFERENCES pgs(id),
  type TEXT NOT NULL CHECK (type IN ('CHARGE','PAYMENT','REFUND')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  fee INTEGER NOT NULL DEFAULT 0,
  merchant_name TEXT,
  approval_no TEXT,
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED','CANCELLED','FAILED')),
  memo TEXT,
  transacted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER REFERENCES users(id),
  record_id INTEGER -- 거래내역(tx_records) 자동 배분으로 생성된 경우
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(transacted_at);
CREATE INDEX IF NOT EXISTS idx_tx_corp ON transactions(corporation_id);
CREATE INDEX IF NOT EXISTS idx_tx_card ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_tx_pg ON transactions(pg_id);

-- 거래내역 (수동 입력): 법인별 일자별 거래건수 / 총 금액
CREATE TABLE IF NOT EXISTS tx_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date TEXT NOT NULL,
  corporation_id INTEGER NOT NULL REFERENCES corporations(id),
  pg_id INTEGER REFERENCES pgs(id),
  tx_count INTEGER NOT NULL CHECK (tx_count >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  memo TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rec_date ON tx_records(record_date);
CREATE INDEX IF NOT EXISTS idx_rec_corp ON tx_records(corporation_id);
CREATE INDEX IF NOT EXISTS idx_rec_pg ON tx_records(pg_id);

-- 법인이 사용하는 PG (계약/연동 PG)
CREATE TABLE IF NOT EXISTS corporation_pgs (
  corporation_id INTEGER NOT NULL REFERENCES corporations(id) ON DELETE CASCADE,
  pg_id INTEGER NOT NULL REFERENCES pgs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (corporation_id, pg_id)
);
CREATE INDEX IF NOT EXISTS idx_corp_pgs_pg ON corporation_pgs(pg_id);
`;

/** 기존 DB 업그레이드 (컬럼 추가 등). db: prepare/exec 를 가진 객체 */
export function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
  if (!cols.includes('issuer_id')) db.exec('ALTER TABLE cards ADD COLUMN issuer_id INTEGER REFERENCES issuers(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cards_issuer ON cards(issuer_id)');
  const txCols = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
  if (!txCols.includes('record_id')) db.exec('ALTER TABLE transactions ADD COLUMN record_id INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tx_record ON transactions(record_id)');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 1) {
    // v1: 법인-PG 연결 도입 → 기존 거래내역에 입력된 PG로 1회 자동 채움
    db.exec(`INSERT OR IGNORE INTO corporation_pgs (corporation_id, pg_id)
      SELECT DISTINCT corporation_id, pg_id FROM tx_records WHERE pg_id IS NOT NULL`);
    db.exec('PRAGMA user_version = 1');
  }
}
