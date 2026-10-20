// Real Postgres (PGlite) with Supabase auth/storage stubbed. Not a live Supabase test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', CUST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sql = (f: string) => readFileSync(`supabase/migrations/${f}.sql`, 'utf8').replace('create extension if not exists pgcrypto;', '');
async function boot(files: string[]) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  for (const f of files) await db.exec(sql(f));
  return db;
}
const ALL = ['0001_init', '0002_uploads', '0003_admin', '0004_queue', '0005_catalogue'];
const as = async (db: PGlite, role: string, sub?: string) => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']); await db.exec(`set role ${role}`); };
const one = async <T>(db: PGlite, q: string) => (await db.query<T>(q)).rows[0];

test('UPGRADE: existing A4 rates and existing orders are preserved; nothing else is priced or enabled', async () => {
  const db = await boot(ALL.slice(0, 4));
  await db.exec(`update public.settings set value='{"bw_paise":250,"colour_paise":950}' where key='pricing';
    insert into public.orders (id, order_number, customer_name, phone, fulfilment, payment_method, subtotal_paise, total_paise) values ('10000000-0000-4000-8000-000000000001','HPS-OLD00001','Old','9876543210','pickup','cash',500,500);
    insert into public.order_items (order_id, original_name, mime_type, size_bytes, total_pages, copies, color_mode, sides, line_total_paise) values ('10000000-0000-4000-8000-000000000001','old.pdf','application/pdf',10,2,1,'bw',1,500);`);
  await db.exec(sql(ALL[4]));
  const prices = (await db.query<{ k: string; p: number }>(`select paper_size_id||':'||color_mode k, price_paise p from public.paper_prices order by 1`)).rows;
  assert.deepEqual(prices, [{ k: 'a4:bw', p: 250 }, { k: 'a4:c', p: 950 }], 'only A4 is priced, with your existing rates');
  const sizes = (await db.query<{ id: string; enabled: boolean }>(`select id, enabled from public.paper_sizes order by id`)).rows;
  assert.deepEqual(sizes.filter(s => s.enabled).map(s => s.id), ['a4']);
  assert.deepEqual(sizes.map(s => s.id), ['a3', 'a4', 'a5', 'legal', 'letter']);
  const it = await one<any>(db, `select paper_size, paper_size_id, paper_width_mm, paper_height_mm from public.order_items`);
  assert.deepEqual(it, { paper_size: 'A4', paper_size_id: 'a4', paper_width_mm: 210, paper_height_mm: 297 }, 'old orders backfilled');
  const pr = await one<any>(db, `select p.name, p.supports_colour, p.supports_duplex, (select array_agg(paper_size_id) from public.printer_paper_sizes where printer_id=p.id) sizes from public.printers p`);
  assert.deepEqual(pr, { name: 'Main printer', supports_colour: true, supports_duplex: true, sizes: ['a4'] });
});

test('permissions: customers/anon see nothing; admins can read but not write; browser roles cannot call catalogue functions', async () => {
  const db = await boot(ALL);
  await db.exec(`insert into auth.users values ('${ADMIN}','a@x.com'), ('${CUST}','c@x.com'); insert into public.admin_users values ('${ADMIN}');`);
  for (const t of ['paper_sizes', 'paper_prices', 'printers', 'printer_paper_sizes']) {
    await as(db, 'anon'); assert.equal((await db.query(`select * from public.${t}`)).rows.length, 0, 'anon ' + t);
    await as(db, 'authenticated', CUST); assert.equal((await db.query(`select * from public.${t}`)).rows.length, 0, 'customer ' + t);
    await as(db, 'authenticated', ADMIN); assert.ok((await db.query(`select * from public.${t}`)).rows.length > 0, 'admin reads ' + t);
    await assert.rejects(db.exec(`insert into public.${t} select * from public.${t} limit 0`).then(() => db.exec(`delete from public.${t}`)), /permission denied/, 'admin cannot write ' + t);
  }
  await assert.rejects(db.exec(`update public.paper_prices set price_paise = 1`), /permission denied/);
  for (const role of ['anon', 'authenticated']) { await as(db, role, ADMIN);
    await assert.rejects(db.query(`select public.admin_set_paper_size('a4', null, 1, 1, '${ADMIN}', 'x')`), /permission denied/);
    await assert.rejects(db.query(`select public.admin_save_printer(null, 'X', true, true, true, array['a4'], '${ADMIN}', 'x')`), /permission denied/);
    await assert.rejects(db.query(`select public.admin_add_paper_size('custom-x', 'X', 100, 100, '${ADMIN}', 'x')`), /permission denied/); }
});

test('catalogue functions: guarded enabling, custom sizes, printers, A4 mirror, audit trail', async () => {
  const db = await boot(ALL); await db.exec(`insert into auth.users values ('${ADMIN}','admin@x.com')`); await as(db, 'service_role');
  const r = async (q: string) => (await db.query<{ r: any }>(`select ${q} as r`)).rows[0].r;
  const A = `'${ADMIN}', 'admin@x.com'`;
  assert.equal(await r(`public.admin_set_paper_size('a3', true, null, null, ${A})`), 'no_price');
  assert.equal(await r(`public.admin_set_paper_size('a3', true, 1000, 4000, ${A})`), 'no_printer');
  assert.equal((await one<any>(db, `select count(*)::int n from public.paper_prices where paper_size_id='a3'`)).n, 0, 'refused enabling wrote no prices');
  const p = await r(`public.admin_save_printer(null, 'Large format', true, true, false, array['a3'], ${A})`); assert.equal(p.result, 'ok');
  assert.equal(await r(`public.admin_set_paper_size('a3', true, 1000, 4000, ${A})`), 'ok');
  assert.equal((await one<any>(db, `select enabled from public.paper_sizes where id='a3'`)).enabled, true);
  assert.equal((await r(`public.admin_save_printer(null, 'large FORMAT', true, true, false, array['a3'], ${A})`)).result, 'duplicate');
  assert.equal((await r(`public.admin_save_printer(null, 'Bad', true, true, false, array['nope'], ${A})`)).result, 'invalid');
  assert.equal((await r(`public.admin_save_printer('${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}', 'X', true, true, false, array['a3'], ${A})`)).result, 'not_found');
  assert.equal((await r(`public.admin_save_printer('${p.id}', 'Large format', false, true, false, array['a3','a4'], ${A})`)).result, 'ok');
  assert.deepEqual((await db.query(`select paper_size_id from public.printer_paper_sizes where printer_id='${p.id}' order by 1`)).rows, [{ paper_size_id: 'a3' }, { paper_size_id: 'a4' }]);
  assert.equal(await r(`public.admin_add_paper_size('custom-banner-900x300', 'Banner 900x300', 900, 300, ${A})`), 'ok');
  assert.equal(await r(`public.admin_add_paper_size('custom-banner-2', 'banner 900X300', 900, 300, ${A})`), 'duplicate', 'name unique ignoring case');
  assert.equal((await one<any>(db, `select enabled, is_custom from public.paper_sizes where id='custom-banner-900x300'`)).enabled, false, 'new custom sizes start disabled');
  assert.equal(await r(`public.admin_set_paper_size('a4', null, 300, null, ${A})`), 'ok');
  assert.equal((await one<any>(db, `select value->>'bw_paise' v from public.settings where key='pricing'`)).v, '300', 'A4 price mirrored to the legacy setting');
  await db.query(`select public.admin_set_setting('pricing', '{"bw_paise":350,"colour_paise":1000}'::jsonb, ${A})`);
  assert.deepEqual((await db.query(`select price_paise from public.paper_prices where paper_size_id='a4' order by color_mode`)).rows, [{ price_paise: 350 }, { price_paise: 1000 }], 'legacy settings edit mirrored into A4 prices');
  assert.equal(await r(`public.admin_set_paper_size('a3', false, null, null, ${A})`), 'ok');
  assert.equal(await r(`public.admin_set_paper_size('a4', false, null, null, ${A})`), 'last_size', 'cannot disable the last enabled size');
  assert.equal(await r(`public.admin_set_paper_size('zzz', true, 1, 1, ${A})`), 'not_found');
  await db.exec('reset role');
  const acts = (await db.query<{ action: string }>(`select distinct action from public.audit_logs`)).rows.map(x => x.action).sort();
  for (const a of ['paper_size.added', 'paper_size.updated', 'printer.added', 'printer.updated', 'setting.changed']) assert.ok(acts.includes(a), a);
});
