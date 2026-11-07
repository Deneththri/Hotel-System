# Olu Hotel Booking & Ordering

A small, dependency-free hotel application with a guest booking site, front-desk booking management, restaurant ordering, and kitchen status tracking.

## Run locally

Requires Node.js 16 or newer.

```powershell
npm start
```

Open `http://127.0.0.1:3000`. The server binds to localhost by default. When `ADMIN_KEY` is not set, development startup generates a temporary random staff key and prints it in the server terminal. Set a private `ADMIN_KEY` before starting if you want to keep the same development credential across restarts.

Staff sign in at `/admin.html`. Sign-in creates an eight-hour, HTTP-only, same-site session cookie; the staff key is not saved in browser storage. Restarting the process invalidates active sessions.

## Hotel operations

- **Guest site (`/`)**: search room availability, view a price breakdown, book and look up/cancel a reservation, and order food for pickup or delivery to an in-house guest.
- **Front desk (`/admin.html`)**: view reservations and kitchen orders, then move them through permitted status transitions.
- **Dining and kitchen**: guests can order food for pickup or delivery to an in-house guest room; front-desk staff manage kitchen order statuses. The application does not record or process food payments.
- **Kitchen order states**: `RECEIVED` → `PREPARING` → `READY` → `DELIVERED`. Orders can be cancelled only while `RECEIVED`.
- **Reservation states**: `CONFIRMED` → `CHECKED_IN` → `CHECKED_OUT`; a confirmed reservation can instead become `CANCELLED` or `NO_SHOW`.

The current tax rate and room/menu catalog are defined in `server.js`. Confirm applicable tax rules and prices with the hotel before using the system for real transactions.

## Storage and notifications

Runtime bookings and orders are stored in `data/db.json`. Confirmation and order notification HTML is written to `outbox/`; **email is not sent**. Configure a real email provider and delivery monitoring before telling guests that an email has been sent.

The JSON database is for a single local development process, not concurrent production traffic. It contains personal data and has no built-in database encryption, automated backups, retention policy, or multi-user audit trail. Keep runtime data outside source control, restrict file-system access, encrypt backups, and use a transactional database with availability constraints before deployment.

Runtime database and outbox files are now ignored and removed from the current Git index; the local files are preserved. Removing them from the latest revision does not erase older Git history. If this repository was pushed or shared, purge the exposed data from repository history and treat the guest data as disclosed.

## Security and production deployment

Production startup refuses to run without an `ADMIN_KEY` of at least 32 characters. Generate a unique random value and provide it through a secret manager or protected environment variable; do not commit it or put it in a deployment manifest.

For example, generate a key locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Configure `NODE_ENV=production` and `ADMIN_KEY` in the deployment environment. The production session cookie is marked `Secure`, so serve the app over HTTPS through a correctly configured TLS reverse proxy. Keep the Node server bound to localhost behind that proxy; only set `HOST=0.0.0.0` when the container/network boundary is configured intentionally. `PORT`, `HOST`, `DATA_DIR`, and `OUTBOX_DIR` can be set through environment variables.

The app also sets browser security headers, limits request sizes and sign-in attempts, validates input on the server, uses longer unpredictable booking/order references, and enforces booking/order status transitions. Its current Content Security Policy still permits inline scripts and styles to support the existing pages; move those assets to external files (or use nonces/hashes) before removing the inline allowances. These controls do not replace a production identity provider: staff currently share one key, with no individual accounts, roles, MFA, or durable audit log. Add those controls and a security review before exposing staff operations publicly.

Online card payments are **not implemented**. Guest reservations are payable at the hotel, and the application does not record payments. Do not collect card numbers in this application. Use a compliant payment provider and verified webhooks if online payments are required.

## Tests

Run the dependency-free integration smoke tests with:

```powershell
npm test
```
