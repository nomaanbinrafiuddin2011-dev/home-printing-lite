import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase';
import { loadSettings } from '@/lib/store-supabase';
import { parseSettings } from '@/lib/settings';
import { publicCatalogue } from '@/lib/catalogue';
export const dynamic = 'force-dynamic';
/** Public, non-secret ordering settings. `configured:false` means the server has no Supabase credentials. Disabled paper sizes are not listed. */
export async function GET() {
  const db = serviceClient();
  let s;
  try { s = db ? await loadSettings(db) : parseSettings({}); } catch { return NextResponse.json({ configured: true, error: 'Ordering is temporarily unavailable. Please try again in a moment.' }, { status: 503 }); }
  return NextResponse.json({ configured: !!db, rates: s.rates, catalogue: { sizes: publicCatalogue(s.catalogue) }, delivery: s.delivery, pickupEnabled: s.pickupEnabled, cashEnabled: s.cashEnabled, maxMb: s.maxMb });
}
