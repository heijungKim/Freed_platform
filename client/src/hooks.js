import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** 목록 조회 + 필터 + 페이지네이션 공통 훅 */
export function useList(url, initialFilters = {}, size = 20) {
  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [colFilters, setColFilters] = useState({});
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const cf = Object.fromEntries(Object.entries(colFilters).map(([k, v]) => [`f_${k}`, v]));
      const d = await api.get(url, { ...applied, ...cf, page, size });
      if (id === reqId.current) { setData(d); setError(''); }
    } catch (e) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [url, applied, colFilters, page, size]);

  useEffect(() => { load(); }, [load]);

  return {
    data, loading, error, page, size, filters, applied,
    setFilter: (k, v) => setFilters((f) => ({ ...f, [k]: v })),
    search: () => { setPage(1); setApplied({ ...filters }); },
    reset: () => { setFilters(initialFilters); setApplied(initialFilters); setColFilters({}); setPage(1); },
    /** 필터 값을 바꾸고 즉시 조회 */
    applyFilter: (k, v) => {
      setFilters((f) => ({ ...f, [k]: v }));
      setApplied((a) => ({ ...a, [k]: v }));
      setPage(1);
    },
    /** 테이블 헤더 필터 (DataTable 에 colFilters / onColFilter 로 전달) */
    colFilters,
    onColFilter: (k, v) => { setColFilters((f) => ({ ...f, [k]: v })); setPage(1); },
    /** 현재 조회 조건 전체 (CSV 등) */
    query: () => ({ ...applied, ...Object.fromEntries(Object.entries(colFilters).map(([k, v]) => [`f_${k}`, v])) }),
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
