import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueWarnings, checkOrderable, defaultCatalogue, printersForItems, publicCatalogue, suitablePrinters } from './catalogue.ts';
import type { Catalogue, Printer, PaperSize } from './catalogue.ts';
import { validateAddSize, validateSavePrinter, validateSetSize } from './catalogue-validation.ts';
import { catalogueAction, catalogueView, getQueue } from './admin-actions.ts';
import { createOrder } from './orders.ts';
import { parseSettings } from './settings.ts';
import { hashToken } from './security.ts';
import { buildJobSheet } from './jobsheet.ts';
import { buildQueue, parseQueueQuery } from './queue.ts';
import { guardWith } from './admin-http.ts';
import { loadCatalogue } from './store-supabase.ts';
import type { AuthBackend, Admin } from './admin-auth.ts';
import type { AdminItem, AdminOrder, AdminStore } from './admin-store.ts';
import type { Store, UploadRow, OrderRow, ItemRow } from './store.ts';

const size = (id: string, name: string, w: number, h: number, enabled: boolean, extra: Partial<PaperSize> = {}): PaperSize => ({ id, name, widthMm: w, heightMm: h, isCustom: false, enabled, sortOrder: 50, ...extra });
const printer = (id: string, name: string, p: Partial<Printer> = {}): Printer => ({ id, name, active: true, supportsColour: false, supportsDuplex: false, paperSizeIds: [], ...p });
/** A realistic future shop: A4 printer (colour+duplex), a large B&W-only A3 printer, an inactive spare. */
const cat = (): Catalogue => ({ fromDatabase: true,
  sizes: [size('a3', 'A3', 297, 420, true, { sortOrder: 30 }), size('a4', 'A4', 210, 297, true, { sortOrder: 40 }), size('a5', 'A5', 148, 210, false), size('letter', 'Letter', 216, 279, false), size('custom-photo', 'Photo', 100, 150, true, { isCustom: true, sortOrder: 200 })],
  printers: [printer('30000000-0000-4000-8000-000000000001', 'Main', { supportsColour: true, supportsDuplex: true, paperSizeIds: ['a4'] }), printer('30000000-0000-4000-8000-000000000002', 'Large', { paperSizeIds: ['a3'] }), printer('30000000-0000-4000-8000-000000000003', 'Spare', { active: false, supportsColour: true, supportsDuplex: true, paperSizeIds: ['a3'] })],
  prices: { a4: { bw: 200, c: 900 }, a3: { bw: 1000, c: 3000 } } });

// ---------- capability + price rules ----------
test('default (A4-only) catalogue keeps today\'s service and rates; other sizes are unavailable', () => {
  const d = defaultCatalogue({ bw_paise: 200, colour_paise: 900 });
  for (const [m, s, r] of [['bw', 1, 200], ['bw', 2, 200], ['c', 1, 900], ['c', 2, 900]] as const) { const o = checkOrderable(d, 'a4', m, s); assert.ok(o.ok && o.ratePaise === r, `${m}${s}`); }
  for (const id of ['a3', 'a5', 'letter', 'legal', 'custom-x']) assert.equal(checkOrderable(d, id, 'bw', 1).ok, false, id);
});
test('each size is priced on its own; A4 rates are untouched; other sizes are never priced by default', () => {
  const c = cat(); const a3 = checkOrderable(c, 'a3', 'bw', 1); assert.ok(a3.ok && a3.ratePaise === 1000 && a3.printers.map(p => p.name).join() === 'Large');
  const a4 = checkOrderable(c, 'a4', 'c', 1); assert.ok(a4.ok && a4.ratePaise === 900);
  const photo = checkOrderable(c, 'custom-photo', 'bw', 1); assert.ok(!photo.ok && photo.code === 'no_printer');
  c.printers[0].paperSizeIds.push('custom-photo'); const np = checkOrderable(c, 'custom-photo', 'bw', 1); assert.ok(!np.ok && np.code === 'no_price', 'a printer exists but no price: refused, never guessed');
});
test('printer capabilities are enforced per size (colour, duplex), on a single printer', () => {
  const c = cat();
  const colour = checkOrderable(c, 'a3', 'c', 1); assert.ok(!colour.ok && colour.code === 'no_colour');   // only the B&W printer is active for A3
  const duplex = checkOrderable(c, 'a3', 'bw', 2); assert.ok(!duplex.ok && duplex.code === 'no_duplex');
  c.printers[2].active = true;                                                                        // activate the spare (colour + duplex)
  assert.ok(checkOrderable(c, 'a3', 'c', 2).ok);
  // colour on printer X and duplex on printer Y must NOT combine
  const split: Catalogue = { ...cat(), printers: [printer('x', 'X', { supportsColour: true, paperSizeIds: ['a4'] }), printer('y', 'Y', { supportsDuplex: true, paperSizeIds: ['a4'] })] };
  assert.ok(checkOrderable(split, 'a4', 'c', 1).ok && checkOrderable(split, 'a4', 'bw', 2).ok); const both = checkOrderable(split, 'a4', 'c', 2); assert.ok(!both.ok && both.code === 'no_duplex');
});
test('inactive printers, disabled sizes and bad input are refused', () => {
  const c = cat(); c.printers[1].active = false; const o = checkOrderable(c, 'a3', 'bw', 1); assert.ok(!o.ok && o.code === 'no_printer');
  for (const id of ['a5', 'letter', 'nope']) { const r = checkOrderable(cat(), id, 'bw', 1); assert.ok(!r.ok && r.code === 'unknown_size', id); }
  assert.ok(!checkOrderable(cat(), 'a4', 'x', 1).ok && !checkOrderable(cat(), 'a4', 'bw', 3).ok && !checkOrderable(cat(), 'a4', undefined, undefined).ok);
  assert.equal(suitablePrinters(cat(), 'a3', 'bw', 1).length, 1);
});
test('customer catalogue: disabled sizes hidden, unservable ones marked unavailable, options reflect capabilities', () => {
  const v = publicCatalogue(cat()); assert.deepEqual(v.map(s => s.id), ['a3', 'a4', 'custom-photo']);
  const a3 = v[0]; assert.deepEqual(a3.options, { bw: { single: true, double: false }, c: { single: false, double: false } }); assert.equal(a3.available, true); assert.deepEqual(a3.prices, { bw: 1000, c: 3000 });
  assert.equal(v[2].available, false); assert.deepEqual(v[1].options, { bw: { single: true, double: true }, c: { single: true, double: true } });
});
test('admin warnings flag unservable or unpriced enabled sizes and idle printers', () => {
  const c = cat(); const w = catalogueWarnings(c).join(' | '); assert.match(w, /Photo is enabled but no active printer/); assert.match(w, /Photo is enabled but has no price/);
  assert.equal(catalogueWarnings({ ...c, sizes: c.sizes.filter(s => s.id === 'a4'), printers: [c.printers[0]] }).length, 0);
  assert.match(catalogueWarnings({ ...c, printers: c.printers.map(p => ({ ...p, active: false })) }).join(), /No printer is active/);
});
test('suitable printers for an order: all files must be doable; legacy A4 items (no size id) still resolve', () => {
  const c = cat(); const it = (o: object) => ({ paperSize: 'A3', paperSizeId: 'a3' as string | null, colorMode: 'bw' as const, sides: 1 as const, ...o });
  assert.deepEqual(printersForItems(c, [it({})]).map(p => p.name), ['Large']);
  assert.deepEqual(printersForItems(c, [it({}), it({ paperSize: 'A4', paperSizeId: 'a4' })]), [], 'no single printer does A3 and A4');
  assert.deepEqual(printersForItems(c, [{ paperSize: 'A4', colorMode: 'c', sides: 2 }]).map(p => p.name), ['Main']);
  assert.deepEqual(printersForItems(c, []), []);
});

// ---------- server-side order validation ----------
const UP = '11111111-1111-4111-8111-111111111111', TOKEN = 'tok-A', KEY = 'idem-key-0001';
function fake() {
  const up: UploadRow = { id: UP, storagePath: 'uploads/x.pdf', originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, pages: 10, tokenHash: hashToken(TOKEN), status: 'ready', expiresAt: new Date(Date.now() + 3600_000).toISOString(), claimedOrderId: null };
  const orders = new Map<string, OrderRow>(), items: ItemRow[] = [];
  const store: Store = { async getUpload() { return up; }, async getOrderByKey(k) { return [...orders.values()].find(o => o.idempotencyKey === k) ?? null; }, async claimUpload(_i, o) { if (up.claimedOrderId) return false; up.claimedOrderId = o; return true; },
    async releaseUpload() { up.claimedOrderId = null; }, async insertOrder(o) { orders.set(o.id, { ...o }); return 'ok'; }, async insertItem(i) { items.push(i); return true; }, async deleteOrder(id) { orders.delete(id); } };
  return { store, items, orders, up };
}
const S = parseSettings({ payments: { cash_enabled: true } }, cat());
const body = (o: Record<string, unknown> = {}) => ({ uploadId: UP, uploadToken: TOKEN, idempotencyKey: KEY, range: '1-4', copies: 2, mode: 'bw', sides: 1, fulfilment: 'pickup', paymentMethod: 'cash', name: 'Asha Rao', phone: '9876543210', ...o });
test('orders: paper size is saved with the item, priced for that size, and defaults to A4 when omitted', async () => {
  const a = fake(), r = await createOrder(a.store, S, body()); assert.ok(r.ok && r.order.totalPaise === 4 * 2 * 200);
  assert.deepEqual([a.items[0].paperSize, a.items[0].paperSizeId, a.items[0].paperWidthMm, a.items[0].paperHeightMm], ['A4', 'a4', 210, 297]);
  const b = fake(), r3 = await createOrder(b.store, S, body({ paperSize: 'A3' })); assert.ok(r3.ok && r3.order.totalPaise === 4 * 2 * 1000, 'A3 uses the A3 rate, not the A4 rate');
  assert.deepEqual([b.items[0].paperSize, b.items[0].paperSizeId, b.items[0].paperWidthMm, b.items[0].paperHeightMm, b.items[0].lineTotalPaise], ['A3', 'a3', 297, 420, 8000]);
});
test('orders: unavailable size, capability mismatch, missing price, junk ids are all refused with nothing saved', async () => {
  const refuse = async (o: Record<string, unknown>, set = S) => { const f = fake(); const r = await createOrder(f.store, set, body(o)); assert.ok(!r.ok, JSON.stringify(o)); assert.equal(f.orders.size, 0); assert.equal(f.up.claimedOrderId, null); return r; };
  assert.equal((await refuse({ paperSize: 'a5' }) as any).field, 'paperSize');          // disabled
  await refuse({ paperSize: 'letter' }); await refuse({ paperSize: 'legal' }); await refuse({ paperSize: 'nope' });
  assert.match((await refuse({ paperSize: 'a3', mode: 'c' }) as any).error, /Colour printing is not available on A3/);
  assert.match((await refuse({ paperSize: 'a3', sides: 2 }) as any).error, /Double-sided/);
  await refuse({ paperSize: 'custom-photo' });                                           // enabled, no printer, no price
  await refuse({ paperSize: '../etc' }); await refuse({ paperSize: 'a4 ' + 'x'.repeat(60) });
  const c = cat(); c.printers[0].active = false; await refuse({ paperSize: 'a4' }, parseSettings({ payments: { cash_enabled: true } }, c));   // printer switched off
  const d = cat(); delete d.prices.a3!.bw; await refuse({ paperSize: 'a3' }, parseSettings({ payments: { cash_enabled: true } }, d));        // price removed
});
test('orders: a price sent by the browser is ignored; stale expected total for a non-A4 size is caught', async () => {
  const f = fake(); const r = await createOrder(f.store, S, body({ paperSize: 'a3', totalPaise: 1, price: 1, expectedTotalPaise: 800 })); assert.ok(!r.ok && (r as any).code === 'PRICE_CHANGED');
  const g = fake(); const ok = await createOrder(g.store, S, body({ paperSize: 'a3', totalPaise: 1, expectedTotalPaise: 8000 })); assert.ok(ok.ok && ok.order.totalPaise === 8000);
});
test('orders: with no catalogue tables (migration not run) only A4 works, at the existing rates', async () => {
  const legacy = parseSettings({ payments: { cash_enabled: true } }); const a = fake(); assert.ok((await createOrder(a.store, legacy, body())).ok);
  const b = fake(); assert.ok(!(await createOrder(b.store, legacy, body({ paperSize: 'a3' }))).ok);
});

// ---------- admin edits ----------
const admin: Admin = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@x.com' };
function adminStore(c: Catalogue) {
  const log: any[] = [];
  const store = { async getCatalogue() { return c; },
    async addPaperSize(a: Admin, v: any) { c.sizes.push(size(v.id, v.name, v.widthMm, v.heightMm, false, { isCustom: true })); log.push(['add_size', v.id, a.email]); return 'ok'; },
    async setPaperSize(a: Admin, v: any) { const s = c.sizes.find(x => x.id === v.id)!; if (v.enabled !== undefined) s.enabled = v.enabled; c.prices[v.id] = { ...c.prices[v.id], ...(v.bwPaise ? { bw: v.bwPaise } : {}), ...(v.cPaise ? { c: v.cPaise } : {}) }; log.push(['set_size', v.id, a.email]); return 'ok'; },
    async savePrinter(a: Admin, v: any) { const id = v.id ?? 'new-' + c.printers.length; const i = c.printers.findIndex(p => p.id === id); const p = { id, name: v.name, active: v.active, supportsColour: v.supportsColour, supportsDuplex: v.supportsDuplex, paperSizeIds: v.paperSizeIds }; if (i >= 0) c.printers[i] = p; else c.printers.push(p); log.push(['save_printer', id, a.email]); return { result: 'ok', id }; } } as unknown as AdminStore;
  return { store, log };
}
const rejectedMsg = async (c: Catalogue, body: any) => { const f = adminStore(c); const r = await catalogueAction(f.store, admin, body); assert.ok(!r.ok, JSON.stringify(body)); assert.equal(f.log.length, 0, 'nothing written on refusal'); return r as { error: string; status: number };
};
test('admin: custom sizes — validated, unique, start hidden', async () => {
  const f = adminStore(cat()); const r = await catalogueAction(f.store, admin, { op: 'add_size', name: 'Photo 4x6', widthMm: 102, heightMm: 152 }); assert.ok(r.ok && r.data.id === 'custom-photo-4x6');
  assert.equal(f.log.length, 1); assert.equal((await f.store.getCatalogue()).sizes.at(-1)!.enabled, false);
  for (const b of [{ name: '', widthMm: 100, heightMm: 100 }, { name: 'ok', widthMm: 10, heightMm: 100 }, { name: 'ok', widthMm: 100, heightMm: 99999 }, { name: 'ok', widthMm: 100.5, heightMm: 100 }, { name: '<script>', widthMm: 100, heightMm: 100 }, { name: 'a4', widthMm: 100, heightMm: 100 }, { name: ' PHOTO ', widthMm: 100, heightMm: 100 }])
    assert.ok(!validateAddSize({ op: 'add_size', ...b }, cat()).ok, JSON.stringify(b));
});
test('admin: enabling a size needs a real price and an active printer; nothing is invented', async () => {
  const c = cat();
  assert.match((await rejectedMsg(c, { op: 'set_size', id: 'a5', enabled: true })).error, /Set a price/);
  assert.match((await rejectedMsg(c, { op: 'set_size', id: 'a5', enabled: true, bwRupees: 4 })).error, /printer that supports A5/);
  const f = adminStore(c); assert.ok((await catalogueAction(f.store, admin, { op: 'save_printer', name: 'Small', active: true, supportsColour: false, supportsDuplex: false, paperSizeIds: ['a5'] })).ok);
  assert.ok((await catalogueAction(f.store, admin, { op: 'set_size', id: 'a5', enabled: true, bwRupees: 4.5 })).ok);
  assert.equal(c.prices.a5.bw, 450); assert.equal(c.prices.a5.c, undefined, 'colour price stays unset'); assert.equal(checkOrderable(c, 'a5', 'c', 1).ok, false); assert.ok(checkOrderable(c, 'a5', 'bw', 1).ok);
  for (const b of [{ bwRupees: 0 }, { bwRupees: -1 }, { bwRupees: 1.234 }, { bwRupees: 'free' }, { colourRupees: 1e6 }, {}]) assert.ok(!validateSetSize({ op: 'set_size', id: 'a4', ...b }, c).ok, JSON.stringify(b));
  assert.ok(!validateSetSize({ op: 'set_size', id: 'zzz', enabled: true }, c).ok);
});
test('admin: the last enabled size cannot be disabled; price changes on enabled sizes are fine', async () => {
  const c = cat(); c.sizes = c.sizes.filter(s => s.id === 'a4'); c.printers = [c.printers[0]];
  assert.match((await rejectedMsg(c, { op: 'set_size', id: 'a4', enabled: false })).error, /At least one/);
  assert.ok((await catalogueAction(adminStore(c).store, admin, { op: 'set_size', id: 'a4', bwRupees: 2.5, colourRupees: 10 })).ok); assert.deepEqual(c.prices.a4, { bw: 250, c: 1000 });
});
test('admin: printers — add/update with capabilities and sizes; bad input refused', async () => {
  const c = cat(), f = adminStore(c);
  const add = await catalogueAction(f.store, admin, { op: 'save_printer', name: 'Plotter', active: true, supportsColour: true, supportsDuplex: false, paperSizeIds: ['a3', 'a3'] }); assert.ok(add.ok && add.data.id);
  assert.deepEqual(c.printers.at(-1)!.paperSizeIds, ['a3'], 'duplicates removed'); assert.ok(checkOrderable(c, 'a3', 'c', 1).ok, 'a new colour printer makes A3 colour orderable at the existing A3 colour price');
  const upd = await catalogueAction(f.store, admin, { op: 'save_printer', id: '30000000-0000-4000-8000-000000000002', name: 'Large', active: false, supportsColour: false, supportsDuplex: false, paperSizeIds: ['a3'] }); assert.ok(upd.ok);
  for (const b of [{ name: '' }, { name: 'Main' }, { name: 'main' }, { paperSizeIds: [] }, { paperSizeIds: ['bogus'] }, { paperSizeIds: 'a4' }, { active: 'yes' }, { id: 'not-a-uuid' }, { id: '10000000-0000-4000-8000-000000000001' }])
    assert.ok(!validateSavePrinter({ op: 'save_printer', name: 'New one', active: true, supportsColour: false, supportsDuplex: false, paperSizeIds: ['a4'], ...b }, cat()).ok, JSON.stringify(b));
  assert.ok(validateSavePrinter({ id: 'x', name: 'Spare 2', active: false, supportsColour: false, supportsDuplex: false, paperSizeIds: [] }, cat()).ok === false);   // unknown id (not a uuid)
  assert.ok(validateSavePrinter({ name: 'Parked', active: false, supportsColour: false, supportsDuplex: false, paperSizeIds: [] }, cat()).ok, 'an inactive printer may have no sizes');
});
test('admin: refused before migration 0005; unknown action refused; view returns warnings', async () => {
  const f = adminStore({ ...cat(), fromDatabase: false }); const r = await catalogueAction(f.store, admin, { op: 'add_size', name: 'X', widthMm: 50, heightMm: 50 }); assert.ok(!r.ok && r.status === 503 && /0005/.test(r.error));
  assert.equal(((await catalogueAction(adminStore(cat()).store, admin, { op: 'drop_tables' })) as any).status, 400);
  const v = await catalogueView(adminStore(cat()).store); assert.ok(v.ok && v.data.ready && v.data.warnings.length > 0);
});
const backend: AuthBackend = { async getUser(t) { return t === 'admin' ? { id: 'a', email: 'a@x.com' } : t === 'cust' ? { id: 'c', email: 'c@x.com' } : null; }, async isAdmin(id) { return id === 'a'; }, async refresh() { return null; } };
test('catalogue endpoint authorization: 401 anonymous/forged, 403 customer, admin only; edits need same-origin', async () => {
  const R = (m: string, cookie: string | null, origin?: string) => new Request('https://shop.example/api/admin/catalogue', { method: m, headers: { host: 'shop.example', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
  const code = async (r: Request, w: boolean) => { const g = await guardWith(backend, r, w); return g.ok ? 200 : g.response.status; };
  assert.deepEqual([await code(R('GET', null), false), await code(R('GET', 'hps_at=forged'), false), await code(R('GET', 'hps_at=cust'), false), await code(R('GET', 'hps_at=admin'), false)], [401, 401, 403, 200]);
  assert.deepEqual([await code(R('PUT', null, 'https://shop.example'), true), await code(R('PUT', 'hps_at=cust', 'https://shop.example'), true), await code(R('PUT', 'hps_at=admin', 'https://shop.example'), true), await code(R('PUT', 'hps_at=admin', 'https://evil.example'), true), await code(R('PUT', 'hps_at=admin'), true)], [401, 403, 200, 403, 403]);
});

// ---------- queue + job sheet ----------
const item = (o: Partial<AdminItem> = {}): AdminItem => ({ id: '20000000-0000-4000-8000-000000000001', originalName: 'poster.pdf', totalPages: 4, pageRange: null, copies: 1, colorMode: 'bw', sides: 1, paperSize: 'A3', paperSizeId: 'a3', paperWidthMm: 297, paperHeightMm: 420, orientation: 'portrait', lineTotalPaise: 4000, hasFile: true, ...o });
let n = 0;
const order = (items: AdminItem[], o: Partial<AdminOrder> = {}): AdminOrder => { n++; return { id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, orderNumber: `HPS-C${String(n).padStart(7, '0')}`, customerName: 'Asha', phone: '9876543210', email: null, fulfilment: 'pickup', deliveryAddress: null, deliveryFeePaise: 0, instructions: null, paymentMethod: 'cash', paymentStatus: 'cash_pending', status: 'confirmed', subtotalPaise: 4000, totalPaise: 4000, cancelReason: null, createdAt: new Date(Date.UTC(2026, 9, 17, 4, n)).toISOString(), items, collection: null, ...o }; };
const Q = { stage: 'to_print', status: 'all', type: 'all', fulfilment: 'all', sort: 'next', dir: 'asc' } as const;
test('job sheet shows the customer\'s paper size and dimensions; non-A4 jobs are flagged; the sheet itself is always A4', () => {
  const a3 = buildJobSheet(order([item()])).items[0]; assert.deepEqual([a3.paper, a3.paperDims, a3.nonA4], ['A3', '297 × 420 mm', true]);
  const legacy = buildJobSheet(order([item({ paperSize: 'A4', paperSizeId: null, paperWidthMm: null, paperHeightMm: null })])).items[0]; assert.deepEqual([legacy.paper, legacy.paperDims, legacy.nonA4], ['A4', null, false]);
  const custom = buildJobSheet(order([item({ paperSize: 'Photo 4x6', paperSizeId: 'custom-photo-4x6', paperWidthMm: 102, paperHeightMm: 152 })])).items[0]; assert.deepEqual([custom.paper, custom.paperDims, custom.nonA4], ['Photo 4x6', '102 × 152 mm', true]);
  const css = readFileSync('src/app/globals.css', 'utf8'); assert.match(css, /@page\{size:A4;margin:10mm\}/); assert.doesNotMatch(css, /@page\{size:(A3|A5|Letter|Legal)/i);
});
test('queue rows show paper size, filter by it, and warn when no active printer can do the job', async () => {
  n = 0; const c = cat(); const a3 = order([item()]), a4 = order([item({ paperSize: 'A4', paperSizeId: 'a4', paperWidthMm: 210, paperHeightMm: 297 })]), photo = order([item({ paperSize: 'Photo', paperSizeId: 'custom-photo', paperWidthMm: 100, paperHeightMm: 150 })]);
  const q = buildQueue([a3, a4, photo], 0, Q, c); const by = (id: string) => q.rows.find(r => r.id === id)!;
  assert.deepEqual([by(a3.id).paper, by(a3.id).nonA4, by(a3.id).noPrinter], ['A3', true, false]); assert.deepEqual([by(a4.id).nonA4, by(a4.id).noPrinter], [false, false]); assert.equal(by(photo.id).noPrinter, true);
  assert.deepEqual(q.papers.map(p => p.id).sort(), ['a3', 'a4', 'custom-photo']);
  assert.deepEqual(buildQueue([a3, a4, photo], 0, { ...Q, paper: 'a3' }, c).rows.map(r => r.id), [a3.id]); assert.equal(buildQueue([a3, a4], 0, { ...Q, paper: 'a5' }, c).rows.length, 0);
  assert.ok(parseQueueQuery(new URLSearchParams('paper=a3')).ok); assert.ok(parseQueueQuery(new URLSearchParams('paper=custom-photo')).ok); for (const bad of ['paper=A3', 'paper=../x', 'paper=' + 'a'.repeat(50)]) assert.ok(!parseQueueQuery(new URLSearchParams(bad)).ok, bad);
  const store = { async listQueueCandidates() { return { orders: [a3, photo], awaitingConfirmation: 0 }; }, async getCatalogue() { return c; } } as unknown as AdminStore;
  const g = await getQueue(store, Q); assert.ok(g.ok && g.data.rows.find(r => r.id === photo.id)!.noPrinter && !g.data.rows.find(r => r.id === a3.id)!.noPrinter);
});

// ---------- catalogue loading: only "tables missing" may fall back; real failures must not ----------
const fakeDb = (r: Record<string, { data?: any[]; error?: { code?: string } }>) => ({ from: (t: string) => ({ select: async () => ({ data: r[t]?.data ?? null, error: r[t]?.error ?? null }) }) }) as any;
test('loadCatalogue: falls back only when the tables do not exist; a database failure throws instead of reverting to A4-only', async () => {
  const missing = { error: { code: '42P01' } };
  assert.equal(await loadCatalogue(fakeDb({ paper_sizes: missing, printers: missing, printer_paper_sizes: missing, paper_prices: missing })), null);
  assert.equal(await loadCatalogue(fakeDb({ paper_sizes: { data: [] }, printers: { data: [] }, printer_paper_sizes: { data: [] }, paper_prices: { data: [] } })), null);
  await assert.rejects(loadCatalogue(fakeDb({ paper_sizes: { error: { code: '57014' } }, printers: { data: [] }, printer_paper_sizes: { data: [] }, paper_prices: { data: [] } })), /unavailable/);
  await assert.rejects(loadCatalogue(fakeDb({ paper_sizes: { error: {} }, printers: { error: {} }, printer_paper_sizes: { error: {} }, paper_prices: { error: {} } })), /unavailable/);   // e.g. network down
  const ok = await loadCatalogue(fakeDb({ paper_sizes: { data: [{ id: 'a4', name: 'A4', width_mm: 210, height_mm: 297, is_custom: false, enabled: true, sort_order: 40 }] },
    printers: { data: [{ id: 'p', name: 'Main', active: true, supports_colour: true, supports_duplex: false }] }, printer_paper_sizes: { data: [{ printer_id: 'p', paper_size_id: 'a4' }] }, paper_prices: { data: [{ paper_size_id: 'a4', color_mode: 'bw', price_paise: 250 }] } }));
  assert.deepEqual([ok!.fromDatabase, ok!.prices.a4, ok!.printers[0].paperSizeIds, ok!.printers[0].supportsDuplex], [true, { bw: 250 }, ['a4'], false]);
  assert.equal(checkOrderable(ok!, 'a4', 'c', 1).ok, false, 'no colour price: colour not offered');
});
