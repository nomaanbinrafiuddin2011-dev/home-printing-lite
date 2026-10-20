import { PDFDocument } from 'pdf-lib';
import { LIMITS } from './pricing.ts';

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\.{2,}/g, '.').trim().slice(0, 120);
  return clean || 'document.pdf';
}

export type Check = { ok: true; safeName: string } | { ok: false; error: string };
/** Cheap pre-checks on declared metadata. The real check is inspectPdf on the stored bytes. */
export function checkUploadMeta(name: unknown, size: unknown, type: unknown, maxBytes: number): Check {
  if (typeof name !== 'string' || !name) return { ok: false, error: 'Choose a file to upload.' };
  const safeName = sanitizeFilename(name);
  if (!/\.pdf$/i.test(safeName)) return { ok: false, error: 'Only PDF files are supported right now.' };
  if (type !== 'application/pdf') return { ok: false, error: 'Only PDF files are supported right now.' };
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return { ok: false, error: 'This file is empty.' };
  if (size > maxBytes) return { ok: false, error: `This file is larger than ${Math.floor(maxBytes / 1048576)} MB. Please send a smaller file.` };
  return { ok: true, safeName };
}

export type PdfInfo = { ok: true; pages: number } | { ok: false; error: string };
/** Validates real bytes: size, %PDF header, parseable, not encrypted, sane page count. Not a malware scan. */
export async function inspectPdf(bytes: Uint8Array, maxBytes: number): Promise<PdfInfo> {
  if (bytes.length === 0) return { ok: false, error: 'This file is empty.' };
  if (bytes.length > maxBytes) return { ok: false, error: `This file is larger than ${Math.floor(maxBytes / 1048576)} MB.` };
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) return { ok: false, error: 'This file is not a valid PDF.' };
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const pages = doc.getPageCount();
    if (pages < 1) return { ok: false, error: 'This PDF has no pages.' };
    if (pages > LIMITS.maxPages) return { ok: false, error: `This PDF has more than ${LIMITS.maxPages} pages. Please split it.` };
    return { ok: true, pages };
  } catch (e) {
    const enc = e instanceof Error && /encrypt/i.test(e.name + e.message);
    return { ok: false, error: enc ? 'This PDF is password-protected. Please remove the password and upload again.' : 'This PDF looks damaged or unreadable. Please re-save it and try again.' };
  }
}
