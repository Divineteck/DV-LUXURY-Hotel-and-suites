(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const menuToggle = $('#menuToggle'), mainNav = $('#mainNav');
  menuToggle.addEventListener('click', () => { const open = mainNav.classList.toggle('open'); menuToggle.setAttribute('aria-expanded', String(open)); });
  $$('#mainNav a').forEach(a => a.addEventListener('click', () => { mainNav.classList.remove('open'); menuToggle.setAttribute('aria-expanded','false'); }));
  $('#year').textContent = new Date().getFullYear();
  const today = new Date(); today.setHours(0,0,0,0);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
  const afterTomorrow = new Date(today); afterTomorrow.setDate(afterTomorrow.getDate()+2);
  const checkin = $('#checkin'), checkout = $('#checkout');
  checkin.min = iso(today); checkin.value = iso(tomorrow); checkout.min = iso(tomorrow); checkout.value = iso(afterTomorrow);
  checkin.addEventListener('change', () => { const d = new Date(`${checkin.value}T00:00:00`); d.setDate(d.getDate()+1); checkout.min = iso(d); if (!checkout.value || checkout.value <= checkin.value) checkout.value = iso(d); });
  const toast = $('#toast'); let toastTimer;
  function showToast(message){ toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>toast.classList.remove('show'),3400); }
  $('#availabilityForm').addEventListener('submit', e => { e.preventDefault(); if(checkout.value <= checkin.value){ $('#availabilityMessage').textContent='Check-out date must be after check-in.'; return; } $('#availabilityMessage').textContent='Great! Choose a room below to continue your demo reservation.'; $('#rooms').scrollIntoView({behavior:'smooth'}); });
  $$('.filter').forEach(btn => btn.addEventListener('click', () => { $$('.filter').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); $$('.room-card').forEach(card => { card.hidden = btn.dataset.filter !== 'all' && card.dataset.category !== btn.dataset.filter; }); }));
  $$('.heart-btn').forEach(btn => btn.addEventListener('click', () => { btn.classList.toggle('saved'); btn.textContent = btn.classList.contains('saved') ? '♥' : '♡'; showToast(btn.classList.contains('saved')?'Room saved to your favourites.':'Room removed from favourites.'); }));
  const modal = $('#bookingModal'), modalCheckin = $('#modalCheckin'), modalCheckout = $('#modalCheckout'); let selectedPrice = 45000;
  function nights(){ if(!modalCheckin.value || !modalCheckout.value) return 0; return Math.max(0, Math.round((new Date(`${modalCheckout.value}T00:00:00`) - new Date(`${modalCheckin.value}T00:00:00`))/86400000)); }
  function formatNaira(n){return '₦'+n.toLocaleString('en-NG');}
  function updateTotal(){ $('#estimatedTotal').textContent = formatNaira(selectedPrice*nights()); }
  function openBooking(room, price){ selectedPrice = Number(price)||45000; $('#selectedRoom').value = room||'Classic Room'; modalCheckin.value = checkin.value; modalCheckout.value = checkout.value; modalCheckin.min = iso(today); modalCheckout.min = modalCheckin.value; updateTotal(); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
  function closeBooking(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.style.overflow='';}
  /* ===== Booking gate: auth check, draft keep/restore, safe submit ===== */
  const DRAFT_KEY = 'dv_pending_booking', DRAFT_TTL = 60 * 60 * 1000, CHECK_TIMEOUT = 8000, SAVE_TIMEOUT = 15000;
  const sbUrl = window.DV_SUPABASE_URL, sbKey = window.DV_SUPABASE_PUBLISHABLE_KEY;
  const sbReady = !!(sbUrl && sbKey && !String(sbUrl).includes('PASTE_') && !String(sbKey).includes('PASTE_') && window.supabase);
  const db = sbReady ? window.supabase.createClient(sbUrl, sbKey) : null; // one shared client for the whole page
  const gate = { busy: false };
  const roomCatalog = () => $$('.room-book').map(b => ({ room: b.dataset.room, price: Number(b.dataset.price) || 0 }));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms))]);
  const isNetworkErr = e => !!e && (e.name === 'TimeoutError' || e.name === 'AuthRetryableFetchError' || e.name === 'TypeError' || e.status === 0 || /failed to fetch|network|load failed/i.test(String(e.message || '')));
  const safeStore = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }, del: k => { try { localStorage.removeItem(k); } catch (_) {} } };
  const guestsToText = n => n + (n === 1 ? ' guest' : ' guests');

  // Returns {status:'authed',user} | {status:'anon'} | {status:'error',message}. "No session" is never an error.
  async function checkSession(verify) {
    if (!db) return { status: 'error', message: 'Booking isn’t available right now (Supabase is not set up or did not load). Please try again shortly.' };
    try {
      if (verify) {
        const { data, error } = await withTimeout(db.auth.getUser(), CHECK_TIMEOUT);
        if (data && data.user) return { status: 'authed', user: data.user };
        if (error && isNetworkErr(error)) throw error;
        return { status: 'anon' };
      }
      const { data, error } = await withTimeout(db.auth.getSession(), CHECK_TIMEOUT);
      if (error) throw error;
      return data && data.session ? { status: 'authed', user: data.session.user } : { status: 'anon' };
    } catch (e) {
      return { status: 'error', message: e && e.name === 'TimeoutError' ? 'Checking your sign-in is taking too long. Please check your connection and try again.' : isNetworkErr(e) ? 'We couldn’t reach the server to check your sign-in. Please check your connection and try again.' : 'We couldn’t verify your sign-in just now. Please try again.' };
    }
  }

  // Draft: selection only (no prices / payment fields). Validated again on restore.
  function saveDraft(d) { safeStore.set(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), room: d.room, checkin: d.checkin, checkout: d.checkout, guests: d.guests, guestName: d.guestName || '', phone: d.phone || '', email: d.email || '' })); }
  function loadDraft() {
    const raw = safeStore.get(DRAFT_KEY); if (!raw) return null;
    try {
      const d = JSON.parse(raw); if (!d || typeof d !== 'object' || Date.now() - Number(d.savedAt) > DRAFT_TTL) return null;
      const match = roomCatalog().find(r => r.room === d.room); if (!match) return null;
      const dateOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      let ci = dateOk(d.checkin) ? d.checkin : iso(tomorrow), co = dateOk(d.checkout) ? d.checkout : iso(afterTomorrow);
      if (ci < iso(today)) ci = iso(tomorrow);
      if (co <= ci) { const n = new Date(`${ci}T00:00:00`); n.setDate(n.getDate() + 1); co = iso(n); }
      const g = parseInt(d.guests, 10);
      const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
      const email = str(d.email, 254), phone = str(d.phone, 30);
      return { room: match.room, price: match.price, checkin: ci, checkout: co, guests: g >= 1 && g <= 6 ? g : 2, guestName: str(d.guestName, 100), phone: /^[+\d\s()-]*$/.test(phone) ? phone : '', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '' };
    } catch (_) { return null; }
  }
  const goToAuth = () => { window.location.href = 'auth.html'; };

  // Inline error + retry shown inside the booking modal
  function modalNotice(message, onRetry) {
    const form = $('#reservationForm'); let box = $('#bookingNotice');
    if (!box) { box = document.createElement('div'); box.id = 'bookingNotice'; box.setAttribute('role', 'alert'); box.className = 'form-hint'; box.style.cssText = 'color:#8d2f35;background:#fbeeee;padding:10px 12px;line-height:1.6'; form.insertBefore(box, form.firstChild); }
    box.textContent = ''; if (!message) { box.hidden = true; return; }
    box.hidden = false; box.append(message + ' ');
    if (onRetry) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Try again'; b.style.cssText = 'background:none;border:0;padding:0;font-weight:700;text-decoration:underline;color:inherit'; b.addEventListener('click', onRetry); box.append(b); }
  }

  // Click on a room's "Choose this room": verify sign-in BEFORE the booking form opens.
  async function startBooking(room, price, btn) {
    if (gate.busy) return; gate.busy = true;
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.style.opacity = '.6'; }
    let r;
    try { r = await checkSession(false); } finally { gate.busy = false; if (btn) { btn.removeAttribute('aria-busy'); btn.style.opacity = ''; } }
    if (r.status === 'authed') { openBooking(room, price); return; }
    if (r.status === 'anon') {
      saveDraft({ room, checkin: checkin.value, checkout: checkout.value, guests: parseInt($('#guests').value, 10) || 2 });
      showToast('Please sign in or create an account to continue your booking.');
      setTimeout(goToAuth, 500); return;
    }
    openBooking(room, price); // keep the guest’s selection visible, but explain and offer retry; submit re-checks anyway
    const retry = async () => { modalNotice('Checking…'); const again = await checkSession(false); if (again.status === 'authed') modalNotice(''); else if (again.status === 'anon') submitDraftAndGo(); else modalNotice(again.message, retry); };
    modalNotice(r.message, retry);
  }
  function currentFormDraft() {
    const f = new FormData($('#reservationForm'));
    return { room: String(f.get('room') || ''), checkin: String(f.get('checkin') || ''), checkout: String(f.get('checkout') || ''), guests: parseInt(String(f.get('guestCount')).split(' ')[0], 10) || 2, guestName: String(f.get('guestName') || ''), phone: String(f.get('phone') || ''), email: String(f.get('email') || '') };
  }
  function submitDraftAndGo() { saveDraft(currentFormDraft()); showToast('Please sign in or create an account to continue your booking.'); setTimeout(goToAuth, 500); }

  $$('.room-book').forEach(btn => btn.addEventListener('click', () => startBooking(btn.dataset.room, btn.dataset.price, btn)));

  // Returning from auth.html (or reloading with a saved draft): reopen the booking with the selection restored.
  async function resumeBooking() {
    const d = loadDraft();
    if (!d) { if (safeStore.get(DRAFT_KEY)) safeStore.del(DRAFT_KEY); return; }
    const r = await checkSession(false);
    if (r.status !== 'authed') return; // still signed out: keep the draft for after sign-in
    safeStore.del(DRAFT_KEY);
    try { const u = new URL(window.location.href); if (u.searchParams.has('resume')) { u.searchParams.delete('resume'); history.replaceState(null, '', u.pathname + u.search + u.hash); } } catch (_) {}
    checkin.value = d.checkin; checkout.value = d.checkout; $('#guests').value = String(d.guests);
    openBooking(d.room, d.price);
    modalCheckin.value = d.checkin; modalCheckout.value = d.checkout; modalCheckout.min = d.checkin; updateTotal();
    const form = $('#reservationForm');
    if (d.guestName) form.elements.guestName.value = d.guestName;
    if (d.phone) form.elements.phone.value = d.phone;
    if (d.email) form.elements.email.value = d.email;
    form.elements.guestCount.value = guestsToText(d.guests);
    showToast('Welcome back — your booking details are restored.');
  }
  resumeBooking();
  modalCheckin.addEventListener('change',()=>{const d=new Date(`${modalCheckin.value}T00:00:00`);d.setDate(d.getDate()+1);modalCheckout.min=iso(d);if(modalCheckout.value<=modalCheckin.value)modalCheckout.value=iso(d);updateTotal();});
  modalCheckout.addEventListener('change',updateTotal);
  $('#modalClose').addEventListener('click',closeBooking); modal.addEventListener('click',e=>{if(e.target===modal)closeBooking();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeBooking();$('#lightbox').classList.remove('open');}});
  $('#reservationForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (gate.busy) return; // blocks duplicate submissions
    const form = e.currentTarget, f = new FormData(form), submitBtn = form.querySelector('[type="submit"]');
    if (f.get('checkin') >= f.get('checkout')) { showToast('Please choose a valid check-out date.'); return; }
    gate.busy = true; modalNotice('');
    const label = submitBtn.innerHTML; submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); submitBtn.textContent = 'Saving your request…';
    const release = () => { gate.busy = false; submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); submitBtn.innerHTML = label; };
    try {
      const auth = await checkSession(true); // server-verified user; nothing is saved before this succeeds
      if (auth.status === 'anon') { release(); submitDraftAndGo(); return; }
      if (auth.status === 'error') { release(); modalNotice(auth.message, () => form.requestSubmit()); return; }
      const booking = { user_id: auth.user.id, guest_name: String(f.get('guestName')).trim(), guest_email: String(f.get('email')).trim(), guest_phone: String(f.get('phone')).trim(), room_type: String(f.get('room')), check_in: String(f.get('checkin')), check_out: String(f.get('checkout')), guests: parseInt(String(f.get('guestCount')).split(' ')[0], 10) || 1, special_request: null };
      const { data: saved, error } = await withTimeout(db.from('bookings').insert(booking).select('id').single(), SAVE_TIMEOUT).then(r => r, err => ({ error: err }));
      if (error) { release(); modalNotice(isNetworkErr(error) ? 'We couldn’t save your booking because the connection failed. Nothing was submitted — please try again.' : 'Booking could not be saved: ' + error.message, () => form.requestSubmit()); return; }
      release(); safeStore.del(DRAFT_KEY); closeBooking(); form.reset();
      showToast('Booking request submitted! Reference: ' + String(saved && saved.id || '').slice(0, 8).toUpperCase() + '. Check My Bookings for updates.');
    } catch (err) { release(); modalNotice('Something went wrong. Please try again.', () => form.requestSubmit()); }
  });
  $('#contactForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const subject=encodeURIComponent('DV-LUXURY enquiry: '+f.get('topic'));const body=encodeURIComponent(`Name: ${f.get('name')}\nEmail: ${f.get('email')}\nTopic: ${f.get('topic')}\n\n${f.get('message')}`);$('#contactMessage').textContent='Your email app may open with a prepared message. Replace the sample hotel email before launch.';window.location.href=`mailto:hello@dvluxury.example?subject=${subject}&body=${body}`;});
  $$('.gallery-item').forEach(btn=>btn.addEventListener('click',()=>{const box=$('#lightbox');$('#lightboxImage').src=btn.dataset.image;box.classList.add('open');box.setAttribute('aria-hidden','false');}));
  function closeLightbox(){$('#lightbox').classList.remove('open');$('#lightbox').setAttribute('aria-hidden','true');$('#lightboxImage').src='';} $('#lightboxClose').addEventListener('click',closeLightbox);$('#lightbox').addEventListener('click',e=>{if(e.target.id==='lightbox')closeLightbox();});
  if ('IntersectionObserver' in window) { const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.12}); $$('.reveal').forEach(el=>observer.observe(el)); } else $$('.reveal').forEach(el=>el.classList.add('visible'));
})();
