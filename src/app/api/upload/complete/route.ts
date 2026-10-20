import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase';
import { loadSettings } from '@/lib/store-supabase';
import { inspectPdf } from '@/lib/validation';
import { hashToken, safeEqualHex, sha256Hex } from '@/lib/security';
import { clientIp, rateLimited } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const err = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/** Step 2: the server downloads the stored object and validates the REAL bytes. Bad files are deleted. */
export async function POST(req: Request) {
  if (rateLimited('upc:' + clientIp(req), 20)) return err(429, 'Too many requests. Please wait a minute.');
  const db = serviceClient();
  if (!db) return err(503, 'Online ordering is not set up yet.');
  let b: any; try { b = await req.json(); } catch { return err(400, 'Invalid request.'); }
  if (typeof b?.uploadId !== 'string' || typeof b?.uploadToken !== 'string') return err(400, 'Invalid request.');
  const { data: up } = await db.from('uploads').select('*').eq('id', b.uploadId).maybeSingle();
  if (!up || !safeEqualHex(up.token_hash, hashToken(b.uploadToken))) return err(404, 'Upload not found. Please upload your file again.');
  if (up.status === 'ready') return NextResponse.json({ ok: true, pages: up.pages, name: up.original_name, sizeBytes: Number(up.size_bytes) });
  const settings = await loadSettings(db);
  const { data: blob, error } = await db.storage.from('documents').download(up.storage_path);
  if (error || !blob) return err(422, 'We did not receive your file. Please try uploading again.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const info = await inspectPdf(bytes, settings.maxMb * 1048576);
  if (!info.ok) {
    await db.storage.from('documents').remove([up.storage_path]);
    await db.from('uploads').delete().eq('id', up.id);
    return err(422, info.error);
  }
  const { error: ue } = await db.from('uploads').update({ status: 'ready', pages: info.pages, size_bytes: bytes.length, sha256: sha256Hex(bytes) }).eq('id', up.id);
  if (ue) return err(500, 'Could not finish the upload. Please try again.');
  return NextResponse.json({ ok: true, pages: info.pages, name: up.original_name, sizeBytes: bytes.length });
}
