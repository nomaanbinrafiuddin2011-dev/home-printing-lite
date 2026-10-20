'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminFetch, openAdminFile } from '@/components/admin/ui';
import { rupees } from '@/lib/pricing';
import { buildJobSheet } from '@/lib/jobsheet';
import type { JobSheet } from '@/lib/jobsheet';
import type { AdminOrder } from '@/lib/admin-store';

const when = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function JobSheetPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<AdminOrder | null>(null), [printers, setPrinters] = useState<string[] | null>(null), [err, setErr] = useState(''), [note, setNote] = useState('');
  useEffect(() => { adminFetch(`/api/admin/orders/${params.id}`).then(r => r.ok ? (setOrder(r.order), setPrinters(r.suitablePrinters ?? null)) : setErr(r.error ?? 'Could not load this order.')); }, [params.id]);
  if (err) return <p className="err" role="alert">{err} <Link href="/admin/queue">Back to queue</Link></p>;
  if (!order) return <p><span className="spin" aria-hidden />Loading…</p>;
  const s: JobSheet = buildJobSheet(order);

  async function print() {
    setNote('');
    const r = await adminFetch(`/api/admin/orders/${params.id}/job-sheet`, { method: 'POST' });
    if (!r.ok) { setNote(r.error ?? 'Could not record this in the audit log.'); if (s.cancelled) return; }
    window.print();   // opens the browser's normal print dialog; the site cannot see or control the printer
  }
  return <>
    <div className="no-print">
      <div className="row" style={{ marginTop: 0 }}>
        <Link className="btn sm ghostd" href="/admin/queue">← Queue</Link>
        <button className="btn sm pink" onClick={print} disabled={s.cancelled}>Print job sheet</button>
        {order.items.map(i => <button key={i.id} className="btn sm ghostd" disabled={!i.hasFile} onClick={async () => { const e = await openAdminFile(i.id, 'view'); if (e) setNote(e); }}>{i.hasFile ? 'View customer PDF' : 'PDF deleted'}</button>)}
      </div>
      <p className="hint">This sheet is for you; it always prints in black &amp; white on A4, whatever paper size the customer chose. It opens your browser&apos;s print dialog; choose your printer and A4 there. Print the customer&apos;s PDF separately with the settings shown below.</p>
      {note && <p className="err" role="alert">{note}</p>}
    </div>
    <article className="sheet" aria-label={`Job sheet ${s.orderNumber}`}>
      {s.cancelled && <p className="js-box" style={{ fontSize: '16pt', fontWeight: 700, textAlign: 'center' }}>CANCELLED: DO NOT PRINT</p>}
      <div className="js-top"><div><div className="js-small">JOB SHEET · Home Printing Service</div><h1>{s.orderNumber}</h1></div>
        <div className="js-type">{s.printType === 'bw' ? 'B&W' : s.printType === 'colour' ? 'COLOUR' : 'MIXED'}</div></div>
      <table className="js-tbl"><tbody>
        <tr><th>Ordered</th><td>{when(s.createdAt)}</td><th>Status</th><td>{s.status.replace(/_/g, ' ').toUpperCase()}</td></tr>
        <tr><th>Customer</th><td>{s.customerName}</td><th>Phone</th><td>{s.phone}</td></tr>
        <tr><th>Fulfilment</th><td colSpan={3}><b>{s.fulfilment === 'delivery' ? 'DELIVERY' : 'PICKUP'}</b>{s.address && <> · {s.address}</>}</td></tr>
        <tr><th>Payment</th><td colSpan={3}><b>{s.payment.label}</b>{s.payment.amountDuePaise > 0 && <> · {rupees(s.payment.amountDuePaise)}</>}</td></tr></tbody></table>
      {s.items.map((i, n) => <section key={n} className="js-box">
        <div className="js-small">FILE {s.items.length > 1 ? n + 1 : ''}</div><div style={{ fontWeight: 700, wordBreak: 'break-all' }}>{i.fileName}</div>
        <div className="js-grid">
          <div><span className="js-small">PRINT</span><div className="js-big">{i.colour.toUpperCase()}</div></div>
          <div><span className="js-small">SIDES</span><div className="js-big">{i.duplex.toUpperCase()}</div></div>
          <div><span className="js-small">COPIES</span><div className="js-big">{i.copies}</div></div>
          <div><span className="js-small">PAPER</span><div className="js-big">{i.paper}</div><span className="js-small">{i.paperDims ? `${i.paperDims} · ` : ''}{i.orientation}</span></div></div>
        {i.nonA4 && <p style={{ margin: '8px 0 0', border: '2px solid #000', padding: '4px 8px', fontWeight: 700 }}>LOAD {i.paper.toUpperCase()} PAPER for the customer&apos;s file. (This job sheet itself prints on A4.)</p>}
        <p style={{ margin: '8px 0 0' }}><b>Pages to print:</b> {i.selection} <span className="js-small">({i.selectedCount} of {i.totalPages} pages in the file)</span></p>
        <p style={{ margin: '2px 0 0' }}><b>Totals:</b> {i.sidesPerCopy} sides per copy × {i.copies} = <b>{i.totalSides} printed sides</b> · <b>{i.sheets} sheets</b> of paper</p>
        {i.warning && <p style={{ margin: '6px 0 0', fontWeight: 700 }}>⚠ {i.warning}</p>}</section>)}
      <section className="js-box"><div className="js-small">SUITABLE PRINTERS (active, with this paper size, colour and duplex)</div><div style={{ fontWeight: 700 }}>{printers === null ? 'Not checked' : printers.length ? printers.join(', ') : 'NONE: no active printer can do this job. Check Paper & printers.'}</div></section>
      <section className="js-box"><div className="js-small">CUSTOMER INSTRUCTIONS</div><div style={{ minHeight: '14mm', whiteSpace: 'pre-wrap' }}>{s.instructions || 'None'}</div></section>
      <section className="js-box"><div className="js-small">OPERATOR CHECKLIST</div>
        <div className="js-check">{['PDF opened and page range checked', 'Printer set: colour / B&W, sides, A4', 'First page checked', 'All copies printed', 'Quality checked', s.fulfilment === 'delivery' ? 'Packed and labelled for delivery' : 'Packed and ready for pickup'].map(t => <div key={t}>☐ {t}</div>)}</div></section>
      <p className="js-small" style={{ marginTop: 8 }}>Total {s.totalSides} sides · {s.totalSheets} sheets · Printed from the admin dashboard on {when(new Date().toISOString())}</p>
    </article></>;
}
