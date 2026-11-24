/**
 * 브라우저 데모용 DB: sql.js(SQLite WASM)를 node:sqlite DatabaseSync와 같은 형태로 감싼다.
 * 서버 코드(server/*.js)가 그대로 동작하도록 `db`, `tx`를 동일하게 export.
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { SCHEMA, migrate } from '../../../server/schema.js';

const STORAGE_KEY = 'freed-erp-demo-db-v3';
let raw = null; // sql.js Database
let dirty = false;

const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

class Statement {
  constructor(sql) { this.sql = sql; }
  all(...params) {
    const s = raw.prepare(this.sql);
    try {
      s.bind(norm(params));
      const rows = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    } finally { s.free(); }
  }
  get(...params) { return this.all(...params)[0]; }
  run(...params) {
    raw.run(this.sql, norm(params));
    dirty = true;
    const changes = raw.getRowsModified();
    const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
    return { changes, lastInsertRowid };
  }
}

export const db = {
  prepare: (sql) => new Statement(sql),
  exec: (sql) => { raw.exec(sql); dirty = true; },
};

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function load() {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

/** 변경된 DB를 브라우저(localStorage)에 저장 */
export function persist() {
  if (!dirty || !raw) return;
  try {
    const bytes = raw.export();
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    localStorage.setItem(STORAGE_KEY, btoa(bin));
    dirty = false;
  } catch { /* 저장 불가(시크릿 모드 등) → 메모리에서만 동작 */ }
}

export function resetStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** @returns true 이면 새 DB (시드 필요) */
export async function initDb() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = load();
  try {
    raw = saved ? new SQL.Database(saved) : new SQL.Database();
  } catch {
    raw = new SQL.Database();
  }
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  migrate(db);
  return !saved;
}
