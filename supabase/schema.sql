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
  rim_ink text not null default 'no' constraint products_rim_ink_check check (rim_ink in ('no', 'under_barely', 'rim_barely', 'rim', 'under')),
  note text,
  image_front text,
  image_back text,
  color text,
  status text not null default 'available' check (status in ('draft', 'available', 'reserved', 'sold', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Legger feltet til også når products-tabellen allerede finnes fra et tidligere oppsett.
alter table public.products
  add column if not exists rim_ink text not null default 'no';

-- Bevarer eksisterende produktinformasjon når de gamle ink-valgene utvides.
alter table public.products drop constraint if exists products_rim_ink_check;
update public.products
set rim_ink = case rim_ink
  when 'barely' then 'rim_barely'
  when 'yes' then 'rim'
  else rim_ink
end
where rim_ink in ('barely', 'yes');
alter table public.products
  add constraint products_rim_ink_check
  check (rim_ink in ('no', 'under_barely', 'rim_barely', 'rim', 'under'));

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  delivery_method text not null check (delivery_method = 'pickup'),
  customer_note text,
  items jsonb not null default '[]'::jsonb,
  total numeric(10, 2) not null default 0 check (total >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'sold', 'cancelled', 'expired')),
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Varslingsfeltene gjør at en webhook får med varer og totalsum uten tilgang
-- til private tabeller eller en service role-nøkkel.
alter table public.orders
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists total numeric(10, 2) not null default 0;

create table if not exists public.order_items (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  price numeric(10, 2) not null,
  primary key (order_id, product_id)
);

-- Bare brukere som eksplisitt legges i denne tabellen får administrere varer
-- og laste opp produktbilder. Opprett brukeren i Authentication først.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists products_status_created_idx on public.products(status, created_at desc);
create index if not exists orders_status_reserved_idx on public.orders(status, reserved_until);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Public can view shop products" on public.products;
create policy "Public can view shop products"
on public.products for select
to anon, authenticated
using (status in ('available', 'reserved'));

drop policy if exists "Admins can view all products" on public.products;
create policy "Admins can view all products"
on public.products for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
on public.products for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
on public.products for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
on public.products for delete
to authenticated
using (public.is_admin());

-- "Automatically expose new tables" er slått av i prosjektet.
-- Gi derfor bare den ene offentlige lesetilgangen butikken faktisk trenger.
grant usage on schema public to anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
grant select on table public.products to anon, authenticated;
grant insert, update, delete on table public.products to authenticated;

-- Offentlige produktbilder. Lesing er åpent fordi bildene skal vises i butikken,
-- mens all skriving fortsatt krever både innlogging og admin-tillatelse.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can view product image objects" on storage.objects;
create policy "Admins can view product image objects"
on storage.objects for select
to authenticated
using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images' and public.is_admin())
with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images' and public.is_admin());

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
  order_items_snapshot jsonb;
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

  -- FOR UPDATE gjør at to samtidige kunder ikke kan reservere samme disk.
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

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'manufacturer', p.manufacturer,
      'model', p.model,
      'price', p.price
    ) order by p.id), '[]'::jsonb),
    coalesce(sum(p.price), 0)
  into order_items_snapshot, order_total
  from public.products p
  where p.id = any(product_ids);

  new_order_number := 'FT-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    order_number, customer_name, customer_email, customer_phone,
    delivery_method, customer_note, items, total, reserved_until
  ) values (
    new_order_number,
    left(trim(customer_name), 120),
    left(trim(customer_email), 254),
    left(trim(customer_phone), 40),
    delivery_method,
    left(customer_note, 1000),
    order_items_snapshot,
    order_total,
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
    'total', order_total,
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
  ('001', 'Innova', 'Destroyer', 179, 9, 173, 'Star', 'Svært pen disk med minimale bruksspor.', '#f06c4f', 'available', now()),
  ('002', 'Kastaplast', 'Berg', 149, 8, 175, 'K1 Soft', 'Normal bruk. Ingen navn eller telefonnummer skrevet på.', '#dfc760', 'available', now() - interval '1 day'),
  ('003', 'Latitude 64°', 'River', 129, 7, 171, 'Opto', 'Noen riper i flightplaten, men fin kant.', '#58a7b4', 'available', now() - interval '2 days')
on conflict (id) do nothing;
