// Olu - hotel booking & confirmation server.
require('dotenv').config();
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { isIP } = require('node:net');
const { Pool } = require('pg');
const PORT = Number(process.env.PORT || 3000), HOST = process.env.HOST || '127.0.0.1', TAX = 0.18;
const PRODUCTION = process.env.NODE_ENV === 'production';
const trustedProxy = process.env.TRUSTED_PROXY_IP;
if (trustedProxy && !isIP(trustedProxy)) throw new Error('TRUSTED_PROXY_IP must be a single IP address.');
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('PORT must be a valid TCP port.');
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'json';
if (!['json', 'supabase'].includes(STORAGE_DRIVER)) throw new Error('STORAGE_DRIVER must be either "json" or "supabase".');
if (STORAGE_DRIVER === 'supabase' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when STORAGE_DRIVER=supabase.');
let pool = null;
if (STORAGE_DRIVER === 'supabase') {
  const urlError = 'DATABASE_URL must be a PostgreSQL connection URI with a username and password. Copy it from Supabase Dashboard → Connect and percent-encode special characters in the password.';
  let databaseUrl;
  try {
    databaseUrl = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error(urlError);
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
      !databaseUrl.hostname || !databaseUrl.username || !databaseUrl.password || databaseUrl.hash) {
    throw new Error(urlError);
  }
  ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].forEach(parameter => databaseUrl.searchParams.delete(parameter));
  const ssl = { rejectUnauthorized: true };
  if (process.env.DATABASE_CA_CERT_PATH) {
    ssl.ca = fs.readFileSync(process.env.DATABASE_CA_CERT_PATH);
  }
  pool = new Pool({
    connectionString: databaseUrl.toString(),
    connectionTimeoutMillis: 10000,
    ssl
  });
}
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OUT_DIR = process.env.OUTBOX_DIR || path.join(__dirname, 'outbox');
const DB = path.join(DATA_DIR, 'db.json'), PUB = path.join(__dirname, 'public');
const supabaseChanges = new WeakMap();
const supabaseAfterCommit = new WeakMap();
const SESSION_COOKIE = 'olu_staff_session', SESSION_MS = 2 * 3600e3;
const sessions = new Map(), requestLimits = new Map(), loginFailures = new Map();
const STAFF = path.join(DATA_DIR, 'staff.json'), AUDIT = path.join(DATA_DIR, 'audit.log');
const PERMS = {
  manager: ['bookings', 'orders', 'staff'],
  frontdesk: ['bookings', 'orders'],
  kitchen: ['orders']
};
const usernamePattern = /^[a-z0-9._-]{3,30}$/;
const validPassword = value => typeof value === 'string' && Array.from(value).length >= 10;
fs.mkdirSync(DATA_DIR, { recursive: true }); fs.mkdirSync(OUT_DIR, { recursive: true });

const MENU = [
  { id: 'burrata', cat: 'Starters', icon: '🍅', name: 'Burrata & Heirloom Tomato', desc: 'Basil oil, aged balsamic, warm focaccia.', price: 4200 },
  { id: 'soup', cat: 'Starters', icon: '🍲', name: 'Roasted Pumpkin Soup', desc: 'Coconut cream and toasted pumpkin seeds.', price: 1650 },
  { id: 'seabass', cat: 'Mains', icon: '🐟', name: 'Grilled Sea Bass', desc: 'Lemon butter, garden greens, saffron potatoes.', price: 3500 },
  { id: 'risotto', cat: 'Mains', icon: '🍄', name: 'Truffle Mushroom Risotto', desc: 'Wild mushrooms, parmesan, black truffle.', price: 3850 },
  { id: 'curry', cat: 'Mains', icon: '🍛', name: 'Rice & Curry Platter', desc: 'Five Sri Lankan curries, sambol and papadum.', price: 3800 },
  { id: 'burger', cat: 'Mains', icon: '🍔', name: 'Wagyu Burger', desc: 'Brioche bun, aged cheddar, hand-cut fries.', price: 3600 },
  { id: 'fondant', cat: 'Desserts', icon: '🍫', name: 'Chocolate Fondant', desc: 'Warm centre with vanilla bean ice cream.', price: 2450 },
  { id: 'watalappan', cat: 'Desserts', icon: '🍮', name: 'Watalappan', desc: 'Coconut custard with jaggery and cardamom.', price: 1200 },
  { id: 'lime', cat: 'Drinks', icon: '🍋', name: 'Fresh Lime Soda', desc: 'Sweet, salty or mixed.', price: 880 },
  { id: 'tea', cat: 'Drinks', icon: '🍵', name: 'Ceylon Tea Pot', desc: 'Single-estate leaf tea for two.', price: 960 },
  { id: 'mocktail', cat: 'Drinks', icon: '🍹', name: 'Sparkling Mocktail', desc: 'Passion fruit, mint and ginger.', price: 1590 }];
// Meal filters can overlap the existing course categories.
const BREAKFAST = [
  { id: 'hoppers', cat: 'Breakfast', name: 'Sri Lankan Hoppers', desc: 'Crisp hoppers, an egg hopper, coconut sambol and dhal.', price: 2500 },
  { id: 'breakfast', cat: 'Breakfast', name: 'The Grand Breakfast', desc: 'Eggs your way, sourdough toast, mushrooms and grilled tomato.', price: 2400 },
  { id: 'pancakes', cat: 'Breakfast', name: 'Banana & Honey Pancakes', desc: 'Fluffy pancakes, fresh banana and a drizzle of golden honey.', price: 2400 }
];
MENU.unshift(...BREAKFAST);
const mealTags = item => item.cat === 'Breakfast' ? ['Breakfast']
  : item.cat === 'Drinks' ? ['Breakfast', 'Lunch', 'Dinner'] : ['Lunch', 'Dinner'];
MENU.forEach(item => { item.meals = mealTags(item); });
const seed = {
  bookings: [], orders: [], menu: MENU, types: [
    { id: 'garden', name: 'Garden Room', price: 45193, capacity: 2, count: 5, base: 100, tone: 't1', desc: 'A calm retreat overlooking the courtyard garden.', features: ['King bed', 'Garden view', 'Rain shower'] },
    { id: 'ocean', name: 'Ocean Suite', price: 103040, capacity: 3, count: 4, base: 200, tone: 't2', desc: 'Sunrise views, a private balcony and a soaking tub.', features: ['Sea view', 'Balcony', 'Lounge area'] },
    { id: 'royal', name: 'Royal Penthouse', price: 128348, capacity: 4, count: 2, base: 300, tone: 't3', desc: 'Two bedrooms, a terrace and a personal butler.', features: ['2 bedrooms', 'Terrace', 'Butler service'] }]
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
  // Apply current rates to standard catalog entries in existing JSON stores.
  const menuPrices = new Map(seed.menu.map(item => [item.id, item.price]));
  const roomPrices = new Map(seed.types.map(type => [type.id, type.price]));
  const missingBreakfast = BREAKFAST.filter(item => !d.menu.some(stored => stored.id === item.id));
  d.menu = [...missingBreakfast, ...d.menu].map(item => ({
    ...item, price: menuPrices.get(item.id) ?? item.price, meals: item.meals || mealTags(item)
  }));
  d.types = d.types.map(type => ({ ...type, price: roomPrices.get(type.id) ?? type.price }));
  return d;
};
const save = (d, changes) => {
  if (STORAGE_DRIVER === 'supabase') {
    supabaseChanges.set(d, changes);
    return;
  }
  const tmp = `${DB}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB);
};
function runAfterPersist(action) {
  try { action(); }
  catch (error) { console.error('Post-save action failed:', error.message); }
}
const afterPersist = (db, action) => {
  if (STORAGE_DRIVER !== 'supabase') return runAfterPersist(action);
  const actions = supabaseAfterCommit.get(db) || [];
  actions.push(action);
  supabaseAfterCommit.set(db, actions);
};

async function loadSupabase(client) {
  const { rows: [stored] } = await client.query(`
    SELECT
      COALESCE((SELECT json_agg(row_to_json(bookings)) FROM (
        SELECT * FROM public.hotel_bookings ORDER BY created_at, reference
      ) bookings), '[]'::json) AS bookings,
      COALESCE((SELECT json_agg(row_to_json(orders)) FROM (
        SELECT * FROM public.hotel_orders ORDER BY created_at, reference
      ) orders), '[]'::json) AS orders
  `);
  const bookings = stored.bookings.map(row => ({
    reference: row.reference, status: row.status, typeId: row.type_id, roomName: row.room_name,
    room: row.room_number, guest: row.guest, email: row.email, phone: row.phone, requests: row.requests,
    checkIn: row.check_in, checkOut: row.check_out, guests: row.guests, pricing: row.pricing,
    payment: row.payment, createdAt: row.created_at
  }));
  const orders = stored.orders.map(row => ({
    reference: row.reference, status: row.status, guest: row.guest, email: row.email, room: row.room_number,
    bookingRef: row.booking_reference, lines: row.lines, note: row.note, pricing: row.pricing,
    createdAt: row.created_at, history: row.history
  }));
  return { ...JSON.parse(JSON.stringify(seed)), bookings, orders };
}

async function persistSupabase(client, { booking, order }) {
  if (booking) {
    await client.query(`
      INSERT INTO public.hotel_bookings
        (reference, status, type_id, room_name, room_number, guest, email, phone, requests,
         check_in, check_out, guests, pricing, payment, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
      ON CONFLICT (reference) DO UPDATE SET
        status = EXCLUDED.status, type_id = EXCLUDED.type_id, room_name = EXCLUDED.room_name,
        room_number = EXCLUDED.room_number, guest = EXCLUDED.guest, email = EXCLUDED.email,
        phone = EXCLUDED.phone, requests = EXCLUDED.requests, check_in = EXCLUDED.check_in,
        check_out = EXCLUDED.check_out, guests = EXCLUDED.guests, pricing = EXCLUDED.pricing,
        payment = EXCLUDED.payment
    `, [
      booking.reference, booking.status, booking.typeId, booking.roomName, booking.room,
      booking.guest, booking.email, booking.phone, booking.requests, booking.checkIn,
      booking.checkOut, booking.guests, JSON.stringify(booking.pricing), booking.payment, booking.createdAt
    ]);
  }
  if (order) {
    await client.query(`
      INSERT INTO public.hotel_orders
        (reference, status, guest, email, room_number, booking_reference, lines, note, pricing, created_at, history)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11::jsonb)
      ON CONFLICT (reference) DO UPDATE SET
        status = EXCLUDED.status, guest = EXCLUDED.guest, email = EXCLUDED.email,
        room_number = EXCLUDED.room_number, booking_reference = EXCLUDED.booking_reference,
        lines = EXCLUDED.lines, note = EXCLUDED.note, pricing = EXCLUDED.pricing,
        history = EXCLUDED.history
    `, [
      order.reference, order.status, order.guest, order.email, order.room,
      orderBookingRef(order), JSON.stringify(order.lines), order.note,
      JSON.stringify(order.pricing), order.createdAt, JSON.stringify(order.history)
    ]);
  }
}

async function withSupabaseRequest(req, operation) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const mutatesHotelData = req.method === 'POST' && (
      /^\/api\/(bookings|orders)(?:\/|$)/.test(pathname)
      || /^\/api\/admin\/(bookings|orders)\/[^/]+\/status$/.test(pathname)
    );
    if (mutatesHotelData) {
      await client.query('SELECT pg_advisory_xact_lock($1)', [792102612]);
    }
    const db = await loadSupabase(client);
    const result = operation(db);
    const changes = supabaseChanges.get(db);
    if (changes) await persistSupabase(client, changes);
    await client.query('COMMIT');
    transactionOpen = false;
    for (const action of supabaseAfterCommit.get(db) || []) runAfterPersist(action);
    return result;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    if (error.code === '23P01') {
      return [409, { error: 'Sorry, that room was just taken. Please pick other dates or a different room.' }];
    }
    throw error;
  } finally {
    client.release();
  }
}

const ACTIVE = ['CONFIRMED', 'CHECKED_IN'];
const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const hotelCalendar = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
});
const today = () => hotelCalendar.format(new Date());
const overlaps = (b, i, o) => b.checkIn < o && i < b.checkOut;
const takenRooms = (db, type, i, o) => db.bookings.filter(b => b.typeId === type.id && ACTIVE.includes(b.status) && overlaps(b, i, o)).map(b => b.room);
const freeRooms = (db, t, i, o) => Array.from({ length: t.count }, (_, k) => t.base + k + 1).filter(r => !takenRooms(db, t, i, o).includes(r));
const price = (t, n) => { const sub = t.price * n, tax = +(sub * TAX).toFixed(2); return { nights: n, subtotal: sub, tax, taxRate: TAX, total: +(sub + tax).toFixed(2) }; };
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
function clientAddress(req) {
  const peer = req.socket.remoteAddress || 'unknown';
  if (peer.replace(/^::ffff:/, '') === trustedProxy) {
    const forwarded = req.headers['x-forwarded-for']?.split(',').at(-1)?.trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return peer;
}
function allowRequest(req, action, max, windowMs) {
  const now = Date.now(), key = `${clientAddress(req)}:${action}`;
  let entry = requestLimits.get(key);
  if (!entry || entry.expiresAt <= now) entry = { count: 0, expiresAt: now + windowMs };
  entry.count += 1; requestLimits.set(key, entry);
  if (requestLimits.size > 10000) {
    for (const [id, limit] of requestLimits) if (limit.expiresAt <= now) requestLimits.delete(id);
  }
  return entry.count <= max;
}
function hashPw(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPw(password, { salt, hash }) {
  const actual = crypto.scryptSync(typeof password === 'string' ? password : '', salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function saveStaff(accounts) {
  fs.writeFileSync(STAFF + '.tmp', JSON.stringify(accounts, null, 2), { mode: 0o600 });
  fs.renameSync(STAFF + '.tmp', STAFF);
}
function loadStaff() {
  let raw = '';
  try { raw = fs.readFileSync(STAFF, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const accounts = raw.trim() ? JSON.parse(raw) : [];
  if (!Array.isArray(accounts)) throw new Error('Invalid staff data file.');
  if (accounts.length) return accounts;
  const configured = process.env.ADMIN_PASSWORD;
  if (PRODUCTION && configured === undefined) throw new Error('Set ADMIN_PASSWORD before starting production with a new staff store.');
  if (configured !== undefined && !validPassword(configured)) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  const password = configured ?? crypto.randomBytes(24).toString('base64url');
  accounts.push({ username: 'admin', name: 'Administrator', role: 'manager', active: true, password: hashPw(password) });
  saveStaff(accounts);
  if (configured === undefined) console.log('Initial admin password (shown once): ' + password);
  return accounts;
}
if (process.argv[2] === '--reset-admin-password') {
  const guard = require('node:net').createServer();
  guard.once('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Stop the hotel server on port ' + PORT + ' before resetting the admin password.'
      : 'Unable to check the hotel server port: ' + error.message);
    process.exitCode = 1;
  });
  guard.listen(PORT, HOST, () => {
    try {
      const accounts = JSON.parse(fs.readFileSync(STAFF, 'utf8'));
      const admin = accounts.find(account => account.username === 'admin' && account.role === 'manager' && account.active);
      if (!admin) throw new Error('No active admin manager account was found.');
      const password = crypto.randomBytes(24).toString('base64url');
      admin.password = hashPw(password);
      saveStaff(accounts);
      console.log('Username: admin');
      console.log('Temporary password: ' + password);
    } catch (error) {
      console.error('Admin password reset failed: ' + error.message);
      process.exitCode = 1;
    } finally {
      guard.close();
    }
  });
  return;
}
const staff = loadStaff();
const unknownPassword = hashPw(crypto.randomBytes(32).toString('hex'));
const staffView = ({ username, name, role, active }) => ({ username, name, role, active });
const staffByName = username => staff.find(user => user.username === username);

function auth(req) {
  const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(SESSION_COOKIE + '='));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  const session = sessions.get(token);
  const user = session && staffByName(session.username);
  if (!user?.active || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { user, token, expiresAt: session.expiresAt };
}
function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${PRODUCTION || process.env.HTTPS === '1' ? '; Secure' : ''}`;
}
function endSessions(username, keep) {
  for (const [token, session] of sessions) {
    if (session.username === username && token !== keep) sessions.delete(token);
  }
}
function audit(action, user, details = {}) {
  const actor = user ? { username: user.username, name: user.name } : null;
  fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), action, actor, ...details }) + '\n', { mode: 0o600 });
}
function login(req, body) {
  const address = clientAddress(req), now = Date.now();
  for (const [key, failure] of loginFailures) if (failure.expiresAt <= now) loginFailures.delete(key);
  const failure = loginFailures.get(address) || { count: 0, expiresAt: now + 15 * 60e3 };
  const limited = !allowRequest(req, 'public-submit', 15, 60e3);
  const username = typeof body.username === 'string' ? body.username.slice(0, 100) : '';
  const user = staffByName(body.username);
  if (failure.count >= 5 || limited) {
    audit('login_blocked', user, { username, address });
    return [429, { error: failure.count >= 5 ? 'Too many failed sign-ins. Please wait 15 minutes.' : 'Too many requests. Please try again in a minute.' }];
  }
  const matches = checkPw(body.password, user?.password || unknownPassword);
  if (!matches || !user?.active) {
    failure.count++;
    if (failure.count === 5) failure.expiresAt = now + 15 * 60e3;
    loginFailures.set(address, failure);
    audit('login_failed', user, { username, address });
    return [401, { error: 'Incorrect username or password.' }];
  }
  loginFailures.delete(address);
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  const token = crypto.randomBytes(32).toString('hex'), expiresAt = Date.now() + SESSION_MS;
  audit('login', user, { address });
  sessions.set(token, { username: user.username, expiresAt });
  const previous = auth(req);
  if (previous) sessions.delete(previous.token);
  return [200, { user: staffView(user), expiresAt }, { 'Set-Cookie': sessionCookie(token, SESSION_MS / 1000) }];
}

function updateStaff(user, changes) {
  const updated = { ...user, ...changes };
  const index = staff.indexOf(user);
  const accounts = staff.slice();
  accounts[index] = updated;
  saveStaff(accounts);
  staff[index] = updated;
}

function staffAccounts(method, route, body, actor) {
  if (route === '/api/admin/staff') {
    if (method === 'GET') return [200, { staff: staff.map(staffView) }];
    if (method === 'POST') {
      const { username, name, role, password } = body;
      if (typeof username !== 'string' || !usernamePattern.test(username)) return [400, { error: 'Use 3 to 30 lowercase letters, numbers, dots, dashes or underscores.' }];
      if (!validName(name) || typeof role !== 'string' || !Object.prototype.hasOwnProperty.call(PERMS, role)) return [400, { error: 'Enter a name and select a staff role.' }];
      if (!validPassword(password)) return [400, { error: 'Passwords must be at least 10 characters.' }];
      if (staffByName(username)) return [409, { error: 'This username already exists.' }];
      const user = { username, name: name.trim(), role, active: true, password: hashPw(password) };
      saveStaff([...staff, user]);
      staff.push(user);
      audit('staff_created', actor, { target: username });
      return [201, { user: staffView(user) }];
    }
  }
  const match = route.match(/^\/api\/admin\/staff\/([a-z0-9._-]+)\/(password|active)$/);
  if (method === 'POST' && match) {
    const user = staffByName(match[1]);
    if (!user) return [404, { error: 'Staff account not found.' }];
    if (match[2] === 'password') {
      if (!validPassword(body.password)) return [400, { error: 'Passwords must be at least 10 characters.' }];
      updateStaff(user, { password: hashPw(body.password) });
      endSessions(user.username);
      audit('password_reset', actor, { target: user.username });
    } else {
      if (typeof body.active !== 'boolean') return [400, { error: 'Choose whether the account is active.' }];
      if (!body.active && user.username === actor.username) return [403, { error: 'You cannot deactivate your own account.' }];
      updateStaff(user, { active: body.active });
      endSessions(user.username);
      audit(body.active ? 'staff_activated' : 'staff_deactivated', actor, { target: user.username });
    }
    return [200, { user: staffView(staffByName(user.username)) }];
  }
  return [404, { error: 'Not found.' }];
}

function sendEmail(b) { // Demo "email": saved as HTML in /outbox. Swap for SMTP/SendGrid/SES in production.
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;background:#eaf1ef;color:#1e3b3f"><h1>Booking confirmed</h1><p>Dear ${esc(b.guest)}, we look forward to welcoming you.</p><p><b>Reference:</b> ${b.reference}<br><b>Room:</b> ${esc(b.roomName)} (#${b.room})<br><b>Stay:</b> ${b.checkIn} to ${b.checkOut} (${b.pricing.nights} nights)<br><b>Total:</b> ${formatRs(b.pricing.total)}</p><p>Aurelia Grand</p></div>`;
  fs.writeFileSync(path.join(OUT_DIR, `${b.reference}.html`), html); console.log(`Confirmation email written: outbox/${b.reference}.html`);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mailOrder(o, kind) {
  if (!o.email) return;
  const ready = kind === 'ready', where = o.room ? `It is on its way to room ${o.room}.` : 'Please collect it at the restaurant.';
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:32px;background:#eaf1ef;color:#1e3b3f"><h1>${ready ? 'Your order is ready' : 'Order confirmed'}</h1><p>Dear ${esc(o.guest)}, ${ready ? where : 'we have received your order. Track it on the website for updates.'}</p><p><b>Order:</b> ${o.reference}<br>${o.lines.map(l => `${l.qty} x ${esc(l.name)}`).join('<br>')}<br><b>Total:</b> ${formatRs(o.pricing.total)}</p><p>Aurelia Grand</p></div>`;
  fs.writeFileSync(path.join(OUT_DIR, `${o.reference}-${kind}.html`), html); console.log(`Order ${kind} email written: outbox/${o.reference}-${kind}.html`);
}
function setStatus(db, o, s) {
  o.status = s; o.history.push({ status: s, at: new Date().toISOString() });
  if (s === 'READY') afterPersist(db, () => mailOrder(o, 'ready'));
}
const orderBookingRef = o => o.bookingRef || o.billingBookingRef;
const hasPendingRoomOrders = (db, bookingRef) => db.orders.some(o => orderBookingRef(o) === bookingRef && !['DELIVERED', 'CANCELLED'].includes(o.status));

function api(req, url, body, db) {
  const p = url.pathname, q = url.searchParams, m = req.method;
  let actor;
  if (p.startsWith('/api/staff/') || p.startsWith('/api/admin/')) {
    if (m === 'POST' && p === '/api/staff/login') return login(req, body);
    const session = auth(req);
    if (!session) return [401, { error: 'Staff sign-in required.' }];
    actor = session.user;
    if (p === '/api/staff/me' && m === 'GET') return [200, { user: staffView(actor), expiresAt: session.expiresAt }];
    if (p === '/api/staff/logout' && m === 'POST') {
      sessions.delete(session.token);
      audit('logout', actor);
      return [200, {}, { 'Set-Cookie': sessionCookie('', 0) }];
    }
    if (p === '/api/staff/password' && m === 'POST') {
      if (!validPassword(body.password)) return [400, { error: 'Passwords must be at least 10 characters.' }];
      if (typeof body.currentPassword !== 'string' || !checkPw(body.currentPassword, actor.password)) return [400, { error: 'Incorrect current password.' }];
      updateStaff(actor, { password: hashPw(body.password) });
      endSessions(actor.username, session.token);
      audit('password_changed', actor);
      return [200, {}];
    }
    const section = p.split('/')[3];
    if (p.startsWith('/api/staff/') || !['bookings', 'orders', 'staff'].includes(section)) return [404, { error: 'Not found.' }];
    if (!PERMS[actor.role]?.includes(section)) return [403, { error: 'Your role does not have access.' }];
    if (section === 'staff') return staffAccounts(m, p, body, actor);
  }
  if (m === 'GET' && p === '/api/availability') {
    const i = q.get('checkIn'), o = q.get('checkOut'), g = q.has('guests') ? Number(q.get('guests')) : 1, err = checkDates(i, o); if (err) return [400, { error: err }];
    if (!Number.isInteger(g) || g < 1 || g > 20) return [400, { error: 'Please choose a valid number of guests.' }];
    const n = nights(i, o);
    return [200, { rooms: db.types.filter(t => t.capacity >= g).map(t => {
      const taken = takenRooms(db, t, i, o);
      const units = Array.from({ length: t.count }, (_, k) => t.base + k + 1)
        .map(number => ({ number, available: !taken.includes(number) }));
      return { ...t, left: units.filter(unit => unit.available).length, units, pricing: price(t, n) };
    }) }];
  }
  if (m === 'POST' && p === '/api/bookings') {
    const { typeId, checkIn, checkOut, name, email, phone, guests = 1, requests = '', payment = 'pay_at_hotel', roomNumber } = body;
    if (!allowRequest(req, 'public-submit', 15, 60e3)) return [429, { error: 'Too many booking attempts. Please wait a moment and try again.' }];
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
    if (roomNumber !== undefined && !Number.isInteger(roomNumber)) return [400, { error: 'Please choose a valid room.' }];
    if (roomNumber !== undefined && !free.includes(roomNumber)) return [409, { error: 'That room is no longer available for these dates. Please choose another room.' }];
    const b = {
      reference: makeReference('OL', db.bookings), status: 'CONFIRMED', typeId, roomName: t.name, room: roomNumber === undefined ? free[0] : roomNumber,
      guest: name.trim().slice(0, 80), email: email.trim().toLowerCase(), phone: String(phone || '').slice(0, 30), requests: String(requests).slice(0, 400),
      checkIn, checkOut, guests, pricing: price(t, nights(checkIn, checkOut)), payment: 'PAY AT HOTEL', createdAt: new Date().toISOString()
    };
    db.bookings.push(b); save(db, { booking: b }); afterPersist(db, () => sendEmail(b)); return [201, { booking: pub(b) }];
  }
  let r = p.match(/^\/api\/bookings\/([\w-]+)(\/cancel)?$/);
  if (r) {
    if (!allowRequest(req, 'booking-lookup', 600, 15 * 60 * 1000)) return [429, { error: 'Too many booking lookups. Please wait and try again.' }];
    const b = db.bookings.find(x => x.reference === r[1].toUpperCase());
    const email = q.get('email') || body.email;
    if (!b || typeof email !== 'string' || b.email !== email.trim().toLowerCase()) return [404, { error: 'We could not find a booking with those details.' }];
    if (m === 'GET' && !r[2]) return [200, { booking: pub(b) }];
    if (m === 'POST' && r[2]) {
      if (b.status !== 'CONFIRMED' || b.checkIn < today() || hasPendingRoomOrders(db, b.reference)) return [409, { error: 'This booking can no longer be cancelled online. Resolve any pending room orders or contact the front desk.' }];
      b.status = 'CANCELLED'; save(db, { booking: b }); return [200, { booking: pub(b) }];
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
      if (o.status !== body.status) setStatus(db, o, body.status);
      save(db, { order: o });
      afterPersist(db, () => audit('order_status', actor, { reference: o.reference, status: o.status }));
      return [200, { order: o }];
    }
    if (m === 'GET' && p === '/api/admin/bookings') return [200, { bookings: db.bookings.slice().reverse() }];
    r = p.match(/^\/api\/admin\/bookings\/([\w-]+)\/status$/);
    if (m === 'POST' && r) {
      const b = db.bookings.find(x => x.reference === r[1]);
      if (!b || !['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(body.status)) return [400, { error: 'Invalid request.' }];
      const transitions = { CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'], CHECKED_IN: ['CHECKED_OUT'], CHECKED_OUT: [], CANCELLED: [], NO_SHOW: [] };
      if (b.status !== body.status && !transitions[b.status]?.includes(body.status)) return [409, { error: `A booking cannot move from ${b.status} to ${body.status}.` }];
      if (b.status !== body.status && ['CANCELLED', 'NO_SHOW'].includes(body.status) && hasPendingRoomOrders(db, b.reference)) return [409, { error: 'Resolve pending room orders before cancelling this booking.' }];
      b.status = body.status;
      save(db, { booking: b });
      afterPersist(db, () => audit('booking_status', actor, { reference: b.reference, status: b.status }));
      return [200, { booking: b }];
    }
  }
  if (m === 'GET' && p === '/api/menu') return [200, { menu: db.menu, taxRate: TAX }];
  if (m === 'POST' && p === '/api/orders') {
    const { name, email, items = [], note = '', bookingRef = '' } = body;
    if (!allowRequest(req, 'public-submit', 15, 60e3)) return [429, { error: 'Too many orders were submitted. Please wait a moment and try again.' }];
    if (!validName(name)) return [400, { error: 'Please enter your full name (2 to 80 characters).' }];
    if (!validEmail(email)) return [400, { error: 'Please enter a valid email address.' }];
    if (!Array.isArray(items) || items.length > 50 || items.some(i => !i || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 20)) return [400, { error: 'Your order contains invalid items or quantities.' }];
    if (new Set(items.map(item => item.id)).size !== items.length) return [400, { error: 'Combine quantities for each menu item before ordering.' }];
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
      note: String(note).slice(0, 300), pricing: { subtotal: sub, tax, taxRate: TAX, total: +(sub + tax).toFixed(2) }, createdAt: now, history: [{ status: 'RECEIVED', at: now }]
    };
    db.orders.push(o); save(db, { order: o }); afterPersist(db, () => mailOrder(o, 'confirmed')); return [201, { order: o }];
  }
  r = p.match(/^\/api\/orders\/([\w-]+)(\/cancel)?$/);
  if (r) {
    if (!allowRequest(req, 'order-lookup', 600, 15 * 60 * 1000)) return [429, { error: 'Too many order lookups. Please wait and try again.' }];
    const o = db.orders.find(x => x.reference === r[1].toUpperCase());
    const email = q.get('email') || body.email;
    if (!o || typeof email !== 'string' || o.email !== email.trim().toLowerCase()) return [404, { error: 'We could not find an order with those details.' }];
    if (m === 'GET' && !r[2]) return [200, { order: o }];
    if (m === 'POST' && r[2]) { if (o.status !== 'RECEIVED') return [409, { error: 'The kitchen has already started this order, so it can no longer be cancelled.' }]; setStatus(db, o, 'CANCELLED'); save(db, { order: o }); return [200, { order: o }]; }
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
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self'"
};
if (PRODUCTION) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000';
const server = http.createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  const send = (status, payload, headers = {}) => {
    if (res.writableEnded) return;
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(payload));
  };
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return send(400, { error: 'Invalid request URL.' }); }
  if (url.pathname === '/api/health' && req.method === 'GET') {
    Promise.resolve().then(() => pool ? pool.query('SELECT 1') : load())
      .then(() => send(200, { status: 'ok' }))
      .catch(error => {
        console.error('Storage health check failed:', error.message);
        send(503, { status: 'unavailable' });
      });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'POST' && /^\/api\/(staff|admin)\//.test(url.pathname) && req.headers['x-requested-with'] !== 'olu') {
      return send(403, { error: 'Staff request header required.' });
    }
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
    req.on('end', async () => {
      if (tooLarge) return send(413, { error: 'Request body is too large.' });
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      if (raw) {
        try { body = JSON.parse(raw); }
        catch { return send(400, { error: 'Request body must be valid JSON.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Request body must be a JSON object.' });
      }
      try {
        const run = db => api(req, url, body, db);
        const staffOnlyRoute = url.pathname.startsWith('/api/staff/')
          || url.pathname === '/api/admin/staff'
          || url.pathname.startsWith('/api/admin/staff/');
        const [status, payload, headers] = STORAGE_DRIVER === 'supabase' && !staffOnlyRoute
          ? await withSupabaseRequest(req, run)
          : run(STORAGE_DRIVER === 'json' && !staffOnlyRoute ? load() : undefined);
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
  const contentType = MIME[path.extname(file).toLowerCase()];
  if (!contentType || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
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
server.headersTimeout = 15000;

async function start() {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      await client.query('SELECT 1 FROM public.hotel_bookings LIMIT 0');
      await client.query('SELECT 1 FROM public.hotel_orders LIMIT 0');
    } finally {
      client.release();
    }
    console.log('Supabase PostgreSQL connection ready.');
  }
  server.listen(PORT, HOST, () => {
    const address = server.address();
    const displayHost = address.address.includes(':') ? `[${address.address}]` : address.address;
    console.log(`Olu running at http://${displayHost}:${address.port} (admin: /admin.html)`);
  });
}

start().catch(error => {
  console.error('Server startup failed:', error);
  if (pool) pool.end().finally(() => { process.exitCode = 1; });
  else process.exitCode = 1;
});
