'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminFetch } from '@/components/admin/ui';
import { rupees } from '@/lib/pricing';

interface Stats { total: number; pending: number; processing: number; completed: number; cancelled: number; cashAwaiting: { count: number; totalPaise: number } }
export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null), [err, setErr] = useState('');
  const load = () => { setErr(''); adminFetch('/api/admin/stats').then(r => r.ok ? setS(r.stats) : setErr(r.error ?? 'Could not load.')); };
  useEffect(load, []);
  if (err) return <div><p className="err" role="alert">{err}</p><button className="btn sm pink" onClick={load}>Try again</button></div>;
  if (!s) return <p><span className="spin" aria-hidden />Loading…</p>;
  const cards: [string, string | number, string, string?][] = [
    ['Print queue', 'Open', '/admin/queue'], ['Total orders', s.total, '/admin/orders'], ['Pending confirmation', s.pending, '/admin/orders?status=pending_confirmation', s.pending ? 'hot' : ''],
    ['In progress', s.processing, '/admin/orders'], ['Completed', s.completed, '/admin/orders?status=completed'], ['Cancelled', s.cancelled, '/admin/orders?status=cancelled'],
    ['Cash awaiting collection', `${s.cashAwaiting.count} · ${rupees(s.cashAwaiting.totalPaise)}`, '/admin/orders?payment=cash_pending', s.cashAwaiting.count ? 'hot' : ''] ];
  return <><h1 style={{ marginTop: 0 }}>Dashboard</h1>
    <div className="kpis">{cards.map(([l, v, h, c]) => <Link key={l} href={h} className={'kpi ' + (c ?? '')}><span className="hint">{l}</span><b>{v}</b></Link>)}</div>
    <p className="hint">“In progress” = confirmed, preparing, printing, ready for pickup or out for delivery. Cash awaiting excludes cancelled orders.</p></>;
}
