'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { calculatePrice, expandRange, rupees } from '@/lib/pricing';
import type { Mode, Sides } from '@/lib/pricing';

interface PubSize { id: string; name: string; widthMm: number; heightMm: number; available: boolean; prices: { bw: number | null; c: number | null }; options: { bw: { single: boolean; double: boolean }; c: { single: boolean; double: boolean } } }
interface Config { configured: boolean; catalogue?: { sizes: PubSize[] }; rates: { bw_paise: number; colour_paise: number }; delivery: { enabled: boolean; feePaise: number; minOrderPaise: number; radiusKm: number | null }; pickupEnabled: boolean; cashEnabled: boolean; maxMb: number }
type Up = { s: 'none' } | { s: 'uploading' } | { s: 'ready'; id: string; token: string; pages: number } | { s: 'error'; msg: string };
type Prev = { s: 'none' } | { s: 'loading' } | { s: 'ready'; pages: number } | { s: 'error' };
interface Done { orderNumber: string; totalPaise: number; fulfilment: string; paymentStatus: string }
const MAX_THUMBS = 60;

export default function UploadFlow() {
  const [cfg, setCfg] = useState<Config | null>(null), [cfgErr, setCfgErr] = useState('');
  const [file, setFile] = useState<File | null>(null), [fileErr, setFileErr] = useState('');
  const [up, setUp] = useState<Up>({ s: 'none' }), [prev, setPrev] = useState<Prev>({ s: 'none' }), [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [range, setRange] = useState(''), [copies, setCopies] = useState('1'), [mode, setMode] = useState<Mode>('bw'), [sides, setSides] = useState<Sides>(1), [paper, setPaper] = useState('a4');
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [f, setF] = useState({ name: '', phone: '', email: '', address: '', instructions: '' }), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [fe, setFe] = useState<Record<string, string>>({}), [formErr, setFormErr] = useState(''), [done, setDone] = useState<Done | null>(null);
  const run = useRef(0), key = useRef<string | null>(null), over = useRef(false), [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(j => j.error ? setCfgErr(j.error) : setCfg(j)).catch(() => setCfgErr('Could not load ordering settings. Please refresh the page.'));
  }, []);
  useEffect(() => { if (cfg && !cfg.pickupEnabled && cfg.delivery.enabled) setFulfilment('delivery'); const first = cfg?.catalogue?.sizes.find(s => s.available); if (first) setPaper(first.id); }, [cfg]);

  const pages = up.s === 'ready' ? up.pages : prev.s === 'ready' ? prev.pages : 0;
  const size = cfg?.catalogue?.sizes.find(s => s.id === paper);
  const rates = size ? { bw_paise: size.prices.bw ?? 0, colour_paise: size.prices.c ?? 0 } : cfg?.rates;
  const optOk = (m: Mode, s: Sides) => size ? size.options[m][s === 2 ? 'double' : 'single'] : true;
  function choosePaper(id: string) {
    const z = cfg?.catalogue?.sizes.find(x => x.id === id); setPaper(id); key.current = null; if (!z) return;
    const other: Mode = mode === 'bw' ? 'c' : 'bw';
    for (const [m, s] of [[mode, sides], [mode, 1], [other, 1], [other, 2]] as [Mode, Sides][]) if (z.options[m][s === 2 ? 'double' : 'single']) { setMode(m); setSides(s); return; }
  }
  const res = useMemo(() => !pages ? null : !optOk(mode, sides) ? { ok: false as const, error: `That print option is not available for ${size?.name ?? 'this paper size'}.` } : calculatePrice({ totalPages: pages, range, copies: Number(copies), mode, sides }, rates), [pages, range, copies, mode, sides, cfg, paper]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = res && res.ok ? res : null;
  const deliveryFee = fulfilment === 'delivery' && cfg ? cfg.delivery.feePaise : 0;
  const total = ok ? ok.totalPaise + deliveryFee : 0;
  const selected = useMemo(() => {
    if (!pages) return new Set<number>();
    if (!range.trim()) return new Set(Array.from({ length: pages }, (_, i) => i + 1));
    const r = expandRange(range, pages); return new Set('pages' in r ? r.pages : []);
  }, [pages, range]);
  const reset = () => { key.current = null; };

  async function renderPreview(fl: File, id: number) {
    setPrev({ s: 'loading' }); setThumbs([]);
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await fl.arrayBuffer()), isEvalSupported: false }).promise;
      if (run.current !== id) return;
      setPrev({ s: 'ready', pages: doc.numPages });
      for (let i = 1; i <= Math.min(doc.numPages, MAX_THUMBS); i++) {
        if (run.current !== id) return;
        const page = await doc.getPage(i), vp = page.getViewport({ scale: 0.3 }), c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        const url = c.toDataURL('image/jpeg', 0.6); page.cleanup();
        setThumbs(t => { const n = [...t]; n[i - 1] = url; return n; });
      }
    } catch { if (run.current === id) setPrev({ s: 'error' }); }
  }

  async function upload(fl: File, id: number) {
    setUp({ s: 'uploading' });
    const fail = (msg: string) => { if (run.current === id) setUp({ s: 'error', msg }); };
    try {
      const i = await fetch('/api/upload/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fl.name, size: fl.size, type: fl.type }) });
      const ij = await i.json(); if (!ij.ok) return fail(ij.error);
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
      const { error } = await sb.storage.from('documents').uploadToSignedUrl(ij.path, ij.signedToken, fl, { contentType: 'application/pdf' });
      if (error) return fail('The upload did not finish. Check your connection and try again.');
      const c = await fetch('/api/upload/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: ij.uploadId, uploadToken: ij.uploadToken }) });
      const cj = await c.json(); if (!cj.ok) return fail(cj.error);
      if (run.current === id) setUp({ s: 'ready', id: ij.uploadId, token: ij.uploadToken, pages: cj.pages });
    } catch { fail('Could not reach the server. Check your connection and try again.'); }
  }

  function pick(fl: File | undefined) {
    if (!fl) return;
    const id = ++run.current; reset(); setDone(null); setFormErr(''); setFe({});
    const max = (cfg?.maxMb ?? 25) * 1048576;
    if (!/\.pdf$/i.test(fl.name) || (fl.type && fl.type !== 'application/pdf')) { setFile(null); setUp({ s: 'none' }); setPrev({ s: 'none' }); return setFileErr('Only PDF files are supported right now.'); }
    if (fl.size === 0) { setFile(null); return setFileErr('This file is empty.'); }
    if (fl.size > max) { setFile(null); return setFileErr(`This file is larger than ${cfg?.maxMb ?? 25} MB. Please send a smaller file.`); }
    setFileErr(''); setFile(fl); setRange(''); setPrev({ s: 'none' }); setUp({ s: 'none' });
    renderPreview(fl, id);
    if (cfg?.configured) upload(fl, id);
  }

  async function submit() {
    if (up.s !== 'ready' || !ok) return;
    setBusy(true); setFe({}); setFormErr('');
    if (!key.current) key.current = crypto.randomUUID();
    try {
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        uploadId: up.id, uploadToken: up.token, idempotencyKey: key.current, range, copies: Number(copies), mode, sides, fulfilment, paperSize: paper,
        paymentMethod: 'cash', ...f, expectedTotalPaise: total }) });
      const j = await r.json(); key.current = null; // a definite answer was received: next click is a new attempt
      if (j.ok) setDone(j.order); else { setFormErr(j.error ?? 'Could not place the order.'); if (j.field) setFe({ [j.field]: j.error }); }
    } catch { setFormErr('Could not reach the server. Your order may not have been placed. Press the button again; you will not be charged twice.'); }
    setBusy(false);
  }

  if (cfgErr) return <p className="err" role="alert">{cfgErr}</p>;
  if (!cfg) return <p><span className="spin" aria-hidden />Loading…</p>;
  if (done) return (
    <div className="panel" role="status"><span className="badge">Order received</span>
      <h2 style={{ margin: '12px 0 4px' }}>Order {done.orderNumber}</h2>
      <p>Total <b>{rupees(done.totalPaise)}</b> · {done.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · Payment: <b>cash pending</b>. Pay in cash when you {done.fulfilment === 'delivery' ? 'receive' : 'collect'} your prints. Nothing has been paid online.</p>
      <p>Save this order number. Online order tracking is not available yet, so message us on WhatsApp with it for updates. We will confirm your order; it is not final until we do.</p>
      <p><a className="btn green" href={`https://wa.me/916301834150?text=${encodeURIComponent('Hello, my order number is ' + done.orderNumber)}`}>WhatsApp about this order</a>{' '}
        <button className="btn ghost" style={{ color: 'var(--ink)', borderColor: 'var(--line)' }} onClick={() => { setDone(null); setFile(null); setUp({ s: 'none' }); setPrev({ s: 'none' }); setThumbs([]); }}>Place another order</button></p></div>);

  const bwP = size ? size.prices.bw : cfg.rates.bw_paise, cP = size ? size.prices.c : cfg.rates.colour_paise;
  const canSubmit = !!ok && up.s === 'ready' && consent && !busy && cfg.cashEnabled && (!size || size.available) && (fulfilment === 'pickup' ? cfg.pickupEnabled : cfg.delivery.enabled);
  const err = (k: string) => fe[k] ? <p className="fe" role="alert">{fe[k]}</p> : null;
  return (
    <div className="steps2">
      {!cfg.configured && <div className="banner" role="alert"><b>Ordering is not switched on yet.</b> You can preview your PDF and see the price, but uploading and placing an order need the business&apos;s database to be connected. Please order on WhatsApp for now.</div>}
      {cfg.configured && !cfg.cashEnabled && <div className="banner" role="alert">Cash orders are currently turned off. Please contact us on WhatsApp.</div>}

      <div className="panel"><h2 style={{ marginTop: 0 }}>1. Choose your PDF</h2>
        <label className={'drop' + (dragOver ? ' over' : '')} htmlFor="file" onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files[0]); }}>
          <b>Tap to choose a PDF</b> or drop it here<br /><span className="hint">PDF only, up to {cfg.maxMb} MB</span>
          <input id="file" type="file" accept="application/pdf,.pdf" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {fileErr && <p className="err" role="alert">{fileErr}</p>}
        {file && <p style={{ margin: '12px 0 0' }}><b>{file.name}</b> · {(file.size / 1048576).toFixed(2)} MB{pages ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''}</p>}
        {up.s === 'uploading' && <p role="status"><span className="spin" aria-hidden />Uploading and checking your file…</p>}
        {up.s === 'ready' && <p className="ok" role="status">File uploaded and checked on our server.</p>}
        {up.s === 'error' && <p className="err" role="alert">{up.msg}</p>}
        {prev.s === 'loading' && <p role="status"><span className="spin" aria-hidden />Preparing preview…</p>}
        {prev.s === 'error' && <p className="hint">Preview is not available for this file{up.s === 'ready' ? ', but it was uploaded fine and you can still order.' : '.'}</p>}
        {pages > 0 && thumbs.length > 0 && <>
          <div className="thumbs" aria-label="Page previews">{thumbs.map((t, i) => <div key={i} className={'thumb ' + (selected.has(i + 1) ? 'sel' : 'unsel')}>{t ? <img src={t} alt={`Page ${i + 1}`} /> : <div className="ph">…</div>}Page {i + 1}</div>)}</div>
          {pages > MAX_THUMBS && <p className="hint">Showing the first {MAX_THUMBS} of {pages} pages. Page selection still applies to all pages.</p>}</>}
      </div>

      {pages > 0 && <div className="est">
        <div className="panel"><h2 style={{ marginTop: 0 }}>2. Print options</h2>
          {cfg.catalogue && <><label htmlFor="paper">Paper size</label><select id="paper" value={paper} onChange={e => choosePaper(e.target.value)}>{cfg.catalogue.sizes.map(s => <option key={s.id} value={s.id} disabled={!s.available}>{s.name} ({s.widthMm} × {s.heightMm} mm){s.available ? '' : ' - currently unavailable'}</option>)}</select></>}
          <label htmlFor="range">Pages to print <span style={{ fontWeight: 400 }}>(blank = all {pages}; e.g. 1-3, 5, 8-10)</span></label>
          <input id="range" type="text" value={range} autoComplete="off" onChange={e => { setRange(e.target.value); reset(); }} />
          <p className="err" role="alert">{res && !res.ok ? res.error : ''}</p>
          <label htmlFor="copies">Copies</label>
          <input id="copies" type="number" min={1} max={500} value={copies} inputMode="numeric" onChange={e => { setCopies(e.target.value); reset(); }} />
          <label id="l-mode">Print type</label>
          <div className="seg" role="radiogroup" aria-labelledby="l-mode">
            <input type="radio" name="mode" id="m-bw" disabled={!(optOk('bw', 1) || optOk('bw', 2))} checked={mode === 'bw'} onChange={() => { setMode('bw'); if (!optOk('bw', sides)) setSides(1); reset(); }} /><label htmlFor="m-bw">Black &amp; white · {bwP && (optOk('bw', 1) || optOk('bw', 2)) ? rupees(bwP) : 'not available'}</label>
            <input type="radio" name="mode" id="m-c" disabled={!(optOk('c', 1) || optOk('c', 2))} checked={mode === 'c'} onChange={() => { setMode('c'); if (!optOk('c', sides)) setSides(1); reset(); }} /><label htmlFor="m-c">Colour · {cP && (optOk('c', 1) || optOk('c', 2)) ? rupees(cP) : 'not available'}</label></div>
          <label id="l-side">Sides</label>
          <div className="seg" role="radiogroup" aria-labelledby="l-side">
            <input type="radio" name="side" id="s1" disabled={!optOk(mode, 1)} checked={sides === 1} onChange={() => { setSides(1); reset(); }} /><label htmlFor="s1">Single-sided</label>
            <input type="radio" name="side" id="s2" disabled={!optOk(mode, 2)} checked={sides === 2} onChange={() => { setSides(2); reset(); }} /><label htmlFor="s2">Double-sided{optOk(mode, 2) ? '' : ' · not available'}</label></div>
          <p className="hint">Double-sided is a layout choice, not a discount. Black &amp; white prints colour pages in greyscale.</p>
        </div>
        <div className="panel" aria-live="polite"><h2 style={{ marginTop: 0 }}>Order summary</h2>
          <table className="bk"><tbody>
            <tr><td>Paper size</td><td>{size ? `${size.name} (${size.widthMm} × ${size.heightMm} mm)` : 'A4'}</td></tr>
            <tr><td>Pages selected</td><td>{range.trim() ? range : `All ${pages}`}</td></tr>
            <tr><td>Printed sides per copy</td><td>{ok ? ok.sidesPerCopy : '–'}</td></tr>
            <tr><td>Copies</td><td>{ok ? ok.copies : '–'}</td></tr>
            <tr><td>Print type</td><td>{mode === 'c' ? 'Colour' : 'Black & white'} · {sides === 2 ? 'double' : 'single'}-sided</td></tr>
            <tr><td>Total printed sides</td><td>{ok ? ok.totalSides : '–'}</td></tr>
            <tr><td>Physical sheets of paper</td><td>{ok ? ok.sheets : '–'}</td></tr>
            <tr><td>Printing</td><td>{ok ? rupees(ok.totalPaise) : '–'}</td></tr>
            {fulfilment === 'delivery' && <tr><td>Delivery fee</td><td>{rupees(deliveryFee)}</td></tr>}
            <tr className="total"><td>Total</td><td>{ok ? rupees(total) : '–'}</td></tr></tbody></table>
          <p className="hint">The final price is calculated again on our server when you place the order. If it differs, you will be asked to confirm.</p>
        </div></div>}

      {pages > 0 && <div className="panel"><h2 style={{ marginTop: 0 }}>3. Your details</h2>
        <label htmlFor="name">Name</label><input id="name" type="text" autoComplete="name" value={f.name} onChange={e => { setF({ ...f, name: e.target.value }); reset(); }} />{err('name')}
        <label htmlFor="phone">Mobile number</label><input id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="10-digit number" value={f.phone} onChange={e => { setF({ ...f, phone: e.target.value }); reset(); }} />{err('phone')}
        <label htmlFor="email">Email <span style={{ fontWeight: 400 }}>(optional)</span></label><input id="email" type="email" autoComplete="email" value={f.email} onChange={e => { setF({ ...f, email: e.target.value }); reset(); }} />{err('email')}
        <label id="l-ful">Pickup or delivery</label>
        <div className="seg" role="radiogroup" aria-labelledby="l-ful">
          <input type="radio" name="ful" id="f-p" disabled={!cfg.pickupEnabled} checked={fulfilment === 'pickup'} onChange={() => { setFulfilment('pickup'); reset(); }} /><label htmlFor="f-p">Pickup{cfg.pickupEnabled ? ' · free' : ' · unavailable'}</label>
          <input type="radio" name="ful" id="f-d" disabled={!cfg.delivery.enabled} checked={fulfilment === 'delivery'} onChange={() => { setFulfilment('delivery'); reset(); }} /><label htmlFor="f-d">{cfg.delivery.enabled ? `Delivery · ${rupees(cfg.delivery.feePaise)}` : 'Delivery · not available right now'}</label></div>
        {err('fulfilment')}
        {pickupNote(cfg)}
        {fulfilment === 'delivery' && cfg.delivery.enabled && <>
          <label htmlFor="address">Delivery address</label><textarea id="address" autoComplete="street-address" value={f.address} onChange={e => { setF({ ...f, address: e.target.value }); reset(); }} />{err('address')}
          {cfg.delivery.minOrderPaise > 0 && <p className="hint">Minimum printing amount for delivery: {rupees(cfg.delivery.minOrderPaise)}.</p>}
          {cfg.delivery.radiusKm && <p className="hint">We deliver within about {cfg.delivery.radiusKm} km. We will confirm your address when we call or message you.</p>}</>}
        <label htmlFor="ins">Instructions <span style={{ fontWeight: 400 }}>(optional)</span></label><textarea id="ins" maxLength={500} value={f.instructions} onChange={e => { setF({ ...f, instructions: e.target.value }); reset(); }} />
        <label id="l-pay">Payment</label>
        <div className="seg" role="radiogroup" aria-labelledby="l-pay">
          <input type="radio" name="pay" id="p-c" disabled={!cfg.cashEnabled} checked readOnly /><label htmlFor="p-c">Cash on {fulfilment === 'delivery' ? 'delivery' : 'pickup'}</label>
          <input type="radio" name="pay" id="p-o" disabled /><label htmlFor="p-o">Online · not available yet</label></div>
        <p className="hint">You pay in cash when you {fulfilment === 'delivery' ? 'receive' : 'collect'} your prints. Your order stays “cash pending” until we record the payment.</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 4 }} />
          <span>I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.</span></label>
        {formErr && <p className="err" role="alert">{formErr}</p>}
        <button className="btn pink" style={{ marginTop: 14 }} type="button" disabled={!canSubmit} onClick={submit}>{busy && <span className="spin" aria-hidden />}Place cash order{ok ? ` · ${rupees(total)}` : ''}</button>
        {up.s !== 'ready' && <p className="hint">{cfg.configured ? 'Wait for the upload to finish to place your order.' : 'Ordering is not switched on yet.'}</p>}
      </div>}
    </div>);
}
function pickupNote(cfg: Config) { return !cfg.pickupEnabled && !cfg.delivery.enabled ? <p className="err" role="alert">Neither pickup nor delivery is available right now. Please contact us on WhatsApp.</p> : null; }
