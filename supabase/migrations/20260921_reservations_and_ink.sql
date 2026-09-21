-- Trygg oppdatering for et eksisterende Frisbeetikken-prosjekt.
-- Beholder alle produkter og oversetter gamle ink-verdier til de nye valgene.

begin;

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

  if delivery_method <> 'pickup' then
    raise exception 'Ugyldig leveringsmåte';
  end if;

  select count(distinct item) into requested_count from unnest(product_ids) item;

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

commit;
