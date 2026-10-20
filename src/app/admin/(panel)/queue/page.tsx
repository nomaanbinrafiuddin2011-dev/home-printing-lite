'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch, ConfirmDialog, openAdminFile } from '@/components/admin/ui';
import { rupees } from '@/lib/pricing';
import { PRINT_TYPE_LABEL } from '@/lib/jobsheet';
import type { QueueData, QueueRow } from '@/lib/queue';

type Act = { kind: 'status'; r: QueueRow } | { kind: 'cash'; r: QueueRow };
const TYPE_PILL: Record<string, string> = { bw: 'B&W', colour: 'Colour', mixed: 'Mixed' };

export default function QueuePage() {
  const [f, setF] = useState({ stage: 'to_print', status: 'all', type: 'all', fulfilment: 'all', sort: 'next', dir: 'asc', paper: 'all' });
  const [d, setD] = useState<QueueData | null>(null), [err, setErr] = useState(''), [loading, setLoading] = useState(true), [toast, setToast] = useState('');
  const [act, setAct] = useState<Act | null>(null), [busy, setBusy] = useState(false), [aerr, setAerr] = useState(''), [amount, setAmount] = useState('');
  const dlgOpen = useRef(false); dlgOpen.current = !!act;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true); setErr('');
    const r = await adminFetch('/api/admin/queue?' + new URLSearchParams(f));
    if (r.ok) setD(r as unknown as QueueData); else setErr(r.error ?? 'Could not load the queue.');
    setLoading(false);
  }, [f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { if (!dlgOpen.current && document.visibilityState === 'visible') load(true); }, 30000); return () => clearInterval(t); }, [load]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const set = (k: string, v: string) => setF({ ...f, [k]: v, ...(k === 'stage' ? { status: 'all' } : {}) });

  async function confirm() {
    if (!act) return; setBusy(true); setAerr('');
    const r = act.kind === 'cash'
      ? await adminFetch(`/api/admin/orders/${act.r.id}/collect-cash`, { method: 'POST', json: { amountPaise: Math.round(Number(amount) * 100) } })
      : await adminFetch(`/api/admin/orders/${act.r.id}/status`, { method: 'POST', json: { to: act.r.next!.to, expectedStatus: act.r.status } });
    setBusy(false);
    if (r.ok) { flash(act.kind === 'cash' ? 'Cash recorded.' : 'Order moved on.'); setAct(null); load(true); }
    else { setAerr(r.error ?? 'Could not complete that action.'); if (r.code === 'STALE' || r.code === 'DUPLICATE') load(true); }
  }
  const askNext = (r: QueueRow) => { setAerr(''); setAct({ kind: 'status', r }); };
  const askCash = (r: QueueRow) => { setAerr(''); setAmount(String(r.totalPaise / 100)); setAct({ kind: 'cash', r }); };
  const pdf = async (r: QueueRow) => { const e = await openAdminFile(r.files[0].id, 'view'); if (e) flash(e); };
  const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const Actions = ({ r }: { r: QueueRow }) => <div className="row">
    {r.next && <button className="btn sm pink" onClick={() => askNext(r)}>{r.next.label}</button>}
    {r.canRecordCash && <button className="btn sm green" onClick={() => askCash(r)}>Record cash ({rupees(r.totalPaise)})</button>}
    <Link className="btn sm ghostd" href={`/admin/orders/${r.id}/job-sheet`}>Job sheet</Link>
    <button className="btn sm ghostd" onClick={() => pdf(r)}>View PDF</button></div>;
  const nu = d?.nextUp;
  return <>
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}><h1 style={{ margin: 0 }}>Print queue</h1><button className="btn sm ghostd" onClick={() => load()}>Refresh</button></div>
    <p className="hint">Opens each job sheet in your browser&apos;s normal print dialog. The site cannot control your printer.</p>
    {toast && <p className="ok" role="status">{toast}</p>}
    {err && <p className="err" role="alert">{err} <button className="btn sm pink" onClick={() => load()}>Retry</button></p>}
    {loading && !d && <p role="status"><span className="spin" aria-hidden />Loading…</p>}
    {d && <>
      {d.awaitingConfirmation > 0 && <div className="banner"><b>{d.awaitingConfirmation} new order{d.awaitingConfirmation > 1 ? 's' : ''}</b> waiting for confirmation. <Link href="/admin/orders?status=pending_confirmation">Review and confirm</Link> to add them to the queue.</div>}
      {d.hidden.length > 0 && <div className="banner" role="status"><b>Not shown in the queue:</b> {d.hidden.map(h => `${h.orderNumber} (${h.reason})`).join(', ')}. Check these under Orders.</div>}
      {nu && f.stage !== 'handover' && <div className="panel nextup"><span className="badge">Next up</span>
        <h2 style={{ margin: '8px 0 4px' }}>{nu.orderNumber} · {nu.customerName}</h2>
        <p style={{ margin: '0 0 6px' }}><b>{PRINT_TYPE_LABEL[nu.printType]}</b>, {nu.sides.toLowerCase()} · pages {nu.selection} · <b>{nu.paper}</b> · {nu.copies} cop{nu.copies === 1 ? 'y' : 'ies'} · {nu.totalSides} sides / {nu.sheets} sheets · {nu.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · <span className={'pill s-' + nu.status}>{nu.statusLabel}</span></p>
        {nu.instructions && <p style={{ margin: '0 0 6px' }}><b>Instructions:</b> {nu.instructions}</p>}
        <Actions r={nu} /></div>}
      <div className="kpis" style={{ margin: '14px 0' }}>
        <div className="kpi"><span className="hint">To print</span><b>{d.counts.toPrint}</b></div>
        <div className="kpi"><span className="hint">B&amp;W batch</span><b>{d.batch.bw.orders}</b><span className="hint">{d.batch.bw.sides} sides</span></div>
        <div className="kpi"><span className="hint">Colour batch</span><b>{d.batch.colour.orders}</b><span className="hint">{d.batch.colour.sides} sides</span></div>
        <div className="kpi"><span className="hint">To hand over</span><b>{d.counts.handover}</b></div></div>
      <div className="tabs" role="tablist" aria-label="Queue stage">{([['to_print', 'To print'], ['handover', 'Hand over'], ['all', 'All active']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={f.stage === k} className={f.stage === k ? 'on' : ''} onClick={() => set('stage', k)}>{l}</button>)}</div>
      <div className="panel filters">
        <select aria-label="Status" value={f.status} onChange={e => set('status', e.target.value)}><option value="all">All statuses</option>{(f.stage === 'handover' ? ['ready_for_pickup', 'out_for_delivery'] : f.stage === 'all' ? ['confirmed', 'preparing', 'printing', 'ready_for_pickup', 'out_for_delivery'] : ['confirmed', 'preparing', 'printing']).map(s => <option key={s} value={s}>{({ confirmed: 'Queued', preparing: 'Preparing', printing: 'Printing', ready_for_pickup: 'Ready for pickup', out_for_delivery: 'Out for delivery' } as Record<string, string>)[s]}</option>)}</select>
        <select aria-label="Print type" value={f.type} onChange={e => set('type', e.target.value)}><option value="all">All print types</option><option value="bw">Black &amp; white</option><option value="colour">Colour</option><option value="mixed">Mixed</option></select>
        <select aria-label="Pickup or delivery" value={f.fulfilment} onChange={e => set('fulfilment', e.target.value)}><option value="all">Pickup &amp; delivery</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select>
        <select aria-label="Paper size" value={f.paper} onChange={e => set('paper', e.target.value)}><option value="all">All paper sizes</option>{d.papers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Sort by" value={f.sort} onChange={e => set('sort', e.target.value)}><option value="next">Sort: next to do</option><option value="time">Sort: order time</option><option value="status">Sort: status</option><option value="type">Sort: print type</option><option value="fulfilment">Sort: pickup/delivery</option></select>
        <select aria-label="Direction" value={f.dir} disabled={f.sort === 'next'} onChange={e => set('dir', e.target.value)}><option value="asc">Oldest / first</option><option value="desc">Newest / last</option></select></div>
      {d.rows.length === 0 && <p className="hint">{d.counts.toPrint + d.counts.handover === 0 ? 'The queue is empty. New confirmed orders appear here.' : 'No orders match these filters.'}</p>}
      {d.rows.map(r => <article key={r.id} className="ocard"><div className="qrow">
        <div><b>{r.orderNumber}</b><br /><span className="hint">{when(r.createdAt)}</span></div>
        <div>{r.customerName}<br /><span className="hint">{r.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span></div>
        <div><span className="pill">{TYPE_PILL[r.printType]}</span> <span className="hint">{r.sides}</span><br />Pages {r.selection} × {r.copies} · <b>{r.paper}</b>{r.noPrinter && <><br /><span className="err">No active printer can do this job</span></>}</div>
        <div><span className={'pill s-' + r.status}>{r.statusLabel}</span>{r.paymentStatus === 'cash_pending' ? <><br /><span className="pill p-cash_pending">Cash pending</span></> : <><br /><span className="pill p-paid">Paid</span></>}{r.warning && <><br /><span className="err">Check page selection</span></>}</div>
        <Actions r={r} /></div>{r.instructions && <p className="hint" style={{ margin: '0 14px 12px' }}>Instructions: {r.instructions}</p>}</article>)}
    </>}
    <ConfirmDialog open={!!act} busy={busy} error={aerr} onCancel={() => setAct(null)} onConfirm={confirm} disabled={act?.kind === 'cash' && !(Number(amount) > 0)}
      title={act?.kind === 'cash' ? 'Record cash collected' : act?.r.next?.label ?? ''} confirmLabel={act?.kind === 'cash' ? 'Yes, record cash' : 'Confirm'}>
      {act && <p>Order <b>{act.r.orderNumber}</b> · {act.r.customerName} · {rupees(act.r.totalPaise)}</p>}
      {act?.kind === 'status' && <p>{act.r.next?.to === 'printing' ? 'Mark this only when you are about to print it, so nobody else starts the same job. ' : ''}This is saved with your name in the audit log.</p>}
      {act?.kind === 'cash' && <><p>Only record this after you have received the money. It can be recorded once.</p><label htmlFor="qamt">Amount received (₹), must equal the total</label><input id="qamt" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></>}
    </ConfirmDialog></>;
}
