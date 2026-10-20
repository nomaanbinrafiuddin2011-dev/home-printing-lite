'use client';
import { useMemo, useState } from 'react';
import { calculatePrice, rupees, Mode, Sides } from '@/lib/pricing';

type Server = { state: 'idle' } | { state: 'loading' } | { state: 'error'; msg: string } | { state: 'ok'; total: number; source: string };

export default function Estimator() {
  const [pages, setPages] = useState('10'), [range, setRange] = useState(''), [copies, setCopies] = useState('1');
  const [mode, setMode] = useState<Mode>('bw'), [sides, setSides] = useState<Sides>(1);
  const [srv, setSrv] = useState<Server>({ state: 'idle' });
  const input = { totalPages: Number(pages), range, copies: Number(copies), mode, sides };
  const res = useMemo(() => calculatePrice(input), [pages, range, copies, mode, sides]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => setSrv({ state: 'idle' });

  async function verify() {
    setSrv({ state: 'loading' });
    try {
      const r = await fetch('/api/price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const j = await r.json();
      if (!j.ok) setSrv({ state: 'error', msg: j.error ?? 'The server could not calculate this price.' });
      else setSrv({ state: 'ok', total: j.totalPaise, source: j.rateSource });
    } catch { setSrv({ state: 'error', msg: 'Could not reach the server. Check your connection and try again.' }); }
  }
  const dash = '–', ok = res.ok ? res : null;
  return (
    <div className="est">
      <div className="panel">
        <label htmlFor="pages">Pages in your document</label>
        <input id="pages" type="number" min={1} max={2000} value={pages} inputMode="numeric" onChange={e => { setPages(e.target.value); reset(); }} />
        <label htmlFor="range">Pages to print <span style={{ fontWeight: 400 }}>(optional, e.g. 1-3, 5, 8-10)</span></label>
        <input id="range" type="text" value={range} placeholder="Leave empty for all pages" autoComplete="off" onChange={e => { setRange(e.target.value); reset(); }} />
        <p className="err" role="alert">{res.ok ? '' : res.error}</p>
        <label htmlFor="copies">Copies</label>
        <input id="copies" type="number" min={1} max={500} value={copies} inputMode="numeric" onChange={e => { setCopies(e.target.value); reset(); }} />
        <label id="l-mode">Colour mode</label>
        <div className="seg" role="radiogroup" aria-labelledby="l-mode">
          <input type="radio" name="mode" id="m-bw" checked={mode === 'bw'} onChange={() => { setMode('bw'); reset(); }} /><label htmlFor="m-bw">Black &amp; white · ₹2</label>
          <input type="radio" name="mode" id="m-c" checked={mode === 'c'} onChange={() => { setMode('c'); reset(); }} /><label htmlFor="m-c">Colour · ₹9</label>
        </div>
        <label id="l-side">Sides</label>
        <div className="seg" role="radiogroup" aria-labelledby="l-side">
          <input type="radio" name="side" id="s1" checked={sides === 1} onChange={() => { setSides(1); reset(); }} /><label htmlFor="s1">Single-sided</label>
          <input type="radio" name="side" id="s2" checked={sides === 2} onChange={() => { setSides(2); reset(); }} /><label htmlFor="s2">Double-sided</label>
        </div>
      </div>
      <div className="panel" aria-live="polite">
        <h3 style={{ marginTop: 0 }}>Your estimate</h3>
        <table className="bk"><tbody>
          <tr><td>Printed page sides per copy</td><td>{ok ? ok.sidesPerCopy : dash}</td></tr>
          <tr><td>Copies</td><td>{ok ? ok.copies : dash}</td></tr>
          <tr><td>Total printed sides</td><td>{ok ? ok.totalSides : dash}</td></tr>
          <tr><td>Physical sheets of paper</td><td>{ok ? ok.sheets : dash}</td></tr>
          <tr><td>Rate</td><td>{ok ? rupees(ok.ratePaise) + ' per side' : dash}</td></tr>
          <tr className="total"><td>Estimated total</td><td>{ok ? rupees(ok.totalPaise) : dash}</td></tr>
        </tbody></table>
        <div className="note">Double-sided is a layout choice, not a discount: you pay per printed side. If you choose B&amp;W, any colour in your file prints in greyscale.</div>
        <button className="btn pink" style={{ marginTop: 14 }} type="button" disabled={!ok || srv.state === 'loading'} onClick={verify}>
          {srv.state === 'loading' && <span className="spin" aria-hidden />}Confirm price with server
        </button>
        {srv.state === 'ok' && <p className="ok" role="status">Server-confirmed total: {rupees(srv.total)} <span className="hint">(rates from {srv.source === 'database' ? 'business settings' : 'built-in defaults; database not connected'})</span></p>}
        {srv.state === 'error' && <p className="err" role="alert">{srv.msg}</p>}
        <p className="hint">Online ordering is <b>not available yet</b>. To order now, send your file on WhatsApp and we&apos;ll confirm.</p>
        <a className="btn green" style={{ marginTop: 8 }} href="https://wa.me/916301834150">Order on WhatsApp</a>
      </div>
    </div>
  );
}
