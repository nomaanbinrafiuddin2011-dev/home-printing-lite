import { randomBytes, randomUUID } from 'node:crypto';
import { calculatePrice, rupees } from './pricing.ts';
import { checkOrderable } from './catalogue.ts';
import { hashToken, safeEqualHex } from './security.ts';
import type { Settings } from './settings.ts';
import type { Store, OrderRow } from './store.ts';

export interface OrderSummary { orderNumber: string; fulfilment: 'pickup' | 'delivery'; subtotalPaise: number; deliveryFeePaise: number; totalPaise: number; paymentMethod: 'cash'; paymentStatus: 'cash_pending'; status: 'pending_confirmation' }
export type CreateResult = { ok: true; replay: boolean; order: OrderSummary } | { ok: false; status: number; error: string; field?: string; code?: string };
const fail = (status: number, error: string, field?: string, code?: string): CreateResult => ({ ok: false, status, error, field, code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no look-alikes
export function newOrderNumber(): string { let s = ''; for (const b of randomBytes(8)) s += ALPHA[b % 32]; return 'HPS-' + s; }
export function normalizePhone(s: string): string | null {
  const d = s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() : '');
const summary = (o: OrderRow): OrderSummary => ({ orderNumber: o.orderNumber, fulfilment: o.fulfilment, subtotalPaise: o.subtotalPaise, deliveryFeePaise: o.deliveryFeePaise, totalPaise: o.totalPaise, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, status: o.status });

/** Creates an order. The browser never supplies a price; expectedTotalPaise is only compared, never used. */
export async function createOrder(store: Store, settings: Settings, raw: unknown, now: Date = new Date()): Promise<CreateResult> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const uploadId = str(b.uploadId), token = str(b.uploadToken), key = str(b.idempotencyKey);
  if (!UUID.test(uploadId) || !token || token.length > 200) return fail(400, 'Upload your PDF first.', 'file');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return fail(400, 'Invalid request. Please refresh and try again.');

  const name = str(b.name), phone = normalizePhone(str(b.phone)), email = str(b.email), instructions = str(b.instructions), address = str(b.address);
  if (name.length < 2 || name.length > 80) return fail(422, 'Enter your name (2–80 characters).', 'name');
  if (!phone) return fail(422, 'Enter a valid 10-digit Indian mobile number.', 'phone');
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return fail(422, 'Enter a valid email or leave it empty.', 'email');
  if (instructions.length > 500) return fail(422, 'Instructions are limited to 500 characters.', 'instructions');
  const mode = b.mode, sides = Number(b.sides), copies = Number(b.copies), range = str(b.range).slice(0, 200);

  if (b.paymentMethod === 'razorpay') return fail(400, 'Online payment is not available yet. Choose cash.', 'paymentMethod');
  if (b.paymentMethod !== 'cash' || !settings.cashEnabled) return fail(400, 'Cash payment is not available right now.', 'paymentMethod');
  const fulfilment = b.fulfilment;
  if (fulfilment === 'pickup') { if (!settings.pickupEnabled) return fail(400, 'Pickup is not available right now.', 'fulfilment'); }
  else if (fulfilment === 'delivery') {
    if (!settings.delivery.enabled) return fail(400, 'Delivery is not available right now. Please choose pickup.', 'fulfilment');
    if (address.length < 10 || address.length > 300) return fail(422, 'Enter your full delivery address (10–300 characters).', 'address');
  } else return fail(400, 'Choose pickup or delivery.', 'fulfilment');

  // Paper size: must exist, be enabled, be servable by ONE active printer with the needed colour/duplex, and be priced.
  const paperId = str(b.paperSize).toLowerCase() || 'a4';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(paperId)) return fail(422, 'Choose a paper size.', 'paperSize');
  const ord = checkOrderable(settings.catalogue, paperId, mode, sides);
  if (!ord.ok) return fail(422, ord.error, ord.code === 'bad_input' ? 'mode' : 'paperSize');

  // Ownership: unknown id and wrong token give the same answer so ids cannot be probed.
  const up = await store.getUpload(uploadId);
  if (!up || !safeEqualHex(up.tokenHash, hashToken(token))) return fail(404, 'We could not find that upload. Please upload your file again.', 'file');

  const existing = await store.getOrderByKey(key);
  if (existing) return up.claimedOrderId === existing.id ? { ok: true, replay: true, order: summary(existing) } : fail(409, 'This request was already used. Please refresh and try again.');

  if (up.status !== 'ready' || !up.pages) return fail(409, 'Your file is still being checked. Please wait a moment.', 'file');
  if (up.claimedOrderId) return fail(409, 'This file was already used for an order. Please upload it again to place a new order.', 'file');
  if (new Date(up.expiresAt).getTime() < now.getTime()) return fail(410, 'This upload has expired. Please upload your file again.', 'file');

  const price = calculatePrice({ totalPages: up.pages, range, copies, mode: mode as 'bw' | 'c', sides: sides as 1 | 2 }, { bw_paise: settings.catalogue.prices[ord.size.id]?.bw ?? 0, colour_paise: settings.catalogue.prices[ord.size.id]?.c ?? 0 });
  if (!price.ok) return fail(422, price.error, 'range');
  const deliveryFee = fulfilment === 'delivery' ? settings.delivery.feePaise : 0;
  if (fulfilment === 'delivery' && price.totalPaise < settings.delivery.minOrderPaise) return fail(422, `Delivery needs a minimum order of ${rupees(settings.delivery.minOrderPaise)}. Choose pickup or add more pages.`, 'fulfilment');
  const total = price.totalPaise + deliveryFee;
  if (b.expectedTotalPaise !== undefined && b.expectedTotalPaise !== total)
    return fail(409, `The price is now ${rupees(total)}${typeof b.expectedTotalPaise === 'number' ? ` (you saw ${rupees(b.expectedTotalPaise)})` : ''}. Please review it and confirm again.`, undefined, 'PRICE_CHANGED');

  const id = randomUUID();
  if (!(await store.claimUpload(up.id, id))) return fail(409, 'This file was already used for an order.', 'file');
  const row: OrderRow = { id, orderNumber: '', idempotencyKey: key, customerName: name, phone, email: email || null, fulfilment, deliveryAddress: fulfilment === 'delivery' ? address : null, deliveryFeePaise: deliveryFee, instructions: instructions || null, paymentMethod: 'cash', paymentStatus: 'cash_pending', status: 'pending_confirmation', subtotalPaise: price.totalPaise, totalPaise: total };
  let inserted = false;
  for (let i = 0; i < 5 && !inserted; i++) {
    row.orderNumber = newOrderNumber();
    const r = await store.insertOrder(row);
    if (r === 'ok') inserted = true;
    else if (r === 'idempotency_conflict') { await store.releaseUpload(up.id, id); const e = await store.getOrderByKey(key); return e ? { ok: true, replay: true, order: summary(e) } : fail(409, 'Please try again.'); }
    else if (r === 'error') break;
  }
  if (!inserted) { await store.releaseUpload(up.id, id); return fail(500, 'We could not save your order. Nothing was charged. Please try again.'); }
  const okItem = await store.insertItem({ orderId: id, storagePath: up.storagePath, originalName: up.originalName, mimeType: up.mimeType, sizeBytes: up.sizeBytes, totalPages: up.pages, pageRange: range || null, copies: price.copies, colorMode: mode as 'bw' | 'c', sides: sides as 1 | 2, lineTotalPaise: price.totalPaise, paperSize: ord.size.name, paperSizeId: ord.size.id, paperWidthMm: ord.size.widthMm, paperHeightMm: ord.size.heightMm });
  if (!okItem) { await store.deleteOrder(id); await store.releaseUpload(up.id, id); return fail(500, 'We could not save your order. Nothing was charged. Please try again.'); }
  return { ok: true, replay: false, order: summary(row) };
}
