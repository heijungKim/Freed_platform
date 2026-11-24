import { db } from './db.js';
import { ensureAdmin, seedDemo } from './seed.js';

// `npm run seed -- --reset` : 모든 데이터 초기화 후 재생성
if (process.argv.includes('--reset')) {
  db.exec('DELETE FROM settlements; DELETE FROM tx_records; DELETE FROM transactions; DELETE FROM cards; DELETE FROM issuers; DELETE FROM pgs; DELETE FROM corporations; DELETE FROM sessions; DELETE FROM users;');
}
ensureAdmin();
seedDemo();
