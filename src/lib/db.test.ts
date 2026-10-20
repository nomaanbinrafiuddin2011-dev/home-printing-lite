// Runs the real migrations on an embedded Postgres (PGlite) with Supabase's `auth` and `storage` schemas stubbed.
// This verifies SQL, RLS, grants, triggers and functions. It is NOT a test against a live Supabase project.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CUST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const O1 = '10000000-0000-4000-8000-000000000001', O2 = '10000000-0000-4000-8000-000000000002';
const as = async (role: string, sub?: string) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']); await db.exec(`set role ${role}`); };
const rejects = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  for (const f of ['0001_init', '0002_uploads', '0003_admin', '0004_queue', '0005_catalogue']) await db.exec(readFileSync(`supabase/migrations/${f}.sql`, 'utf8').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(`grant all on all tables in schema public to service_role; grant select on all tables in schema public to anon, authenticated;`.replace('grant select on all tables in schema public to anon, authenticated;', ''));
  await db.exec(`
    insert into auth.users values ('${ADMIN}','admin@example.com'), ('${CUST}','cust@example.com');
    insert into public.admin_users (user_id) values ('${ADMIN}');
    insert into public.orders (id, order_number, customer_name, phone, fulfilment, payment_method, payment_status, status, subtotal_paise, total_paise) values
      ('${O1}','HPS-AAAAAAA1','A','9876543210','pickup','cash','cash_pending','ready_for_pickup',1800,1800),
      ('${O2}','HPS-AAAAAAA2','B','9876543211','pickup','cash','cash_pending','printing',1800,1800);`);
});

test('anonymous users cannot read or write orders, uploads, audit logs, cash records', async () => {
  await as('anon');
  for (const t of ['orders', 'order_items', 'uploads', 'audit_logs', 'cash_collections', 'admin_users', 'webhook_events']) {
    try { const r = await db.query(`select * from public.${t}`); assert.equal(r.rows.length, 0, t); } catch (e) { assert.match(String(e), /permission denied/, t); }
  }
  await rejects(db.exec(`update public.orders set status='completed'`), /permission denied/);
  await rejects(db.exec(`insert into public.orders (order_number, customer_name, phone, fulfilment, payment_method, subtotal_paise, total_paise) values ('X','x','1','pickup','cash',1,1)`), /permission denied/);
});
test('anonymous users see only public settings (never retention)', async () => {
  await as('anon'); const r = await db.query<{ key: string }>(`select key from public.settings`);
  assert.ok(r.rows.length > 0 && !r.rows.some(x => x.key === 'retention'));
});
test('a logged-in NON-admin customer sees no orders and cannot write', async () => {
  await as('authenticated', CUST);
  assert.equal((await db.query(`select * from public.orders`)).rows.length, 0);
  assert.equal((await db.query(`select * from public.cash_collections`)).rows.length, 0);
  await rejects(db.exec(`update public.orders set status='completed'`), /permission denied/);
});
test('an admin session can READ orders but cannot write tables directly', async () => {
  await as('authenticated', ADMIN);
  assert.equal((await db.query(`select * from public.orders`)).rows.length, 2);
  await rejects(db.exec(`update public.orders set payment_status='paid'`), /permission denied/);
  await rejects(db.exec(`update public.settings set value='{"bw_paise":1,"colour_paise":1}' where key='pricing'`), /permission denied/);
  await rejects(db.exec(`insert into public.audit_logs (action) values ('forged')`), /permission denied/);
});
test('browser roles cannot execute the admin functions; only service_role can', async () => {
  for (const role of ['anon', 'authenticated']) {
    await as(role, ADMIN);
    await rejects(db.query(`select public.admin_record_cash('${O1}','${ADMIN}','a@b.c',1800,null)`), /permission denied/);
    await rejects(db.query(`select public.admin_set_order_status('${O1}','ready_for_pickup','completed','${ADMIN}','a@b.c',null)`), /permission denied/);
    await rejects(db.query(`select public.admin_set_setting('pricing','{}'::jsonb,'${ADMIN}','a@b.c')`), /permission denied/);
  }
});
test('cash collection: validation, single record, paid only after collection, audited', async () => {
  await as('service_role');
  const cash = async (o: string, amt: number) => (await db.query<{ r: string }>(`select public.admin_record_cash('${o}','${ADMIN}','admin@example.com',${amt},'note') as r`)).rows[0].r;
  assert.equal(await cash(O2, 1800), 'invalid', 'order still printing');
  assert.equal(await cash(O1, 100), 'invalid', 'wrong amount');
  assert.equal(await cash('10000000-0000-4000-8000-0000000000ff', 1800), 'not_found');
  assert.equal(await cash(O1, 1800), 'ok');
  assert.equal(await cash(O1, 1800), 'duplicate');
  await db.exec('reset role');
  const o = (await db.query<{ payment_status: string }>(`select payment_status from public.orders where id='${O1}'`)).rows[0]; assert.equal(o.payment_status, 'paid');
  const c = (await db.query<{ n: number; by: string }>(`select count(*)::int n, max(collected_by_email) by from public.cash_collections where order_id='${O1}'`)).rows[0]; assert.deepEqual(c, { n: 1, by: 'admin@example.com' });
  assert.equal((await db.query(`select 1 from public.audit_logs where action='order.cash_collected' and entity_id='${O1}'`)).rows.length, 1);
});
test('DB trigger blocks marking a cash order paid without a collection record, even for privileged roles', async () => {
  await db.exec('reset role');
  await rejects(db.exec(`update public.orders set payment_status='paid' where id='${O2}'`), /without a cash collection record/);
  await rejects(db.exec(`update public.orders set payment_status='cash_pending' where id='${O1}'`), /cannot be moved back/);
});
test('status change function: optimistic check, audit entry, cancel reason stored', async () => {
  await as('service_role');
  const st = async (e: string, n: string, r: string | null = null) => (await db.query<{ r: string }>(`select public.admin_set_order_status('${O2}','${e}','${n}','${ADMIN}','admin@example.com',$1) as r`, [r])).rows[0].r;
  assert.equal(await st('confirmed', 'preparing'), 'conflict');
  assert.equal(await st('printing', 'cancelled', 'Customer asked'), 'ok');
  await db.exec('reset role');
  assert.equal((await db.query<{ cancel_reason: string }>(`select cancel_reason from public.orders where id='${O2}'`)).rows[0].cancel_reason, 'Customer asked');
  assert.equal((await db.query(`select 1 from public.audit_logs where action='order.status_changed' and entity_id='${O2}'`)).rows.length, 1);
});
test('settings function: audited with before/after; unknown keys refused', async () => {
  await as('service_role');
  await db.query(`select public.admin_set_setting('pricing','{"bw_paise":300,"colour_paise":1000}'::jsonb,'${ADMIN}','admin@example.com')`);
  await rejects(db.query(`select public.admin_set_setting('evil','{}'::jsonb,'${ADMIN}','a@b.c')`), /unknown setting key/);
  await db.exec('reset role');
  const a = (await db.query<{ detail: any }>(`select detail from public.audit_logs where action='setting.changed'`)).rows[0].detail;
  assert.equal(a.before.bw_paise, 200); assert.equal(a.after.bw_paise, 300);
});
test('audit log is append-only', async () => {
  await db.exec('reset role');
  await rejects(db.exec(`update public.audit_logs set action='x'`), /append-only/);
  await rejects(db.exec(`delete from public.audit_logs`), /append-only/);
});

test('DB status guard: only valid moves, fulfilment-aware, completion needs payment (even for privileged roles)', async () => {
  await db.exec('reset role');
  const mk = (id: string, num: string, ful: string, st: string, pay = 'cash_pending') => db.exec(`insert into public.orders (id, order_number, customer_name, phone, fulfilment, payment_method, payment_status, status, subtotal_paise, total_paise, delivery_address) values ('${id}','${num}','Z','9876543212','${ful}','cash','${pay}','${st}',500,500, ${ful === 'delivery' ? "'12-3 Some Road, Hyderabad'" : 'null'})`);
  const A = '10000000-0000-4000-8000-0000000000a1', B = '10000000-0000-4000-8000-0000000000b1', C = '10000000-0000-4000-8000-0000000000c1';
  await mk(A, 'HPS-GUARD001', 'pickup', 'confirmed'); await mk(B, 'HPS-GUARD002', 'delivery', 'printing'); await mk(C, 'HPS-GUARD003', 'pickup', 'ready_for_pickup');
  const up = (id: string, st: string) => db.exec(`update public.orders set status='${st}' where id='${id}'`);
  await rejects(up(A, 'printing'), /invalid order status change/);            // skips "preparing"
  await rejects(up(A, 'completed'), /invalid order status change/);
  await up(A, 'preparing'); await up(A, 'printing'); await up(A, 'ready_for_pickup');
  await rejects(up(B, 'ready_for_pickup'), /invalid order status change/);    // delivery order cannot be "ready for pickup"
  await up(B, 'out_for_delivery');
  await rejects(up(C, 'completed'), /before payment is recorded/);            // unpaid cash order
  await rejects(up(C, 'printing'), /invalid order status change/);            // no going backwards
  await as('service_role');
  const r = await db.query<{ r: string }>(`select public.admin_record_cash('${C}','${ADMIN}','admin@example.com',500,null) as r`); assert.equal(r.rows[0].r, 'ok');
  await db.exec('reset role'); await up(C, 'completed');
  await rejects(up(C, 'cancelled'), /invalid order status change/);           // terminal
});
