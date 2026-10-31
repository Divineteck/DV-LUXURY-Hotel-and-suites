/* DV-LUXURY motion layer v2. Sets CSS variables, adds decorative elements and nav helpers only.
   It never touches forms, auth, Supabase or booking code, and fails silently. */
(() => {
  'use strict';
  try {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // navigation helpers still run; CSS removes the motion
    const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const root = document.documentElement, hdr = $('.site-header'), hero = $('.hero');
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), mk = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h) n.innerHTML = h; return n; };
    $$('img').forEach(i => { i.decoding = 'async'; });
    const heroImg = $('.hero-image'); if (heroImg) heroImg.setAttribute('fetchpriority', 'high');

    /* decorative additions */
    document.body.append(mk('div', 'fx-bar'));
    if (hero) hero.append(mk('div', 'fx-orbs', '<i></i><i></i><i></i>'));
    const words = ['Stay extraordinary', 'Comfort', 'Warm hospitality', 'DV-LUXURY'];
    const ribbon = alt => { const r = mk('div', 'fx-marquee' + (alt ? ' alt' : '')); r.setAttribute('aria-hidden', 'true'); const set = words.concat(words).map(w => '<span>' + w + '</span><span>✦</span>').join(''); r.append(mk('div', 'fx-track', set + set)); return r; };
    const bw = $('.booking-wrap'), qs = $('.quote-section');
    const ribbons = [];
    if (bw) { const r = ribbon(false); bw.after(r); ribbons.push(r); }
    if (qs) { const r = ribbon(true); qs.before(r); ribbons.push(r); }
    const links = [['#top', 'Home', 'Home'], ['#about', 'About', 'About'], ['#rooms', 'Rooms', 'Rooms'], ['#experience', 'Experience', 'Experience'], ['#services', 'Services', 'Services'], ['#gallery', 'Gallery', 'Gallery'], ['#locations', 'Branches', 'Branches'], ['#contact', 'Contact', 'Contact']];
    const dots = mk('nav', 'fx-dots'); dots.setAttribute('aria-label', 'Page sections');
    links.forEach(l => dots.append(mk('a', '', '<span>' + l[2] + '</span>')) ); $$('a', dots).forEach((a, i) => { a.href = links[i][0]; a.setAttribute('aria-label', links[i][1]); });
    document.body.append(dots);
    const dock = mk('nav', 'fx-dock', '<a href="#top">Home</a><a href="#rooms">Rooms</a><a href="#booking">Plan</a><a href="auth.html">Account</a>'); dock.setAttribute('aria-label', 'Quick navigation'); document.body.append(dock);


    /* island menu: tap outside or press Esc to close it (open/close itself is still script.js) */
    const nav = $('#mainNav'), tog = $('#menuToggle');
    const closeMenu = () => { if (nav && nav.classList.contains('open')) { nav.classList.remove('open'); if (tog) tog.setAttribute('aria-expanded', 'false'); } };
    document.addEventListener('click', e => { if (hdr && !hdr.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

    /* scroll engine: damped (eased) scroll value gives the flowing feel; loop sleeps when idle */
    const drums = []; // section-level tilt removed (it exposed white gaps between sections)
    const items = $$('.intro-image-wrap,.experience-image img,.gallery-item img,.quote-section blockquote,.quote-section .quote-mark');
    let ease = scrollY, running = false;
    function frame() {
      const y = scrollY, vh = innerHeight, max = root.scrollHeight - vh, k = innerWidth < 700 ? .5 : 1;
      ease += (y - ease) * .1; const vel = y - ease;
      root.style.setProperty('--sp', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0); root.style.setProperty('--k', k);
      if (hdr) hdr.classList.toggle('fx-stuck', y > 40);
      if (hero) hero.style.setProperty('--hp', clamp(ease / (hero.offsetHeight || vh), 0, 1).toFixed(3));
      const v = clamp(vel * .08, -4, 4).toFixed(2); ribbons.forEach(r => r.style.setProperty('--v', v));
      const view = el => { const b = el.getBoundingClientRect(); return (b.bottom < -vh * .3 || b.top > vh * 1.3) ? null : b; };
      items.forEach(el => { const b = view(el); if (!b) return; const r = clamp((b.top + b.height / 2 - vh / 2) / vh, -1, 1); el.style.setProperty('--r', r.toFixed(3)); el.style.setProperty('--a', (1 - Math.abs(r)).toFixed(3)); });
      drums.forEach(el => { const b = view(el); if (!b) return; const r = clamp((b.top + b.height / 2 - vh / 2) / (b.height / 2 + vh / 2), -1, 1); el.style.setProperty('--r', r.toFixed(3)); el.style.setProperty('--a', (1 - Math.abs(r)).toFixed(3)); });
      if (Math.abs(vel) > .15) requestAnimationFrame(frame); else { running = false; ribbons.forEach(r => r.style.setProperty('--v', 0)); }
    }
    const wake = () => { if (!running) { running = true; requestAnimationFrame(frame); } };
    addEventListener('scroll', wake, { passive: true }); addEventListener('resize', wake); wake();

    /* active section for dots, dock and main nav */
    const ids = links.map(l => l[0]), secs = ids.map(h => $(h === '#top' ? '.hero' : h));
    const mark = i => { $$('a', dots).forEach((a, n) => a.classList.toggle('on', n === i)); $$('a', dock).forEach(a => a.classList.toggle('on', (i <= 0 && a.hash === '#top') || (a.hash === ids[i]) || (a.hash === '#booking' && i === 1 && false))); $$('#mainNav a[href^="#"]').forEach(a => { if (a.classList.contains('nav-book')) return; a.classList.toggle('active', a.hash === ids[i]); }); };
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) mark(secs.indexOf(e.target)); }), { rootMargin: '-45% 0px -50% 0px' }); secs.forEach(s => s && io.observe(s)); }

    /* make sure the new card grids always appear, even on very tall phone layouts */
    const grids = $$('.svc-grid,.branch-grid');
    if ('IntersectionObserver' in window) { const g = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); g.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' }); grids.forEach(x => g.observe(x)); } else grids.forEach(x => x.classList.add('visible'));

    /* mobile rooms coverflow: distance of each card from the centre */
    const grid = $('.room-grid');
    if (grid) { const upd = () => { const g = grid.getBoundingClientRect(), c = g.left + g.width / 2; $$('.room-card', grid).forEach(card => { if (card.hidden) return; const b = card.getBoundingClientRect(), d = clamp((b.left + b.width / 2 - c) / (g.width * .6), -1, 1); card.style.setProperty('--d', d.toFixed(3)); card.style.setProperty('--ad', Math.abs(d).toFixed(3)); }); }; grid.addEventListener('scroll', () => requestAnimationFrame(upd), { passive: true }); addEventListener('resize', upd); setTimeout(upd, 300); }

    /* desktop-only: hero mouse parallax, card tilt, magnetic buttons */
    if (!calm && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      if (hero) hero.addEventListener('pointermove', e => { hero.style.setProperty('--mx', ((e.clientX / innerWidth) - .5).toFixed(3)); hero.style.setProperty('--my', ((e.clientY / innerHeight) - .5).toFixed(3)); });
      $$('.room-card,.svc-card,.branch-card').forEach(c => {
        c.addEventListener('pointermove', e => { const b = c.getBoundingClientRect(), px = (e.clientX - b.left) / b.width - .5, py = (e.clientY - b.top) / b.height - .5; c.style.setProperty('--gx', ((px + .5) * 100).toFixed(1) + '%'); c.style.setProperty('--gy', ((py + .5) * 100).toFixed(1) + '%'); c.style.setProperty('--rv', (-py).toFixed(3) + ' ' + px.toFixed(3) + ' 0 ' + (Math.hypot(px, py) * 14).toFixed(2) + 'deg'); c.classList.add('fx-tilt'); });
        c.addEventListener('pointerleave', () => { c.style.removeProperty('--rv'); c.classList.remove('fx-tilt'); });
      });
      $$('.btn,.nav-book').forEach(b => { b.classList.add('fx-mag'); b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.translate = ((e.clientX - r.left - r.width / 2) * .18).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) * .28).toFixed(1) + 'px'; }); b.addEventListener('pointerleave', () => { b.style.translate = ''; }); });
    }
  } catch (_) { /* visuals are optional: never break the page */ }
})();
