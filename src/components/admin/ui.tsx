'use client';
import { useEffect, useRef } from 'react';

export type Res = { ok: boolean; error?: string; code?: string; [k: string]: any };
/** Thin fetch wrapper. A 401 sends the user to the login page; the server re-checks authorisation on every call regardless. */
export async function adminFetch(url: string, init?: RequestInit & { json?: unknown }): Promise<Res> {
  try {
    const r = await fetch(url, { ...init, headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body, cache: 'no-store' });
    if (r.status === 401) { window.location.href = '/admin/login'; return { ok: false, error: 'Please sign in.' }; }
    return await r.json();
  } catch { return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }; }
}

export function ConfirmDialog(p: { open: boolean; title: string; confirmLabel: string; danger?: boolean; busy?: boolean; error?: string; disabled?: boolean; children?: React.ReactNode; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (p.open && !d.open) d.showModal(); if (!p.open && d.open) d.close(); }, [p.open]);
  return (
    <dialog ref={ref} className="dlg" onCancel={e => { e.preventDefault(); if (!p.busy) p.onCancel(); }}>
      <h3 style={{ marginTop: 0 }}>{p.title}</h3>
      <div>{p.children}</div>
      {p.error && <p className="err" role="alert">{p.error}</p>}
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button type="button" className="btn sm ghostd" onClick={p.onCancel} disabled={p.busy}>Cancel</button>
        <button type="button" className={'btn sm ' + (p.danger ? 'dng' : 'pink')} onClick={p.onConfirm} disabled={p.busy || p.disabled}>{p.busy && <span className="spin" aria-hidden />}{p.confirmLabel}</button>
      </div>
    </dialog>);
}

export function SignOut() {
  return <button type="button" className="theme" onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); window.location.href = '/admin/login'; }}>Sign out</button>;
}

/** Opens a customer PDF through the audited 60-second signed-link endpoint (never a public URL). */
export async function openAdminFile(itemId: string, mode: 'view' | 'download'): Promise<string | null> {
  const w = mode === 'view' ? window.open('', '_blank') : null;
  const r = await adminFetch(`/api/admin/files/${itemId}?mode=${mode}`);
  if (!r.ok) { w?.close(); return r.error ?? 'Could not open the file.'; }
  if (w) { w.opener = null; w.location.href = r.url; } else window.location.href = r.url;
  return null;
}
