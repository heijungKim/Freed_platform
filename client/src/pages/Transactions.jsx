import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useList, useOptions } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { daysAgo, fmtCard, LABELS, today, won } from '../format.js';

const TYPE_OPTS = Object.entries(LABELS.txType).map(([value, label]) => ({ value, label }));
const STATUS_OPTS = Object.entries(LABELS.txStatus).map(([value, label]) => ({ value, label }));

export default function Transactions() {
  const [params] = useSearchParams();
  const initial = useMemo(() => ({
    from: daysAgo(29), to: today(), corporation_id: '', pg_id: '', type: '', status: '', q: '',
    card_id: params.get('card_id') || '',
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useList('/transactions', initial, 30);
  const [corps] = useOptions('/corporations/options');
  const [pgs] = useOptions('/pgs/options');
  const [cards, reloadCards] = useOptions('/cards/options');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();
  const s = list.data.summary || {};

  const cancel = async (row) => {
    if (!(await confirm(`승인번호 ${row.approval_no} 거래(${won(row.amount)})를 취소하시겠습니까?\n카드 잔액이 원복됩니다.`, { danger: true, okLabel: '거래 취소' }))) return;
    try {
      await api.post(`/transactions/${row.id}/cancel`);
      toast('거래가 취소되었습니다.');
      setDetail(null);
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'transacted_at', filter: true, label: '거래일시', width: 150 },
    { key: 'approval_no', filter: true, label: '승인번호', render: (r) => <code>{r.approval_no}</code> },
    { key: 'type', label: '유형', filter: TYPE_OPTS, render: (r) => <Badge value={r.type} kind="txType" /> },
    { key: 'corporation_name', filter: true, label: '법인' },
    { key: 'card', filter: true, label: '카드 / 사용자', render: (r) => (
      <div className="stack"><span className="mono">{fmtCard(r.card_no)}</span><small className="muted">{r.holder_name}</small></div>
    ) },
    { key: 'pg_name', filter: true, label: 'PG', render: (r) => r.pg_name || '-' },
    { key: 'merchant_name', filter: true, label: '가맹점', render: (r) => r.merchant_name || '-' },
    { key: 'amount', filter: true, label: '금액', align: 'right', render: (r) => (
      <strong className={r.status !== 'APPROVED' ? 'strike' : r.type === 'PAYMENT' ? 'neg' : 'pos'}>
        {r.type === 'PAYMENT' ? '-' : '+'}{won(r.amount)}
      </strong>
    ) },
    { key: 'fee', filter: true, label: '수수료', align: 'right', render: (r) => (r.fee ? won(r.fee) : '-') },
    { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} kind="txStatus" /> },
  ];

  const exportCsv = async () => {
    try {
      await api.download('/transactions/export.csv', list.query(), 'transactions.csv');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader
        title="거래내역"
        desc="선불카드 충전·결제·환불 거래를 조회하고 관리합니다."
        actions={(
          <>
            <button className="btn" onClick={exportCsv}>CSV 다운로드</button>
            <button className="btn btn-primary" onClick={() => { reloadCards(); setCreating(true); }}>+ 수기 거래 등록</button>
          </>
        )}
      />
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <div className="date-range">
          <input type="date" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} />
          <span>~</span>
          <input type="date" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} />
        </div>
        <select value={list.filters.corporation_id} onChange={(e) => list.setFilter('corporation_id', e.target.value)}>
          <option value="">전체 법인</option>
          {corps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={list.filters.pg_id} onChange={(e) => list.setFilter('pg_id', e.target.value)}>
          <option value="">전체 PG</option>
          {pgs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={list.filters.type} onChange={(e) => list.setFilter('type', e.target.value)}>
          <option value="">전체 유형</option>
          {Object.entries(LABELS.txType).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          {Object.entries(LABELS.txStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input placeholder="승인번호 / 가맹점 / 카드번호 / 사용자" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        {list.filters.card_id && (
          <button type="button" className="chip" onClick={() => list.setFilter('card_id', '')}>카드 #{list.filters.card_id} ×</button>
        )}
      </FilterBar>

      <div className="stat-grid stat-grid-4">
        <StatCard label="충전 합계" value={won(s.charge)} tone="blue" />
        <StatCard label="결제 합계" value={won(s.payment)} tone="violet" />
        <StatCard label="환불 합계" value={won(s.refund)} tone="amber" />
        <StatCard label="PG 수수료 합계" value={won(s.fee)} />
      </div>

      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable columns={columns} rows={list.data.rows} loading={list.loading} colFilters={list.colFilters} onColFilter={list.onColFilter} onRowClick={setDetail} rowTitle="클릭하여 상세 보기" />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>

      {detail && <TxDetail tx={detail} onClose={() => setDetail(null)} onCancel={cancel} />}

      {creating && (
        <FormModal
          title="수기 거래 등록"
          submitLabel="등록"
          fields={[
            { name: 'card_id', label: '선불카드', type: 'select', required: true, full: true,
              options: cards.filter((c) => c.status === 'ACTIVE').map((c) => ({
                value: c.id, label: `${fmtCard(c.card_no)} · ${c.holder_name} (${c.corporation_name}) · 잔액 ${won(c.balance)}`,
              })) },
            { name: 'type', label: '거래 유형', type: 'select', required: true, default: 'PAYMENT',
              options: Object.entries(LABELS.txType).map(([value, label]) => ({ value, label })) },
            { name: 'amount', label: '금액 (원)', type: 'number', min: '1', required: true },
            { name: 'pg_id', label: 'PG', type: 'select', hint: '결제 거래는 필수',
              options: pgs.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.name} (${p.fee_rate}%)` })) },
            { name: 'merchant_name', label: '가맹점명' },
            { name: 'memo', label: '메모', type: 'textarea' },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            await api.post('/transactions', v);
            toast('거래가 등록되었습니다.');
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function TxDetail({ tx, onClose, onCancel }) {
  const rows = [
    ['거래 ID', tx.id], ['거래일시', tx.transacted_at], ['승인번호', tx.approval_no],
    ['유형', <Badge key="t" value={tx.type} kind="txType" />], ['상태', <Badge key="s" value={tx.status} kind="txStatus" />],
    ['법인', tx.corporation_name], ['카드번호', fmtCard(tx.card_no)], ['사용자', tx.holder_name],
    ['PG', tx.pg_name || '-'], ['가맹점', tx.merchant_name || '-'], ['금액', won(tx.amount)], ['수수료', won(tx.fee)],
    ['등록자', tx.created_by_name || '시스템'], ['메모', tx.memo || '-'],
  ];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head"><h3>거래 상세</h3><button className="icon-btn" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <dl className="detail-list">
            {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
          </dl>
        </div>
        <div className="modal-foot">
          {tx.status === 'APPROVED' && <button className="btn btn-danger" onClick={() => onCancel(tx)}>거래 취소</button>}
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
