'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, ConfirmDialog } from '@/components/admin/ui';
import { rupees } from '@/lib/pricing';
import type { Catalogue, PaperSize, Printer } from '@/lib/catalogue';

const put = (json: unknown) => adminFetch('/api/admin/catalogue', { method: 'PUT', json });
const inp: React.CSSProperties = { width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', font: 'inherit' };

function SizeCard({ s, cat, done }: { s: PaperSize; cat: Catalogue; done: (m: string) => void }) {
  const p = cat.prices[s.id] ?? {};
  const [enabled, setEnabled] = useState(s.enabled), [bw, setBw] = useState(p.bw ? String(p.bw / 100) : ''), [c, setC] = useState(p.c ? String(p.c / 100) : '');
  const [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const changed = enabled !== s.enabled || bw !== (p.bw ? String(p.bw / 100) : '') || c !== (p.c ? String(p.c / 100) : '');
  const sup = cat.printers.filter(x => x.active && x.paperSizeIds.includes(s.id));
  async function save() {
    setBusy(true); setErr('');
    const body: Record<string, unknown> = { op: 'set_size', id: s.id };
    if (enabled !== s.enabled) body.enabled = enabled;
    if (bw !== (p.bw ? String(p.bw / 100) : '') && bw.trim() !== '') body.bwRupees = Number(bw);
    if (c !== (p.c ? String(p.c / 100) : '') && c.trim() !== '') body.colourRupees = Number(c);
    const r = await put(body); setBusy(false);
    if (r.ok) { setAsk(false); done(`${s.name} saved.`); } else setErr(r.error ?? 'Could not save.');
  }
  return <div className="panel">
    <h3 style={{ marginTop: 0 }}>{s.name} <span className="hint">{s.widthMm} × {s.heightMm} mm{s.isCustom ? ' · custom' : ''}</span></h3>
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Offer to customers</label>
    <label htmlFor={`bw-${s.id}`}>Black &amp; white price per side (₹)</label><input id={`bw-${s.id}`} type="number" step="0.01" min="0" style={inp} value={bw} placeholder="not set" onChange={e => setBw(e.target.value)} />
    <label htmlFor={`c-${s.id}`}>Colour price per side (₹)</label><input id={`c-${s.id}`} type="number" step="0.01" min="0" style={inp} value={c} placeholder="not set" onChange={e => setC(e.target.value)} />
    <p className="hint">{sup.length ? `Active printers: ${sup.map(x => x.name).join(', ')}.` : 'No active printer supports this size yet.'} Leave a price empty to not offer that print type.</p>
    <button className="btn sm pink" disabled={!changed} onClick={() => { setErr(''); setAsk(true); }}>Save {s.name}</button>
    <ConfirmDialog open={ask} busy={busy} error={err} title={`Save ${s.name}?`} confirmLabel="Save" onCancel={() => setAsk(false)} onConfirm={save}>
      <p>{enabled !== s.enabled ? (enabled ? `Customers will be able to order ${s.name}. ` : `${s.name} will be hidden from customers. `) : ''}{bw || c ? `Prices: B&W ${bw ? rupees(Math.round(Number(bw) * 100)) : 'not set'}, colour ${c ? rupees(Math.round(Number(c) * 100)) : 'not set'}. ` : ''}Applies to new orders immediately and is recorded in the audit log.</p></ConfirmDialog></div>;
}

function PrinterCard({ pr, cat, done }: { pr: Printer | null; cat: Catalogue; done: (m: string) => void }) {
  const blank = { name: '', active: true, supportsColour: false, supportsDuplex: false, paperSizeIds: [] as string[] };
  const [f, setF] = useState(pr ? { name: pr.name, active: pr.active, supportsColour: pr.supportsColour, supportsDuplex: pr.supportsDuplex, paperSizeIds: pr.paperSizeIds } : blank);
  const [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const toggle = (id: string) => setF({ ...f, paperSizeIds: f.paperSizeIds.includes(id) ? f.paperSizeIds.filter(x => x !== id) : [...f.paperSizeIds, id] });
  async function save() {
    setBusy(true); setErr(''); const r = await put({ op: 'save_printer', id: pr?.id, ...f }); setBusy(false);
    if (r.ok) { setAsk(false); done(`${f.name} saved.`); if (!pr) setF(blank); } else setErr(r.error ?? 'Could not save.');
  }
  return <div className="panel">
    <h3 style={{ marginTop: 0 }}>{pr ? pr.name : 'Add a printer'}</h3>
    <label htmlFor={`pn-${pr?.id ?? 'new'}`}>Name</label><input id={`pn-${pr?.id ?? 'new'}`} style={inp} value={f.name} maxLength={60} onChange={e => setF({ ...f, name: e.target.value })} />
    <div className="row"><label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />Active</label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}><input type="checkbox" checked={f.supportsColour} onChange={e => setF({ ...f, supportsColour: e.target.checked })} />Colour</label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}><input type="checkbox" checked={f.supportsDuplex} onChange={e => setF({ ...f, supportsDuplex: e.target.checked })} />Double-sided</label></div>
    <p style={{ margin: '12px 0 4px', fontWeight: 700 }}>Paper sizes it can print</p>
    <div className="row" style={{ marginTop: 0 }}>{cat.sizes.map(s => <label key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, fontWeight: 400 }}><input type="checkbox" checked={f.paperSizeIds.includes(s.id)} onChange={() => toggle(s.id)} />{s.name}</label>)}</div>
    <button className="btn sm pink" style={{ marginTop: 12 }} disabled={!f.name.trim()} onClick={() => { setErr(''); setAsk(true); }}>{pr ? 'Save printer' : 'Add printer'}</button>
    <ConfirmDialog open={ask} busy={busy} error={err} title={pr ? `Save ${pr.name}?` : 'Add this printer?'} confirmLabel={pr ? 'Save' : 'Add printer'} onCancel={() => setAsk(false)} onConfirm={save}>
      <p>{f.active ? 'Active' : 'Inactive'} · {f.supportsColour ? 'colour' : 'B&W only'} · {f.supportsDuplex ? 'double-sided' : 'single-sided only'} · {f.paperSizeIds.length ? cat.sizes.filter(s => f.paperSizeIds.includes(s.id)).map(s => s.name).join(', ') : 'no sizes'}.</p>
      <p className="hint">Changes what customers can order straight away. Recorded in the audit log.</p></ConfirmDialog></div>;
}

function AddSize({ done }: { done: (m: string) => void }) {
  const [name, setName] = useState(''), [w, setW] = useState(''), [h, setH] = useState(''), [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function save() { setBusy(true); setErr(''); const r = await put({ op: 'add_size', name, widthMm: Number(w), heightMm: Number(h) }); setBusy(false); if (r.ok) { setAsk(false); setName(''); setW(''); setH(''); done(`${name} added (hidden until you enable it and set a price).`); } else setErr(r.error ?? 'Could not add.'); }
  return <div className="panel"><h3 style={{ marginTop: 0 }}>Add a custom size</h3>
    <label htmlFor="cs-n">Name</label><input id="cs-n" style={inp} value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="e.g. Photo 4x6" />
    <div className="row" style={{ alignItems: 'flex-end' }}><div style={{ flex: 1 }}><label htmlFor="cs-w">Width (mm)</label><input id="cs-w" type="number" style={inp} value={w} onChange={e => setW(e.target.value)} /></div><div style={{ flex: 1 }}><label htmlFor="cs-h">Height (mm)</label><input id="cs-h" type="number" style={inp} value={h} onChange={e => setH(e.target.value)} /></div></div>
    <p className="hint">New sizes start hidden and unpriced.</p>
    <button className="btn sm pink" disabled={!name.trim() || !w || !h} onClick={() => { setErr(''); setAsk(true); }}>Add size</button>
    <ConfirmDialog open={ask} busy={busy} error={err} title="Add this paper size?" confirmLabel="Add size" onCancel={() => setAsk(false)} onConfirm={save}><p>{name} · {w} × {h} mm</p></ConfirmDialog></div>;
}

export default function CataloguePage() {
  const [d, setD] = useState<{ catalogue: Catalogue; warnings: string[]; ready: boolean } | null>(null), [err, setErr] = useState(''), [toast, setToast] = useState('');
  const load = useCallback(async () => { const r = await adminFetch('/api/admin/catalogue'); if (r.ok) setD(r as any); else setErr(r.error ?? 'Could not load.'); }, []);
  useEffect(() => { load(); }, [load]);
  const done = (m: string) => { setToast(m); setTimeout(() => setToast(''), 5000); load(); };
  if (err) return <p className="err" role="alert">{err}</p>;
  if (!d) return <p><span className="spin" aria-hidden />Loading…</p>;
  const cat = d.catalogue;
  return <>
    <h1 style={{ marginTop: 0 }}>Paper &amp; printers</h1>
    <p className="hint">Customers only see paper sizes that are switched on, and only print options that one of your active printers can really do (size + colour + double-sided together). Prices are per printed side and are never guessed: leave a price empty to not offer it.</p>
    {!d.ready && <div className="banner" role="alert"><b>Migration 0005 has not been run.</b> The site is using the original A4-only setup. Run <code>0005_catalogue.sql</code> in Supabase to manage sizes and printers here.</div>}
    {d.warnings.map(w => <div key={w} className="banner" role="status">{w}</div>)}
    {toast && <p className="ok" role="status">{toast}</p>}
    <h2>Paper sizes</h2>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>{cat.sizes.map(s => <SizeCard key={s.id + JSON.stringify(cat.prices[s.id]) + s.enabled} s={s} cat={cat} done={done} />)}<AddSize done={done} /></div>
    <h2>Printers</h2>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>{cat.printers.map(p => <PrinterCard key={p.id + JSON.stringify(p)} pr={p} cat={cat} done={done} />)}<PrinterCard pr={null} cat={cat} done={done} /></div>
    <p className="hint">Printers and sizes are never deleted, so old orders stay accurate; switch them off instead.</p>
  </>;
}
