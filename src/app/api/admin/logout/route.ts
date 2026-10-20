import { clearCookies, json, sameOrigin } from '@/lib/admin-http';
import { secureCookies } from '@/lib/admin-server';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: 'Request blocked (cross-site).' }, 403);
  return json({ ok: true }, 200, clearCookies(secureCookies()));
}
