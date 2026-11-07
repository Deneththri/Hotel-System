// Olu - hotel booking & confirmation server. Zero dependencies: run `node server.js`
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1', TAX = 0.12;
const PRODUCTION = process.env.NODE_ENV === 'production';
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('PORT must be a valid TCP port.');
if (process.env.ADMIN_KEY && process.env.ADMIN_KEY.length < (PRODUCTION ? 32 : 16)) {
  throw new Error(`ADMIN_KEY must be at least ${PRODUCTION ? 32 : 16} characters.`);
}
if (PRODUCTION && !process.env.ADMIN_KEY) throw new Error('Production requires a unique ADMIN_KEY of at least 32 characters.');
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(32).toString('hex');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OUT_DIR = process.env.OUTBOX_DIR || path.join(__dirname, 'outbox');
const DB = path.join(DATA_DIR, 'db.json'), PUB = path.join(__dirname, 'public');
const SESSION_COOKIE = 'olu_staff_session', SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map(), requestLimits = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true }); fs.mkdirSync(OUT_DIR, { recursive: true });

const MENU = [
  { id: 'burrata', cat: 'Starters', icon: '🍅', name: 'Burrata & Heirloom Tomato', desc: 'Basil oil, aged balsamic, warm focaccia.', price: 14 },
  { id: 'soup', cat: 'Starters', icon: '🍲', name: 'Roasted Pumpkin Soup', desc: 'Coconut cream and toasted pumpkin seeds.', price: 9 },
  { id: 'seabass', cat: 'Mains', icon: '🐟', name: 'Grilled Sea Bass', desc: 'Lemon butter, garden greens, saffron potatoes.', price: 28 },
  { id: 'risotto', cat: 'Mains', icon: '🍄', name: 'Truffle Mushroom Risotto', desc: 'Wild mushrooms, parmesan, black truffle.', price: 24 },
  { id: 'curry', cat: 'Mains', icon: '🍛', name: 'Rice & Curry Platter', desc: 'Five Sri Lankan curries, sambol and papadum.', price: 16 },
  { id: 'burger', cat: 'Mains', icon: '🍔', name: 'Wagyu Burger', desc: 'Brioche bun, aged cheddar, hand-cut fries.', price: 26 },
  { id: 'fondant', cat: 'Desserts', icon: '🍫', name: 'Chocolate Fondant', desc: 'Warm centre with vanilla bean ice cream.', price: 12 },
  { id: 'watalappan', cat: 'Desserts', icon: '🍮', name: 'Watalappan', desc: 'Coconut custard with jaggery and cardamom.', price: 8 },
  { id: 'lime', cat: 'Drinks', icon: '🍋', name: 'Fresh Lime Soda', desc: 'Sweet, salty or mixed.', price: 5 },
  { id: 'tea', cat: 'Drinks', icon: '🍵', name: 'Ceylon Tea Pot', desc: 'Single-estate leaf tea for two.', price: 6 },
  { id: 'mocktail', cat: 'Drinks', icon: '🍹', name: 'Sparkling Mocktail', desc: 'Passion fruit, mint and ginger.', price: 9 }];
const seed = {
  bookings: [], orders: [], menu: MENU, types: [
    { id: 'garden', name: 'Garden Room', price: 120, capacity: 2, count: 5, base: 100, tone: 't1', desc: 'A calm retreat overlooking the courtyard garden.', features: ['King bed', 'Garden view', 'Rain shower'] },
    { id: 'ocean', name: 'Ocean Suite', price: 210, capacity: 3, count: 4, base: 200, tone: 't2', desc: 'Sunrise views, a private balcony and a soaking tub.', features: ['Sea view', 'Balcony', 'Lounge area'] },
    { id: 'royal', name: 'Royal Penthouse', price: 420, capacity: 4, count: 2, base: 300, tone: 't3', desc: 'Two bedrooms, a terrace and a personal butler.', features: ['2 bedrooms', 'Terrace', 'Butler service'] }]
};
const load = () => {
  let d;
  try { d = JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    d = JSON.parse(JSON.stringify(seed)); save(d);
  }
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.bookings) || !Array.isArray(d.types)) {
    throw new Error('The hotel data file has an invalid structure.');
  }
  d.menu = d.menu || seed.menu; d.orders = d.orders || [];
  if (!Array.isArray(d.menu) || !Array.isArray(d.orders)) throw new Error('The hotel data file has an invalid structure.');
  return d;
};
const save = d => {
  const tmp = `${DB}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB);
};

const ACTIVE = ['CONFIRMED', 'CHECKED_IN'];
const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const today = () => new Date().toISOString().slice(0, 10);
const overlaps = (b, i, o) => b.checkIn < o && i < b.checkOut;
const takenRooms = (db, type, i, o) => db.bookings.filter(b => b.typeId === type.id && ACTIVE.includes(b.status) && overlaps(b, i, o)).map(b => b.room);
const freeRooms = (db, t, i, o) => Array.from({ length: t.count }, (_, k) => t.base + k + 1).filter(r => !takenRooms(db, t, i, o).includes(r));
const price = (t, n) => { const sub = t.price * n, tax = +(sub * TAX).toFixed(2); return { nights: n, subtotal: sub, tax, total: +(sub + tax).toFixed(2) }; };
function checkDates(i, o) {
  if (!validISODate(i) || !validISODate(o)) return 'Please choose valid dates.';
  if (i < today()) return 'Check-in cannot be in the past.';
  const n = nights(i, o); if (!(n >= 1)) return 'Check-out must be after check-in.'; if (n > 30) return 'Stays are limited to 30 nights.';
}
const pub = b => ({ reference: b.reference, status: b.status, guest: b.guest, email: b.email, room: b.room, roomName: b.roomName, checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, pricing: b.pricing, payment: b.payment === 'PAID (demo)' ? 'PAY AT HOTEL' : b.payment, requests: b.requests, createdAt: b.createdAt });
const formatRs = n => `Rs ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const validName = value => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80;
const validISODate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const makeReference = (prefix, records) => {
  let value;
  do { value = `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`; }
  while (records.some(record => record.reference === value || record.id === value));
  return value;
};
function allowRequest(req, action, max, windowMs) {
  const now = Date.now(), key = `${req.socket.remoteAddress || 'unknown'}:${action}`;
  let entry = requestLimits.get(key);
  if (!entry || entry.expiresAt <= now) entry = { count: 0, expiresAt: now + windowMs };
  entry.count += 1; requestLimits.set(key, entry);
  if (requestLimits.size > 10000) {
    for (const [id, limit] of requestLimits) if (limit.expiresAt <= now) requestLimits.delete(id);
  }
  return entry.count <= max;
}
function readSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie && cookie.slice(SESSION_COOKIE.length + 1);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return token;
}
function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${PRODUCTION ? '; Secure' : ''}`;
}
const isValidStaffKey = candidate => typeof candidate === 'string' && crypto.timingSafeEqual(
  crypto.createHash('sha256').update(candidate).digest(),
  crypto.createHash('sha256').update(ADMIN_KEY).digest()
);

function sendEmail(b) { // Demo "email": saved as HTML in /outbox. Swap for SMTP/SendGrid/SES in production.
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;background:#eaf1ef;color:#1e3b3f"><h1>Booking confirmed</h1><p>Dear ${esc(b.guest)}, we look forward to welcoming you.</p><p><b>Reference:</b> ${b.reference}<br><b>Room:</b> ${esc(b.roomName)} (#${b.room})<br><b>Stay:</b> ${b.checkIn} to ${b.checkOut} (${b.pricing.nights} nights)<br><b>Total:</b> ${formatRs(b.pricing.total)}</p><p>Olu</p></div>`;
  fs.writeFileSync(path.join(OUT_DIR, `${b.reference}.html`), html); console.log(`Confirmation email written: outbox/${b.reference}.html`);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mailOrder(o, kind) {
  if (!o.email) return;
  const ready = kind === 'ready', where = o.room ? `It is on its way to room ${o.room}.` : 'Please collect it at the restaurant.';
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;background:#eaf1ef;color:#1e3b3f"><h1>${ready ? 'Your order is ready' : 'Order confirmed'}</h1><p>Dear ${esc(o.guest)}, ${ready ? where : 'we have received your order. We will email you when it is ready.'}</p><p><b>Order:</b> ${o.reference}<br>${o.lines.map(l => `${l.qty} x ${esc(l.name)}`).join('<br>')}<br><b>Total:</b> ${formatRs(o.pricing.total)}</p><p>Olu</p></div>`;
  fs.writeFileSync(path.join(OUT_DIR, `${o.reference}-${kind}.html`), html); console.log(`Order ${kind} email written: outbox/${o.reference}-${kind}.html`);
}
function setStatus(db, o, s) {
  o.status = s; o.history.push({ status: s, at: new Date().toISOString() });
  if (s === 'READY') mailOrder(o, 'ready');
}
const orderBookingRef = o => o.bookingRef || o.billingBookingRef;
const hasPendingRoomOrders = (db, bookingRef) => db.orders.some(o => orderBookingRef(o) === bookingRef && !['DELIVERED', 'CANCELLED'].includes(o.status));

function api(req, url, body) {
  const p = url.pathname, q = url.searchParams, m = req.method;
  if (p === '/api/admin/session') {
    if (m === 'POST') {
      if (!allowRequest(req, 'staff-login', 10, 15 * 60 * 1000)) return [429, { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }];
      if (!isValidStaffKey(body.key)) return [401, { error: 'Incorrect staff key.' }];
      const now = Date.now();
      for (const [session, details] of sessions) if (details.expiresAt <= now) sessions.delete(session);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { expiresAt: now + SESSION_TTL });
      return [200, { authenticated: true }, { 'Set-Cookie': sessionCookie(token, SESSION_TTL / 1000) }];
    }
    if (m === 'GET') return [200, { authenticated: Boolean(readSession(req)) }];
  }
  if (p === '/api/admin/session/logout' && m === 'POST') {
    const token = readSession(req);
    if (token) sessions.delete(token);
    return [200, { authenticated: false }, { 'Set-Cookie': sessionCookie('', 0) }];
  }
  if (p.startsWith('/api/admin/')) {
    if (!readSession(req)) return [401, { error: 'Staff sign-in required.' }];
  }
  const db = load();
  if (m === 'GET' && p === '/api/availability') {
    const i = q.get('checkIn'), o = q.get('checkOut'), g = q.has('guests') ? Number(q.get('guests')) : 1, err = checkDates(i, o); if (err) return [400, { error: err }];
    if (!Number.isInteger(g) || g < 1 || g > 20) return [400, { error: 'Please choose a valid number of guests.' }];
    const n = nights(i, o);
    return [200, { rooms: db.types.filter(t => t.capacity >= g).map(t => ({ ...t, left: freeRooms(db, t, i, o).length, pricing: price(t, n) })) }];
  }
  if (m === 'POST' && p === '/api/bookings') {
    const { typeId, checkIn, checkOut, name, email, phone, guests = 1, requests = '', payment = 'pay_at_hotel' } = body;
    if (!allowRequest(req, 'booking-create', 10, 60 * 1000)) return [429, { error: 'Too many booking attempts. Please wait a moment and try again.' }];
    const err = checkDates(checkIn, checkOut); if (err) return [400, { error: err }];
    const t = db.types.find(x => x.id === typeId); if (!t) return [400, { error: 'Please choose a room.' }];
    if (!validName(name)) return [400, { error: 'Please enter your full name (2 to 80 characters).' }];
    if (!validEmail(email)) return [400, { error: 'Please enter a valid email address.' }];
    if (!Number.isInteger(guests) || guests < 1 || guests > t.capacity) return [400, { error: `This room sleeps up to ${t.capacity} guests.` }];
    if (phone !== undefined && (typeof phone !== 'string' || phone.length > 30)) return [400, { error: 'Please enter a valid phone number.' }];
    if (typeof requests !== 'string' || requests.length > 400) return [400, { error: 'Special requests must be 400 characters or fewer.' }];
    if (payment !== 'pay_at_hotel') return [400, { error: 'Online payments are not available. Please pay at the hotel.' }];
    const free = freeRooms(db, t, checkIn, checkOut); // single-threaded: check + write is atomic
    if (!free.length) return [409, { error: 'Sorry, that room was just taken. Please pick other dates or a different room.' }];
    const b = {
      reference: makeReference('OL', db.bookings), status: 'CONFIRMED', typeId, roomName: t.name, room: free[0],
      guest: name.trim().slice(0, 80), email: email.trim().toLowerCase(), phone: String(phone || '').slice(0, 30), requests: String(requests).slice(0, 400),
      checkIn, checkOut, guests, pricing: price(t, nights(checkIn, checkOut)), payment: 'PAY AT HOTEL', createdAt: new Date().toISOString()
    };
    db.bookings.push(b); save(db); sendEmail(b); return [201, { booking: pub(b) }];
  }
  let r = p.match(/^\/api\/bookings\/([\w-]+)(\/cancel)?$/);
  if (r) {
    if (!allowRequest(req, 'booking-lookup', 600, 15 * 60 * 1000)) return [429, { error: 'Too many booking lookups. Please wait and try again.' }];
    const b = db.bookings.find(x => x.reference === r[1].toUpperCase());
    if (!b || b.email !== (q.get('email') || body.email || '').trim().toLowerCase()) return [404, { error: 'We could not find a booking with those details.' }];
    if (m === 'GET' && !r[2]) return [200, { booking: pub(b) }];
    if (m === 'POST' && r[2]) {
      if (b.status !== 'CONFIRMED' || b.checkIn < today() || hasPendingRoomOrders(db, b.reference)) return [409, { error: 'This booking can no longer be cancelled online. Resolve any pending room orders or contact the front desk.' }];
      b.status = 'CANCELLED'; save(db); return [200, { booking: pub(b) }];
    }
  }
  if (p.startsWith('/api/admin/')) {
    if (m === 'GET' && p === '/api/admin/orders') return [200, { orders: db.orders.slice().reverse() }];
    r = p.match(/^\/api\/admin\/orders\/([\w-]+)\/status$/);
    if (m === 'POST' && r) {
      const o = db.orders.find(x => x.reference === r[1]);
      if (!o || !['RECEIVED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'].includes(body.status)) return [400, { error: 'Invalid request.' }];
      const transitions = { RECEIVED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY'], READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [] };
      if (o.status !== body.status && !transitions[o.status]?.includes(body.status)) return [409, { error: `An order cannot move from ${o.status} to ${body.status}.` }];
      if (o.status !== body.status && body.status === 'DELIVERED' && orderBookingRef(o)) {
        const booking = db.bookings.find(x => x.reference === orderBookingRef(o));
        if (!booking || !['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(booking.status)) return [409, { error: 'This room order is no longer linked to an active guest booking. Contact the front desk.' }];
      }
      if (o.status !== body.status) setStatus(db, o, body.status); save(db); return [200, { order: o }];
    }
    if (m === 'GET' && p === '/api/admin/bookings') return [200, { bookings: db.bookings.slice().reverse() }];
    r = p.match(/^\/api\/admin\/bookings\/([\w-]+)\/status$/);
    if (m === 'POST' && r) {
      const b = db.bookings.find(x => x.reference === r[1]);
      if (!b || !['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(body.status)) return [400, { error: 'Invalid request.' }];
      const transitions = { CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'], CHECKED_IN: ['CHECKED_OUT'], CHECKED_OUT: [], CANCELLED: [], NO_SHOW: [] };
      if (b.status !== body.status && !transitions[b.status]?.includes(body.status)) return [409, { error: `A booking cannot move from ${b.status} to ${body.status}.` }];
      if (b.status !== body.status && ['CANCELLED', 'NO_SHOW'].includes(body.status) && hasPendingRoomOrders(db, b.reference)) return [409, { error: 'Resolve pending room orders before cancelling this booking.' }];
      b.status = body.status; save(db); return [200, { booking: b }];
    }
  }
  if (m === 'GET' && p === '/api/menu') return [200, { menu: db.menu }];
  if (m === 'POST' && p === '/api/orders') {
    const { name, email, items = [], note = '', bookingRef = '' } = body;
    if (!allowRequest(req, 'order-create', 20, 60 * 1000)) return [429, { error: 'Too many orders were submitted. Please wait a moment and try again.' }];
    if (!validName(name)) return [400, { error: 'Please enter your full name (2 to 80 characters).' }];
    if (!validEmail(email)) return [400, { error: 'Please enter a valid email address.' }];
    if (!Array.isArray(items) || items.length > 50 || items.some(i => !i || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 20)) return [400, { error: 'Your order contains invalid items or quantities.' }];
    if (typeof note !== 'string' || note.length > 300) return [400, { error: 'Kitchen notes must be 300 characters or fewer.' }];
    if (typeof bookingRef !== 'string') return [400, { error: 'Please enter a valid booking reference.' }];
    const lines = items.map(i => { const it = db.menu.find(x => x.id === i.id); return it ? { id: it.id, name: it.name, price: it.price, qty: i.qty } : null; });
    if (lines.some(line => !line)) return [400, { error: 'Your order contains an unavailable menu item.' }];
    if (!lines.length) return [400, { error: 'Your order is empty. Add something from the menu.' }];
    let room = null;
    if (bookingRef.trim()) {
      const b = db.bookings.find(x => x.reference === bookingRef.trim().toUpperCase() && x.email === email.trim().toLowerCase() && ACTIVE.includes(x.status) && x.checkIn <= today() && today() < x.checkOut);
      if (!b) return [400, { error: 'That booking reference and email do not match an in-house booking. Check them, or clear the reference to collect at the restaurant.' }];
      room = b.room;
    }
    const sub = +lines.reduce((s, l) => s + l.price * l.qty, 0).toFixed(2), tax = +(sub * TAX).toFixed(2), now = new Date().toISOString();
    const o = {
      reference: makeReference('FO', db.orders), status: 'RECEIVED', guest: name.trim(), email: email.trim().toLowerCase(), room, bookingRef: room ? bookingRef.trim().toUpperCase() : null, lines,
      note: String(note).slice(0, 300), pricing: { subtotal: sub, tax, total: +(sub + tax).toFixed(2) }, createdAt: now, history: [{ status: 'RECEIVED', at: now }]
    };
    db.orders.push(o); save(db); mailOrder(o, 'confirmed'); return [201, { order: o }];
  }
  r = p.match(/^\/api\/orders\/([\w-]+)(\/cancel)?$/);
  if (r) {
    if (!allowRequest(req, 'order-lookup', 600, 15 * 60 * 1000)) return [429, { error: 'Too many order lookups. Please wait and try again.' }];
    const o = db.orders.find(x => x.reference === r[1].toUpperCase());
    if (!o || o.email !== (q.get('email') || body.email || '').trim().toLowerCase()) return [404, { error: 'We could not find an order with those details.' }];
    if (m === 'GET' && !r[2]) return [200, { order: o }];
    if (m === 'POST' && r[2]) { if (o.status !== 'RECEIVED') return [409, { error: 'The kitchen has already started this order, so it can no longer be cancelled.' }]; setStatus(db, o, 'CANCELLED'); save(db); return [200, { order: o }]; }
  }
  return [404, { error: 'Not found' }];
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'; connect-src 'self'"
};
if (PRODUCTION) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000';
const server = http.createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  const url = new URL(req.url, 'http://localhost');
  const send = (status, payload, headers = {}) => {
    if (res.writableEnded) return;
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(payload));
  };
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return send(415, { error: 'Requests must use application/json.' });
    }
    const chunks = [];
    let size = 0, tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 20000) { tooLarge = true; chunks.length = 0; }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return send(413, { error: 'Request body is too large.' });
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); }
        catch { return send(400, { error: 'Request body must be valid JSON.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Request body must be a JSON object.' });
      }
      try {
        const [status, payload, headers] = api(req, url, body);
        send(status, payload, headers);
      } catch (error) {
        console.error('Request failed:', error);
        send(500, { error: 'Something went wrong. Please try again.' });
      }
    });
    req.on('error', () => send(400, { error: 'The request could not be read.' }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
    return res.end('Method not allowed');
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
    return res.end('Invalid path');
  }
  const file = path.resolve(PUB, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.relative(PUB, file);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': path.extname(file).toLowerCase() === '.html' ? 'no-store' : 'no-cache'
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (res.headersSent) res.destroy();
    else send(500, { error: 'The requested file could not be read.' });
  });
  stream.pipe(res);
});
server.requestTimeout = 30000;
server.headersTimeout = 60000;
server.listen(PORT, HOST, () => {
  const address = server.address();
  const displayHost = address.address.includes(':') ? `[${address.address}]` : address.address;
  console.log(`Olu running at http://${displayHost}:${address.port} (admin: /admin.html)`);
  if (!process.env.ADMIN_KEY && !PRODUCTION) console.log(`Development-only staff key: ${ADMIN_KEY}`);
});