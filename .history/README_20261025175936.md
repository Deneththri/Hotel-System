# Olu: Hotel Booking & Confirmation System

Zero npm dependencies. Needs only Node.js 16+.

    node server.js          # then open http://localhost:3000

- Guest site: `/` (search, reserve, instant confirmation, find/cancel booking, print voucher)
- Front desk: `/admin.html` (default key `admin123`; set `ADMIN_KEY=yourkey` to change)
- Confirmation emails are saved as HTML files in `outbox/` (replace `sendEmail()` in server.js with SMTP/SendGrid/SES)
- Data lives in `data/db.json` (delete it to reset). Rooms and prices are in the `seed` object in server.js.

## Upgrade path
Swap db.json for PostgreSQL (with a date-range exclusion constraint), add a real payment gateway (Stripe/PayHere) with webhooks, and a job queue for emails and hold expiry.

## Food ordering
- Menu is in the `MENU` array in server.js. Order flow: RECEIVED, PREPARING, READY, DELIVERED (or CANCELLED while still RECEIVED).
- Guests track the order live; when staff set READY in `/admin.html` the guest gets an on-screen alert, a chime, a browser notification, and a "ready" email (saved to `outbox/`).

## Hotel picture and info
The intro at the top of `public/index.html` (facts, amenities, text) is plain HTML, so edit it freely.
The picture is an illustration at `public/images/olu-hotel.svg`. To use a real photo, copy it to `public/images/` (jpg, png or webp) and change the `src` of the `<img>` in index.html.