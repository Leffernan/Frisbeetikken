-- Flight numbers for products 067-099.
-- Run the whole file in Supabase SQL Editor. Safe to rerun.
-- Existing flight values and all other product fields are preserved.
--
-- Sources:
-- https://www.innovadiscs.com/disc-golf-discs/disc-comparison/
-- https://www.discmania.net/pages/flight-chart
-- https://www.discraft.com/disc-golf/
-- https://www.dynamicdiscs.com/collections/dynamic-discs-raider
-- https://westsidediscs.com/collections/war-horse
-- https://latitude64.com/products/grand-grace
-- https://www.rpmdiscs.com/product/huia/
-- https://www.prodigydisc.com/products/ace-line-p-model-s-proflex-plastic
-- https://www.prodigydisc.com/products/ace-line-p-model-us-duraflex-plastic
-- https://gurudiscs.com/discs-and-gear/discs/putter/flow-motion/

begin;

with ratings(id, speed, glide, turn, fade) as (
  values
    ('067', 12, 5, -1, 3),
    ('068', 12, 5, -1, 3),
    ('069', 13, 5, -0.5, 3),
    ('070', 7, 5, 0, 2),
    ('071', 12, 5, -1, 3),
    ('072', 5.5, 2, 0, 4),
    ('073', 4, 2, 0, 3),
    ('074', 3, 2, 0, 3),
    ('075', 4, 3, 0, 3),
    ('076', 5, 3, 0, 4),
    ('077', 5, 3, 0, 4),
    ('078', 4, 1, 0, 3),
    ('079', 5, 5, 0, 0),
    ('080', 7, 5, -2, 1),
    ('081', 5, 4, 0, 3),
    ('082', 6, 5, -2, 1),
    ('083', 9, 3, 0, 4),
    ('084', 8, 6, 0, 3),
    ('085', 14, 6, -1, 2),
    ('086', 11, 5, -1, 3),
    ('087', 13, 4, 0, 4),
    ('088', 11, 6, -1, 2),
    ('089', 12, 5, -1, 3),
    ('090', 13, 6, -2, 2),
    ('091', 12, 5, -1, 3),
    ('092', 7, 5, -1, 2),
    ('093', 12, 5, 0, 4),
    ('094', 2, 3, 0, 2),
    ('095', 2, 5, 0, 1),
    ('096', 3, 5, 0, 2),
    ('097', 3, 5, -1, 1),
    ('098', 3, 5, 0, 2),
    ('099', 3, 5, 0, 2)
)
update public.products as p
set flight_speed = r.speed,
    flight_glide = r.glide,
    flight_turn = r.turn,
    flight_fade = r.fade
from ratings as r
where p.id = r.id
  and p.flight_speed is null
  and p.flight_glide is null
  and p.flight_turn is null
  and p.flight_fade is null;

commit;

select id, manufacturer, model, flight_speed, flight_glide, flight_turn, flight_fade
from public.products
where id in (select '0' || n::text from generate_series(67, 99) as n)
order by id;
