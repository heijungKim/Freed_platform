import React, { useState } from 'react';
import { api } from '../api.js';
import { useList } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, useConfirm, useToast } from '../components/ui.jsx';
import { num, won } from '../format.js';

const FIELDS = [
  { name: 'name', label: '법인명', required: true },
  { name: 'biz_no', label: '사업자등록번호', required: true, placeholder: '000-00-00000' },
  { name: 'ceo_name', label: '대표자' },
  { name: 'phone', label: '연락처' },
  { name: 'email', label: '이메일', type: 'email' },
  { name: 'contract_date', label: '계약일', type: 'date' },
  { name: 'address', label: '주소', full: true },
  { name: 'status', label: '상태', type: 'select', required: true, default: 'ACTIVE',
    options: [{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }] },
  { name: 'memo', label: '메모', type: 'textarea' },
];

export default function Corporations() {
  const list = useList('/corporations', { q: '', status: '' });
  const [editing, setEditing] = useState(null); // null | {} | row
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (row) => {
    if (!(await confirm(`'${row.name}' 법인을 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/corporations/${row.id}`);
      toast('삭제되었습니다.');
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'id', label: 'No', width: 60 },
    { key: 'name', label: '법인명', render: (r) => <strong>{r.name}</strong> },
    { key: 'biz_no', label: '사업자등록번호' },
    { key: 'ceo_name', label: '대표자' },
    { key: 'phone', label: '연락처' },
    { key: 'card_count', label: '카드 수', align: 'right', render: (r) => num(r.card_count) },
    { key: 'total_balance', label: '카드 잔액 합계', align: 'right', render: (r) => won(r.total_balance) },
    { key: 'contract_date', label: '계약일' },
    { key: 'status', label: '상태', render: (r) => <Badge value={r.status} /> },
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
        title="법인 관리"
        desc="선불카드를 발급받는 고객 법인을 관리합니다."
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}>+ 법인 등록</button>}
      />
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="법인명 / 사업자번호 / 대표자" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          <option value="ACTIVE">활성</option>
          <option value="INACTIVE">비활성</option>
        </select>
      </FilterBar>
      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable columns={columns} rows={list.data.rows} loading={list.loading} />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>
      {editing && (
        <FormModal
          title={editing.id ? '법인 수정' : '법인 등록'}
          fields={FIELDS}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing.id) await api.put(`/corporations/${editing.id}`, v);
            else await api.post('/corporations', v);
            toast(editing.id ? '수정되었습니다.' : '등록되었습니다.');
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}
