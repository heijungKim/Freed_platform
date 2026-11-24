import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useList, useOptions } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, Modal, PageHeader, Pagination, StatCard, useConfirm, useToast } from '../components/ui.jsx';
import { fmtCard, LABELS, num, won } from '../format.js';
import { Coverage } from './Issuers.jsx';

const STATUS_OPTS = Object.entries(LABELS.cardStatus).map(([value, label]) => ({ value, label }));

export default function Cards() {
  const [params, setParams] = useSearchParams();
  const list = useList('/cards', {
    q: '', corporation_id: params.get('corporation_id') || '', issuer_id: params.get('issuer_id') || '', status: '',
  });
  const [corps, reloadCorps] = useOptions('/corporations/options');
  const [issuers, reloadIssuers] = useOptions('/issuers/options');
  const corpId = list.applied.corporation_id;
  const issuerId = list.applied.issuer_id;
  const selectedIssuer = issuers.find((i) => String(i.id) === String(issuerId));

  // 선불사업자/법인 선택을 주소(?issuer_id=&corporation_id=)와 동기화 → 새로고침/공유해도 유지
  useEffect(() => {
    const next = {};
    if (issuerId) next.issuer_id = issuerId;
    if (corpId) next.corporation_id = corpId;
    if ((params.get('issuer_id') || '') !== String(issuerId || '') || (params.get('corporation_id') || '') !== String(corpId || '')) {
      setParams(next, { replace: true });
    }
  }, [corpId, issuerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectCorp = (id) => list.applyFilter('corporation_id', id ? String(id) : '');
  const selectIssuer = (id) => list.applyFilter('issuer_id', id ? String(id) : '');
  const totalCards = corps.reduce((s, c) => s + (c.card_count || 0), 0);
  const [pgs] = useOptions('/pgs/options');
  const [modal, setModal] = useState(null); // {mode:'issue'|'edit'|'charge', row}
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
    { key: 'card_no', label: '카드번호', filter: true, render: (r) => <span className="mono">{fmtCard(r.card_no)}</span> },
    { key: 'issuer_name', label: '선불사업자', filter: true, render: (r) => r.issuer_name || <span className="muted">미지정</span> },
    { key: 'corporation_name', label: '법인', filter: true },
    { key: 'holder_name', label: '사용자', filter: true },
    { key: 'balance', label: '잔액', align: 'right', filter: true, render: (r) => <strong>{won(r.balance)}</strong> },
    { key: 'limit_amount', label: '충전 한도', align: 'right', filter: true, render: (r) => (r.limit_amount ? won(r.limit_amount) : '무제한') },
    { key: 'expires_at', label: '발급일 / 유효기간', filter: true, filterValue: (r) => `${r.issued_at} ${r.expires_at}`,
      render: (r) => <div className="stack"><span>{r.issued_at}</span><small className="muted">~ {r.expires_at}</small></div> },
    { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} kind="cardStatus" /> },
    { key: 'actions', label: '', align: 'right', render: (r) => (
      <div className="row-actions">
        <button className="btn btn-sm btn-primary-soft" disabled={r.status !== 'ACTIVE'} onClick={() => setModal({ mode: 'charge', row: r })}>충전</button>
        <button className="btn btn-sm" onClick={() => setModal({ mode: 'history', row: r })}>이력</button>
        <button className="btn btn-sm" onClick={() => setModal({ mode: 'edit', row: r })}>수정</button>
        <button className="btn btn-sm btn-ghost-danger" onClick={() => remove(r)}>삭제</button>
      </div>
    ) },
  ];

  const done = (msg) => { toast(msg); setModal(null); list.reload(); reloadCorps(); reloadIssuers(); };

  return (
    <>
      <PageHeader
        title="선불카드 관리"
        desc="선불사업자·법인별 선불카드 발급, 충전, 상태(정지/분실) 관리를 합니다."
        actions={(
          <>
            <button className="btn" onClick={() => setModal({ mode: 'bulk', row: {} })}>일괄 발급</button>
            <button className="btn btn-primary" onClick={() => setModal({ mode: 'issue', row: {} })}>+ 카드 발급</button>
          </>
        )}
      />
      <div className="issuer-strip" role="tablist" aria-label="선불사업자별 보기">
        <button type="button" role="tab" aria-selected={!issuerId} className={`issuer-card issuer-all ${!issuerId ? 'on' : ''}`} onClick={() => selectIssuer('')}>
          <span className="muted">전체 선불사업자</span>
          <span className="big">{num(issuers.reduce((s, i) => s + i.card_count, 0))}장</span>
          <span className="muted">잔액 {won(issuers.reduce((s, i) => s + i.total_balance, 0))}</span>
        </button>
        {issuers.map((i) => (
          <button
            key={i.id}
            type="button"
            role="tab"
            aria-selected={String(issuerId) === String(i.id)}
            className={`issuer-card ${String(issuerId) === String(i.id) ? 'on' : ''} ${i.status !== 'ACTIVE' ? 'inactive' : ''}`}
            onClick={() => selectIssuer(i.id)}
          >
            <div className="issuer-card-head">
              <strong>{i.name}</strong>
              <Badge value={i.protection_type} kind="protection" />
            </div>
            <div className="issuer-meta">
              <span>BIN <code>{i.bin}</code></span>
              <span>{i.reg_no || '등록번호 없음'}</span>
            </div>
            <div className="issuer-nums">
              <span>발행 카드</span><b>{num(i.card_count)}장 (정상 {num(i.active_card_count)})</b>
              <span>선불충전금 잔액</span><b>{won(i.total_balance)}</b>
              <span>보호 금액</span><b>{won(i.protection_amount)}</b>
            </div>
            <Coverage amount={i.protection_amount} balance={i.total_balance} />
          </button>
        ))}
      </div>
      <div className="corp-tabs" role="tablist" aria-label="법인별 보기">
        <button type="button" role="tab" aria-selected={!corpId} className={`corp-tab ${!corpId ? 'on' : ''}`} onClick={() => selectCorp('')}>
          전체 법인 <span className="cnt">{num(totalCards)}</span>
        </button>
        {corps.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={String(corpId) === String(c.id)}
            className={`corp-tab ${String(corpId) === String(c.id) ? 'on' : ''} ${c.status !== 'ACTIVE' ? 'inactive' : ''}`}
            onClick={() => selectCorp(c.id)}
            title={c.status !== 'ACTIVE' ? '비활성 법인' : undefined}
          >
            {c.name} <span className="cnt">{num(c.card_count)}</span>
          </button>
        ))}
      </div>
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="카드번호 / 사용자명" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.corporation_id} onChange={(e) => selectCorp(e.target.value)}>
          <option value="">전체 법인</option>
          {corps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FilterBar>

      <div className="stat-grid stat-grid-2">
        <StatCard
          label={[selectedIssuer?.name, corpId && corps.find((c) => String(c.id) === String(corpId))?.name].filter(Boolean).join(' · ') || '조회된 카드'}
          value={`${num(list.data.total)}장`}
          sub={selectedIssuer ? `BIN ${selectedIssuer.bin} · ${selectedIssuer.reg_no || ''} · 보호 ${LABELS.protection[selectedIssuer.protection_type]} ${won(selectedIssuer.protection_amount)}` : null}
        />
        <StatCard label="조회된 카드 잔액 합계" value={won(list.data.totalBalance)} tone="blue" />
      </div>

      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable columns={columns} rows={list.data.rows} loading={list.loading} colFilters={list.colFilters} onColFilter={list.onColFilter} />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>

      {modal?.mode === 'history' && <CardHistory card={modal.row} onClose={() => setModal(null)} />}
      {modal?.mode === 'bulk' && (
        <BulkIssueModal
          issuers={issuers.filter((i) => i.status === 'ACTIVE')}
          corps={corps.filter((c) => c.status === 'ACTIVE')}
          defaults={{ issuer_id: issuerId || '', corporation_id: corpId || '' }}
          onClose={() => setModal(null)}
          onDone={(result) => {
            toast(`${num(result.count)}장 발급되었습니다.`);
            setModal({ mode: 'bulk-result', row: result });
            list.reload(); reloadCorps(); reloadIssuers();
          }}
        />
      )}
      {modal?.mode === 'bulk-result' && <BulkResult result={modal.row} onClose={() => setModal(null)} />}
      {modal?.mode === 'issue' && (
        <FormModal
          title="선불카드 발급"
          submitLabel="발급"
          fields={[
            { name: 'issuer_id', label: '선불사업자', type: 'select', required: true, full: true, default: issuerId || '',
              hint: '카드번호는 선불사업자 BIN으로 시작합니다.',
              options: issuers.filter((i) => i.status === 'ACTIVE').map((i) => ({ value: i.id, label: `${i.name} (BIN ${i.bin})` })) },
            { name: 'corporation_id', label: '법인', type: 'select', required: true, full: true, default: corpId || '',
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
            { name: 'issuer_name', label: '선불사업자', disabled: true, default: modal.row.issuer_name || '미지정' },
            { name: 'corporation_name', label: '법인', disabled: true },
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

/** 카드 충전·사용 이력 (카드 원장) */
function CardHistory({ card, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/transactions', { card_id: card.id, size: 500 }).then(setData).catch((e) => setError(e.message));
  }, [card.id]);
  return (
    <Modal title={`카드 이력 · ${fmtCard(card.card_no)}`} width={820} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>닫기</button>}
    >
      <div className="mini-stats" style={{ marginBottom: 12 }}>
        <span>{card.issuer_name || '선불사업자 미지정'} · {card.corporation_name} · {card.holder_name}</span>
        <span>현재 잔액 <b>{won(card.balance)}</b></span>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="modal-section" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
        <DataTable
          loading={!data}
          rows={data?.rows || []}
          empty="이력이 없습니다."
          columns={[
            { key: 'transacted_at', label: '일시', filter: true },
            { key: 'type', label: '구분', filter: Object.entries(LABELS.txType).map(([value, label]) => ({ value, label })),
              render: (r) => <Badge value={r.type} kind="txType" /> },
            { key: 'amount', label: '금액', align: 'right', filter: true,
              render: (r) => <span className={r.status !== 'APPROVED' ? 'strike' : ''}>{r.type === 'PAYMENT' ? '-' : '+'}{won(r.amount)}</span> },
            { key: 'merchant_name', label: '가맹점', filter: true, render: (r) => r.merchant_name || '-' },
            { key: 'memo', label: '메모', render: (r) => r.memo || '-' },
            { key: 'status', label: '상태', filter: Object.entries(LABELS.txStatus).map(([value, label]) => ({ value, label })),
              render: (r) => <Badge value={r.status} kind="txStatus" /> },
          ]}
        />
      </div>
    </Modal>
  );
}

/* ---------- 일괄 발급 ---------- */
const BULK_MAX = 1000;
const digits = (v) => String(v).replace(/[^\d]/g, '');
const comma = (v) => (v === '' ? '' : Number(v).toLocaleString('ko-KR'));

function BulkIssueModal({ issuers, corps, defaults, onClose, onDone }) {
  const [f, setF] = useState({
    issuer_id: String(defaults.issuer_id || ''), corporation_id: String(defaults.corporation_id || ''),
    mode: 'auto', quantity: '10', holder_prefix: '', start_no: '1', names: '',
    limit_amount: '', initial_amount: '', expires_at: '', memo: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setNum = (k) => (e) => setF((s) => ({ ...s, [k]: digits(e.target.value) }));

  const names = f.names.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
  const qty = f.mode === 'auto' ? Number(f.quantity || 0) : names.length;
  const start = Number(f.start_no || 1);
  const width = Math.max(3, String(start + Math.max(qty, 1) - 1).length);
  const sample = f.mode === 'auto'
    ? (f.holder_prefix.trim() && qty > 0
      ? [0, 1, qty - 1].filter((v, i, a) => v >= 0 && v < qty && a.indexOf(v) === i)
        .map((i) => `${f.holder_prefix.trim()}-${String(start + i).padStart(width, '0')}`)
      : [])
    : names.slice(0, 3);
  const issuer = issuers.find((i) => String(i.id) === f.issuer_id);
  const initial = Number(f.initial_amount || 0);
  const limit = Number(f.limit_amount || 0);
  const dupNames = f.mode === 'list' ? names.length - new Set(names).size : 0;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!f.issuer_id) return setError('선불사업자를 선택해 주세요.');
    if (!f.corporation_id) return setError('법인을 선택해 주세요.');
    if (qty < 1) return setError(f.mode === 'auto' ? '발급 수량을 1장 이상 입력해 주세요.' : '사용자 명단을 입력해 주세요.');
    if (qty > BULK_MAX) return setError(`한 번에 최대 ${BULK_MAX.toLocaleString()}장까지 발급할 수 있습니다.`);
    if (f.mode === 'auto' && !f.holder_prefix.trim()) return setError('사용자명 앞글자를 입력해 주세요.');
    if (limit && initial > limit) return setError('초기 충전 금액이 충전 한도를 초과합니다.');
    setBusy(true);
    try {
      const body = {
        issuer_id: f.issuer_id, corporation_id: f.corporation_id,
        limit_amount: f.limit_amount, initial_amount: f.initial_amount, expires_at: f.expires_at, memo: f.memo,
        ...(f.mode === 'auto'
          ? { quantity: qty, holder_prefix: f.holder_prefix.trim(), start_no: start }
          : { holder_names: names }),
      };
      onDone(await api.post('/cards/bulk', body));
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title="선불카드 일괄 발급"
      width={720}
      onClose={onClose}
      footer={(
        <>
          <div className="foot-left entry-sum">
            <b>{num(qty)}</b>장{initial > 0 && <> · 초기 충전 합계 <b>{won(initial * qty)}</b></>}
          </div>
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" form="bulk-form" className="btn btn-primary" disabled={busy || qty < 1}>
            {busy ? '발급 중…' : `${num(qty)}장 발급`}
          </button>
        </>
      )}
    >
      <form id="bulk-form" className="form-grid" onSubmit={submit}>
        <label className="field full">
          <span className="field-label">선불사업자<em>*</em></span>
          <select value={f.issuer_id} onChange={set('issuer_id')} required>
            <option value="">선택하세요</option>
            {issuers.map((i) => <option key={i.id} value={i.id}>{i.name} (BIN {i.bin})</option>)}
          </select>
          {issuer && <small className="hint">카드번호가 {issuer.bin}으로 시작합니다.</small>}
        </label>
        <label className="field full">
          <span className="field-label">법인<em>*</em></span>
          <select value={f.corporation_id} onChange={set('corporation_id')} required>
            <option value="">선택하세요</option>
            {corps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div className="field full">
          <span className="field-label">사용자명 지정 방식</span>
          <div className="seg seg-inline">
            <button type="button" className={f.mode === 'auto' ? 'on' : ''} onClick={() => setF((s) => ({ ...s, mode: 'auto' }))}>수량 입력 (자동 번호)</button>
            <button type="button" className={f.mode === 'list' ? 'on' : ''} onClick={() => setF((s) => ({ ...s, mode: 'list' }))}>명단 붙여넣기</button>
          </div>
        </div>

        {f.mode === 'auto' ? (
          <>
            <label className="field">
              <span className="field-label">발급 수량<em>*</em></span>
              <input inputMode="numeric" className="num-input" value={comma(f.quantity)} onChange={setNum('quantity')} placeholder="예) 50" autoFocus />
              <small className="hint">최대 {BULK_MAX.toLocaleString()}장</small>
            </label>
            <label className="field">
              <span className="field-label">사용자명 앞글자<em>*</em></span>
              <input value={f.holder_prefix} onChange={set('holder_prefix')} placeholder="예) 영업팀" maxLength={40} />
            </label>
            <label className="field">
              <span className="field-label">시작 번호</span>
              <input inputMode="numeric" value={f.start_no} onChange={setNum('start_no')} placeholder="1" />
            </label>
          </>
        ) : (
          <label className="field full">
            <span className="field-label">사용자 명단<em>*</em> <span className="muted">(한 줄에 한 명 · {num(names.length)}명)</span></span>
            <textarea rows={6} value={f.names} onChange={set('names')} placeholder={'김민준\n이서연\n박도윤'} />
            {dupNames > 0 && <small className="hint warn-text">같은 이름이 {dupNames}건 있습니다. (그대로 발급됩니다)</small>}
          </label>
        )}

        {sample.length > 0 && (
          <div className="field full">
            <span className="field-label">사용자명 미리보기</span>
            <div className="pg-chips" style={{ maxWidth: 'none' }}>
              {sample.map((n, i) => (
                <React.Fragment key={n + i}>
                  {f.mode === 'auto' && i === sample.length - 1 && qty > 3 && <span className="muted">…</span>}
                  <span className="pg-chip">{n}</span>
                </React.Fragment>
              ))}
              {f.mode === 'list' && names.length > 3 && <span className="muted">외 {num(names.length - 3)}명</span>}
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">충전 한도 (원)</span>
          <input inputMode="numeric" className="num-input" value={comma(f.limit_amount)} onChange={setNum('limit_amount')} placeholder="비워두면 무제한" />
        </label>
        <label className="field">
          <span className="field-label">초기 충전 금액 (원/장)</span>
          <input inputMode="numeric" className="num-input" value={comma(f.initial_amount)} onChange={setNum('initial_amount')} placeholder="0" />
        </label>
        <label className="field">
          <span className="field-label">유효기간</span>
          <input type="date" value={f.expires_at} onChange={set('expires_at')} />
          <small className="hint">미입력 시 발급일로부터 5년</small>
        </label>
        <label className="field">
          <span className="field-label">메모</span>
          <input value={f.memo} onChange={set('memo')} placeholder="미입력 시 '일괄발급 날짜 (N장)'" />
        </label>
        {error && <div className="form-error full">{error}</div>}
      </form>
    </Modal>
  );
}

/** 일괄 발급 결과 + CSV 저장 */
function BulkResult({ result, onClose }) {
  const download = () => {
    const esc = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['카드번호', '선불사업자', '법인', '사용자', '잔액', '충전 한도', '발급일', '유효기간'];
    const lines = result.rows.map((r) => [fmtCard(r.card_no), r.issuer_name, r.corporation_name, r.holder_name, r.balance,
      r.limit_amount || '무제한', r.issued_at, r.expires_at].map(esc).join(','));
    const blob = new Blob(['\uFEFF' + [header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bulk_issue_${result.rows[0]?.issued_at || ''}_${result.count}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const first = result.rows[0] || {};
  return (
    <Modal
      title={`일괄 발급 완료 · ${num(result.count)}장`}
      width={760}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={download}>발급 목록 CSV 저장</button>
          <button className="btn btn-primary" onClick={onClose}>확인</button>
        </>
      )}
    >
      <div className="mini-stats" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <span>선불사업자 <b>{first.issuer_name}</b></span>
        <span>법인 <b>{first.corporation_name}</b></span>
        <span>초기 충전 합계 <b>{won(result.total_initial)}</b></span>
      </div>
      <div className="modal-section" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
        <DataTable
          rows={result.rows}
          columns={[
            { key: 'card_no', label: '카드번호', filter: true, render: (r) => <span className="mono">{fmtCard(r.card_no)}</span> },
            { key: 'holder_name', label: '사용자', filter: true },
            { key: 'balance', label: '잔액', align: 'right', render: (r) => won(r.balance) },
            { key: 'limit_amount', label: '충전 한도', align: 'right', render: (r) => (r.limit_amount ? won(r.limit_amount) : '무제한') },
            { key: 'expires_at', label: '유효기간' },
          ]}
        />
      </div>
    </Modal>
  );
}
