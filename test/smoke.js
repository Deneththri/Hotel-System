const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const staffKey = 'smoke-test-only-key-with-more-than-32-characters';

function request(port, method, route, body, cookie, contentType) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const headers = {};
    if (data) {
      headers['Content-Length'] = data.length;
      headers['Content-Type'] = contentType || 'application/json';
    }
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
    const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'development', ADMIN_KEY: staffKey, DATA_DIR: path.join(dataDir, 'data'), OUTBOX_DIR: path.join(dataDir, 'outbox') };
    running = await startServer(env);
    const { port, child } = running;

    const home = await request(port, 'GET', '/');
    assert.strictEqual(home.status, 200);
    assert.strictEqual(home.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(home.headers['x-frame-options'], 'DENY');
    assert.ok(home.headers['content-security-policy']);

    assert.strictEqual((await request(port, 'POST', '/api/bookings', ' '.repeat(20001))).status, 413);
    assert.deepStrictEqual((await request(port, 'GET', '/api/admin/session')).body, { authenticated: false });
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings')).status, 401);
    assert.strictEqual((await request(port, 'POST', '/api/admin/session', { key: 'wrong-key' })).status, 401);
    const login = await request(port, 'POST', '/api/admin/session', { key: staffKey });
    assert.strictEqual(login.status, 200);
    const cookieHeader = login.headers['set-cookie'][0];
    assert.ok(cookieHeader.includes('HttpOnly'));
    assert.ok(cookieHeader.includes('SameSite=Strict'));
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

    assert.strictEqual((await request(port, 'POST', '/api/admin/session/logout', {}, cookie)).status, 200);
    assert.strictEqual((await request(port, 'GET', '/api/admin/bookings', undefined, cookie)).status, 401);
    await stopServer(child);
    running = null;

    const productionEnv = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', DATA_DIR: path.join(dataDir, 'production-data'), OUTBOX_DIR: path.join(dataDir, 'production-outbox') };
    delete productionEnv.ADMIN_KEY;
    const production = await new Promise((resolve, reject) => {
      const childProcess = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: productionEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      childProcess.stderr.on('data', chunk => { output += chunk.toString(); });
      childProcess.on('error', reject);
      childProcess.on('exit', code => resolve({ code, output }));
    });
    assert.notStrictEqual(production.code, 0);
    assert.ok(production.output.includes('Production requires a unique ADMIN_KEY'));
    productionEnv.ADMIN_KEY = staffKey;
    running = await startServer(productionEnv);
    const secureHeaders = await request(running.port, 'GET', '/');
    assert.strictEqual(secureHeaders.headers['strict-transport-security'], 'max-age=31536000');
    const productionLogin = await request(running.port, 'POST', '/api/admin/session', { key: staffKey });
    assert.strictEqual(productionLogin.status, 200);
    assert.ok(productionLogin.headers['set-cookie'][0].includes('Secure'));
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
