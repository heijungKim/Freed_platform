import React, { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import { FeedbackProvider, FormModal, useToast } from './components/ui.jsx';
import { LABELS } from './format.js';
import Login from './pages/Login.jsx';
import Corporations from './pages/Corporations.jsx';
import Pgs from './pages/Pgs.jsx';
import Transactions from './pages/Transactions.jsx';
import Cards from './pages/Cards.jsx';
import Stats from './pages/Stats.jsx';
import Users from './pages/Users.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const MENU = [
  { to: '/corporations', label: '법인', icon: '🏢', element: <Corporations /> },
  { to: '/pgs', label: 'PG', icon: '🔌', element: <Pgs /> },
  { to: '/transactions', label: '거래내역', icon: '🧾', element: <Transactions /> },
  { to: '/cards', label: '선불카드 관리', icon: '💳', element: <Cards /> },
  { to: '/stats', label: '집계', icon: '📊', element: <Stats /> },
  { to: '/users', label: '사용자 관리', icon: '👤', element: <Users /> },
];

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
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon" aria-hidden>{m.icon}</span>{m.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot muted">v1.0.0</div>
      </aside>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="메뉴">☰</button>
          <div className="topbar-title">{MENU.find((m) => location.pathname.startsWith(m.to))?.label}</div>
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
