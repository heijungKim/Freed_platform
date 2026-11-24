/**
 * 브라우저 데모에서 Node 전용 모듈을 대체하는 최소 구현.
 * - node:crypto  → randomBytes / randomInt
 * - express      → Router
 */

/* ---------- node:crypto ---------- */
function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return {
    toString: () => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  const range = max - min;
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return min + (a[0] % range);
}
export const crypto = { randomBytes, randomInt };
export default crypto;

/* ---------- express.Router ---------- */
function compile(path) {
  const keys = [];
  const pattern = path
    .replace(/[.]/g, '\\.')
    .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp(`^${pattern}/?$`), keys };
}

export function Router() {
  const stack = [];
  const add = (method) => (path, ...handlers) => {
    stack.push({ method, ...compile(path), handlers });
    return router;
  };
  const router = {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'),
    /** 경로/메서드에 맞는 라우트 찾기 */
    match(method, path) {
      for (const r of stack) {
        if (r.method !== method) continue;
        const m = r.re.exec(path);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
          return { handlers: r.handlers, params };
        }
      }
      return null;
    },
  };
  return router;
}
