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

## Legg til produkter og bilder

Den innloggede administrasjonssiden ligger på `admin.html`. Den grupperer automatisk bilder med samme varenummer:

```text
001_f.jpg  # forside
001_b.jpg  # bakside
002_f.jpg
002_b.jpg
```

Dra alle bildene inn samtidig. Du får ett produktkort per varenummer der produsent, modell, pris, grad, vekt, plasttype, eventuell ink og merknad fylles inn før publisering. JPG, JPEG, PNG, WebP og AVIF støttes, med maks 10 MB per bilde.

Fanen **Administrer produkter** viser alle eksisterende varer fra Supabase. Der kan produktinformasjon, status og enkeltbilder oppdateres uten å laste opp hele bildeparet på nytt. Redigeringen bruker feltvise oppdateringer, så bilder og databaseverdier som ikke endres, beholdes. Sletting krever at varenummeret skrives inn som bekreftelse og kan angres i 20 sekunder; bildefilene beholdes i Storage som ekstra sikkerhet.

Første gangs oppsett:

1. Kjør siste versjon av `supabase/schema.sql` i SQL Editor.
2. Gå til **Authentication → Users** og opprett én bruker for deg selv.
3. Kopier brukerens UUID og kjør `insert into public.admin_users (user_id) values ('DIN-UUID');` i SQL Editor.
4. Slå av **Allow new users to sign up** under Authentication-innstillingene.
5. Åpne `https://leffernan.github.io/Frisbeetikken/admin.html` og logg inn.

Den gamle lokale bildeimporten i `assets/products/` finnes fortsatt for utvikling, men er ikke nødvendig når administrasjonssiden brukes.

## Aktiver reservasjoner

1. Opprett et Supabase-prosjekt.
2. Kjør `supabase/schema.sql` i SQL Editor. For et eksisterende Frisbeetikken-prosjekt kan den målrettede filen `supabase/migrations/20260921_reservations_and_ink.sql` kjøres i stedet.
3. Kopier Project URL og den offentlige publishable-nøkkelen til `config.js`.
4. Legg de virkelige produktene i `products`-tabellen.

`reserve_order()` låser alle valgte produkter i samme databasetransaksjon. Kunden får enten reservert hele kurven eller ingen av varene. Personopplysninger kan ikke leses med den offentlige nøkkelen.

### Send nye bestillinger på e-post

`supabase/functions/order-email/` inneholder en ferdig Edge Function for Resend:

1. Opprett en Resend-konto og verifiser avsenderdomenet.
2. Deploy funksjonen `order-email` i Supabase.
3. Legg inn secrets: `RESEND_API_KEY`, `ORDER_EMAIL=leffernan@gmail.com`, `EMAIL_FROM` og en tilfeldig `WEBHOOK_SECRET`.
4. Opprett en Supabase Database Webhook på `INSERT` i `public.orders` og pek den mot funksjonen.
5. Legg samme verdi som `WEBHOOK_SECRET` i webhook-headeren `x-webhook-secret`.

Mottakeradresse og nøkler ligger dermed aldri i det offentlige repoet. E-posten inneholder kundeinfo, leveringsvalg, valgte disker og totalpris.

## GitHub Pages

Arbeidsflyten ligger i `.github/workflows/pages.yml`. Hvis Pages ikke allerede er aktivert, velg **Settings → Pages → Source: GitHub Actions** én gang. Deretter publiseres hver endring på `main` automatisk.
