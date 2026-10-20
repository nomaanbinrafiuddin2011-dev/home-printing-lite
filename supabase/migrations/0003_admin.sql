-- Admin dashboard security. All admin WRITES go through the functions below, called only by the server (service role).
-- Admins may READ via their own session; they may not write tables directly.

-- 1) Tighten RLS from 0001: remove broad admin write policies and the direct storage read policy.
drop policy if exists "admin all settings"    on public.settings;
drop policy if exists "admin all orders"      on public.orders;
drop policy if exists "admin all order_items" on public.order_items;
drop policy if exists "admin read documents"  on storage.objects;   -- files are only reachable via audited, server-issued signed URLs
create policy "admin read settings"    on public.settings    for select using (public.is_admin());
create policy "admin read orders"      on public.orders      for select using (public.is_admin());
create policy "admin read order_items" on public.order_items for select using (public.is_admin());

-- Defence in depth: browser roles never get write privileges on any table.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

-- 2) Cash collection records (one per order, enforced by a unique constraint).
create table public.cash_collections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  amount_paise integer not null check (amount_paise > 0),
  collected_by uuid not null,
  collected_by_email text,
  collected_at timestamptz not null default now(),
  note text
);
alter table public.cash_collections enable row level security;
create policy "admin read cash_collections" on public.cash_collections for select using (public.is_admin());
revoke insert, update, delete, truncate on public.cash_collections from anon, authenticated;

-- 3) Audit log: record the admin's email, and make it append-only (even for privileged roles).
alter table public.audit_logs add column if not exists actor_email text;
create or replace function public.audit_logs_immutable() returns trigger language plpgsql as $$ begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs for each row execute function public.audit_logs_immutable();

-- 4) An order can never become "paid" by cash unless a matching collection record exists; paid cannot silently revert.
create or replace function public.orders_payment_guard() returns trigger language plpgsql as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.payment_method = 'cash'
     and not exists (select 1 from public.cash_collections c where c.order_id = new.id and c.amount_paise = new.total_paise) then
    raise exception 'cash order cannot be marked paid without a cash collection record';
  end if;
  if old.payment_status = 'paid' and new.payment_status not in ('paid','refund_pending','refunded') then
    raise exception 'a paid order cannot be moved back to an unpaid state';
  end if;
  return new;
end $$;
create trigger orders_payment_guard_trg before update on public.orders for each row execute function public.orders_payment_guard();

-- 5) Server-only functions (atomic write + audit entry in one transaction).
create or replace function public.admin_set_order_status(p_order uuid, p_expected text, p_next text, p_admin uuid, p_email text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.orders set status = p_next, updated_at = now(),
         cancel_reason = case when p_next = 'cancelled' then p_reason else cancel_reason end
   where id = p_order and status = p_expected;
  get diagnostics n = row_count;
  if n = 0 then
    return case when exists (select 1 from public.orders where id = p_order) then 'conflict' else 'not_found' end;
  end if;
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, 'order.status_changed', 'order', p_order::text, jsonb_build_object('from', p_expected, 'to', p_next, 'reason', p_reason));
  return 'ok';
end $$;

create or replace function public.admin_record_cash(p_order uuid, p_admin uuid, p_email text, p_amount integer, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then return 'not_found'; end if;
  if o.payment_status = 'paid' or exists (select 1 from public.cash_collections where order_id = p_order) then return 'duplicate'; end if;
  if o.payment_method <> 'cash' or o.payment_status <> 'cash_pending' or o.status not in ('ready_for_pickup','out_for_delivery') or p_amount <> o.total_paise then return 'invalid'; end if;
  insert into public.cash_collections (order_id, amount_paise, collected_by, collected_by_email, note) values (p_order, p_amount, p_admin, p_email, p_note);
  update public.orders set payment_status = 'paid', updated_at = now() where id = p_order;
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, 'order.cash_collected', 'order', p_order::text, jsonb_build_object('amount_paise', p_amount, 'note', p_note));
  return 'ok';
exception when unique_violation then return 'duplicate';
end $$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb, p_admin uuid, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare old jsonb;
begin
  if p_key not in ('pricing','delivery','fulfilment','payments','files','retention') then raise exception 'unknown setting key'; end if;
  select value into old from public.settings where key = p_key for update;
  update public.settings set value = p_value, updated_at = now() where key = p_key;
  if not found then insert into public.settings (key, value, is_public) values (p_key, p_value, p_key <> 'retention'); end if;
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, 'setting.changed', 'setting', p_key, jsonb_build_object('before', old, 'after', p_value));
  return true;
end $$;

create or replace function public.admin_log_event(p_admin uuid, p_email text, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail) values (p_admin, p_email, p_action, p_entity, p_entity_id, p_detail) $$;

revoke all on function public.admin_set_order_status(uuid,text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.admin_record_cash(uuid,uuid,text,integer,text)      from public, anon, authenticated;
revoke all on function public.admin_set_setting(text,jsonb,uuid,text)             from public, anon, authenticated;
revoke all on function public.admin_log_event(uuid,text,text,text,text,jsonb)     from public, anon, authenticated;
grant execute on function public.admin_set_order_status(uuid,text,text,uuid,text,text) to service_role;
grant execute on function public.admin_record_cash(uuid,uuid,text,integer,text)      to service_role;
grant execute on function public.admin_set_setting(text,jsonb,uuid,text)             to service_role;
grant execute on function public.admin_log_event(uuid,text,text,text,text,jsonb)     to service_role;
