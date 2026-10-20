import { NextResponse } from 'next/server';
import { calculatePrice } from '@/lib/pricing';
import { checkOrderable } from '@/lib/catalogue';
import { parseSettings } from '@/lib/settings';
import { serviceClient } from '@/lib/supabase';
import { loadSettings } from '@/lib/store-supabase';
import { clientIp, rateLimited } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (rateLimited('price:' + clientIp(req), 30)) return NextResponse.json({ ok: false, error: 'Too many requests. Please wait a minute.' }, { status: 429 });
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 }); }
  const db = serviceClient(), source = db ? 'database' : 'defaults';
  let settings; try { settings = db ? await loadSettings(db) : parseSettings({}); } catch { return NextResponse.json({ ok: false, error: 'Pricing is temporarily unavailable. Please try again.' }, { status: 503 }); }
  const paper = typeof b?.paperSize === 'string' && b.paperSize ? b.paperSize.toLowerCase().slice(0, 40) : 'a4';
  const mode = b?.mode, sides = Number(b?.sides) as 1 | 2;
  const ord = checkOrderable(settings.catalogue, paper, mode, sides);
  if (!ord.ok) return NextResponse.json({ ok: false, error: ord.error, rateSource: source }, { status: 422 });
  const pr = settings.catalogue.prices[ord.size.id] ?? {};
  const result = calculatePrice({ totalPages: Number(b?.totalPages), range: typeof b?.range === 'string' ? b.range.slice(0, 200) : '', copies: Number(b?.copies), mode, sides }, { bw_paise: pr.bw ?? 0, colour_paise: pr.c ?? 0 });
  return NextResponse.json({ ...result, paperSize: ord.size.name, rateSource: source }, { status: result.ok ? 200 : 422 });
}
