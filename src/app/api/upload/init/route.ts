import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { serviceClient } from '@/lib/supabase';
import { loadSettings } from '@/lib/store-supabase';
import { checkUploadMeta } from '@/lib/validation';
import { hashToken, newToken } from '@/lib/security';
import { clientIp, rateLimited } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';
const err = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/** Step 1: validate declared metadata, reserve a private path, return a one-time signed upload URL token. */
export async function POST(req: Request) {
  if (rateLimited('up:' + clientIp(req), 10)) return err(429, 'Too many uploads. Please wait a minute and try again.');
  const db = serviceClient();
  if (!db) return err(503, 'Online ordering is not set up yet. Please order on WhatsApp.');
  let b: any; try { b = await req.json(); } catch { return err(400, 'Invalid request.'); }
  const settings = await loadSettings(db);
  const meta = checkUploadMeta(b?.name, b?.size, b?.type, settings.maxMb * 1048576);
  if (!meta.ok) return err(422, meta.error);
  const id = randomUUID(), path = `uploads/${id}.pdf`, token = newToken();
  const { error: e1 } = await db.from('uploads').insert({ id, storage_path: path, original_name: meta.safeName, size_bytes: b.size, token_hash: hashToken(token) });
  if (e1) return err(500, 'Could not start the upload. Please try again.');
  const { data, error: e2 } = await db.storage.from('documents').createSignedUploadUrl(path);
  if (e2 || !data) { await db.from('uploads').delete().eq('id', id); return err(500, 'Could not start the upload. Please try again.'); }
  return NextResponse.json({ ok: true, uploadId: id, uploadToken: token, path, signedToken: data.token });
}
