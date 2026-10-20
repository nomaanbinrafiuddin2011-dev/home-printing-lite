'use client';
import { useEffect, useState } from 'react';
import { adminFetch, ConfirmDialog } from '@/components/admin/ui';
import type { SettingsForm } from '@/lib/admin-validation';

type Draft = { [K in keyof SettingsForm]: string | boolean };
const toDraft = (s: SettingsForm): Draft => ({ ...s, bwRupees: String(s.bwRupees), colourRupees: String(s.colourRupees), deliveryFeeRupees: String(s.deliveryFeeRupees), minOrderRupees: String(s.minOrderRupees), radiusKm: s.radiusKm === null ? '' : String(s.radiusKm), maxMb: String(s.maxMb), retentionDays: String(s.retentionDays) });
const num = (v: string | boolean) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

export default function SettingsPage() {
  const [d, setD] = useState<Draft | null>(null), [loadErr, setLoadErr] = useState(''), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [field, setField] = useState(''), [ok, setOk] = useState('');
  const load = () => adminFetch('/api/admin/settings').then(r => r.ok ? setD(toDraft(r.settings)) : setLoadErr(r.error ?? 'Could not load settings.'));
  useEffect(() => { load(); }, []);
  if (loadErr) return <p className="err" role="alert">{loadErr}</p>;
  if (!d) return <p><span className="spin" aria-hidden />Loading…</p>;
  const set = (k: keyof Draft, v: string | boolean) => { setD({ ...d, [k]: v }); setOk(''); setField(''); };
  async function save() {
    if (!d) return; setBusy(true); setErr('');
    const body = { bwRupees: num(d.bwRupees), colourRupees: num(d.colourRupees), deliveryEnabled: d.deliveryEnabled, deliveryFeeRupees: num(d.deliveryFeeRupees), minOrderRupees: num(d.minOrderRupees), radiusKm: d.radiusKm === '' ? null : num(d.radiusKm), pickupEnabled: d.pickupEnabled, cashEnabled: d.cashEnabled, maxMb: num(d.maxMb), retentionDays: num(d.retentionDays) };
    const r = await adminFetch('/api/admin/settings', { method: 'PUT', json: body }); setBusy(false);
    if (r.ok) { setConfirm(false); setOk(r.changed?.length ? `Saved: ${r.changed.join(', ')}.` : 'No changes to save.'); load(); } else { setErr(r.error ?? 'Could not save.'); setField(r.code ?? ''); }
  }
  const E = ({ k }: { k: string }) => field === k && err ? <p className="fe" role="alert">{err}</p> : null;
  const Num = (k: keyof Draft, label: string, hint?: string) => <><label htmlFor={k}>{label}</label><input id={k} type="number" step="any" value={d[k] as string} onChange={e => set(k, e.target.value)} />{hint && <p className="hint">{hint}</p>}<E k={k} /></>;
  const Tog = (k: keyof Draft, label: string) => <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600 }}><input type="checkbox" checked={d[k] as boolean} onChange={e => set(k, e.target.checked)} />{label}</label>;
  return <>
    <h1 style={{ marginTop: 0 }}>Settings</h1>
    <p className="hint">Changes apply to new orders straight away and are recorded in the audit log. Prices are re-checked on the server for every order.</p>
    <div className="est">
      <div className="panel"><h2 style={{ marginTop: 0 }}>A4 prices (per printed side)</h2><p className="hint">Other paper sizes are priced under Paper &amp; printers.</p>
        {Num('bwRupees', 'Black & white (₹)')}{Num('colourRupees', 'Colour (₹)')}
        <h2>Files</h2>{Num('maxMb', 'Maximum PDF size (MB, up to 25)')}{Num('retentionDays', 'Delete files of finished orders after (days)')}</div>
      <div className="panel"><h2 style={{ marginTop: 0 }}>Fulfilment &amp; payment</h2>
        {Tog('pickupEnabled', 'Pickup available')}<E k="pickupEnabled" />
        {Tog('deliveryEnabled', 'Delivery available')}
        {Num('deliveryFeeRupees', 'Delivery fee (₹)', 'Added to delivery orders only. Use 0 for free delivery.')}
        {Num('minOrderRupees', 'Minimum printing amount for delivery (₹)')}
        {Num('radiusKm', 'Delivery radius (km, optional)', 'Shown to customers only. Distance is NOT checked automatically yet.')}
        <div style={{ marginTop: 14 }}>{Tog('cashEnabled', 'Cash on pickup / delivery')}<E k="cashEnabled" /></div>
        <p className="hint">Online payment is not available and cannot be switched on here yet.</p></div>
    </div>
    {err && !field && <p className="err" role="alert">{err}</p>}{ok && <p className="ok" role="status">{ok}</p>}
    <button className="btn pink" style={{ marginTop: 16 }} onClick={() => { setErr(''); setConfirm(true); }}>Save changes</button>
    <ConfirmDialog open={confirm} busy={busy} error={err} title="Save these settings?" confirmLabel="Save" onCancel={() => setConfirm(false)} onConfirm={save}>
      <p>New orders will use these prices and rules immediately.</p></ConfirmDialog>
  </>;
}
