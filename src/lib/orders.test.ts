import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, normalizePhone } from './orders.ts';
import { parseSettings } from './settings.ts';
import { hashToken } from './security.ts';
import type { Store, UploadRow, OrderRow, ItemRow } from './store.ts';

const UP = '11111111-1111-4111-8111-111111111111', UP2 = '22222222-2222-4222-8222-222222222222', TOKEN = 'secret-token-A', KEY = 'idem-key-0001';
function fake(over: Partial<UploadRow> = {}) {
  const uploads = new Map<string, UploadRow>(), orders = new Map<string, OrderRow>(), items: ItemRow[] = [];
  const base = (id: string, tok: string): UploadRow => ({ id, storagePath: `uploads/${id}.pdf`, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1000, pages: 10, tokenHash: hashToken(tok), status: 'ready', expiresAt: new Date(Date.now() + 3600_000).toISOString(), claimedOrderId: null });
  uploads.set(UP, { ...base(UP, TOKEN), ...over }); uploads.set(UP2, base(UP2, 'secret-token-B'));
  let failItem = false;
  const store: Store = {
    async getUpload(id) { return uploads.get(id) ?? null; },
    async getOrderByKey(k) { return [...orders.values()].find(o => o.idempotencyKey === k) ?? null; },
    async claimUpload(id, oid) { const u = uploads.get(id)!; if (u.claimedOrderId) return false; u.claimedOrderId = oid; return true; },
    async releaseUpload(id, oid) { const u = uploads.get(id)!; if (u.claimedOrderId === oid) u.claimedOrderId = null; },
    async insertOrder(o) { if ([...orders.values()].some(x => x.idempotencyKey === o.idempotencyKey)) return 'idempotency_conflict'; orders.set(o.id, { ...o }); return 'ok'; },
    async insertItem(i) { if (failItem) return false; items.push(i); return true; },
    async deleteOrder(id) { orders.delete(id); },
  };
  return { store, uploads, orders, items, breakItems: () => { failItem = true; } };
}
const S = parseSettings({ delivery: { enabled: true, fee_paise: 3000, min_order_paise: 1000 }, payments: { cash_enabled: true } });
const body = (o: Record<string, unknown> = {}) => ({ uploadId: UP, uploadToken: TOKEN, idempotencyKey: KEY, range: '1-3,5', copies: 2, mode: 'c', sides: 1, fulfilment: 'pickup', paymentMethod: 'cash', name: 'Asha Rao', phone: '+91 98765 43210', ...o });

test('cash pickup order: server price, cash_pending, never paid', async () => {
  const f = fake(); const r = await createOrder(f.store, S, body());
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.order.totalPaise, 4 * 2 * 900); assert.equal(r.order.paymentStatus, 'cash_pending'); assert.equal(r.order.status, 'pending_confirmation');
  assert.match(r.order.orderNumber, /^HPS-[A-Z2-9]{8}$/);
  assert.equal(f.items.length, 1); assert.equal(f.items[0].totalPages, 10); assert.equal(f.orders.values().next().value!.phone, '9876543210');
});
test('browser-supplied price fields are ignored', async () => {
  const r = await createOrder(fake().store, S, body({ totalPaise: 1, total: 1, price: 1, deliveryFeePaise: 0, paymentStatus: 'paid' }));
  assert.ok(r.ok && r.order.totalPaise === 7200 && r.order.paymentStatus === 'cash_pending');
});
test('stale expected total is rejected with PRICE_CHANGED', async () => {
  const r = await createOrder(fake().store, S, body({ expectedTotalPaise: 100 })); assert.ok(!r.ok && r.code === 'PRICE_CHANGED' && r.status === 409);
  assert.ok((await createOrder(fake().store, S, body({ expectedTotalPaise: 7200 }))).ok);
});
test('online payment refused; cash disabled refused', async () => {
  assert.ok(!(await createOrder(fake().store, S, body({ paymentMethod: 'razorpay' }))).ok);
  assert.ok(!(await createOrder(fake().store, parseSettings({}), body())).ok);
});
test('delivery: disabled by default, fee from settings, address and minimum enforced', async () => {
  const off = parseSettings({ payments: { cash_enabled: true } });
  assert.ok(!(await createOrder(fake().store, off, body({ fulfilment: 'delivery', address: '12-3 Some Road, Hyderabad' }))).ok);
  assert.ok(!(await createOrder(fake().store, parseSettings({ delivery: { enabled: true }, payments: { cash_enabled: true } }), body({ fulfilment: 'delivery', address: '12-3 Some Road, Hyderabad' }))).ok, 'enabled without a fee stays disabled');
  const d = await createOrder(fake().store, S, body({ fulfilment: 'delivery', address: '12-3 Some Road, Hyderabad' }));
  assert.ok(d.ok && d.order.deliveryFeePaise === 3000 && d.order.totalPaise === 7200 + 3000);
  assert.ok(!(await createOrder(fake().store, S, body({ fulfilment: 'delivery' }))).ok, 'address required');
  const small = await createOrder(fake().store, S, body({ fulfilment: 'delivery', address: '12-3 Some Road, Hyderabad', range: '1', copies: 1, mode: 'bw' }));
  assert.ok(!small.ok && small.field === 'fulfilment');
});
test('customer cannot use another customer\'s upload (wrong token / unknown id look identical)', async () => {
  const f = fake(); const wrong = await createOrder(f.store, S, body({ uploadToken: 'secret-token-B' }));
  const unknown = await createOrder(f.store, S, body({ uploadId: '33333333-3333-4333-8333-333333333333' }));
  assert.ok(!wrong.ok && !unknown.ok && wrong.status === 404 && unknown.status === 404 && wrong.error === unknown.error);
  assert.equal(f.orders.size, 0);
});
test('upload can only be used once; expired and pending uploads refused', async () => {
  const f = fake(); assert.ok((await createOrder(f.store, S, body())).ok);
  const again = await createOrder(f.store, S, body({ idempotencyKey: 'idem-key-0002' })); assert.ok(!again.ok && again.status === 409);
  assert.ok(!(await createOrder(fake({ expiresAt: new Date(Date.now() - 1000).toISOString() }).store, S, body())).ok);
  assert.ok(!(await createOrder(fake({ status: 'pending', pages: null }).store, S, body())).ok);
});
test('idempotent retry returns the same order and creates no duplicate', async () => {
  const f = fake(); const a = await createOrder(f.store, S, body()); const b = await createOrder(f.store, S, body());
  assert.ok(a.ok && b.ok && b.replay && a.order.orderNumber === b.order.orderNumber); assert.equal(f.orders.size, 1); assert.equal(f.items.length, 1);
  const other = await createOrder(f.store, S, body({ uploadId: UP2, uploadToken: 'secret-token-B' })); assert.ok(!other.ok, 'same key cannot be replayed with someone else\'s upload');
});
test('validation: pages beyond document, bad copies/mode/sides, phone, name', async () => {
  for (const o of [{ range: '1-11' }, { range: 'abc' }, { copies: 0 }, { copies: 501 }, { mode: 'x' }, { sides: 3 }, { phone: '12345' }, { name: 'A' }, { email: 'nope' }])
    assert.ok(!(await createOrder(fake().store, S, body(o))).ok, JSON.stringify(o));
  assert.ok(!(await createOrder(fake().store, S, null)).ok);
});
test('failed item insert rolls back order and releases the file', async () => {
  const f = fake(); f.breakItems(); const r = await createOrder(f.store, S, body());
  assert.ok(!r.ok && r.status === 500); assert.equal(f.orders.size, 0); assert.equal(f.uploads.get(UP)!.claimedOrderId, null);
});
test('settings: malformed values never invent charges', () => {
  const s = parseSettings({ delivery: { enabled: true, fee_paise: 'free' }, pricing: { bw_paise: -1 }, files: { max_mb: 500 } });
  assert.equal(s.delivery.enabled, false); assert.equal(s.rates.bw_paise, 200); assert.equal(s.maxMb, 25);
});
test('phone normalisation', () => { assert.equal(normalizePhone('+91 98765-43210'), '9876543210'); assert.equal(normalizePhone('09876543210'), '9876543210'); assert.equal(normalizePhone('1234567890'), null); });
