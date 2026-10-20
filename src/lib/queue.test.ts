import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, eligibility, filterAndSort, nextAction, parseQueueQuery, toRow } from './queue.ts';
import type { QueueQuery } from './queue.ts';
import { buildJobSheet, formatRanges, printTypeOf } from './jobsheet.ts';
import { calculatePrice } from './pricing.ts';
import { defaultCatalogue } from './catalogue.ts';
import { changeStatus, collectCash, getQueue, logJobSheetPrint } from './admin-actions.ts';
import { guardWith } from './admin-http.ts';
import type { AuthBackend, Admin } from './admin-auth.ts';
import type { AdminItem, AdminOrder, AdminStore } from './admin-store.ts';

const U = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (o: Partial<AdminItem> = {}): AdminItem => ({ id: '20000000-0000-4000-8000-000000000001', originalName: 'report.pdf', totalPages: 10, pageRange: null, copies: 1, colorMode: 'bw', sides: 1, paperSize: 'A4', orientation: 'portrait', lineTotalPaise: 2000, hasFile: true, ...o });
let seq = 0;
const order = (o: Partial<AdminOrder> = {}): AdminOrder => { seq++; return { id: U(seq), orderNumber: `HPS-T${String(seq).padStart(7, '0')}`, customerName: 'Asha', phone: '9876543210', email: null, fulfilment: 'pickup', deliveryAddress: null, deliveryFeePaise: 0, instructions: null, paymentMethod: 'cash', paymentStatus: 'cash_pending', status: 'confirmed', subtotalPaise: 2000, totalPaise: 2000, cancelReason: null, createdAt: new Date(Date.UTC(2026, 9, 16, 4, seq)).toISOString(), items: [item()], collection: null, ...o }; };
const Q: QueueQuery = { stage: 'to_print', status: 'all', type: 'all', fulfilment: 'all', sort: 'next', dir: 'asc' };
const nums = (rows: { orderNumber: string }[]) => rows.map(r => r.orderNumber);

// ---------- eligibility ----------
test('eligibility: only confirmed→handover orders with valid payment and a stored PDF', () => {
  assert.ok(eligibility(order()).eligible);
  assert.ok(eligibility(order({ status: 'printing', paymentStatus: 'paid' })).eligible);
  for (const status of ['pending_confirmation', 'completed', 'cancelled']) assert.equal(eligibility(order({ status })).eligible, false, status);
  for (const paymentStatus of ['pending', 'failed', 'refund_pending', 'refunded']) assert.equal(eligibility(order({ paymentStatus })).eligible, false, paymentStatus);
  const del = eligibility(order({ items: [item({ hasFile: false })] })); assert.ok(!del.eligible && /deleted/.test(del.reason));
  assert.equal(eligibility(order({ items: [] })).eligible, false);
});
test('buildQueue hides ineligible orders but reports why', () => {
  const q = buildQueue([order(), order({ items: [item({ hasFile: false })] }), order({ status: 'cancelled' })], 3, Q);
  assert.equal(q.rows.length, 1); assert.equal(q.hidden.length, 1); assert.equal(q.awaitingConfirmation, 3);
});

// ---------- filtering and sorting ----------
const mixed = () => {
  seq = 0;
  return [order({ status: 'confirmed' }), order({ status: 'printing', items: [item({ colorMode: 'c' })] }), order({ status: 'preparing', fulfilment: 'delivery', deliveryAddress: 'x', items: [item({ colorMode: 'c', sides: 2, copies: 2 })] }),
    order({ status: 'confirmed', items: [item({ colorMode: 'c' }), item({ id: '20000000-0000-4000-8000-000000000002', colorMode: 'bw' })] }), order({ status: 'ready_for_pickup' }), order({ status: 'out_for_delivery', fulfilment: 'delivery', deliveryAddress: 'x', paymentStatus: 'paid' })];
};
const run = (q: Partial<QueueQuery>) => nums(buildQueue(mixed(), 0, { ...Q, ...q }).rows).map(n => Number(n.slice(-7)));
test('stage filter: to_print vs handover vs all', () => { assert.deepEqual(run({}).sort(), [1, 2, 3, 4]); assert.deepEqual(run({ stage: 'handover' }).sort(), [5, 6]); assert.equal(run({ stage: 'all' }).length, 6); });
test('status, type and pickup/delivery filters (incl. mixed colour orders)', () => {
  assert.deepEqual(run({ status: 'confirmed' }).sort(), [1, 4]);
  assert.deepEqual(run({ type: 'bw' }), [1]); assert.deepEqual(run({ type: 'colour' }).sort(), [2, 3]); assert.deepEqual(run({ type: 'mixed' }), [4]);
  assert.deepEqual(run({ fulfilment: 'delivery' }), [3]); assert.deepEqual(run({ fulfilment: 'pickup', type: 'colour' }), [2]);
  assert.deepEqual(run({ status: 'printing', type: 'bw' }), []);
});
test('default sort "next": finish what is printing first, then preparing, then oldest queued', () => assert.deepEqual(run({}), [2, 3, 1, 4]));
test('sorts by time (both directions), status pipeline, type and fulfilment; ties fall back to oldest', () => {
  assert.deepEqual(run({ sort: 'time' }), [1, 2, 3, 4]); assert.deepEqual(run({ sort: 'time', dir: 'desc' }), [4, 3, 2, 1]);
  assert.deepEqual(run({ sort: 'status' }), [1, 4, 3, 2]); assert.deepEqual(run({ sort: 'status', dir: 'desc' }), [2, 3, 1, 4]);
  assert.deepEqual(run({ sort: 'type' }), [1, 2, 3, 4]); assert.deepEqual(run({ sort: 'fulfilment' }), [1, 2, 4, 3]);
});
test('nextUp ignores user filters and picks the in-progress job', () => { const q = buildQueue(mixed(), 0, { ...Q, type: 'bw', stage: 'handover' }); assert.equal(q.nextUp?.orderNumber.slice(-7), '0000002'); assert.equal(buildQueue([], 0, Q).nextUp, null); });
test('batch summary counts orders and printed sides per print type', () => {
  const b = buildQueue(mixed(), 0, Q).batch; assert.equal(b.bw.orders, 1); assert.equal(b.colour.orders, 2); assert.equal(b.mixed.orders, 1); assert.equal(b.colour.sides, 10 + 10 * 2);
});
test('query parsing is a whitelist', () => {
  assert.ok(parseQueueQuery(new URLSearchParams('stage=handover&type=colour&sort=time&dir=desc&status=printing')).ok);
  for (const bad of ['stage=x', 'type=x', 'sort=price', 'dir=up', 'status=completed', 'status=pending_confirmation', 'fulfilment=teleport']) assert.ok(!parseQueueQuery(new URLSearchParams(bad)).ok, bad);
  const d = parseQueueQuery(new URLSearchParams('')); assert.ok(d.ok && d.value.stage === 'to_print' && d.value.sort === 'next');
});

// ---------- workflow / next action ----------
test('next action follows the existing rules for pickup and delivery', () => {
  assert.equal(nextAction(order({ status: 'confirmed' }))?.to, 'preparing');
  assert.equal(nextAction(order({ status: 'preparing' }))?.to, 'printing');
  assert.equal(nextAction(order({ status: 'printing' }))?.to, 'ready_for_pickup');
  assert.equal(nextAction(order({ status: 'printing', fulfilment: 'delivery' }))?.to, 'out_for_delivery');
  assert.equal(nextAction(order({ status: 'ready_for_pickup' })), null, 'unpaid: cash first');
  assert.equal(nextAction(order({ status: 'ready_for_pickup', paymentStatus: 'paid' }))?.to, 'completed');
  assert.equal(nextAction(order({ status: 'completed' })), null);
  assert.equal(toRow(order({ status: 'ready_for_pickup' })).canRecordCash, true);
  assert.equal(toRow(order({ status: 'printing' })).canRecordCash, false);
});
function fake(o: AdminOrder) {
  let cur = { ...o }; const log: any[] = [];
  const store = { async getOrder() { return { ...cur }; }, async listQueueCandidates() { return { orders: [cur], awaitingConfirmation: 2 }; }, async getCatalogue() { return defaultCatalogue({ bw_paise: 200, colour_paise: 900 }); },
    async setStatus(_i: string, e: string, n: string, a: Admin, r: string | null) { if (cur.status !== e) return 'conflict'; cur.status = n; log.push(['status', e, n, a.email]); return 'ok'; },
    async collectCash(_i: string, a: Admin, amt: number) { if (cur.collection) return 'duplicate'; cur.collection = { amountPaise: amt, collectedAt: 'now', collectedByEmail: a.email }; cur.paymentStatus = 'paid'; log.push(['cash', amt]); return 'ok'; },
    async logEvent(a: Admin, action: string, entity: string, id: string) { log.push(['event', action, entity, id]); } } as unknown as AdminStore;
  return { store, log, get: () => cur };
}
const admin: Admin = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@x.com' };
test('full queue workflow, pickup: queued → preparing → printing → ready → cash → completed', async () => {
  seq = 0; const o = order(), f = fake(o); const step = (to: string, from: string) => changeStatus(f.store, admin, o.id, { to, expectedStatus: from });
  assert.ok((await step('preparing', 'confirmed')).ok); assert.ok((await step('printing', 'preparing')).ok); assert.ok((await step('ready_for_pickup', 'printing')).ok);
  const early = await step('completed', 'ready_for_pickup'); assert.ok(!early.ok && /cash collection/.test(early.error));
  assert.ok((await collectCash(f.store, admin, o.id, { amountPaise: 2000 })).ok); assert.ok((await step('completed', 'ready_for_pickup')).ok);
  assert.equal(f.get().status, 'completed'); assert.equal(f.log.filter(l => l[0] === 'status').length, 4);
});
test('delivery orders go out for delivery, never "ready for pickup"', async () => {
  seq = 0; const o = order({ status: 'printing', fulfilment: 'delivery', deliveryAddress: 'x' }), f = fake(o);
  assert.ok(!(await changeStatus(f.store, admin, o.id, { to: 'ready_for_pickup', expectedStatus: 'printing' })).ok);
  assert.ok((await changeStatus(f.store, admin, o.id, { to: 'out_for_delivery', expectedStatus: 'printing' })).ok);
});
test('duplicate processing: a second admin clicking the same step is refused; skipping steps is refused', async () => {
  seq = 0; const o = order({ status: 'preparing' }), f = fake(o);
  assert.ok((await changeStatus(f.store, admin, o.id, { to: 'printing', expectedStatus: 'preparing' })).ok);
  const second = await changeStatus(f.store, { ...admin, email: 'staff@x.com' }, o.id, { to: 'printing', expectedStatus: 'preparing' }); assert.ok(!second.ok && second.code === 'STALE');
  assert.ok(!(await changeStatus(f.store, admin, o.id, { to: 'completed', expectedStatus: 'printing' })).ok);
  assert.equal(f.log.filter(l => l[0] === 'status').length, 1);
});
test('getQueue action returns the built queue; job sheet print is audited, refused for cancelled/unknown/bad ids', async () => {
  seq = 0; const o = order(), f = fake(o); const q = await getQueue(f.store, Q); assert.ok(q.ok && q.data.rows.length === 1 && q.data.awaitingConfirmation === 2);
  assert.ok((await logJobSheetPrint(f.store, admin, o.id)).ok); assert.deepEqual(f.log.at(-1), ['event', 'job_sheet.print_opened', 'order', o.id]);
  const c = fake(order({ status: 'cancelled' })); const r = await logJobSheetPrint(c.store, admin, U(99)); assert.ok(!r.ok && r.status === 422); assert.equal(c.log.length, 0);
  assert.equal((await logJobSheetPrint(f.store, admin, 'nope') as any).status, 400);
});

// ---------- authorization ----------
const backend: AuthBackend = { async getUser(t) { return t === 'admin' ? { id: 'a', email: 'a@x.com' } : t === 'cust' ? { id: 'c', email: 'c@x.com' } : null; }, async isAdmin(id) { return id === 'a'; }, async refresh() { return null; } };
const R = (path: string, cookie: string | null, method = 'GET', origin?: string) => new Request('https://shop.example' + path, { method, headers: { host: 'shop.example', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
test('queue, order and job-sheet endpoints: 401 anonymous, 403 customer, 200 admin; job-sheet log needs same origin', async () => {
  const code = async (r: Request, w: boolean) => { const g = await guardWith(backend, r, w); return g.ok ? 200 : g.response.status; };
  for (const [path, w, m] of [['/api/admin/queue', false, 'GET'], [`/api/admin/orders/${U(1)}`, false, 'GET'], [`/api/admin/orders/${U(1)}/job-sheet`, true, 'POST']] as const) {
    const o = m === 'POST' ? 'https://shop.example' : undefined;
    assert.equal(await code(R(path, null, m, o), w), 401, path); assert.equal(await code(R(path, 'hps_at=cust', m, o), w), 403, path);
    assert.equal(await code(R(path, 'hps_at=forged', m, o), w), 401, path); assert.equal(await code(R(path, 'hps_at=admin', m, o), w), 200, path);
  }
  assert.equal(await code(R(`/api/admin/orders/${U(1)}/job-sheet`, 'hps_at=admin', 'POST', 'https://evil.example'), true), 403);
});

// ---------- job sheet accuracy ----------
test('formatRanges compresses and sorts', () => { assert.equal(formatRanges([3, 1, 2, 5, 6, 9, 9]), '1-3, 5-6, 9'); assert.equal(formatRanges([4]), '4'); assert.equal(formatRanges([]), ''); });
test('job sheet numbers match the price calculator (sides, sheets) for ranges, copies and duplex', () => {
  for (const [pages, range, copies, sides] of [[10, '', 1, 1], [10, '1-3, 5, 8-10', 2, 1], [9, '', 3, 2], [10, '2,4,6', 2, 2], [1, '', 5, 2]] as const) {
    const j = buildJobSheet(order({ items: [item({ totalPages: pages, pageRange: range || null, copies, sides })] })).items[0];
    const p = calculatePrice({ totalPages: pages, range, copies, mode: 'bw', sides }) as any;
    assert.equal(j.sidesPerCopy, p.sidesPerCopy); assert.equal(j.totalSides, p.totalSides); assert.equal(j.sheets, p.sheets);
  }
});
test('job sheet content: page text, colour, duplex, instructions, fulfilment, payment', () => {
  const s = buildJobSheet(order({ instructions: 'Staple top-left', fulfilment: 'delivery', deliveryAddress: '12-3 Some Road', items: [item({ pageRange: '3,1,2,5', colorMode: 'c', sides: 2, copies: 2 })] }));
  const i = s.items[0]; assert.equal(i.selection, '1-3, 5'); assert.equal(i.colour, 'Colour'); assert.equal(i.duplex, 'Double-sided'); assert.equal(i.copies, 2); assert.equal(i.paper, 'A4');
  assert.equal(s.instructions, 'Staple top-left'); assert.equal(s.address, '12-3 Some Road'); assert.equal(s.printType, 'colour');
  assert.deepEqual(s.payment, { label: 'COLLECT CASH ON DELIVERY', amountDuePaise: 2000 });
  assert.equal(buildJobSheet(order()).items[0].selection, 'All 10 pages'); assert.equal(buildJobSheet(order()).address, null);
});
test('job sheet: pickup never shows an address; paid shows nothing due; unconfirmed payment is flagged; cancelled is flagged', () => {
  assert.equal(buildJobSheet(order({ fulfilment: 'pickup', deliveryAddress: 'leftover' })).address, null);
  const paid = buildJobSheet(order({ paymentStatus: 'paid', collection: { amountPaise: 2000, collectedAt: 'x', collectedByEmail: 'a' } })); assert.deepEqual(paid.payment, { label: 'PAID - cash received', amountDuePaise: 0 });
  assert.equal(buildJobSheet(order({ paymentStatus: 'pending' })).payment.label, 'PAYMENT NOT CONFIRMED');
  assert.equal(buildJobSheet(order({ status: 'cancelled' })).cancelled, true);
});
test('job sheet: unreadable saved page selection is flagged, never silently printed as "all"', () => {
  const j = buildJobSheet(order({ items: [item({ pageRange: '1-99' })] })).items[0]; assert.ok(j.warning && /unreadable/.test(j.selection));
  assert.equal(printTypeOf([item({ colorMode: 'c' }), item({ colorMode: 'bw' })]), 'mixed');
});
