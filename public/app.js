const $ = s => document.querySelector(s), money = displayPreferences.price;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iso = d => new Date(d).toISOString().slice(0, 10), addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = s => new Date(s + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
let rooms = [], query = {};
async function api(url, opts) { const r = await fetch(url, opts && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Request failed'); return j; }

const revealItems = document.querySelectorAll('[data-reveal]');
let revealObserver = null;
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -32px 0px' });
  document.body.classList.add('has-reveal-motion');
  revealItems.forEach(item => revealObserver.observe(item));
}

const roomTrack = $('#rooms'), roomCarousel = $('.room-carousel');
const roomNext = $('.room-arrow-next');
function updateRoomCarousel() {
  const canScroll = roomTrack.scrollWidth > roomTrack.clientWidth + 1;
  roomCarousel.classList.toggle('has-overflow', canScroll);
  roomNext.disabled = !canScroll || roomTrack.scrollLeft + roomTrack.clientWidth >= roomTrack.scrollWidth - 1;
}
function scrollRooms(direction) {
  const card = roomTrack.querySelector('.room');
  if (!card) return;
  const gap = parseFloat(getComputedStyle(roomTrack).columnGap) || 0;
  roomTrack.scrollBy({
    left: direction * (card.getBoundingClientRect().width + gap),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  });
}
if (roomTrack) {
  roomNext.onclick = () => scrollRooms(1);
  roomTrack.addEventListener('scroll', updateRoomCarousel, { passive: true });
  roomTrack.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      scrollRooms(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  window.addEventListener('resize', updateRoomCarousel);
}

if ($('#search')) {
  $('#checkIn').min = iso(new Date()); $('#checkIn').value = iso(addDays(new Date(), 1)); $('#checkOut').min = iso(addDays(new Date(), 2)); $('#checkOut').value = iso(addDays(new Date(), 3));
  $('#checkIn').onchange = () => { const c = $('#checkIn').value; $('#checkOut').min = iso(addDays(c, 1)); if ($('#checkOut').value <= c) $('#checkOut').value = iso(addDays(c, 1)); };

  $('#search').onsubmit = async e => {
    e.preventDefault(); $('#searchMsg').textContent = ''; $('#rooms').setAttribute('aria-busy', 'true');
    const searchButton = $('#search button[type="submit"]'), searchLabel = searchButton.innerHTML;
    searchButton.disabled = true; searchButton.textContent = 'Checking availability...';
    query = { checkIn: $('#checkIn').value, checkOut: $('#checkOut').value, guests: +$('#guests').value };
    try {
      rooms = (await api(`/api/availability?${new URLSearchParams(query)}`)).rooms;
      renderRooms();
      if (e.isTrusted) $('#stay').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { $('#searchMsg').textContent = err.message; }
    finally { $('#rooms').removeAttribute('aria-busy'); searchButton.disabled = false; searchButton.innerHTML = searchLabel; }
  };
}
function renderRooms() {
  roomTrack.scrollLeft = 0;
  const listings = rooms.flatMap(type => type.units.map(unit => ({ ...type, unit })));
  const availableCount = listings.filter(listing => listing.unit.available).length;
  $('#roomResultsMeta').textContent = `${availableCount} of ${listings.length} rooms available / ${fmtDate(query.checkIn)} to ${fmtDate(query.checkOut)}`;
  roomTrack.setAttribute('aria-label', `${listings.length} rooms and suites; ${availableCount} available`);
  roomTrack.classList.toggle('is-short-list', listings.length > 0 && listings.length <= 2);
  roomTrack.innerHTML = listings.length ? listings.map((r, i) => `<article class="card room ${esc(r.tone)}${r.unit.available ? '' : ' is-booked'}" data-reveal style="--room-delay:${i % 3 * .11}s">
    <div class="art" aria-label="${esc(r.name)}, room ${r.unit.number}${r.unit.available ? ', available' : ', booked for selected dates'}"><span class="art-panel art-panel-main" aria-hidden="true"></span><span class="art-panel art-panel-view" aria-hidden="true"></span><span class="art-panel art-panel-detail" aria-hidden="true"></span>
      <span class="room-number" aria-hidden="true">${r.unit.number}</span>
      ${r.unit.available ? (r.left <= 2 ? `<span class="badge">Only ${r.left} left</span>` : '') : '<span class="badge booked-badge">Booked for these dates</span>'}
    </div>
  <div class="body"><p class="room-overline">ROOMS &amp; SUITES <span aria-hidden="true">/</span> ${r.unit.number}</p><h3>${esc(r.name)}</h3><p>${esc(r.desc)}</p><div class="chips">${r.features.map(f => `<span>${esc(f)}</span>`).join('')}<span>Up to ${r.capacity} guests</span></div>
    <div class="foot"><div class="price"><b>${money(r.pricing.total)}</b><small>${r.pricing.nights} night${r.pricing.nights > 1 ? 's' : ''}, taxes included</small></div>
  <button class="btn room-cta" data-id="${esc(r.id)}" data-room="${r.unit.number}" ${r.unit.available ? '' : 'disabled'}>${r.unit.available ? 'Choose this room' : 'Booked'} <span aria-hidden="true">${r.unit.available ? '→' : '•'}</span></button></div></div></article>`).join('')
    : '<p class="empty card room-empty">No rooms fit that many guests. Try fewer guests or a different date range.</p>';
  if (revealObserver) roomTrack.querySelectorAll('[data-reveal]').forEach(item => revealObserver.observe(item));
  requestAnimationFrame(updateRoomCarousel);
}
if (roomTrack) $('#rooms').onclick = e => {
  const button = e.target.closest('button[data-id]');
  if (!button) return;
  const type = rooms.find(room => room.id === button.dataset.id);
  if (type) openBooking(type, Number(button.dataset.room));
};

const modal = $('#modal'), body = $('#sheetBody');
let returnFocus = null;
const open = html => {
  if (modal.hidden) returnFocus = document.activeElement;
  body.innerHTML = html;
  const title = body.querySelector('h3');
  if (title) { title.id = 'sheetTitle'; modal.setAttribute('aria-labelledby', 'sheetTitle'); }
  else modal.removeAttribute('aria-labelledby');
  modal.hidden = false; document.body.style.overflow = 'hidden';
  const firstControl = body.querySelector('input:not([type="hidden"]), select, textarea, button:not(.x)');
  (firstControl || $('#close')).focus();
};
const close = () => {
  modal.hidden = true; document.body.style.overflow = '';
  if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  returnFocus = null;
};
$('#close').onclick = close; modal.onclick = e => { if (e.target === modal) close(); };
document.addEventListener('keydown', e => {
  if (modal.hidden) return;
  if (e.key === 'Escape') { close(); return; }
  if (e.key !== 'Tab') return;
  const controls = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')].filter(el => !el.closest('[hidden]'));
  if (!controls.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
const menuToggle = $('.menu-toggle'), mainNav = $('#mainNav');
const menuIcon = menuToggle.innerHTML;
const closeIcon = '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>'; 
menuToggle.onclick = () => {
  const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!expanded));
  menuToggle.setAttribute('aria-label', expanded ? 'Open menu' : 'Close menu');
  menuToggle.innerHTML = expanded ? menuIcon : closeIcon;
  mainNav.classList.toggle('open', !expanded);
};
mainNav.onclick = e => {
  if (e.target.closest('a')) {
    mainNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open menu');
    menuToggle.innerHTML = menuIcon;
  }
};
const summary = (p, extra = '') => `<div class="sum">${extra}<div><span>${p.nights} night${p.nights > 1 ? 's' : ''}</span><span>${money(p.subtotal)}</span></div><div><span>Taxes (12%)</span><span>${money(p.tax)}</span></div><div class="tot"><span>Total</span><span>${money(p.total)}</span></div></div>`;

function openBooking(r, roomNumber) {
  open(`<h3>${r.name} · Room ${roomNumber}</h3><p class="muted">${fmtDate(query.checkIn)} to ${fmtDate(query.checkOut)}</p>${summary(r.pricing)}
  <form class="form" id="bform"><div class="two"><label>Full name<input name="name" maxlength="80" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" maxlength="30" autocomplete="tel"></label></div>
  <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
  <label>Guests<select name="guests">${Array.from({ length: r.capacity }, (_, i) => `<option ${i + 1 === query.guests ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
  <label>Special requests (optional)<textarea name="requests" rows="2" maxlength="400" placeholder="Late arrival, extra pillows..."></textarea></label>
  <p class="hint">Payment is collected at the hotel. Online card payments are not enabled.</p>
  <p class="msg" id="bmsg" role="alert"></p><button class="btn" id="bbtn">Confirm booking</button></form>`);
  $('#bform').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); $('#bbtn').disabled = true; $('#bbtn').textContent = 'Confirming...';
    try { const { booking } = await api('/api/bookings', { ...f, guests: +f.guests, typeId: r.id, roomNumber, checkIn: query.checkIn, checkOut: query.checkOut }); success(booking); }
    catch (err) { $('#bmsg').textContent = err.message; $('#bbtn').disabled = false; $('#bbtn').textContent = 'Confirm booking'; }
  };
}
function success(b) {
  ctx = { name: b.guest, email: b.email, ref: b.reference };
  open(`<div class="ok"><svg class="check" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><path d="M30 52l14 14 27-30"/></svg><h3>You're all set, ${esc(b.guest.split(' ')[0])}</h3>
  <p class="muted">Your booking is recorded for ${esc(b.email)}. Payment is due at the hotel.</p><div class="ref">${esc(b.reference)}</div>
  ${summary(b.pricing, `<div><span>Room</span><span>${esc(b.roomName)} #${b.room}</span></div><div><span>Check-in</span><span>${fmtDate(b.checkIn)}</span></div><div><span>Check-out</span><span>${fmtDate(b.checkOut)}</span></div><div><span>Payment</span><span>${b.payment}</span></div>`)}
  <div class="actions"><button class="btn" onclick="window.print()">Print voucher</button><button class="btn ghost" id="done">Done</button><button class="btn" id="dine">Order food</button></div></div>`);
  $('#dine').onclick = () => { try { sessionStorage.setItem('ma_dining_guest', JSON.stringify(ctx)); } catch { } window.location.href = 'dining.html'; };
  $('#done').onclick = () => { close(); $('#search').dispatchEvent(new Event('submit', { cancelable: true })); };
}

if ($('#lookup')) $('#lookup').onsubmit = async e => {
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
if ($('#search')) $('#search').dispatchEvent(new Event('submit', { cancelable: true }));

// ---------- Dining: menu, order, live tracking, ready alert ----------
let menu = [], cart = {}, ctx = {}, cat = 'All', tracked = null, timer = null, lastStatus = null, lastOrder = null;
if ($('#menu')) { try { ctx = JSON.parse(sessionStorage.getItem('ma_dining_guest')) || {}; } catch { } }
const STEPS = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'], LABEL = { RECEIVED: 'Received', PREPARING: 'Preparing', READY: 'Ready', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const store = { get() { try { return JSON.parse(sessionStorage.getItem('ma_order')); } catch { return null; } }, set(v) { try { v ? sessionStorage.setItem('ma_order', JSON.stringify(v)) : sessionStorage.removeItem('ma_order'); } catch { } } };
const cartLines = () => Object.entries(cart).map(([id, qty]) => ({ ...menu.find(m => m.id === id), qty }));
const cartSub = () => cartLines().reduce((s, l) => s + l.price * l.qty, 0);

function renderMenu(anim) {
  $('#menuStatus').textContent = '';
  const categories = ['All', 'Breakfast', 'Lunch', 'Dinner', ...new Set(menu.map(m => m.cat).filter(c => !['Breakfast', 'Lunch', 'Dinner'].includes(c)))];
  $('#tabs').innerHTML = categories.map(c => `<button type="button" class="tab ${c === cat ? 'on' : ''}" aria-pressed="${c === cat}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  const dishes = menu.filter(m => cat === 'All' || m.cat === cat || (m.meals || []).includes(cat));
  $('#menu').innerHTML = dishes.map((m, i) => `<article class="card dish ${anim ? 'enter' : ''}" style="animation-delay:${i * .04}s">
    <div class="dish-photo"><span class="dish-placeholder" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="34" cy="33" r="20"/><circle cx="34" cy="33" r="14"/><path d="M6 10v15m5-15v15M6 20h5M8.5 25v30M59 10v45M59 10c-7 7-7 20 0 20"/></svg></span><img src="images/food/${encodeURIComponent(m.id)}.jpg" alt="${esc(m.name)}" loading="lazy" decoding="async"><span class="dish-category">${esc(m.cat)}</span></div>
    <div class="dinfo"><h4>${esc(m.name)}</h4><p>${esc(m.desc)}</p><div class="dish-footer"><b>${money(m.price)}</b><div class="qty">${cart[m.id] ? `<button type="button" data-id="${esc(m.id)}" data-d="-1" aria-label="Remove one ${esc(m.name)}">&minus;</button><span aria-label="Quantity">${cart[m.id]}</span>` : ''}<button type="button" data-id="${esc(m.id)}" data-d="1" aria-label="Add ${esc(m.name)}">+</button></div></div></div></article>`).join('') || '<p class="empty">No dishes in this category yet.</p>';
  $('#menu').querySelectorAll('.dish-photo img').forEach(img => {
    const loaded = () => { img.hidden = !img.naturalWidth; img.parentElement.classList.toggle('has-photo', !!img.naturalWidth); };
    img.addEventListener('load', loaded);
    img.addEventListener('error', loaded);
    if (img.complete) loaded();
  });
  const n = Object.values(cart).reduce((a, b) => a + b, 0);
  $('#cartbar').classList.toggle('show', n > 0); $('#cartbar span').innerHTML = `${n} item${n > 1 ? 's' : ''}, ${money(cartSub())}`;
}
if ($('#menu')) {
  $('#tabs').onclick = e => { if (e.target.dataset.c) { cat = e.target.dataset.c; renderMenu(true); } };
  $('#menu').onclick = e => { const b = e.target.closest('button[data-id]'); if (!b) return; const id = b.dataset.id, next = (cart[id] || 0) + +b.dataset.d; if (next > 20) { $('#menuStatus').textContent = 'A maximum of 20 of each item can be ordered.'; return; } cart[id] = Math.max(0, next); if (!cart[id]) delete cart[id]; renderMenu(); };
  $('#reviewBtn').onclick = openCheckout;
}

function openCheckout() {
  const sub = cartSub(), tax = +(sub * 0.12).toFixed(2);
  open(`<h3>Your order</h3><div class="sum">${cartLines().map(l => `<div><span>${l.qty} x ${esc(l.name)}</span><span>${money(l.price * l.qty)}</span></div>`).join('')}<div><span>Taxes (12%)</span><span>${money(tax)}</span></div><div class="tot"><span>Total</span><span>${money(sub + tax)}</span></div></div>
  <form class="form" id="oform"><div class="two"><label>Full name<input name="name" maxlength="80" required value="${esc(ctx.name || '')}"></label><label>Email<input name="email" type="email" maxlength="254" required value="${esc(ctx.email || '')}"></label></div>
  <label>Booking reference (optional)<input name="bookingRef" maxlength="32" placeholder="OL-..." value="${esc(ctx.ref || '')}"></label><p class="hint">Add it for delivery to your room. Leave it empty to collect at the restaurant.</p>
  <label>Notes for the kitchen<textarea name="note" rows="2" maxlength="300" placeholder="Allergies, spice level..."></textarea></label>
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
  const tick = async () => {
    try { onStatus((await api(`/api/orders/${tracked.ref}?email=${encodeURIComponent(tracked.email)}`)).order); }
    catch (err) { $('#menuStatus').textContent = `Order tracking is temporarily unavailable. ${err.message}`; }
  };
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
if ($('#pill')) $('#pill').onclick = () => { if (lastOrder) { open(trackerHTML(lastOrder)); bindTracker(lastOrder); } };
function alertReady(o) {
  const msg = `Your order ${o.reference} is ready${o.room ? ` and on its way to room ${o.room}.` : '. Please collect it at the restaurant.'}`;
  chime(); toast(msg); if ('Notification' in window && Notification.permission === 'granted') new Notification('Your order is ready', { body: msg });
}
function chime() { try { const c = new (window.AudioContext || window.webkitAudioContext)();[880, 1175].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * .18; o.frequency.value = f; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.2, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + .6); o.start(t); o.stop(t + .65); }); } catch { } }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'alert'); t.textContent = msg; document.body.append(t); setTimeout(() => t.classList.add('out'), 9000); setTimeout(() => t.remove(), 9700); }
if ($('#menu')) {
api('/api/menu').then(r => { menu = r.menu; renderMenu(true); }).catch(err => {
  $('#menuStatus').textContent = `The menu could not be loaded. ${err.message}`;
});
const saved = store.get(); if (saved) { tracked = saved; poll(); }
}
