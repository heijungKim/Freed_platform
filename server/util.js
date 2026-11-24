export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (what = '데이터') => new HttpError(404, `${what}을(를) 찾을 수 없습니다.`);

/** 요청 body에서 허용된 필드만 추출 (빈 문자열은 null) */
export function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    if (body[f] === undefined) continue;
    out[f] = body[f] === '' ? null : body[f];
  }
  return out;
}

export function requireFields(obj, fields) {
  for (const [key, label] of Object.entries(fields)) {
    if (obj[key] === undefined || obj[key] === null || String(obj[key]).trim() === '') {
      throw bad(`${label}은(는) 필수 입력 항목입니다.`);
    }
  }
}

export function oneOf(value, allowed, label) {
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    throw bad(`${label} 값이 올바르지 않습니다.`);
  }
}

export function toInt(value, label, { min = 0 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw bad(`${label}은(는) ${min} 이상의 정수여야 합니다.`);
  return n;
}

export function paging(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(query.size, 10) || 20));
  return { page, size, offset: (page - 1) * size };
}

/** INSERT 헬퍼 */
export function insertSql(table, data) {
  const keys = Object.keys(data);
  return {
    sql: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    params: keys.map((k) => data[k]),
  };
}

/** UPDATE 헬퍼 */
export function updateSql(table, data, id) {
  const keys = Object.keys(data);
  return {
    sql: `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    params: [...keys.map((k) => data[k]), id],
  };
}

export const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r instanceof Promise) r.catch(next);
  } catch (e) {
    next(e);
  }
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function dateParam(v, label) {
  if (v === undefined || v === '') return null;
  if (!DATE_RE.test(v)) throw bad(`${label} 형식은 YYYY-MM-DD 이어야 합니다.`);
  return v;
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // 스프레드시트 수식 주입 방지
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 테이블 헤더 필터: 쿼리스트링 f_<컬럼키>=값 을 WHERE 조건으로 변환
 * map: { key: 'SQL식' (부분일치) | { sql, exact: true } (정확히 일치) | { sql, num: true } (숫자, 콤마 무시 부분일치) }
 */
export function columnFilters(query, map, where, params) {
  for (const [key, def] of Object.entries(map)) {
    let v = query[`f_${key}`];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    v = String(v).trim();
    const d = typeof def === 'string' ? { sql: def } : def;
    if (d.exact) {
      where.push(`${d.sql} = ?`);
      params.push(v);
    } else {
      if (d.num) v = v.replace(/[,원%\s]/g, '');
      where.push(`CAST(${d.sql} AS TEXT) LIKE ? ESCAPE '\\'`);
      params.push(`%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
  }
}
