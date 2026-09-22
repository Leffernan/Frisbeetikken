-- Legg til valgfrie flight numbers uten å endre eksisterende produkter.
-- Kjør én gang i Supabase SQL Editor før du fyller inn tallene i admin.

alter table public.products
  add column if not exists flight_speed numeric,
  add column if not exists flight_glide numeric,
  add column if not exists flight_turn numeric,
  add column if not exists flight_fade numeric;
