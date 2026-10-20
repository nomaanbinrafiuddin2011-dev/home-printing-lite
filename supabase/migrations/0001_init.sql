-- Home Printing Service: initial schema. Money is stored in paise (integers).
create extension if not exists pgcrypto;

create table public.admin_users (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;

create table public.settings (key text primary key, value jsonb not null, is_public boolean not null default false, updated_at timestamptz not null default now());
insert into public.settings (key, value, is_public) values
 ('pricing',  '{"bw_paise":200,"colour_paise":900}', true),
 ('delivery', '{"enabled":false,"fee_paise":0,"min_order_paise":0,"radius_km":null,"note":"Admin must configure before enabling"}', true),
 ('fulfilment', '{"pickup_enabled":true}', true),
 ('files', '{"max_mb":25,"allowed":["application/pdf","image/jpeg","image/png"]}', true),
 ('payments', '{"cash_enabled":true,"online_enabled":false}', true),
 ('retention', '{"delete_files_after_days":7}', false)
on conflict do nothing;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  idempotency_key text unique,
  customer_name text not null, phone text not null, email text,
  fulfilment text not null check (fulfilment in ('pickup','delivery')),
  delivery_address text,
  delivery_fee_paise integer not null default 0 check (delivery_fee_paise >= 0),
  instructions text,
  payment_method text not null check (payment_method in ('razorpay','cash')),
  payment_status text not null default 'pending' check (payment_status in ('pending','cash_pending','paid','failed','refund_pending','refunded')),
  status text not null default 'pending_confirmation' check (status in ('pending_confirmation','confirmed','preparing','printing','ready_for_pickup','out_for_delivery','completed','cancelled')),
  subtotal_paise integer not null check (subtotal_paise >= 0),
  total_paise integer not null check (total_paise >= 0),
  razorpay_order_id text unique, razorpay_payment_id text unique,
  internal_notes text, cancel_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (fulfilment <> 'delivery' or delivery_address is not null)
);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_phone_idx on public.orders (phone);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  storage_path text, original_name text not null, mime_type text not null, size_bytes bigint not null,
  total_pages integer not null check (total_pages > 0), page_range text,
  copies integer not null check (copies between 1 and 500),
  color_mode text not null check (color_mode in ('bw','c')),
  sides smallint not null check (sides in (1,2)),
  paper_size text not null default 'A4', orientation text not null default 'portrait',
  line_total_paise integer not null check (line_total_paise >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.audit_logs (id bigserial primary key, actor uuid, action text not null, entity text, entity_id text, detail jsonb, created_at timestamptz not null default now());
create table public.webhook_events (event_id text primary key, provider text not null, received_at timestamptz not null default now());

-- Row Level Security: default deny. Customers have NO direct table access; the server (service role) mediates
-- customer order creation and tracking after verification. Only admins can read/write via the browser client.
alter table public.admin_users enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_events enable row level security;

create policy "public reads public settings" on public.settings for select using (is_public);
create policy "admin all settings" on public.settings for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
create policy "admin all order_items" on public.order_items for all using (public.is_admin()) with check (public.is_admin());
create policy "admin read audit" on public.audit_logs for select using (public.is_admin());
create policy "admin read admins" on public.admin_users for select using (public.is_admin());
-- webhook_events: no policies => only the service role can touch it.

-- Private bucket for customer documents. No storage policies for anon/authenticated customers => not readable publicly.
insert into storage.buckets (id, name, public) values ('documents','documents', false) on conflict do nothing;
create policy "admin read documents" on storage.objects for select using (bucket_id = 'documents' and public.is_admin());
