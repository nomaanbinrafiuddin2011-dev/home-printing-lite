import { rupees } from './pricing.ts';
import { HANDOVER, canTransition, isStatus, STATUS_LABEL } from './order-status.ts';
import type { Status } from './order-status.ts';
import { buildSettingRows, validateSettings } from './admin-validation.ts';
import type { Admin } from './admin-auth.ts';
import type { AdminStore } from './admin-store.ts';
import { buildQueue } from './queue.ts';
import { catalogueWarnings } from './catalogue.ts';
import type { Catalogue } from './catalogue.ts';
import { validateAddSize, validateSavePrinter, validateSetSize } from './catalogue-validation.ts';
import type { QueueData, QueueQuery } from './queue.ts';

export type Act<T = undefined> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): Act<never> => ({ ok: false, status, error, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function changeStatus(store: AdminStore, admin: Admin, orderId: string, body: any): Promise<Act> {
  if (!UUID.test(orderId)) return fail(400, 'Invalid order.');
  if (!isStatus(body?.to) || !isStatus(body?.expectedStatus)) return fail(400, 'Invalid status.');
  const to: Status = body.to, reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const o = await store.getOrder(orderId); if (!o) return fail(404, 'Order not found.');
  if (o.status !== body.expectedStatus) return fail(409, `This order is now "${STATUS_LABEL[o.status as Status] ?? o.status}". Refresh and try again.`, 'STALE');
  if (!canTransition(o.status as Status, to, o.fulfilment)) return fail(422, `An order that is "${STATUS_LABEL[o.status as Status]}" cannot move to "${STATUS_LABEL[to]}".`);
  if (to === 'cancelled') {
    if (reason.length < 3 || reason.length > 300) return fail(422, 'Give a reason for cancelling (3–300 characters).');
    if (o.paymentStatus === 'paid' || o.collection) return fail(422, 'This order has been paid. Refunds are not supported yet, so it cannot be cancelled here.');
  }
  if (to === 'completed' && o.paymentStatus !== 'paid') return fail(422, 'Record the cash collection before completing this order.');
  const r = await store.setStatus(o.id, o.status, to, admin, to === 'cancelled' ? reason : null);
  if (r === 'conflict') return fail(409, 'Someone else just changed this order. Refresh and try again.', 'STALE');
  if (r === 'not_found') return fail(404, 'Order not found.');
  return { ok: true, data: undefined };
}

export async function collectCash(store: AdminStore, admin: Admin, orderId: string, body: any): Promise<Act> {
  if (!UUID.test(orderId)) return fail(400, 'Invalid order.');
  if (!Number.isInteger(body?.amountPaise)) return fail(400, 'Enter the amount collected.');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  const o = await store.getOrder(orderId); if (!o) return fail(404, 'Order not found.');
  if (o.paymentMethod !== 'cash') return fail(422, 'This is not a cash order.');
  if (o.paymentStatus === 'paid' || o.collection) return fail(409, 'Cash for this order has already been recorded.', 'DUPLICATE');
  if (o.status === 'cancelled') return fail(422, 'This order is cancelled.');
  if (!HANDOVER.includes(o.status as Status)) return fail(422, 'Cash can be recorded once the order is ready for pickup or out for delivery.');
  if (body.amountPaise !== o.totalPaise) return fail(422, `The amount must equal the order total, ${rupees(o.totalPaise)}.`);
  const r = await store.collectCash(o.id, admin, body.amountPaise, note || null);
  if (r === 'duplicate') return fail(409, 'Cash for this order has already been recorded.', 'DUPLICATE');
  if (r === 'not_found') return fail(404, 'Order not found.');
  if (r === 'invalid') return fail(422, 'This order cannot accept a cash record right now.');
  return { ok: true, data: undefined };
}

export async function fileLink(store: AdminStore, admin: Admin, itemId: string, mode: string | null): Promise<Act<{ url: string; expiresInSeconds: number }>> {
  if (!UUID.test(itemId)) return fail(400, 'Invalid file.');
  const f = await store.getItemFile(itemId); if (!f) return fail(404, 'File not found.');
  if (!f.storagePath) return fail(410, 'This file was deleted under the retention policy.');
  const download = mode === 'download';
  const url = await store.signedUrl(f.storagePath, 60, download ? f.name : undefined);
  if (!url) return fail(500, 'Could not open the file. Try again.');
  await store.logEvent(admin, download ? 'file.downloaded' : 'file.viewed', 'order', f.orderId, { item: itemId });
  return { ok: true, data: { url, expiresInSeconds: 60 } };
}

export async function saveSettings(store: AdminStore, admin: Admin, body: any): Promise<Act<{ changed: string[] }>> {
  const v = validateSettings(body); if (!v.ok) return fail(422, v.error, v.field);
  const cur = await store.getSettings(), next = buildSettingRows(cur, v.value), changed: string[] = [];
  for (const key of Object.keys(next)) {
    if (JSON.stringify(cur[key]) === JSON.stringify(next[key])) continue;
    if (!(await store.setSetting(key, next[key], admin))) return fail(500, `Saved ${changed.length ? changed.join(', ') + ' but' : 'nothing:'} could not save "${key}". Reload and check.`);
    changed.push(key);
  }
  return { ok: true, data: { changed } };
}

export async function getQueue(store: AdminStore, q: QueueQuery): Promise<Act<QueueData>> {
  const [c, cat] = await Promise.all([store.listQueueCandidates(), store.getCatalogue()]);
  return { ok: true, data: buildQueue(c.orders, c.awaitingConfirmation, q, cat) };
}
/** Records that the job sheet's print dialog was opened (the site cannot know whether anything was actually printed). */
export async function logJobSheetPrint(store: AdminStore, admin: Admin, orderId: string): Promise<Act> {
  if (!UUID.test(orderId)) return fail(400, 'Invalid order.');
  const o = await store.getOrder(orderId); if (!o) return fail(404, 'Order not found.');
  if (o.status === 'cancelled') return fail(422, 'This order is cancelled. Do not print it.');
  await store.logEvent(admin, 'job_sheet.print_opened', 'order', o.id, { orderNumber: o.orderNumber, status: o.status });
  return { ok: true, data: undefined };
}

export async function catalogueView(store: AdminStore): Promise<Act<{ catalogue: Catalogue; warnings: string[]; ready: boolean }>> {
  const catalogue = await store.getCatalogue();
  return { ok: true, data: { catalogue, warnings: catalogueWarnings(catalogue), ready: catalogue.fromDatabase === true } };
}
/** One validated entry point for all catalogue edits. Every successful change is written + audited by a database function. */
export async function catalogueAction(store: AdminStore, admin: Admin, body: any): Promise<Act<{ warnings: string[]; id?: string }>> {
  const cat = await store.getCatalogue();
  if (!cat.fromDatabase) return fail(503, 'The paper and printer tables are missing. Run migration 0005_catalogue.sql in Supabase first.');
  let id: string | undefined;
  if (body?.op === 'add_size') {
    const v = validateAddSize(body, cat); if (!v.ok) return fail(422, v.error, v.field);
    if ((await store.addPaperSize(admin, v.value)) === 'duplicate') return fail(409, 'A paper size with this name already exists.', 'name');
    id = v.value.id;
  } else if (body?.op === 'set_size') {
    const v = validateSetSize(body, cat); if (!v.ok) return fail(422, v.error, v.field);
    const r = await store.setPaperSize(admin, v.value);
    if (r === 'not_found') return fail(404, 'Unknown paper size.');
    if (r === 'no_price') return fail(422, 'Set a price before enabling this size.', 'bwRupees');
    if (r === 'no_printer') return fail(422, 'Add or activate a printer that supports this size before enabling it.');
    if (r === 'last_size') return fail(422, 'At least one paper size must stay enabled.');
    id = v.value.id;
  } else if (body?.op === 'save_printer') {
    const v = validateSavePrinter(body, cat); if (!v.ok) return fail(422, v.error, v.field);
    const r = await store.savePrinter(admin, v.value);
    if (r.result === 'not_found') return fail(404, 'Printer not found.');
    if (r.result === 'duplicate') return fail(409, 'A printer with this name already exists.', 'name');
    if (r.result === 'invalid') return fail(422, 'Unknown paper size selected.', 'paperSizeIds');
    id = r.id;
  } else return fail(400, 'Unknown action.');
  return { ok: true, data: { warnings: catalogueWarnings(await store.getCatalogue()), id } };
}
