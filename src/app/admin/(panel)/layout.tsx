import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authorize } from '@/lib/admin-auth';
import { authBackend } from '@/lib/admin-server';
import { SignOut } from '@/components/admin/ui';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };

/** Server-side gate. This is a convenience (nice redirect); every admin API re-verifies the session itself. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const backend = authBackend();
  if (!backend) return <div className="wrap page"><span className="badge">Not configured</span><h1>Admin area</h1><p>Supabase is not configured on this server, so nobody can sign in. See the README (&ldquo;Admin setup&rdquo;).</p></div>;
  const jar = Object.fromEntries(cookies().getAll().map(c => [c.name, c.value]));
  const r = await authorize(backend, jar, false);
  if (!r.ok) {
    if (r.reason === 'expired') redirect('/api/admin/session/refresh?next=/admin');
    if (r.reason === 'unavailable') return <div className="wrap page"><h1>Admin area</h1><p className="err" role="alert">Could not verify your session right now. Refresh in a moment.</p></div>;
    redirect('/admin/login');
  }
  return (
    <div className="wrap page" style={{ paddingTop: 24 }}>
      <nav className="adm-nav" aria-label="Admin"><Link href="/admin">Dashboard</Link><Link href="/admin/queue">Print queue</Link><Link href="/admin/orders">Orders</Link><Link href="/admin/catalogue">Paper &amp; printers</Link><Link href="/admin/settings">Settings</Link><span style={{ flex: 1 }} /><span className="hint">{r.admin.email}</span><SignOut /></nav>
      {children}
    </div>);
}
