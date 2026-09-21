-- La den offentlige butikken vise solgte varer med tydelig status.
-- Kladd og arkiverte varer forblir skjult.

begin;

drop policy if exists "Public can view shop products" on public.products;
create policy "Public can view shop products"
on public.products for select
to anon, authenticated
using (status in ('available', 'reserved', 'sold'));

commit;
