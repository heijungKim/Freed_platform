import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useList, useOptions } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, useConfirm, useToast } from '../components/ui.jsx';
import { fmtCard, LABELS, num, won } from '../format.js';

const STATUS_OPTS = [{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }];
const CARD_STATUS_OPTS = Object.entries(LABELS.cardStatus).map(([value, label]) => ({ value, label }));

const BASE_FIELDS = [
  { name: 'name', label: '법인명', required: true },
  { name: 'biz_no', label: '사업자등록번호', required: true, placeholder: '000-00-00000' },
  { name: 'ceo_name', label: '대표자' },
  { name: 'phone', label: '연락처' },
  { name: 'email', label: '이메일', type: 'email' },
  { name: 'contract_date', label: '계약일', type: 'date' },
  { name: 'address', label: '주소', full: true },
  { name: 'status', label: '상태', type: 'select', required: true, default: 'ACTIVE', options: STATUS_OPTS },
  { name: 'memo', label: '메모', type: 'textarea' },
];

/** 'id,id' 문자열 → 배열 */
const idList = (v) => (v ? String(v).split(',').filter(Boolean) : []);

export default function Corporations() {
  const list = useList('/corporations', { q: '', status: '' });
  const [pgs] = useOptions('/pgs/options');
  const FIELDS = [
    ...BASE_FIELDS.slice(0, 8),
    {
      name: 'pg_ids', label: '사용 PG', type: 'checks',
      hint: '이 법인이 계약·사용하는 PG사를 선택하세요.',
      options: pgs.map((p) => ({ value: p.id, label: `${p.name} (${p.fee_rate}%)${p.status !== 'ACTIVE' ? ' · 비활성' : ''}`, muted: p.status !== 'ACTIVE' })),
    },
    ...BASE_FIELDS.slice(8),
  ];
  const [editing, setEditing] = useState(null); // null | {} (등록) | row (수정)
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (row) => {
    if (!(await confirm(`'${row.name}' 법인을 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/corporations/${row.id}`);
      toast('삭제되었습니다.');
      setEditing(null);
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'id', label: 'No', width: 70, filter: true },
    { key: 'name', label: '법인명', filter: true, render: (r) => <strong className="link-text">{r.name}</strong> },
    { key: 'biz_no', label: '사업자등록번호', filter: true },
    { key: 'ceo_name', label: '대표자', filter: true },
    { key: 'phone', label: '연락처', filter: true },
    { key: 'pg_names', label: '사용 PG', filter: true, render: (r) => <PgChips names={r.pg_names} /> },
    { key: 'card_count', label: '카드 수', align: 'right', filter: true, render: (r) => num(r.card_count) },
    { key: 'total_balance', label: '카드 잔액 합계', align: 'right', filter: true, render: (r) => won(r.total_balance) },
    { key: 'contract_date', label: '계약일', filter: true },
    { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="법인 관리"
        desc="선불카드를 발급받는 고객 법인을 관리합니다. 법인을 누르면 상세 정보와 발급 카드를 확인·수정할 수 있습니다."
        actions={<button className="btn btn-primary" onClick={() => setEditing({})}>+ 법인 등록</button>}
      />
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="법인명 / 사업자번호 / 대표자" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FilterBar>
      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable
          columns={columns}
          rows={list.data.rows}
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
          title={editing.id ? `법인 수정 · ${editing.name}` : '법인 등록'}
          width={editing.id ? 860 : 560}
          fields={FIELDS}
          initial={{ ...editing, pg_ids: idList(editing.pg_ids) }}
          onClose={() => setEditing(null)}
          footerLeft={editing.id && (
            <button type="button" className="btn btn-ghost-danger" onClick={() => remove(editing)}>법인 삭제</button>
          )}
          onSubmit={async (v) => {
            if (editing.id) await api.put(`/corporations/${editing.id}`, v);
            else await api.post('/corporations', v);
            toast(editing.id ? '수정되었습니다.' : '등록되었습니다.');
            setEditing(null);
            list.reload();
          }}
        >
          {editing.id && <CorporationPgs corporation={editing} />}
          {editing.id && <CorporationCards corporation={editing} />}
        </FormModal>
      )}
    </>
  );
}

function PgChips({ names }) {
  if (!names) return <span className="muted">미지정</span>;
  return <div className="pg-chips">{names.split(', ').map((n) => <span key={n} className="pg-chip">{n}</span>)}</div>;
}

/** 법인 수정 팝업: PG별 사용 현황 (거래내역 기준) */
function CorporationPgs({ corporation }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/corporations/${corporation.id}/pg-usage`).then(setRows).catch((e) => setError(e.message));
  }, [corporation.id]);
  const total = (rows || []).reduce((s, r) => s + r.total_amount, 0);
  return (
    <section className="modal-section">
      <div className="modal-section-head">
        <h4>사용 PG 현황 {rows && <span className="muted">({num(rows.filter((r) => r.linked).length)}곳)</span>}</h4>
        <span className="muted" style={{ fontSize: 12.5 }}>거래내역(수동 입력) 누적 기준</span>
      </div>
      {error && <div className="alert">{error}</div>}
      <DataTable
        loading={!rows}
        rows={rows || []}
        empty="사용 PG가 없습니다. 위 '사용 PG'에서 선택하세요."
        columns={[
          { key: 'name', label: 'PG사', render: (r) => <strong>{r.name}</strong> },
          { key: 'linked', label: '구분', render: (r) => (r.linked
            ? <span className="badge badge-blue">사용 PG</span>
            : <span className="badge badge-amber" title="사용 PG로 지정되지 않았지만 거래내역이 있습니다">미지정·거래있음</span>) },
          { key: 'mid', label: 'MID', render: (r) => r.mid || '-' },
          { key: 'fee_rate', label: '수수료율', align: 'right', render: (r) => `${r.fee_rate}%` },
          { key: 'settlement_cycle', label: '정산주기' },
          { key: 'tx_count', label: '거래건수', align: 'right', render: (r) => `${num(r.tx_count)}건` },
          { key: 'total_amount', label: '총 금액', align: 'right', render: (r) => won(r.total_amount) },
          { key: 'share', label: '비중', align: 'right', render: (r) => (total ? `${((r.total_amount / total) * 100).toFixed(1)}%` : '-') },
          { key: 'last_date', label: '최근 거래일', render: (r) => r.last_date || '-' },
        ]}
      />
    </section>
  );
}

/** 법인 수정 팝업 안의 발급 카드 목록 */
function CorporationCards({ corporation }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/cards', { corporation_id: corporation.id, size: 500 })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [corporation.id]);

  const rows = data?.rows || [];
  const activeCount = rows.filter((r) => r.status === 'ACTIVE').length;

  return (
    <section className="modal-section">
      <div className="modal-section-head">
        <h4>발급 카드 {data && <span className="muted">({num(data.total)}장)</span>}</h4>
        <div className="mini-stats">
          <span>정상 <b>{num(activeCount)}</b>장</span>
          <span>잔액 합계 <b>{won(data?.totalBalance)}</b></span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate(`/cards?corporation_id=${corporation.id}`)}
          >카드 관리에서 보기 →</button>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <DataTable
        loading={!data}
        rows={rows}
        empty="발급된 카드가 없습니다."
        columns={[
          { key: 'card_no', label: '카드번호', filter: true, render: (r) => <span className="mono">{fmtCard(r.card_no)}</span> },
          { key: 'issuer_name', label: '선불사업자', filter: true, render: (r) => r.issuer_name || '-' },
          { key: 'holder_name', label: '사용자', filter: true },
          { key: 'balance', label: '잔액', align: 'right', filter: true, render: (r) => won(r.balance) },
          { key: 'limit_amount', label: '충전 한도', align: 'right', render: (r) => (r.limit_amount ? won(r.limit_amount) : '무제한') },
          { key: 'issued_at', label: '발급일', filter: true },
          { key: 'expires_at', label: '유효기간', filter: true },
          { key: 'status', label: '상태', filter: CARD_STATUS_OPTS, render: (r) => <Badge value={r.status} kind="cardStatus" /> },
        ]}
      />
    </section>
  );
}
