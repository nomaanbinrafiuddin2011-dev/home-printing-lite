import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase';
import { loadSettings, supabaseStore } from '@/lib/store-supabase';
import { createOrder } from '@/lib/orders';
import { clientIp, rateLimited } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (rateLimited('ord:' + clientIp(req), 10)) return NextResponse.json({ ok: false, error: 'Too many attempts. Please wait a minute.' }, { status: 429 });
  const db = serviceClient();
  if (!db) return NextResponse.json({ ok: false, error: 'Online ordering is not set up yet. Please order on WhatsApp.' }, { status: 503 });
  let body: unknown; try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 }); }
  try {
    const r = await createOrder(supabaseStore(db), await loadSettings(db), body);
    // Response carries only the customer-safe summary: no internal ids, no storage paths.
    return NextResponse.json(r, { status: r.ok ? (r.replay ? 200 : 201) : r.status });
  } catch {
    return NextResponse.json({ ok: false, error: 'Something went wrong. Nothing was charged. Please try again.' }, { status: 500 });
  }
}
