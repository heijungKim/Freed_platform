import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { requireAdmin } from './auth.js';
import authRoutes from './routes/auth.js';
import corporationRoutes from './routes/corporations.js';
import pgRoutes from './routes/pgs.js';
import cardRoutes from './routes/cards.js';
import transactionRoutes from './routes/transactions.js';
import recordRoutes from './routes/records.js';
import issuerRoutes from './routes/issuers.js';
import statsRoutes from './routes/stats.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  // 이하 모든 API는 관리자 로그인 필요
  app.use('/api', requireAdmin);
  app.use('/api/corporations', corporationRoutes);
  app.use('/api/pgs', pgRoutes);
  app.use('/api/issuers', issuerRoutes); // 선불사업자
  app.use('/api/cards', cardRoutes);
  app.use('/api/transactions', transactionRoutes); // 카드 충전·사용 원장
  app.use('/api/records', recordRoutes); // 거래내역 (수동 입력)
  app.use('/api/stats', statsRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }));

  // 빌드된 프론트엔드 제공
  const dist = path.resolve('dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  return app;
}
