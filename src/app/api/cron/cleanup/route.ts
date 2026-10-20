import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase';
import { hashToken, safeEqualHex } from '@/lib/security';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily cleanup (see vercel.json). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured.' }, { status: 503 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!safeEqualHex(hashToken(given), hashToken(secret))) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const db = serviceClient();
  if (!db) return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });

  let abandoned = 0, retained = 0;
  // 1) Uploads never attached to an order and past their 24h expiry.
  const { data: stale } = await db.from('uploads').select('id,storage_path').is('claimed_order_id', null).lt('expires_at', new Date().toISOString()).limit(200);
  if (stale?.length) {
    await db.storage.from('documents').remove(stale.map(u => u.storage_path));
    await db.from('uploads').delete().in('id', stale.map(u => u.id));
    abandoned = stale.length;
  }
  // 2) Files of finished (completed/cancelled) orders older than the retention period.
  const { data: ret } = await db.from('settings').select('value').eq('key', 'retention').maybeSingle();
  const days = Number.isInteger(ret?.value?.delete_files_after_days) && ret!.value.delete_files_after_days > 0 ? ret!.value.delete_files_after_days : 7;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const { data: done } = await db.from('orders').select('id').in('status', ['completed', 'cancelled']).lt('updated_at', cutoff).limit(200);
  if (done?.length) {
    const ids = done.map(o => o.id);
    const { data: items } = await db.from('order_items').select('id,storage_path').in('order_id', ids).not('storage_path', 'is', null);
    if (items?.length) {
      await db.storage.from('documents').remove(items.map(i => i.storage_path as string));
      await db.from('order_items').update({ storage_path: null }).in('id', items.map(i => i.id));
      retained = items.length;
    }
    await db.from('uploads').delete().in('claimed_order_id', ids);
  }
  return NextResponse.json({ ok: true, abandonedUploadsDeleted: abandoned, orderFilesDeleted: retained, retentionDays: days });
}
