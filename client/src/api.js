let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

/** GitHub Pages 데모 빌드 여부 (서버 없이 브라우저 안에서 동작) */
export const IS_DEMO = import.meta.env.MODE === 'demo';

async function send(method, url, body) {
  if (import.meta.env.MODE === 'demo') {
    const { handle } = await import('./demo/server.js');
    const r = await handle(method, `/api${url}`, body);
    return { ok: r.status < 400, status: r.status, data: r.body, headers: r.headers || {} };
  }
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  return { ok: res.ok, status: res.status, data, headers: { 'content-disposition': res.headers.get('content-disposition') } };
}

async function request(method, url, body) {
  const r = await send(method, url, body);
  if (!r.ok) {
    if (r.status === 401 && !url.startsWith('/auth/login')) onUnauthorized();
    throw new Error(r.data?.error || `요청 실패 (${r.status})`);
  }
  return r.data;
}

export const api = {
  get: (url, params) => request('GET', params ? `${url}?${qs(params)}` : url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  /** 파일 다운로드 (CSV 등) */
  async download(url, params, fallbackName) {
    const r = await send('GET', `${url}?${qs(params)}`);
    if (!r.ok) {
      if (r.status === 401) onUnauthorized();
      throw new Error(r.data?.error || `다운로드 실패 (${r.status})`);
    }
    const name = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')?.[1] || fallbackName;
    const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
}
