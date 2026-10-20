import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from './admin-auth.ts';
import type { AuthBackend, Admin } from './admin-auth.ts';
import { guardWith, parseCookies, sameOrigin, sessionCookies } from './admin-http.ts';
import { changeStatus, collectCash, fileLink, saveSettings } from './admin-actions.ts';
import { validateSettings, parseOrderQuery, buildSettingRows, rowsToForm } from './admin-validation.ts';
import { canTransition, nextStatuses, STATUSES } from './order-status.ts';
import type { AdminStore, AdminOrder } from './admin-store.ts';
import { defaultCatalogue } from './catalogue.ts';

// ---------- fakes ----------
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CUST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const backend = (over: Partial<AuthBackend> = {}): AuthBackend => ({
  async getUser(t) { return t === 'admin-token' ? { id: ADMIN_ID, email: 'admin@x.com' } : t === 'cust-token' ? { id: CUST_ID, email: 'c@x.com' } : null; },
  async isAdmin(id) { return id === ADMIN_ID; },
  async refresh(rt) { return rt === 'good-rt' ? { accessToken: 'admin-token', refreshToken: 'rt2', expiresIn: 3600 } : null; }, ...over });
const req = (cookie: string | null, method = 'GET', origin: string | null = null) => new Request('https://shop.example/api/admin/stats', { method, headers: { host: 'shop.example', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
const admin: Admin = { id: ADMIN_ID, email: 'admin@x.com' };
const OID = '10000000-0000-4000-8000-000000000001', IID = '20000000-0000-4000-8000-000000000001';
const order = (o: Partial<AdminOrder> = {}): AdminOrder => ({ id: OID, orderNumber: 'HPS-TEST0001', customerName: 'A', phone: '9876543210', email: null, fulfilment: 'pickup', deliveryAddress: null, deliveryFeePaise: 0, instructions: null, paymentMethod: 'cash', paymentStatus: 'cash_pending', status: 'pending_confirmation', subtotalPaise: 1800, totalPaise: 1800, cancelReason: null, createdAt: '2026-10-16T00:00:00Z', items: [], collection: null, ...o });
function fakeStore(o: AdminOrder, settings: Record<string, any> = {}) {
  const log: any[] = []; let cur = { ...o }; const set: Record<string, any> = { ...settings };
  const store: AdminStore = {
    async listOrders() { return { orders: [cur], total: 1 }; }, async getOrder(id) { return id === cur.id ? { ...cur } : null; },
    async stats() { throw new Error('unused'); }, async listQueueCandidates() { return { orders: [cur], awaitingConfirmation: 0 }; }, async getCatalogue() { return defaultCatalogue({ bw_paise: 200, colour_paise: 900 }); }, async addPaperSize() { return 'ok' as const; }, async setPaperSize() { return 'ok' as const; }, async savePrinter() { return { result: 'ok' as const }; },
    async setStatus(id, expected, next, a, reason) { if (cur.status !== expected) return 'conflict'; cur.status = next; log.push(['status', expected, next, a.email, reason]); return 'ok'; },
    async collectCash(id, a, amt) { if (cur.collection) return 'duplicate'; cur.collection = { amountPaise: amt, collectedAt: 'now', collectedByEmail: a.email }; cur.paymentStatus = 'paid'; log.push(['cash', amt, a.email]); return 'ok'; },
    async getItemFile(id) { return id === IID ? { orderId: OID, storagePath: gone ? null : 'uploads/x.pdf', name: 'a.pdf' } : null; },
    async signedUrl(p, s, n) { return `https://signed.example/${p}?ttl=${s}${n ? '&dl=1' : ''}`; },
    async getSettings() { return set; }, async setSetting(k, v) { set[k] = v; log.push(['set', k]); return true; },
    async logEvent(a, action, e, id) { log.push(['event', action, id]); },
  }; let gone = false;
  return { store, log, get: () => cur, set, setGone: () => { gone = true; } };
}

// ---------- authentication & authorization ----------
test('no cookies → unauthenticated; garbage token → unauthenticated', async () => {
  assert.deepEqual(await authorize(backend(), {}, true), { ok: false, reason: 'unauthenticated' });
  assert.deepEqual(await authorize(backend(), { hps_at: 'forged' }, true), { ok: false, reason: 'unauthenticated' });
});
test('a valid Supabase user who is NOT on the admin allow-list is forbidden', async () => {
  assert.deepEqual(await authorize(backend(), { hps_at: 'cust-token' }, true), { ok: false, reason: 'forbidden' });
});
test('allow-listed admin is authorised', async () => { const r = await authorize(backend(), { hps_at: 'admin-token' }, true); assert.ok(r.ok && r.admin.email === 'admin@x.com'); });
test('expired access token: refresh issues new tokens only when allowed; layout mode reports expired', async () => {
  const r = await authorize(backend(), { hps_at: 'old', hps_rt: 'good-rt' }, true); assert.ok(r.ok && r.newTokens?.refreshToken === 'rt2');
  assert.deepEqual(await authorize(backend(), { hps_at: 'old', hps_rt: 'good-rt' }, false), { ok: false, reason: 'expired' });
  assert.deepEqual(await authorize(backend(), { hps_rt: 'bad-rt' }, true), { ok: false, reason: 'unauthenticated' });
});
test('a refreshed session of a non-admin is still forbidden', async () => {
  const b = backend({ async refresh() { return { accessToken: 'cust-token', refreshToken: 'r', expiresIn: 1 }; } });
  assert.deepEqual(await authorize(b, { hps_rt: 'x' }, true), { ok: false, reason: 'forbidden' });
});
test('backend failure fails closed (503), never open', async () => {
  const b = backend({ async isAdmin() { throw new Error('db down'); } });
  assert.deepEqual(await authorize(b, { hps_at: 'admin-token' }, true), { ok: false, reason: 'unavailable' });
  const g = await guardWith(b, req('hps_at=admin-token'), false); assert.ok(!g.ok && g.response.status === 503);
});
test('HTTP guard: 401 anonymous, 403 customer, 503 unconfigured, 200 admin', async () => {
  const st = async (g: Awaited<ReturnType<typeof guardWith>>) => g.ok ? 200 : g.response.status;
  assert.equal(await st(await guardWith(backend(), req(null), false)), 401);
  assert.equal(await st(await guardWith(backend(), req('hps_at=cust-token'), false)), 403);
  assert.equal(await st(await guardWith(null, req('hps_at=admin-token'), false)), 503);
  assert.equal(await st(await guardWith(backend(), req('hps_at=admin-token'), false)), 200);
});
test('CSRF: state-changing requests need a same-origin Origin header', async () => {
  const c = 'hps_at=admin-token';
  for (const origin of [null, 'https://evil.example', 'not a url']) { const g = await guardWith(backend(), req(c, 'POST', origin), true); assert.ok(!g.ok && g.response.status === 403, String(origin)); }
  assert.ok((await guardWith(backend(), req(c, 'POST', 'https://shop.example'), true)).ok);
  assert.equal(sameOrigin(req(c, 'POST', 'https://shop.example')), true);
});
test('unauthenticated response clears cookies; session cookies are HttpOnly + Strict (+Secure)', async () => {
  const g = await guardWith(backend(), req('hps_at=forged'), false); assert.ok(!g.ok && /Max-Age=0/.test(g.response.headers.get('set-cookie') ?? ''));
  const c = sessionCookies({ accessToken: 'a', refreshToken: 'b', expiresIn: 3600 }, true); assert.ok(c.every(x => /HttpOnly/.test(x) && /SameSite=Strict/.test(x) && /Secure/.test(x)));
  assert.deepEqual(parseCookies('a=1; hps_at=x%20y'), { a: '1', hps_at: 'x y' });
});

// ---------- order status ----------
test('status machine: only forward steps; handover depends on fulfilment; terminals are final', () => {
  assert.deepEqual(nextStatuses('printing', 'pickup'), ['ready_for_pickup', 'cancelled']);
  assert.deepEqual(nextStatuses('printing', 'delivery'), ['out_for_delivery', 'cancelled']);
  assert.equal(canTransition('pending_confirmation', 'printing', 'pickup'), false);
  assert.equal(canTransition('completed', 'cancelled', 'pickup'), false);
  for (const s of STATUSES) assert.equal(canTransition(s, s, 'pickup'), false);
});
test('status change: valid step recorded; skipping, unknown, stale all refused', async () => {
  const f = fakeStore(order());
  assert.ok((await changeStatus(f.store, admin, OID, { to: 'confirmed', expectedStatus: 'pending_confirmation' })).ok);
  assert.equal(f.get().status, 'confirmed'); assert.deepEqual(f.log[0].slice(0, 4), ['status', 'pending_confirmation', 'confirmed', 'admin@x.com']);
  const skip = await changeStatus(f.store, admin, OID, { to: 'completed', expectedStatus: 'confirmed' }); assert.ok(!skip.ok && skip.status === 422);
  const stale = await changeStatus(f.store, admin, OID, { to: 'preparing', expectedStatus: 'pending_confirmation' }); assert.ok(!stale.ok && stale.status === 409 && stale.code === 'STALE');
  assert.ok(!(await changeStatus(f.store, admin, OID, { to: 'bogus', expectedStatus: 'confirmed' })).ok);
  assert.ok(!(await changeStatus(f.store, admin, 'not-a-uuid', { to: 'preparing', expectedStatus: 'confirmed' })).ok);
  assert.equal((await changeStatus(f.store, admin, '30000000-0000-4000-8000-000000000009', { to: 'preparing', expectedStatus: 'confirmed' }) as any).status, 404);
});
test('cancel needs a reason and is refused for paid orders', async () => {
  const f = fakeStore(order({ status: 'printing' }));
  assert.ok(!(await changeStatus(f.store, admin, OID, { to: 'cancelled', expectedStatus: 'printing' })).ok);
  assert.ok(!(await changeStatus(f.store, admin, OID, { to: 'cancelled', expectedStatus: 'printing', reason: 'x' })).ok);
  assert.ok((await changeStatus(f.store, admin, OID, { to: 'cancelled', expectedStatus: 'printing', reason: 'Customer asked' })).ok);
  assert.equal(f.log[0][4], 'Customer asked');
  const paid = fakeStore(order({ status: 'ready_for_pickup', paymentStatus: 'paid', collection: { amountPaise: 1800, collectedAt: 'x', collectedByEmail: 'a' } }));
  assert.ok(!(await changeStatus(paid.store, admin, OID, { to: 'cancelled', expectedStatus: 'ready_for_pickup', reason: 'changed mind' })).ok);
});
test('an order cannot be completed until cash has been collected', async () => {
  const f = fakeStore(order({ status: 'ready_for_pickup' }));
  const r = await changeStatus(f.store, admin, OID, { to: 'completed', expectedStatus: 'ready_for_pickup' }); assert.ok(!r.ok && /cash collection/.test(r.error));
  assert.ok((await collectCash(f.store, admin, OID, { amountPaise: 1800 })).ok);
  assert.ok((await changeStatus(f.store, admin, OID, { to: 'completed', expectedStatus: 'ready_for_pickup' })).ok);
});

// ---------- cash collection ----------
test('cash: only at handover, exact amount, once; records who and how much', async () => {
  const early = fakeStore(order({ status: 'printing' })); assert.ok(!(await collectCash(early.store, admin, OID, { amountPaise: 1800 })).ok);
  const f = fakeStore(order({ status: 'out_for_delivery', fulfilment: 'delivery' }));
  assert.ok(!(await collectCash(f.store, admin, OID, { amountPaise: 1700 })).ok, 'wrong amount');
  assert.ok(!(await collectCash(f.store, admin, OID, { amountPaise: '1800' })).ok, 'non-integer');
  assert.ok((await collectCash(f.store, admin, OID, { amountPaise: 1800, note: 'paid in 100s' })).ok);
  assert.deepEqual(f.get().collection && { a: f.get().collection!.amountPaise, by: f.get().collection!.collectedByEmail }, { a: 1800, by: 'admin@x.com' });
  const dup = await collectCash(f.store, admin, OID, { amountPaise: 1800 }); assert.ok(!dup.ok && dup.status === 409 && dup.code === 'DUPLICATE');
  assert.equal(f.log.filter(l => l[0] === 'cash').length, 1);
  assert.ok(!(await collectCash(fakeStore(order({ status: 'cancelled' })).store, admin, OID, { amountPaise: 1800 })).ok);
  assert.ok(!(await collectCash(fakeStore(order({ paymentMethod: 'razorpay', status: 'ready_for_pickup' })).store, admin, OID, { amountPaise: 1800 })).ok);
});

// ---------- files ----------
test('files: 60-second signed link, audited; deleted files report 410; unknown 404; bad id 400', async () => {
  const f = fakeStore(order());
  const v = await fileLink(f.store, admin, IID, 'view'); assert.ok(v.ok && v.data.expiresInSeconds === 60 && /ttl=60/.test(v.data.url) && !/dl=1/.test(v.data.url));
  const d = await fileLink(f.store, admin, IID, 'download'); assert.ok(d.ok && /dl=1/.test(d.data.url));
  assert.deepEqual(f.log.map(l => l[1]), ['file.viewed', 'file.downloaded']);
  assert.equal((await fileLink(f.store, admin, '40000000-0000-4000-8000-000000000001', null) as any).status, 404);
  assert.equal((await fileLink(f.store, admin, 'x', null) as any).status, 400);
  f.setGone(); assert.equal((await fileLink(f.store, admin, IID, null) as any).status, 410);
});

// ---------- settings ----------
const good = { bwRupees: 2, colourRupees: 9, deliveryEnabled: true, deliveryFeeRupees: 30, minOrderRupees: 20, radiusKm: 5, pickupEnabled: true, cashEnabled: true, maxMb: 25, retentionDays: 7 };
test('settings validation rejects bad rates, fees, limits and unusable combinations', () => {
  assert.ok(validateSettings(good).ok);
  for (const [k, v] of Object.entries({ bwRupees: 0, colourRupees: -1, deliveryFeeRupees: 'free', minOrderRupees: 1e9, radiusKm: 0, maxMb: 26, retentionDays: 0, cashEnabled: false }))
    assert.ok(!validateSettings({ ...good, [k]: v }).ok, k);
  assert.ok(!validateSettings({ ...good, bwRupees: 2.555 }).ok, 'more than 2 decimals');
  assert.ok(!validateSettings({ ...good, pickupEnabled: false, deliveryEnabled: false }).ok);
  assert.ok(!validateSettings({ ...good, maxMb: 10.5 }).ok);
  assert.ok(validateSettings({ ...good, radiusKm: null }).ok);
  assert.ok(!validateSettings(null).ok);
});
test('settings save: paise conversion, online payment forced off, only changed keys written, audited path used', async () => {
  const f = fakeStore(order(), { pricing: { bw_paise: 200, colour_paise: 900 }, payments: { cash_enabled: true, online_enabled: true }, delivery: { enabled: false, fee_paise: 0, note: 'keep me' } });
  const r = await saveSettings(f.store, admin, { ...good, bwRupees: 2.5 }); assert.ok(r.ok);
  assert.equal(f.set.pricing.bw_paise, 250); assert.equal(f.set.delivery.fee_paise, 3000); assert.equal(f.set.delivery.note, 'keep me'); assert.equal(f.set.payments.online_enabled, false);
  const again = await saveSettings(f.store, admin, { ...good, bwRupees: 2.5 }); assert.ok(again.ok && again.data.changed.length === 0);
  const before = f.log.length; assert.ok(!(await saveSettings(f.store, admin, { ...good, colourRupees: -5 })).ok); assert.equal(f.log.length, before, 'invalid input writes nothing');
  assert.equal(rowsToForm(buildSettingRows(f.set, validateSettings(good).ok ? (validateSettings(good) as any).value : null)).bwRupees, 2);
});
test('order list filters are whitelisted; search text cannot inject filter syntax', () => {
  const p = (s: string) => parseOrderQuery(new URLSearchParams(s));
  const inj = p('q=a),status.eq.completed,(b'); assert.ok(inj.ok && inj.value.q === 'astatuseqcompletedb' || (inj.ok && !/[(),.]/.test(inj.value.q)));
  assert.ok(!p('status=hacked').ok); assert.ok(!p('payment=x').ok); assert.ok(!p('from=yesterday').ok);
  const ok = p('status=printing&payment=cash_pending&fulfilment=delivery&from=2026-10-01&page=-4'); assert.ok(ok.ok && ok.value.page === 1);
});
