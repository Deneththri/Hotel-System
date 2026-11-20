const $ = s => document.querySelector(s), H = () => ({ 'Content-Type': 'application/json', 'x-requested-with': 'olu' }), e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), money = displayPreferences.price;
const bookingNext = { CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'], CHECKED_IN: ['CHECKED_OUT'], CHECKED_OUT: [], CANCELLED: [], NO_SHOW: [] };
const orderNext = { RECEIVED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY'], READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [] };
let lastOrders = '', refreshTimer, expiryTimer, user, resetTarget;
let bookingsData = [], ordersData = [];
const roleNames = { manager: 'Manager', frontdesk: 'Front desk', kitchen: 'Kitchen' };
const message = value => { $('#m').textContent = value; };
const formValues = form => Object.fromEntries(new FormData(form));
const localToday = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const searchTerm = () => $('#dashboardFilter').value.trim().toLowerCase();
function renderBookings() {
    const term = searchTerm();
    const bookings = bookingsData.filter(b => [b.reference, b.guest, b.email, b.roomName, b.room, b.status].some(value => String(value).toLowerCase().includes(term)));
    $('#bookingCount').textContent = bookings.length;
    $('#bookingRows').innerHTML = bookings.length ? bookings.map(b => {
        const options = [b.status, ...(bookingNext[b.status] || [])];
        return `<tr><td><span class="table-ref">${e(b.reference)}</span></td><td><strong>${e(b.guest)}</strong><small class="table-sub">${e(b.email)}</small></td><td>${e(b.roomName)}<small class="table-sub">Room ${e(b.room)}</small></td><td>${e(b.checkIn)}<small class="table-sub">to ${e(b.checkOut)}</small></td><td>${money(b.pricing.total)}</td><td><select data-r="${e(b.reference)}" data-current="${e(b.status)}" aria-label="Update booking ${e(b.reference)}">${options.map(s => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></td></tr>`;
    }).join('') : `<tr><td colspan="6" class="empty">${term ? 'No bookings match your search.' : 'No bookings yet.'}</td></tr>`;
}
function renderOrders() {
    const term = searchTerm();
    const orders = ordersData.filter(o => [o.reference, o.guest, o.room, o.status, o.note, ...o.lines.map(line => line.name)].some(value => String(value || '').toLowerCase().includes(term)));
    $('#orderCount').textContent = orders.length;
    $('#ob').innerHTML = orders.length ? orders.map(o => {
        const options = [o.status, ...(orderNext[o.status] || [])];
        return `<tr><td><span class="table-ref">${e(o.reference)}</span></td><td><strong>${e(o.guest)}</strong><small class="table-sub">${o.room ? 'Room ' + e(o.room) : 'Restaurant pickup'}</small></td><td>${o.lines.map(l => `${e(l.qty)} × ${e(l.name)}`).join('<br>')}${o.note ? `<small class="table-sub">Note: ${e(o.note)}</small>` : ''}</td><td>${money(o.pricing.total)}</td><td><select data-o="${e(o.reference)}" data-current="${e(o.status)}" aria-label="Update order ${e(o.reference)}">${options.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`;
    }).join('') : `<tr><td colspan="5" class="empty">${term ? 'No kitchen orders match your search.' : 'No orders yet.'}</td></tr>`;
}
function renderMetrics() {
    const today = localToday();
    $('#metricBookings').textContent = bookingsData.length;
    $('#metricArrivals').textContent = bookingsData.filter(b => b.checkIn === today && b.status === 'CONFIRMED').length;
    $('#metricInHouse').textContent = bookingsData.filter(b => b.status === 'CHECKED_IN').length;
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
    if (activeUser !== user) return;
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

function showGate() {
    clearInterval(refreshTimer);
    clearTimeout(expiryTimer);
    user = undefined;
    bookingsData = [];
    ordersData = [];
    lastOrders = '';
    for (const id of ['bookingRows', 'ob', 'staffTable', 'staffIdentity']) $('#' + id).textContent = '';
    for (const id of ['logout', 'changePassword', 'passwordForm', 'dashboard']) $('#' + id).hidden = true;
    $('#passwordForm').reset();
    $('#staffForm').reset();
    $('#dashboardFilter').value = '';
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
    $('#metrics').hidden = $('#bookingsPanel').hidden = user.role === 'kitchen';
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
$('#dashboardFilter').oninput = () => { renderBookings(); renderOrders(); };
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
$('#bookingRows').onchange = async event => {
    const select = event.target, previous = select.dataset.current;
    try {
        await api(`/api/admin/bookings/${encodeURIComponent(select.dataset.r)}/status`, { status: select.value });
        select.dataset.current = select.value; await loadBookings(); renderMetrics();
    } catch (error) { $('#m').textContent = error.message; select.value = previous || 'CONFIRMED'; }
};
$('#ob').onchange = async event => {
    const select = event.target;
    const previous = select.dataset.current;
    try { await api(`/api/admin/orders/${encodeURIComponent(select.dataset.o)}/status`, { status: select.value }); select.dataset.current = select.value; lastOrders = ''; await loadOrders(); renderMetrics(); }
    catch (error) { $('#m').textContent = error.message; select.value = previous; }
};
async function boot() {
    try {
        await showDashboard(await api('/api/staff/me'));
    } catch (error) {
        if (!user) showGate();
        if (error.status !== 401) message(error.message);
    }
}
boot();
