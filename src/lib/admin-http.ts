import { authorize, AT, RT } from './admin-auth.ts';
import type { Admin, AuthBackend, Tokens } from './admin-auth.ts';

export function parseCookies(h: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } } }
  return out;
}
/** CSRF defence for state-changing requests: Origin must be present and match the host being called. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin'); if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host'); if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}
const cookie = (n: string, v: string, maxAge: number, secure: boolean) => `${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
export const sessionCookies = (t: Tokens, secure: boolean) => [cookie(AT, t.accessToken, Math.max(60, t.expiresIn), secure), cookie(RT, t.refreshToken, 60 * 60 * 24 * 7, secure)];
export const clearCookies = (secure: boolean) => [cookie(AT, '', 0, secure), cookie(RT, '', 0, secure)];

export function json(data: unknown, status = 200, setCookies: string[] = []): Response {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of setCookies) h.append('Set-Cookie', c);
  return new Response(JSON.stringify(data), { status, headers: h });
}
export type Guard = { ok: true; admin: Admin; setCookies: string[] } | { ok: false; response: Response };

/** Every admin API starts here. `backend === null` means Supabase is not configured. */
export async function guardWith(backend: AuthBackend | null, req: Request, write: boolean, secure = true): Promise<Guard> {
  if (write && !sameOrigin(req)) return { ok: false, response: json({ ok: false, error: 'Request blocked (cross-site).' }, 403) };
  if (!backend) return { ok: false, response: json({ ok: false, error: 'The admin area is not set up yet.' }, 503) };
  const r = await authorize(backend, parseCookies(req.headers.get('cookie')), true);
  if (r.ok) return { ok: true, admin: r.admin, setCookies: r.newTokens ? sessionCookies(r.newTokens, secure) : [] };
  if (r.reason === 'forbidden') return { ok: false, response: json({ ok: false, error: 'This account is not authorised for the admin area.' }, 403) };
  if (r.reason === 'unavailable') return { ok: false, response: json({ ok: false, error: 'Could not verify your session. Try again.' }, 503) };
  return { ok: false, response: json({ ok: false, error: 'Please sign in.' }, 401, clearCookies(secure)) };
}
