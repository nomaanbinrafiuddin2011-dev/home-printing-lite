import { authBackend, secureCookies } from '@/lib/admin-server';
import { authorize } from '@/lib/admin-auth';
import { clearCookies, parseCookies, sessionCookies } from '@/lib/admin-http';
export const dynamic = 'force-dynamic';
/** Used by the admin layout when the access token has expired: refresh, then bounce back to the page. */
export async function GET(req: Request) {
  const url = new URL(req.url), next = url.searchParams.get('next') ?? '/admin';
  const safeNext = /^\/admin(\/[A-Za-z0-9\-_/]*)?$/.test(next) ? next : '/admin';
  const backend = authBackend(), h = new Headers();
  let loc = '/admin/login';
  if (backend) {
    const r = await authorize(backend, parseCookies(req.headers.get('cookie')), true);
    if (r.ok) { loc = safeNext; for (const c of r.newTokens ? sessionCookies(r.newTokens, secureCookies()) : []) h.append('Set-Cookie', c); }
    else for (const c of clearCookies(secureCookies())) h.append('Set-Cookie', c);
  }
  h.set('Location', loc); h.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers: h });
}
