const $ = s => document.querySelector(s), H = () => ({ 'Content-Type': 'application/json', 'x-requested-with': 'olu' }), e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), money = displayPreferences.price;
const bookingNext = { CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'], CHECKED_IN: ['CHECKED_OUT'], CHECKED_OUT: [], CANCELLED: [], NO_SHOW: [] };
const orderNext = { RECEIVED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY'], READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [] };
let lastBookings = '', lastOrders = '', refreshTimer, expiryTimer, user, resetTarget;
let bookingsData = [], ordersData = [];
const roleNames = { manager: 'Manager', frontdesk: 'Front desk', kitchen: 'Kitchen' };
const message = value => { $('#m').textContent = value; };
const formValues = form => Object.fromEntries(new FormData(form));
const hotelCalendar = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
});
const localToday = () => hotelCalendar.format(new Date());
const searchTerm = () => $('#dashboardFilter').value.trim().toLowerCase();
const pendingUpdates = new Set();
const statusLabels = {
    CONFIRMED: 'Confirmed', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out',
    CANCELLED: 'Cancelled', NO_SHOW: 'No show', RECEIVED: 'Received', PREPARING: 'Preparing',
    READY: 'Ready', DELIVERED: 'Delivered'
};
const actionLabels = {
    CHECKED_IN: 'Check in', CHECKED_OUT: 'Check out', CANCELLED: 'Cancel',
    NO_SHOW: 'Mark no show', PREPARING: 'Start preparing', READY: 'Mark ready', DELIVERED: 'Mark delivered'
};
const matchesQueue = (status, transitions) => {
    const queue = $('#queueFilter').value;
    return queue === 'all' || (queue === 'active') === Boolean(transitions[status]?.length);
};
function queueActions(reference, status, transitions) {
    const [primary, ...alternatives] = transitions[status] || [];
    const disabled = pendingUpdates.has(reference) ? 'disabled' : '';
    const button = (next, style) => `<button class="btn ${style}" type="button" data-ref="${e(reference)}" data-next="${next}"
        aria-label="${actionLabels[next]} ${e(reference)}" ${disabled}>${actionLabels[next]}</button>`;
    return `<span class="status ${e(status)}">${statusLabels[status] || e(status)}</span>
        ${primary ? `<div class="queue-actions">${button(primary, '')}
        ${alternatives.length ? `<details><summary aria-label="More actions for ${e(reference)}">More</summary>
        <div>${alternatives.map(next => button(next, 'ghost')).join('')}</div></details>` : ''}</div>` : ''}`;
}
function renderBookings() {
    const term = searchTerm();
    const bookings = bookingsData.filter(b => matchesQueue(b.status, bookingNext) &&
        [b.reference, b.guest, b.email, b.roomName, b.room, statusLabels[b.status]].some(value => String(value).toLowerCase().includes(term)));
    $('#bookingCount').textContent = bookings.length;
    $('#bookingRows').innerHTML = bookings.length ? bookings.map(b =>
        `<tr><td><span class="table-ref">${e(b.reference)}</span></td><td><strong>${e(b.guest)}</strong><small class="table-sub">${e(b.email)}</small></td>
        <td>${e(b.roomName)}<small class="table-sub">Room ${e(b.room)}</small></td><td>${e(b.checkIn)}<small class="table-sub">to ${e(b.checkOut)}</small></td>
        <td>${money(b.pricing.total)}</td><td>${queueActions(b.reference, b.status, bookingNext)}</td></tr>`
    ).join('') : '<tr><td colspan="6" class="empty">No bookings to show.</td></tr>';
}
function renderOrders() {
    const term = searchTerm();
    const orders = ordersData.filter(o => matchesQueue(o.status, orderNext) &&
        [o.reference, o.guest, o.room, statusLabels[o.status], o.note, ...o.lines.map(line => line.name)]
            .some(value => String(value || '').toLowerCase().includes(term)));
    $('#orderCount').textContent = orders.length;
    $('#ob').innerHTML = orders.length ? orders.map(o =>
        `<tr><td><span class="table-ref">${e(o.reference)}</span></td><td><strong>${e(o.guest)}</strong>
        <small class="table-sub">${o.room ? 'Room ' + e(o.room) : 'Restaurant pickup'}</small></td>
        <td>${o.lines.map(l => `${e(l.qty)} &times; ${e(l.name)}`).join('<br>')}${o.note ? `<small class="table-sub">Note: ${e(o.note)}</small>` : ''}</td>
        <td>${money(o.pricing.total)}</td><td>${queueActions(o.reference, o.status, orderNext)}</td></tr>`
    ).join('') : '<tr><td colspan="5" class="empty">No kitchen orders to show.</td></tr>';
}
function renderMetrics() {
    const today = localToday();
    $('#metricBookings').textContent = bookingsData.length;
    $('#metricArrivals').textContent = bookingsData.filter(b => b.checkIn === today && b.status === 'CONFIRMED').length;
    $('#metricInHouse').textContent = bookingsData.filter(b => b.status === 'CHECKED_IN').length;
    $('#metricPreparing').textContent = ordersData.filter(order => order.status === 'PREPARING').length;
    $('#metricReady').textContent = ordersData.filter(order => order.status === 'READY').length;
    $('#metricOrders').textContent = ordersData.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status)).length;
}
async function api(url, body) {
    const activeUser = user;
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: H(), body: body ? JSON.stringify(body) : undefined }), j = await r.json();
    if (r.status === 401 && user && user === activeUser && url !== '/api/staff/login') showGate();
    if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed.'), { status: r.status });
    return j;
}
async function loadBookings() {
    const activeUser = user;
    const { bookings } = await api('/api/admin/bookings');
    const signature = JSON.stringify(bookings);
    if (activeUser !== user || signature === lastBookings) return;
    lastBookings = signature;
    bookingsData = bookings;
    renderBookings();
}
async function loadOrders() {
    const activeUser = user;
    const { orders } = await api('/api/admin/orders'), signature = JSON.stringify(orders);
    if (activeUser !== user) return;
    if (signature === lastOrders) return;
    lastOrders = signature;
    ordersData = orders;
    renderOrders();
}
async function refresh() {
    if (!user) return;
    try {
        const tasks = [loadOrders()];
        if (user.role !== 'kitchen') tasks.push(loadBookings());
        await Promise.all(tasks);
        if (user) renderMetrics();
    } catch (error) { message(error.message); }
}

function closeReset() {
    resetTarget = undefined;
    $('#resetForm').reset();
    $('#resetForm').hidden = true;
}

const welcomeTitle = $('.admin-welcome h1');
const loginTitle = welcomeTitle.textContent;
function showGate() {
    delete document.body.dataset.staffRole;
    welcomeTitle.textContent = loginTitle;
    clearInterval(refreshTimer);
    clearTimeout(expiryTimer);
    user = undefined;
    bookingsData = [];
    ordersData = [];
    lastBookings = lastOrders = '';
    for (const id of ['bookingRows', 'ob', 'staffTable', 'staffIdentity']) $('#' + id).textContent = '';
    for (const id of ['logout', 'changePassword', 'passwordForm', 'dashboard']) $('#' + id).hidden = true;
    $('#passwordForm').reset();
    $('#staffForm').reset();
    $('#dashboardFilter').value = '';
    $('#queueFilter').value = 'all';
    closeReset();
    $('#gate').hidden = false;
}

async function loadStaffTable() {
    const activeUser = user;
    const { staff } = await api('/api/admin/staff');
    if (activeUser !== user || user?.role !== 'manager') return;
    $('#staffTable').innerHTML = staff.map(account => `<tr>
        <td>${e(account.name)}</td><td>${e(account.username)}</td><td>${e(roleNames[account.role])}</td>
        <td>${account.active ? 'Active' : 'Inactive'}</td>
        <td><button type="button" class="btn ghost" data-reset="${e(account.username)}">Reset password</button>
        ${account.username === user.username ? '' : `<button type="button" class="btn ghost" data-account="${e(account.username)}" data-active="${!account.active}">${account.active ? 'Deactivate' : 'Reactivate'}</button>`}</td>
    </tr>`).join('');
}

async function showDashboard(session) {
    user = session.user;
    $('#staffIdentity').textContent = `${user.name} \u00b7 ${roleNames[user.role]}`;
    $('#gate').hidden = true;
    for (const id of ['logout', 'changePassword', 'dashboard']) $('#' + id).hidden = false;
    document.body.dataset.staffRole = user.role;
    welcomeTitle.textContent = `${roleNames[user.role]} dashboard`;
    $('#bookingsPanel').hidden = user.role === 'kitchen';
    for (const metric of document.querySelectorAll('.kitchen-metric')) metric.hidden = user.role === 'frontdesk';
    $('#sec-s').hidden = user.role !== 'manager';
    clearTimeout(expiryTimer);
    clearInterval(refreshTimer);
    expiryTimer = setTimeout(() => {
        showGate();
        message('Your session expired. Please sign in again.');
    }, Math.max(0, session.expiresAt - Date.now()));
    refreshTimer = setInterval(refresh, 15000);
    const tasks = [refresh()];
    if (user.role === 'manager') tasks.push(loadStaffTable());
    await Promise.all(tasks);
}

function onSubmit(selector, action) {
    $(selector).onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button');
        if (button.disabled) return;
        button.disabled = true;
        const values = formValues(form);
        try {
            message('');
            await action(values, form);
        } catch (error) { message(error.message); }
        finally { button.disabled = false; }
    };
}

onSubmit('#gf', async (values, form) => {
    form.elements.password.value = '';
    await showDashboard(await api('/api/staff/login', values));
});
function renderQueues() { renderBookings(); renderOrders(); }
$('#dashboardFilter').oninput = renderQueues;
$('#queueFilter').onchange = renderQueues;
$('#logout').onclick = async () => {
    try {
        await api('/api/staff/logout', {});
        showGate();
        message('You have signed out.');
    } catch (error) { message(error.message); }
};
$('#changePassword').onclick = () => {
    const form = $('#passwordForm');
    form.reset();
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.currentPassword.focus();
};
onSubmit('#passwordForm', async (values, form) => {
    await api('/api/staff/password', values);
    form.reset();
    form.hidden = true;
    message('Password changed.');
});
onSubmit('#staffForm', async (values, form) => {
    await api('/api/admin/staff', values);
    form.reset();
    await loadStaffTable();
    message('Staff account added.');
});
$('#staffTable').onclick = async event => {
    if (event.target.dataset.reset) {
        closeReset();
        resetTarget = event.target.dataset.reset;
        $('#resetTitle').textContent = `Reset password for ${resetTarget}`;
        $('#resetForm').hidden = false;
        $('#resetForm').elements.password.focus();
    }
    const { account, active } = event.target.dataset;
    if (!account) return;
    try {
        await api(`/api/admin/staff/${encodeURIComponent(account)}/active`, { active: active === 'true' });
        await loadStaffTable();
        message(active === 'true' ? 'Account reactivated.' : 'Account deactivated.');
    } catch (error) { message(error.message); }
};
$('#cancelReset').onclick = closeReset;
onSubmit('#resetForm', async values => {
    const target = resetTarget;
    await api(`/api/admin/staff/${encodeURIComponent(target)}/password`, values);
    closeReset();
    if (target === user?.username) showGate();
    message('Password reset.');
});
function bindQueue(selector, resource, load, render) {
    $(selector).onclick = async event => {
        const button = event.target.closest('button[data-next]');
        if (!button) return;
        const { ref, next } = button.dataset;
        if (pendingUpdates.has(ref)) return;
        if (next === 'CANCELLED' && !confirm(`Cancel ${ref}?`)) return;
        const activeUser = user;
        pendingUpdates.add(ref);
        for (const action of button.closest('td').querySelectorAll('button')) action.disabled = true;
        message('');
        try {
            await api(`/api/admin/${resource}/${encodeURIComponent(ref)}/status`, { status: next });
            if (user !== activeUser) return;
            await load();
            if (user === activeUser) {
                renderMetrics();
                message(`${ref} updated to ${statusLabels[next]}`);
            }
        } catch (error) {
            if (user === activeUser) message(error.message);
        } finally {
            pendingUpdates.delete(ref);
            if (user === activeUser) {
                render();
                const nextAction = [...$(selector).querySelectorAll('button[data-ref]')].find(action => action.dataset.ref === ref);
                (nextAction || $('#queueFilter')).focus({ preventScroll: true });
            }
        }
    };
}
bindQueue('#bookingRows', 'bookings', loadBookings, renderBookings);
bindQueue('#ob', 'orders', loadOrders, renderOrders);
async function boot() {
    try {
        await showDashboard(await api('/api/staff/me'));
    } catch (error) {
        if (!user) showGate();
        if (error.status !== 401) message(error.message);
    }
}
boot();
