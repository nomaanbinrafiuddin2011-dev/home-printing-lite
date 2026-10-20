-- Print queue support. Defence in depth: the order status rules are enforced INSIDE the database too,
-- so no code path (including future ones) can skip a step or complete an unpaid order.
create or replace function public.orders_status_guard() returns trigger language plpgsql as $$
declare ok boolean;
begin
  if new.status is distinct from old.status then
    ok := case old.status
      when 'pending_confirmation' then new.status in ('confirmed', 'cancelled')
      when 'confirmed'            then new.status in ('preparing', 'cancelled')
      when 'preparing'            then new.status in ('printing', 'cancelled')
      when 'printing'             then new.status = 'cancelled'
                                       or (new.status = 'ready_for_pickup' and new.fulfilment = 'pickup')
                                       or (new.status = 'out_for_delivery' and new.fulfilment = 'delivery')
      when 'ready_for_pickup'     then new.status in ('completed', 'cancelled')
      when 'out_for_delivery'     then new.status in ('completed', 'cancelled')
      else false end;
    if not ok then raise exception 'invalid order status change: % -> %', old.status, new.status; end if;
    if new.status = 'completed' and new.payment_status <> 'paid' then raise exception 'order cannot be completed before payment is recorded'; end if;
    if new.status = 'cancelled' and old.payment_status = 'paid' then raise exception 'a paid order cannot be cancelled (refunds are not supported yet)'; end if;
  end if;
  return new;
end $$;
create trigger orders_status_guard_trg before update on public.orders for each row execute function public.orders_status_guard();

-- Fast queue lookups (only active orders are indexed).
create index if not exists orders_queue_idx on public.orders (created_at)
  where status in ('confirmed','preparing','printing','ready_for_pickup','out_for_delivery');
