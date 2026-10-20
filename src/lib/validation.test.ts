import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { checkUploadMeta, inspectPdf, sanitizeFilename } from './validation.ts';
import { hashToken, safeEqualHex, newToken } from './security.ts';
const MB = 1048576;
async function pdf(n: number) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return new Uint8Array(await d.save()); }

test('valid PDF: page count read on the server side', async () => { assert.deepEqual(await inspectPdf(await pdf(3), 25 * MB), { ok: true, pages: 3 }); });
// Known pdf-lib behaviour: a pageless PDF is loaded as one blank page, so it is billed as 1 page (never 0).
test('pageless PDF is counted as one blank page, never zero', async () => { assert.deepEqual(await inspectPdf(await pdf(0), 25 * MB), { ok: true, pages: 1 }); });
test('non-PDF bytes renamed .pdf rejected (PNG magic)', async () => {
  const r = await inspectPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), 25 * MB);
  assert.ok(!r.ok && /not a valid PDF/.test(r.error));
});
test('PDF header but corrupt body rejected', async () => {
  const r = await inspectPdf(new TextEncoder().encode('%PDF-1.7\n garbage garbage'), 25 * MB);
  assert.equal(r.ok, false);
});
test('oversize bytes rejected; empty rejected', async () => {
  assert.equal((await inspectPdf(await pdf(1), 100)).ok, false);
  assert.equal((await inspectPdf(new Uint8Array(0), 25 * MB)).ok, false);
});
test('metadata checks: type, extension, size', () => {
  assert.equal(checkUploadMeta('a.pdf', 1000, 'application/pdf', 25 * MB).ok, true);
  assert.equal(checkUploadMeta('a.exe', 1000, 'application/pdf', 25 * MB).ok, false);
  assert.equal(checkUploadMeta('a.pdf', 1000, 'image/png', 25 * MB).ok, false);
  assert.equal(checkUploadMeta('a.pdf', 0, 'application/pdf', 25 * MB).ok, false);
  assert.equal(checkUploadMeta('a.pdf', 26 * MB, 'application/pdf', 25 * MB).ok, false);
  assert.equal(checkUploadMeta('a.pdf', 'big', 'application/pdf', 25 * MB).ok, false);
});
test('filenames cannot traverse paths', () => {
  assert.ok(!/[\\/]/.test(sanitizeFilename('../../etc/passwd.pdf')));
  assert.ok(!/[\\/]/.test(sanitizeFilename('..\\..\\win.pdf')));
  assert.equal(sanitizeFilename('..'), '.');
});
test('tokens: hash compare is exact', () => {
  const t = newToken(); assert.ok(safeEqualHex(hashToken(t), hashToken(t)));
  assert.equal(safeEqualHex(hashToken(t), hashToken(t + 'x')), false);
  assert.equal(safeEqualHex('abc', 'abcd'), false);
});
