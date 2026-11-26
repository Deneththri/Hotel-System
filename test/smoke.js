const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const adminPassword = 'smoke-test-only-manager-password';

function request(port, method, route, body, cookie, contentType, staffHeader = 'olu') {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const headers = {};
    if (data) {
      headers['Content-Length'] = data.length;
      headers['Content-Type'] = contentType || 'application/json';
    }
    if (staffHeader && /^\/api\/(admin|staff)\//.test(route)) headers['x-requested-with'] = staffHeader;
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let response = raw;
        try { response = JSON.parse(raw); } catch { }
        resolve({ status: res.statusCode, headers: res.headers, body: response });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'server.js')], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let stderr = '';
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) reject(new Error(`Server did not start in time.\n${output}\n${stderr}`));
    }, 10000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/Olu running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && !ready) {
        ready = true;
        clearTimeout(timeout);
        resolve({ child, port: Number(match[1]) });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`Server exited before starting (${code}).\n${output}\n${stderr}`));
      }
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => {
    child.once('exit', resolve);
    child.kill();
  });
}

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olu-hotel-smoke-'));
  let running;
  try {
    const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'development', STORAGE_DRIVER: 'json', ADMIN_PASSWORD: adminPassword, DATA_DIR: path.join(dataDir, 'data'), OUTBOX_DIR: path.join(dataDir, 'outbox') };
    running = await startServer(env);
    const { port, child } = running;

    const home = await request(port, 'GET', '/');
    assert.strictEqual(home.status, 200);
    assert.strictEqual(home.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(home.headers['x-frame-options'], 'DENY');
    assert.ok(home.headers['content-security-policy']);
    assert.ok(home.body.includes('href="index.html#dining"'));
    assert.ok(home.body.includes('id="menu"'));
    assert.ok(home.body.includes('href="index.html#stay"'));
    assert.ok(home.body.includes('id="exploreRooms" href="rooms.html"'));
    assert.ok(home.body.includes('href="dining.html"'));
    for (const id of ['stay', 'dining', 'journey', 'facilities', 'gallery', 'contact', 'manage']) {
      assert.strictEqual((home.body.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `Homepage should contain one #${id} section`);
    }
    assert.strictEqual((home.body.match(/id="search"/g) || []).length, 1);
    const roomsPage = await request(port, 'GET', '/rooms.html');
    assert.strictEqual(roomsPage.status, 200);
    assert.ok(roomsPage.body.includes('href="index.html#stay"'));
    assert.ok(roomsPage.body.includes('id="rooms"'));
    assert.ok(roomsPage.body.includes('id="search"'));
    assert.ok(roomsPage.body.includes('href="index.html#manage"'));
    const manage = await request(port, 'GET', '/manage.html');
    assert.strictEqual(manage.status, 200);
    assert.ok(manage.body.includes('id="lookup"'));
    const demoGuide = await request(port, 'GET', '/demo-guide.js');
    assert.strictEqual(demoGuide.status, 200);
    assert.ok(demoGuide.body.includes('href="admin.html"'));
    const dining = await request(port, 'GET', '/dining.html');
    assert.strictEqual(dining.status, 200);
    assert.ok(dining.body.includes('id="menu"'));
    assert.ok(dining.body.includes('id="reviewBtn"'));
    const fullMenu = await request(port, 'GET', '/api/menu');
    assert.strictEqual(fullMenu.status, 200);
    assert.ok(fullMenu.body.menu.length > 6, 'The full dining page should have more dishes than the Home Page preview');


    assert.strictEqual((await request(port, 'POST', '/api/bookings', ' '.repeat(20001))).status, 413);
    assert.strictEqual((await request(port, 'GET', '/api/staff/me')).status, 401);
    const admin = await request(port, 'GET', '/admin.html');
    assert.ok(!admin.headers['content-security-policy'].includes("script-src 'self' 'unsafe-inline'"));
    assert.ok(admin.body.includes('src="admin.js"'));
    const navigation = page => page.body.match(/<header class="site-nav">[\s\S]*?<\/header>/)?.[0]
      .replaceAll(' aria-current="page"', '');
    const sharedNav = navigation(home);
    assert.ok(sharedNav);
    for (const file of ['index.html', 'rooms.html', 'dining.html', 'manage.html', 'admin.html']) {
      const body = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
      assert.strictEqual(navigation({ body }), sharedNav, `Local preview navigation differs in ${file}`);
    }
    for (const page of [roomsPage, dining, manage, admin]) assert.strictEqual(navigation(page), sharedNav);
    assert.ok(sharedNav.includes('href="index.html#stay"'));
    assert.ok(sharedNav.includes('href="index.html#dining"'));
    assert.ok(sharedNav.includes('href="index.html#journey"'));
    assert.ok(sharedNav.includes('href="index.html#facilities"'));
    assert.ok(sharedNav.includes('href="index.html#gallery"'));
    assert.ok(sharedNav.includes('href="index.html#contact"'));
    assert.ok(sharedNav.includes('href="index.html#manage"'));
    assert.ok(!sharedNav.includes('rooms.html'));
    assert.ok(!sharedNav.includes('dining.html'));
    assert.ok(!sharedNav.includes('manage.html'));
    for (const page of [home, roomsPage, dining, manage]) {
      assert.match(page.body, /<footer[^>]*>[\s\S]*?<a href="admin.html">Staff sign-in<\/a>[\s\S]*?<\/footer>/);
    }
    assert.match(admin.body, /<footer class="admin-footer"><a href="index.html#top">[^<]*Return to guest website<\/a>/);
    assert.strictEqual((await request(port, 'POST', '/api/staff/login', {}, undefined, undefined, null)).status, 403);
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings')).status, 401);
    assert.strictEqual((await request(port, 'POST', '/api/staff/login', { username: 'admin', password: 'wrong-password' })).status, 401);
    const login = await request(port, 'POST', '/api/staff/login', { username: 'admin', password: adminPassword });
    assert.strictEqual(login.status, 200);
    const cookieHeader = login.headers['set-cookie'][0];
    assert.ok(cookieHeader.includes('HttpOnly'));
    assert.ok(cookieHeader.includes('SameSite=Strict'));
    assert.ok(cookieHeader.includes('Max-Age=7200'));
    assert.match(cookieHeader, /^olu_staff_session=[a-f0-9]{64};/);
    const cookie = cookieHeader.split(';')[0];
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings', undefined, cookie)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/pos.html')).status, 404);
    assert.strictEqual((await request(port, 'POST', '/api/admin/pos/sale', {}, cookie)).status, 404);
    assert.strictEqual((await request(port, 'POST', '/api/admin/bill/test-reference', {}, cookie)).status, 404);
    assert.strictEqual((await request(port, 'GET', '/api/admin/report', undefined, cookie)).status, 404);
    assert.strictEqual((await request(port, 'POST', '/api/bookings', 'not-json')).status, 400);
    assert.strictEqual((await request(port, 'POST', '/api/bookings', { name: 'Test' }, undefined, 'text/plain')).status, 415);

    const checkIn = dateOffset(2), checkOut = dateOffset(3);
    const availabilityRoute = `/api/availability?${new URLSearchParams({ checkIn, checkOut, guests: 2 })}`;
    const initialAvailability = await request(port, 'GET', availabilityRoute);
    assert.strictEqual(initialAvailability.status, 200);
    const initialUnits = initialAvailability.body.rooms.flatMap(room => room.units);
    assert.strictEqual(initialUnits.length, 11);
    assert.strictEqual(new Set(initialUnits.map(room => room.number)).size, 11);
    assert.ok(initialUnits.every(room => room.available));

    const invalidPayment = await request(port, 'POST', '/api/bookings', {
      typeId: 'garden', checkIn, checkOut, name: 'Smoke Guest', email: 'guest@example.com', guests: 1, payment: 'card_demo'
    });
    assert.strictEqual(invalidPayment.status, 400);

    const bookingResponse = await request(port, 'POST', '/api/bookings', {
      typeId: 'garden', roomNumber: 103, checkIn, checkOut, name: 'Smoke Guest', email: 'guest@example.com', guests: 1
    });
    assert.strictEqual(bookingResponse.status, 201);
    const booking = bookingResponse.body.booking;
    assert.strictEqual(booking.reference.length, 15);
    assert.strictEqual(booking.payment, 'PAY AT HOTEL');
    assert.strictEqual(booking.room, 103);
    assert.strictEqual((await request(port, 'POST', '/api/bookings', {
      typeId: 'garden', roomNumber: 103, checkIn, checkOut, name: 'Another Guest', email: 'another@example.com', guests: 1
    })).status, 409);
    const updatedAvailability = await request(port, 'GET', availabilityRoute);
    const bookedUnit = updatedAvailability.body.rooms.flatMap(room => room.units).find(room => room.number === 103);
    assert.deepStrictEqual(bookedUnit, { number: 103, available: false });
    assert.strictEqual(updatedAvailability.body.rooms.find(room => room.id === 'garden').left, 4);
    assert.strictEqual((await request(port, 'GET', `/api/bookings/${booking.reference}?email=wrong%40example.com`)).status, 404);
    assert.strictEqual((await request(port, 'POST', `/api/bookings/${booking.reference}/cancel`, { email: 123 })).status, 404);
    assert.strictEqual((await request(port, 'POST', `/api/admin/bookings/${booking.reference}/status`, { status: 'CHECKED_OUT' }, cookie)).status, 409);

    const futureRoomOrder = await request(port, 'POST', '/api/orders', {
      name: 'Smoke Guest', email: 'guest@example.com', bookingRef: booking.reference, items: [{ id: 'soup', qty: 1 }]
    });
    assert.strictEqual(futureRoomOrder.status, 400);
    const invalidQuantity = await request(port, 'POST', '/api/orders', {
      name: 'Smoke Guest', email: 'guest@example.com', items: [{ id: 'soup', qty: 1.5 }]
    });
    assert.strictEqual(invalidQuantity.status, 400);

    const orderResponse = await request(port, 'POST', '/api/orders', {
      name: 'Smoke Guest', email: 'guest@example.com', items: [{ id: 'soup', qty: 1 }]
    });
    assert.strictEqual(orderResponse.status, 201);
    const order = orderResponse.body.order;
    assert.strictEqual(order.reference.length, 15);
    assert.strictEqual((await request(port, 'POST', `/api/orders/${order.reference}/cancel`, { email: {} })).status, 404);
    assert.strictEqual((await request(port, 'GET', `/api/orders/${order.reference}?email=guest%40example.com`)).status, 200);
    assert.strictEqual((await request(port, 'POST', `/api/admin/orders/${order.reference}/status`, { status: 'DELIVERED' }, cookie)).status, 409);
    assert.strictEqual((await request(port, 'POST', `/api/admin/orders/${order.reference}/status`, { status: 'PREPARING' }, cookie)).status, 200);
    assert.strictEqual((await request(port, 'POST', `/api/admin/orders/${order.reference}/status`, { status: 'READY' }, cookie)).status, 200);

    const inHouseResponse = await request(port, 'POST', '/api/bookings', {
      typeId: 'garden', checkIn: dateOffset(0), checkOut: dateOffset(1), name: 'Room Guest', email: 'room@example.com', guests: 1
    });
    assert.strictEqual(inHouseResponse.status, 201);
    const inHouseBooking = inHouseResponse.body.booking;
    const roomOrderResponse = await request(port, 'POST', '/api/orders', {
      name: 'Room Guest', email: 'room@example.com', bookingRef: inHouseBooking.reference, items: [{ id: 'soup', qty: 1 }]
    });
    assert.strictEqual(roomOrderResponse.status, 201);
    const roomOrder = roomOrderResponse.body.order;
    assert.strictEqual((await request(port, 'POST', `/api/admin/orders/${roomOrder.reference}/status`, { status: 'PREPARING' }, cookie)).status, 200);
    assert.strictEqual((await request(port, 'POST', `/api/admin/orders/${roomOrder.reference}/status`, { status: 'READY' }, cookie)).status, 200);
    assert.strictEqual((await request(port, 'POST', `/api/admin/orders/${roomOrder.reference}/status`, { status: 'DELIVERED' }, cookie)).status, 200);
    const updatedBookings = await request(port, 'GET', '/api/admin/bookings', undefined, cookie);
    const updatedRoomBooking = updatedBookings.body.bookings.find(item => item.reference === inHouseBooking.reference);
    assert.strictEqual(updatedRoomBooking.charges, undefined);
    assert.strictEqual(updatedRoomBooking.settled, undefined);
    const additionalRoomOrder = await request(port, 'POST', '/api/orders', {
      name: 'Room Guest', email: 'room@example.com', bookingRef: inHouseBooking.reference, items: [{ id: 'soup', qty: 1 }]
    });
    assert.strictEqual(additionalRoomOrder.status, 201);
    assert.strictEqual((await request(port, 'POST', `/api/orders/${additionalRoomOrder.body.order.reference}/cancel`, { email: 'room@example.com' })).status, 200);
    assert.strictEqual((await request(port, 'POST', `/api/admin/bookings/${inHouseBooking.reference}/status`, { status: 'CANCELLED' }, cookie)).status, 200);

    const createStaff = (username, role) => request(port, 'POST', '/api/admin/staff', {
      username, name: username, role, password: 'staff-test-password'
    }, cookie);
    const signIn = (username, password = 'staff-test-password') => request(port, 'POST', '/api/staff/login', { username, password });
    const sessionCookie = response => response.headers['set-cookie'][0].split(';')[0];

    assert.strictEqual((await createStaff('cook.one', 'kitchen')).status, 201);
    assert.strictEqual((await createStaff('desk', 'frontdesk')).status, 201);
    assert.strictEqual((await createStaff('cook.one', 'manager')).status, 409);
    const kitchen = sessionCookie(await signIn('cook.one'));
    const otherKitchen = sessionCookie(await signIn('cook.one'));
    const desk = sessionCookie(await signIn('desk'));

    assert.strictEqual((await request(port, 'GET', '/api/admin/orders', undefined, kitchen)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings', undefined, kitchen)).status, 403);
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings', undefined, desk)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/admin/staff', undefined, desk)).status, 403);
    assert.strictEqual((await request(port, 'POST', '/api/admin/staff/admin/active', { active: false }, cookie)).status, 403);
    assert.strictEqual((await request(port, 'POST', '/api/staff/password', {
      currentPassword: 'staff-test-password', password: 'new-test-password'
    }, kitchen)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/staff/me', undefined, kitchen)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/staff/me', undefined, otherKitchen)).status, 401);
    assert.strictEqual((await request(port, 'POST', '/api/admin/staff/cook.one/password', { password: 'reset-test-password' }, cookie)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/staff/me', undefined, kitchen)).status, 401);
    assert.strictEqual((await request(port, 'POST', '/api/admin/staff/desk/active', { active: false }, cookie)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/staff/me', undefined, desk)).status, 401);
    assert.strictEqual((await request(port, 'POST', '/api/admin/staff/desk/active', { active: true }, cookie)).status, 200);
    assert.strictEqual((await signIn('desk')).status, 200);
    assert.ok(!fs.readFileSync(path.join(env.DATA_DIR, 'staff.json'), 'utf8').includes(adminPassword));
    const audit = fs.readFileSync(path.join(env.DATA_DIR, 'audit.log'), 'utf8');
    assert.ok(audit.includes('password_changed'));
    assert.ok(audit.includes('booking_status'));
    assert.ok(!audit.includes(adminPassword));

    const cancelledBooking = await request(port, 'POST', `/api/bookings/${booking.reference}/cancel`, { email: 'guest@example.com' });
    assert.strictEqual(cancelledBooking.status, 200);
    assert.strictEqual(cancelledBooking.body.booking.status, 'CANCELLED');

    assert.strictEqual((await request(port, 'POST', '/api/staff/logout', {}, cookie)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings', undefined, cookie)).status, 401);
    await stopServer(child);
    running = null;

    running = await startServer({ ...env, NODE_ENV: 'production', HTTPS: '1', ADMIN_PASSWORD: '' });
    assert.strictEqual((await request(running.port, 'GET', '/api/staff/me', undefined, kitchen)).status, 401);
    const health = await request(running.port, 'GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(health.body, { status: 'ok' });
    const heroImage = await request(running.port, 'HEAD', '/images/hotel.webp');
    assert.strictEqual(heroImage.status, 200);
    assert.strictEqual(heroImage.headers['content-type'], 'image/webp');
    assert.strictEqual((await request(running.port, 'GET', '/images/food/README.md')).status, 404);
    const secureHeaders = await request(running.port, 'GET', '/');
    assert.strictEqual(secureHeaders.headers['strict-transport-security'], 'max-age=31536000');
    assert.match(secureHeaders.headers['content-security-policy'], /script-src 'self';/);
    const productionLogin = await request(running.port, 'POST', '/api/staff/login', { username: 'admin', password: adminPassword });
    assert.strictEqual(productionLogin.status, 200);
    assert.ok(productionLogin.headers['set-cookie'][0].includes('Secure'));
    for (let i = 0; i < 5; i++) {
      const failed = await request(running.port, 'POST', '/api/staff/login', {
        username: i % 2 ? 'admin' : 'unknown', password: 'wrong-password'
      });
      assert.strictEqual(failed.status, 401);
      assert.strictEqual(failed.body.error, 'Incorrect username or password.');
    }
    assert.strictEqual((await request(running.port, 'POST', '/api/staff/login', {
      username: 'admin', password: adminPassword
    })).status, 429);
    for (let i = 0; i < 8; i++) {
      assert.strictEqual((await request(running.port, 'POST', '/api/bookings', {})).status, 400);
    }
    assert.strictEqual((await request(running.port, 'POST', '/api/orders', {})).status, 429);
    await stopServer(running.child);
    running = null;
    console.log('Hotel application smoke tests passed.');
  } finally {
    if (running) await stopServer(running.child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
