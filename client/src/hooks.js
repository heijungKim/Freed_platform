import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** 목록 조회 + 필터 + 페이지네이션 공통 훅 */
export function useList(url, initialFilters = {}, size = 20) {
  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await api.get(url, { ...applied, page, size });
      if (id === reqId.current) { setData(d); setError(''); }
    } catch (e) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [url, applied, page, size]);

  useEffect(() => { load(); }, [load]);

  return {
    data, loading, error, page, size, filters, applied,
    setFilter: (k, v) => setFilters((f) => ({ ...f, [k]: v })),
    search: () => { setPage(1); setApplied({ ...filters }); },
    reset: () => { setFilters(initialFilters); setApplied(initialFilters); setPage(1); },
    setPage,
    reload: load,
  };
}

export function useOptions(url) {
  const [opts, setOpts] = useState([]);
  const load = useCallback(() => api.get(url).then(setOpts).catch(() => {}), [url]);
  useEffect(() => { load(); }, [load]);
  return [opts, load];
}
