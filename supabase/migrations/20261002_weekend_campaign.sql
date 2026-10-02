-- Helgekampanje 2.-4. oktober 2026.
-- 2 disker gir 20 % rabatt. 3 eller flere gir 30 % rabatt.
-- Supabase-tiden er autoritativ, og rabatten lagres som en del av ordren.
-- Safe to rerun.

alter table public.products
  add column if not exists sale_price numeric(10, 2);

alter table public.orders
  add column if not exists subtotal numeric(10, 2) not null default 0,
  add column if not exists discount_percent integer not null default 0,
  add column if not exists discount_amount numeric(10, 2) not null default 0;

create or replace function public.weekend_campaign_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'configured', true,
    'active', now() >= timestamp with time zone '2026-10-02 14:04:00+02'
      and now() < timestamp with time zone '2026-10-05 00:00:00+02',
    'starts_at', timestamp with time zone '2026-10-02 14:04:00+02',
    'ends_at', timestamp with time zone '2026-10-05 00:00:00+02'
  );
$$;

revoke all on function public.weekend_campaign_status() from public;
grant execute on function public.weekend_campaign_status() to anon, authenticated;

create or replace function public.reserve_order(
  product_ids text[],
  customer_name text,
  customer_email text,
  customer_phone text,
  delivery_method text,
  customer_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id uuid;
  new_order_number text;
  requested_count integer;
  available_count integer;
  order_items_snapshot jsonb;
  order_subtotal numeric(10, 2);
  campaign_discount_percent integer := 0;
  campaign_discount_amount numeric(10, 2) := 0;
  order_total numeric(10, 2);
begin
  if coalesce(array_length(product_ids, 1), 0) = 0 then
    raise exception 'Handlekurven er tom';
  end if;

  if nullif(trim(customer_name), '') is null
     or nullif(trim(customer_email), '') is null
     or nullif(trim(customer_phone), '') is null then
    raise exception 'Navn, e-post og telefon er påkrevd';
  end if;

  if delivery_method <> 'pickup' then
    raise exception 'Ugyldig leveringsmåte';
  end if;

  select count(distinct item) into requested_count from unnest(product_ids) item;

  -- Låser varene slik at to samtidige kunder ikke kan reservere samme disk.
  perform id
  from public.products
  where id = any(product_ids)
  order by id
  for update;

  select count(*) into available_count
  from public.products
  where id = any(product_ids) and status = 'available';

  if available_count <> requested_count then
    raise exception 'En eller flere disker er ikke lenger tilgjengelige';
  end if;

  select coalesce(sum(p.price), 0)
  into order_subtotal
  from public.products p
  where p.id = any(product_ids);

  -- Helgekampanje: Oslo-tid 2. oktober til og med 4. oktober 2026 kl. 23.59.
  if now() >= timestamp with time zone '2026-10-02 14:04:00+02'
     and now() < timestamp with time zone '2026-10-05 00:00:00+02' then
    if requested_count >= 3 then
      campaign_discount_percent := 30;
    elsif requested_count = 2 then
      campaign_discount_percent := 20;
    end if;
  end if;

  campaign_discount_amount := round(order_subtotal * campaign_discount_percent / 100.0, 2);
  order_total := order_subtotal - campaign_discount_amount;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'manufacturer', p.manufacturer,
    'model', p.model,
    'original_price', p.price,
    'price', round(p.price * (100 - campaign_discount_percent) / 100.0, 2),
    'discount_percent', campaign_discount_percent
  ) order by p.id), '[]'::jsonb)
  into order_items_snapshot
  from public.products p
  where p.id = any(product_ids);

  new_order_number := 'FT-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    order_number, customer_name, customer_email, customer_phone,
    delivery_method, customer_note, items, subtotal, discount_percent,
    discount_amount, total, reserved_until
  ) values (
    new_order_number,
    left(trim(customer_name), 120),
    left(trim(customer_email), 254),
    left(trim(customer_phone), 40),
    delivery_method,
    left(customer_note, 1000),
    order_items_snapshot,
    order_subtotal,
    campaign_discount_percent,
    campaign_discount_amount,
    order_total,
    now() + interval '48 hours'
  ) returning id into new_order_id;

  insert into public.order_items (order_id, product_id, price)
  select new_order_id, id, round(price * (100 - campaign_discount_percent) / 100.0, 2)
  from public.products
  where id = any(product_ids);

  update public.products
  set status = 'reserved',
      sale_price = round(price * (100 - campaign_discount_percent) / 100.0, 2),
      updated_at = now()
  where id = any(product_ids);

  return jsonb_build_object(
    'order_id', new_order_id,
    'order_number', new_order_number,
    'subtotal', order_subtotal,
    'discount_percent', campaign_discount_percent,
    'discount_amount', campaign_discount_amount,
    'total', order_total,
    'reserved_until', now() + interval '48 hours'
  );
end;
$$;

revoke all on function public.reserve_order(text[], text, text, text, text, text) from public;
grant execute on function public.reserve_order(text[], text, text, text, text, text) to anon, authenticated;

create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  with expired_orders as (
    update public.orders
    set status = 'expired', updated_at = now()
    where status = 'reserved' and reserved_until < now()
    returning id
  ), released as (
    update public.products p
    set status = 'available', sale_price = null, updated_at = now()
    from public.order_items oi
    where oi.product_id = p.id
      and oi.order_id in (select id from expired_orders)
      and p.status = 'reserved'
    returning p.id
  )
  select count(*) into released_count from released;

  return released_count;
end;
$$;

revoke all on function public.release_expired_reservations() from public;
