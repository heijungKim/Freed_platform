/**
 * 브라우저 데모용 비밀번호 해시 (동기식, 솔트 포함).
 * 데모는 모든 데이터가 각자의 브라우저 안에만 있으므로 보안 목적이 아닌 동작 재현용이다.
 * 실제 서버는 server/password.js(scrypt)를 사용한다.
 */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function digest(password, salt) {
  let h = `${salt}:${password}`;
  for (let i = 0; i < 1000; i++) h = cyrb53(h, i) + cyrb53(h, i + 7919);
  return h;
}

export function hashPassword(password) {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  const salt = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${digest(password, salt)}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  return Boolean(salt && hash) && digest(password, salt) === hash;
}
