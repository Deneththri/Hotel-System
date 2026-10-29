const $ = s => document.querySelector(s), money = n => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iso = d => new Date(d).toISOString().slice(0, 10), addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = s => new Date(s + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
let rooms = [], query = {};
async function api(url, opts) { const r = await fetch(url, opts && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed'); return j; }

$('#checkIn').min = iso(new Date()); $('#checkIn').value = iso(addDays(new Date(), 1)); $('#checkOut').value = iso(addDays(new Date(), 3));
$('#checkIn').onchange = () => { const c = $('#checkIn').value; $('#checkOut').min = iso(addDays(c, 1)); if ($('#checkOut').value <= c) $('#checkOut').value = iso(addDays(c, 1)); };

$('#search').onsubmit = async e => {
  e.preventDefault(); $('#searchMsg').textContent = '';
  query = { checkIn: $('#checkIn').value, checkOut: $('#checkOut').value, guests: +$('#guests').value };
  try { rooms = (await api(`/api/availability?${new URLSearchParams(query)}`)).rooms; renderRooms(); }
  catch (err) { $('#searchMsg').textContent = err.message; }
};
function renderRooms() {
  $('#rooms').innerHTML = rooms.length ? rooms.map((r, i) => `<article class="card room ${r.tone}" style="animation-delay:${i * .12}s">
    <div class="art">${r.left <= 2 && r.left > 0 ? `<span class="badge">Only ${r.left} left</span>` : ''}${r.left === 0 ? '<span class="badge">Fully booked</span>' : ''}</div>
    <div class="body"><h3>${r.name}</h3><p>${r.desc}</p><div class="chips">${r.features.map(f => `<span>${f}</span>`).join('')}<span>Up to ${r.capacity} guests</span></div>
    <div class="foot"><div class="price"><b>${money(r.pricing.total)}</b><small>${r.pricing.nights} night${r.pricing.nights > 1 ? 's' : ''}, taxes included</small></div>
    <button class="btn" data-id="${r.id}" ${r.left ? '' : 'disabled'}>${r.left ? 'Reserve' : 'Unavailable'}</button></div></div></article>`).join('')
    : '<p class="empty card">No rooms fit that many guests. Try fewer guests or a different date range.</p>';
}
$('#rooms').onclick = e => { const id = e.target.dataset.id; if (id) openBooking(rooms.find(r => r.id === id)); };

const modal = $('#modal'), body = $('#sheetBody');
const open = html => { body.innerHTML = html; modal.hidden = false; document.body.style.overflow = 'hidden'; };
const close = () => { modal.hidden = true; document.body.style.overflow = ''; };
$('#close').onclick = close; modal.onclick = e => { if (e.target === modal) close(); }; document.onkeydown = e => { if (e.key === 'Escape') close(); };
const summary = (p, extra = '') => `<div class="sum">${extra}<div><span>${p.nights} night${p.nights > 1 ? 's' : ''}</span><span>${money(p.subtotal)}</span></div><div><span>Taxes (12%)</span><span>${money(p.tax)}</span></div><div class="tot"><span>Total</span><span>${money(p.total)}</span></div></div>`;

function openBooking(r) {
  open(`<h3>${r.name}</h3><p class="muted">${fmtDate(query.checkIn)} to ${fmtDate(query.checkOut)}</p>${summary(r.pricing)}
  <form class="form" id="bform"><div class="two"><label>Full name<input name="name" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" autocomplete="tel"></label></div>
  <label>Email (your confirmation goes here)<input name="email" type="email" required autocomplete="email"></label>
  <label>Guests<select name="guests">${Array.from({ length: r.capacity }, (_, i) => `<option ${i + 1 === query.guests ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
  <label>Special requests (optional)<textarea name="requests" rows="2" placeholder="Late arrival, extra pillows..."></textarea></label>
  <div class="pay"><label><input type="radio" name="payment" value="pay_at_hotel" checked> Pay at hotel</label><label><input type="radio" name="payment" value="card_demo"> Pay now (demo)</label></div>
  <p class="msg" id="bmsg" role="alert"></p><button class="btn" id="bbtn">Confirm booking</button></form>`);
  $('#bform').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); $('#bbtn').disabled = true; $('#bbtn').textContent = 'Confirming...';
    try { const { booking } = await api('/api/bookings', { ...f, guests: +f.guests, typeId: r.id, checkIn: query.checkIn, checkOut: query.checkOut }); success(booking); }
    catch (err) { $('#bmsg').textContent = err.message; $('#bbtn').disabled = false; $('#bbtn').textContent = 'Confirm booking'; }
  };
}
function success(b) {
  ctx = { name: b.guest, email: b.email, ref: b.reference };
  open(`<div class="ok"><svg class="check" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><path d="M30 52l14 14 27-30"/></svg><h3>You're all set, ${esc(b.guest.split(' ')[0])}</h3>
  <p class="muted">A confirmation has been sent to ${esc(b.email)}.</p><div class="ref">${b.reference}</div>
  ${summary(b.pricing, `<div><span>Room</span><span>${esc(b.roomName)} #${b.room}</span></div><div><span>Check-in</span><span>${fmtDate(b.checkIn)}</span></div><div><span>Check-out</span><span>${fmtDate(b.checkOut)}</span></div><div><span>Payment</span><span>${b.payment}</span></div>`)}
  <div class="actions"><button class="btn" onclick="window.print()">Print voucher</button><button class="btn ghost" id="done">Done</button><button class="btn" id="dine">Order food</button></div></div>`);
  $('#dine').onclick = () => { close(); $('#dining').scrollIntoView({ behavior: 'smooth' }); };
  $('#done').onclick = () => { close(); $('#search').dispatchEvent(new Event('submit', { cancelable: true })); };
}

$('#lookup').onsubmit = async e => {
  e.preventDefault(); $('#lookupMsg').textContent = ''; $('#lookupResult').innerHTML = '';
  try { const { booking: b } = await api(`/api/bookings/${encodeURIComponent($('#lref').value.trim())}?email=${encodeURIComponent($('#lemail').value.trim())}`); showBooking(b); }
  catch (err) { $('#lookupMsg').textContent = err.message; }
};
function showBooking(b) {
  $('#lookupResult').innerHTML = `<div class="card"><span class="status ${b.status}">${b.status.replace('_', ' ')}</span><h3 style="font:600 1.7rem var(--serif);margin:10px 0 2px">${esc(b.roomName)} #${b.room}</h3>
  <p class="muted">${b.reference} &middot; ${fmtDate(b.checkIn)} to ${fmtDate(b.checkOut)}</p>${summary(b.pricing)}
  ${b.status === 'CONFIRMED' ? '<div class="actions"><button class="btn ghost" id="cancel">Cancel booking</button></div>' : ''}</div>`;
  const c = $('#cancel'); if (c) c.onclick = async () => {
    if (!confirm('Cancel this booking? This cannot be undone.')) return;
    try { showBooking((await api(`/api/bookings/${b.reference}/cancel`, { email: b.email })).booking); } catch (err) { $('#lookupMsg').textContent = err.message; }
  };
}
$('#search').dispatchEvent(new Event('submit', { cancelable: true }));

// ---------- Dining: menu, order, live tracking, ready alert ----------
let menu = [], cart = {}, ctx = {}, cat = 'All', tracked = null, timer = null, lastStatus = null, lastOrder = null;
const STEPS = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'], LABEL = { RECEIVED: 'Received', PREPARING: 'Preparing', READY: 'Ready', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const store = { get() { try { return JSON.parse(localStorage.getItem('ma_order')); } catch { return null; } }, set(v) { try { v ? localStorage.setItem('ma_order', JSON.stringify(v)) : localStorage.removeItem('ma_order'); } catch { } } };
const cartLines = () => Object.entries(cart).map(([id, qty]) => ({ ...menu.find(m => m.id === id), qty }));
const cartSub = () => cartLines().reduce((s, l) => s + l.price * l.qty, 0);

function renderMenu(anim) {
  $('#tabs').innerHTML = ['All', ...new Set(menu.map(m => m.cat))].map(c => `<button class="tab ${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  $('#menu').innerHTML = menu.filter(m => cat === 'All' || m.cat === cat).map((m, i) => `<div class="card dish ${anim ? 'enter' : ''}" style="animation-delay:${i * .06}s"><div class="ico">${m.icon}</div>
    <div class="dinfo"><h4>${m.name}</h4><p>${m.desc}</p><b>${money(m.price)}</b></div><div class="qty">${cart[m.id] ? `<button data-id="${m.id}" data-d="-1" aria-label="Remove one ${m.name}">&minus;</button><span>${cart[m.id]}</span>` : ''}<button data-id="${m.id}" data-d="1" aria-label="Add ${m.name}">+</button></div></div>`).join('');
  const n = Object.values(cart).reduce((a, b) => a + b, 0);
  $('#cartbar').classList.toggle('show', n > 0); $('#cartbar span').textContent = `${n} item${n > 1 ? 's' : ''}, ${money(cartSub())}`;
}
$('#tabs').onclick = e => { if (e.target.dataset.c) { cat = e.target.dataset.c; renderMenu(true); } };
$('#menu').onclick = e => { const b = e.target.closest('button[data-id]'); if (!b) return; const id = b.dataset.id; cart[id] = Math.max(0, (cart[id] || 0) + +b.dataset.d); if (!cart[id]) delete cart[id]; renderMenu(); };
$('#reviewBtn').onclick = openCheckout;

function openCheckout() {
  const sub = cartSub(), tax = +(sub * 0.12).toFixed(2);
  open(`<h3>Your order</h3><div class="sum">${cartLines().map(l => `<div><span>${l.qty} x ${l.name}</span><span>${money(l.price * l.qty)}</span></div>`).join('')}<div><span>Taxes (12%)</span><span>${money(tax)}</span></div><div class="tot"><span>Total</span><span>${money(sub + tax)}</span></div></div>
  <form class="form" id="oform"><div class="two"><label>Full name<input name="name" required value="${esc(ctx.name || '')}"></label><label>Email<input name="email" type="email" required value="${esc(ctx.email || '')}"></label></div>
  <label>Booking reference (optional)<input name="bookingRef" placeholder="OL-1A2B3C" value="${esc(ctx.ref || '')}"></label><p class="hint">Add it and we'll bring your order to your room. Leave it empty to collect at the restaurant.</p>
  <label>Notes for the kitchen<textarea name="note" rows="2" placeholder="Allergies, spice level..."></textarea></label>
  <p class="msg" id="omsg" role="alert"></p><button class="btn" id="obtn">Place order</button></form>`);
  $('#oform').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); $('#obtn').disabled = true; $('#obtn').textContent = 'Placing order...';
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      const { order } = await api('/api/orders', { ...f, items: Object.entries(cart).map(([id, qty]) => ({ id, qty })) });
      cart = {}; renderMenu(); tracked = { ref: order.reference, email: order.email }; store.set(tracked); lastStatus = null; lastOrder = order;
      open(trackerHTML(order)); bindTracker(order); poll();
    } catch (err) { $('#omsg').textContent = err.message; $('#obtn').disabled = false; $('#obtn').textContent = 'Place order'; }
  };
}
function trackerHTML(o) {
  const i = STEPS.indexOf(o.status), head = { READY: 'Your order is ready', DELIVERED: 'Enjoy your meal', CANCELLED: 'Order cancelled' }[o.status] || 'Order confirmed';
  const bar = o.status === 'CANCELLED' ? '<span class="status CANCELLED">Cancelled</span>' : `<div class="steps" style="--p:${i}">${STEPS.map((s, k) => `<div class="step ${k <= i ? 'done' : ''} ${k === i ? 'now' : ''}"><i></i><small>${LABEL[s]}</small></div>`).join('')}</div>`;
  return `<div class="track ok"><h3>${head}</h3><p class="muted">${o.room ? `Delivering to room ${o.room}.` : 'Collect at the restaurant.'} We'll alert you the moment it's ready.</p><div class="ref">${o.reference}</div>${bar}
  <div class="sum">${o.lines.map(l => `<div><span>${l.qty} x ${esc(l.name)}</span><span>${money(l.price * l.qty)}</span></div>`).join('')}<div class="tot"><span>Total</span><span>${money(o.pricing.total)}</span></div></div>
  <div class="actions">${o.status === 'RECEIVED' ? '<button class="btn ghost" id="ocancel">Cancel order</button>' : ''}<button class="btn" id="oclose">Close</button></div></div>`;
}
function bindTracker(o) {
  $('#oclose').onclick = close;
  const c = $('#ocancel'); if (c) c.onclick = async () => { if (!confirm('Cancel this order?')) return; try { onStatus((await api(`/api/orders/${o.reference}/cancel`, { email: o.email })).order); } catch (err) { alert(err.message); } };
}
function poll() {
  clearInterval(timer); if (!tracked) return;
  const tick = async () => { try { onStatus((await api(`/api/orders/${tracked.ref}?email=${encodeURIComponent(tracked.email)}`)).order); } catch { } };
  tick(); timer = setInterval(tick, 4000);
}
function onStatus(o) {
  const pill = $('#pill'); pill.hidden = false; pill.dataset.s = o.status; pill.textContent = `${o.reference}: ${LABEL[o.status]}`;
  if (o.status === lastStatus) return;
  lastStatus = o.status; lastOrder = o;
  if (!modal.hidden && body.querySelector('.track')) { body.innerHTML = trackerHTML(o); bindTracker(o); }
  if (o.status === 'READY') alertReady(o);
  if (o.status === 'DELIVERED' || o.status === 'CANCELLED') { clearInterval(timer); tracked = null; store.set(null); setTimeout(() => { pill.hidden = true; }, 10000); }
}
$('#pill').onclick = () => { if (lastOrder) { open(trackerHTML(lastOrder)); bindTracker(lastOrder); } };
function alertReady(o) {
  const msg = `Your order ${o.reference} is ready${o.room ? ` and on its way to room ${o.room}.` : '. Please collect it at the restaurant.'}`;
  chime(); toast(msg); if ('Notification' in window && Notification.permission === 'granted') new Notification('Your order is ready', { body: msg });
}
function chime() { try { const c = new (window.AudioContext || window.webkitAudioContext)();[880, 1175].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * .18; o.frequency.value = f; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.2, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + .6); o.start(t); o.stop(t + .65); }); } catch { } }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'alert'); t.textContent = msg; document.body.append(t); setTimeout(() => t.classList.add('out'), 9000); setTimeout(() => t.remove(), 9700); }
api('/api/menu').then(r => { menu = r.menu; renderMenu(true); });
const saved = store.get(); if (saved) { tracked = saved; poll(); }