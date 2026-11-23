import { createApp } from './app.js';
import { ensureAdmin, seedDemo } from './seed.js';
import { purgeExpiredSessions } from './auth.js';

ensureAdmin();
if (process.env.SEED_DEMO !== 'false') seedDemo();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT) || 4000;
createApp().listen(PORT, () => {
  console.log(`Freed Platform ERP 서버 실행 중: http://localhost:${PORT}`);
});
