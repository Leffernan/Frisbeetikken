-- Legg til produktstatusen "Solgt (skjult)".
-- Varer med denne statusen er tilgjengelige for administratorer,
-- men holdes utenfor den offentlige butikkvisningen.
-- Safe to rerun.

alter table public.products
  drop constraint if exists products_status_check;

alter table public.products
  add constraint products_status_check
  check (status in ('draft', 'available', 'reserved', 'sold', 'sold_hidden', 'archived'));

-- Den offentlige policyen inkluderer bevisst ikke sold_hidden.
drop policy if exists "Public can view shop products" on public.products;
create policy "Public can view shop products"
on public.products for select
to anon, authenticated
using (status in ('available', 'reserved', 'sold'));
