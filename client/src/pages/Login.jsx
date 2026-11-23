import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post('/auth/login', form);
      setUser(user);
      navigate(location.state?.from && location.state.from !== '/login' ? location.state.from : '/stats', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-lg">
          <span className="brand-mark">F</span>
          <div>
            <strong>Freed Platform</strong>
            <small>관리자 ERP</small>
          </div>
        </div>
        <p className="muted login-desc">관리자 계정으로만 접속할 수 있습니다.</p>
        <label className="field">
          <span className="field-label">아이디</span>
          <input
            autoFocus
            autoComplete="username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      </form>
    </div>
  );
}
