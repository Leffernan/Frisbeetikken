# Frisbeetikken

En rask, mobiltilpasset butikkfront for unike, brukte diskgolf-disker. Det er fem produktkort i bredden på store skjermer og to på mobil.

## Dette virker nå

- Alle varer vises direkte på forsiden.
- Søk etter produsent, modell, plasttype eller varenummer.
- Filtrering på produsent og minimumsgrad.
- Sortering på nyeste, pris og grad.
- Produktdetaljer med forside/bakside, vekt, plast, tilstand og pris.
- Handlekurv for flere unike disker, lagret lokalt i nettleseren.
- Reserverte varer er synlige, men kan ikke legges i kurven.
- Supabase-funksjon reserverer hele handlekurven atomisk og hindrer dobbeltreservasjon.
- GitHub Actions publiserer automatisk til GitHub Pages.

## Test lokalt

```bash
npm run check
npm run serve
```

Åpne deretter `http://localhost:4173`.

## Legg til produkter

Produktinformasjonen ligger i `data/products.json`. Hver fysisk disc skal ha et unikt varenummer.

Legg bildene i `assets/products/` med dette formatet:

```text
001__Innova-Destroyer__front__10.jpg
001__Innova-Destroyer__back__10.jpg
```

Dobbel understrek skiller feltene. Dette gjør produktnavn med vanlig bindestrek trygge. Kjør deretter:

```bash
npm run sync:images
```

Skriptet kontrollerer varenummer, produktnavn og grad, og kobler bildene til riktig produkt. Det stopper publisering hvis noe ikke stemmer.

## Aktiver reservasjoner

1. Opprett et Supabase-prosjekt.
2. Kjør `supabase/schema.sql` i SQL Editor.
3. Kopier Project URL og den offentlige anon-nøkkelen til `config.js`.
4. Legg de virkelige produktene i `products`-tabellen.

`reserve_order()` låser alle valgte produkter i samme databasetransaksjon. Kunden får enten reservert hele kurven eller ingen av varene. Personopplysninger kan ikke leses med den offentlige nøkkelen.

### Send nye bestillinger på e-post

`supabase/functions/order-email/` inneholder en ferdig Edge Function for Resend:

1. Opprett en Resend-konto og verifiser avsenderdomenet.
2. Deploy funksjonen `order-email` i Supabase.
3. Legg inn secrets: `RESEND_API_KEY`, `ORDER_EMAIL`, `EMAIL_FROM` og en tilfeldig `WEBHOOK_SECRET`.
4. Opprett en Supabase Database Webhook på `INSERT` i `public.orders` og pek den mot funksjonen.
5. Legg samme verdi som `WEBHOOK_SECRET` i webhook-headeren `x-webhook-secret`.

Mottakeradresse og nøkler ligger dermed aldri i det offentlige repoet. E-posten inneholder kundeinfo, leveringsvalg, valgte disker og totalpris.

## GitHub Pages

Arbeidsflyten ligger i `.github/workflows/pages.yml`. Hvis Pages ikke allerede er aktivert, velg **Settings → Pages → Source: GitHub Actions** én gang. Deretter publiseres hver endring på `main` automatisk.
