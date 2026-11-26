const $ = s => document.querySelector(s), money = displayPreferences.price;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iso = d => new Date(d).toISOString().slice(0, 10), addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const hotelCalendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtDate = s => new Date(s + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const scrollHomeTo = id => {
  const section = $('#' + id);
  if (!section) return;
  if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
  section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
};
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

const roomTrack = $('#rooms'), roomsPage = document.body.classList.contains('rooms-page');
const homePage = document.body.matches('.home-page:not(.luxury-page)');
const roomCarousel = $('.room-carousel'), roomNext = $('.room-arrow-next');
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
if (roomTrack && roomNext) {
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

const searchForm = $('#search');
const searchMessage = $('#searchMsg');

if (searchForm) {
  const params = new URLSearchParams(location.search);
  const checkIn = $('#checkIn'), checkOut = $('#checkOut');
  checkIn.min = hotelCalendar.format(new Date());
  checkIn.value = params.get('checkIn') || iso(addDays(checkIn.min, 1));
  if (!checkIn.value || checkIn.value < checkIn.min) checkIn.value = iso(addDays(checkIn.min, 1));
  checkOut.value = params.get('checkOut') || iso(addDays(checkIn.min, 3));
  checkIn.onchange = () => {
    if (!checkIn.value) return;
    checkOut.min = iso(addDays(checkIn.value + 'T00:00:00Z', 1));
    if (!checkOut.value || checkOut.value < checkOut.min) checkOut.value = checkOut.min;
  };
  checkIn.onchange();
  for (const id of ['adults', 'children']) {
    const field = $('#' + id);
    if ([...field.options].some(option => option.value === params.get(id))) field.value = params.get(id);
  }
  const exploreRoomsLink = $('#exploreRooms');
  if (exploreRoomsLink) {
    const updateExploreRoomsLink = () => {
      const filters = new URLSearchParams({
        checkIn: checkIn.value,
        checkOut: checkOut.value,
        adults: $('#adults').value,
        children: $('#children').value
      });
      exploreRoomsLink.href = `rooms.html?${filters}#stay`;
    };
    ['checkIn', 'checkOut', 'adults', 'children'].forEach(id =>
      $('#' + id).addEventListener('change', updateExploreRoomsLink));
    updateExploreRoomsLink();
  }

  let entryRoom = roomsPage ? Number(params.get('room')) : 0;
  searchForm.onsubmit = async event => {
    event.preventDefault();
    const searchButton = searchForm.querySelector('button[type="submit"]');
    if (searchButton.disabled) return;
    const searchLabel = searchButton.textContent;
    const dates = { checkIn: checkIn.value, checkOut: checkOut.value };
    const adults = $('#adults').value, children = $('#children').value;
    const criteria = { ...dates, guests: Number(adults) + Number(children) };
    searchMessage.textContent = '';
    roomTrack.setAttribute('aria-busy', 'true');
    roomTrack.inert = true;
    searchButton.disabled = true;
    searchButton.textContent = 'Checking availability...';
    try {
      const result = await api(`/api/availability?${new URLSearchParams(criteria)}`);
      rooms = result.rooms;
      query = { ...criteria, adults, children };
      renderRooms();
      if (entryRoom) {
        const type = rooms.find(item => item.units.some(unit => unit.available && unit.number === entryRoom));
        if (type) openBooking(type, entryRoom);
        entryRoom = 0;
      }
      if (event.isTrusted) {
        const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        $('#stay').scrollIntoView({ behavior, block: 'start' });
      }
    } catch (error) {
      searchMessage.textContent = error.message;
    } finally {
      roomTrack.removeAttribute('aria-busy');
      roomTrack.inert = false;
      searchButton.disabled = false;
      searchButton.textContent = searchLabel;
    }
  };
}
function renderRooms() {
  roomTrack.scrollLeft = 0;
  const listings = rooms.map(type => ({
    ...type,
    availableUnits: type.units.filter(unit => unit.available),
    unitCount: type.units.length
  }));
  const availableCount = listings.reduce((total, listing) => total + listing.availableUnits.length, 0);
  const totalCount = listings.reduce((total, listing) => total + listing.unitCount, 0);
  if (roomsPage) listings.sort((first, second) => second.availableUnits.length - first.availableUnits.length);
  $('#roomResultsMeta').textContent = `${availableCount} of ${totalCount} rooms available / ${fmtDate(query.checkIn)} to ${fmtDate(query.checkOut)}`;
  roomTrack.setAttribute('aria-label', `${listings.length} room and suite types; ${availableCount} of ${totalCount} rooms available`);
  roomTrack.classList.toggle('is-short-list', listings.length > 0 && listings.length <= 2);
  roomTrack.innerHTML = listings.length ? listings.map((r, i) => {
    const available = r.availableUnits.length > 0;
    const roomNumber = available ? r.availableUnits[0].number : r.units[0].number;
    return `<article class="card room ${esc(r.tone)}${available ? '' : ' is-booked'}" ${roomsPage ? '' : `data-reveal style="--room-delay:${i % 3 * .11}s"`}>
    <div class="art" aria-label="${esc(r.name)}, ${r.availableUnits.length} of ${r.unitCount} rooms available"><span class="art-panel art-panel-main" aria-hidden="true"></span><span class="art-panel art-panel-view" aria-hidden="true"></span><span class="art-panel art-panel-detail" aria-hidden="true"></span>
      <span class="room-number" aria-hidden="true">0${i + 1}</span>
      ${available ? (r.left <= 2 ? `<span class="badge">Only ${r.left} left</span>` : '') : '<span class="badge booked-badge">Booked for these dates</span>'}
      <span class="room-price-badge">${money(r.price)} <small>per night</small></span>
    </div>
  <div class="body"><p class="room-overline">ROOMS &amp; SUITES <span aria-hidden="true">/</span> ${String(i + 1).padStart(2, '0')}</p><h3>${esc(r.name)}</h3><p>${esc(r.desc)}</p><div class="chips">${r.features.map(f => `<span>${esc(f)}</span>`).join('')}<span class="room-capacity"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 19v-1a6 6 0 0 1 12 0v1m2-8a3 3 0 1 0-1-5.8M18 14a5 5 0 0 1 3 4v1"/></svg>Up to ${r.capacity} guests</span></div>
    <div class="foot"><div class="price"><b>${money(r.pricing.total)}</b><small>${r.pricing.nights} night${r.pricing.nights > 1 ? 's' : ''}, taxes included</small></div>
  <button class="btn room-cta" data-id="${esc(r.id)}" data-room="${roomNumber}" ${available ? '' : 'disabled'}>${available ? 'Choose this room' : 'Booked'} <span aria-hidden="true">${available ? '→' : '•'}</span></button></div></div></article>`;
  }).join('')
    : '<p class="empty card room-empty">No rooms fit that many guests. Try fewer guests or a different date range.</p>';
  if (revealObserver && !roomsPage) roomTrack.querySelectorAll('[data-reveal]').forEach(item => revealObserver.observe(item));
  if (roomNext) requestAnimationFrame(updateRoomCarousel);
}
if (roomTrack) $('#rooms').onclick = e => {
  const button = e.target.closest('button[data-id]');
  if (!button) return;
  const type = rooms.find(room => room.id === button.dataset.id);
  if (!type) return;
  if (!roomsPage && !homePage) {
    const dates = { checkIn: query.checkIn, checkOut: query.checkOut };
    location.href = 'rooms.html?' + new URLSearchParams({
      ...dates, adults: query.adults, children: query.children, room: button.dataset.room
    }) + '#stay';
    return;
  }
  openBooking(type, Number(button.dataset.room));
};

const modal = $('#modal'), body = $('#sheetBody');
let returnFocus = null, submitting = false;
const open = html => {
  if (modal.hidden) returnFocus = document.activeElement;
  body.innerHTML = html;
  const title = body.querySelector('h3');
  if (title) { title.id = 'sheetTitle'; $('.sheet').setAttribute('aria-labelledby', 'sheetTitle'); }
  else $('.sheet').removeAttribute('aria-labelledby');
  modal.hidden = false; document.body.style.overflow = 'hidden';
  $('.sheet').scrollTop = 0;
  const firstControl = body.querySelector('input:not([type="hidden"]), select, textarea, button:not(.x)');
  if (!firstControl?.matches('input, select, textarea') && title) { title.tabIndex = -1; title.focus(); }
  else (firstControl || $('#close')).focus();
};
const close = () => {
  if (submitting) return;
  if (body.querySelector('#oform')) setDiningStep(0);
  modal.hidden = true; document.body.style.overflow = '';
  if (returnFocus && returnFocus.isConnected && !returnFocus.disabled) returnFocus.focus();
  else if ($('#pill') && !$('#pill').hidden) $('#pill').focus();
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
const bookingSteps = ['Dates & room', 'Guest details', 'Confirmation'];
const diningSteps = ['Choose dishes', 'Review order', 'Track order'];
const journey = (labels, current) => `<ol class="journey-steps" aria-label="Progress">${labels.map((label, index) =>
  `<li ${current === index ? 'aria-current="step"' : ''} class="${index < current ? 'complete' : ''}">${label}</li>`
).join('')}</ol>`;
const stayDetails = (name, room, checkIn, checkOut) => `
  <div><span>Room</span><strong>${esc(name)} #${esc(room)}</strong></div>
  <div><span>Check-in</span><span>${fmtDate(checkIn)}</span></div>
  <div><span>Check-out</span><span>${fmtDate(checkOut)}</span></div>`;
const statusLabel = status => status.toLowerCase().replaceAll('_', ' ');
const taxLabel = rate => Number.isFinite(rate) ? `VAT (${rate * 100}%)` : 'Tax';
const summary = (p, extra = '') => `<div class="sum">${extra}<div><span>${p.nights} night${p.nights > 1 ? 's' : ''}</span><span>${money(p.subtotal)}</span></div><div><span>${taxLabel(p.taxRate)}</span><span>${money(p.tax)}</span></div><div class="tot"><span>Total</span><span>${money(p.total)}</span></div></div>`;

function openBooking(r, roomNumber) {
  const { checkIn, checkOut, guests } = query;
  open(`<h3>Book your stay</h3>${journey(bookingSteps, 1)}
  <div class="checkout-layout">
  <form class="form" id="bform"><div class="two"><label>Full name<input name="name" maxlength="80" required autocomplete="name"></label><label>Phone<input name="phone" type="tel" maxlength="30" autocomplete="tel"></label></div>
  <label>Email<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
  <label>Guests<select name="guests">${Array.from({ length: r.capacity }, (_, i) => `<option ${i + 1 === guests ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
  <label>Special requests (optional)<textarea name="requests" rows="2" maxlength="400" placeholder="Late arrival, extra pillows..."></textarea></label>
  <p class="hint">Payment is due at the hotel.</p>
  <p class="msg" id="bmsg" role="alert"></p><button class="btn" id="bbtn">Confirm booking</button></form>
  <aside class="checkout-summary" aria-label="Stay summary"><h4>Stay summary</h4>
  ${summary(r.pricing, stayDetails(r.name, roomNumber, checkIn, checkOut))}</aside></div>`);
  $('#bform').onsubmit = async e => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    $('#close').disabled = true;
    const f = Object.fromEntries(new FormData(e.target)); $('#bbtn').disabled = true; $('#bbtn').textContent = 'Confirming...';
    try { const { booking } = await api('/api/bookings', { ...f, guests: +f.guests, typeId: r.id, roomNumber, checkIn, checkOut }); success(booking); }
    catch (err) { $('#bmsg').textContent = err.message; $('#bbtn').disabled = false; $('#bbtn').textContent = 'Confirm booking'; }
    finally { submitting = false; $('#close').disabled = false; }
  };
}
function success(b) {
  const today = hotelCalendar.format(new Date());
  ctx = { name: b.guest, email: b.email, ref: b.checkIn <= today && today < b.checkOut ? b.reference : '' };
  open(`<div class="ok"><svg class="check" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><path d="M30 52l14 14 27-30"/></svg><h3>You're all set, ${esc(b.guest.split(' ')[0])}</h3>${journey(bookingSteps, 2)}
  <p class="muted">Save this reference and use ${esc(b.email)} to manage your booking. Payment is due at the hotel.</p><div class="ref">${esc(b.reference)}</div>
  ${summary(b.pricing, stayDetails(b.roomName, b.room, b.checkIn, b.checkOut))}
  <div class="actions"><button class="btn" type="button" id="printVoucher">Print voucher</button><a class="btn ghost" id="manageBookingLink" href="manage.html?ref=${encodeURIComponent(b.reference)}">Manage booking</a><button class="btn ghost" id="done">Done</button><button class="btn" id="dine">Order food</button></div></div>`);
  $('#printVoucher').onclick = () => window.print();
  $('#manageBookingLink').onclick = event => {
    if (!homePage) {
      try { sessionStorage.setItem('aurelia_booking_lookup', JSON.stringify({ reference: b.reference, email: b.email })); } catch { }
      return;
    }
    event.preventDefault();
    close();
    $('#lref').value = b.reference;
    $('#lemail').value = b.email;
    scrollHomeTo('manage');
    $('#lref').focus({ preventScroll: true });
    $('#lookup').requestSubmit();
  };
  $('#dine').onclick = () => {
    try { sessionStorage.setItem('ma_dining_guest', JSON.stringify(ctx)); } catch { }
    if (homePage) {
      close();
      scrollHomeTo('dining');
    } else {
      window.location.href = 'dining.html#dining';
    }
  };
  $('#done').onclick = () => { close(); $('#search').dispatchEvent(new Event('submit', { cancelable: true })); };
}

if ($('#lookup')) {
  const lookup = $('#lookup');
  const managePage = document.body.classList.contains('manage-page');
  if (managePage || homePage) {
    $('#lref').value = new URLSearchParams(location.search).get('ref') || '';
    try {
      const pending = JSON.parse(sessionStorage.getItem('aurelia_booking_lookup'));
      sessionStorage.removeItem('aurelia_booking_lookup');
      if (pending) {
        $('#lref').value = pending.reference;
        $('#lemail').value = pending.email;
      }
    } catch { }
  }
  lookup.onsubmit = async event => {
    event.preventDefault();
    const reference = $('#lref').value.trim(), email = $('#lemail').value.trim();
    if (!managePage && !homePage) {
      try {
        sessionStorage.setItem('aurelia_booking_lookup', JSON.stringify({ reference, email }));
        location.href = 'manage.html';
        return;
      } catch { }
    }
    const button = lookup.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    $('#lookupMsg').textContent = 'Finding your booking...';
    $('#lookupResult').innerHTML = '';
    try {
      const { booking } = await api(`/api/bookings/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`);
      showBooking(booking);
      $('#lookupMsg').textContent = '';
    } catch (error) {
      $('#lookupMsg').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  if (managePage && $('#lemail').value) lookup.requestSubmit();
}
function showBooking(b) {
  const canCancel = b.status === 'CONFIRMED' && b.checkIn >= hotelCalendar.format(new Date());
  $('#lookupResult').innerHTML = `<article class="card booking-result" aria-labelledby="bookingResultTitle">
    <header class="booking-result-header"><div><h3 id="bookingResultTitle" tabindex="-1">Your reservation</h3><p>${esc(b.reference)}</p></div>
    <span class="status ${esc(b.status)}">${esc(statusLabel(b.status))}</span></header>
    ${summary(b.pricing, stayDetails(b.roomName, b.room, b.checkIn, b.checkOut))}
    ${canCancel ? '<div class="actions"><button type="button" class="btn ghost" id="cancel">Cancel booking</button></div>' : ''}
    </article>`;
  $('#bookingResultTitle').focus({ preventScroll: true });
  const c = $('#cancel'); if (c) c.onclick = async () => {
    if (!confirm('Cancel this booking? This cannot be undone.')) return;
    c.disabled = true;
    $('#lookupMsg').textContent = '';
    try {
      const { booking } = await api(`/api/bookings/${b.reference}/cancel`, { email: b.email });
      showBooking(booking);
      $('#lookupMsg').textContent = 'Your booking has been cancelled.';
    } catch (err) {
      $('#lookupMsg').textContent = err.message;
      c.disabled = false;
      c.focus();
    }
  };
}
if (roomTrack) searchForm.dispatchEvent(new Event('submit', { cancelable: true }));

// ---------- Dining: menu, order, live tracking, ready alert ----------
function readDiningCart() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('ma_dining_cart') || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved)
      .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0 && quantity <= 20));
  } catch {
    return {};
  }
}
function saveDiningCart() {
  try {
    sessionStorage.setItem('ma_dining_cart', JSON.stringify(cart));
  } catch { }
}
const diningProgress = [...document.querySelectorAll('.dining-journey > li')];
function setDiningStep(current) {
  diningProgress.forEach((step, index) => {
    if (index === current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
    step.classList.toggle('complete', index < current);
  });
}
function chooseDishes() {
  setDiningStep(0);
  scrollHomeTo('menu');
  $('#tabs .tab.on')?.focus({ preventScroll: true });
}
function openOrderTracker() {
  if (!lastOrder) return;
  setDiningStep(2);
  open(trackerHTML(lastOrder));
  bindTracker(lastOrder);
}
const cartDetails = $('#cartDetails');
const emptyCartMarkup = cartDetails?.innerHTML;
let menuTaxRate;
let menu = [], cart = readDiningCart(), ctx = {}, cat = 'All', tracked = null, timer = null, lastStatus = null, lastOrder = null;
if ($('#menu')) { try { ctx = JSON.parse(sessionStorage.getItem('ma_dining_guest')) || {}; } catch { } }
const STEPS = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'], LABEL = { RECEIVED: 'Received', PREPARING: 'Preparing', READY: 'Ready', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const store = { get() { try { return JSON.parse(sessionStorage.getItem('ma_order')); } catch { return null; } }, set(v) { try { v ? sessionStorage.setItem('ma_order', JSON.stringify(v)) : sessionStorage.removeItem('ma_order'); } catch { } } };
const cartLines = () => Object.entries(cart).map(([id, qty]) => ({ ...menu.find(m => m.id === id), qty }));
const cartSub = () => cartLines().reduce((s, l) => s + l.price * l.qty, 0);
const orderLines = lines => lines.map(line =>
  `<div><span>${line.qty} &times; ${esc(line.name)}</span><span>${money(line.price * line.qty)}</span></div>`
).join('');
function cartSummary() {
  const subtotal = cartSub(), tax = +(subtotal * menuTaxRate).toFixed(2);
  return `<div class="sum">${orderLines(cartLines())}<div><span>${taxLabel(menuTaxRate)}</span><span>${money(tax)}</span></div>
    <div class="tot"><span>Total</span><span>${money(subtotal + tax)}</span></div></div>`;
}

function renderMenu(anim) {
  $('#menuStatus').textContent = '';
  const categories = ['All', 'Breakfast', 'Lunch', 'Dinner', ...new Set(menu.map(m => m.cat).filter(c => !['Breakfast', 'Lunch', 'Dinner'].includes(c)))];
  $('#tabs').innerHTML = categories.map(c => `<button type="button" class="tab ${c === cat ? 'on' : ''}" aria-pressed="${c === cat}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  const filteredDishes = menu.filter(m => cat === 'All' || m.cat === cat || (m.meals || []).includes(cat));
  const featuredDishes = ['Breakfast', 'Starters', 'Mains', 'Desserts', 'Drinks']
    .flatMap(category => menu.filter(item => item.cat === category).slice(0, category === 'Mains' ? 2 : 1));
  const dishes = homePage
    ? (cat === 'All' ? featuredDishes : filteredDishes.slice(0, 6))
    : filteredDishes;
  $('#menu').innerHTML = dishes.map((m, i) => `<article class="card dish ${anim ? 'enter' : ''}" style="animation-delay:${i * .04}s">
    <div class="dish-photo"><span class="dish-placeholder" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="34" cy="33" r="20"/><circle cx="34" cy="33" r="14"/><path d="M6 10v15m5-15v15M6 20h5M8.5 25v30M59 10v45M59 10c-7 7-7 20 0 20"/></svg></span><img src="images/food/${encodeURIComponent(m.id)}.jpg" alt="${esc(m.name)}" loading="lazy" decoding="async"><span class="dish-category">${esc(m.cat)}</span></div>
    <div class="dinfo"><h4>${esc(m.name)}</h4><p>${esc(m.desc)}</p><div class="dish-footer"><b>${money(m.price)}</b><div class="qty">${cart[m.id] ? `<button type="button" data-id="${esc(m.id)}" data-d="-1" aria-label="Remove one ${esc(m.name)}">&minus;</button><span aria-label="Quantity">${cart[m.id]}</span>` : ''}<button type="button" data-id="${esc(m.id)}" data-d="1" aria-label="Add ${esc(m.name)} to cart">${cart[m.id] ? "+" : "Add to cart"}</button></div></div></div></article>`).join('') || '<p class="empty">No dishes in this category yet.</p>';
  $('#menu').querySelectorAll('.dish-photo img').forEach(img => {
    const loaded = () => { img.hidden = !img.naturalWidth; img.parentElement.classList.toggle('has-photo', !!img.naturalWidth); };
    img.addEventListener('load', loaded);
    img.addEventListener('error', loaded);
    if (img.complete) loaded();
  });
  const itemCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0);
  const hasItems = itemCount > 0;
  $('#cartTitle').textContent = hasItems ? `Your order (${itemCount})` : 'Your order';
  cartDetails.innerHTML = hasItems ? cartSummary() : emptyCartMarkup;
  $('#reviewBtn').disabled = !hasItems;
  diningProgress[1].firstElementChild.disabled = !hasItems;
}
if ($('#menu')) {
  $('#tabs').onclick = event => {
    const button = event.target.closest('button[data-c]');
    if (!button) return;
    const index = [...button.parentElement.children].indexOf(button);
    cat = button.dataset.c;
    renderMenu(true);
    $('#tabs').children[index].focus();
  };
  $('#menu').onclick = event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const id = button.dataset.id, next = (cart[id] || 0) + Number(button.dataset.d);
    if (next > 20) {
      $('#menuStatus').textContent = 'A maximum of 20 of each item can be ordered.';
      return;
    }
    if (next > 0) cart[id] = next;
    else delete cart[id];
    saveDiningCart();
    setDiningStep(0);
    renderMenu();
    const controls = [...document.querySelectorAll('#menu button[data-id]')].filter(item => item.dataset.id === id);
    (controls.find(item => item.dataset.d === button.dataset.d) || controls[0])?.focus({ preventScroll: true });
  };
  $('#reviewBtn').onclick = openCheckout;
  diningProgress[0].firstElementChild.onclick = chooseDishes;
  diningProgress[1].firstElementChild.onclick = openCheckout;
  diningProgress[2].firstElementChild.onclick = openOrderTracker;
}

function openCheckout() {
  if (!Object.keys(cart).length) return;
  setDiningStep(1);
  open(`<h3>Review your order</h3>${journey(diningSteps, 1)}<div class="checkout-layout">
  <form class="form" id="oform"><div class="two"><label>Full name<input name="name" autocomplete="name" maxlength="80" required value="${esc(ctx.name || '')}"></label><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(ctx.email || '')}"></label></div>
  <label>How would you like to receive your order?
    <select id="orderFulfillment"><option value="pickup">Collect at the restaurant</option><option value="delivery" ${ctx.ref ? 'selected' : ''}>Deliver to my room</option></select></label>
  <label id="deliveryReference" ${ctx.ref ? '' : 'hidden'}>Booking reference
    <input name="bookingRef" maxlength="32" autocomplete="off" value="${esc(ctx.ref || '')}" ${ctx.ref ? 'required' : 'disabled'}></label>
  <label>Notes for the kitchen<textarea name="note" rows="2" maxlength="300" placeholder="Allergies, spice level..."></textarea></label>
  <p class="msg" id="omsg" role="alert"></p><button class="btn" id="obtn">Place order</button></form>
  <aside class="checkout-summary" aria-label="Order summary"><h4>Order summary</h4>${cartSummary()}</aside></div>`);
  const fulfillment = $('#orderFulfillment');
  fulfillment.onchange = () => {
    const delivery = fulfillment.value === 'delivery';
    const label = $('#deliveryReference'), reference = label.querySelector('input');
    label.hidden = !delivery;
    reference.disabled = !delivery;
    reference.required = delivery;
  };
  $('#oform').onsubmit = async e => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    $('#close').disabled = true;
    const f = Object.fromEntries(new FormData(e.target)); $('#obtn').disabled = true; $('#obtn').textContent = 'Placing order...';
    try {
      const { order } = await api('/api/orders', { ...f, items: Object.entries(cart).map(([id, qty]) => ({ id, qty })) });
      cart = {}; saveDiningCart(); renderMenu(); tracked = { ref: order.reference, email: order.email }; store.set(tracked); lastStatus = null;
      open(trackerHTML(order)); bindTracker(order);
      setDiningStep(2); onStatus(order); poll();
    } catch (err) { $('#omsg').textContent = err.message; $('#obtn').disabled = false; $('#obtn').textContent = 'Place order'; }
    finally { submitting = false; $('#close').disabled = false; }
  };
}
function trackerHTML(o) {
  const i = STEPS.indexOf(o.status), head = { READY: 'Your order is ready', DELIVERED: 'Enjoy your meal', CANCELLED: 'Order cancelled' }[o.status] || 'Order confirmed';
  const bar = o.status === 'CANCELLED' ? '<span class="status CANCELLED">Cancelled</span>' : `<div class="steps" role="group" aria-label="Order status" style="--p:${i}">${STEPS.map((s, k) => `<div aria-current="${k === i ? 'step' : 'false'}" class="step ${k <= i ? 'done' : ''} ${k === i ? 'now' : ''}"><i></i><small>${LABEL[s]}</small></div>`).join('')}</div>`;
  return `<div class="track ok"><h3 id="sheetTitle" aria-live="polite">${head}</h3>${journey(diningSteps, 2)}<p class="muted">${o.room ? `Delivering to room ${o.room}.` : 'Collect at the restaurant.'} ${i < 2 && i >= 0 ? "We'll alert you when it's ready." : ''}</p><div class="ref">${o.reference}</div>${bar}
  <div class="sum">${orderLines(o.lines)}<div class="tot"><span>Total</span><span>${money(o.pricing.total)}</span></div></div>
  <div class="actions">${o.status === 'RECEIVED' ? '<button class="btn ghost" id="ocancel">Cancel order</button>' : ''}<button class="btn" id="oclose">Close</button></div></div>`;
}
function bindTracker(o) {
  $('#oclose').onclick = close;
  const c = $('#ocancel'); if (c) c.onclick = async () => { if (!confirm('Cancel this order?')) return; try { onStatus((await api(`/api/orders/${o.reference}/cancel`, { email: o.email })).order); } catch (err) { alert(err.message); } };
}
function poll() {
  clearInterval(timer); if (!tracked) return;
  const tick = async () => {
    if (!tracked) return;
    const request = tracked;
    try {
      const { order } = await api(`/api/orders/${request.ref}?email=${encodeURIComponent(request.email)}`);
      if (tracked === request && (lastOrder?.reference !== order.reference || order.status === 'CANCELLED' ||
          STEPS.indexOf(order.status) >= STEPS.indexOf(lastOrder.status))) onStatus(order);
    }
    catch (err) { $('#menuStatus').textContent = `Order tracking is temporarily unavailable. ${err.message}`; }
  };
  tick(); timer = setInterval(tick, 4000);
}
function onStatus(o) {
  if (!lastOrder && modal.hidden && !Object.keys(cart).length) setDiningStep(2);
  diningProgress[2].firstElementChild.disabled = false;
  const pill = $('#pill'); pill.hidden = false; pill.dataset.s = o.status; pill.textContent = `Track order: ${LABEL[o.status]}`;
  if (o.status === lastStatus) return;
  lastStatus = o.status; lastOrder = o;
  if (!modal.hidden && body.querySelector('.track')) {
    const focusedId = body.contains(document.activeElement) && document.activeElement.id;
    body.innerHTML = trackerHTML(o);
    bindTracker(o);
    if (focusedId) (document.getElementById(focusedId) || $('#oclose')).focus();
  }
  if (o.status === 'READY') alertReady(o);
  if (o.status === 'DELIVERED' || o.status === 'CANCELLED') { clearInterval(timer); tracked = null; }
}
if ($('#pill')) $('#pill').onclick = openOrderTracker;
function alertReady(o) {
  const msg = `Your order ${o.reference} is ready${o.room ? ` and on its way to room ${o.room}.` : '. Please collect it at the restaurant.'}`;
  chime(); toast(msg); if ('Notification' in window && Notification.permission === 'granted') new Notification('Your order is ready', { body: msg });
}
function chime() { try { const c = new (window.AudioContext || window.webkitAudioContext)();[880, 1175].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * .18; o.frequency.value = f; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.2, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + .6); o.start(t); o.stop(t + .65); }); } catch { } }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'alert'); t.textContent = msg; document.body.append(t); setTimeout(() => t.classList.add('out'), 9000); setTimeout(() => t.remove(), 9700); }
if ($('#menu')) {
api('/api/menu').then(r => {
  menu = r.menu;
  menuTaxRate = r.taxRate;
  const availableItems = new Set(menu.map(item => item.id));
  cart = Object.fromEntries(Object.entries(cart).filter(([id]) => availableItems.has(id)));
  saveDiningCart();
  renderMenu(true);
}).catch(err => {
  $('#menuStatus').textContent = `The menu could not be loaded. ${err.message}`;
});
const saved = store.get(); if (saved) { tracked = saved; poll(); }
}
