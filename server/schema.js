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

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_no TEXT NOT NULL UNIQUE,
  corporation_id INTEGER NOT NULL REFERENCES corporations(id),
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
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(transacted_at);
CREATE INDEX IF NOT EXISTS idx_tx_corp ON transactions(corporation_id);
CREATE INDEX IF NOT EXISTS idx_tx_card ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_tx_pg ON transactions(pg_id);
`;
