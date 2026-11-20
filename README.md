# Olu Hotel Booking & Ordering

A small, dependency-free hotel application with a guest booking site, front-desk booking management, restaurant ordering, and kitchen status tracking.

## Run locally

Requires Node.js 16 or newer.

```powershell
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

The current tax rate and room/menu catalog are defined in `server.js`. Confirm applicable tax rules and prices with the hotel before using the system for real transactions.

## Storage and notifications

Runtime bookings and orders are stored in `data/db.json`. Confirmation and order notification HTML is written to `outbox/`; **email is not sent**. Configure a real email provider and delivery monitoring before telling guests that an email has been sent.

The JSON database is for a single local development process, not concurrent production traffic. It contains personal data and has no built-in database encryption, automated backups or a retention policy. Keep runtime data outside source control, restrict file-system access, encrypt backups, and use a transactional database with availability constraints before deployment.

Runtime database and outbox files are now ignored and removed from the current Git index; the local files are preserved. Removing them from the latest revision does not erase older Git history. If this repository was pushed or shared, purge the exposed data from repository history and treat the guest data as disclosed.

## Security and production deployment

Serve the app over HTTPS through a TLS reverse proxy and set `HTTPS=1` to mark the session cookie Secure. Keep the Node server bound to localhost behind the proxy unless the deployment requires a different bind address. Configure `NODE_ENV=production` to enable HSTS. `PORT`, `HOST`, `DATA_DIR`, and `OUTBOX_DIR` can be set through environment variables.

`data/staff.json` stores account records and salted scrypt password hashes. `data/audit.log` records sign-in attempts, sign-outs, and staff changes as JSON lines. Staff POSTs require `x-requested-with: olu`, and the staff page runs external scripts from the same origin. Five failed sign-ins from an address impose a 15-minute lockout. Sign-in, booking creation and order creation share a limit of 15 requests per minute per address. Staff behind one address share these limits.

Account recovery uses a manager password reset. For a local installation with no accessible manager, moving the staff file aside with the server stopped allows it to bootstrap a new account on restart. The new staff file starts with a single manager. The app has no password recovery email or two-step verification.

Online card payments are **not implemented**. Guest reservations are payable at the hotel, and the application does not record payments. Do not collect card numbers in this application. Use a compliant payment provider and verified webhooks if online payments are required.

## Tests

Run the dependency-free integration smoke tests with:

```powershell
npm test
```
