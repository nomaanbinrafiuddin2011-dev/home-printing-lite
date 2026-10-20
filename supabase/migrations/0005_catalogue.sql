-- Paper sizes, printers, capabilities and per-size pricing. Run AFTER 0001-0004.
-- Nothing here invents prices: only A4 is priced (copied from your existing settings.pricing rates).

create table public.paper_sizes (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 40),
  width_mm integer not null check (width_mm between 20 and 1500),
  height_mm integer not null check (height_mm between 20 and 1500),
  is_custom boolean not null default false,
  enabled boolean not null default false,          -- customers only see enabled sizes
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);
create unique index paper_sizes_name_key on public.paper_sizes (lower(name));
insert into public.paper_sizes (id, name, width_mm, height_mm, enabled, sort_order) values
  ('a3','A3',297,420,false,30), ('a4','A4',210,297,true,40), ('a5','A5',148,210,false,50),
  ('letter','Letter',216,279,false,60), ('legal','Legal',216,356,false,70);

create table public.paper_prices (
  paper_size_id text not null references public.paper_sizes(id) on delete restrict,
  color_mode text not null check (color_mode in ('bw','c')),
  price_paise integer not null check (price_paise > 0),
  updated_at timestamptz not null default now(),
  primary key (paper_size_id, color_mode)
);
-- Preserve the existing A4 rates exactly (falls back to 200 / 900 paise only if the old setting is missing).
insert into public.paper_prices (paper_size_id, color_mode, price_paise) values
  ('a4','bw',     coalesce(nullif((select (value->>'bw_paise')::int     from public.settings where key = 'pricing'), 0), 200)),
  ('a4','c',      coalesce(nullif((select (value->>'colour_paise')::int from public.settings where key = 'pricing'), 0), 900));

create table public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  active boolean not null default true,
  supports_colour boolean not null default false,
  supports_duplex boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index printers_name_key on public.printers (lower(name));
create table public.printer_paper_sizes (
  printer_id uuid not null references public.printers(id) on delete cascade,
  paper_size_id text not null references public.paper_sizes(id) on delete restrict,
  primary key (printer_id, paper_size_id)
);
-- Your current service (see the poster): A4, colour and B&W, double-sided. Edit it under Admin > Paper & printers if that is wrong.
with p as (insert into public.printers (name, active, supports_colour, supports_duplex) values ('Main printer', true, true, true) returning id)
insert into public.printer_paper_sizes (printer_id, paper_size_id) select id, 'a4' from p;

-- Every order item remembers the paper size it was ordered in (snapshot, so later catalogue edits never rewrite history).
alter table public.order_items add column if not exists paper_size_id text, add column if not exists paper_width_mm integer, add column if not exists paper_height_mm integer;
update public.order_items set paper_size_id = 'a4', paper_width_mm = 210, paper_height_mm = 297 where paper_size_id is null and upper(paper_size) = 'A4';

-- Security: same model as before. Browser roles can't write; admins can read; the server (service role) writes through functions.
alter table public.paper_sizes enable row level security;  alter table public.paper_prices enable row level security;
alter table public.printers enable row level security;     alter table public.printer_paper_sizes enable row level security;
create policy "admin read paper_sizes" on public.paper_sizes for select using (public.is_admin());
create policy "admin read paper_prices" on public.paper_prices for select using (public.is_admin());
create policy "admin read printers" on public.printers for select using (public.is_admin());
create policy "admin read printer_paper_sizes" on public.printer_paper_sizes for select using (public.is_admin());
revoke insert, update, delete, truncate on public.paper_sizes, public.paper_prices, public.printers, public.printer_paper_sizes from anon, authenticated;

create or replace function public.admin_add_paper_size(p_id text, p_name text, p_w integer, p_h integer, p_admin uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
begin
  insert into public.paper_sizes (id, name, width_mm, height_mm, is_custom, enabled, sort_order) values (p_id, p_name, p_w, p_h, true, false, 200);
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, 'paper_size.added', 'paper_size', p_id, jsonb_build_object('name', p_name, 'width_mm', p_w, 'height_mm', p_h));
  return 'ok';
exception when unique_violation then return 'duplicate';
end $$;

-- Enable/disable a size and/or set its prices (null = leave unchanged). Refuses to enable a size with no price or no active printer.
create or replace function public.admin_set_paper_size(p_id text, p_enabled boolean, p_bw integer, p_c integer, p_admin uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare s public.paper_sizes%rowtype;
begin
  select * into s from public.paper_sizes where id = p_id for update;
  if not found then return 'not_found'; end if;
  if p_enabled is true then
    if p_bw is null and p_c is null and not exists (select 1 from public.paper_prices where paper_size_id = p_id) then return 'no_price'; end if;
    if not exists (select 1 from public.printers pr join public.printer_paper_sizes ps on ps.printer_id = pr.id where pr.active and ps.paper_size_id = p_id) then return 'no_printer'; end if;
  end if;
  if p_enabled is false and s.enabled and (select count(*) from public.paper_sizes where enabled) <= 1 then return 'last_size'; end if;
  if p_bw is not null then insert into public.paper_prices (paper_size_id, color_mode, price_paise) values (p_id, 'bw', p_bw) on conflict (paper_size_id, color_mode) do update set price_paise = excluded.price_paise, updated_at = now(); end if;
  if p_c  is not null then insert into public.paper_prices (paper_size_id, color_mode, price_paise) values (p_id, 'c',  p_c)  on conflict (paper_size_id, color_mode) do update set price_paise = excluded.price_paise, updated_at = now(); end if;
  update public.paper_sizes set enabled = coalesce(p_enabled, enabled) where id = p_id;
  if p_id = 'a4' and (p_bw is not null or p_c is not null) then   -- keep the legacy settings.pricing row in step with A4
    update public.settings set value = value || jsonb_strip_nulls(jsonb_build_object('bw_paise', p_bw, 'colour_paise', p_c)), updated_at = now() where key = 'pricing';
  end if;
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, 'paper_size.updated', 'paper_size', p_id, jsonb_build_object('enabled_before', s.enabled, 'enabled_after', coalesce(p_enabled, s.enabled), 'bw_paise', p_bw, 'colour_paise', p_c));
  return 'ok';
end $$;

-- Create (p_id null) or update a printer and replace its supported paper sizes. Returns {"result": ..., "id": ...}.
create or replace function public.admin_save_printer(p_id uuid, p_name text, p_active boolean, p_colour boolean, p_duplex boolean, p_sizes text[], p_admin uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb;
begin
  if p_id is null then
    insert into public.printers (name, active, supports_colour, supports_duplex) values (p_name, p_active, p_colour, p_duplex) returning id into v_id;
  else
    select to_jsonb(pr) into v_before from public.printers pr where id = p_id for update;
    if v_before is null then return jsonb_build_object('result', 'not_found'); end if;
    update public.printers set name = p_name, active = p_active, supports_colour = p_colour, supports_duplex = p_duplex where id = p_id;
    v_id := p_id;
  end if;
  delete from public.printer_paper_sizes where printer_id = v_id;
  insert into public.printer_paper_sizes (printer_id, paper_size_id) select v_id, s from unnest(p_sizes) as s;
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, case when p_id is null then 'printer.added' else 'printer.updated' end, 'printer', v_id::text,
          jsonb_build_object('before', v_before, 'name', p_name, 'active', p_active, 'supports_colour', p_colour, 'supports_duplex', p_duplex, 'paper_sizes', to_jsonb(p_sizes)));
  return jsonb_build_object('result', 'ok', 'id', v_id);
exception when unique_violation then return jsonb_build_object('result', 'duplicate');
          when foreign_key_violation then return jsonb_build_object('result', 'invalid');
end $$;

-- Settings function from 0003, now also mirroring the legacy A4 rates into paper_prices (so the old Settings page stays correct).
create or replace function public.admin_set_setting(p_key text, p_value jsonb, p_admin uuid, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare old jsonb;
begin
  if p_key not in ('pricing','delivery','fulfilment','payments','files','retention') then raise exception 'unknown setting key'; end if;
  select value into old from public.settings where key = p_key for update;
  update public.settings set value = p_value, updated_at = now() where key = p_key;
  if not found then insert into public.settings (key, value, is_public) values (p_key, p_value, p_key <> 'retention'); end if;
  if p_key = 'pricing' then
    if (p_value->>'bw_paise') ~ '^[1-9][0-9]*$' then insert into public.paper_prices (paper_size_id, color_mode, price_paise) values ('a4','bw',(p_value->>'bw_paise')::int) on conflict (paper_size_id, color_mode) do update set price_paise = excluded.price_paise, updated_at = now(); end if;
    if (p_value->>'colour_paise') ~ '^[1-9][0-9]*$' then insert into public.paper_prices (paper_size_id, color_mode, price_paise) values ('a4','c',(p_value->>'colour_paise')::int) on conflict (paper_size_id, color_mode) do update set price_paise = excluded.price_paise, updated_at = now(); end if;
  end if;
  insert into public.audit_logs (actor, actor_email, action, entity, entity_id, detail)
  values (p_admin, p_email, 'setting.changed', 'setting', p_key, jsonb_build_object('before', old, 'after', p_value));
  return true;
end $$;

revoke all on function public.admin_add_paper_size(text,text,integer,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_set_paper_size(text,boolean,integer,integer,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_save_printer(uuid,text,boolean,boolean,boolean,text[],uuid,text) from public, anon, authenticated;
revoke all on function public.admin_set_setting(text,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_add_paper_size(text,text,integer,integer,uuid,text) to service_role;
grant execute on function public.admin_set_paper_size(text,boolean,integer,integer,uuid,text) to service_role;
grant execute on function public.admin_save_printer(uuid,text,boolean,boolean,boolean,text[],uuid,text) to service_role;
grant execute on function public.admin_set_setting(text,jsonb,uuid,text) to service_role;
