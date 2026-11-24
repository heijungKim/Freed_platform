import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const r = (p) => path.resolve(__dirname, p);

/**
 * `--mode demo` : GitHub Pages용 빌드. 서버 코드(server/)를 브라우저에서 실행하기 위해
 * Node 전용 모듈(express, node:crypto, node:sqlite DB, scrypt 해시)을 브라우저 구현으로 바꿔 끼운다.
 */
function demoShims() {
  const serverDir = r('server') + path.sep;
  return {
    name: 'freed-demo-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !importer.startsWith(serverDir)) return null;
      if (source === 'express' || source === 'node:crypto') return r('client/src/demo/shims.js');
      const abs = source.startsWith('.') ? path.resolve(path.dirname(importer), source) : null;
      if (abs === r('server/db.js')) return r('client/src/demo/db.js');
      if (abs === r('server/password.js')) return r('client/src/demo/password.js');
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'client',
    base: demo ? './' : '/',
    plugins: [react(), demo && demoShims()].filter(Boolean),
    define: demo ? { 'process.env': '{}' } : {},
    build: { outDir: demo ? '../dist-pages' : '../dist', emptyOutDir: true },
    server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  };
});
