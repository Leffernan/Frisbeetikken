-- Flight numbers for the 66 products photographed as 01-09 and 010-066 on 2026-09-22.
-- Run the whole file in Supabase SQL Editor. Safe to rerun.
-- Sources: manufacturer flight charts and product pages (see URLs below).
-- The Discmania putter 05 is omitted: the photo has a generic stamp and no mold identification.
-- Existing flight values and all other product fields are preserved.

begin;

alter table public.products
  add column if not exists flight_speed numeric,
  add column if not exists flight_glide numeric,
  add column if not exists flight_turn numeric,
  add column if not exists flight_fade numeric;

-- https://www.innovadiscs.com/disc-golf-discs/disc-comparison/
-- https://www.innovadiscs.com/disc/tern/ (Champion Tern has turn -2)
-- https://www.discmania.net/pages/flight-chart
-- https://www.discraft.com/disc-golf/
-- https://www.dynamicdiscs.com/products/lucid-truth
-- https://www.dynamicdiscs.com/products/lucid-sheriff
-- https://discsport.se/download/flightchart/flightchart-latitude-64.pdf
-- https://alfadiscs.com/item/apollo/ ; https://alfadiscs.com/item/cosmic/
-- https://alfadiscs.com/item/theios/ (Snoopy was renamed Theios)
-- https://prodigydisc.com/products/ace-line-p-model-s-duraflex-plastic
-- https://prodigydisc.com/products/prodigy-distortion-400-plastic-nhl-spin-o-rama-collection-stamp
-- Guru archival listings: https://wearediscgolf.no/produkt/c-plastic-fenris/
--                       https://infinitediscgolf.com/introducing-guru-discs-upcoming-mcbeth-and-paige-pierce-discs/

with ratings(manufacturer, model, speed, glide, turn, fade) as (
  values
    ('Alfa Discs', 'Apollo', 5, 5, -1, 2),
    ('Alfa Discs', 'Cosmic', 8, 6, 0, 3),
    ('Alfa Discs', 'Snoopy', 2, 4, 0, 2),
    ('Discmania', 'Astronaut', 12, 6, -4, 1),
    ('Discmania', 'Cloudbreaker', 12, 5, -1, 3),
    ('Discmania', 'Enigma', 12, 5, -1, 2),
    ('Discmania', 'FD', 7, 6, 0, 1),
    ('Discmania', 'MD3', 5, 5, 0, 1),
    ('Discmania', 'Mutant', 5, 3, 0, 4),
    ('Discmania', 'Origin', 5, 5, -1, 1),
    ('Discraft', 'Buzz SS', 5, 4, -2, 1),
    ('Discraft', 'Flick', 12, 3, 1, 5),
    ('Discraft', 'Get Freaky Zone', 4, 3, 0, 3),
    ('Discraft', 'Hades', 12, 6, -3, 2),
    ('Discraft', 'Zone', 4, 3, 0, 3),
    ('Dynamic Discs', 'Sheriff', 13, 5, -1, 2),
    ('Dynamic Discs', 'Truth', 5, 5, -1, 1),
    ('Guru', 'Fenris', 13, 5, -1, 2),
    ('Guru', 'Thor', 4, 4, 0, 2),
    ('Innova', 'Aviar', 2, 3, 0, 1),
    ('Innova', 'Beast', 10, 5, -2, 2),
    ('Innova', 'Boss', 13, 5, -1, 3),
    ('Innova', 'Destroyer', 12, 5, -1, 3),
    ('Innova', 'Eagle', 7, 4, -1, 3),
    ('Innova', 'Firebird', 9, 3, 0, 4),
    ('Innova', 'Firefly', 2, 3, 0, 1),
    ('Innova', 'Mako3', 5, 5, 0, 0),
    ('Innova', 'Mystere', 11, 6, -2, 2),
    ('Innova', 'Nova', 2, 3, 0, 0),
    ('Innova', 'Pig', 4, 1, 0, 3),
    ('Innova', 'Roc3', 5, 4, 0, 3),
    ('Innova', 'Rollo', 5, 6, -4, 1),
    ('Innova', 'Shryke', 13, 6, -2, 2),
    ('Innova', 'TL3', 8, 4, -1, 1),
    ('Innova', 'Teebird', 7, 5, 0, 2),
    ('Innova', 'Teebird3', 8, 4, 0, 2),
    ('Innova', 'Tern', 12, 6, -2, 2),
    ('Innova', 'Thunderbird', 9, 5, 0, 2),
    ('Innova', 'Wraith', 11, 5, -1, 3),
    ('Latitude 64°', 'Claymore', 5, 5, -1, 1),
    ('Latitude 64°', 'Dagger', 2, 5, 0, 1),
    ('Latitude 64°', 'Explorer', 7, 5, 0, 2),
    ('Latitude 64°', 'Knight', 14, 4, -1.5, 3),
    ('Prodigy', 'Distortion', 4, 4, 0, 3),
    ('Prodigy', 'P Model S', 3, 5, 0, 2)
)
update public.products as p
set flight_speed = r.speed,
    flight_glide = r.glide,
    flight_turn = r.turn,
    flight_fade = r.fade
from ratings as r
where p.manufacturer = r.manufacturer
  and p.model = r.model
  and p.id in (select '0' || n::text from generate_series(1, 66) as n)
  and p.flight_speed is null
  and p.flight_glide is null
  and p.flight_turn is null
  and p.flight_fade is null;

commit;

-- Expected for the current catalog: 65 of 66, with putter 05 left for manual identification.
select
  count(*) filter (where flight_speed is not null and flight_glide is not null
    and flight_turn is not null and flight_fade is not null) as products_with_flight_numbers,
  count(*) as products_in_original_catalog
from public.products
where id in (select '0' || n::text from generate_series(1, 66) as n);
