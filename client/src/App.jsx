import React, { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, IS_DEMO, setUnauthorizedHandler } from './api.js';
import { FeedbackProvider, FormModal, useConfirm, useToast } from './components/ui.jsx';
import { LABELS } from './format.js';
import Login from './pages/Login.jsx';
import Corporations from './pages/Corporations.jsx';
import Pgs from './pages/Pgs.jsx';
import Transactions from './pages/Transactions.jsx';
import Cards from './pages/Cards.jsx';
import Stats from './pages/Stats.jsx';
import Users from './pages/Users.jsx';
import Issuers from './pages/Issuers.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

/** 사이드바 메뉴: 집계(전체 현황) → 법인 / PG / 선불사업 → 사용자 관리(시스템) */
const MENU_GROUPS = [
  { items: [{ to: '/stats', label: '집계', icon: '📊', element: <Stats /> }] },
  {
    title: '법인',
    items: [
      { to: '/corporations', label: '법인 관리', icon: '🏢', element: <Corporations /> },
      { to: '/transactions', label: '거래내역', icon: '🧾', element: <Transactions /> },
    ],
  },
  {
    title: 'PG',
    items: [{ to: '/pgs', label: 'PG 관리', icon: '🔌', element: <Pgs /> }],
  },
  {
    title: '선불사업',
    items: [
      { to: '/issuers', label: '선불사업자', icon: '🏦', element: <Issuers /> },
      { to: '/cards', label: '선불카드 관리', icon: '💳', element: <Cards /> },
    ],
  },
  { title: '시스템', items: [{ to: '/users', label: '사용자 관리', icon: '👤', element: <Users /> }] },
];
const MENU = MENU_GROUPS.flatMap((g) => g.items.map((m) => ({ ...m, group: g.title })));

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = 확인 중
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
    navigate('/login');
  };

  if (user === undefined) return <div className="boot">로딩 중…</div>;

  return (
    <AuthCtx.Provider value={{ user, setUser, logout }}>
      <FeedbackProvider>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/stats" replace /> : <Login />} />
          <Route
            path="/*"
            element={user ? <Shell /> : <Navigate to="/login" replace state={{ from: location.pathname }} />}
          />
        </Routes>
      </FeedbackProvider>
    </AuthCtx.Provider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const location = useLocation();
  const toast = useToast();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">F</span>
          <div>
            <strong>Freed Platform</strong>
            <small>관리자 ERP</small>
          </div>
        </div>
        <nav>
          {MENU_GROUPS.map((g, gi) => (
            <div key={g.title || gi} className={`nav-group ${g.title === '시스템' ? 'nav-group-system' : ''}`}>
              {g.title && <div className="nav-group-title">{g.title}</div>}
              {g.items.map((m) => (
                <NavLink key={m.to} to={m.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon" aria-hidden>{m.icon}</span>{m.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot muted">
          <div>v1.0.0{IS_DEMO && ' · 체험용 데모'}</div>
          {IS_DEMO && <DemoReset />}
        </div>
      </aside>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="메뉴">☰</button>
          <div className="topbar-title">
            {(() => {
              const m = MENU.find((x) => location.pathname.startsWith(x.to));
              return m ? <>{m.group && m.group !== '시스템' && <span className="crumb">{m.group} ›</span>}{m.label}</> : null;
            })()}
          </div>
          <div className="topbar-user">
            <div className="user-chip">
              <span className="avatar">{user.name?.[0]}</span>
              <div>
                <strong>{user.name}</strong>
                <small>{LABELS.role[user.role]}</small>
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => setPwOpen(true)}>비밀번호 변경</button>
            <button className="btn btn-sm" onClick={logout}>로그아웃</button>
          </div>
        </header>
        <main className="content">
          <Routes>
            {MENU.map((m) => <Route key={m.to} path={`${m.to}/*`} element={m.element} />)}
            <Route path="*" element={<Navigate to="/stats" replace />} />
          </Routes>
        </main>
      </div>
      {pwOpen && (
        <FormModal
          title="비밀번호 변경"
          submitLabel="변경"
          fields={[
            { name: 'currentPassword', label: '현재 비밀번호', type: 'password', required: true, full: true },
            { name: 'newPassword', label: '새 비밀번호', type: 'password', required: true, full: true, hint: '영문+숫자 포함 8자 이상' },
            { name: 'confirm', label: '새 비밀번호 확인', type: 'password', required: true, full: true },
          ]}
          onClose={() => setPwOpen(false)}
          onSubmit={async (v) => {
            if (v.newPassword !== v.confirm) throw new Error('새 비밀번호가 일치하지 않습니다.');
            await api.post('/auth/password', v);
            setPwOpen(false);
            toast('비밀번호가 변경되었습니다.');
          }}
        />
      )}
    </div>
  );
}

function DemoReset() {
  const confirm = useConfirm();
  return (
    <button
      className="demo-reset"
      onClick={async () => {
        if (!(await confirm('데모 데이터를 처음 상태로 되돌릴까요?\n이 브라우저에 저장된 변경 내용이 모두 삭제됩니다.', { danger: true, okLabel: '초기화' }))) return;
        if (import.meta.env.MODE === 'demo') (await import('./demo/server.js')).resetDemo();
      }}
    >데모 데이터 초기화</button>
  );
}
