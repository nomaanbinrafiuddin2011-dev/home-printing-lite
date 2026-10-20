'use client';
import { useState } from 'react';
import { adminFetch } from '@/components/admin/ui';

export default function Login() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await adminFetch('/api/admin/login', { method: 'POST', json: { email, password } });
    if (r.ok) window.location.href = '/admin'; else { setErr(r.error ?? 'Could not sign in.'); setBusy(false); }
  }
  return (
    <div className="wrap page" style={{ maxWidth: 440 }}>
      <h1>Admin sign in</h1>
      <p>For the business owner and authorised staff only.</p>
      <form className="panel" onSubmit={go} noValidate>
        <label htmlFor="em">Email</label><input id="em" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        <label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', font: 'inherit' }} />
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn pink" style={{ marginTop: 16, width: '100%' }} disabled={busy || !email || !password}>{busy && <span className="spin" aria-hidden />}Sign in</button>
      </form>
    </div>);
}
