# Olu Hotel Booking & Ordering

A small hotel application with a guest booking site, front-desk booking management, restaurant ordering, and kitchen status tracking.

## Run locally

Requires Node.js 22 or newer. Use a supported LTS release for hosting.

```powershell
npm install
npm start
```

Open `http://127.0.0.1:3000` for the guest site or `http://localhost:3000/admin.html` for staff sign-in. On first startup with an empty or missing staff file, the server creates the `admin` manager account and prints its generated password once. Set `ADMIN_PASSWORD` to a private password of at least 10 characters before first startup to supply it yourself. Later restarts use the saved account.

Managers can create accounts, reset passwords and deactivate or reactivate accounts. Front desk staff can manage bookings and orders and see the summary cards. Kitchen staff can manage orders. Staff can change their own passwords from the dashboard. Sessions expire two hours after sign-in, even during activity. Restarting the server ends all sessions.

## Hotel operations

- **Guest site (`/`)**: search room availability, view a price breakdown, book and look up/cancel a reservation, and order food for pickup or delivery to an in-house guest.
- **Front desk (`/admin.html`)**: view reservations and kitchen orders, then move them through permitted status transitions.
- **Dining and kitchen**: guests can order food for pickup or delivery to an in-house guest room; front-desk staff manage kitchen order statuses. The application does not record or process food payments.
- **Kitchen order states**: `RECEIVED` → `PREPARING` → `READY` → `DELIVERED`. Orders can be cancelled only while `RECEIVED`.
- **Reservation states**: `CONFIRMED` → `CHECKED_IN` → `CHECKED_OUT`; a confirmed reservation can instead become `CANCELLED` or `NO_SHOW`.

The LKR room and menu prices in `server.js` use published Sri Lankan market benchmarks reviewed on 26 November 2026. The app uses fixed base rates drawn from comparable properties and dishes.

- Nightly rates use [Radisson Collection Galle room listings](https://www.google.lk/travel/hotels/entity/CgoI2_Sa4orQioscEAE?ap=MAA&g2lb=4181926%2C4208993%2C4209588%2C4296668&gl=lk&hl=en&ts=CAEaNgoYEhQKCS9tLzBjN2wwZxIHQnVudG90YRoAEhoSFAoHCOoPEAkYBRIHCOoPEAkYBhgBMgIQACgB).
- Menu prices use published comparable dishes from [Anantara Kalutara](https://www.anantara.com/uploads/minor/anantara/documents/anantara-kalutara-resort/dining/olu/olu-a-la-carte-menu---2026.pdf), [Sol House](https://www.theonegroupofhotels.com/sol-house/wp-content/uploads/sites/5/2026/09/All-day-Breakfast.pdf), [Atmosphere](https://atmospherecmb.com/), [Gio’s Al Fresco](https://www.ubereats.com/lk/store/gios-al-fresco-by-giovannis/HHVr12fhQPmfE65untCwvw), [Table by Nyne](https://www.tablebynyne.com/menus?location=Alvis+Terrace&menu=dinner-menu), [Jetwing Colombo Seven](https://www.jetwinghotels.com/jetwingcolomboseven/wp-content/uploads/sites/4/2024/11/57-a-la-carte-menu.pdf), [Wildish](https://wildish.lk/menu.php), [Cassandra Resorts](https://www.cassandraresorts.com/Menu), and [Flavour Lab](https://flavourlab.edu.lk/food-beverage.html).
- New quotes use the [standard Sri Lankan VAT rate of 18%](https://www.ird.gov.lk/en/publications/SitePages/Tax_Chart_2425.aspx). USD display estimates use the [indicative rate of LKR 332.58 per USD on 26 November 2026](https://p2p.lk/rates). Confirm the property’s actual rates and applicable tax treatment before using the system for real transactions.

## Storage and notifications

The app supports local JSON storage and Supabase-hosted PostgreSQL storage. Local JSON remains the default unless `STORAGE_DRIVER=supabase` is configured. The smoke tests explicitly use the local driver.

To connect Supabase:

1. If `.env` does not exist, copy `.env.example` to `.env`. Open **Connect** in the Supabase Dashboard, select **Session pooler**, and set `DATABASE_URL` in `.env` to the PostgreSQL URI. Replace the password placeholder with the percent-encoded database password. The Session pooler works on IPv4 networks and uses port 5432. A direct connection URI also works on a network that can reach the project's direct endpoint.
2. In the Supabase SQL Editor, run [`supabase/migrations/20261126000100_hotel_tables.sql`](./supabase/migrations/20261126000100_hotel_tables.sql). This creates isolated `hotel_bookings` and `hotel_orders` tables and prevents overlapping active reservations for the same room.
3. Keep `STORAGE_DRIVER=supabase` in `.env`, then run `npm start`. The server checks its database connection and required tables at startup.

Never commit `.env` or expose `DATABASE_URL` in browser code. Use the database connection URI from Supabase, not a browser anon key. Existing `data/db.json` records are not copied to Supabase; switching drivers leaves the local files untouched and starts with the records already in the selected store. Room and menu catalogs remain application-defined. Staff credentials and audit events remain in the local `data/` directory. Keep that directory on a persistent volume and back it up. Use one app instance because staff sessions and rate limits are kept in memory.

Confirmation and order notification HTML is written to `outbox/`; **email is not sent**. Configure a real email provider and delivery monitoring before telling guests that an email has been sent.

Runtime database and outbox files are now ignored and removed from the current Git index; the local files are preserved. Removing them from the latest revision does not erase older Git history. If this repository was pushed or shared, purge the exposed data from repository history and treat the guest data as disclosed.

## Security and production deployment

Install production dependencies with `npm ci --omit=dev` and start the server with `npm start`. Serve it over HTTPS through your hosting provider or a TLS reverse proxy. `NODE_ENV=production` enables Secure staff cookies and HSTS. Set `ADMIN_PASSWORD` through your host’s secret settings when starting with a fresh staff store.

Use the host-provided `PORT` and set `HOST=0.0.0.0` if the hosting platform connects from outside the app container. For a reverse proxy on the same machine, use `HOST=127.0.0.1`. Set `TRUSTED_PROXY_IP` only for an immediate trusted proxy that overwrites or appends the real client IP to `X-Forwarded-For`. Configure persistent paths with `DATA_DIR` and `OUTBOX_DIR`.

Use `GET /api/health` for the host’s readiness check. It returns 200 when storage is reachable and 503 when it is unavailable. The demo guide is available locally with `/?demo=1`.

`data/staff.json` stores account records and salted scrypt password hashes. `data/audit.log` records sign-in attempts, sign-outs, and staff changes as JSON lines. Staff POSTs require `x-requested-with: olu`, and the staff page runs external scripts from the same origin. Five failed sign-ins from an address impose a 15-minute lockout. Sign-in, booking creation and order creation share a limit of 15 requests per minute per address. Staff behind one address share these limits.

Account recovery uses a manager password reset. For a local installation with no accessible manager, stop the server and run `node server.js --reset-admin-password` from the project folder. The command updates the active `admin` account and prints a temporary password. Restart the server, sign in as `admin`, and use **Change password**. The app has no password recovery email or two-step verification.

Online card payments are **not implemented**. Guest reservations are payable at the hotel, and the application does not record payments. Do not collect card numbers in this application. Use a compliant payment provider and verified webhooks if online payments are required.

## Tests

Run the integration smoke tests with:

```powershell
npm test
```
