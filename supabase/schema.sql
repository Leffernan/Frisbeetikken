-- Frisbeetikken: database, tilgangsregler og atomisk reservasjon.
-- Kjør hele filen i Supabase SQL Editor i et nytt prosjekt.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  manufacturer text not null,
  model text not null,
  price numeric(10, 2) not null check (price >= 0),
  grade smallint not null check (grade between 0 and 10),
  weight smallint check (weight between 1 and 300),
  plastic text,
  note text,
  image_front text,
  image_back text,
  color text,
  status text not null default 'available' check (status in ('draft', 'available', 'reserved', 'sold', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  delivery_method text not null check (delivery_method in ('pickup', 'posten', 'postnord')),
  customer_note text,
  status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'sold', 'cancelled', 'expired')),
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  price numeric(10, 2) not null,
  primary key (order_id, product_id)
);

create index if not exists products_status_created_idx on public.products(status, created_at desc);
create index if not exists orders_status_reserved_idx on public.orders(status, reserved_until);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Public can view shop products" on public.products;
create policy "Public can view shop products"
on public.products for select
to anon, authenticated
using (status in ('available', 'reserved'));

-- Kundedata er aldri tilgjengelig via den offentlige nøkkelen.
-- Oppretting skjer bare gjennom reserve_order() nedenfor.

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
begin
  if coalesce(array_length(product_ids, 1), 0) = 0 then
    raise exception 'Handlekurven er tom';
  end if;

  if nullif(trim(customer_name), '') is null
     or nullif(trim(customer_email), '') is null
     or nullif(trim(customer_phone), '') is null then
    raise exception 'Navn, e-post og telefon er påkrevd';
  end if;

  if delivery_method not in ('pickup', 'posten', 'postnord') then
    raise exception 'Ugyldig leveringsmåte';
  end if;

  select count(distinct item) into requested_count from unnest(product_ids) item;

  -- FOR UPDATE gjør at to samtidige kunder ikke kan reservere samme disc.
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

  new_order_number := 'FT-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    order_number, customer_name, customer_email, customer_phone,
    delivery_method, customer_note, reserved_until
  ) values (
    new_order_number,
    left(trim(customer_name), 120),
    left(trim(customer_email), 254),
    left(trim(customer_phone), 40),
    delivery_method,
    left(customer_note, 1000),
    now() + interval '48 hours'
  ) returning id into new_order_id;

  insert into public.order_items (order_id, product_id, price)
  select new_order_id, id, price
  from public.products
  where id = any(product_ids);

  update public.products
  set status = 'reserved', updated_at = now()
  where id = any(product_ids);

  return jsonb_build_object(
    'order_id', new_order_id,
    'order_number', new_order_number,
    'reserved_until', now() + interval '48 hours'
  );
end;
$$;

revoke all on function public.reserve_order(text[], text, text, text, text, text) from public;
grant execute on function public.reserve_order(text[], text, text, text, text, text) to anon, authenticated;

-- Kan kjøres manuelt eller på en tidsplan for å frigjøre utløpte reservasjoner.
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
    set status = 'available', updated_at = now()
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

-- Eksempelprodukter. Fjern blokken hvis du vil starte med tom butikk.
insert into public.products (id, manufacturer, model, price, grade, weight, plastic, note, color, status, created_at)
values
  ('001', 'Innova', 'Destroyer', 179, 9, 173, 'Star', 'Svært pen disc med minimale bruksspor.', '#f06c4f', 'available', now()),
  ('002', 'Kastaplast', 'Berg', 149, 8, 175, 'K1 Soft', 'Normal bruk. Ingen navn eller telefonnummer skrevet på.', '#dfc760', 'available', now() - interval '1 day'),
  ('003', 'Latitude 64°', 'River', 129, 7, 171, 'Opto', 'Noen riper i flightplaten, men fin kant.', '#58a7b4', 'available', now() - interval '2 days')
on conflict (id) do nothing;
