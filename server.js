// Olu - hotel booking & confirmation server. Zero dependencies: run `node server.js`
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, ADMIN_KEY = process.env.ADMIN_KEY || 'admin123', TAX = 0.12;
const DB = path.join(__dirname, 'data', 'db.json'), PUB = path.join(__dirname, 'public'), OUT = path.join(__dirname, 'outbox');
fs.mkdirSync(path.dirname(DB), { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

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
const load = () => { let d; try { d = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { d = JSON.parse(JSON.stringify(seed)); save(d); } d.menu = d.menu || seed.menu; d.orders = d.orders || []; d.sales = d.sales || []; return d; };
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));

const ACTIVE = ['CONFIRMED', 'CHECKED_IN'];
const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const today = () => new Date().toISOString().slice(0, 10);
const overlaps = (b, i, o) => b.checkIn < o && i < b.checkOut;
const takenRooms = (db, type, i, o) => db.bookings.filter(b => b.typeId === type.id && ACTIVE.includes(b.status) && overlaps(b, i, o)).map(b => b.room);
const freeRooms = (db, t, i, o) => Array.from({ length: t.count }, (_, k) => t.base + k + 1).filter(r => !takenRooms(db, t, i, o).includes(r));
const price = (t, n) => { const sub = t.price * n, tax = +(sub * TAX).toFixed(2); return { nights: n, subtotal: sub, tax, total: +(sub + tax).toFixed(2) }; };
function checkDates(i, o) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i || '') || !/^\d{4}-\d{2}-\d{2}$/.test(o || '')) return 'Please choose valid dates.';
  if (i < today()) return 'Check-in cannot be in the past.';
  const n = nights(i, o); if (!(n >= 1)) return 'Check-out must be after check-in.'; if (n > 30) return 'Stays are limited to 30 nights.';
}
const pub = b => ({ reference: b.reference, status: b.status, guest: b.guest, email: b.email, room: b.room, roomName: b.roomName, checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, pricing: b.pricing, payment: b.payment, requests: b.requests, createdAt: b.createdAt });
const formatRs = n => `Rs ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function sendEmail(b) { // Demo "email": saved as HTML in /outbox. Swap for SMTP/SendGrid/SES in production.
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;background:#eaf1ef;color:#1e3b3f"><h1>Booking confirmed</h1><p>Dear ${esc(b.guest)}, we look forward to welcoming you.</p><p><b>Reference:</b> ${b.reference}<br><b>Room:</b> ${esc(b.roomName)} (#${b.room})<br><b>Stay:</b> ${b.checkIn} to ${b.checkOut} (${b.pricing.nights} nights)<br><b>Total:</b> ${formatRs(b.pricing.total)}</p><p>Olu</p></div>`;
  fs.writeFileSync(path.join(OUT, `${b.reference}.html`), html); console.log(`Confirmation email written: outbox/${b.reference}.html -> ${b.email}`);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ld = d => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // local date
function mailOrder(o, kind) {
  if (!o.email) return; // POS walk-in orders have no email // Demo emails saved in /outbox. Swap for SMTP/SendGrid/SES in production.
  const ready = kind === 'ready', where = o.room ? `It is on its way to room ${o.room}.` : 'Please collect it at the restaurant.';
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;background:#eaf1ef;color:#1e3b3f"><h1>${ready ? 'Your order is ready' : 'Order confirmed'}</h1><p>Dear ${esc(o.guest)}, ${ready ? where : 'we have received your order. We will email you when it is ready.'}</p><p><b>Order:</b> ${o.reference}<br>${o.lines.map(l => `${l.qty} x ${esc(l.name)}`).join('<br>')}<br><b>Total:</b> ${formatRs(o.pricing.total)}</p><p>Olu</p></div>`;
  fs.writeFileSync(path.join(OUT, `${o.reference}-${kind}.html`), html); console.log(`Order ${kind} email written: outbox/${o.reference}-${kind}.html -> ${o.email}`);
}
function setStatus(o, s) { o.status = s; o.history.push({ status: s, at: new Date().toISOString() }); if (s === 'READY') mailOrder(o, 'ready'); }

function api(req, url, body) {
  const db = load(), p = url.pathname, q = url.searchParams, m = req.method;
  if (m === 'GET' && p === '/api/availability') {
    const i = q.get('checkIn'), o = q.get('checkOut'), g = +q.get('guests') || 1, err = checkDates(i, o); if (err) return [400, { error: err }];
    const n = nights(i, o);
    return [200, { rooms: db.types.filter(t => t.capacity >= g).map(t => ({ ...t, left: freeRooms(db, t, i, o).length, pricing: price(t, n) })) }];
  }
  if (m === 'POST' && p === '/api/bookings') {
    const { typeId, checkIn, checkOut, name, email, phone, guests = 1, requests = '', payment = 'pay_at_hotel' } = body;
    const err = checkDates(checkIn, checkOut); if (err) return [400, { error: err }];
    const t = db.types.find(x => x.id === typeId); if (!t) return [400, { error: 'Please choose a room.' }];
    if (!name || name.trim().length < 2) return [400, { error: 'Please enter your full name.' }];
    if (!/^\S+@\S+\.\S+$/.test(email || '')) return [400, { error: 'Please enter a valid email address.' }];
    if (!(guests >= 1 && guests <= t.capacity)) return [400, { error: `This room sleeps up to ${t.capacity} guests.` }];
    const free = freeRooms(db, t, checkIn, checkOut); // single-threaded: check + write is atomic
    if (!free.length) return [409, { error: 'Sorry, that room was just taken. Please pick other dates or a different room.' }];
    const b = {
      reference: 'OL-' + crypto.randomBytes(3).toString('hex').toUpperCase(), status: 'CONFIRMED', typeId, roomName: t.name, room: free[0],
      guest: name.trim().slice(0, 80), email: email.trim().toLowerCase(), phone: String(phone || '').slice(0, 30), requests: String(requests).slice(0, 400),
      checkIn, checkOut, guests, pricing: price(t, nights(checkIn, checkOut)), payment: payment === 'card_demo' ? 'PAID (demo)' : 'PAY AT HOTEL', createdAt: new Date().toISOString()
    };
    db.bookings.push(b); save(db); sendEmail(b); return [201, { booking: pub(b) }];
  }
  let r = p.match(/^\/api\/bookings\/([\w-]+)(\/cancel)?$/);
  if (r) {
    const b = db.bookings.find(x => x.reference === r[1].toUpperCase());
    if (!b || b.email !== (q.get('email') || body.email || '').trim().toLowerCase()) return [404, { error: 'We could not find a booking with those details.' }];
    if (m === 'GET' && !r[2]) return [200, { booking: pub(b) }];
    if (m === 'POST' && r[2]) {
      if (b.status !== 'CONFIRMED') return [409, { error: 'This booking can no longer be cancelled online.' }];
      b.status = 'CANCELLED'; save(db); return [200, { booking: pub(b) }];
    }
  }
  if (p.startsWith('/api/admin/')) {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return [401, { error: 'Incorrect admin key.' }];
    // ---------- POS ----------
    if (m === 'POST' && p === '/api/admin/pos/sale') {
      const { items = [], method, bookingRef = '', discountPct = 0, tendered = 0 } = body;
      const lines = (Array.isArray(items) ? items : []).map(i => { const it = db.menu.find(x => x.id === i.id), qn = Math.floor(+i.qty); return it && qn >= 1 && qn <= 50 ? { id: it.id, name: it.name, price: it.price, qty: qn } : null; }).filter(Boolean);
      if (!lines.length) return [400, { error: 'The ticket is empty.' }];
      if (!['cash', 'card', 'room'].includes(method)) return [400, { error: 'Choose a payment method.' }];
      const disc = Math.min(50, Math.max(0, +discountPct || 0));
      const sub = +lines.reduce((t, l) => t + l.price * l.qty, 0).toFixed(2), off = +(sub * disc / 100).toFixed(2), tax = +((sub - off) * TAX).toFixed(2), total = +(sub - off + tax).toFixed(2);
      let b = null;
      if (method === 'room') { b = db.bookings.find(x => x.reference === bookingRef && ACTIVE.includes(x.status)); if (!b) return [400, { error: 'Pick a guest who is staying with us to charge to a room.' }]; }
      if (method === 'cash' && !(+tendered >= total)) return [400, { error: `Cash received is less than the total (${total.toFixed(2)}).` }];
      const now = new Date().toISOString();
      const sale = { id: 'S-' + crypto.randomBytes(3).toString('hex').toUpperCase(), at: now, lines, discountPct: disc, pricing: { subtotal: sub, discount: off, tax, total }, method, room: b ? b.room : null, bookingRef: b ? b.reference : null, change: method === 'cash' ? +(tendered - total).toFixed(2) : 0 };
      db.sales.push(sale);
      if (b) { b.charges = b.charges || []; b.charges.push({ saleId: sale.id, at: now, desc: lines.map(l => `${l.qty} x ${l.name}`).join(', '), amount: total }); }
      db.orders.push({ reference: 'FO-' + crypto.randomBytes(3).toString('hex').toUpperCase(), status: 'RECEIVED', guest: b ? b.guest : 'Walk-in', email: '', room: b ? b.room : null, lines, note: 'POS ' + sale.id, pricing: { subtotal: sub, tax, total }, createdAt: now, history: [{ status: 'RECEIVED', at: now }] });
      save(db); return [201, { sale }];
    }
    r = p.match(/^\/api\/admin\/bill\/([\w-]+)$/);
    if (m === 'POST' && r) {
      const b = db.bookings.find(x => x.reference === r[1]); if (!b) return [404, { error: 'Booking not found.' }];
      if (b.settled) return [409, { error: 'This bill is already settled.' }];
      if (!['cash', 'card'].includes(body.method)) return [400, { error: 'Choose cash or card.' }];
      b.settled = { method: body.method, at: new Date().toISOString(), total: +(b.pricing.total + (b.charges || []).reduce((t, c) => t + c.amount, 0)).toFixed(2) };
      save(db); return [200, { settled: b.settled }];
    }
    if (m === 'GET' && p === '/api/admin/report') {
      const day = q.get('date') || ld(new Date()), sales = db.sales.filter(x => ld(x.at) === day), by = { cash: 0, card: 0, room: 0 }, top = {};
      sales.forEach(x => { by[x.method] += x.pricing.total; x.lines.forEach(l => { top[l.name] = (top[l.name] || 0) + l.qty; }); });
      const live = db.bookings.filter(b => !['CANCELLED', 'NO_SHOW'].includes(b.status));
      return [200, {
        date: day, count: sales.length, total: +(by.cash + by.card + by.room).toFixed(2), by, top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5),
        inHouse: live.filter(b => b.checkIn <= day && day < b.checkOut).length, totalRooms: db.types.reduce((t, x) => t + x.count, 0),
        unsettled: +live.filter(b => !b.settled).reduce((t, b) => t + (b.charges || []).reduce((a, c) => a + c.amount, 0), 0).toFixed(2)
      }];
    }
    if (m === 'GET' && p === '/api/admin/orders') return [200, { orders: db.orders.slice().reverse() }];
    r = p.match(/^\/api\/admin\/orders\/([\w-]+)\/status$/);
    if (m === 'POST' && r) {
      const o = db.orders.find(x => x.reference === r[1]);
      if (!o || !['RECEIVED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'].includes(body.status)) return [400, { error: 'Invalid request.' }];
      if (o.status !== body.status) setStatus(o, body.status); save(db); return [200, { order: o }];
    }
    if (m === 'GET' && p === '/api/admin/bookings') return [200, { bookings: db.bookings.slice().reverse() }];
    r = p.match(/^\/api\/admin\/bookings\/([\w-]+)\/status$/);
    if (m === 'POST' && r) {
      const b = db.bookings.find(x => x.reference === r[1]);
      if (!b || !['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(body.status)) return [400, { error: 'Invalid request.' }];
      b.status = body.status; save(db); return [200, { booking: b }];
    }
  }
  if (m === 'GET' && p === '/api/menu') return [200, { menu: db.menu }];
  if (m === 'POST' && p === '/api/orders') {
    const { name, email, items = [], note = '', bookingRef = '' } = body;
    if (!name || name.trim().length < 2) return [400, { error: 'Please enter your full name.' }];
    if (!/^\S+@\S+\.\S+$/.test(email || '')) return [400, { error: 'Please enter a valid email address.' }];
    const lines = (Array.isArray(items) ? items : []).map(i => { const it = db.menu.find(x => x.id === i.id), q = Math.floor(+i.qty); return it && q >= 1 && q <= 20 ? { id: it.id, name: it.name, price: it.price, qty: q } : null; }).filter(Boolean);
    if (!lines.length) return [400, { error: 'Your order is empty. Add something from the menu.' }];
    let room = null;
    if (bookingRef.trim()) {
      const b = db.bookings.find(x => x.reference === bookingRef.trim().toUpperCase() && x.email === email.trim().toLowerCase() && ACTIVE.includes(x.status));
      if (!b) return [400, { error: 'That booking reference and email do not match an active booking. Check them, or clear the reference to collect at the restaurant.' }];
      room = b.room;
    }
    const sub = +lines.reduce((s, l) => s + l.price * l.qty, 0).toFixed(2), tax = +(sub * TAX).toFixed(2), now = new Date().toISOString();
    const o = {
      reference: 'FO-' + crypto.randomBytes(3).toString('hex').toUpperCase(), status: 'RECEIVED', guest: name.trim().slice(0, 80), email: email.trim().toLowerCase(), room, lines,
      note: String(note).slice(0, 300), pricing: { subtotal: sub, tax, total: +(sub + tax).toFixed(2) }, createdAt: now, history: [{ status: 'RECEIVED', at: now }]
    };
    db.orders.push(o); save(db); mailOrder(o, 'confirmed'); return [201, { order: o }];
  }
  r = p.match(/^\/api\/orders\/([\w-]+)(\/cancel)?$/);
  if (r) {
    const o = db.orders.find(x => x.reference === r[1].toUpperCase());
    if (!o || o.email !== (q.get('email') || body.email || '').trim().toLowerCase()) return [404, { error: 'We could not find an order with those details.' }];
    if (m === 'GET' && !r[2]) return [200, { order: o }];
    if (m === 'POST' && r[2]) { if (o.status !== 'RECEIVED') return [409, { error: 'The kitchen has already started this order, so it can no longer be cancelled.' }]; setStatus(o, 'CANCELLED'); save(db); return [200, { order: o }]; }
  }
  return [404, { error: 'Not found' }];
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (url.pathname.startsWith('/api/')) {
    let raw = ''; req.on('data', d => { raw += d; if (raw.length > 2e4) req.destroy(); });
    return req.on('end', () => { try { const [c, o] = api(req, url, raw ? JSON.parse(raw) : {}); send(c, o); } catch (e) { console.error(e); send(500, { error: 'Something went wrong. Please try again.' }); } });
  }
  const f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`Olu running at http://localhost:${PORT}  (admin: /admin.html, key: ${ADMIN_KEY})`));