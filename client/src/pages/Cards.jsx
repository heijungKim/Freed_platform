import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useList, useOptions } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { fmtCard, LABELS, num, won } from '../format.js';

const STATUS_OPTS = Object.entries(LABELS.cardStatus).map(([value, label]) => ({ value, label }));

export default function Cards() {
  const list = useList('/cards', { q: '', corporation_id: '', status: '' });
  const [corps] = useOptions('/corporations/options');
  const [pgs] = useOptions('/pgs/options');
  const [modal, setModal] = useState(null); // {mode:'issue'|'edit'|'charge', row}
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (row) => {
    if (!(await confirm(`카드 ${fmtCard(row.card_no)}를 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/cards/${row.id}`);
      toast('삭제되었습니다.');
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'card_no', label: '카드번호', render: (r) => <span className="mono">{fmtCard(r.card_no)}</span> },
    { key: 'corporation_name', label: '법인' },
    { key: 'holder_name', label: '사용자' },
    { key: 'balance', label: '잔액', align: 'right', render: (r) => <strong>{won(r.balance)}</strong> },
    { key: 'limit_amount', label: '충전 한도', align: 'right', render: (r) => (r.limit_amount ? won(r.limit_amount) : '무제한') },
    { key: 'issued_at', label: '발급일' },
    { key: 'expires_at', label: '유효기간' },
    { key: 'status', label: '상태', render: (r) => <Badge value={r.status} kind="cardStatus" /> },
    { key: 'actions', label: '', align: 'right', render: (r) => (
      <div className="row-actions">
        <button className="btn btn-sm btn-primary-soft" disabled={r.status !== 'ACTIVE'} onClick={() => setModal({ mode: 'charge', row: r })}>충전</button>
        <button className="btn btn-sm" onClick={() => navigate(`/transactions?card_id=${r.id}`)}>거래</button>
        <button className="btn btn-sm" onClick={() => setModal({ mode: 'edit', row: r })}>수정</button>
        <button className="btn btn-sm btn-ghost-danger" onClick={() => remove(r)}>삭제</button>
      </div>
    ) },
  ];

  const done = (msg) => { toast(msg); setModal(null); list.reload(); };

  return (
    <>
      <PageHeader
        title="선불카드 관리"
        desc="법인별 선불카드 발급, 충전, 상태(정지/분실) 관리를 합니다."
        actions={<button className="btn btn-primary" onClick={() => setModal({ mode: 'issue', row: {} })}>+ 카드 발급</button>}
      />
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="카드번호 / 사용자명" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.corporation_id} onChange={(e) => list.setFilter('corporation_id', e.target.value)}>
          <option value="">전체 법인</option>
          {corps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FilterBar>

      <div className="stat-grid stat-grid-2">
        <StatCard label="조회된 카드" value={`${num(list.data.total)}장`} />
        <StatCard label="조회된 카드 잔액 합계" value={won(list.data.totalBalance)} tone="blue" />
      </div>

      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable columns={columns} rows={list.data.rows} loading={list.loading} />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>

      {modal?.mode === 'issue' && (
        <FormModal
          title="선불카드 발급"
          submitLabel="발급"
          fields={[
            { name: 'corporation_id', label: '법인', type: 'select', required: true, full: true,
              options: corps.filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c.id, label: c.name })) },
            { name: 'holder_name', label: '사용자명', required: true },
            { name: 'limit_amount', label: '충전 한도 (원)', type: 'number', min: '0', hint: '0 또는 비워두면 무제한' },
            { name: 'initial_amount', label: '초기 충전 금액 (원)', type: 'number', min: '0' },
            { name: 'expires_at', label: '유효기간', type: 'date', hint: '미입력 시 발급일로부터 5년' },
            { name: 'memo', label: '메모', type: 'textarea' },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const card = await api.post('/cards', v);
            done(`카드가 발급되었습니다. (${fmtCard(card.card_no)})`);
          }}
        />
      )}
      {modal?.mode === 'edit' && (
        <FormModal
          title={`카드 수정 · ${fmtCard(modal.row.card_no)}`}
          initial={modal.row}
          fields={[
            { name: 'holder_name', label: '사용자명', required: true },
            { name: 'status', label: '상태', type: 'select', required: true, options: STATUS_OPTS },
            { name: 'limit_amount', label: '충전 한도 (원)', type: 'number', min: '0', hint: '0이면 무제한' },
            { name: 'expires_at', label: '유효기간', type: 'date' },
            { name: 'memo', label: '메모', type: 'textarea' },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            await api.put(`/cards/${modal.row.id}`, v);
            done('수정되었습니다.');
          }}
        />
      )}
      {modal?.mode === 'charge' && (
        <FormModal
          title={`카드 충전 · ${fmtCard(modal.row.card_no)}`}
          submitLabel="충전"
          fields={[
            { name: 'balance', label: '현재 잔액', disabled: true, default: won(modal.row.balance) },
            { name: 'amount', label: '충전 금액 (원)', type: 'number', min: '1', required: true },
            { name: 'pg_id', label: '충전 PG', type: 'select',
              options: pgs.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: p.name })) },
            { name: 'memo', label: '메모' },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const r = await api.post(`/cards/${modal.row.id}/charge`, { amount: v.amount, pg_id: v.pg_id, memo: v.memo });
            done(`${won(v.amount)} 충전 완료 (잔액 ${won(r.card.balance)})`);
          }}
        />
      )}
    </>
  );
}
