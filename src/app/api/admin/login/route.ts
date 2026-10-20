import { authBackend, anonClient, secureCookies } from '@/lib/admin-server';
import { json, sameOrigin, sessionCookies } from '@/lib/admin-http';
import { clientIp, rateLimited } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';
const GENERIC = 'Incorrect email or password, or this account is not an admin.';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: 'Request blocked (cross-site).' }, 403);
  if (rateLimited('login:' + clientIp(req), 8, 5 * 60_000)) return json({ ok: false, error: 'Too many sign-in attempts. Wait a few minutes.' }, 429);
  const backend = authBackend(), anon = anonClient();
  if (!backend || !anon) return json({ ok: false, error: 'The admin area is not set up yet.' }, 503);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  if (typeof b?.email !== 'string' || typeof b?.password !== 'string' || b.email.length > 200 || b.password.length > 200) return json({ ok: false, error: GENERIC }, 401);
  if (rateLimited('loginmail:' + b.email.toLowerCase(), 8, 5 * 60_000)) return json({ ok: false, error: 'Too many sign-in attempts. Wait a few minutes.' }, 429);
  try {
    const { data, error } = await anon.auth.signInWithPassword({ email: b.email.trim(), password: b.password });
    if (error || !data.session) return json({ ok: false, error: GENERIC }, 401);
    if (!(await backend.isAdmin(data.user.id))) return json({ ok: false, error: GENERIC }, 401); // valid Supabase user but not on the allow-list: no session issued
    const s = data.session;
    return json({ ok: true }, 200, sessionCookies({ accessToken: s.access_token, refreshToken: s.refresh_token, expiresIn: s.expires_in }, secureCookies()));
  } catch { return json({ ok: false, error: 'Could not sign in right now. Try again.' }, 503); }
}
