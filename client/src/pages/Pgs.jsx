import React, { useState } from 'react';
import { api } from '../api.js';
import { useList } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, useConfirm, useToast } from '../components/ui.jsx';
import { num, won } from '../format.js';

const FIELDS = [
  { name: 'name', label: 'PG사명', required: true },
  { name: 'code', label: 'PG 코드', required: true, placeholder: '영문 대문자', hint: '영문/숫자, 자동 대문자 변환' },
  { name: 'mid', label: '가맹점 ID (MID)' },
  { name: 'fee_rate', label: '수수료율 (%)', type: 'number', step: '0.01', min: '0', required: true },
  { name: 'settlement_cycle', label: '정산 주기', type: 'select', required: true, default: 'D+1',
    options: ['D+0', 'D+1', 'D+2', 'D+3', 'D+7', '월정산'].map((v) => ({ value: v, label: v })) },
  { name: 'status', label: '상태', type: 'select', required: true, default: 'ACTIVE',
    options: [{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }] },
  { name: 'manager_name', label: '담당자' },
  { name: 'manager_phone', label: '담당자 연락처' },
  { name: 'memo', label: '메모', type: 'textarea' },
];

export default function Pgs() {
  const list = useList('/pgs', { q: '', status: '' });
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (row) => {
    if (!(await confirm(`'${row.name}' PG를 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/pgs/${row.id}`);
      toast('삭제되었습니다.');
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'id', filter: true, label: 'No', width: 60 },
    { key: 'name', filter: true, label: 'PG사명', render: (r) => <strong>{r.name}</strong> },
    { key: 'code', filter: true, label: '코드', render: (r) => <code>{r.code}</code> },
    { key: 'mid', filter: true, label: 'MID' },
    { key: 'fee_rate', filter: true, label: '수수료율', align: 'right', render: (r) => `${r.fee_rate}%` },
    { key: 'settlement_cycle', filter: true, label: '정산주기' },
    { key: 'tx_count', filter: true, label: '누적 거래건수', align: 'right', render: (r) => num(r.tx_count) },
    { key: 'payment_amount', filter: true, label: '누적 거래금액', align: 'right', render: (r) => won(r.payment_amount) },
    { key: 'manager_name', filter: true, label: '담당자' },
    { key: 'status', label: '상태', filter: [{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }], render: (r) => <Badge value={r.status} /> },
    { key: 'actions', label: '', align: 'right', render: (r) => (
      <div className="row-actions">
        <button className="btn btn-sm" onClick={() => setEditing(r)}>수정</button>
        <button className="btn btn-sm btn-ghost-danger" onClick={() => remove(r)}>삭제</button>
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="PG 관리"
        desc="결제대행사(PG) 연동 정보와 수수료율을 관리합니다."
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}>+ PG 등록</button>}
      />
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="PG사명 / 코드 / MID" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          <option value="ACTIVE">활성</option>
          <option value="INACTIVE">비활성</option>
        </select>
      </FilterBar>
      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable columns={columns} rows={list.data.rows} loading={list.loading} colFilters={list.colFilters} onColFilter={list.onColFilter} />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>
      {editing && (
        <FormModal
          title={editing.id ? 'PG 수정' : 'PG 등록'}
          fields={FIELDS}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing.id) await api.put(`/pgs/${editing.id}`, v);
            else await api.post('/pgs', v);
            toast(editing.id ? '수정되었습니다.' : '등록되었습니다.');
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}
