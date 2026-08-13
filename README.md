# fb-alert-api

Backend servis za Market Monitor / Lovac na Oglase projekat.

## Stack

- Node.js + Express 5
- TypeScript
- Prisma ORM
- PostgreSQL
- BullMQ + Redis

## Trenutni status

- Stabilan lokalni rad backend-a.
- Uveden globalni i endpoint rate limiting.
- Uvedena centralna validacija request-a (Zod).
- Uveden `/api/statistic` endpoint sa Basic auth zastitom.
- Uvedena normalizacija cena (RSD/EUR) i optimizacije matcher toka.
- Dodati indexi za performanse Alert/Notification upita.

## Start lokalno

```bash
npm install
npm run prisma:generate
npm run dev
```

API se podize na portu iz `PORT` env varijable (default `3000`).

## Skripte

- `npm run dev` - pokretanje dev servera
- `npm run build` - TypeScript build u `dist/`
- `npm run start` - pokretanje buildovane verzije
- `npm run prisma:migrate` - lokalna migracija
- `npm run prisma:deploy` - produkciona migracija

## Kljucne rute

- `GET /api/health`
- `POST /api/notifications/register-device`
- `POST /api/notifications/alerts`
- `PATCH /api/notifications/alerts/:id/toggle`
- `POST /api/subscription/webhook`
- `GET /api/statistic` (Basic auth)

## Obavezne env varijable

- `DATABASE_URL`
- `PORT` (opciono)
- `REDIS_URL` (ili ekvivalent prema lokalnoj konfiguraciji)
- `REVENUECAT_WEBHOOK_SECRET`
- `STATISTIC_USER`
- `STATISTIC_PASSWORD`

## Produkcija - checklist

1. Validirati DB konekciju i Prisma migracije.
2. Verifikovati webhook endpoint iz RevenueCat-a.
3. Proveriti limiter konfiguraciju i error logove.
4. Pokrenuti ingest/matcher smoke test nad realnim izvorima.
5. Zakljucati CORS i produkcione URL-ove.
