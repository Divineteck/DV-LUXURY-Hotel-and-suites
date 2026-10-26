/* DV-LUXURY staff dashboard.
   Sections 1-3 (Supabase client, time limits, sign-in, staff check, logout) keep the logic of the previous admin.html.
   Everything the dashboard shows comes from the existing `bookings` and `staff_users` tables through the existing client.
   Hiding a menu item below is only a convenience: what a person may actually read or change is decided by the database rules. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const say = (s, t) => { $(s).textContent = t; };

  /* ================= 1. Supabase client (same checks as before) ================= */
  let db = null;
  const url = window.DV_SUPABASE_URL, key = window.DV_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes('PASTE_') || key.includes('PASTE_')) { $('#configWarning').classList.remove('hidden'); $('#configWarning').textContent = 'Setup needed: add your Supabase Project URL and Publishable key in config.js.'; }
  else if (window.supabase) { db = window.supabase.createClient(url, key); }
  else { $('#configWarning').classList.remove('hidden'); $('#configWarning').textContent = 'Supabase library did not load. Check internet and reload.'; }

  /* ================= 2. Time limits and error wording (same as before) ================= */
  const TIMEOUT = 12000;
  const withTimeout = (p, ms = TIMEOUT) => { let t; return Promise.race([Promise.resolve(p), new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms); })]).finally(() => clearTimeout(t)); };
  const isNet = e => !!e && (e.name === 'TimeoutError' || e.name === 'AuthRetryableFetchError' || e.name === 'TypeError' || e.status === 0 || /failed to fetch|network|load failed/i.test(String(e.message || '')));
  const problem = (e, what) => e && e.name === 'TimeoutError' ? what + ': the server took too long to respond. Check your connection and try again.' : isNet(e) ? what + ': could not reach the server. Check your connection and try again.' : what + ': ' + ((e && e.message) || 'unknown error');

  /* ================= 3. Small helpers ================= */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) { if (c == null || c === false) continue; n.append(c && c.nodeType ? c : document.createTextNode(String(c))); }
    return n;
  }
  const lagosToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const isoDay = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '';
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDate = v => { const i = isoDay(v); if (!i) return v ? String(v) : '—'; return new Date(i + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const fmtStamp = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const fmtShort = v => { const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' }); };
  const nightsOf = b => { const a = isoDay(b.check_in), z = isoDay(b.check_out); if (!a || !z) return 0; const n = Math.round((new Date(z + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); return n > 0 ? n : 0; };
  const nightsText = b => { const n = nightsOf(b); return n ? n + (n === 1 ? ' night' : ' nights') : ''; };
  const ref = b => String(b.id || '').slice(0, 8).toUpperCase();
  const cls = v => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
  const badge = v => h('span', { class: 'badge b-' + cls(v) }, v || '—');
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();

  function toast(message, kind) {
    const box = $('#toasts');
    const t = h('div', { class: 'toast ' + (kind === 'err' ? 'err' : 'ok') }, message);
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
  }
  function showBanner(msg, kind, retry) {
    const el = $('#dataBanner'); el.className = 'banner banner-' + kind; el.replaceChildren(h('span', null, msg));
    if (retry) el.append(h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: retry }, 'Try again'));
    el.hidden = false;
  }
  const hideBanner = () => { $('#dataBanner').hidden = true; };

  /* ================= 4. State and rules ================= */
  const COLS = 'id,guest_name,guest_email,guest_phone,room_type,check_in,check_out,guests,special_request,status,payment_status,payment_reference,created_at,user_id';
  const LIMIT = 1000;   // most recent bookings loaded into the dashboard
  // Which status changes the buttons offer (same four statuses as before). This only guides the interface; the database rules decide what is really allowed.
  const TRANSITIONS = { pending: ['confirmed', 'declined', 'cancelled'], confirmed: ['cancelled'], declined: ['pending'], cancelled: [] };
  const ACTION_LABEL = { confirmed: 'Confirm booking', declined: 'Decline booking', cancelled: 'Cancel booking', pending: 'Reopen as pending' };
  const ACTION_CONFIRM = {
    confirmed: 'The guest’s reservation request will be marked as confirmed.',
    declined: 'The request will be marked as declined.',
    cancelled: 'The booking will be marked as cancelled. This cannot be undone from this page.',
    pending: 'The booking will go back to pending so it can be reviewed again.'
  };
  const DANGER = { declined: true, cancelled: true };
  const VIEWS = {
    overview: ['Dashboard', 'Overview'], reservations: ['Bookings', 'Reservations'], guests: ['Guest directory', 'Guests'],
    analytics: ['Insights', 'Analytics'], staff: ['Administration', 'Staff management']
  };
  const DEFAULT_FILTERS = { q: '', status: '', payment: '', from: '', to: '', sort: 'newest' };
  const PAGE_SIZE = 20;

  const state = {
    user: null, role: null, bookings: [], loading: false, loaded: false, loadError: '', truncated: false,
    view: 'overview', page: 1, filters: { ...DEFAULT_FILTERS }, guestQ: '', busy: false, detailId: null,
    staff: { status: 'idle', rows: [], msg: '' }
  };
  const isAdmin = () => state.role === 'admin';
  let seq = 0;

  function resetData() {
    seq++;
    Object.assign(state, { user: null, role: null, bookings: [], loading: false, loaded: false, loadError: '', truncated: false, view: 'overview', page: 1, filters: { ...DEFAULT_FILTERS }, guestQ: '', busy: false, detailId: null, staff: { status: 'idle', rows: [], msg: '' } });
    closeNav(); closeDetail(true); closeConfirm(false);
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== 'overview'; });
    syncFilterInputs(); hideBanner();
    ['#overviewBody', '#guestsBody', '#analyticsBody', '#staffBody', '#bookingRows', '#bookingCards'].forEach(s => $(s).replaceChildren());
  }

  /* ================= 5. Sign in, staff check, dashboard (logic unchanged) ================= */
  let locked = false;
  function busy(on) { locked = on; const b = $('#staffLogin button[type="submit"]'); if (b) { b.disabled = on; b.setAttribute('aria-busy', String(on)); } }
  function showLogin(msg) { resetData(); $('#dashboard').classList.add('hidden'); $('#loginPanel').classList.remove('hidden'); say('#loginMessage', msg || ''); }
  async function checkStaff(user) {
    try {
      const { data, error } = await withTimeout(db.from('staff_users').select('role').eq('user_id', user.id).maybeSingle());
      if (error) return { status: 'error', message: 'Could not check staff permissions: ' + error.message + (error.code ? ' (' + error.code + ')' : '') };
      return data ? { status: 'staff', role: data.role } : { status: 'denied' };
    } catch (e) { return { status: 'error', message: problem(e, 'Could not check staff permissions') }; }
  }
  /* Never throws: always ends on the dashboard or a visible message on the login panel. */
  async function openDashboard(fromLogin) {
    try {
      let user = null;
      try { const r = await withTimeout(db.auth.getUser()); user = r.data && r.data.user; if (!user && r.error && isNet(r.error)) throw r.error; }
      catch (e) { showLogin(problem(e, 'Could not verify your sign-in')); return; }
      if (!user) { showLogin(fromLogin ? 'Sign-in did not complete. Please try again.' : ''); return; }
      const s = await checkStaff(user);
      if (s.status === 'error') { showLogin(s.message); return; }
      if (s.status === 'denied') {
        if (fromLogin) { try { await withTimeout(db.auth.signOut()); } catch (_) { try { await db.auth.signOut({ scope: 'local' }); } catch (__) { /* ignore */ } } }
        showLogin('This account is not authorised as staff. Ask the project administrator to add it to staff_users.'); return;
      }
      const sameUser = state.user && state.user.id === user.id;
      if (!sameUser) { resetData(); }
      state.user = user; state.role = String(s.role || '').toLowerCase();
      $('#loginPanel').classList.add('hidden'); $('#dashboard').classList.remove('hidden');
      say('#staffInfo', 'Signed in as ' + user.email + ' · Role: ' + s.role);
      $('#sideWho').replaceChildren(h('strong', null, user.email || ''), 'Role: ' + s.role);
      applyRole();
      setView(state.view, true);
      await fetchBookings();
    } catch (e) { showLogin(problem(e, 'Something went wrong')); }
  }
  $('#staffLogin').addEventListener('submit', async e => {
    e.preventDefault(); if (!db || locked) return;
    const f = new FormData(e.currentTarget); busy(true); say('#loginMessage', 'Signing in…');
    try {
      const { error } = await withTimeout(db.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: f.get('password') }));
      if (error) { say('#loginMessage', isNet(error) ? problem(error, 'Sign-in failed') : error.message); return; }
      await openDashboard(true);
    } catch (err) { say('#loginMessage', problem(err, 'Sign-in failed')); }
    finally { busy(false); }
  });
  $('#refreshBtn').addEventListener('click', () => { if (db) { closeNav(); openDashboard(false); } });
  $('#logoutBtn').addEventListener('click', async () => {
    if (db) { try { await withTimeout(db.auth.signOut()); } catch (_) { try { await db.auth.signOut({ scope: 'local' }); } catch (__) { /* ignore */ } } }
    showLogin('You have signed out.');
  });
  /* Page load: a signed-in guest is NOT signed out here; they simply see the staff login. */
  if (db) withTimeout(db.auth.getSession()).then(({ data }) => { if (data && data.session) return openDashboard(false); }).catch(e => showLogin(problem(e, 'Could not check your session')));

  /* Interface differences by role. This only shows or hides menu items; it is NOT security. */
  function applyRole() {
    $$('[data-admin-only]').forEach(el => { el.hidden = !isAdmin(); });
    if (!isAdmin() && ['guests', 'analytics', 'staff'].includes(state.view)) state.view = 'overview';
  }

  /* ================= 6. Loading bookings ================= */
  async function fetchBookings() {
    const my = ++seq;
    state.loading = true; state.loadError = ''; say('#tableMessage', 'Loading bookings…'); render();
    let res;
    try { res = await withTimeout(db.from('bookings').select(COLS).order('created_at', { ascending: false }).range(0, LIMIT - 1)); }
    catch (e) { res = { error: e }; }
    if (my !== seq) return;
    state.loading = false;
    if (res.error) {
      state.loadError = problem(res.error, 'Unable to load bookings'); state.loaded = false; state.bookings = [];
      say('#tableMessage', ''); showBanner(state.loadError, 'error', () => fetchBookings()); render(); return;
    }
    state.bookings = res.data || []; state.loaded = true; state.truncated = state.bookings.length >= LIMIT;
    hideBanner();
    if (state.truncated) showBanner('Showing the ' + LIMIT.toLocaleString('en-GB') + ' most recent bookings. Older bookings are not included in these figures.', 'warn');
    say('#tableMessage', state.bookings.length ? 'Loaded ' + state.bookings.length + ' booking(s). Payment processing is not connected yet.' : 'No booking requests yet.');
    render();
  }

  /* ================= 7. Navigation ================= */
  function setView(v, keepScroll) {
    if (!VIEWS[v] || ((v === 'guests' || v === 'analytics' || v === 'staff') && !isAdmin())) v = 'overview';
    state.view = v;
    $$('.view').forEach(s => { s.hidden = s.dataset.view !== v; });
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    say('#viewEyebrow', VIEWS[v][0]); say('#viewTitle', VIEWS[v][1]); say('#topTitle', VIEWS[v][1]);
    closeNav();
    if (!keepScroll) window.scrollTo({ top: 0 });
    if (v === 'staff' && state.staff.status === 'idle') loadStaffPreview();
    render();
  }
  $$('.nav-item').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  function openNav() { document.body.classList.add('nav-open'); $('#navOverlay').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); }
  function closeNav() { document.body.classList.remove('nav-open'); $('#navOverlay').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
  $('#menuBtn').addEventListener('click', () => document.body.classList.contains('nav-open') ? closeNav() : openNav());
  $('#navOverlay').addEventListener('click', closeNav);

  function goReservations(patch) {
    state.filters = { ...DEFAULT_FILTERS, ...patch }; state.page = 1; syncFilterInputs(); setView('reservations');
  }

  /* ================= 8. Rendering ================= */
  function render() {
    const pend = state.bookings.filter(b => b.status === 'pending').length;
    const nb = $('#navPending'); nb.hidden = !(state.loaded && pend > 0); nb.textContent = String(pend);
    if (state.view === 'overview') renderOverview();
    else if (state.view === 'reservations') renderReservations();
    else if (state.view === 'guests') renderGuests();
    else if (state.view === 'analytics') renderAnalytics();
    else if (state.view === 'staff') renderStaff();
  }
  const loadingPanel = () => h('div', { class: 'empty-state' }, h('strong', null, 'Loading…'), 'Fetching the latest bookings.');
  const errorPanel = () => h('div', { class: 'empty-state' }, h('strong', null, 'Bookings could not be loaded'), state.loadError || 'Please try again.');

  /* ---- Overview ---- */
  function renderOverview() {
    const root = $('#overviewBody');
    if (state.loading && !state.loaded) { root.replaceChildren(loadingPanel()); return; }
    if (!state.loaded) { root.replaceChildren(errorPanel()); return; }
    const B = state.bookings, t = lagosToday(), in7 = addDays(t, 7);
    const count = s => B.filter(b => b.status === s).length;
    const conf = B.filter(b => b.status === 'confirmed');
    const arrivals = conf.filter(b => b.check_in === t), departures = conf.filter(b => b.check_out === t);
    const upIn = conf.filter(b => b.check_in > t && b.check_in <= in7), upOut = conf.filter(b => b.check_out > t && b.check_out <= in7);
    const pending = B.filter(b => b.status === 'pending').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const stat = (label, value, note, opts = {}) => {
      const inner = [h('small', null, label), h('b', null, value), h('span', null, note)];
      return opts.go ? h('button', { class: 'stat' + (opts.accent ? ' accent' : ''), type: 'button', onclick: opts.go }, inner) : h('div', { class: 'stat' + (opts.accent ? ' accent' : '') }, inner);
    };
    const item = b => h('li', { class: 'list-item' },
      h('div', { class: 'l-main' }, h('strong', null, b.guest_name), h('small', null, b.room_type + ' · ' + fmtDate(b.check_in) + ' → ' + fmtDate(b.check_out))),
      h('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': 'View booking ' + ref(b), onclick: () => openDetail(b.id) }, 'View'));
    const list = (rows, empty) => rows.length ? h('ul', { class: 'list' }, rows.slice(0, 5).map(item)) : h('div', { class: 'empty-note' }, empty);
    const payCounts = ['unpaid', 'pending', 'paid', 'failed', 'refunded'].map(p => [p, B.filter(b => b.payment_status === p).length]);

    root.replaceChildren(
      h('div', { class: 'stat-grid' },
        stat('Total bookings', B.length, 'All requests loaded', { go: () => goReservations({}) }),
        stat('Pending', count('pending'), 'Waiting for a decision', { accent: count('pending') > 0, go: () => goReservations({ status: 'pending' }) }),
        stat('Confirmed', count('confirmed'), 'Reservations confirmed', { go: () => goReservations({ status: 'confirmed' }) }),
        stat('Declined / cancelled', count('declined') + count('cancelled'), 'Not going ahead', { go: () => goReservations({ status: 'declined' }) })),
      h('div', { class: 'stat-grid' },
        stat('Arrivals today', arrivals.length, 'Confirmed, check-in today', { go: () => goReservations({ status: 'confirmed', from: t, to: t }) }),
        stat('Departures today', departures.length, 'Confirmed, check-out today'),
        stat('Check-ins, next 7 days', upIn.length, 'Confirmed, after today', { go: () => goReservations({ status: 'confirmed', from: addDays(t, 1), to: in7 }) }),
        stat('Check-outs, next 7 days', upOut.length, 'Confirmed, after today')),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' }, h('h2', null, 'Needs attention'), h('p', { class: 'sub' }, 'Pending requests, longest waiting first' + (pending.length > 5 ? ' (showing 5 of ' + pending.length + ')' : '')), list(pending, 'No pending requests. You are all caught up.')),
        h('section', { class: 'panel' }, h('h2', null, 'Arriving today'), h('p', { class: 'sub' }, fmtDate(t) + ' · confirmed bookings'), list(arrivals, 'No confirmed arrivals today.'),
          h('h2', { style: 'margin-top:18px' }, 'Departing today'), h('p', { class: 'sub' }, 'Confirmed bookings checking out'), list(departures, 'No confirmed departures today.'))),
      h('section', { class: 'panel' }, h('h2', null, 'Payment status'),
        h('p', { class: 'sub' }, 'How many bookings are in each payment state. Revenue is not shown: no amounts are recorded and online payment is not connected yet.'),
        h('div', { class: 'chips' }, payCounts.map(([p, n]) => h('span', { class: 'chip-stat' }, badge(p), h('b', null, n))))));
  }

  /* ---- Reservations ---- */
  function filtered() {
    const f = state.filters, q = f.q.trim().toLowerCase();
    const list = state.bookings.filter(b => {
      if (f.status && b.status !== f.status) return false;
      if (f.payment && b.payment_status !== f.payment) return false;
      if (f.from && String(b.check_in) < f.from) return false;
      if (f.to && String(b.check_in) > f.to) return false;
      if (q && ![b.guest_name, b.guest_email, b.guest_phone, ref(b), b.id].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    const by = { newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), oldest: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
      checkin_asc: (a, b) => String(a.check_in).localeCompare(String(b.check_in)), checkin_desc: (a, b) => String(b.check_in).localeCompare(String(a.check_in)),
      name: (a, b) => String(a.guest_name).localeCompare(String(b.guest_name), 'en', { sensitivity: 'base' }) };
    return list.sort(by[f.sort] || by.newest);
  }
  function renderReservations() {
    const rows = $('#bookingRows'), cards = $('#bookingCards'), empty = $('#resEmpty'), pager = $('#pager');
    const clear = () => { rows.replaceChildren(); cards.replaceChildren(); pager.hidden = true; };
    if (state.loading && !state.loaded) { clear(); empty.hidden = false; empty.replaceChildren(h('strong', null, 'Loading…'), 'Fetching the latest bookings.'); say('#resultCount', ''); return; }
    if (!state.loaded) { clear(); empty.hidden = false; empty.replaceChildren(h('strong', null, 'Bookings could not be loaded'), state.loadError || 'Please try again.'); say('#resultCount', ''); return; }
    const list = filtered(), total = list.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * PAGE_SIZE, slice = list.slice(start, start + PAGE_SIZE);
    say('#resultCount', total === state.bookings.length ? total + ' booking' + (total === 1 ? '' : 's') : total + ' of ' + state.bookings.length + ' bookings match your filters');
    if (!total) {
      clear(); empty.hidden = false;
      empty.replaceChildren(h('strong', null, state.bookings.length ? 'No bookings match' : 'No booking requests yet'),
        state.bookings.length ? 'Try a different search or clear the filters.' : 'New requests from guests will appear here.');
      return;
    }
    empty.hidden = true;
    rows.replaceChildren(...slice.map(b => h('tr', null,
      h('td', null, h('span', { class: 'ref' }, ref(b))),
      h('td', { class: 'cell-guest' }, h('strong', null, b.guest_name), h('small', null, b.guest_email)),
      h('td', null, b.room_type),
      h('td', { class: 'nowrap' }, fmtDate(b.check_in) + ' → ' + fmtDate(b.check_out), h('small', { class: 'sub-line' }, nightsText(b))),
      h('td', null, b.guests),
      h('td', null, badge(b.status)), h('td', null, badge(b.payment_status)),
      h('td', { class: 'nowrap' }, fmtShort(b.created_at)),
      h('td', null, h('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': 'View booking ' + ref(b), onclick: () => openDetail(b.id) }, 'View')))));
    cards.replaceChildren(...slice.map(b => h('article', { class: 'res-card' },
      h('header', null, h('div', null, h('strong', null, b.guest_name), h('span', { class: 'sub-line' }, 'Ref ' + ref(b))), badge(b.status)),
      h('dl', null,
        h('dt', null, 'Room'), h('dd', null, b.room_type),
        h('dt', null, 'Stay'), h('dd', null, fmtDate(b.check_in) + ' → ' + fmtDate(b.check_out) + (nightsText(b) ? ' · ' + nightsText(b) : '')),
        h('dt', null, 'Guests'), h('dd', null, b.guests),
        h('dt', null, 'Payment'), h('dd', null, badge(b.payment_status))),
      h('button', { class: 'btn btn-ghost btn-block', type: 'button', 'aria-label': 'View booking ' + ref(b), onclick: () => openDetail(b.id) }, 'View details'))));
    pager.hidden = pages <= 1;
    $('#pageInfo').textContent = (start + 1) + '–' + Math.min(start + PAGE_SIZE, total) + ' of ' + total;
    $('#prevPage').disabled = state.page <= 1; $('#nextPage').disabled = state.page >= pages;
  }
  function syncFilterInputs() {
    const f = state.filters;
    $('#searchInput').value = f.q; $('#statusFilter').value = f.status; $('#paymentFilter').value = f.payment;
    $('#fromDate').value = f.from; $('#toDate').value = f.to; $('#sortSelect').value = f.sort;
  }
  let searchTimer;
  $('#searchInput').addEventListener('input', e => { clearTimeout(searchTimer); const v = e.target.value; searchTimer = setTimeout(() => { state.filters.q = v; state.page = 1; renderReservations(); }, 150); });
  [['#statusFilter', 'status'], ['#paymentFilter', 'payment'], ['#fromDate', 'from'], ['#toDate', 'to'], ['#sortSelect', 'sort']].forEach(([sel, k]) => $(sel).addEventListener('change', e => { state.filters[k] = e.target.value; state.page = 1; renderReservations(); }));
  $('#clearFilters').addEventListener('click', () => { state.filters = { ...DEFAULT_FILTERS }; state.page = 1; syncFilterInputs(); renderReservations(); });
  $('#prevPage').addEventListener('click', () => { state.page--; renderReservations(); window.scrollTo({ top: 0 }); });
  $('#nextPage').addEventListener('click', () => { state.page++; renderReservations(); window.scrollTo({ top: 0 }); });

  /* ---- Guests (built from booking details only) ---- */
  function renderGuests() {
    const root = $('#guestsBody');
    if (state.loading && !state.loaded) { root.replaceChildren(loadingPanel()); return; }
    if (!state.loaded) { root.replaceChildren(errorPanel()); return; }
    const map = new Map();
    state.bookings.forEach(b => { const k = b.user_id || 'email:' + String(b.guest_email || '').toLowerCase(); let g = map.get(k); if (!g) { g = { name: b.guest_name, email: b.guest_email, phone: b.guest_phone, account: !!b.user_id, list: [] }; map.set(k, g); } g.list.push(b); });
    let guests = Array.from(map.values());
    const q = state.guestQ.trim().toLowerCase();
    if (q) guests = guests.filter(g => [g.name, g.email, g.phone].join(' ').toLowerCase().includes(q));
    if (!guests.length) { root.replaceChildren(h('div', { class: 'empty-state' }, h('strong', null, state.bookings.length ? 'No guests match' : 'No guests yet'), state.bookings.length ? 'Try a different search.' : 'Guests appear here once they have made a booking request.')); return; }
    root.replaceChildren(h('div', { class: 'guest-grid' }, guests.map(g => {
      const confirmed = g.list.filter(b => b.status === 'confirmed').length;
      return h('article', { class: 'guest-card' },
        h('header', null, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial(g.name)), h('div', null, h('strong', null, g.name), h('small', null, g.email))),
        h('small', null, g.phone || 'No phone saved'),
        h('div', { class: 'chips' },
          h('span', { class: 'chip-stat' }, 'Bookings ', h('b', null, g.list.length)), h('span', { class: 'chip-stat' }, 'Confirmed ', h('b', null, confirmed)),
          g.account ? h('span', { class: 'chip-stat' }, 'Has account') : h('span', { class: 'chip-stat' }, 'No account linked')),
        h('small', null, 'Latest request: ' + fmtDate(g.list[0].created_at)),
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => goReservations({ q: g.email }) }, 'View bookings'));
    })));
  }
  $('#guestSearch').addEventListener('input', e => { state.guestQ = e.target.value; renderGuests(); });

  /* ---- Analytics (counts of booking requests; not revenue) ---- */
  function renderAnalytics() {
    const root = $('#analyticsBody');
    if (state.loading && !state.loaded) { root.replaceChildren(loadingPanel()); return; }
    if (!state.loaded) { root.replaceChildren(errorPanel()); return; }
    if (!state.bookings.length) { root.replaceChildren(h('div', { class: 'empty-state' }, h('strong', null, 'Nothing to chart yet'), 'Charts appear once booking requests come in.')); return; }
    const B = state.bookings;
    const monthKey = ts => { const d = new Date(ts); return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d).slice(0, 7); };
    const thisMonth = lagosToday().slice(0, 7); let [y, m] = thisMonth.split('-').map(Number);
    const months = []; for (let i = 0; i < 6; i++) { months.unshift(y + '-' + String(m).padStart(2, '0')); m--; if (m === 0) { m = 12; y--; } }
    const perMonth = months.map(k => [k, B.filter(b => monthKey(b.created_at) === k).length]);
    const maxM = Math.max(1, ...perMonth.map(x => x[1]));
    const monthLabel = k => new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    const tally = (arr, fn) => { const m2 = new Map(); arr.forEach(b => { const k = fn(b) || 'Unknown'; m2.set(k, (m2.get(k) || 0) + 1); }); return Array.from(m2.entries()).sort((a, b) => b[1] - a[1]); };
    const bars = (rows, badgeKind) => { const max = Math.max(1, ...rows.map(r => r[1])); return h('div', { class: 'bars' }, rows.map(([label, n]) => h('div', { class: 'bar-row' }, badgeKind ? h('span', null, badge(label)) : h('span', null, label), h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: 'width:' + Math.round(n / max * 100) + '%' })), h('b', null, n)))); };
    root.replaceChildren(
      h('div', { class: 'banner banner-info' }, 'These charts count booking requests. They are not revenue: no amounts are recorded and online payment is not connected yet.'),
      h('section', { class: 'panel' }, h('h2', null, 'Booking requests, last 6 months'), h('p', { class: 'sub' }, 'By the month the request was made'),
        h('div', { class: 'cols' }, perMonth.map(([k, n]) => h('div', { class: 'col' + (n ? '' : ' zero') }, h('b', null, n), h('i', { style: 'height:' + Math.max(3, Math.round(n / maxM * 120)) + 'px' }), monthLabel(k))))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' }, h('h2', null, 'Booking status'), h('p', { class: 'sub' }, 'All loaded bookings'), bars(tally(B, b => b.status), true)),
        h('section', { class: 'panel' }, h('h2', null, 'Payment status'), h('p', { class: 'sub' }, 'All loaded bookings'), bars(tally(B, b => b.payment_status), true))),
      h('section', { class: 'panel' }, h('h2', null, 'Popular room types'), h('p', { class: 'sub' }, 'Booking requests per room type'), bars(tally(B, b => b.room_type), false)));
  }

  /* ---- Staff management: read-only preview ---- */
  async function loadStaffPreview() {
    if (state.staff.status === 'loading') return;
    state.staff = { status: 'loading', rows: [], msg: '' }; renderStaff();
    let res;
    try { res = await withTimeout(db.from('staff_users').select('user_id,role,created_at').order('created_at', { ascending: true })); }
    catch (e) { res = { error: e }; }
    state.staff = res.error ? { status: 'error', rows: [], msg: problem(res.error, 'Could not load the staff list') } : { status: 'ok', rows: res.data || [], msg: '' };
    if (state.view === 'staff') renderStaff();
  }
  function renderStaff() {
    const root = $('#staffBody'), st = state.staff;
    let body;
    if (st.status === 'loading' || st.status === 'idle') body = h('div', { class: 'empty-note' }, 'Loading staff list…');
    else if (st.status === 'error') body = h('div', null, h('div', { class: 'banner banner-error' }, h('span', null, st.msg), h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: loadStaffPreview }, 'Try again')));
    else if (!st.rows.length) body = h('div', { class: 'empty-note' }, 'No staff records are visible to this account.');
    else body = h('div', { class: 'guest-grid' }, st.rows.map(r => {
      const me = state.user && r.user_id === state.user.id;
      return h('article', { class: 'guest-card' },
        h('header', null, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial(r.role)), h('div', null, h('strong', null, 'Staff ID ' + String(r.user_id).slice(0, 8) + (me ? ' (you)' : '')), h('small', null, 'Added ' + fmtDate(r.created_at)))),
        h('div', { class: 'chips' }, badge(r.role)),
        h('small', null, 'Email: not available yet · Account status: not tracked yet'));
    }));
    root.replaceChildren(
      h('span', { class: 'preview-tag' }, 'Preview · read only'),
      h('div', { class: 'banner banner-info' }, 'Nothing on this page can change anyone’s access. Adding, removing and changing staff will be added only after a secure server-side design is reviewed and approved.'),
      h('section', { class: 'panel' }, h('h2', null, 'Staff records'), h('p', { class: 'sub' }, 'Read from the existing staff_users table. You see only the rows your database permissions allow.'), body),
      h('section', { class: 'panel' }, h('h2', null, 'Not available yet, and why'),
        h('ul', { class: 'plain-list' },
          h('li', null, 'Staff emails: staff_users stores no email, and the browser cannot read Supabase’s protected user list.'),
          h('li', null, 'Active / inactive status: the table has no such column yet.'),
          h('li', null, 'Add, change role, remove: these need server-side checks, including no self-removal and keeping at least one admin.'),
          h('li', null, 'Activity log: there is no log table yet.'))));
  }

  /* ================= 9. Booking detail and status changes ================= */
  let lastFocus = null;
  function openModal(sel) { $(sel).hidden = false; document.body.classList.add('modal-open'); }
  function closeModal(sel) { $(sel).hidden = true; if ($$('.modal-backdrop').every(m => m.hidden)) document.body.classList.remove('modal-open'); }
  function openDetail(id) {
    const b = state.bookings.find(x => x.id === id); if (!b) return;
    state.detailId = id; lastFocus = document.activeElement; renderDetail(b); openModal('#detailModal'); $('#detailClose').focus();
  }
  function closeDetail(silent) { state.detailId = null; closeModal('#detailModal'); if (!silent && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) { /* ignore */ } } }
  $('#detailClose').addEventListener('click', () => closeDetail());
  $('#detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') closeDetail(); });

  function renderDetail(b, pendingStatus) {
    const next = TRANSITIONS[b.status] || [];
    const phone = String(b.guest_phone || '');
    const field = (label, content, wide) => h('div', { class: wide ? 'wide' : '' }, h('dt', null, label), h('dd', null, content));
    $('#detailBody').replaceChildren(
      h('p', { class: 'eyebrow' }, 'Reservation ' + ref(b)),
      h('h2', { id: 'detailTitle' }, b.guest_name),
      h('div', { class: 'detail-badges' }, badge(b.status), h('span', { class: 'sub-line' }, 'Payment:'), badge(b.payment_status)),
      h('dl', { class: 'detail-grid' },
        field('Email', h('a', { href: 'mailto:' + encodeURI(String(b.guest_email || '')) }, b.guest_email || '—')),
        field('Phone', phone ? h('a', { href: 'tel:' + phone.replace(/[^\d+]/g, '') }, phone) : '—'),
        field('Room', b.room_type), field('Guests', b.guests),
        field('Check-in', fmtDate(b.check_in)), field('Check-out', fmtDate(b.check_out)),
        field('Length of stay', nightsText(b) || '—'), field('Requested on', fmtStamp(b.created_at)),
        field('Guest account', b.user_id ? 'Linked to a guest account' : 'No account linked'),
        b.payment_reference ? field('Payment reference', b.payment_reference) : null,
        field('Special request', b.special_request ? b.special_request : 'None', true)),
      h('div', { class: 'detail-actions' },
        h('h3', null, 'Update status'),
        next.length
          ? h('div', { class: 'action-row' }, next.map(s => h('button', { class: 'btn ' + (DANGER[s] ? 'btn-ghost' : 'btn-primary'), type: 'button', disabled: state.busy ? true : null, 'aria-busy': pendingStatus === s ? 'true' : null, onclick: () => changeStatus(b, s) }, ACTION_LABEL[s])))
          : h('p', { class: 'sub-line' }, 'No further status changes are offered for a ' + (b.status || 'this') + ' booking.'),
        h('p', { class: 'sub-line', style: 'margin-top:10px' }, 'Payment status is read-only here. Payments are not connected yet.')));
  }

  let confirmResolve = null;
  function confirmDialog({ title, message, confirmText, danger }) {
    return new Promise(res => {
      confirmResolve = res; $('#confirmTitle').textContent = title; $('#confirmMessage').textContent = message;
      const ok = $('#confirmOk'); ok.textContent = confirmText; ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      openModal('#confirmModal'); ok.focus();
    });
  }
  function closeConfirm(value) { if (!confirmResolve) return; const r = confirmResolve; confirmResolve = null; closeModal('#confirmModal'); r(value); }
  $('#confirmOk').addEventListener('click', () => closeConfirm(true));
  $('#confirmCancel').addEventListener('click', () => closeConfirm(false));
  $('#confirmModal').addEventListener('click', e => { if (e.target.id === 'confirmModal') closeConfirm(false); });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('#confirmModal').hidden) closeConfirm(false); else if (!$('#detailModal').hidden) closeDetail(); else closeNav(); });

  async function changeStatus(b, next) {
    if (state.busy || !db) return;
    const ok = await confirmDialog({ title: ACTION_LABEL[next] + '?', message: b.guest_name + ' · ' + ref(b) + '. ' + ACTION_CONFIRM[next], confirmText: ACTION_LABEL[next], danger: !!DANGER[next] });
    if (!ok || state.busy) return;
    state.busy = true; renderDetail(b, next);
    const previous = b.status;
    try {
      // The row is only changed if it still has the status we showed; the database must report exactly one changed row.
      const { data, error } = await withTimeout(db.from('bookings').update({ status: next }).eq('id', b.id).eq('status', previous).select('id,status'));
      if (error) throw error;
      if (!data || data.length !== 1 || data[0].status !== next) throw Object.assign(new Error('No change was saved. The booking may have been updated by someone else, or your account may not be allowed to change it. Refresh and try again.'), { name: 'NotApplied' });
      b.status = data[0].status;
      toast('Booking ' + ref(b) + ' is now ' + next + '.', 'ok');
    } catch (e) {
      toast(problem(e, 'Could not update'), 'err');
    } finally {
      state.busy = false;
      if (state.detailId === b.id) renderDetail(b);
      render();
    }
  }

  /* Start with the sign-in panel's own state; the session check above decides whether to open the dashboard. */
  syncFilterInputs();
})();
