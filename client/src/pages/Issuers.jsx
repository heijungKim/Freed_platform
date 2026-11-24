import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useList } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { fmtCard, LABELS, num, won } from '../format.js';

const STATUS_OPTS = [{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }];
const PROTECTION_OPTS = Object.entries(LABELS.protection).map(([value, label]) => ({ value, label }));
const CARD_STATUS_OPTS = Object.entries(LABELS.cardStatus).map(([value, label]) => ({ value, label }));

const FIELDS = [
  { name: 'name', label: '사업자명', required: true },
  { name: 'biz_no', label: '사업자등록번호', required: true, placeholder: '000-00-00000' },
  { name: 'reg_no', label: '전자금융업 등록번호', placeholder: '예) 2019-선불-0012' },
  { name: 'registered_at', label: '등록일', type: 'date' },
  { name: 'bin', label: '카드 BIN', required: true, placeholder: '숫자 4~6자리', hint: '발행 카드번호 앞자리 (카드 발행 후 변경 불가)' },
  { name: 'ceo_name', label: '대표자' },
  { name: 'protection_type', label: '선불충전금 보호방식', type: 'select', required: true, default: 'TRUST', options: PROTECTION_OPTS },
  { name: 'protection_amount', label: '보호 금액 (원)', type: 'number', min: '0', hint: '신탁·보증보험·예치 금액' },
  { name: 'phone', label: '대표 연락처' },
  { name: 'email', label: '이메일', type: 'email' },
  { name: 'manager_name', label: '정산 담당자' },
  { name: 'manager_phone', label: '담당자 연락처' },
  { name: 'address', label: '주소', full: true },
  { name: 'status', label: '상태', type: 'select', required: true, default: 'ACTIVE', options: STATUS_OPTS },
  { name: 'memo', label: '메모', type: 'textarea' },
];

/** 선불충전금 보호율 = 보호 금액 / 카드 잔액 합계 */
export function Coverage({ amount, balance }) {
  if (!balance) return <div className="cover"><small>보호율 -</small></div>;
  const pct = (amount / balance) * 100;
  return (
    <div className={`cover ${pct < 100 ? 'warn' : ''}`} title="보호 금액 ÷ 선불충전금 잔액">
      <div className="share-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <small>보호율 {pct >= 1000 ? '1000%+' : `${pct.toFixed(0)}%`}</small>
    </div>
  );
}

export default function Issuers() {
  const list = useList('/issuers', { q: '', status: '' });
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();
  const rows = list.data.rows;

  const remove = async (row) => {
    if (!(await confirm(`'${row.name}' 선불사업자를 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/issuers/${row.id}`);
      toast('삭제되었습니다.');
      setEditing(null);
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const totalBalance = rows.reduce((s, r) => s + r.total_balance, 0);
  const totalProtect = rows.reduce((s, r) => s + r.protection_amount, 0);

  const columns = [
    { key: 'name', label: '사업자명', filter: true, render: (r) => <strong className="link-text">{r.name}</strong> },
    { key: 'bin', label: 'BIN', filter: true, render: (r) => <code>{r.bin}</code> },
    { key: 'reg_no', label: '전자금융업 등록번호', filter: true, render: (r) => r.reg_no || '-' },
    { key: 'biz_no', label: '사업자등록번호', filter: true },
    { key: 'ceo_name', label: '대표자', filter: true },
    { key: 'card_count', label: '발행 카드', align: 'right', filter: true, render: (r) => `${num(r.card_count)}장` },
    { key: 'total_balance', label: '선불충전금 잔액', align: 'right', filter: true, render: (r) => won(r.total_balance) },
    { key: 'protection_type', label: '보호방식', filter: PROTECTION_OPTS, render: (r) => <Badge value={r.protection_type} kind="protection" /> },
    { key: 'protection_amount', label: '보호 금액', align: 'right', filter: true, render: (r) => won(r.protection_amount) },
    { key: 'coverage', label: '보호율', width: 150, render: (r) => <Coverage amount={r.protection_amount} balance={r.total_balance} /> },
    { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="선불사업자"
        desc="선불카드를 발행하는 선불사업자(선불전자지급수단 발행업자)와 선불충전금 보호 현황을 관리합니다."
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}>+ 선불사업자 등록</button>}
      />
      <div className="stat-grid">
        <StatCard label="선불사업자" value={`${num(rows.filter((r) => r.status === 'ACTIVE').length)} / ${num(list.data.total)}`} sub="활성 / 전체" />
        <StatCard label="발행 카드" value={`${num(rows.reduce((s, r) => s + r.card_count, 0))}장`} tone="blue" />
        <StatCard label="선불충전금 잔액 합계" value={won(totalBalance)} tone="violet" />
        <StatCard label="보호 금액 합계" value={won(totalProtect)} tone="green"
          sub={totalBalance ? `보호율 ${((totalProtect / totalBalance) * 100).toFixed(0)}%` : null} />
      </div>
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="사업자명 / 사업자번호 / 등록번호" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FilterBar>
      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable
          columns={columns}
          rows={rows}
          loading={list.loading}
          colFilters={list.colFilters}
          onColFilter={list.onColFilter}
          onRowClick={setEditing}
          rowTitle="클릭하여 수정"
        />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>
      {editing && (
        <FormModal
          key={editing.id ?? 'new'}
          title={editing.id ? `선불사업자 수정 · ${editing.name}` : '선불사업자 등록'}
          width={editing.id ? 880 : 640}
          fields={FIELDS}
          initial={editing}
          onClose={() => setEditing(null)}
          footerLeft={editing.id && <button type="button" className="btn btn-ghost-danger" onClick={() => remove(editing)}>삭제</button>}
          onSubmit={async (v) => {
            if (editing.id) await api.put(`/issuers/${editing.id}`, v);
            else await api.post('/issuers', v);
            toast(editing.id ? '수정되었습니다.' : '등록되었습니다.');
            setEditing(null);
            list.reload();
          }}
        >
          {editing.id && <IssuerCards issuer={editing} />}
        </FormModal>
      )}
    </>
  );
}

/** 선불사업자 팝업 안의 발행 카드 목록 */
function IssuerCards({ issuer }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    api.get('/cards', { issuer_id: issuer.id, size: 500 }).then(setData).catch((e) => setError(e.message));
  }, [issuer.id]);

  return (
    <section className="modal-section">
      <div className="modal-section-head">
        <h4>발행 카드 {data && <span className="muted">({num(data.total)}장)</span>}</h4>
        <div className="mini-stats">
          <span>거래 법인 <b>{num(issuer.corporation_count)}</b>곳</span>
          <span>잔액 합계 <b>{won(data?.totalBalance)}</b></span>
          <button type="button" className="btn btn-sm" onClick={() => navigate(`/cards?issuer_id=${issuer.id}`)}>카드 관리에서 보기 →</button>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <DataTable
        loading={!data}
        rows={data?.rows || []}
        empty="발행한 카드가 없습니다."
        columns={[
          { key: 'card_no', label: '카드번호', filter: true, render: (r) => <span className="mono">{fmtCard(r.card_no)}</span> },
          { key: 'corporation_name', label: '법인', filter: true },
          { key: 'holder_name', label: '사용자', filter: true },
          { key: 'balance', label: '잔액', align: 'right', filter: true, render: (r) => won(r.balance) },
          { key: 'status', label: '상태', filter: CARD_STATUS_OPTS, render: (r) => <Badge value={r.status} kind="cardStatus" /> },
        ]}
      />
    </section>
  );
}
