import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { useList } from '../hooks.js';
import { Badge, DataTable, FilterBar, FormModal, PageHeader, Pagination, useConfirm, useToast } from '../components/ui.jsx';
import { LABELS } from '../format.js';

const ROLE_OPTS = Object.entries(LABELS.role).map(([value, label]) => ({ value, label }));
const STATUS_OPTS = [{ value: 'ACTIVE', label: '활성' }, { value: 'INACTIVE', label: '비활성' }];

export default function Users() {
  const { user: me } = useAuth();
  const isSuper = me.role === 'SUPER_ADMIN';
  const list = useList('/users', { q: '', role: '', status: '' });
  const [modal, setModal] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (row) => {
    if (!(await confirm(`'${row.name}(${row.username})' 사용자를 삭제하시겠습니까?`, { danger: true, okLabel: '삭제' }))) return;
    try {
      await api.del(`/users/${row.id}`);
      toast('삭제되었습니다.');
      list.reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  const columns = [
    { key: 'id', filter: true, label: 'No', width: 60 },
    { key: 'username', filter: true, label: '아이디', render: (r) => <strong>{r.username}{r.id === me.id && <span className="me-tag">나</span>}</strong> },
    { key: 'name', filter: true, label: '이름' },
    { key: 'email', filter: true, label: '이메일', render: (r) => r.email || '-' },
    { key: 'role', label: '권한', filter: ROLE_OPTS, render: (r) => <Badge value={r.role} kind="role" /> },
    { key: 'login', label: 'ERP 접속', render: (r) => (r.role === 'USER' ? <span className="muted">불가</span> : '가능') },
    { key: 'status', label: '상태', filter: STATUS_OPTS, render: (r) => <Badge value={r.status} /> },
    { key: 'last_login_at', filter: true, label: '최근 로그인', render: (r) => r.last_login_at || '-' },
    { key: 'created_at', filter: true, label: '생성일' },
    ...(isSuper ? [{ key: 'actions', label: '', align: 'right', render: (r) => (
      <div className="row-actions">
        <button className="btn btn-sm" onClick={() => setModal({ mode: 'edit', row: r })}>수정</button>
        <button className="btn btn-sm" onClick={() => setModal({ mode: 'reset', row: r })}>비밀번호 초기화</button>
        {r.id !== me.id && <button className="btn btn-sm btn-ghost-danger" onClick={() => remove(r)}>삭제</button>}
      </div>
    ) }] : []),
  ];

  const done = (msg) => { toast(msg); setModal(null); list.reload(); };

  return (
    <>
      <PageHeader
        title="사용자 관리"
        desc="ERP 접속 계정과 권한을 관리합니다. 최고 관리자·관리자 권한만 로그인할 수 있습니다."
        actions={isSuper && <button className="btn btn-primary" onClick={() => setModal({ mode: 'create', row: {} })}>+ 사용자 등록</button>}
      />
      {!isSuper && <div className="alert alert-info">사용자 등록·수정은 최고 관리자만 가능합니다. (조회 전용)</div>}
      <FilterBar onSubmit={list.search} onReset={list.reset}>
        <input placeholder="아이디 / 이름 / 이메일" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <select value={list.filters.role} onChange={(e) => list.setFilter('role', e.target.value)}>
          <option value="">전체 권한</option>
          {ROLE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">전체 상태</option>
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FilterBar>
      {list.error && <div className="alert">{list.error}</div>}
      <div className="card">
        <DataTable columns={columns} rows={list.data.rows} loading={list.loading} colFilters={list.colFilters} onColFilter={list.onColFilter} />
        <Pagination page={list.page} size={list.size} total={list.data.total} onChange={list.setPage} />
      </div>

      {modal?.mode === 'create' && (
        <FormModal
          title="사용자 등록"
          submitLabel="등록"
          fields={[
            { name: 'username', label: '아이디', required: true, hint: '영문/숫자 4~30자' },
            { name: 'name', label: '이름', required: true },
            { name: 'email', label: '이메일', type: 'email', full: true },
            { name: 'password', label: '비밀번호', type: 'password', required: true, hint: '영문+숫자 포함 8자 이상' },
            { name: 'password2', label: '비밀번호 확인', type: 'password', required: true },
            { name: 'role', label: '권한', type: 'select', required: true, default: 'ADMIN', options: ROLE_OPTS },
            { name: 'status', label: '상태', type: 'select', required: true, default: 'ACTIVE', options: STATUS_OPTS },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            if (v.password !== v.password2) throw new Error('비밀번호가 일치하지 않습니다.');
            await api.post('/users', v);
            done('사용자가 등록되었습니다.');
          }}
        />
      )}
      {modal?.mode === 'edit' && (
        <FormModal
          title={`사용자 수정 · ${modal.row.username}`}
          initial={modal.row}
          fields={[
            { name: 'name', label: '이름', required: true },
            { name: 'email', label: '이메일', type: 'email' },
            { name: 'role', label: '권한', type: 'select', required: true, options: ROLE_OPTS },
            { name: 'status', label: '상태', type: 'select', required: true, options: STATUS_OPTS },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            await api.put(`/users/${modal.row.id}`, v);
            done('수정되었습니다.');
          }}
        />
      )}
      {modal?.mode === 'reset' && (
        <FormModal
          title={`비밀번호 초기화 · ${modal.row.username}`}
          submitLabel="초기화"
          fields={[
            { name: 'password', label: '새 비밀번호', type: 'password', required: true, full: true, hint: '영문+숫자 포함 8자 이상' },
            { name: 'password2', label: '새 비밀번호 확인', type: 'password', required: true, full: true },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            if (v.password !== v.password2) throw new Error('비밀번호가 일치하지 않습니다.');
            await api.post(`/users/${modal.row.id}/reset-password`, { password: v.password });
            done('비밀번호가 초기화되었습니다. 해당 사용자의 기존 세션은 종료됩니다.');
          }}
        />
      )}
    </>
  );
}
