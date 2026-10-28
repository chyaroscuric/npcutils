/* Jaankeza Utils dashboard - vanilla JS, no build step.
 * Loaded as a classic blocking script in <head> so the saved accent colour is applied
 * before first paint; the app itself boots on DOMContentLoaded. */
(() => {
  'use strict';

  /* =====================================================================
   * 1. Accent theming (spec section 3)
   * ===================================================================== */

  const PALETTES = {
    blue:    { name: 'Plava',        300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 700: '#1d4ed8', 800: '#1e40af' },
    indigo:  { name: 'Indigo',       300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 700: '#4338ca', 800: '#3730a3' },
    violet:  { name: 'Ljubičasta',   300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 700: '#6d28d9', 800: '#5b21b6' },
    purple:  { name: 'Purpurna',     300: '#d8b4fe', 400: '#c084fc', 500: '#a855f7', 700: '#7e22ce', 800: '#6b21a8' },
    fuchsia: { name: 'Fuksija',      400: '#e879f9', 500: '#d946ef', 700: '#a21caf', 800: '#86198f' },
    pink:    { name: 'Ružičasta',    400: '#f472b6', 500: '#ec4899', 700: '#be185d', 800: '#9d174d' },
    rose:    { name: 'Ruža',         400: '#fb7185', 500: '#f43f5e', 700: '#be123c', 800: '#9f1239' },
    red:     { name: 'Crvena',       400: '#f87171', 500: '#ef4444', 700: '#b91c1c', 800: '#991b1b' },
    orange:  { name: 'Narančasta',   400: '#fb923c', 500: '#f97316', 700: '#c2410c', 800: '#9a3412' },
    amber:   { name: 'Jantarna',     400: '#fbbf24', 500: '#f59e0b', 700: '#b45309', 800: '#92400e' },
    yellow:  { name: 'Žuta',         400: '#facc15', 500: '#eab308', 700: '#a16207', 800: '#854d0e' },
    lime:    { name: 'Limeta',       400: '#a3e635', 500: '#84cc16', 700: '#4d7c0f', 800: '#3f6212' },
    green:   { name: 'Zelena',       400: '#4ade80', 500: '#22c55e', 700: '#15803d', 800: '#166534' },
    emerald: { name: 'Smaragdna',    400: '#34d399', 500: '#10b981', 700: '#047857', 800: '#065f46' },
    teal:    { name: 'Tirkizna',     400: '#2dd4bf', 500: '#14b8a6', 700: '#0f766e', 800: '#115e59' },
    cyan:    { name: 'Cijan',        400: '#22d3ee', 500: '#06b6d4', 700: '#0e7490', 800: '#155e75' },
    sky:     { name: 'Nebeskoplava', 400: '#38bdf8', 500: '#0ea5e9', 700: '#0369a1', 800: '#075985' },
  };
  const DEEP_PRESETS = new Set(['indigo', 'violet', 'purple']);
  const ACCENT_KEY = 'jaankeza-dashboard.accent';
  const SIDEBAR_BG = '#1c1e23';

  function presetTokens(key) {
    const p = PALETTES[key] || PALETTES.blue;
    const deep = DEEP_PRESETS.has(key);
    return { accent: p[700], hover: p[800], text: deep ? p[400] : p[500], glow: deep ? p[300] : p[400] };
  }

  // --- sRGB <-> OKLCH (Björn Ottosson's OKLab) and WCAG contrast ---
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function hexToRgb(hex) {
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((c) => Math.round(clamp(c, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  }
  function linearRgbToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  function oklabToLinearRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }
  function hexToOklch(hex) {
    const [L, a, b] = linearRgbToOklab(hexToRgb(hex).map(toLinear));
    const C = Math.hypot(a, b);
    const H = C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    return [L, C, H];
  }
  const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  // Converts OKLCH to hex, reducing chroma (binary search) until the colour fits in sRGB.
  function oklchToHex(L, C, H) {
    L = clamp(L, 0, 1);
    const hr = (H * Math.PI) / 180;
    const lin = (c) => oklabToLinearRgb([L, c * Math.cos(hr), c * Math.sin(hr)]);
    let rgb = lin(C);
    if (!inGamut(rgb)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(lin(mid))) lo = mid; else hi = mid;
      }
      rgb = lin(lo);
    }
    return rgbToHex(rgb.map((c) => fromLinear(clamp(c, 0, 1))));
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Custom colour -> the four accent tokens, as described in section 3.
  function deriveCustom(hex) {
    let [L, C, H] = hexToOklch(hex);
    let fill = rgbToHex(hexToRgb(hex));
    while (contrast('#ffffff', fill) < 4.5 && L > 0.01) {
      L = Math.round((L - 0.01) * 1000) / 1000;
      fill = oklchToHex(L, C, H);
    }
    const hover = oklchToHex(L - 0.065, C * 0.85, H);
    let textL = 0.68;
    let text = oklchToHex(textL, C, H);
    if (contrast(text, SIDEBAR_BG) < 4.5) { textL = 0.75; text = oklchToHex(textL, C, H); }
    const glow = oklchToHex(textL + 0.07, C, H);
    return { accent: fill, hover, text, glow };
  }

  function loadAccentChoice() {
    try {
      const v = JSON.parse(localStorage.getItem(ACCENT_KEY) || 'null');
      if (v && typeof v.custom === 'string' && hexToRgb(v.custom)) return { custom: v.custom.toLowerCase() };
      if (v && PALETTES[v.preset]) return { preset: v.preset };
    } catch { /* storage unavailable */ }
    return { preset: 'blue' };
  }
  function saveAccentChoice(choice) {
    try { localStorage.setItem(ACCENT_KEY, JSON.stringify(choice)); } catch { /* ignore */ }
  }
  const tokensFor = (choice) => (choice.custom ? deriveCustom(choice.custom) : presetTokens(choice.preset));
  function applyAccent(t) {
    const s = document.documentElement.style;
    s.setProperty('--accent', t.accent);
    s.setProperty('--accent-hover', t.hover);
    s.setProperty('--accent-text', t.text);
    s.setProperty('--accent-glow', t.glow);
  }
  try { applyAccent(tokensFor(loadAccentChoice())); } catch { /* keep CSS defaults */ }

  /* =====================================================================
   * 2. Utilities: safe HTML templating, formatting
   * ===================================================================== */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ESC[c]);
  class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Safe(String(s)); // only for constant, developer-written markup
  function toHtml(v) {
    if (v == null || v === false) return '';
    if (v instanceof Safe) return v.s;
    if (Array.isArray(v)) return v.map(toHtml).join('');
    return esc(v);
  }
  // Tagged template: every interpolated value is escaped unless it is already Safe.
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += toHtml(vals[i]) + strings[i + 1];
    return new Safe(out);
  }
  function mount(el, safe) {
    if (!(safe instanceof Safe)) throw new TypeError('mount() needs Safe HTML');
    el.innerHTML = safe.s;
    hydrate(el);
  }
  function safeUrl(u) {
    if (!u) return '';
    try {
      const url = new URL(u, location.origin);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch { return ''; }
  }
  const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let uidN = 0;
  const uid = (p = 'u') => `${p}${++uidN}`;

  const nf = new Intl.NumberFormat('hr-HR');
  const fmtNum = (n) => nf.format(Number(n) || 0);
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (b === 1 && a !== 11) return one;
    if (b >= 2 && b <= 4 && (a < 12 || a > 14)) return few;
    return many;
  }
  const count = (n, one, few, many) => `${fmtNum(n)} ${plural(n, one, few, many)}`;

  const rtf = new Intl.RelativeTimeFormat('hr', { numeric: 'auto' });
  const fullDateFmt = new Intl.DateTimeFormat('hr', { dateStyle: 'full', timeStyle: 'short' });
  const fullDate = (ts) => fullDateFmt.format(new Date(ts));
  function absDate(ts) {
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return new Intl.DateTimeFormat('hr', opts).format(d);
  }
  function relTime(ts) {
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    if (abs < 45e3) return diff <= 0 ? 'upravo sada' : 'za nekoliko sekundi';
    if (abs < 45 * 60e3) return rtf.format(Math.round(diff / 60e3), 'minute');
    if (abs < 22 * 3600e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
    if (abs < 7 * 864e5) return rtf.format(Math.round(diff / 864e5), 'day');
    return absDate(ts);
  }
  // "3 h 20 min", "1 d 12 h", "45 s" - at most two units.
  function fmtDur(ms) {
    let s = Math.max(0, Math.round(ms / 1000));
    const parts = [];
    const units = [[86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's']];
    for (const [size, label] of units) {
      const v = Math.floor(s / size);
      if (v > 0 || (parts.length && parts.length < 2)) {
        if (v > 0) parts.push(`${v} ${label}`);
        s -= v * size;
      }
      if (parts.length === 2) break;
    }
    return parts.length ? parts.join(' ') : '0 s';
  }
  function fmtClock(ms) {
    const t = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  const untilText = (ts) => (ts > Date.now() ? `za ${fmtDur(ts - Date.now())}` : 'upravo završava');

  // <time> that keeps itself fresh (see the ticker in boot()).
  function timeEl(ts, mode = 'ago', prefix = '') {
    const text = mode === 'until' ? untilText(ts) : relTime(ts);
    return html`<time datetime="${new Date(ts).toISOString()}" data-ts="${ts}" data-mode="${mode}" data-prefix="${prefix}" data-tip="${fullDate(ts)}" tabindex="0">${prefix}${text}</time>`;
  }

  function initials(name) {
    const words = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
  }
  function avatar(url, name, cls = '') {
    const u = safeUrl(url);
    const ini = initials(name);
    return u
      ? html`<img class="avatar ${cls}" src="${u}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${ini}">`
      : html`<span class="avatar ${cls}" aria-hidden="true">${ini}</span>`;
  }
  const icon = (name, cls = '') => html`<i class="ti ${name} ${cls}" aria-hidden="true"></i>`;
  const extArrow = raw('<span class="ext" aria-hidden="true">↗</span>');
  const extLink = (url, label, cls = 'ext-link') => {
    const u = safeUrl(url);
    return u ? html`<a class="${cls}" href="${u}" target="_blank" rel="noopener noreferrer">${label} ${extArrow}</a>` : '';
  };
  const statusBadge = (on, onText = 'Uključeno', offText = 'Isključeno') => (on
    ? html`<span class="badge badge-success">${icon('ti-circle-check')}${onText}</span>`
    : html`<span class="badge">${icon('ti-circle-off')}${offText}</span>`);
  const roleDot = (color) => {
    const c = safeColor(color);
    return c ? html`<span class="dot" style="background:${c}"></span>` : html`<span class="dot"></span>`;
  };

  /* =====================================================================
   * 3. API
   * ===================================================================== */

  class ApiError extends Error {
    constructor(message, status, data) { super(message); this.status = status; this.data = data; }
  }
  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      opts.headers['X-Dashboard'] = '1';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body ?? {});
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new ApiError('Nema veze sa serverom. Provjeri internetsku vezu i pokušaj ponovno.', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401) {
      renderSignIn(data);
      throw new ApiError('Sesija je istekla. Prijavi se ponovno.', 401, data);
    }
    if (!res.ok) {
      const msg = (data && typeof data.error === 'string' && data.error) || `Zahtjev nije uspio (greška ${res.status}). Pokušaj ponovno.`;
      throw new ApiError(msg, res.status, data);
    }
    return data || {};
  }
  const g$ = (gid, rest = '') => `/api/guilds/${encodeURIComponent(gid)}${rest}`;

  function reportError(err, title = 'Nije uspjelo') {
    if (err && err.status === 401) return;
    toast('error', title, err && err.message ? err.message : String(err));
  }

  /* =====================================================================
   * 4. UI primitives: loading bar, toasts, tooltips, busy buttons, modals
   * ===================================================================== */

  let loadCount = 0;
  function loadStart() {
    const bar = $('#loadbar');
    if (!bar) return;
    if (loadCount++ === 0) {
      bar.classList.remove('is-active', 'is-done');
      void bar.offsetWidth;
      bar.classList.add('is-active');
    }
  }
  function loadEnd() {
    const bar = $('#loadbar');
    if (!bar || loadCount === 0) return;
    if (--loadCount === 0) { bar.classList.remove('is-active'); bar.classList.add('is-done'); }
  }

  const TOAST_ICONS = { success: 'ti-circle-check', error: 'ti-circle-x', info: 'ti-info-circle' };
  function toast(type, title, sub) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    if (type === 'error') el.setAttribute('role', 'alert');
    mount(el, html`${icon(TOAST_ICONS[type] || TOAST_ICONS.info)}
      <div class="toast-text"><p class="toast-title">${title}</p>${sub ? html`<p class="toast-sub">${sub}</p>` : ''}</div>
      <button type="button" class="btn-icon" aria-label="Zatvori obavijest" data-tip="Zatvori">${icon('ti-x')}</button>`);
    el.querySelector('button').addEventListener('click', () => el.remove());
    box.append(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    if (type !== 'error') setTimeout(() => el.remove(), 5000);
  }

  // Tooltips: any element with data-tip. 300 ms delay, caret, hidden on touch.
  let tipTimer = 0, tipTarget = null, lastTouch = 0;
  function showTip(t) {
    const tip = $('#tooltip');
    if (!tip || !t.isConnected || !t.dataset.tip) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    tip.classList.remove('is-below');
    const r = t.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = clamp(left, 8, window.innerWidth - tw - 8);
    let top = r.top - th - 8;
    if (top < 8) { top = r.bottom + 8; tip.classList.add('is-below'); }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.setProperty('--caret-x', `${clamp(r.left + r.width / 2 - left, 8, tw - 8)}px`);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipTarget = null;
    const tip = $('#tooltip');
    if (tip) tip.hidden = true;
  }
  function initTooltips() {
    document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') lastTouch = Date.now(); hideTip(); }, true);
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t === tipTarget) return;
      hideTip();
      if (!t || Date.now() - lastTouch < 800) return;
      tipTarget = t;
      tipTimer = setTimeout(() => showTip(t), 300);
    });
    document.addEventListener('mouseout', (e) => {
      if (tipTarget && !(e.relatedTarget && tipTarget.contains(e.relatedTarget))) hideTip();
    });
    document.addEventListener('focusin', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      hideTip();
      if (t && t.matches(':focus-visible')) { tipTarget = t; tipTimer = setTimeout(() => showTip(t), 300); }
    });
    document.addEventListener('focusout', hideTip);
    window.addEventListener('scroll', hideTip, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  }

  // Replaces a button's label with a spinner while fn runs (width preserved).
  async function withBusy(btn, fn) {
    if (!btn) return fn();
    if (btn.classList.contains('is-loading')) return undefined;
    const kids = Array.from(btn.childNodes);
    const width = btn.getBoundingClientRect().width;
    btn.style.width = `${width}px`;
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    const sp = document.createElement('span');
    sp.className = 'spinner';
    sp.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'Učitavanje';
    btn.replaceChildren(sp, sr);
    try {
      return await fn();
    } finally {
      btn.replaceChildren(...kids);
      btn.style.width = '';
      btn.classList.remove('is-loading');
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
  // withBusy + error toast. Resolves to true on success.
  async function run(btn, fn, errTitle) {
    try {
      await withBusy(btn, fn);
      return true;
    } catch (err) {
      reportError(err, errTitle);
      return false;
    }
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /**
   * Modal dialog. Escape / backdrop close it except during submission; focus is
   * trapped and returned to the opener on close.
   */
  function openModal(o) {
    const opener = document.activeElement;
    const root = $('#modal-root');
    const id = uid('m');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    mount(back, html`<form class="modal ${o.size === 'md' ? 'modal-md' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t" ${o.description ? html`aria-describedby="${id}-d"` : ''} novalidate>
        <div class="modal-head"><h2 id="${id}-t">${o.title}</h2>${o.description ? html`<p id="${id}-d">${o.description}</p>` : ''}</div>
        <button type="button" class="btn-icon modal-close" data-m="close" aria-label="Zatvori" data-tip="Zatvori">${icon('ti-x')}</button>
        ${o.body ? html`<div class="modal-body">${o.body}</div>` : ''}
        <div class="modal-foot">
          <button type="button" class="btn" data-m="close">${o.cancelLabel || 'Odustani'}</button>
          ${o.confirmLabel ? html`<button type="submit" class="btn btn-${o.variant || 'primary'}">${o.confirmLabel}</button>` : ''}
        </div>
      </form>`);
    const form = back.firstElementChild;
    const submit = form.querySelector('[type="submit"]');
    let busy = false, closed = false, confirmed = false;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function close() {
      if (busy || closed) return;
      closed = true;
      back.remove();
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey, true);
      hideTip();
      if (o.onClose) o.onClose(confirmed);
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    }
    function onKey(e) {
      if (!back.isConnected) return;
      if (e.key === 'Escape') {
        if (form.querySelector('.select.is-open')) return; // select closes itself first
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        const items = $$(FOCUSABLE, form).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    back.addEventListener('mousedown', (e) => { if (e.target === back) back.dataset.down = '1'; });
    back.addEventListener('click', (e) => {
      if (e.target === back && back.dataset.down === '1') close();
      back.dataset.down = '';
      const c = e.target.closest('[data-m="close"]');
      if (c) close();
    });
    document.addEventListener('keydown', onKey, true);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy || !submit || submit.disabled) return;
      if (!o.onConfirm) { confirmed = true; close(); return; }
      busy = true;
      $$('[data-m="close"]', form).forEach((b) => { b.disabled = true; });
      let ok = false;
      try {
        ok = await withBusy(submit, () => o.onConfirm(form, { close }));
      } catch (err) {
        reportError(err);
        ok = false;
      }
      busy = false;
      $$('[data-m="close"]', form).forEach((b) => { b.disabled = false; });
      if (ok !== false) { confirmed = true; close(); }
    });
    root.append(back);
    if (o.onOpen) o.onOpen(form);
    const first = (o.initialFocus && form.querySelector(o.initialFocus)) || form.querySelector('.modal-body ' + FOCUSABLE) || submit || form.querySelector('[data-m="close"]');
    if (first) first.focus();
    return { close, form };
  }

  // Destructive (or important) confirmation. Optional type-to-confirm.
  function confirmAction({ title, text, confirmLabel, danger = true, typeToConfirm, onConfirm }) {
    const inputId = uid('c');
    const body = typeToConfirm
      ? html`<div class="field"><label class="label" for="${inputId}">Za potvrdu upiši <span class="mono">${typeToConfirm}</span></label>
          <input class="input" id="${inputId}" autocomplete="off" spellcheck="false" data-confirm-input></div>`
      : '';
    return openModal({
      title, description: text, body, confirmLabel,
      variant: danger ? 'danger' : 'primary',
      initialFocus: typeToConfirm ? '[data-confirm-input]' : '.modal-foot [data-m="close"]',
      onOpen(form) {
        if (!typeToConfirm) return;
        const input = form.querySelector('[data-confirm-input]');
        const btn = form.querySelector('[type="submit"]');
        const sync = () => { btn.disabled = input.value.trim() !== typeToConfirm; };
        input.addEventListener('input', sync);
        sync();
      },
      onConfirm,
    });
  }

  /* =====================================================================
   * 5. Form helpers and the custom select (listbox) component
   * ===================================================================== */

  function field({ name, label, id, required, help, control, hidden }) {
    return html`<div class="field" data-field="${name}" ${hidden ? raw('hidden') : ''}>
      <label class="label" for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      ${control}
      ${help ? html`<p class="help" id="${id}-help">${help}</p>` : ''}
    </div>`;
  }
  function clearErrors(form) {
    $$('.err-msg', form).forEach((e) => e.remove());
    $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
    $$('.select.is-invalid', form).forEach((e) => e.classList.remove('is-invalid'));
    $$('.field .help[data-hidden-by-error]', form).forEach((h) => { h.hidden = false; h.removeAttribute('data-hidden-by-error'); });
  }
  function fieldError(form, name, msg) {
    const f = form.querySelector(`[data-field="${name}"]`);
    if (!f) { toast('error', msg); return false; }
    const control = f.querySelector('.select-trigger, textarea, input:not([type="hidden"])');
    const sel = f.querySelector('.select');
    if (sel) sel.classList.add('is-invalid');
    const errId = uid('e');
    const p = document.createElement('p');
    p.className = 'err-msg';
    p.id = errId;
    mount(p, html`${icon('ti-alert-circle')}<span>${msg}</span>`);
    const help = f.querySelector(':scope > .help');
    if (help) { help.hidden = true; help.setAttribute('data-hidden-by-error', ''); }
    f.append(p);
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', errId);
      if (!form.querySelector('[aria-invalid="true"]:focus')) control.focus();
    }
    return false;
  }
  const formValue = (form, name) => {
    const el = form.elements[name];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  };
  const multiValue = (form, name) => String(formValue(form, name) || '').split(',').filter(Boolean);

  /**
   * Custom select following the spec (menu panel, check on selected, search > 10 options).
   * options: [{ value, label, group?, lead?: Safe, desc?, disabled? }]
   * The value lives in a hidden input so forms can be read normally.
   */
  function selectField(o) {
    const vals = new Set((o.multiple ? (o.value || []) : (o.value != null && o.value !== '' ? [o.value] : [])).map(String));
    const searchable = o.searchable ?? o.options.length > 10;
    let lastGroup;
    const items = [];
    for (const opt of o.options) {
      if (opt.group !== undefined && opt.group !== lastGroup) {
        lastGroup = opt.group;
        if (opt.group) items.push(html`<li class="opt-group" role="presentation" data-group>${opt.group}</li>`);
      }
      const sel = vals.has(String(opt.value));
      items.push(html`<li class="opt" role="option" tabindex="-1" data-value="${opt.value}" data-label="${opt.label}" aria-selected="${String(sel)}" ${opt.disabled ? raw('aria-disabled="true"') : ''}>${o.multiple ? html`<span class="cbx" aria-hidden="true">${icon('ti-check')}</span>` : ''}${opt.lead || ''}<span class="opt-text"><span class="truncate" style="display:block">${opt.label}</span>${opt.desc ? html`<span class="opt-desc">${opt.desc}</span>` : ''}</span>${o.multiple ? '' : icon('ti-check', 'opt-check ti-sm')}</li>`);
    }
    return html`<div class="select" data-select ${o.multiple ? raw('data-multiple') : ''} data-placeholder="${o.placeholder || 'Odaberi'}">
      <input type="hidden" name="${o.name}" value="${Array.from(vals).join(',')}">
      <button type="button" class="select-trigger" id="${o.id}" aria-haspopup="listbox" aria-expanded="false" ${o.describedBy ? html`aria-describedby="${o.describedBy}"` : ''} ${o.disabled ? raw('disabled') : ''}><span class="select-value"></span>${icon('ti-chevron-down')}</button>
      <div class="select-menu" hidden>
        ${searchable ? html`<div class="select-search">${icon('ti-search')}<input type="text" placeholder="Pretraži" aria-label="Pretraži opcije" autocomplete="off" spellcheck="false"></div>` : ''}
        <ul role="listbox" ${o.multiple ? raw('aria-multiselectable="true"') : ''} aria-label="${o.ariaLabel || o.placeholder || 'Opcije'}">${items}</ul>
        <p class="select-empty" ${o.options.length ? raw('hidden') : ''}>${o.options.length ? 'Nema rezultata.' : (o.emptyText || 'Nema opcija.')}</p>
      </div>
    </div>${o.multiple ? html`<div class="select-chips chips" data-chips></div>` : ''}`;
  }

  function refreshSelect(sel) {
    const multiple = sel.hasAttribute('data-multiple');
    const chosen = $$('.opt[aria-selected="true"]', sel);
    const valEl = $('.select-value', sel);
    const hidden = $('input[type="hidden"]', sel);
    hidden.value = chosen.map((o) => o.dataset.value).join(',');
    valEl.replaceChildren();
    valEl.className = 'select-value';
    if (!chosen.length) {
      valEl.classList.add('is-placeholder');
      valEl.textContent = sel.dataset.placeholder;
    } else if (multiple) {
      const span = document.createElement('span');
      span.className = 'truncate';
      span.textContent = chosen.length === 1 ? chosen[0].dataset.label : `${count(chosen.length, 'odabrana', 'odabrane', 'odabranih')}`;
      valEl.append(span);
    } else {
      const lead = chosen[0].querySelector('.dot, .avatar, .opt-lead');
      if (lead) valEl.append(lead.cloneNode(true));
      const span = document.createElement('span');
      span.className = 'truncate';
      span.textContent = chosen[0].dataset.label;
      valEl.append(span);
    }
    if (multiple) {
      const chips = sel.nextElementSibling && sel.nextElementSibling.matches('[data-chips]') ? sel.nextElementSibling : null;
      if (chips) {
        chips.replaceChildren(...chosen.map((o) => {
          const tag = document.createElement('span');
          tag.className = 'tag';
          const lead = o.querySelector('.dot');
          if (lead) tag.append(lead.cloneNode(true));
          const label = document.createElement('span');
          label.className = 'truncate';
          label.textContent = o.dataset.label;
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'btn-icon tag-x';
          x.dataset.chipRemove = o.dataset.value;
          x.setAttribute('aria-label', `Ukloni ${o.dataset.label}`);
          x.dataset.tip = 'Ukloni';
          const xi = document.createElement('i');
          xi.className = 'ti ti-x';
          xi.setAttribute('aria-hidden', 'true');
          x.append(xi);
          tag.append(label, x);
          return tag;
        }));
      }
    }
  }
  function setSelectValue(sel, value) {
    const vals = new Set((Array.isArray(value) ? value : [value]).filter((v) => v != null && v !== '').map(String));
    $$('.opt', sel).forEach((o) => o.setAttribute('aria-selected', String(vals.has(o.dataset.value))));
    refreshSelect(sel);
  }
  const visibleOpts = (sel) => $$('.opt', sel).filter((o) => !o.hidden && o.getAttribute('aria-disabled') !== 'true');
  function openSelect(sel) {
    $$('.select.is-open').forEach((s) => { if (s !== sel) closeSelect(s); });
    const menu = $('.select-menu', sel);
    const trig = $('.select-trigger', sel);
    menu.hidden = false;
    sel.classList.add('is-open');
    trig.setAttribute('aria-expanded', 'true');
    const r = trig.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    menu.classList.toggle('is-up', below < 320 && r.top > below);
    const search = $('.select-search input', sel);
    if (search) { search.value = ''; filterSelect(sel, ''); search.focus(); return; }
    const target = $$('.opt[aria-selected="true"]', sel).find((o) => o.getAttribute('aria-disabled') !== 'true') || visibleOpts(sel)[0];
    if (target) target.focus();
  }
  function closeSelect(sel, focusTrigger) {
    const menu = $('.select-menu', sel);
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    sel.classList.remove('is-open');
    const trig = $('.select-trigger', sel);
    trig.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trig.focus();
  }
  function filterSelect(sel, q) {
    const needle = q.trim().toLowerCase();
    let any = false;
    $$('.opt', sel).forEach((o) => {
      const show = !needle || o.dataset.label.toLowerCase().includes(needle);
      o.hidden = !show;
      if (show) any = true;
    });
    $$('.opt-group', sel).forEach((g) => {
      let n = g.nextElementSibling, has = false;
      while (n && !n.matches('.opt-group')) { if (!n.hidden) has = true; n = n.nextElementSibling; }
      g.hidden = !has;
    });
    const empty = $('.select-empty', sel);
    if (empty) empty.hidden = any;
  }
  function chooseOpt(opt) {
    if (opt.getAttribute('aria-disabled') === 'true') return;
    const sel = opt.closest('.select');
    if (sel.hasAttribute('data-multiple')) {
      opt.setAttribute('aria-selected', String(opt.getAttribute('aria-selected') !== 'true'));
    } else {
      $$('.opt', sel).forEach((o) => o.setAttribute('aria-selected', 'false'));
      opt.setAttribute('aria-selected', 'true');
      closeSelect(sel, true);
    }
    refreshSelect(sel);
    sel.classList.remove('is-invalid');
    $('input[type="hidden"]', sel).dispatchEvent(new Event('change', { bubbles: true }));
  }
  function initSelects() {
    document.addEventListener('click', (e) => {
      const trig = e.target.closest('.select-trigger');
      if (trig) {
        const sel = trig.closest('.select');
        if (sel.classList.contains('is-open')) closeSelect(sel); else openSelect(sel);
        return;
      }
      const opt = e.target.closest('.opt');
      if (opt) { chooseOpt(opt); return; }
      const x = e.target.closest('[data-chip-remove]');
      if (x) {
        const chips = x.closest('[data-chips]');
        const sel = chips.previousElementSibling;
        const o = $$('.opt', sel).find((el) => el.dataset.value === x.dataset.chipRemove);
        if (o) {
          o.setAttribute('aria-selected', 'false');
          refreshSelect(sel);
          $('input[type="hidden"]', sel).dispatchEvent(new Event('change', { bubbles: true }));
          $('.select-trigger', sel).focus();
        }
        return;
      }
      if (!e.target.closest('.select-menu')) $$('.select.is-open').forEach((s) => closeSelect(s));
    });
    document.addEventListener('input', (e) => {
      if (e.target.matches('.select-search input')) filterSelect(e.target.closest('.select'), e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      const sel = e.target.closest && e.target.closest('.select');
      if (!sel) return;
      const isTrig = e.target.matches('.select-trigger');
      const open = sel.classList.contains('is-open');
      if (isTrig && !open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openSelect(sel);
        return;
      }
      if (!open) return;
      const opts = visibleOpts(sel);
      const idx = opts.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSelect(sel, true); }
      else if (e.key === 'Tab') closeSelect(sel);
      else if (e.key === 'ArrowDown') { e.preventDefault(); (opts[idx + 1] || opts[0])?.focus(); }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx <= 0 && $('.select-search input', sel)) $('.select-search input', sel).focus();
        else (opts[idx - 1] || opts[opts.length - 1])?.focus();
      }
      else if (e.key === 'Home' && idx >= 0) { e.preventDefault(); opts[0]?.focus(); }
      else if (e.key === 'End' && idx >= 0) { e.preventDefault(); opts[opts.length - 1]?.focus(); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.opt')) { e.preventDefault(); chooseOpt(e.target); }
      else if (e.key === 'Enter' && e.target.matches('.select-search input')) { e.preventDefault(); if (opts[0]) chooseOpt(opts[0]); }
    });
  }

  // Simple dropdown menus (server switcher, member search results)
  function initMenus() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-menu-btn]');
      if (btn) {
        const menu = document.getElementById(btn.getAttribute('aria-controls'));
        const open = btn.getAttribute('aria-expanded') !== 'true';
        closeMenus();
        if (open && menu) {
          menu.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          const first = $('.menu-item[aria-current="true"]', menu) || $('.menu-item', menu);
          if (first) first.focus();
        }
        return;
      }
      if (!e.target.closest('.menu')) closeMenus();
    });
    document.addEventListener('keydown', (e) => {
      const menu = e.target.closest && e.target.closest('.menu');
      if (!menu) return;
      const items = $$('.menu-item', menu);
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0])?.focus(); }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (i <= 0 && menu.dataset.input) document.getElementById(menu.dataset.input)?.focus();
        else (items[i - 1] || items[items.length - 1])?.focus();
      }
      else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const owner = document.querySelector(`[aria-controls="${menu.id}"]`);
        closeMenus();
        owner?.focus();
      }
    });
  }
  function closeMenus() {
    $$('[data-menu-btn][aria-expanded="true"]').forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
      const m = document.getElementById(b.getAttribute('aria-controls'));
      if (m) m.hidden = true;
    });
  }

  function hydrate(root) {
    $$('[data-select]', root).forEach(refreshSelect);
  }

  /* =====================================================================
   * 6. Global event delegation
   * ===================================================================== */

  const actions = Object.create(null);
  const forms = Object.create(null);
  const inputs = Object.create(null);

  function initDelegation() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const fn = actions[el.dataset.action];
      if (fn) { e.preventDefault(); fn(el, e); }
    });
    document.addEventListener('submit', (e) => {
      const f = e.target.closest('form[data-form]');
      if (!f) return;
      e.preventDefault();
      const fn = forms[f.dataset.form];
      if (fn) fn(f, e.submitter || f.querySelector('[type="submit"]'));
    });
    const onInput = (e) => {
      const f = e.target.closest && e.target.closest('form[data-form]');
      if (f && inputs[f.dataset.form]) inputs[f.dataset.form](f, e);
      if (e.target.matches && e.target.matches('[aria-invalid="true"]') && e.type === 'input') {
        e.target.removeAttribute('aria-invalid');
        const fieldEl = e.target.closest('.field');
        if (fieldEl) {
          $$('.err-msg', fieldEl).forEach((x) => x.remove());
          $$('.help[data-hidden-by-error]', fieldEl).forEach((h) => { h.hidden = false; h.removeAttribute('data-hidden-by-error'); });
        }
      }
    };
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    // Copy buttons for identifiers
    actions.copy = async (btn) => {
      const text = btn.dataset.copy || '';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        ta.remove();
      }
      const prev = btn.dataset.tip;
      btn.dataset.tip = 'Kopirano';
      tipTarget = btn;
      showTip(btn);
      setTimeout(() => { btn.dataset.tip = prev; if (tipTarget === btn) hideTip(); }, 2000);
    };
  }
  const copyBtn = (value, label = 'Kopiraj ID') => html`<button type="button" class="btn-icon" data-action="copy" data-copy="${value}" aria-label="${label}" data-tip="${label}">${icon('ti-copy')}</button>`;
  const idRow = (value, label = 'Kopiraj ID') => html`<span class="id-row"><span class="mono">${value}</span>${copyBtn(value, label)}</span>`;

  /* =====================================================================
   * 7. App state, shell and router
   * ===================================================================== */

  const state = {
    me: null,
    guildCache: new Map(), // gid -> { at, data }
    navToken: 0,
    cleanups: [],
    page: {},
    firstNav: true,
  };

  const NAV = [
    { group: 'Server', items: [
      { key: 'overview', label: 'Pregled', icon: 'ti-layout-dashboard' },
      { key: 'welcome', label: 'Dobrodošlica i role', icon: 'ti-user-plus' },
      { key: 'invites', label: 'Invite-ovi', icon: 'ti-user-share' },
      { key: 'stats', label: 'Statistika', icon: 'ti-chart-bar' },
    ] },
    { group: 'Alati', items: [
      { key: 'tickets', label: 'Tiketi', icon: 'ti-ticket' },
      { key: 'reactionroles', label: 'Reaction role', icon: 'ti-mood-smile' },
      { key: 'giveaways', label: 'Giveaway', icon: 'ti-gift' },
      { key: 'music', label: 'Glazba', icon: 'ti-music' },
    ] },
  ];
  const PAGE_KEYS = NAV.flatMap((g) => g.items.map((i) => i.key));
  const pageLabel = (key) => NAV.flatMap((g) => g.items).find((i) => i.key === key)?.label || '';

  function parseRoute() {
    const h = location.hash.replace(/^#/, '');
    const m = h.match(/^\/g\/([^/]+)(?:\/([^/?]+))?/);
    if (m) {
      const page = PAGE_KEYS.includes(m[2]) ? m[2] : 'overview';
      return { name: 'guild', gid: decodeURIComponent(m[1]), page };
    }
    return { name: 'home' };
  }
  const guildHref = (gid, page = 'overview') => `#/g/${encodeURIComponent(gid)}/${page}`;

  async function guildData(gid, force = false) {
    const c = state.guildCache.get(gid);
    if (!force && c && Date.now() - c.at < 60_000) return c.data;
    const data = await api('GET', g$(gid));
    state.guildCache.set(gid, { at: Date.now(), data });
    return data;
  }
  const invalidateGuild = (gid) => state.guildCache.delete(gid);

  function renderSignIn(data) {
    runCleanups();
    state.me = null;
    $$('.modal-backdrop').forEach((m) => m.remove());
    document.body.style.overflow = '';
    const bot = (data && data.bot) || {};
    const name = bot.name || 'Jaankeza Utils';
    document.title = `Prijava · ${name}`;
    const app = $('#app');
    app.removeAttribute('aria-busy');
    mount(app, html`<main class="signin">
      <div class="signin-box">
        ${avatar(bot.avatarUrl, name, 'avatar-xl')}
        <h1>${name}</h1>
        <p>Prijavi se Discord računom da upravljaš serverima na kojima je bot.</p>
        <a class="btn btn-primary" href="/login">${icon('ti-brand-discord')}Prijavi se s Discordom</a>
      </div>
    </main>`);
  }

  function renderFatal(err) {
    const app = $('#app');
    app.removeAttribute('aria-busy');
    mount(app, html`<main class="signin"><div class="signin-box">
      ${icon('ti-circle-x', 'faint')}
      <h1>Nadzorna ploča se ne može učitati</h1>
      <p>${err.message} Provjeri radi li bot pa pokušaj ponovno.</p>
      <button type="button" class="btn" data-action="reload">Pokušaj ponovno</button>
    </div></main>`);
  }
  actions.reload = () => location.reload();

  function renderShellFrame() {
    const app = $('#app');
    app.removeAttribute('aria-busy');
    mount(app, html`<div class="shell">
      <aside class="sidebar" id="sidebar" aria-label="Izbornik"></aside>
      <div class="scrim" id="scrim" data-action="drawer-close"></div>
      <header class="topbar">
        <button type="button" class="btn-icon" id="menu-btn" data-action="drawer-open" aria-label="Otvori izbornik" data-tip="Izbornik" aria-controls="sidebar" aria-expanded="false">${icon('ti-menu-2')}</button>
        <div class="topbar-title" id="topbar-title"></div>
      </header>
      <main class="main" id="main"><div class="content" id="content"></div></main>
    </div>`);
  }

  function renderSidebar(route) {
    const { me } = state;
    const guild = route.name === 'guild' ? me.guilds.find((g) => g.id === route.gid) : null;
    const menuId = 'server-menu';
    const page = route.page || 'overview';
    const switcher = html`<div class="switcher-wrap">
      <button type="button" class="switcher" data-menu-btn aria-haspopup="true" aria-expanded="false" aria-controls="${menuId}">
        ${guild ? avatar(guild.iconUrl, guild.name, 'avatar-sm avatar-guild') : html`<span class="avatar avatar-sm avatar-guild" aria-hidden="true">${icon('ti-server', 'ti-sm')}</span>`}
        <span class="switcher-name truncate">${guild ? guild.name : 'Odaberi server'}</span>
        ${icon('ti-selector')}
      </button>
      <div class="menu" id="${menuId}" hidden>
        ${me.guilds.map((g) => html`<a class="menu-item" href="${guildHref(g.id, route.name === 'guild' ? page : 'overview')}" ${guild && g.id === guild.id ? raw('aria-current="true"') : ''}>
          ${avatar(g.iconUrl, g.name, 'avatar-sm avatar-guild')}<span class="truncate">${g.name}</span>${guild && g.id === guild.id ? icon('ti-check', 'menu-check') : ''}</a>`)}
        ${me.guilds.length > 1 ? html`<a class="menu-item" href="#/">${icon('ti-list')}Svi serveri</a>` : ''}
        ${safeUrl(me.bot && me.bot.inviteUrl) ? html`<a class="menu-item" href="${safeUrl(me.bot.inviteUrl)}" target="_blank" rel="noopener noreferrer">${icon('ti-plus')}Dodaj bota na server ${extArrow}</a>` : ''}
      </div>
    </div>`;
    const nav = guild
      ? NAV.map((grp) => html`<p class="nav-group-label">${grp.group}</p><div class="nav">${grp.items.map((it) => html`<a class="nav-row" href="${guildHref(guild.id, it.key)}" ${it.key === page ? raw('aria-current="page"') : ''}>${icon(it.icon)}<span class="truncate">${it.label}</span></a>`)}</div>`)
      : html`<div class="nav"><a class="nav-row" href="#/" aria-current="page">${icon('ti-server')}Serveri</a></div>`;
    const u = me.user;
    mount($('#sidebar'), html`
      <div class="side-top">${switcher}
        <button type="button" class="btn-icon drawer-close" data-action="drawer-close" aria-label="Zatvori izbornik" data-tip="Zatvori">${icon('ti-x')}</button>
      </div>
      <nav class="side-scroll" aria-label="Stranice">${nav}</nav>
      <div class="side-foot">
        <div class="user-row">${avatar(u.avatarUrl, u.displayName || u.username)}
          <div class="truncate"><div class="user-name truncate">${u.displayName || u.username}</div><div class="user-sub truncate">@${u.username}</div></div>
        </div>
        <button type="button" class="nav-row" data-action="appearance">${icon('ti-palette')}Izgled</button>
        <a class="nav-row" href="/logout">${icon('ti-logout')}Odjava</a>
      </div>`);
    mount($('#topbar-title'), guild
      ? html`${avatar(guild.iconUrl, guild.name, 'avatar-sm avatar-guild')}<span class="truncate">${guild.name}</span>`
      : html`${avatar(me.bot && me.bot.avatarUrl, (me.bot && me.bot.name) || 'Jaankeza Utils', 'avatar-sm')}<span class="truncate">${(me.bot && me.bot.name) || 'Jaankeza Utils'}</span>`);
  }

  function openDrawer() {
    const sb = $('#sidebar');
    sb.classList.add('is-open');
    $('#scrim').classList.add('is-open');
    $('#menu-btn').setAttribute('aria-expanded', 'true');
    $('#main').inert = true;
    const first = $('.nav-row[aria-current="page"]', sb) || $(FOCUSABLE, sb);
    if (first) first.focus();
  }
  function closeDrawer(returnFocus) {
    const sb = $('#sidebar');
    if (!sb || !sb.classList.contains('is-open')) return;
    sb.classList.remove('is-open');
    $('#scrim').classList.remove('is-open');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
    $('#main').inert = false;
    if (returnFocus) $('#menu-btn').focus();
  }
  actions['drawer-open'] = openDrawer;
  actions['drawer-close'] = () => closeDrawer(true);

  function onCleanup(fn) { state.cleanups.push(fn); }
  function runCleanups() {
    const list = state.cleanups.splice(0);
    list.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }

  function pageHead(title, sub, actionsHtml) {
    return html`<header class="page-head">
      <div><h1 tabindex="-1">${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>
      ${actionsHtml ? html`<div class="page-actions">${actionsHtml}</div>` : ''}
    </header>`;
  }
  const skelCard = (h = 160) => html`<div class="skel skel-card" style="height:${h}px"></div>`;
  const skelRows = (n = 4) => html`<div class="list">${Array.from({ length: n }, () => html`<div class="skel skel-row"></div>`)}</div>`;
  function errorState(err, retryAction = 'retry-page') {
    return html`<div class="error-state" role="alert">${icon('ti-circle-x')}
      <div class="error-text"><strong>Podaci se nisu učitali.</strong>${err && err.message ? err.message : 'Pokušaj ponovno.'}</div>
      <button type="button" class="btn" data-action="${retryAction}">${icon('ti-refresh')}Pokušaj ponovno</button>
    </div>`;
  }
  const emptyState = (iconName, text, actionHtml) => html`<div class="empty">${iconName ? icon(iconName) : ''}<p>${text}</p>${actionHtml || ''}</div>`;
  actions['retry-page'] = () => router();

  function makeCtx(route, token) {
    const el = $('#content');
    const ctx = {
      ...route,
      el,
      head: html``,
      alive: () => token === state.navToken,
      // Runs a loader; on failure shows a page-level error state with retry.
      async load(fn) {
        loadStart();
        try {
          const v = await fn();
          return ctx.alive() ? v : null;
        } catch (err) {
          if (ctx.alive() && err.status !== 401) {
            mount(el, html`${ctx.head}<section class="card">${errorState(err)}</section>`);
          }
          return null;
        } finally {
          loadEnd();
        }
      },
    };
    return ctx;
  }

  async function router() {
    if (!state.me) return;
    const token = ++state.navToken;
    runCleanups();
    closeMenus();
    closeDrawer(false);
    hideTip();
    state.page = {};
    const route = parseRoute();
    if (route.name === 'home' && state.me.guilds.length === 1) {
      location.replace(guildHref(state.me.guilds[0].id));
      return;
    }
    renderSidebar(route);
    const ctx = makeCtx(route, token);
    const botName = (state.me.bot && state.me.bot.name) || 'Jaankeza Utils';
    if (route.name === 'home') {
      document.title = `Serveri · ${botName}`;
      pageHome(ctx);
    } else {
      const guild = state.me.guilds.find((g) => g.id === route.gid);
      if (!guild) {
        document.title = `Server nije dostupan · ${botName}`;
        mount(ctx.el, html`${pageHead('Server nije dostupan')}<section class="card">${emptyState('ti-lock', 'Nemaš dopuštenje Upravljanje serverom na ovom serveru ili bot nije na njemu.', html`<a class="btn" href="#/">Prikaži servere</a>`)}</section>`);
      } else {
        ctx.guild = guild;
        document.title = `${pageLabel(route.page)} · ${guild.name} · ${botName}`;
        PAGES[route.page](ctx);
      }
    }
    if (!state.firstNav) {
      const h1 = $('#content h1');
      if (h1) h1.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    state.firstNav = false;
  }

  /* =====================================================================
   * 8. Option builders shared by pages
   * ===================================================================== */

  function groupedOptions(list, map) {
    const groups = new Map();
    for (const item of list) {
      const key = item.parentName || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const out = [];
    const keys = Array.from(groups.keys()).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
    for (const k of keys) for (const item of groups.get(k)) out.push({ ...map(item), group: k });
    return out;
  }
  const textChannelOptions = (g) => groupedOptions(g.channels.text || [], (c) => ({ value: c.id, label: `#${c.name}` }));
  const voiceChannelOptions = (g) => groupedOptions(g.channels.voice || [], (c) => ({ value: c.id, label: c.name, lead: icon('ti-volume', 'ti-sm opt-lead') }));
  const categoryOptions = (g) => (g.channels.categories || []).map((c) => ({ value: c.id, label: c.name }));
  function roleOptions(g, { assignableOnly = false } = {}) {
    return (g.roles || []).map((r) => ({
      value: r.id,
      label: r.name,
      lead: roleDot(r.color),
      disabled: assignableOnly && !r.assignable,
      desc: assignableOnly && !r.assignable ? 'Bot ne može dodijeliti ovu rolu' : '',
    }));
  }
  const channelName = (g, id) => {
    const c = [...(g.channels.text || []), ...(g.channels.voice || [])].find((x) => x.id === id);
    return c ? c.name : null;
  };
  const roleById = (g, id) => (g.roles || []).find((r) => r.id === id);

  /* =====================================================================
   * 9. Pages
   * ===================================================================== */

  // ---------- Server picker ----------
  function pageHome(ctx) {
    const { guilds, bot } = state.me;
    const invite = safeUrl(bot && bot.inviteUrl);
    const botCard = html`<aside class="card">
      <div class="card-head"><div class="who">${avatar(bot && bot.avatarUrl, (bot && bot.name) || 'Jaankeza Utils', 'avatar-lg')}
        <div style="min-width:0"><h2 class="card-title">${(bot && bot.name) || 'Jaankeza Utils'}</h2><p class="card-desc">Bot za upravljanje serverom</p></div></div>
        <span class="badge badge-success">${icon('ti-circle-check')}Na mreži</span>
      </div>
      <dl class="kv-grid">
        <div class="kv"><dt>Ping</dt><dd class="num">${bot && bot.ping != null ? `${fmtNum(bot.ping)} ms` : '-'}</dd></div>
        <div class="kv"><dt>Radi već</dt><dd class="num">${bot && bot.uptimeMs != null ? fmtDur(bot.uptimeMs) : '-'}</dd></div>
        <div class="kv"><dt>Serveri</dt><dd class="num">${fmtNum(guilds.length)}</dd></div>
      </dl>
      ${invite && guilds.length ? html`<div class="form-actions"><a class="btn" href="${invite}" target="_blank" rel="noopener noreferrer">${icon('ti-plus')}Dodaj bota na server ${extArrow}</a></div>` : ''}
    </aside>`;
    if (!guilds.length) {
      mount(ctx.el, html`${pageHead('Serveri', 'Ovdje se pojavljuju serveri na kojima je bot i kojima možeš upravljati.')}
        <div class="cols cols-wide-left">
          <section class="card">${emptyState('ti-server-off', 'Bot još nije ni na jednom serveru kojim upravljaš. Dodaj ga na server, a zatim osvježi ovu stranicu.',
            html`<div class="btn-group">${invite ? html`<a class="btn btn-primary" href="${invite}" target="_blank" rel="noopener noreferrer">${icon('ti-plus')}Dodaj bota na server ${extArrow}</a>` : ''}<button type="button" class="btn" data-action="reload">Osvježi</button></div>`)}</section>
          ${botCard}
        </div>`);
      return;
    }
    mount(ctx.el, html`${pageHead('Serveri', 'Odaberi server kojim želiš upravljati.')}
      <div class="cols cols-wide-left">
        <ul class="list ${guilds.length > 6 ? 'is-grid' : ''}" aria-label="Serveri">
          ${guilds.map((g) => html`<li><a class="row" href="${guildHref(g.id)}">
            ${avatar(g.iconUrl, g.name, 'avatar-guild')}
            <span class="row-main"><span class="row-title truncate" style="display:block">${g.name}</span><span class="row-meta num">${count(g.memberCount, 'član', 'člana', 'članova')}</span></span>
            ${icon('ti-chevron-right', 'chev')}
          </a></li>`)}
        </ul>
        ${botCard}
      </div>`);
  }

  // ---------- Overview ----------
  const ACTIVITY_ICONS = {
    join: 'ti-user-plus', leave: 'ti-user-minus', boost: 'ti-rocket',
    ticket_open: 'ti-ticket', ticket_close: 'ti-ticket-off',
    giveaway_start: 'ti-gift', giveaway_end: 'ti-confetti', music: 'ti-music',
  };
  async function pageOverview(ctx) {
    ctx.head = pageHead('Pregled', ctx.guild.name);
    mount(ctx.el, html`${ctx.head}<div class="stats-row">${skelCard(128)}${skelCard(128)}</div><div class="cols">${skelCard(360)}${skelCard(360)}</div>`);
    const g = await ctx.load(() => guildData(ctx.gid, true));
    if (!g) return;
    state.page.g = g;
    drawOverview(ctx, g);
  }
  function drawOverview(ctx, g) {
    const c = g.config;
    const chan = (id) => { const n = id && channelName(g, id); return n ? `#${n}` : 'kanal nije odabran'; };
    const tierThresholds = [2, 7, 14];
    const next = tierThresholds[g.boostTier];
    const boostMeta = next != null
      ? `Razina ${g.boostTier} · još ${count(Math.max(0, next - g.boostCount), 'boost', 'boosta', 'boostova')} do razine ${g.boostTier + 1}`
      : `Razina ${g.boostTier} · najviša razina`;
    const modules = [
      { page: 'welcome', name: 'Poruka dobrodošlice', on: c.welcome.enabled, meta: c.welcome.enabled ? chan(c.welcome.channelId) : 'Novi članovi ne dobivaju poruku' },
      { page: 'welcome', name: 'Poruka za boost', on: c.boost.enabled, meta: c.boost.enabled ? chan(c.boost.channelId) : 'Boostovi se ne objavljuju' },
      { page: 'welcome', name: 'Automatske role', on: c.autoroles.length > 0, meta: c.autoroles.length ? count(c.autoroles.length, 'rola', 'role', 'rola') : 'Nema automatskih rola' },
      { page: 'stats', name: 'Kanali statistike', on: c.stats.enabled, meta: c.stats.enabled ? 'Članovi, botovi i boostovi' : 'Nisu postavljeni' },
      { page: 'tickets', name: 'Tiketi', on: c.tickets.enabled, meta: c.tickets.enabled ? count(c.tickets.openCount || 0, 'otvoren tiket', 'otvorena tiketa', 'otvorenih tiketa') : 'Članovi ne mogu otvoriti tiket' },
    ];
    const activity = g.activity || [];
    const showAll = state.page.showAllActivity;
    const shown = showAll ? activity : activity.slice(0, 10);
    const bot = state.me.bot || {};
    mount(ctx.el, html`${ctx.head}
      <div class="stats-row">
        <section class="card stat"><h2 class="stat-label">Članovi</h2><p class="stat-value">${fmtNum(g.memberCount)}</p>
          <p class="stat-meta num">${count(g.humanCount, 'čovjek', 'čovjeka', 'ljudi')} · ${count(g.botCount, 'bot', 'bota', 'botova')}</p></section>
        <section class="card stat"><h2 class="stat-label">Boostovi</h2><p class="stat-value">${fmtNum(g.boostCount)}</p>
          <p class="stat-meta num">${boostMeta}</p></section>
      </div>
      <div class="cols">
        <div class="stack">
          <section class="card" aria-labelledby="mod-h">
            <div class="card-head"><div><h2 class="card-title" id="mod-h">Moduli</h2><p class="card-desc">Postavke su na stranici svakog modula.</p></div></div>
            <ul class="plain-list">${modules.map((m) => html`<li><a class="li-link" href="${guildHref(g.id, m.page)}">
              <span class="row-main"><span class="row-title" style="display:block">${m.name}</span><span class="row-meta">${m.meta}</span></span>
              ${statusBadge(m.on)}${icon('ti-chevron-right', 'chev faint ti-sm')}</a></li>`)}</ul>
          </section>
          <section class="card" aria-labelledby="bot-h">
            <div class="card-head"><div><h2 class="card-title" id="bot-h">Server i bot</h2></div></div>
            <dl class="kv-grid">
              <div class="kv"><dt>Ping bota</dt><dd class="num">${bot.ping != null ? `${fmtNum(bot.ping)} ms` : '-'}</dd></div>
              <div class="kv"><dt>Bot radi</dt><dd class="num">${bot.uptimeMs != null ? fmtDur(bot.uptimeMs) : '-'}</dd></div>
              <div class="kv"><dt>Kanali</dt><dd class="num">${fmtNum((g.channels.text || []).length + (g.channels.voice || []).length)}</dd></div>
              <div class="kv"><dt>Role</dt><dd class="num">${fmtNum((g.roles || []).length)}</dd></div>
            </dl>
            <dl class="kv section-gap"><dt>ID servera</dt><dd>${idRow(g.id, 'Kopiraj ID servera')}</dd></dl>
          </section>
        </div>
        <section class="card" aria-labelledby="act-h">
          <div class="card-head"><div><h2 class="card-title" id="act-h">Nedavna aktivnost</h2></div>
            <div class="card-actions"><button type="button" class="btn-icon" data-action="overview-refresh" aria-label="Osvježi aktivnost" data-tip="Osvježi">${icon('ti-refresh')}</button></div></div>
          ${activity.length
            ? html`<ul class="plain-list activity">${shown.map((a) => html`<li>${icon(ACTIVITY_ICONS[a.type] || 'ti-point', 'activity-icon')}
                <span class="row-main">${a.text}</span>${timeEl(a.at)}</li>`)}</ul>
              ${activity.length > 10 ? html`<p class="section-gap"><button type="button" class="link-btn" data-action="overview-more">${showAll ? 'Prikaži manje' : `Prikaži sve (${activity.length})`}</button></p>` : ''}`
            : emptyState('ti-activity', 'Ovdje će se pojaviti ulasci, izlasci, boostovi, tiketi i ostala aktivnost na serveru.')}
        </section>
      </div>`);
  }
  actions['overview-more'] = () => {
    state.page.showAllActivity = !state.page.showAllActivity;
    const ctx = { el: $('#content'), head: pageHead('Pregled', state.page.g.name) };
    drawOverview(ctx, state.page.g);
  };
  actions['overview-refresh'] = async (btn) => {
    const g0 = state.page.g;
    if (!g0) return;
    await run(btn, async () => {
      const g = await guildData(g0.id, true);
      state.page.g = g;
      drawOverview({ el: $('#content'), head: pageHead('Pregled', g.name) }, g);
    }, 'Osvježavanje nije uspjelo');
  };

  // ---------- Welcome, boost, autoroles ----------
  const WELCOME_VARS = [
    ['{user}', 'Spominje novog člana'],
    ['{username}', 'Korisničko ime, bez spominjanja'],
    ['{server}', 'Ime servera'],
    ['{memberCount}', 'Broj članova servera'],
    ['{inviter}', 'Tko je pozvao člana'],
    ['{invites}', 'Koliko invite-ova ima pozivatelj'],
  ];
  const BOOST_VARS = [
    ['{user}', 'Spominje člana koji je boostao'],
    ['{username}', 'Korisničko ime, bez spominjanja'],
    ['{server}', 'Ime servera'],
    ['{boosts}', 'Ukupan broj boostova'],
    ['{level}', 'Razina boosta servera'],
  ];
  let welcomeTab = 'welcome';

  async function pageWelcome(ctx) {
    ctx.head = pageHead('Dobrodošlica i role', 'Poruke za nove članove i boostove te role koje novi članovi dobiju automatski.');
    mount(ctx.el, html`${ctx.head}<div class="skel" style="height:60px;margin-bottom:24px;border-radius:16px"></div><div class="cols cols-form-right">${skelCard(480)}${skelCard(320)}</div>`);
    const g = await ctx.load(() => guildData(ctx.gid));
    if (!g) return;
    state.page.g = g;
    state.page.ctx = ctx;
    drawWelcome();
  }
  function drawWelcome() {
    const { g, ctx } = state.page;
    const tabs = [['welcome', 'Dobrodošlica'], ['boost', 'Boost'], ['autoroles', 'Automatske role']];
    mount(ctx.el, html`${ctx.head}
      <div class="tabs" role="tablist" aria-label="Odjeljci">
        ${tabs.map(([k, l]) => html`<button type="button" class="tab" role="tab" id="tab-${k}" aria-controls="tabpanel" aria-selected="${String(k === welcomeTab)}" tabindex="${k === welcomeTab ? 0 : -1}" data-action="welcome-tab" data-tab="${k}">${l}</button>`)}
      </div>
      <div id="tabpanel" role="tabpanel" aria-labelledby="tab-${welcomeTab}">
        ${welcomeTab === 'autoroles' ? autorolesPanel(g) : messagePanel(g, welcomeTab)}
      </div>`);
    const f = $('form[data-form="msg"]', ctx.el);
    if (f) { updateMsgPreview(f); f.dataset.snap = msgSnapshot(f); }
    const af = $('form[data-form="autoroles"]', ctx.el);
    if (af) af.dataset.snap = formValue(af, 'roleIds');
  }
  actions['welcome-tab'] = (btn) => {
    if (btn.dataset.tab === welcomeTab) return;
    welcomeTab = btn.dataset.tab;
    drawWelcome();
    $(`#tab-${welcomeTab}`)?.focus();
  };
  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest && e.target.closest('[role="tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = $$('[role="tab"]', tab.parentElement);
    let i = tabs.indexOf(tab);
    if (e.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
    else if (e.key === 'Home') i = 0;
    else i = tabs.length - 1;
    e.preventDefault();
    tabs[i].click();
  });

  function messagePanel(g, kind) {
    const c = g.config[kind];
    const isW = kind === 'welcome';
    const vars = isW ? WELCOME_VARS : BOOST_VARS;
    const id = { ch: uid('f'), msg: uid('f') };
    return html`<div class="cols cols-form-right">
      <section class="card" aria-labelledby="msg-h">
        <div class="card-head"><div><h2 class="card-title" id="msg-h">${isW ? 'Poruka dobrodošlice' : 'Poruka za boost'}</h2>
          <p class="card-desc">${isW ? 'Bot je šalje kad netko uđe na server.' : 'Bot je šalje kad netko boosta server.'}</p></div>${statusBadge(c.enabled)}</div>
        <form class="form" data-form="msg" data-kind="${kind}" novalidate>
          <div class="fields">
            <label class="toggle"><input type="checkbox" role="switch" name="enabled" ${c.enabled ? raw('checked') : ''}><span class="track" aria-hidden="true"></span>
              <span>${isW ? 'Šalji poruku dobrodošlice' : 'Šalji poruku za boost'}</span></label>
            ${field({ name: 'channelId', label: 'Kanal', id: id.ch, required: true,
              control: selectField({ id: id.ch, name: 'channelId', options: textChannelOptions(g), value: c.channelId, placeholder: 'Odaberi kanal', emptyText: 'Server nema tekstualnih kanala.' }) })}
            <div class="field" data-field="message">
              <label class="label" for="${id.msg}">Poruka</label>
              <textarea class="input" id="${id.msg}" name="message" rows="6" maxlength="2000" placeholder="${c.defaultMessage}" aria-describedby="${id.msg}-help">${c.message}</textarea>
              <p class="help help-row" id="${id.msg}-help"><span>Ostavi prazno za zadanu poruku. Radi Discord markdown, npr. **podebljano**.</span><span class="num" data-counter>0 / 2000</span></p>
            </div>
            <div class="field">
              <span class="label" id="${id.msg}-vars">Varijable</span>
              <div class="chips" role="group" aria-labelledby="${id.msg}-vars">${vars.map(([v, d]) => html`<button type="button" class="chip mono" data-action="insert-var" data-var="${v}" data-tip="${d}" aria-label="Umetni ${v}: ${d}">${v}</button>`)}</div>
              <p class="help">Klikni varijablu da je umetneš na mjesto pokazivača.</p>
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Spremi promjene</button>
            <button type="button" class="btn" data-action="msg-test" data-kind="${kind}">Pošalji test</button>
          </div>
          <p class="help section-gap">Test šalje spremljenu poruku u odabrani kanal, ${isW ? 'kao da si upravo ušao/la na server' : 'kao da si upravo boostao/la server'}.</p>
        </form>
      </section>
      <aside class="card" aria-labelledby="prev-h">
        <div class="card-head"><div><h2 class="card-title" id="prev-h">Pregled</h2><p class="card-desc">S primjerima umjesto varijabli.</p></div></div>
        <div class="preview" data-preview aria-live="off"></div>
        <dl class="var-list section-gap">${vars.map(([v, d]) => html`<div><dt>${v}</dt><dd>${d}</dd></div>`)}</dl>
        <p class="section-gap"><button type="button" class="link-btn" data-action="use-default" data-kind="${kind}">Uredi zadanu poruku</button></p>
      </aside>
    </div>`;
  }
  function sampleValues(kind) {
    const { g } = state.page;
    const u = state.me.user;
    return kind === 'welcome'
      ? { user: { mention: `@${u.displayName || u.username}` }, username: u.username, server: g.name, memberCount: fmtNum(g.memberCount), inviter: { mention: '@Marko' }, invites: '12' }
      : { user: { mention: `@${u.displayName || u.username}` }, username: u.username, server: g.name, boosts: String(g.boostCount), level: String(g.boostTier) };
  }
  function renderPreview(text, kind) {
    const vals = sampleValues(kind);
    let out = esc(text).replace(/\\n/g, '\n');
    out = out.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vals)) return m;
      const v = vals[k];
      return typeof v === 'object' ? `<span class="mention">${esc(v.mention)}</span>` : esc(v);
    });
    out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    return raw(out); // built from escaped text plus fixed tags only
  }
  function updateMsgPreview(f) {
    const kind = f.dataset.kind;
    const ta = f.elements.message;
    const text = ta.value.trim() ? ta.value : state.page.g.config[kind].defaultMessage;
    const prev = $('[data-preview]', $('#content'));
    if (prev) mount(prev, renderPreview(text, kind));
    const counter = $('[data-counter]', f);
    if (counter) counter.textContent = `${fmtNum(ta.value.length)} / 2000`;
  }
  const msgSnapshot = (f) => JSON.stringify([formValue(f, 'enabled'), formValue(f, 'channelId'), formValue(f, 'message')]);
  inputs.msg = (f) => updateMsgPreview(f);
  actions['insert-var'] = (btn) => {
    const ta = btn.closest('form').elements.message;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    ta.focus();
    ta.setRangeText(btn.dataset.var, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  actions['use-default'] = (btn) => {
    const f = $('form[data-form="msg"]');
    if (!f) return;
    const ta = f.elements.message;
    ta.value = state.page.g.config[btn.dataset.kind].defaultMessage.replace(/\\n/g, '\n');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  forms.msg = async (f, btn) => {
    clearErrors(f);
    const kind = f.dataset.kind;
    const body = { enabled: formValue(f, 'enabled'), channelId: formValue(f, 'channelId') || null, message: formValue(f, 'message').trim() };
    if (body.enabled && !body.channelId) return fieldError(f, 'channelId', 'Odaberi kanal u koji bot šalje poruku.');
    const { g } = state.page;
    const ok = await run(btn, () => api('PUT', g$(g.id, `/${kind}`), body), 'Spremanje nije uspjelo');
    if (!ok) return;
    Object.assign(g.config[kind], body);
    f.dataset.snap = msgSnapshot(f);
    const badge = $('#msg-h')?.parentElement?.nextElementSibling;
    if (badge) badge.outerHTML = statusBadge(body.enabled).s;
    toast('success', 'Promjene su spremljene', kind === 'welcome' ? 'Poruka dobrodošlice je ažurirana.' : 'Poruka za boost je ažurirana.');
  };
  actions['msg-test'] = async (btn) => {
    const f = btn.closest('form');
    const kind = btn.dataset.kind;
    const { g } = state.page;
    if (f.dataset.snap !== msgSnapshot(f)) {
      toast('info', 'Najprije spremi promjene', 'Test šalje spremljenu poruku, a ne ono što je trenutno u obrascu.');
      return;
    }
    if (!g.config[kind].channelId) {
      toast('info', 'Kanal nije odabran', 'Odaberi kanal i spremi promjene pa pošalji test.');
      return;
    }
    const ok = await run(btn, () => api('POST', g$(g.id, `/${kind}/test`)), 'Test nije poslan');
    if (ok) {
      const n = channelName(g, g.config[kind].channelId);
      toast('success', 'Testna poruka je poslana', n ? `Pogledaj kanal #${n}.` : '');
    }
  };

  function autorolesPanel(g) {
    const id = uid('f');
    const anyBlocked = (g.roles || []).some((r) => !r.assignable);
    return html`<div class="cols cols-form-right">
      <section class="card" aria-labelledby="ar-h">
        <div class="card-head"><div><h2 class="card-title" id="ar-h">Automatske role</h2><p class="card-desc">Novi članovi dobiju ove role čim uđu na server.</p></div>${statusBadge(g.config.autoroles.length > 0)}</div>
        <form class="form" data-form="autoroles" novalidate>
          <div class="fields">
            ${field({ name: 'roleIds', label: 'Role', id,
              help: anyBlocked ? 'Onemogućene role bot ne može dodijeliti: iznad su njegove role ili njima upravlja integracija.' : 'Možeš odabrati više rola.',
              control: selectField({ id, name: 'roleIds', multiple: true, options: roleOptions(g, { assignableOnly: true }), value: g.config.autoroles, placeholder: 'Bez automatskih rola', emptyText: 'Server nema rola.', describedBy: `${id}-help` }) })}
          </div>
          <div class="form-actions"><button type="submit" class="btn btn-primary">Spremi promjene</button></div>
        </form>
      </section>
      <aside class="callout callout-info">${icon('ti-info-circle')}
        <div><p class="callout-title">Rola je onemogućena?</p>
        <p class="callout-body">Bot može dodijeliti samo role koje su ispod njegove najviše role. U Discordu otvori Postavke servera, zatim Role, povuci rolu bota iznad rola koje treba dijeliti pa osvježi ovu stranicu.</p></div>
      </aside>
    </div>`;
  }
  forms.autoroles = async (f, btn) => {
    const { g } = state.page;
    const roleIds = multiValue(f, 'roleIds');
    const ok = await run(btn, () => api('PUT', g$(g.id, '/autoroles'), { roleIds }), 'Spremanje nije uspjelo');
    if (!ok) return;
    g.config.autoroles = roleIds;
    const badge = $('#ar-h')?.parentElement?.nextElementSibling;
    if (badge) badge.outerHTML = statusBadge(roleIds.length > 0).s;
    toast('success', 'Promjene su spremljene', roleIds.length ? `Novi članovi dobivaju ${count(roleIds.length, 'rolu', 'role', 'rola')}.` : 'Novi članovi ne dobivaju automatske role.');
  };

  // ---------- Stats channels ----------
  async function pageStats(ctx) {
    ctx.head = pageHead('Statistika', 'Glasovni kanali koji prikazuju broj članova, botova i boostova.');
    mount(ctx.el, html`${ctx.head}<div class="cols cols-wide-left">${skelCard(300)}${skelCard(200)}</div>`);
    const g = await ctx.load(() => guildData(ctx.gid, true));
    if (!g) return;
    state.page.g = g;
    state.page.ctx = ctx;
    drawStats();
  }
  function drawStats() {
    const { g, ctx } = state.page;
    const s = g.config.stats;
    const rows = [['members', 'Članovi', g.memberCount], ['bots', 'Botovi', g.botCount], ['boosts', 'Boostovi', g.boostCount]];
    mount(ctx.el, html`${ctx.head}
      <div class="cols cols-wide-left">
        <section class="card" aria-labelledby="st-h">
          <div class="card-head"><div><h2 class="card-title" id="st-h">Kanali statistike</h2>
            <p class="card-desc">${s.enabled ? 'Bot sam ažurira imena ovih kanala.' : 'Bot stvara kategoriju s tri glasovna kanala koji se sami ažuriraju.'}</p></div>
            ${s.enabled ? html`<div class="card-actions">
              <button type="button" class="btn" data-action="stats-remove">Ukloni kanale</button>
              <button type="button" class="btn btn-primary" data-action="stats-create">Ponovno stvori</button></div>` : ''}
          </div>
          ${s.enabled
            ? html`<ul class="plain-list">${rows.map(([k, label]) => {
                const ch = s.channels && s.channels[k];
                return html`<li>${icon('ti-volume', 'activity-icon')}
                  <span class="row-main"><span class="row-title" style="display:block">${ch ? ch.name : 'Kanal nedostaje'}</span><span class="row-meta">${label}</span></span>
                  ${ch ? idRow(ch.id, 'Kopiraj ID kanala') : html`<span class="badge badge-warning">${icon('ti-alert-triangle')}Nedostaje</span>`}</li>`;
              })}</ul>`
            : emptyState('ti-chart-bar', 'Kanali statistike nisu postavljeni.', html`<button type="button" class="btn btn-primary" data-action="stats-create">Stvori kanale</button>`)}
        </section>
        <div class="stack">
          <aside class="callout callout-info">${icon('ti-info-circle')}
            <div><p class="callout-title">Brojke mogu kasniti do 5 minuta</p>
            <p class="callout-body">Discord dopušta preimenovanje kanala samo dvaput u 10 minuta, pa bot ažurira imena s odmakom.</p></div>
          </aside>
          <section class="card" aria-labelledby="now-h">
            <div class="card-head"><div><h2 class="card-title" id="now-h">Trenutne brojke</h2></div></div>
            <dl class="kv-grid">${rows.map(([, label, v]) => html`<div class="kv"><dt>${label}</dt><dd class="num">${fmtNum(v)}</dd></div>`)}</dl>
          </section>
        </div>
      </div>`);
  }
  actions['stats-create'] = async (btn) => {
    const { g } = state.page;
    const was = g.config.stats.enabled;
    const ok = await run(btn, () => api('POST', g$(g.id, '/stats')), 'Kanali nisu stvoreni');
    if (!ok) return;
    toast('success', was ? 'Kanali su ponovno stvoreni' : 'Kanali statistike su stvoreni');
    await refreshStats();
  };
  actions['stats-remove'] = () => {
    const { g } = state.page;
    confirmAction({
      title: 'Ukloniti kanale statistike?',
      text: 'Bot briše kategoriju i tri glasovna kanala statistike. Kasnije ih možeš ponovno stvoriti.',
      confirmLabel: 'Ukloni kanale',
      async onConfirm() {
        await api('DELETE', g$(g.id, '/stats'));
        toast('success', 'Kanali statistike su uklonjeni');
        refreshStats();
      },
    });
  };
  async function refreshStats() {
    const { g } = state.page;
    try {
      state.page.g = await guildData(g.id, true);
      if (state.page.ctx && state.page.ctx.alive()) drawStats();
    } catch (err) { reportError(err, 'Osvježavanje nije uspjelo'); }
  }

  // ---------- Tickets ----------
  async function pageTickets(ctx) {
    ctx.head = pageHead('Tiketi', 'Privatni kanali za podršku koje članovi otvaraju gumbom na panelu.');
    mount(ctx.el, html`${ctx.head}<div class="areas"><div class="area-main">${skelCard(320)}</div><div class="area-side">${skelCard(420)}</div><div class="area-rest">${skelCard(300)}</div></div>`);
    const res = await ctx.load(() => Promise.all([guildData(ctx.gid, true), api('GET', g$(ctx.gid, '/tickets'))]));
    if (!res) return;
    const [g, t] = res;
    Object.assign(state.page, { g, ctx, tickets: t.open || [] });
    drawTickets();
  }
  function drawTickets() {
    const { g, ctx, tickets } = state.page;
    const tc = g.config.tickets;
    const id = { cat: uid('f'), role: uid('f'), log: uid('f'), pch: uid('f'), pt: uid('f'), pd: uid('f') };
    ctx.head = pageHead('Tiketi', 'Privatni kanali za podršku koje članovi otvaraju gumbom na panelu.',
      tc.enabled ? html`<button type="button" class="btn" data-action="tickets-disable">Isključi tikete</button>` : '');
    mount(ctx.el, html`${ctx.head}
      ${tc.enabled ? '' : html`<div class="callout callout-info" style="margin-bottom:24px">${icon('ti-info-circle')}<div><p class="callout-title">Tiketi su isključeni</p><p class="callout-body">Odaberi kategoriju u postavkama i spremi ih da uključiš tikete, a zatim pošalji panel u kanal.</p></div></div>`}
      <div class="areas">
        <section class="card area-main" aria-labelledby="tk-h">
          <div class="card-head"><div><h2 class="card-title" id="tk-h">Otvoreni tiketi <span class="count num">${fmtNum(tickets.length)}</span></h2></div>
            <div class="card-actions"><button type="button" class="btn-icon" data-action="tickets-refresh" aria-label="Osvježi tikete" data-tip="Osvježi">${icon('ti-refresh')}</button></div></div>
          <div id="tk-list">${ticketList(tickets)}</div>
        </section>
        <div class="stack area-side">
          <section class="card" aria-labelledby="tc-h">
            <div class="card-head"><div><h2 class="card-title" id="tc-h">Postavke</h2><p class="card-desc">Gdje se otvaraju tiketi i tko ih vidi.</p></div>${statusBadge(tc.enabled)}</div>
            <form class="form" data-form="tickets-config" novalidate>
              <div class="fields">
                ${field({ name: 'categoryId', label: 'Kategorija za tikete', id: id.cat, required: true,
                  help: (g.channels.categories || []).length ? 'Novi tiketi otvaraju se kao kanali u ovoj kategoriji.' : 'Server nema nijednu kategoriju. Stvori je u Discordu pa osvježi stranicu.',
                  control: selectField({ id: id.cat, name: 'categoryId', options: categoryOptions(g), value: tc.categoryId, placeholder: 'Odaberi kategoriju', emptyText: 'Server nema kategorija.' }) })}
                ${field({ name: 'supportRoleId', label: 'Rola podrške', id: id.role, help: 'Članovi s ovom rolom vide sve tikete.',
                  control: selectField({ id: id.role, name: 'supportRoleId', options: [{ value: '', label: 'Bez role podrške' }, ...roleOptions(g)], value: tc.supportRoleId || '', placeholder: 'Bez role podrške' }) })}
                ${field({ name: 'logChannelId', label: 'Kanal za zapise', id: id.log, help: 'Ovdje stižu transkripti zatvorenih tiketa.',
                  control: selectField({ id: id.log, name: 'logChannelId', options: [{ value: '', label: 'Bez zapisa', group: '' }, ...textChannelOptions(g)], value: tc.logChannelId || '', placeholder: 'Bez zapisa' }) })}
              </div>
              <div class="form-actions"><button type="submit" class="btn btn-primary">${tc.enabled ? 'Spremi promjene' : 'Uključi tikete'}</button></div>
            </form>
          </section>
          ${tc.enabled ? html`<aside class="callout callout-info">${icon('ti-info-circle')}<div><p class="callout-title">Kako rade tiketi</p>
            <p class="callout-body">Član klikne gumb na panelu i bot mu otvori privatni kanal u odabranoj kategoriji. Kanal vide samo on i rola podrške. Kad se tiket zatvori, transkript ide u kanal za zapise.</p></div></aside>` : ''}
        </div>
        <section class="card area-rest" aria-labelledby="tp-h">
            <div class="card-head"><div><h2 class="card-title" id="tp-h">Panel za otvaranje</h2><p class="card-desc">Poruka s gumbom kojim članovi otvaraju tiket.</p></div></div>
            <form class="form" data-form="tickets-panel" novalidate>
              <div class="fields">
                ${field({ name: 'channelId', label: 'Kanal', id: id.pch, required: true,
                  control: selectField({ id: id.pch, name: 'channelId', options: textChannelOptions(g), placeholder: 'Odaberi kanal', disabled: !tc.enabled }) })}
                ${field({ name: 'title', label: 'Naslov', id: id.pt, help: 'Ostavi prazno za zadani naslov.',
                  control: html`<input class="input" id="${id.pt}" name="title" maxlength="256" autocomplete="off" ${tc.enabled ? '' : raw('disabled')}>` })}
                ${field({ name: 'description', label: 'Opis', id: id.pd, help: 'Ostavi prazno za zadani opis.',
                  control: html`<textarea class="input" id="${id.pd}" name="description" rows="3" maxlength="2000" ${tc.enabled ? '' : raw('disabled')}></textarea>` })}
              </div>
              <div class="form-actions"><button type="submit" class="btn" ${tc.enabled ? '' : raw('disabled')}>Pošalji panel</button></div>
              ${tc.enabled ? '' : html`<p class="help section-gap">Najprije uključi tikete.</p>`}
            </form>
        </section>
      </div>`);
  }
  function ticketList(tickets) {
    if (!tickets.length) return emptyState('ti-ticket', 'Nema otvorenih tiketa. Kad član otvori tiket preko panela, pojavit će se ovdje.');
    return html`<ul class="plain-list">${tickets.map((t) => html`<li class="row-wrap" style="flex-wrap:wrap">
      ${avatar(t.owner && t.owner.avatarUrl, t.owner && t.owner.name)}
      <span class="row-main"><span class="row-title" style="display:block">${t.channelName}</span>
        <span class="row-meta" style="display:block">${t.owner ? t.owner.name : 'Nepoznat član'}<span class="sep">·</span>${timeEl(t.createdAt)}</span>
        ${t.reason ? html`<span class="row-meta truncate" style="display:block" data-tip="${t.reason}">${t.reason}</span>` : ''}</span>
      <span class="row-end">${extLink(t.url, 'Otvori u Discordu')}
        <button type="button" class="btn" data-action="ticket-close" data-id="${t.channelId}">Zatvori</button></span>
    </li>`)}</ul>`;
  }
  actions['tickets-refresh'] = async (btn) => {
    const { g } = state.page;
    await run(btn, async () => {
      const t = await api('GET', g$(g.id, '/tickets'));
      state.page.tickets = t.open || [];
      mount($('#tk-list'), ticketList(state.page.tickets));
      const c = $('#tk-h .count');
      if (c) c.textContent = fmtNum(state.page.tickets.length);
    }, 'Osvježavanje nije uspjelo');
  };
  actions['ticket-close'] = (btn) => {
    const { g, tickets } = state.page;
    const t = tickets.find((x) => x.channelId === btn.dataset.id);
    if (!t) return;
    confirmAction({
      title: `Zatvoriti ${t.channelName}?`,
      text: 'Transkript ide u kanal za zapise, a kanal se briše nakon 5 sekundi. Ovo se ne može poništiti.',
      confirmLabel: 'Zatvori tiket',
      async onConfirm() {
        await api('POST', g$(g.id, `/tickets/${encodeURIComponent(t.channelId)}/close`));
        state.page.tickets = state.page.tickets.filter((x) => x !== t);
        mount($('#tk-list'), ticketList(state.page.tickets));
        const c = $('#tk-h .count');
        if (c) c.textContent = fmtNum(state.page.tickets.length);
        toast('success', `${t.channelName} je zatvoren`, 'Kanal se briše za nekoliko sekundi.');
      },
    });
  };
  forms['tickets-config'] = async (f, btn) => {
    clearErrors(f);
    const { g } = state.page;
    const body = { categoryId: formValue(f, 'categoryId') || null, supportRoleId: formValue(f, 'supportRoleId') || null, logChannelId: formValue(f, 'logChannelId') || null };
    if (!body.categoryId) return fieldError(f, 'categoryId', 'Odaberi kategoriju u kojoj se otvaraju tiketi.');
    const wasOn = g.config.tickets.enabled;
    const ok = await run(btn, () => api('PUT', g$(g.id, '/tickets'), body), 'Spremanje nije uspjelo');
    if (!ok) return;
    Object.assign(g.config.tickets, body, { enabled: true });
    toast('success', wasOn ? 'Promjene su spremljene' : 'Tiketi su uključeni', wasOn ? '' : 'Pošalji panel u kanal da članovi mogu otvoriti tiket.');
    if (!wasOn) drawTickets();
  };
  forms['tickets-panel'] = async (f, btn) => {
    clearErrors(f);
    const { g } = state.page;
    const body = { channelId: formValue(f, 'channelId'), title: formValue(f, 'title').trim(), description: formValue(f, 'description').trim() };
    if (!body.channelId) return fieldError(f, 'channelId', 'Odaberi kanal u koji bot šalje panel.');
    const ok = await run(btn, () => api('POST', g$(g.id, '/tickets/panel'), body), 'Panel nije poslan');
    if (ok) {
      toast('success', 'Panel je poslan', `Članovi ga vide u kanalu #${channelName(g, body.channelId) || ''}.`);
      f.elements.title.value = '';
      f.elements.description.value = '';
    }
  };
  actions['tickets-disable'] = () => {
    const { g } = state.page;
    confirmAction({
      title: 'Isključiti tikete?',
      text: 'Članovi više neće moći otvoriti novi tiket, a gumbi na postojećim panelima prestaju raditi. Otvoreni tiketi ostaju dok ih ne zatvoriš.',
      confirmLabel: 'Isključi tikete',
      async onConfirm() {
        await api('DELETE', g$(g.id, '/tickets'));
        g.config.tickets.enabled = false;
        toast('success', 'Tiketi su isključeni');
        drawTickets();
      },
    });
  };

  // ---------- Invites ----------
  const LB_PAGE = 25;
  async function pageInvites(ctx) {
    ctx.head = pageHead('Invite-ovi', 'Ukupno = pozvani − otišli + bonus. Lažni su računi mlađi od 7 dana i ne broje se.');
    mount(ctx.el, html`${ctx.head}<section class="card"><div class="skel skel-title"></div><div class="section-gap">${skelRows(6)}</div></section>`);
    const res = await ctx.load(() => Promise.all([guildData(ctx.gid), api('GET', g$(ctx.gid, '/invites'))]));
    if (!res) return;
    const [g, inv] = res;
    Object.assign(state.page, { g, ctx, lb: inv.leaderboard || [], lbPage: 0 });
    drawInvites();
  }
  function drawInvites() {
    const { ctx, lb } = state.page;
    ctx.head = pageHead('Invite-ovi', 'Ukupno = pozvani − otišli + bonus. Lažni su računi mlađi od 7 dana i ne broje se.',
      lb.length ? html`<button type="button" class="btn" data-action="invites-reset-all">Resetiraj sve</button>` : '');
    const sid = 'member-search';
    mount(ctx.el, html`${ctx.head}
      <section class="card" aria-labelledby="lb-h">
        <div class="card-head"><div><h2 class="card-title" id="lb-h">Ljestvica <span class="count num">${fmtNum(lb.length)}</span></h2>
          <p class="card-desc">Bonus dodaješ ikonom olovke ili pretragom člana koji nije na ljestvici.</p></div>
          <div class="search-wrap">
            <div class="input-wrap">${icon('ti-search', 'ti-sm')}<input class="input" id="${sid}" type="search" placeholder="Pronađi člana" aria-label="Pronađi člana za bonus" autocomplete="off" spellcheck="false" aria-controls="member-results" aria-expanded="false" data-member-search></div>
            <div class="menu" id="member-results" data-input="${sid}" hidden></div>
          </div>
        </div>
        <div id="lb-body">${lbBody()}</div>
      </section>`);
  }
  function lbBody() {
    const { lb, lbPage } = state.page;
    if (!lb.length) return emptyState('ti-user-share', 'Kad netko uđe preko pozivnice, ovdje će se pojaviti ljestvica.');
    const start = lbPage * LB_PAGE;
    const rows = lb.slice(start, start + LB_PAGE);
    const pages = Math.ceil(lb.length / LB_PAGE);
    const acts = (e) => html`<button type="button" class="btn-icon" data-action="invite-bonus" data-id="${e.user.id}" aria-label="Promijeni bonus za ${e.user.name}" data-tip="Promijeni bonus">${icon('ti-pencil')}</button>
      <button type="button" class="btn-icon" data-action="invite-reset" data-id="${e.user.id}" aria-label="Resetiraj invite-ove za ${e.user.name}" data-tip="Resetiraj invite-ove">${icon('ti-restore')}</button>`;
    const bonusTxt = (b) => (b > 0 ? `+${fmtNum(b)}` : fmtNum(b));
    return html`
      <div class="lb-only-wide table-wrap"><table class="table">
        <thead><tr><th scope="col" class="rank">#</th><th scope="col">Član</th><th scope="col" class="n">Ukupno</th><th scope="col" class="n">Pozvani</th><th scope="col" class="n">Otišli</th><th scope="col" class="n">Lažni</th><th scope="col" class="n">Bonus</th><th scope="col" class="acts"><span class="sr-only">Radnje</span></th></tr></thead>
        <tbody>${rows.map((e, i) => html`<tr>
          <td class="rank">${start + i + 1}</td>
          <td><span class="who">${avatar(e.user.avatarUrl, e.user.name, 'avatar-sm')}<span class="strong truncate">${e.user.name}</span></span></td>
          <td class="n total">${fmtNum(e.total)}</td><td class="n">${fmtNum(e.regular)}</td><td class="n">${fmtNum(e.left)}</td><td class="n">${fmtNum(e.fake)}</td><td class="n">${bonusTxt(e.bonus)}</td>
          <td class="acts">${acts(e)}</td></tr>`)}</tbody>
      </table></div>
      <ul class="lb-rows lb-only-narrow">${rows.map((e, i) => html`<li class="lb-row">
        <span class="rank">${start + i + 1}</span>${avatar(e.user.avatarUrl, e.user.name, 'avatar-sm')}
        <span class="strong truncate" style="flex:1">${e.user.name}</span>
        <span class="lb-total" aria-label="Ukupno ${e.total}">${fmtNum(e.total)}</span>
        <span class="lb-meta"><span class="num">${fmtNum(e.regular)} pozvanih · ${fmtNum(e.left)} otišlo · ${fmtNum(e.fake)} lažnih · bonus ${bonusTxt(e.bonus)}</span><span class="btn-group" style="gap:4px;flex:none">${acts(e)}</span></span>
      </li>`)}</ul>
      ${pages > 1 ? html`<nav class="pager" aria-label="Stranice ljestvice"><span class="muted num">${fmtNum(start + 1)}–${fmtNum(Math.min(lb.length, start + LB_PAGE))} od ${fmtNum(lb.length)}</span>
        <span class="pages">
          <button type="button" class="btn-icon" data-action="lb-page" data-p="${lbPage - 1}" aria-label="Prethodna stranica" data-tip="Prethodna" ${lbPage === 0 ? raw('disabled') : ''}>${icon('ti-chevron-left')}</button>
          ${Array.from({ length: pages }, (_, p) => p).filter((p) => p === 0 || p === pages - 1 || Math.abs(p - lbPage) <= 1).map((p, i, arr) => html`${i > 0 && p - arr[i - 1] > 1 ? html`<span class="faint">…</span>` : ''}<button type="button" class="page-btn" data-action="lb-page" data-p="${p}" ${p === lbPage ? raw('aria-current="page"') : ''}>${p + 1}</button>`)}
          <button type="button" class="btn-icon" data-action="lb-page" data-p="${lbPage + 1}" aria-label="Sljedeća stranica" data-tip="Sljedeća" ${lbPage >= pages - 1 ? raw('disabled') : ''}>${icon('ti-chevron-right')}</button>
        </span></nav>` : ''}`;
  }
  actions['lb-page'] = (btn) => {
    state.page.lbPage = Number(btn.dataset.p) || 0;
    mount($('#lb-body'), lbBody());
    $('#lb-h')?.scrollIntoView({ block: 'nearest' });
  };
  function redrawLb() {
    const c = $('#lb-h .count');
    if (c) c.textContent = fmtNum(state.page.lb.length);
    mount($('#lb-body'), lbBody());
  }
  function bonusModal(user) {
    const { g, lb } = state.page;
    const entry = lb.find((e) => e.user.id === user.id) || { user, total: 0, regular: 0, left: 0, fake: 0, bonus: 0 };
    const id = uid('b');
    openModal({
      title: `Bonus za ${user.name}`,
      description: `Trenutno ${count(entry.total, 'invite', 'invite-a', 'invite-ova')}, od toga bonus ${fmtNum(entry.bonus)}. Upiši koliko dodaješ, a negativan broj oduzima.`,
      body: html`<div class="field" data-field="amount"><label class="label" for="${id}">Iznos<span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="${id}" name="amount" type="number" step="1" placeholder="npr. 5 ili -2" required aria-describedby="${id}-help">
        <p class="help num" id="${id}-help" data-bonus-help>Novi ukupno: ${fmtNum(entry.total)}</p></div>`,
      confirmLabel: 'Spremi bonus',
      onOpen(form) {
        const input = form.elements.amount;
        input.addEventListener('input', () => {
          const n = Number(input.value);
          const help = $('[data-bonus-help]', form);
          if (help) help.textContent = `Novi ukupno: ${fmtNum(entry.total + (Number.isInteger(n) ? n : 0))}`;
        });
      },
      async onConfirm(form) {
        clearErrors(form);
        const raw0 = form.elements.amount.value.trim();
        const amount = Number(raw0);
        if (!raw0 || !Number.isInteger(amount) || amount === 0) { fieldError(form, 'amount', 'Upiši cijeli broj različit od nule, npr. 5 ili -2.'); return false; }
        const res = await api('POST', g$(g.id, `/invites/${encodeURIComponent(user.id)}/bonus`), { amount });
        const stats = res.stats || { ...entry, bonus: entry.bonus + amount, total: entry.total + amount };
        const existing = state.page.lb.find((e) => e.user.id === user.id);
        if (existing) Object.assign(existing, stats);
        else state.page.lb.push({ user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl }, ...stats });
        state.page.lb.sort((a, b) => b.total - a.total);
        if (!$('#lb-body table') && state.page.lb.length === 1) drawInvites(); else redrawLb();
        toast('success', 'Bonus je spremljen', `${user.name} sada ima ${count(stats.total, 'invite', 'invite-a', 'invite-ova')}.`);
        return true;
      },
    });
  }
  actions['invite-bonus'] = (btn) => {
    const e = state.page.lb.find((x) => x.user.id === btn.dataset.id);
    if (e) bonusModal(e.user);
  };
  actions['invite-reset'] = (btn) => {
    const { g } = state.page;
    const e = state.page.lb.find((x) => x.user.id === btn.dataset.id);
    if (!e) return;
    confirmAction({
      title: `Resetirati invite-ove za ${e.user.name}?`,
      text: `${e.user.name} gubi ${count(e.total, 'invite', 'invite-a', 'invite-ova')}: pozvani, otišli, lažni i bonus vraćaju se na nulu.`,
      confirmLabel: 'Resetiraj invite-ove',
      async onConfirm() {
        await api('DELETE', g$(g.id, `/invites/${encodeURIComponent(e.user.id)}`));
        state.page.lb = state.page.lb.filter((x) => x !== e);
        if (!state.page.lb.length) drawInvites(); else redrawLb();
        toast('success', `Invite-ovi za ${e.user.name} su resetirani`);
      },
    });
  };
  actions['invites-reset-all'] = () => {
    const { g } = state.page;
    confirmAction({
      title: 'Resetirati invite-ove cijelog servera?',
      text: `Svih ${fmtNum(state.page.lb.length)} članova s ljestvice gube sve invite-ove i bonuse. Ovo se ne može poništiti.`,
      confirmLabel: 'Resetiraj sve',
      typeToConfirm: g.name,
      async onConfirm() {
        await api('DELETE', g$(g.id, '/invites'));
        state.page.lb = [];
        drawInvites();
        toast('success', 'Svi invite-ovi su resetirani');
      },
    });
  };
  // Member search (debounced) -> pick -> bonus modal
  let searchTimer = 0, searchSeq = 0;
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-member-search]')) return;
    const input = e.target;
    const menu = $('#member-results');
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const { g } = state.page;
      mount(menu, html`<p class="select-empty">Tražim…</p>`);
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      try {
        const res = await api('GET', g$(g.id, `/members?q=${encodeURIComponent(q)}`));
        if (seq !== searchSeq || !menu.isConnected) return;
        const list = res.members || [];
        mount(menu, list.length
          ? html`${list.map((m) => html`<button type="button" class="menu-item" data-action="member-pick" data-id="${m.id}" data-name="${m.name}" data-avatar="${m.avatarUrl || ''}">
              ${avatar(m.avatarUrl, m.name, 'avatar-sm')}<span class="truncate">${m.name} <span class="menu-sub">@${m.username}</span></span></button>`)}`
          : html`<p class="select-empty">Nema članova za „${q}”.</p>`);
      } catch (err) {
        if (seq !== searchSeq || !menu.isConnected) return;
        if (err.status !== 401) mount(menu, html`<p class="select-empty">Pretraga nije uspjela. ${err.message}</p>`);
      }
    }, 250);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('[data-member-search]')) {
      const menu = $('#member-results');
      if (e.key === 'ArrowDown' && menu && !menu.hidden) { e.preventDefault(); $('.menu-item', menu)?.focus(); }
      if (e.key === 'Escape' && menu) { menu.hidden = true; e.target.setAttribute('aria-expanded', 'false'); }
    }
  });
  document.addEventListener('click', (e) => {
    const menu = $('#member-results');
    if (menu && !menu.hidden && !e.target.closest('.search-wrap')) { menu.hidden = true; $('[data-member-search]')?.setAttribute('aria-expanded', 'false'); }
  });
  actions['member-pick'] = (btn) => {
    const menu = $('#member-results');
    if (menu) menu.hidden = true;
    const input = $('[data-member-search]');
    if (input) { input.value = ''; input.setAttribute('aria-expanded', 'false'); }
    bonusModal({ id: btn.dataset.id, name: btn.dataset.name, avatarUrl: btn.dataset.avatar || null });
  };

  // ---------- Reaction roles ----------
  async function pageReactionRoles(ctx) {
    ctx.head = pageHead('Reaction role', 'Članovi dobiju rolu kad reagiraju emojijem na poruku, a izgube je kad maknu reakciju.');
    mount(ctx.el, html`${ctx.head}<div class="cols cols-form-right"><div class="stack">${skelCard(220)}${skelCard(220)}</div><div class="stack">${skelCard(360)}${skelCard(360)}</div></div>`);
    const res = await ctx.load(() => Promise.all([guildData(ctx.gid), api('GET', g$(ctx.gid, '/reactionroles'))]));
    if (!res) return;
    const [g, rr] = res;
    Object.assign(state.page, { g, ctx, rr: rr.messages || [] });
    drawRR();
  }
  function drawRR() {
    const { g, ctx } = state.page;
    const id = { nch: uid('f'), nt: uid('f'), nd: uid('f'), lch: uid('f'), lid: uid('f'), lem: uid('f'), lr: uid('f') };
    mount(ctx.el, html`${ctx.head}
      <div class="cols cols-form-right">
        <div class="stack" id="rr-list" aria-label="Poruke s reaction rolama">${rrList()}</div>
        <div class="stack">
          <section class="card" aria-labelledby="rn-h">
            <div class="card-head"><div><h2 class="card-title" id="rn-h">Nova poruka</h2><p class="card-desc">Bot objavi poruku, a zatim joj dodaješ emojije i role.</p></div></div>
            <form class="form" data-form="rr-create" novalidate><div class="fields">
              ${field({ name: 'channelId', label: 'Kanal', id: id.nch, required: true, control: selectField({ id: id.nch, name: 'channelId', options: textChannelOptions(g), placeholder: 'Odaberi kanal' }) })}
              ${field({ name: 'title', label: 'Naslov', id: id.nt, required: true, control: html`<input class="input" id="${id.nt}" name="title" maxlength="256" value="Odaberi role" autocomplete="off">` })}
              ${field({ name: 'description', label: 'Opis', id: id.nd, help: 'Ostavi prazno za zadani opis.', control: html`<textarea class="input" id="${id.nd}" name="description" rows="3" maxlength="2000" placeholder="Klikni na emoji ispod da dobiješ rolu. Makni reakciju da je izgubiš."></textarea>` })}
            </div>
            <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('ti-plus')}Objavi poruku</button></div></form>
          </section>
          <section class="card" aria-labelledby="rl-h">
            <div class="card-head"><div><h2 class="card-title" id="rl-h">Poveži postojeću poruku</h2><p class="card-desc">Dodaj reaction rolu na poruku koja je već objavljena.</p></div></div>
            <form class="form cq" data-form="rr-link" novalidate><div class="fields">
              ${field({ name: 'channelId', label: 'Kanal poruke', id: id.lch, required: true, control: selectField({ id: id.lch, name: 'channelId', options: textChannelOptions(g), placeholder: 'Odaberi kanal' }) })}
              ${field({ name: 'messageId', label: 'ID poruke', id: id.lid, required: true, help: 'U Discordu uključi Developer Mode, desni klik na poruku pa Kopiraj ID poruke.',
                control: html`<input class="input mono" id="${id.lid}" name="messageId" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="npr. 1234567890123456789" aria-describedby="${id.lid}-help">` })}
              <div class="field-row">
                ${field({ name: 'emoji', label: 'Emoji', id: id.lem, required: true, control: html`<input class="input" id="${id.lem}" name="emoji" autocomplete="off" spellcheck="false" placeholder="🎮 ili <:ime:123>">` })}
                ${field({ name: 'roleId', label: 'Rola', id: id.lr, required: true, control: selectField({ id: id.lr, name: 'roleId', options: roleOptions(g, { assignableOnly: true }), placeholder: 'Odaberi rolu' }) })}
              </div>
            </div>
            <div class="form-actions"><button type="submit" class="btn">Poveži poruku</button></div></form>
          </section>
        </div>
      </div>`);
  }
  function rrList() {
    const { g, rr } = state.page;
    if (!rr.length) {
      return html`<section class="card">${emptyState('ti-mood-smile', 'Još nema poruka s reaction rolama. Objavi novu poruku ili poveži postojeću.')}</section>`;
    }
    return rr.map((m) => {
      const fid = uid('f'), rid = uid('f');
      const title = m.managed ? (m.title || 'Bez naslova') : 'Postojeća poruka';
      return html`<section class="card" aria-label="${title}" data-msg="${m.messageId}">
        <div class="card-head"><div><h2 class="card-title">${title}</h2>
          <p class="card-desc">#${m.channelName || channelName(g, m.channelId) || 'obrisan kanal'} · ${m.managed ? 'Objavio bot' : 'Poruku nije objavio bot'}</p>
          ${m.managed && m.description ? html`<p class="card-desc truncate" data-tip="${m.description}">${m.description}</p>` : ''}</div>
          <div class="card-actions">${extLink(m.url, 'Otvori u Discordu')}
            <button type="button" class="btn-icon" data-action="rr-delete" data-id="${m.messageId}" aria-label="${m.managed ? 'Obriši poruku' : 'Prestani pratiti poruku'}" data-tip="${m.managed ? 'Obriši poruku' : 'Prestani pratiti'}">${icon('ti-trash')}</button></div>
        </div>
        ${m.roles.length
          ? html`<ul class="chips" aria-label="Emojiji i role">${m.roles.map((r) => {
              const role = roleById(g, r.roleId);
              const em = safeUrl(r.emojiUrl) ? html`<img class="emoji-img" src="${safeUrl(r.emojiUrl)}" alt="${r.emoji}">` : html`<span class="emoji">${r.emoji}</span>`;
              const rname = role ? role.name : 'Obrisana rola';
              return html`<li class="tag">${em}${icon('ti-arrow-right', 'arrow')}${roleDot(role && role.color)}<span class="truncate">${rname}</span>
                <button type="button" class="btn-icon tag-x" data-action="rr-unmap" data-id="${m.messageId}" data-key="${r.key}" aria-label="Ukloni ${r.emoji} za rolu ${rname}" data-tip="Ukloni">${icon('ti-x')}</button></li>`;
            })}</ul>`
          : html`<p class="muted">Još nema emojija. Dodaj prvi ispod.</p>`}
        <form class="inline-form section-gap" data-form="rr-add" data-id="${m.messageId}" novalidate>
          ${field({ name: 'emoji', label: 'Emoji', id: fid, control: html`<input class="input" id="${fid}" name="emoji" autocomplete="off" spellcheck="false" placeholder="🎮 ili <:ime:123>">` })}
          ${field({ name: 'roleId', label: 'Rola', id: rid, control: selectField({ id: rid, name: 'roleId', options: roleOptions(g, { assignableOnly: true }), placeholder: 'Odaberi rolu' }) })}
          <button type="submit" class="btn">${icon('ti-plus')}Dodaj</button>
        </form>
        <dl class="kv section-gap"><dt>ID poruke</dt><dd>${idRow(m.messageId, 'Kopiraj ID poruke')}</dd></dl>
      </section>`;
    });
  }
  async function reloadRR() {
    const { g } = state.page;
    const rr = await api('GET', g$(g.id, '/reactionroles'));
    state.page.rr = rr.messages || [];
    const list = $('#rr-list');
    if (list) mount(list, html`${rrList()}`);
  }
  forms['rr-add'] = async (f, btn) => {
    clearErrors(f);
    const { g } = state.page;
    const emoji = formValue(f, 'emoji').trim();
    const roleId = formValue(f, 'roleId');
    if (!emoji) return fieldError(f, 'emoji', 'Upiši ili zalijepi emoji.');
    if (!roleId) return fieldError(f, 'roleId', 'Odaberi rolu.');
    const ok = await run(btn, async () => {
      await api('POST', g$(g.id, `/reactionroles/${encodeURIComponent(f.dataset.id)}/roles`), { emoji, roleId });
      await reloadRR();
    }, 'Emoji nije dodan');
    if (ok) toast('success', 'Reaction rola je dodana', `${emoji} → ${roleById(g, roleId)?.name || ''}`);
  };
  actions['rr-unmap'] = async (btn) => {
    const { g } = state.page;
    const ok = await run(btn, async () => {
      await api('DELETE', g$(g.id, `/reactionroles/${encodeURIComponent(btn.dataset.id)}/roles/${encodeURIComponent(btn.dataset.key)}`));
      await reloadRR();
    }, 'Uklanjanje nije uspjelo');
    if (ok) toast('success', 'Reaction rola je uklonjena');
  };
  actions['rr-delete'] = (btn) => {
    const { g, rr } = state.page;
    const m = rr.find((x) => x.messageId === btn.dataset.id);
    if (!m) return;
    const ch = `#${m.channelName || channelName(g, m.channelId) || 'kanal'}`;
    confirmAction(m.managed ? {
      title: `Obrisati poruku „${m.title || 'Bez naslova'}”?`,
      text: `Bot briše poruku iz ${ch} i prestaje dijeliti njezine role. Članovi zadržavaju role koje već imaju.`,
      confirmLabel: 'Obriši poruku',
      async onConfirm() { await api('DELETE', g$(g.id, `/reactionroles/${encodeURIComponent(m.messageId)}`)); await reloadRR(); toast('success', 'Poruka je obrisana'); },
    } : {
      title: 'Prestati pratiti poruku?',
      text: `Poruka ostaje u ${ch}, ali reakcije na nju više neće dijeliti role.`,
      confirmLabel: 'Prestani pratiti',
      async onConfirm() { await api('DELETE', g$(g.id, `/reactionroles/${encodeURIComponent(m.messageId)}`)); await reloadRR(); toast('success', 'Poruka se više ne prati'); },
    });
  };
  forms['rr-create'] = async (f, btn) => {
    clearErrors(f);
    const { g } = state.page;
    const body = { channelId: formValue(f, 'channelId'), title: formValue(f, 'title').trim(), description: formValue(f, 'description').trim() };
    if (!body.channelId) return fieldError(f, 'channelId', 'Odaberi kanal u koji bot objavljuje poruku.');
    if (!body.title) return fieldError(f, 'title', 'Upiši naslov poruke.');
    let res;
    const ok = await run(btn, async () => {
      res = await api('POST', g$(g.id, '/reactionroles'), body);
      await reloadRR();
    }, 'Poruka nije objavljena');
    if (!ok) return;
    toast('success', 'Poruka je objavljena', 'Sad joj dodaj emojije i role.');
    f.elements.description.value = '';
    const card = res && res.messageId ? $(`[data-msg="${CSS.escape(String(res.messageId))}"]`) : null;
    if (card) { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('input[name="emoji"]', card)?.focus({ preventScroll: true }); }
  };
  forms['rr-link'] = async (f, btn) => {
    clearErrors(f);
    const { g } = state.page;
    const channelId = formValue(f, 'channelId');
    const messageId = formValue(f, 'messageId').trim();
    const emoji = formValue(f, 'emoji').trim();
    const roleId = formValue(f, 'roleId');
    if (!channelId) return fieldError(f, 'channelId', 'Odaberi kanal u kojem je poruka.');
    if (!/^\d{15,22}$/.test(messageId)) return fieldError(f, 'messageId', 'ID poruke je broj od 17 do 20 znamenki. Kopiraj ga iz Discorda.');
    if (!emoji) return fieldError(f, 'emoji', 'Upiši ili zalijepi emoji.');
    if (!roleId) return fieldError(f, 'roleId', 'Odaberi rolu.');
    const ok = await run(btn, async () => {
      await api('POST', g$(g.id, `/reactionroles/${encodeURIComponent(messageId)}/roles`), { emoji, roleId, channelId });
      await reloadRR();
    }, 'Poruka nije povezana');
    if (ok) {
      toast('success', 'Poruka je povezana', `${emoji} → ${roleById(g, roleId)?.name || ''}`);
      f.elements.messageId.value = '';
      f.elements.emoji.value = '';
    }
  };

  // ---------- Giveaways ----------
  async function pageGiveaways(ctx) {
    ctx.head = pageHead('Giveaway', 'Nagradne igre za članove servera. Pobjednike bot bira nasumično kad vrijeme istekne.');
    mount(ctx.el, html`${ctx.head}<div class="areas"><div class="area-main">${skelCard(260)}</div><div class="area-side">${skelCard(480)}</div><div class="area-rest">${skelCard(200)}</div></div>`);
    const res = await ctx.load(() => Promise.all([guildData(ctx.gid), api('GET', g$(ctx.gid, '/giveaways'))]));
    if (!res) return;
    const [g, ga] = res;
    Object.assign(state.page, { g, ctx, ga: ga.giveaways || [] });
    drawGiveaways();
  }
  function drawGiveaways() {
    const { g, ctx } = state.page;
    const id = { ch: uid('f'), pr: uid('f'), wc: uid('f'), du: uid('f'), de: uid('f') };
    mount(ctx.el, html`${ctx.head}
      <div class="areas">
        <section class="card area-main" aria-labelledby="ga-a-h" id="ga-active"></section>
        <section class="card area-side" aria-labelledby="ga-n-h">
          <div class="card-head"><div><h2 class="card-title" id="ga-n-h">Novi giveaway</h2></div></div>
          <form class="form cq" data-form="ga-create" novalidate><div class="fields">
            ${field({ name: 'channelId', label: 'Kanal', id: id.ch, required: true, control: selectField({ id: id.ch, name: 'channelId', options: textChannelOptions(g), placeholder: 'Odaberi kanal' }) })}
            ${field({ name: 'prize', label: 'Nagrada', id: id.pr, required: true, control: html`<input class="input" id="${id.pr}" name="prize" maxlength="256" autocomplete="off" placeholder="npr. Discord Nitro">` })}
            <div class="field-row">
              ${field({ name: 'winnerCount', label: 'Broj dobitnika', id: id.wc, required: true, control: html`<input class="input" id="${id.wc}" name="winnerCount" type="number" min="1" max="50" step="1" inputmode="numeric" value="1">` })}
              ${field({ name: 'duration', label: 'Trajanje', id: id.du, required: true, control: html`<input class="input mono" id="${id.du}" name="duration" autocomplete="off" spellcheck="false" placeholder="npr. 1d12h" aria-describedby="${id.du}-help">`,
                help: 'Jedinice s, m, h, d, w. Najmanje 10 s, najviše 60 dana.' })}
            </div>
            <div class="chips" role="group" aria-label="Brzo trajanje">${['30m', '2h', '1d', '1d12h', '7d'].map((d) => html`<button type="button" class="chip mono" data-action="ga-dur" data-v="${d}">${d}</button>`)}</div>
            ${field({ name: 'description', label: 'Opis', id: id.de, control: html`<textarea class="input" id="${id.de}" name="description" rows="3" maxlength="1000" placeholder="Uvjeti sudjelovanja, napomene…"></textarea>` })}
          </div>
          <div class="form-actions phone-full"><button type="submit" class="btn btn-primary">${icon('ti-player-play')}Pokreni giveaway</button></div></form>
        </section>
        <section class="card area-rest" aria-labelledby="ga-e-h" id="ga-ended"></section>
      </div>`);
    drawGaLists();
  }
  function drawGaLists() {
    const { ga } = state.page;
    const active = ga.filter((x) => !x.ended);
    const ended = ga.filter((x) => x.ended);
    const chan = (x) => `#${x.channelName || 'obrisan kanal'}`;
    const actEl = $('#ga-active'), endEl = $('#ga-ended');
    if (!actEl || !endEl) return;
    mount(actEl, html`<div class="card-head"><div><h2 class="card-title" id="ga-a-h">Aktivni <span class="count num">${fmtNum(active.length)}</span></h2></div>
        <div class="card-actions"><button type="button" class="btn-icon" data-action="ga-refresh" aria-label="Osvježi giveawaye" data-tip="Osvježi">${icon('ti-refresh')}</button></div></div>
      ${active.length ? html`<ul class="plain-list">${active.map((x) => html`<li class="row-wrap no-lead" style="flex-wrap:wrap">
          <span class="row-main"><span class="row-title" style="display:block">${x.prize}</span>
            <span class="row-meta num" style="display:block">${chan(x)}<span class="sep">·</span>${count(x.entrantCount, 'sudionik', 'sudionika', 'sudionika')}<span class="sep">·</span>${count(x.winnerCount, 'dobitnik', 'dobitnika', 'dobitnika')}</span>
            <span class="row-meta" style="display:block">Završava ${timeEl(x.endsAt, 'until')}</span></span>
          <span class="row-end">
            <button type="button" class="btn" data-action="ga-end" data-id="${x.messageId}">Završi sada</button>
            ${safeUrl(x.url) ? html`<a class="btn-icon" href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer" aria-label="Otvori u Discordu" data-tip="Otvori u Discordu">${icon('ti-external-link')}</a>` : ''}
            <button type="button" class="btn-icon" data-action="ga-delete" data-id="${x.messageId}" aria-label="Obriši giveaway" data-tip="Obriši">${icon('ti-trash')}</button></span></li>`)}</ul>`
        : emptyState('ti-gift', 'Nema aktivnih giveawaya. Novi pokrećeš obrascem Novi giveaway.')}`);
    mount(endEl, html`<div class="card-head"><div><h2 class="card-title" id="ga-e-h">Završeni <span class="count num">${fmtNum(ended.length)}</span></h2></div></div>
      ${ended.length ? html`<ul class="plain-list">${ended.map((x) => html`<li class="row-wrap no-lead" style="flex-wrap:wrap">
          <span class="row-main"><span class="row-title" style="display:block">${x.prize}</span>
            <span class="row-meta" style="display:block">${chan(x)}<span class="sep">·</span>Završio ${timeEl(x.endsAt)}<span class="sep">·</span>${count(x.entrantCount, 'sudionik', 'sudionika', 'sudionika')}</span>
            <span class="row-meta" style="display:block">${x.winners && x.winners.length ? html`Dobitnici: <span class="strong">${x.winners.map((w) => w.name).join(', ')}</span>` : 'Bez dobitnika'}</span></span>
          <span class="row-end">
            <button type="button" class="btn" data-action="ga-reroll" data-id="${x.messageId}">Ponovno izvuci</button>
            ${safeUrl(x.url) ? html`<a class="btn-icon" href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer" aria-label="Otvori u Discordu" data-tip="Otvori u Discordu">${icon('ti-external-link')}</a>` : ''}
            <button type="button" class="btn-icon" data-action="ga-delete" data-id="${x.messageId}" aria-label="Obriši giveaway" data-tip="Obriši">${icon('ti-trash')}</button></span></li>`)}</ul>`
        : emptyState('', 'Završeni giveawayi i njihovi dobitnici pojavit će se ovdje.')}`);
  }
  async function reloadGa() {
    const { g } = state.page;
    const res = await api('GET', g$(g.id, '/giveaways'));
    state.page.ga = res.giveaways || [];
    drawGaLists();
  }
  actions['ga-refresh'] = (btn) => run(btn, reloadGa, 'Osvježavanje nije uspjelo');
  actions['ga-dur'] = (btn) => {
    const f = btn.closest('form');
    f.elements.duration.value = btn.dataset.v;
    f.elements.duration.dispatchEvent(new Event('input', { bubbles: true }));
    f.elements.duration.focus();
  };
  forms['ga-create'] = async (f, btn) => {
    clearErrors(f);
    const { g } = state.page;
    const body = {
      channelId: formValue(f, 'channelId'),
      prize: formValue(f, 'prize').trim(),
      winnerCount: Number(formValue(f, 'winnerCount')),
      duration: formValue(f, 'duration').trim(),
      description: formValue(f, 'description').trim(),
    };
    if (!body.channelId) return fieldError(f, 'channelId', 'Odaberi kanal za giveaway.');
    if (!body.prize) return fieldError(f, 'prize', 'Upiši nagradu.');
    if (!Number.isInteger(body.winnerCount) || body.winnerCount < 1 || body.winnerCount > 50) return fieldError(f, 'winnerCount', 'Upiši broj od 1 do 50.');
    if (!/^(\d+\s*[smhdw]\s*)+$/i.test(body.duration)) return fieldError(f, 'duration', 'Upiši trajanje kao 30m, 2h ili 1d12h.');
    const ok = await run(btn, async () => {
      await api('POST', g$(g.id, '/giveaways'), body);
      await reloadGa();
    }, 'Giveaway nije pokrenut');
    if (!ok) return;
    toast('success', 'Giveaway je pokrenut', `${body.prize} u #${channelName(g, body.channelId) || ''}`);
    f.elements.prize.value = '';
    f.elements.duration.value = '';
    f.elements.description.value = '';
    f.elements.winnerCount.value = '1';
  };
  const gaById = (id) => state.page.ga.find((x) => x.messageId === id);
  actions['ga-end'] = (btn) => {
    const x = gaById(btn.dataset.id);
    if (!x) return;
    const { g } = state.page;
    confirmAction({
      title: `Završiti „${x.prize}” sada?`,
      text: `Bot odmah bira ${count(x.winnerCount, 'dobitnika', 'dobitnika', 'dobitnika')} među ${count(x.entrantCount, 'sudionikom', 'sudionika', 'sudionika')}.`,
      confirmLabel: 'Završi giveaway',
      danger: false,
      async onConfirm() {
        await api('POST', g$(g.id, `/giveaways/${encodeURIComponent(x.messageId)}/end`));
        await reloadGa();
        toast('success', 'Giveaway je završen', x.prize);
      },
    });
  };
  actions['ga-delete'] = (btn) => {
    const x = gaById(btn.dataset.id);
    if (!x) return;
    const { g } = state.page;
    confirmAction({
      title: `Obrisati giveaway „${x.prize}”?`,
      text: 'Bot briše poruku giveawaya i sve prijave. Ovo se ne može poništiti.',
      confirmLabel: 'Obriši giveaway',
      async onConfirm() {
        await api('DELETE', g$(g.id, `/giveaways/${encodeURIComponent(x.messageId)}`));
        await reloadGa();
        toast('success', 'Giveaway je obrisan', x.prize);
      },
    });
  };
  actions['ga-reroll'] = (btn) => {
    const x = gaById(btn.dataset.id);
    if (!x) return;
    const { g } = state.page;
    const id = uid('r');
    openModal({
      title: `Ponovno izvući dobitnike za „${x.prize}”?`,
      description: 'Bot bira nove dobitnike među istim sudionicima i objavljuje ih u kanalu.',
      body: html`<div class="field" data-field="count"><label class="label" for="${id}">Broj dobitnika</label>
        <input class="input" id="${id}" name="count" type="number" min="1" max="50" step="1" inputmode="numeric" value="${x.winnerCount}"></div>`,
      confirmLabel: 'Izvuci dobitnike',
      async onConfirm(form) {
        clearErrors(form);
        const n = Number(form.elements.count.value);
        if (!Number.isInteger(n) || n < 1 || n > 50) { fieldError(form, 'count', 'Upiši broj od 1 do 50.'); return false; }
        const res = await api('POST', g$(g.id, `/giveaways/${encodeURIComponent(x.messageId)}/reroll`), { count: n });
        await reloadGa();
        const names = (res.winners || []).map((w) => w.name).join(', ');
        toast('success', 'Novi dobitnici su izvučeni', names || 'Nema dovoljno sudionika.');
        return true;
      },
    });
  };

  // ---------- Music ----------
  const LOOP_MODES = [['off', 'Isključeno', 'ti-repeat-off'], ['track', 'Pjesma', 'ti-repeat-once'], ['queue', 'Red', 'ti-repeat']];
  async function pageMusic(ctx) {
    ctx.head = pageHead('Glazba', 'Puštanje glazbe u glasovnom kanalu servera.');
    mount(ctx.el, html`${ctx.head}<div class="areas rest-wide"><div class="area-main">${skelCard(260)}</div><div class="area-side">${skelCard(280)}</div><div class="area-rest">${skelCard(240)}</div></div>`);
    const g = await ctx.load(() => guildData(ctx.gid));
    if (!g) return;
    Object.assign(state.page, { g, ctx, music: null, sig: '', base: { pos: 0, at: 0 }, fails: 0 });
    const id = { q: uid('f'), vc: uid('f') };
    mount(ctx.el, html`${ctx.head}
      <div class="areas rest-wide">
        <section class="card area-main" id="np" aria-labelledby="np-h" aria-busy="true">
          <div class="card-head"><div><h2 class="card-title" id="np-h">Sada svira</h2></div></div>
          <div class="skel" style="height:96px"></div>
        </section>
        <section class="card area-side" aria-labelledby="add-h">
          <div class="card-head"><div><h2 class="card-title" id="add-h">Dodaj pjesmu</h2></div></div>
          <form class="form" data-form="music-play" novalidate><div class="fields">
            ${field({ name: 'query', label: 'Pjesma ili poveznica', id: id.q, required: true, help: 'Naziv pjesme ili poveznica na YouTube, SoundCloud ili playlistu.',
              control: html`<div class="input-wrap">${icon('ti-search', 'ti-sm')}<input class="input" id="${id.q}" name="query" autocomplete="off" placeholder="npr. Dino Merlin Godinama" aria-describedby="${id.q}-help"></div>` })}
            ${field({ name: 'voiceChannelId', label: 'Glasovni kanal', id: id.vc, required: true, hidden: true, help: 'Bot ulazi u ovaj kanal.',
              control: selectField({ id: id.vc, name: 'voiceChannelId', options: voiceChannelOptions(g), placeholder: 'Odaberi glasovni kanal', emptyText: 'Server nema glasovnih kanala.' }) })}
          </div>
          <div class="form-actions phone-full"><button type="submit" class="btn btn-primary">${icon('ti-player-play')}Pusti</button></div></form>
        </section>
        <section class="card area-rest" id="queue" aria-labelledby="q-h">
          <div class="card-head"><div><h2 class="card-title" id="q-h">Red</h2></div></div>
          ${skelRows(3)}
        </section>
      </div>`);
    await pollMusic(true);
    if (!ctx.alive()) return;
    const poll = setInterval(() => { if (!document.hidden) pollMusic(false); }, 3000);
    const tick = setInterval(tickProgress, 500);
    onCleanup(() => { clearInterval(poll); clearInterval(tick); });
  }
  let musicInflight = false;
  async function pollMusic(first) {
    const { g, ctx } = state.page;
    if (!g || musicInflight) return;
    musicInflight = true;
    if (first) loadStart();
    try {
      const m = await api('GET', g$(g.id, '/music'));
      if (!ctx.alive()) return;
      state.page.fails = 0;
      state.page.music = m;
      state.page.base = { pos: m.positionMs || 0, at: Date.now() };
      const sig = JSON.stringify([m.connected, m.paused, m.loop, m.voiceChannel, m.current, m.queue]);
      if (sig !== state.page.sig || first) {
        state.page.sig = sig;
        drawMusic();
      }
      tickProgress();
    } catch (err) {
      if (!ctx.alive() || err.status === 401) return;
      state.page.fails++;
      if (first || !state.page.music) {
        const np = $('#np');
        if (np) { np.removeAttribute('aria-busy'); mount(np, html`<div class="card-head"><div><h2 class="card-title" id="np-h">Sada svira</h2></div></div>${errorState(err, 'music-retry')}`); }
        const q = $('#queue');
        if (q) mount(q, html`<div class="card-head"><div><h2 class="card-title" id="q-h">Red</h2></div></div><p class="muted">Red se prikazuje kad se stanje glazbe učita.</p>`);
      } else if (state.page.fails === 3) {
        toast('error', 'Veza s botom je prekinuta', `${err.message} Stanje glazbe možda nije ažurno.`);
      }
    } finally {
      musicInflight = false;
      if (first) loadEnd();
    }
  }
  actions['music-retry'] = (btn) => run(btn, () => pollMusic(true));
  function currentPos() {
    const m = state.page.music;
    if (!m || !m.current) return 0;
    const { pos, at } = state.page.base;
    const p = m.paused ? pos : pos + (Date.now() - at);
    return m.current.durationMs ? Math.min(p, m.current.durationMs) : p;
  }
  function tickProgress() {
    const m = state.page.music;
    if (!m || !m.current) return;
    const p = currentPos();
    const el = $('#np-elapsed');
    if (el) el.textContent = fmtClock(p);
    const bar = $('#np-bar');
    if (bar && m.current.durationMs) {
      const pct = clamp((p / m.current.durationMs) * 100, 0, 100);
      bar.style.width = `${pct}%`;
      bar.parentElement.setAttribute('aria-valuenow', String(Math.round(p / 1000)));
      bar.parentElement.setAttribute('aria-valuetext', `${fmtClock(p)} od ${fmtClock(m.current.durationMs)}`);
    }
  }
  function drawMusic() {
    const m = state.page.music;
    const np = $('#np'), qEl = $('#queue');
    if (!np || !qEl) return;
    np.removeAttribute('aria-busy');
    const vcField = $('[data-field="voiceChannelId"]');
    if (vcField) vcField.hidden = !!m.connected;
    const sub = $('#content .page-head .sub');
    if (sub) sub.textContent = m.connected && m.voiceChannel ? `Bot je u glasovnom kanalu ${m.voiceChannel.name}.` : 'Bot nije u glasovnom kanalu.';
    const c = m.current;
    const controls = html`<div class="np-controls">
      <div class="btn-group" role="group" aria-label="Upravljanje">
        ${m.paused
          ? html`<button type="button" class="btn btn-round" data-action="music-cmd" data-cmd="resume" aria-label="Nastavi" data-tip="Nastavi" ${c ? '' : raw('disabled')}>${icon('ti-player-play')}</button>`
          : html`<button type="button" class="btn btn-round" data-action="music-cmd" data-cmd="pause" aria-label="Pauziraj" data-tip="Pauziraj" ${c ? '' : raw('disabled')}>${icon('ti-player-pause')}</button>`}
        <button type="button" class="btn btn-round" data-action="music-cmd" data-cmd="skip" aria-label="Preskoči" data-tip="Preskoči" ${c ? '' : raw('disabled')}>${icon('ti-player-skip-forward')}</button>
        <button type="button" class="btn btn-round" data-action="music-cmd" data-cmd="shuffle" aria-label="Izmiješaj red" data-tip="Izmiješaj red" ${m.queue.length > 1 ? '' : raw('disabled')}>${icon('ti-arrows-shuffle')}</button>
        <button type="button" class="btn btn-round" data-action="music-stop" aria-label="Zaustavi i izađi" data-tip="Zaustavi i izađi">${icon('ti-player-stop')}</button>
      </div>
      <div class="loop"><span class="loop-label" id="loop-l">Ponavljanje</span><div class="seg" role="radiogroup" aria-labelledby="loop-l">
        ${LOOP_MODES.map(([k, l, ic]) => html`<button type="button" role="radio" aria-checked="${String(m.loop === k)}" data-action="music-loop" data-mode="${k}" tabindex="${m.loop === k ? 0 : -1}">${icon(ic, 'ti-sm')}${l}</button>`)}
      </div></div>
    </div>`;
    if (!m.connected) {
      mount(np, html`<div class="card-head"><div><h2 class="card-title" id="np-h">Sada svira</h2></div>${statusBadge(false, '', 'Nije spojen')}</div>
        ${emptyState('ti-music-off', 'Ništa ne svira. Upiši pjesmu i odaberi glasovni kanal, a bot će ući i pustiti je.')}`);
    } else if (!c) {
      mount(np, html`<div class="card-head"><div><h2 class="card-title" id="np-h">Sada svira</h2></div><span class="badge">${icon('ti-player-pause')}Čeka</span></div>
        ${emptyState('ti-music', 'Bot je u kanalu, ali ništa ne svira. Dodaj pjesmu u red.')}${controls}`);
    } else {
      const thumb = safeUrl(c.thumbnail);
      const live = !c.durationMs;
      const url = safeUrl(c.url);
      mount(np, html`<div class="card-head"><div><h2 class="card-title" id="np-h">Sada svira</h2></div>
          ${m.paused ? html`<span class="badge badge-warning">${icon('ti-player-pause')}Pauzirano</span>` : html`<span class="badge badge-success">${icon('ti-player-play')}Svira</span>`}</div>
        <div class="np">
          <div class="np-top">
            ${thumb ? html`<img class="np-thumb" src="${thumb}" alt="" referrerpolicy="no-referrer">` : html`<span class="np-thumb" aria-hidden="true"></span>`}
            <div class="row-main">
              ${url ? html`<a class="np-title" href="${url}" target="_blank" rel="noopener noreferrer">${c.title} ${extArrow}</a>` : html`<span class="np-title">${c.title}</span>`}
              <p class="row-meta section-gap" style="margin-top:8px">Zatražio/la ${c.requestedBy ? c.requestedBy.name : 'nepoznat član'}${m.voiceChannel ? html`<span class="sep">·</span>${m.voiceChannel.name}` : ''}</p>
            </div>
          </div>
          <div>
            ${live
              ? html`<span class="badge badge-danger">${icon('ti-broadcast')}Uživo</span>`
              : html`<div class="bar" role="progressbar" aria-label="Napredak pjesme" aria-valuemin="0" aria-valuemax="${Math.round(c.durationMs / 1000)}" aria-valuenow="0"><span id="np-bar"></span></div>`}
            <div class="np-time"><span id="np-elapsed">${fmtClock(currentPos())}</span><span>${live ? 'uživo' : fmtClock(c.durationMs)}</span></div>
          </div>
          ${controls}
        </div>`);
      const img = $('img.np-thumb', np);
      if (img) img.addEventListener('error', () => { const s = document.createElement('span'); s.className = 'np-thumb'; img.replaceWith(s); }, { once: true });
    }
    const q = m.queue || [];
    const totalMs = q.reduce((s, x) => s + (x.durationMs || 0), 0);
    const shownQ = q.slice(0, 50);
    mount(qEl, html`<div class="card-head"><div><h2 class="card-title" id="q-h">Red <span class="count num">${fmtNum(q.length)}</span></h2>
        ${q.length ? html`<p class="card-desc num">${count(q.length, 'pjesma', 'pjesme', 'pjesama')} · ${fmtDur(totalMs)}</p>` : ''}</div></div>
      ${q.length ? html`<ol class="plain-list">${shownQ.map((x, i) => html`<li>
          <span class="q-index">${i + 1}</span>
          ${safeUrl(x.thumbnail) ? html`<img class="q-thumb" src="${safeUrl(x.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<span class="q-thumb" aria-hidden="true"></span>`}
          <span class="row-main"><span class="row-title truncate" style="display:block" data-tip="${x.title}">${x.title}</span>
            <span class="row-meta num">${x.durationMs ? fmtClock(x.durationMs) : 'uživo'}<span class="sep">·</span>${x.requestedBy ? x.requestedBy.name : ''}</span></span>
          <button type="button" class="btn-icon" data-action="music-remove" data-i="${i}" aria-label="Ukloni ${x.title} iz reda" data-tip="Ukloni iz reda">${icon('ti-trash')}</button>
        </li>`)}</ol>
        ${q.length > shownQ.length ? html`<p class="muted section-gap num">I još ${count(q.length - shownQ.length, 'pjesma', 'pjesme', 'pjesama')}.</p>` : ''}`
      : emptyState('ti-playlist', 'Red je prazan. Pjesme koje dodaš pojavit će se ovdje.')}`);
  }
  actions['music-cmd'] = async (btn) => {
    const { g } = state.page;
    const cmd = btn.dataset.cmd;
    const labels = { pause: 'Pauzirano', resume: 'Nastavljeno', skip: 'Preskočeno', shuffle: 'Red je izmiješan' };
    const ok = await run(btn, async () => {
      await api('POST', g$(g.id, `/music/${cmd}`));
      state.page.sig = '';
      await pollMusic(false);
    }, 'Naredba nije uspjela');
    if (document.activeElement === document.body || !document.activeElement.isConnected) {
      const next = { pause: 'resume', resume: 'pause' }[cmd] || cmd;
      const target = $(`[data-action="music-cmd"][data-cmd="${next}"]:not(:disabled)`) || $('[data-action="music-stop"]');
      if (target) target.focus({ preventScroll: true });
    }
    if (ok && (cmd === 'shuffle' || cmd === 'skip')) toast('success', labels[cmd]);
  };
  actions['music-stop'] = (btn) => {
    const { g, music } = state.page;
    const doStop = async () => {
      await api('POST', g$(g.id, '/music/stop'));
      state.page.sig = '';
      await pollMusic(false);
      toast('success', 'Glazba je zaustavljena', 'Bot je izašao iz glasovnog kanala.');
    };
    if (music && music.queue && music.queue.length) {
      confirmAction({
        title: 'Zaustaviti glazbu?',
        text: `Bot briše red od ${count(music.queue.length, 'pjesme', 'pjesme', 'pjesama')} i izlazi iz glasovnog kanala.`,
        confirmLabel: 'Zaustavi glazbu',
        onConfirm: doStop,
      });
    } else {
      run(btn, doStop, 'Zaustavljanje nije uspjelo');
    }
  };
  actions['music-loop'] = async (btn) => {
    const { g, music } = state.page;
    const mode = btn.dataset.mode;
    if (!music || music.loop === mode) return;
    const group = btn.parentElement;
    const prev = music.loop;
    $$('[role="radio"]', group).forEach((b) => { b.setAttribute('aria-checked', String(b === btn)); b.tabIndex = b === btn ? 0 : -1; });
    try {
      await api('PUT', g$(g.id, '/music/loop'), { mode });
      music.loop = mode;
      state.page.sig = '';
    } catch (err) {
      $$('[role="radio"]', group).forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.mode === prev)); b.tabIndex = b.dataset.mode === prev ? 0 : -1; });
      reportError(err, 'Ponavljanje nije promijenjeno');
    }
  };
  document.addEventListener('keydown', (e) => {
    const r = e.target.closest && e.target.closest('[role="radiogroup"] [role="radio"]');
    if (!r || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const all = $$('[role="radio"]', r.parentElement);
    const i = all.indexOf(r);
    const n = all[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length];
    n.focus();
    n.click();
  });
  actions['music-remove'] = async (btn) => {
    const { g } = state.page;
    const ok = await run(btn, async () => {
      await api('DELETE', g$(g.id, `/music/queue/${Number(btn.dataset.i)}`));
      state.page.sig = '';
      await pollMusic(false);
    }, 'Uklanjanje nije uspjelo');
    if (ok) toast('success', 'Pjesma je uklonjena iz reda');
  };
  forms['music-play'] = async (f, btn) => {
    clearErrors(f);
    const { g, music } = state.page;
    const query = formValue(f, 'query').trim();
    const voiceChannelId = formValue(f, 'voiceChannelId');
    if (!query) return fieldError(f, 'query', 'Upiši naziv pjesme ili zalijepi poveznicu.');
    if (!(music && music.connected) && !voiceChannelId) return fieldError(f, 'voiceChannelId', 'Odaberi glasovni kanal u koji bot ulazi.');
    let res;
    const ok = await run(btn, async () => {
      res = await api('POST', g$(g.id, '/music/play'), { query, voiceChannelId: voiceChannelId || null });
    }, 'Pjesma nije dodana');
    if (!ok) return;
    f.elements.query.value = '';
    const added = res.added || 1;
    toast('success', added > 1 ? `Dodano ${count(added, 'pjesma', 'pjesme', 'pjesama')}` : 'Dodano u red', res.title || '');
    state.page.sig = '';
    pollMusic(false);
  };

  // ---------- Appearance (accent picker) ----------
  actions.appearance = () => {
    closeDrawer(false);
    const saved = loadAccentChoice();
    let choice = { ...saved };
    const sid = uid('a'), cid = uid('a'), hid = uid('a');
    const customHex = saved.custom || '#5865f2';
    const options = [
      ...Object.keys(PALETTES).map((k) => ({ value: k, label: k === 'blue' ? `${PALETTES[k].name} (zadano)` : PALETTES[k].name, lead: html`<span class="dot" style="background:${PALETTES[k][700]}"></span>` })),
      { value: 'custom', label: 'Prilagođena boja', lead: html`<span class="dot" data-custom-dot style="background:${customHex}"></span>` },
    ];
    openModal({
      title: 'Izgled',
      description: 'Boja naglaska mijenja gumbe, poveznice, oznaku aktivne stranice i trake napretka. Sprema se samo u ovom pregledniku.',
      size: 'sm',
      body: html`<div class="fields">
        ${field({ name: 'accent', label: 'Boja naglaska', id: sid, control: selectField({ id: sid, name: 'accent', options, value: saved.custom ? 'custom' : saved.preset, searchable: false, placeholder: 'Odaberi boju' }) })}
        <div class="field" data-field="custom" ${saved.custom ? '' : raw('hidden')}>
          <label class="label" for="${cid}">Prilagođena boja</label>
          <div class="input-color"><input type="color" id="${cid}" value="${customHex}" aria-describedby="${cid}-help">
            <input class="input mono" id="${hid}" value="${customHex}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Heksadecimalni kod boje" style="max-width:128px"></div>
          <p class="help" id="${cid}-help">Ako je boja presvijetla za bijeli tekst, automatski se zatamni dok tekst ne postane čitljiv.</p>
        </div></div>`,
      confirmLabel: 'Spremi izgled',
      onOpen(form) {
        const sel = $('.select', form);
        const color = $(`#${cid}`, form);
        const hex = $(`#${hid}`, form);
        const customField = $('[data-field="custom"]', form);
        const dot = () => $('[data-custom-dot]', form);
        const apply = () => { try { applyAccent(tokensFor(choice)); } catch { /* ignore */ } };
        $('input[type="hidden"]', sel).addEventListener('change', (e) => {
          const v = e.target.value;
          customField.hidden = v !== 'custom';
          choice = v === 'custom' ? { custom: color.value } : { preset: v };
          apply();
        });
        const setCustom = (v) => {
          choice = { custom: v.toLowerCase() };
          const d = dot();
          if (d) d.style.background = v;
          const shown = $('.select-value .dot', sel);
          if (shown) shown.style.background = v;
          apply();
        };
        color.addEventListener('input', () => { hex.value = color.value; setCustom(color.value); });
        hex.addEventListener('input', () => {
          const v = hex.value.trim();
          if (/^#[0-9a-f]{6}$/i.test(v)) { color.value = v.toLowerCase(); setCustom(v); }
        });
      },
      async onConfirm() {
        saveAccentChoice(choice);
        toast('success', 'Izgled je spremljen');
        return true;
      },
      onClose(confirmed) {
        if (!confirmed) applyAccent(tokensFor(loadAccentChoice()));
      },
    });
  };

  const PAGES = {
    overview: pageOverview,
    welcome: pageWelcome,
    stats: pageStats,
    tickets: pageTickets,
    invites: pageInvites,
    reactionroles: pageReactionRoles,
    giveaways: pageGiveaways,
    music: pageMusic,
  };

  /* =====================================================================
   * 10. Boot
   * ===================================================================== */

  async function boot() {
    initTooltips();
    initSelects();
    initMenus();
    initDelegation();
    // Broken avatar images fall back to initials.
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (img && img.tagName === 'IMG' && img.classList.contains('avatar')) {
        const span = document.createElement('span');
        span.className = img.className;
        span.setAttribute('aria-hidden', 'true');
        span.textContent = img.dataset.initials || '?';
        img.replaceWith(span);
      }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#sidebar.is-open') && !$('.modal-backdrop')) closeDrawer(true);
    });
    // Keep relative times fresh.
    setInterval(() => {
      $$('time[data-ts]').forEach((t) => {
        const ts = Number(t.dataset.ts);
        t.textContent = (t.dataset.prefix || '') + (t.dataset.mode === 'until' ? untilText(ts) : relTime(ts));
      });
    }, 15000);
    loadStart();
    try {
      state.me = await api('GET', '/api/me');
    } catch (err) {
      if (err.status !== 401) renderFatal(err);
      return;
    } finally {
      loadEnd();
    }
    state.me.guilds = state.me.guilds || [];
    renderShellFrame();
    window.addEventListener('hashchange', router);
    router();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
