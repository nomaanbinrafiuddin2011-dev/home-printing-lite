'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch, ConfirmDialog } from '@/components/admin/ui';
import { rupees } from '@/lib/pricing';
import { HANDOVER, STATUSES, STATUS_LABEL, nextStatuses } from '@/lib/order-status';
import type { Status } from '@/lib/order-status';
import type { AdminOrder } from '@/lib/admin-store';

const PAY = ['pending', 'cash_pending', 'paid', 'failed', 'refund_pending', 'refunded'];
const PAY_LABEL: Record<string, string> = { pending: 'Pending', cash_pending: 'Cash pending', paid: 'Paid', failed: 'Failed', refund_pending: 'Refund pending', refunded: 'Refunded' };
type Act = { kind: 'status'; o: AdminOrder; to: Status } | { kind: 'cancel'; o: AdminOrder } | { kind: 'cash'; o: AdminOrder };

export default function OrdersPage() {
  const [f, setF] = useState({ q: '', status: 'all', payment: 'all', fulfilment: 'all', from: '', to: '' }), [page, setPage] = useState(1);
  const [data, setData] = useState<{ orders: AdminOrder[]; total: number; pageSize: number } | null>(null), [err, setErr] = useState(''), [loading, setLoading] = useState(true), [ready, setReady] = useState(false);
  const [open, setOpen] = useState<string | null>(null), [act, setAct] = useState<Act | null>(null), [busy, setBusy] = useState(false), [aerr, setAerr] = useState(''), [reason, setReason] = useState(''), [amount, setAmount] = useState(''), [note, setNote] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => { const p = new URLSearchParams(window.location.search); setF(x => ({ ...x, status: p.get('status') ?? 'all', payment: p.get('payment') ?? 'all' })); setReady(true); }, []);
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    const p = new URLSearchParams({ ...f, page: String(page) }); const r = await adminFetch('/api/admin/orders?' + p);
    if (r.ok) setData({ orders: r.orders, total: r.total, pageSize: r.pageSize }); else setErr(r.error ?? 'Could not load orders.');
    setLoading(false);
  }, [f, page]);
  useEffect(() => { if (!ready) return; const t = setTimeout(load, f.q ? 300 : 0); return () => clearTimeout(t); }, [load, ready, f.q]);
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };

  const close = () => { setAct(null); setAerr(''); setReason(''); setNote(''); };
  const openAct = (a: Act) => { setAct(a); setAerr(''); setReason(''); setNote(''); setAmount(a.kind === 'cash' ? String(a.o.totalPaise / 100) : ''); };
  async function confirm() {
    if (!act) return; setBusy(true); setAerr('');
    const o = act.o; let r;
    if (act.kind === 'cash') { const paise = Math.round(Number(amount) * 100); r = await adminFetch(`/api/admin/orders/${o.id}/collect-cash`, { method: 'POST', json: { amountPaise: paise, note } }); }
    else r = await adminFetch(`/api/admin/orders/${o.id}/status`, { method: 'POST', json: { to: act.kind === 'cancel' ? 'cancelled' : act.to, expectedStatus: o.status, reason } });
    setBusy(false);
    if (r.ok) { setToast(act.kind === 'cash' ? 'Cash collection recorded.' : 'Order updated.'); close(); load(); setTimeout(() => setToast(''), 4000); }
    else { setAerr(r.error ?? 'Could not complete that action.'); if (r.code === 'STALE' || r.code === 'DUPLICATE') load(); }
  }
  async function file(itemId: string, mode: 'view' | 'download') {
    const w = mode === 'view' ? window.open('', '_blank') : null;
    const r = await adminFetch(`/api/admin/files/${itemId}?mode=${mode}`);
    if (!r.ok) { w?.close(); setToast(r.error ?? 'Could not open the file.'); setTimeout(() => setToast(''), 5000); return; }
    if (w) { w.opener = null; w.location.href = r.url; } else window.location.href = r.url;
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <>
    <h1 style={{ marginTop: 0 }}>Orders</h1>
    <div className="panel filters">
      <input type="search" aria-label="Search by order number, name or phone" placeholder="Search order no., name or phone" value={f.q} onChange={e => set('q', e.target.value)} />
      <select aria-label="Status" value={f.status} onChange={e => set('status', e.target.value)}><option value="all">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      <select aria-label="Payment" value={f.payment} onChange={e => set('payment', e.target.value)}><option value="all">All payments</option>{PAY.map(s => <option key={s} value={s}>{PAY_LABEL[s]}</option>)}</select>
      <select aria-label="Pickup or delivery" value={f.fulfilment} onChange={e => set('fulfilment', e.target.value)}><option value="all">Pickup &amp; delivery</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select>
      <label className="dt">From <input type="date" value={f.from} onChange={e => set('from', e.target.value)} /></label>
      <label className="dt">To <input type="date" value={f.to} onChange={e => set('to', e.target.value)} /></label>
    </div>
    {toast && <p className="ok" role="status">{toast}</p>}
    {err && <p className="err" role="alert">{err} <button className="btn sm pink" onClick={load}>Retry</button></p>}
    {loading && <p role="status"><span className="spin" aria-hidden />Loading…</p>}
    {!loading && data && data.orders.length === 0 && <p className="hint">No orders match these filters.</p>}
    {data?.orders.map(o => {
      const isOpen = open === o.id, nexts = nextStatuses(o.status as Status, o.fulfilment).filter(s => s !== 'cancelled');
      const canCash = o.paymentMethod === 'cash' && o.paymentStatus === 'cash_pending' && HANDOVER.includes(o.status as Status);
      return <article key={o.id} className="ocard">
        <button className="ohead" onClick={() => setOpen(isOpen ? null : o.id)} aria-expanded={isOpen}>
          <span><b>{o.orderNumber}</b><br /><span className="hint">{new Date(o.createdAt).toLocaleString('en-IN')}</span></span>
          <span>{o.customerName}<br /><span className="hint">{o.phone}</span></span>
          <span>{rupees(o.totalPaise)}<br /><span className="hint">{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span></span>
          <span><span className={'pill s-' + o.status}>{STATUS_LABEL[o.status as Status] ?? o.status}</span><br /><span className={'pill p-' + o.paymentStatus}>{PAY_LABEL[o.paymentStatus] ?? o.paymentStatus}</span></span>
        </button>
        {isOpen && <div className="obody">
          <p><b>Customer:</b> {o.customerName} · <a href={`tel:+91${o.phone}`}>{o.phone}</a>{o.email && <> · {o.email}</>}</p>
          {o.fulfilment === 'delivery' && <p><b>Deliver to:</b> {o.deliveryAddress}</p>}
          {o.instructions && <p><b>Instructions:</b> {o.instructions}</p>}
          <div className="tblw"><table className="bk"><thead><tr><td><b>File</b></td><td><b>Pages</b></td><td><b>Copies</b></td><td><b>Type</b></td><td><b>Line</b></td></tr></thead><tbody>
            {o.items.map(i => <tr key={i.id}><td>{i.originalName}<div className="row"><button className="btn sm ghostd" disabled={!i.hasFile} onClick={() => file(i.id, 'view')}>View</button><button className="btn sm ghostd" disabled={!i.hasFile} onClick={() => file(i.id, 'download')}>Download</button>{!i.hasFile && <span className="hint">deleted (retention)</span>}</div></td>
              <td style={{ textAlign: 'left' }}>{i.pageRange ?? `All ${i.totalPages}`} <span className="hint">of {i.totalPages}</span></td><td style={{ textAlign: 'left' }}>{i.copies}</td><td style={{ textAlign: 'left' }}>{i.colorMode === 'c' ? 'Colour' : 'B&W'}, {i.sides === 2 ? '2-sided' : '1-sided'}, {i.paperSize}</td><td>{rupees(i.lineTotalPaise)}</td></tr>)}</tbody></table></div>
          <p>Printing {rupees(o.subtotalPaise)}{o.deliveryFeePaise > 0 && <> + delivery {rupees(o.deliveryFeePaise)}</>} = <b>{rupees(o.totalPaise)}</b> · payment: {o.paymentMethod === 'cash' ? 'cash' : o.paymentMethod}</p>
          {o.collection && <p className="ok">Cash {rupees(o.collection.amountPaise)} collected {new Date(o.collection.collectedAt).toLocaleString('en-IN')} by {o.collection.collectedByEmail ?? 'admin'}.</p>}
          {o.cancelReason && <p className="err">Cancelled: {o.cancelReason}</p>}
          <div className="row">
            {nexts.map(s => <button key={s} className="btn sm pink" onClick={() => openAct({ kind: 'status', o, to: s })}>Mark {STATUS_LABEL[s].toLowerCase()}</button>)}
            <a className="btn sm ghostd" href={`/admin/orders/${o.id}/job-sheet`}>Job sheet</a>
            {canCash && <button className="btn sm green" onClick={() => openAct({ kind: 'cash', o })}>Record cash collected</button>}
            {nextStatuses(o.status as Status, o.fulfilment).includes('cancelled') && <button className="btn sm dng" onClick={() => openAct({ kind: 'cancel', o })}>Cancel order</button>}
            {o.status === 'ready_for_pickup' || o.status === 'out_for_delivery' ? (o.paymentStatus !== 'paid' && <span className="hint">Record the cash first, then mark completed.</span>) : null}
          </div>
        </div>}
      </article>; })}
    {data && data.total > data.pageSize && <div className="row" style={{ justifyContent: 'center', margin: '16px 0' }}>
      <button className="btn sm ghostd" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn sm ghostd" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}

    <ConfirmDialog open={!!act} busy={busy} error={aerr} onCancel={close} onConfirm={confirm}
      danger={act?.kind === 'cancel'} disabled={act?.kind === 'cancel' ? reason.trim().length < 3 : act?.kind === 'cash' ? !(Number(amount) > 0) : false}
      title={act?.kind === 'cash' ? 'Record cash collected' : act?.kind === 'cancel' ? 'Cancel this order?' : act ? `Mark ${STATUS_LABEL[act.to].toLowerCase()}?` : ''}
      confirmLabel={act?.kind === 'cash' ? 'Yes, record cash' : act?.kind === 'cancel' ? 'Cancel order' : 'Confirm'}>
      {act && <p>Order <b>{act.o.orderNumber}</b> · {act.o.customerName} · {rupees(act.o.totalPaise)}</p>}
      {act?.kind === 'cancel' && <><label htmlFor="rs">Reason (required, saved in the audit log)</label><textarea id="rs" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /><p className="hint">Paid orders cannot be cancelled here (refunds are not supported yet).</p></>}
      {act?.kind === 'cash' && <><p>Only record this after you have actually received the money. It can be recorded <b>once</b> and cannot be undone here.</p><label htmlFor="amt">Amount received (₹) — must equal the total</label><input id="amt" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><label htmlFor="nt">Note (optional)</label><input id="nt" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} /></>}
      {act?.kind === 'status' && <p>This is saved with your name in the audit log.</p>}
    </ConfirmDialog>
  </>;
}
