(() => {
  'use strict';

  /* =========================================================================
     DV-LUXURY guest account — auth.js
     Uses the existing Supabase setup from config.js:
       window.DV_SUPABASE_URL, window.DV_SUPABASE_PUBLISHABLE_KEY
     Optional (not required): window.DV_AUTH_REDIRECT_URL — absolute https URL of
     the deployed auth.html, used for OAuth / email-link redirects.
     ========================================================================= */

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const COMMON_PASSWORDS = ['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwertyuiop', 'iloveyou', '11111111', 'abcd1234', 'letmein1'];

  const MSG = {
    network: 'We couldn’t reach the server. Please check your internet connection and try again.',
    googleOff: 'Google sign-in isn’t switched on yet. In Supabase, open Authentication → Providers → Google, enable it and add your Google OAuth credentials.',
    needWeb: 'This needs the website to be opened through its web address (https://…), not as a file on your device.'
  };

  const state = {
    busy: false,
    recovery: false,
    hadUser: false,
    signingOut: false,
    pendingEmail: '',
    resendUntil: 0
  };

  /* ---------- Read email-link / OAuth errors BEFORE the client touches the URL ---------- */
  const urlInfo = (() => {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search);
    const get = k => hash.get(k) || query.get(k);
    const info = { error: get('error'), code: get('error_code'), description: get('error_description'), recovery: get('type') === 'recovery' && !!hash.get('access_token') };
    if (info.error || info.code) { try { history.replaceState(null, '', location.pathname); } catch (_) { /* ignore */ } }
    return info;
  })();

  /* ---------- Small UI helpers ---------- */
  function setMessage(sel, text, kind) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message' + (text ? ' message--' + (kind || 'info') : '');
  }

  const panels = ['login', 'signup', 'forgot', 'notice', 'recovery'];
  const panelEl = name => $('#' + name + 'Panel');
  function showPanel(name, opts = {}) {
    panels.forEach(p => { const el = panelEl(p); if (el) el.classList.toggle('active', p === name); });
    const isTab = name === 'login' || name === 'signup';
    const sw = $('#accountSwitch');
    sw.hidden = !isTab;
    if (isTab) {
      sw.dataset.active = name;
      [['login', $('#showLogin')], ['signup', $('#showSignup')]].forEach(([n, btn]) => {
        btn.setAttribute('aria-selected', String(n === name));
        btn.tabIndex = n === name ? 0 : -1;
      });
    }
    if (opts.focus) {
      const target = opts.focus === 'field' ? $('input', panelEl(name)) : $('.form-title', panelEl(name));
      if (target) target.focus({ preventScroll: false });
    }
  }

  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); showPanel(go.dataset.go, { focus: 'field' }); }
  });
  $('#showLogin').addEventListener('click', () => showPanel('login'));
  $('#showSignup').addEventListener('click', () => showPanel('signup'));
  $('#accountSwitch').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = (e.key === 'ArrowRight' || e.key === 'End') ? 'signup' : 'login';
    showPanel(next); $(next === 'login' ? '#showLogin' : '#showSignup').focus();
  });
  $('#forgotLink').addEventListener('click', () => {
    const typed = $('#loginEmail').value.trim();
    showPanel('forgot', { focus: 'field' });
    if (typed && !$('#forgotEmail').value) { $('#forgotEmail').value = typed; }
  });

  /* ---------- Password visibility ---------- */
  $$('[data-toggle-password]').forEach(btn => btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.togglePassword);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    btn.classList.toggle('is-visible', reveal);
    btn.setAttribute('aria-pressed', String(reveal));
    btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  }));

  /* ---------- Validation ---------- */
  const validators = {
    email: v => !v ? 'Please enter your email address.' : !EMAIL_RE.test(v) ? 'Enter a valid email address, like you@example.com.' : '',
    name: v => !v ? 'Please enter your full name.' : v.length < 2 ? 'That name looks a little short.' : '',
    'password-login': v => v ? '' : 'Please enter your password.',
    'password-new': v => !v ? 'Please create a password.' : v.length < 8 ? 'Use at least 8 characters.' : '',
    confirm: (v, input) => {
      const other = document.getElementById(input.dataset.match);
      return !v ? 'Please confirm your password.' : (other && v !== other.value) ? 'These passwords don’t match yet.' : '';
    }
  };

  function inputValue(input) {
    const t = input.dataset.validate;
    return (t === 'email' || t === 'name') ? input.value.trim() : input.value;
  }

  function validateInput(input, force) {
    if (force) input.dataset.touched = '1';
    const touched = input.dataset.touched === '1';
    const val = inputValue(input);
    const err = validators[input.dataset.validate](val, input);
    const field = input.closest('.field');
    const msg = $('.field-msg', field);
    field.classList.remove('is-valid', 'is-invalid');
    input.removeAttribute('aria-invalid');
    msg.textContent = '';
    if (touched && err) {
      field.classList.add('is-invalid'); input.setAttribute('aria-invalid', 'true'); msg.textContent = err;
    } else if (touched && !err && val && !input.hasAttribute('data-no-valid')) {
      field.classList.add('is-valid');
    }
    return err;
  }

  function setFieldError(input, text) {
    input.dataset.touched = '1';
    const field = input.closest('.field');
    field.classList.remove('is-valid'); field.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    $('.field-msg', field).textContent = text;
  }

  function validateForm(form) {
    let first = null;
    $$('[data-validate]', form).forEach(input => { if (validateInput(input, true) && !first) first = input; });
    if (first) first.focus();
    return !first;
  }

  /* Password strength */
  function scorePassword(p) {
    if (!p) return { level: 0, label: '', hint: '' };
    if (p.length < 8) return { level: 1, label: 'Too short', hint: 'Use at least 8 characters.' };
    if (COMMON_PASSWORDS.includes(p.toLowerCase())) return { level: 1, label: 'Too common', hint: 'Choose something harder to guess.' };
    const points = (p.length >= 12) + (/[a-z]/.test(p) && /[A-Z]/.test(p)) + /\d/.test(p) + /[^A-Za-z0-9]/.test(p);
    if (points <= 0) return { level: 1, label: 'Weak', hint: 'Add numbers, capitals or symbols.' };
    if (points === 1) return { level: 2, label: 'Fair', hint: 'Mix in capitals, numbers or a symbol.' };
    if (points === 2) return { level: 3, label: 'Good', hint: 'Nearly there — a longer password is stronger.' };
    return { level: 4, label: 'Strong', hint: 'Excellent choice.' };
  }

  $$('[data-validate]').forEach(input => {
    input.addEventListener('blur', () => { if (input.value || input.dataset.touched === '1') validateInput(input, true); });
    input.addEventListener('input', () => {
      if (input.dataset.touched === '1') validateInput(input, false);
      if (input.dataset.strength) {
        const meter = document.getElementById(input.dataset.strength);
        const s = scorePassword(input.value);
        meter.hidden = !input.value; meter.dataset.level = String(s.level);
        $('.strength-label', meter).textContent = s.label; $('.strength-hint', meter).textContent = s.hint;
        const confirm = $$('[data-match="' + input.id + '"]')[0];
        if (confirm && confirm.dataset.touched === '1') validateInput(confirm, false);
      }
    });
  });

  /* ---------- Busy state (prevents duplicate submissions) ---------- */
  function setBusy(btn, on) {
    state.busy = on;
    $$('.form-button[type="submit"], .google-button').forEach(b => {
      if (on) b.setAttribute('aria-disabled', 'true'); else { b.removeAttribute('aria-disabled'); b.classList.remove('is-loading'); }
    });
    if (!btn) return;
    btn.classList.toggle('is-loading', on);
    btn.setAttribute('aria-busy', String(on));
    const label = $('.btn-label', btn);
    if (label) {
      if (on) { label.dataset.idle = label.textContent; label.textContent = btn.dataset.busy || 'Please wait…'; }
      else if (label.dataset.idle) { label.textContent = label.dataset.idle; delete label.dataset.idle; }
    }
  }

  /* ---------- Error translation ---------- */
  function isNetworkError(err) {
    if (!err) return false;
    const m = String(err.message || '');
    return err.name === 'AuthRetryableFetchError' || err.name === 'TypeError' || err.status === 0 ||
      /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(m);
  }

  function friendlyError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (isNetworkError(err) || navigator.onLine === false) return MSG.network;
    const code = String(err.code || err.error_code || '');
    const m = String(err.message || '').toLowerCase();
    if (code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'That email and password don’t match. Please check them and try again.';
    if (code === 'email_not_confirmed' || m.includes('email not confirmed')) return 'Please verify your email before signing in. Check your inbox for the confirmation link.';
    if (code === 'user_already_exists' || code === 'email_exists' || m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists. Try signing in, or reset your password.';
    if (code === 'weak_password' || m.includes('password should') || m.includes('weak password')) return 'That password is too easy to guess. Try a longer one with a mix of letters, numbers and symbols.';
    if (code === 'same_password' || m.includes('different from the old password')) return 'Please choose a password that’s different from your current one.';
    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || err.status === 429 || m.includes('rate limit') || m.includes('security purposes')) return 'Too many attempts. Please wait a minute and try again.';
    if (code === 'signup_disabled' || m.includes('signups not allowed')) return 'New registrations are currently closed. Please contact the hotel.';
    if (code === 'provider_disabled' || m.includes('provider is not enabled') || m.includes('unsupported provider')) return MSG.googleOff;
    if (code === 'email_address_invalid' || m.includes('email address') && m.includes('invalid')) return 'That email address doesn’t look valid. Please check it.';
    if (code === 'otp_expired' || m.includes('expired') || m.includes('invalid or has expired')) return 'That link has expired or was already used. Please request a new one.';
    if (code === 'session_not_found' || code === 'refresh_token_not_found' || m.includes('session missing') || m.includes('session_not_found')) return 'Your session has ended. Please sign in again.';
    return err.message || 'Something went wrong. Please try again.';
  }

  /* ---------- Config + client (existing setup, unchanged) ---------- */
  const url = window.DV_SUPABASE_URL, key = window.DV_SUPABASE_PUBLISHABLE_KEY;
  const configured = url && key && !String(url).includes('PASTE_') && !String(key).includes('PASTE_');
  let db = null;
  let waiting = false; // true while the Supabase library is still downloading

  function showConfigWarning(text) {
    const box = $('#configWarning');
    box.classList.remove('hidden');
    box.textContent = text;
  }
  if (!configured) {
    showConfigWarning('Setup needed: open config.js and add your Supabase Project URL and Publishable key. Never use a secret/service_role key in the browser.');
  } else if (window.supabase) {
    db = window.supabase.createClient(url, key);
  } else {
    // auth.html loads the library AFTER this script, so tabs and forms work even while it downloads.
    waiting = true;
    setTimeout(() => { if (waiting) showConfigWarning('Connecting is taking longer than usual. Please check your internet connection.'); }, 10000);
  }
  const requireDb = msgSel => {
    if (db) return true;
    setMessage(msgSel, waiting ? 'Still connecting to the account service… please try again in a moment.' : 'Guest accounts aren’t available right now. Please try again shortly.', 'error');
    return false;
  };
  // Called by auth.html when the Supabase library has finished (or failed) loading.
  window.dvSupabaseLoaded = () => {
    if (db || !configured || !window.supabase) return;
    db = window.supabase.createClient(url, key);
    waiting = false;
    $('#configWarning').classList.add('hidden');
    boot();
  };
  window.dvSupabaseFailed = () => {
    if (db) return;
    waiting = false;
    showConfigWarning('Supabase library did not load. Check your internet connection and reload.');
    document.documentElement.classList.remove('is-checking');
  };

  /* Password-recovery emails open reset-password.html in the same folder as this page. */
  function resetUrl() {
    const custom = window.DV_RESET_REDIRECT_URL;
    if (typeof custom === 'string' && /^https?:\/\//i.test(custom)) return custom;
    if (location.protocol === 'http:' || location.protocol === 'https:') return new URL('reset-password.html', location.href).href;
    return null;
  }

  /* Redirect target for OAuth + email links: never invents a domain, never forces localhost. */
  function redirectUrl() {
    const custom = window.DV_AUTH_REDIRECT_URL;
    if (typeof custom === 'string' && /^https?:\/\//i.test(custom) && !custom.includes('PASTE_')) return custom;
    if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin + location.pathname;
    return null;
  }

  /* ---------- Verification-email resend ---------- */
  let resendTimer = null;
  function tickResend() {
    const left = Math.ceil((state.resendUntil - Date.now()) / 1000);
    ['#resendBtn', '#resendLoginBtn'].forEach(sel => {
      const b = $(sel); if (!b) return;
      if (left > 0) { b.textContent = 'Resend in ' + left + 's'; b.setAttribute('aria-disabled', 'true'); }
      else { b.textContent = sel === '#resendBtn' ? 'Resend the email' : 'Resend verification email'; b.removeAttribute('aria-disabled'); }
    });
    if (left <= 0 && resendTimer) { clearInterval(resendTimer); resendTimer = null; }
  }
  async function resendVerification(msgSel) {
    if (state.busy || Date.now() < state.resendUntil || !state.pendingEmail || !requireDb(msgSel)) return;
    state.busy = true;
    try {
      const options = {}; const r = redirectUrl(); if (r) options.emailRedirectTo = r;
      const { error } = await db.auth.resend({ type: 'signup', email: state.pendingEmail, options });
      if (error) throw error;
      setMessage(msgSel, 'We’ve sent a fresh verification email. It can take a minute to arrive — please check your spam folder too.', 'success');
      state.resendUntil = Date.now() + 45000;
      if (!resendTimer) resendTimer = setInterval(tickResend, 1000);
      tickResend();
    } catch (err) { setMessage(msgSel, friendlyError(err), 'error'); }
    finally { state.busy = false; }
  }
  $('#resendBtn').addEventListener('click', () => resendVerification('#noticeMessage'));
  $('#resendLoginBtn').addEventListener('click', () => resendVerification('#loginMessage'));

  function showNotice(kind, email) {
    const panel = $('#noticePanel');
    panel.dataset.kind = kind;
    const body = $('#noticeBody'), steps = $('#noticeSteps');
    body.textContent = ''; steps.textContent = '';
    const strong = document.createElement('strong'); strong.textContent = email;
    if (kind === 'verify') {
      $('#noticeTitle').textContent = 'Verify your email';
      body.append('We’ve sent a confirmation link to ', strong, '. Your account is created but isn’t active yet — please open the email and confirm your address before signing in.');
      steps.textContent = '1. Open the email from DV-LUXURY.  2. Tap the confirmation link.  3. Come back here and sign in.';
      $('#resendBtn').hidden = false;
    } else {
      $('#noticeTitle').textContent = 'Check your inbox';
      body.append('If an account exists for ', strong, ', a secure link to reset your password is on its way. It can take a minute to arrive.');
      steps.textContent = 'Didn’t get it? Check your spam folder, or go back and try again with the email you registered with.';
      $('#resendBtn').hidden = true;
    }
    setMessage('#noticeMessage', '');
    showPanel('notice', { focus: true });
  }

  /* ---------- Sign up ---------- */
  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (state.busy) return;
    const form = e.currentTarget, btn = $('[type="submit"]', form);
    setMessage('#signupMessage', '');
    if (!validateForm(form)) return;
    if (!requireDb('#signupMessage')) return;
    const email = $('#signupEmail').value.trim(), fullName = $('#signupName').value.trim(), password = $('#signupPassword').value;
    setBusy(btn, true);
    try {
      const options = { data: { full_name: fullName } };
      const r = redirectUrl(); if (r) options.emailRedirectTo = r;
      const { data, error } = await db.auth.signUp({ email, password, options });
      if (error) throw error;
      // With email confirmation on, Supabase returns an obfuscated user with no identities for an existing email.
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setFieldError($('#signupEmail'), 'This email is already registered.');
        setMessage('#signupMessage', 'An account with this email already exists. Try signing in, or reset your password.', 'error');
        return;
      }
      if (data && data.session) {
        form.reset(); resetForm(form);
        setMessage('#accountStatus', 'Your account has been created and you are signed in.', 'success');
        await refresh();
        return;
      }
      state.pendingEmail = email;
      form.reset(); resetForm(form);
      showNotice('verify', email);
    } catch (err) {
      setMessage('#signupMessage', friendlyError(err), 'error');
    } finally { setBusy(btn, false); }
  });

  function resetForm(form) {
    $$('.field', form).forEach(f => { f.classList.remove('is-valid', 'is-invalid'); $('.field-msg', f).textContent = ''; });
    $$('[data-validate]', form).forEach(i => { delete i.dataset.touched; i.removeAttribute('aria-invalid'); });
    $$('.strength', form).forEach(m => { m.hidden = true; m.dataset.level = '0'; });
    $$('[data-toggle-password]', form).forEach(b => { const i = document.getElementById(b.dataset.togglePassword); i.type = 'password'; b.classList.remove('is-visible'); b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password'); });
  }

  /* ---------- Sign in ---------- */
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (state.busy) return;
    const form = e.currentTarget, btn = $('[type="submit"]', form);
    setMessage('#loginMessage', ''); $('#resendLoginBtn').hidden = true;
    if (!validateForm(form)) return;
    if (!requireDb('#loginMessage')) return;
    const email = $('#loginEmail').value.trim(), password = $('#loginPassword').value;
    setBusy(btn, true);
    try {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message || '')) {
          state.pendingEmail = email; $('#resendLoginBtn').hidden = false; tickResend();
        }
        throw error;
      }
      form.reset(); resetForm(form);
      setMessage('#accountStatus', 'Signed in successfully. Welcome back.', 'success');
      await refresh();
    } catch (err) {
      setMessage('#loginMessage', friendlyError(err), 'error');
    } finally { setBusy(btn, false); }
  });

  /* ---------- Forgot password ---------- */
  $('#forgotForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (state.busy) return;
    const form = e.currentTarget, btn = $('[type="submit"]', form);
    setMessage('#forgotMessage', '');
    if (!validateForm(form)) return;
    if (!requireDb('#forgotMessage')) return;
    const redirectTo = resetUrl();
    if (!redirectTo) { setMessage('#forgotMessage', MSG.needWeb, 'error'); return; }
    const email = $('#forgotEmail').value.trim();
    setBusy(btn, true);
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      form.reset(); resetForm(form);
      showNotice('reset', email);
    } catch (err) {
      setMessage('#forgotMessage', friendlyError(err), 'error');
    } finally { setBusy(btn, false); }
  });

  /* ---------- Set new password (arrives via the emailed link) ---------- */
  function enterRecovery() {
    state.recovery = true;
    $('#authArea').hidden = false;
    $('#myBookings').classList.add('hidden');
    document.documentElement.classList.remove('is-checking');
    showPanel('recovery');
  }
  $('#recoveryForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (state.busy) return;
    const form = e.currentTarget, btn = $('[type="submit"]', form);
    setMessage('#recoveryMessage', '');
    if (!validateForm(form)) return;
    if (!requireDb('#recoveryMessage')) return;
    setBusy(btn, true);
    try {
      const { error } = await db.auth.updateUser({ password: $('#recoveryPassword').value });
      if (error) throw error;
      state.recovery = false;
      form.reset(); resetForm(form);
      setMessage('#accountStatus', 'Your password has been updated. You’re signed in.', 'success');
      await refresh();
    } catch (err) {
      setMessage('#recoveryMessage', friendlyError(err), 'error');
    } finally { setBusy(btn, false); }
  });

  /* ---------- Google (sign in + sign up share one OAuth flow) ---------- */
  async function preflightOAuth(authorizeUrl) {
    // Detects "provider not enabled" before leaving the page. Any uncertainty => proceed with the redirect.
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(authorizeUrl, { redirect: 'manual', signal: ctrl.signal, credentials: 'omit' });
      if (res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400) || res.ok) return '';
      let body = {}; try { body = await res.json(); } catch (_) { /* not JSON */ }
      const text = String(body.msg || body.message || body.error_description || '');
      if (/provider is not enabled|unsupported provider/i.test(text) || body.error_code === 'validation_failed') return MSG.googleOff;
      return text || 'Google sign-in is unavailable right now. Please try again later.';
    } catch (_) { return ''; } finally { clearTimeout(timer); }
  }

  async function googleAuth(btn, msgSel) {
    if (state.busy) return;
    setMessage(msgSel, '');
    if (!requireDb(msgSel)) return;
    const redirectTo = redirectUrl();
    if (!redirectTo) { setMessage(msgSel, MSG.needWeb, 'error'); return; }
    setBusy(btn, true);
    try {
      const { data, error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
      if (error) throw error;
      const problem = await preflightOAuth(data.url);
      if (problem) { setBusy(btn, false); setMessage(msgSel, problem, 'error'); return; }
      window.location.assign(data.url); // stay in loading state while the browser navigates away
    } catch (err) {
      setBusy(btn, false);
      setMessage(msgSel, friendlyError(err), 'error');
    }
  }
  $('#googleLoginBtn').addEventListener('click', e => googleAuth(e.currentTarget, '#loginMessage'));
  $('#googleSignupBtn').addEventListener('click', e => googleAuth(e.currentTarget, '#signupMessage'));
  // Returning with the browser Back button must not leave the Google button stuck.
  window.addEventListener('pageshow', ev => { if (ev.persisted && !state.recovery) setBusy(null, false); });

  /* ---------- Sign out ---------- */
  $('#logoutBtn').addEventListener('click', async () => {
    if (!db || state.busy) return;
    state.signingOut = true;
    try { await db.auth.signOut(); } catch (_) { try { await db.auth.signOut({ scope: 'local' }); } catch (__) { /* ignore */ } }
    setMessage('#loginMessage', 'You have signed out.', 'info');
    await refresh();
    state.signingOut = false;
  });

  /* ---------- Account view + My Bookings ---------- */
  const fmtDate = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return String(s || '—');
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const nightsBetween = (a, b) => {
    const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(a || '')), pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b || ''));
    if (!pa || !pb) return 0;
    return Math.max(0, Math.round((Date.UTC(+pb[1], +pb[2] - 1, +pb[3]) - Date.UTC(+pa[1], +pa[2] - 1, +pa[3])) / 86400000));
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function renderBookings(rows) {
    const box = $('#bookingList');
    box.replaceChildren();
    if (!rows.length) {
      const empty = el('div', 'empty-state', 'No bookings yet. Browse rooms on the hotel website and sign in before submitting a reservation.');
      empty.append(document.createElement('br'));
      const a = el('a', null, 'Explore rooms & suites ↗'); a.href = 'index.html#rooms'; empty.append(a);
      box.append(empty); return;
    }
    rows.forEach(b => {
      const item = el('div', 'booking-item');
      const top = el('div', 'booking-top');
      const status = String(b.status || 'pending').toLowerCase();
      const chipClass = ['pending', 'confirmed', 'declined', 'cancelled'].includes(status) ? ' chip--' + status : '';
      top.append(el('strong', null, b.room_type || 'Room'), el('span', 'chip' + chipClass, status));
      const meta = el('div', 'booking-meta');
      const n = nightsBetween(b.check_in, b.check_out);
      meta.append(
        el('span', null, fmtDate(b.check_in) + ' → ' + fmtDate(b.check_out) + (n ? ' · ' + n + ' night' + (n === 1 ? '' : 's') : '')),
        el('span', null, (b.guests || 1) + ' guest' + ((b.guests || 1) === 1 ? '' : 's')),
        el('span', null, 'Payment: ' + (b.payment_status || 'unpaid'))
      );
      item.append(top, meta);
      if (b.id) item.append(el('div', 'booking-ref', 'Ref ' + String(b.id).slice(0, 8)));
      box.append(item);
    });
  }

  let seq = 0;
  async function loadBookings(user, mySeq) {
    const box = $('#bookingList');
    box.replaceChildren(el('div', 'skeleton'), el('div', 'skeleton'));
    let res;
    try {
      res = await db.from('bookings')
        .select('id,room_type,check_in,check_out,guests,status,payment_status,created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false });
    } catch (err) { res = { error: err }; }
    if (mySeq !== seq) return;
    if (res.error) {
      box.replaceChildren();
      const wrap = el('div', 'empty-state', isNetworkError(res.error) ? MSG.network : 'We couldn’t load your bookings just yet. Please try again in a moment.');
      wrap.append(document.createElement('br'));
      const retry = el('button', 'link-btn', 'Try again'); retry.type = 'button';
      retry.addEventListener('click', () => loadBookings(user, ++seq));
      wrap.append(retry); box.append(wrap); return;
    }
    renderBookings(res.data || []);
  }

  function showSignedOut() {
    $('#authArea').hidden = false;
    $('#accountIntro').hidden = false;
    $('#myBookings').classList.add('hidden');
    $('#logoutBtn').classList.add('hidden');
    document.documentElement.classList.remove('is-checking');
  }

  async function refresh() {
    if (!db || state.recovery) { if (!db) document.documentElement.classList.remove('is-checking'); return; }
    const mySeq = ++seq;
    let user = null, err = null;
    try { const r = await db.auth.getUser(); user = (r.data && r.data.user) || null; err = r.error || null; }
    catch (e) { err = e; }
    if (mySeq !== seq || state.recovery) return;

    if (!user) {
      const hadUser = state.hadUser; state.hadUser = false;
      showSignedOut();
      if (err && isNetworkError(err)) { setMessage('#loginMessage', MSG.network, 'error'); }
      else if (err && err.name !== 'AuthSessionMissingError') {
        try { await db.auth.signOut({ scope: 'local' }); } catch (_) { /* ignore */ }
        setMessage('#loginMessage', 'Your session has expired. Please sign in again.', 'info');
      } else if (hadUser && !state.signingOut) {
        setMessage('#loginMessage', 'Your session has ended. Please sign in again to continue.', 'info');
      }
      return;
    }

    state.hadUser = true;
    // A guest sent here from a booking attempt goes straight back to the booking (details are restored by script.js).
    try {
      const raw = localStorage.getItem('dv_pending_booking');
      if (raw && Date.now() - Number(JSON.parse(raw).savedAt) < 60 * 60 * 1000) { window.location.replace('index.html?resume=1'); return; }
    } catch (_) { /* storage unavailable: fall through to the account view */ }
    const meta = user.user_metadata || {};
    const name = String(meta.full_name || meta.name || '').trim() || String(user.email || 'Guest');
    $('#accountName').textContent = name;
    $('#accountEmail').textContent = user.email || '';
    $('#accountAvatar').textContent = (name.trim()[0] || 'G').toUpperCase();
    $('#authArea').hidden = true;
    $('#accountIntro').hidden = true;
    $('#myBookings').classList.remove('hidden');
    $('#logoutBtn').classList.remove('hidden');
    document.documentElement.classList.remove('is-checking');
    await loadBookings(user, mySeq);
  }

  /* ---------- Boot ---------- */

  // Messages for links that came back with an error (expired reset link, OAuth denied, …)
  if (urlInfo.error || urlInfo.code) {
    const desc = urlInfo.description ? urlInfo.description.replace(/\+/g, ' ') : '';
    const text = friendlyError({ code: urlInfo.code, message: desc || 'Sign-in could not be completed.' });
    const expired = urlInfo.code === 'otp_expired' || /expired/i.test(desc);
    const oauthDenied = urlInfo.error === 'access_denied' && !expired;
    if (expired) { showPanel('forgot'); setMessage('#forgotMessage', text, 'error'); }
    else { setMessage('#loginMessage', oauthDenied ? 'Google sign-in was cancelled. You can try again whenever you’re ready.' : text, oauthDenied ? 'info' : 'error'); }
  }

  let booted = false;
  function boot() {
    if (booted || !db) return;
    booted = true;
    db.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { enterRecovery(); return; }
      setTimeout(refresh, 0); // never call Supabase directly inside this callback
    });
    if (urlInfo.recovery) enterRecovery();
    // Avoid flashing the forms for guests who already have a saved session.
    const failSafe = setTimeout(() => document.documentElement.classList.remove('is-checking'), 4000);
    refresh().finally(() => clearTimeout(failSafe));
  }
  if (db) boot();
  else if (!waiting) document.documentElement.classList.remove('is-checking');
  // Never leave the page hidden behind the "checking" state if the library is slow.
  setTimeout(() => document.documentElement.classList.remove('is-checking'), 4000);
})();
