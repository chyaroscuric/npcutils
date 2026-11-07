/* BYOT manager UI. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => `<i class="ti ${n}" aria-hidden="true"></i>`;
  const state = { me: null, bots: [], logBot: null, logs: [], busy: false };

  const avatar = (url, name, cls = 'avatar-sm') => {
    const initials = String(name || '?').trim().slice(0, 2).toUpperCase();
    return url
      ? `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="avatar ${cls}" aria-hidden="true">${esc(initials)}</span>`;
  };

  const statusBadge = (s) => {
    const map = {
      running: ['badge-success', 'Radi'],
      starting: ['badge-warning', 'Pokreće se'],
      stopped: ['', 'Zaustavljen'],
      error: ['badge-danger', 'Greška'],
    };
    const [cls, text] = map[s] || map.stopped;
    return `<span class="badge ${cls}">${esc(text)}</span>`;
  };

  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      opts.headers['X-Manager'] = '1';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body ?? {});
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401) {
      renderSignIn();
      throw new Error('Sesija je istekla.');
    }
    if (!res.ok) throw new Error(data?.error || `Greška ${res.status}`);
    return data || {};
  }

  function toast(type, title, sub) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `${icon(type === 'error' ? 'ti-circle-x' : 'ti-circle-check')}<div class="toast-text"><p class="toast-title">${esc(title)}</p>${sub ? `<p class="toast-sub">${esc(sub)}</p>` : ''}</div>`;
    box.append(el);
    setTimeout(() => el.remove(), 5000);
  }

  function renderSignIn() {
    document.title = 'Prijava · Bot Manager';
    const app = $('#app');
    app.removeAttribute('aria-busy');
    app.innerHTML = `<main class="signin"><div class="signin-box">
      ${icon('ti-robot', 'faint')}
      <h1>Bot Manager</h1>
      <p>Prijavi se Discordom i dodaj svoj bot token. Svaki bot dobiva isti panel i svoje podatke.</p>
      <a class="btn btn-primary" href="/login">${icon('ti-brand-discord')}Prijavi se s Discordom</a>
    </div></main>`;
  }

  function renderApp() {
    document.title = 'Bot Manager';
    const app = $('#app');
    app.removeAttribute('aria-busy');
    app.innerHTML = `<div class="shell">
      <main class="main" style="margin-left:0"><div class="content">
        <header class="page-head">
          <div><h1 tabindex="-1">Bot Manager</h1><p class="sub">Dodaj bot token i otvori njegov panel. Svaki bot radi u zasebnom procesu.</p></div>
          <div class="page-actions" style="display:flex;align-items:center;gap:12px">
            ${avatar(state.me.user.avatarUrl, state.me.user.displayName)}
            <span class="truncate">${esc(state.me.user.displayName)}</span>
            <a class="btn" href="/logout">${icon('ti-logout')}Odjava</a>
          </div>
        </header>
        <div class="cols cols-form-right">
          <div class="stack">
            <section class="card">
              <div class="card-head"><div><h2 class="card-title">Dodaj bota</h2><p class="card-desc">Token se čuva enkriptiran i nikad se više ne prikazuje.</p></div></div>
              <form id="add-bot" class="form">
                <div class="fields">
                  <div class="field">
                    <label class="label" for="token">Bot token</label>
                    <input class="input" id="token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="MTIz...">
                    <p class="help">Discord Developer Portal → Bot → Reset Token. Prije dodavanja uključi <strong>sva 3 Privileged Gateway Intents</strong>: <strong>Presence</strong>, <strong>Server Members</strong> i <strong>Message Content</strong>.</p>
                  </div>
                </div>
                <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('ti-plus')}Dodaj bota</button></div>
              </form>
            </section>
            <section class="card">
              <div class="card-head"><div><h2 class="card-title">Tvoji botovi <span class="count num">${state.bots.length}</span></h2></div></div>
              <div id="bot-list"></div>
            </section>
          </div>
          <div class="stack">
            <aside class="callout callout-warning">${icon('ti-alert-triangle')}<div>
              <p class="callout-title">Uključi sva 3 Gateway Intents</p>
              <p class="callout-body">U Discord Developer Portalu → Bot uključi <strong>Presence Intent</strong>, <strong>Server Members Intent</strong> i <strong>Message Content Intent</strong>. Bez sva tri bota neće raditi kako treba.</p>
            </div></aside>
            <aside class="callout callout-info">${icon('ti-info-circle')}<div>
              <p class="callout-title">Kako radi BYOT</p>
              <p class="callout-body">Ti daješ svoj token, panel pokreće bota u zasebnom procesu. Podaci, postavke i baze su odvojeni za svakog bota.</p>
            </div></aside>
            <section class="card" id="logs-card" hidden>
              <div class="card-head"><div><h2 class="card-title">Logovi</h2><p class="card-desc" id="logs-name"></p></div><button class="btn-icon" id="logs-close" aria-label="Zatvori">${icon('ti-x')}</button></div>
              <pre class="mono" id="logs" style="max-height:420px;overflow:auto;white-space:pre-wrap;font-size:12px"></pre>
            </section>
          </div>
        </div>
      </div></main>
    </div>`;
    renderBots();
  }

  function renderBots() {
    const box = $('#bot-list');
    if (!box) return;
    if (!state.bots.length) {
      box.innerHTML = `<div class="empty">${icon('ti-robot-off')}<p>Još nemaš dodanog bota. Zalijepi token gore.</p></div>`;
      return;
    }
    box.innerHTML = `<ul class="plain-list">${state.bots.map((b) => `<li style="align-items:flex-start;gap:12px">
      ${avatar(b.avatarUrl, b.name, 'avatar')}
      <span class="row-main">
        <span class="row-title" style="display:block">${esc(b.name)} ${statusBadge(b.status)}</span>
        <span class="row-meta mono" style="display:block">${esc(b.id)}</span>
        ${b.error ? `<span class="row-meta danger-text" style="display:block">${esc(b.error)}</span>` : ''}
        <span class="btn-group" style="margin-top:10px">
          <a class="btn btn-primary" href="/b/${encodeURIComponent(b.id)}/">${icon('ti-external-link')}Otvori panel</a>
          ${b.running ? `<button class="btn" data-action="stop" data-id="${esc(b.id)}">Zaustavi</button>` : `<button class="btn" data-action="start" data-id="${esc(b.id)}">Pokreni</button>`}
          <button class="btn" data-action="restart" data-id="${esc(b.id)}">Restart</button>
          <button class="btn" data-action="logs" data-id="${esc(b.id)}">Logovi</button>
          <button class="btn btn-danger" data-action="delete" data-id="${esc(b.id)}">Obriši</button>
        </span>
      </span>
    </li>`).join('')}</ul>`;
  }

  async function refresh() {
    try {
      const data = await api('GET', '/api/me');
      state.me = data;
      state.bots = data.bots || [];
      renderBots();
    } catch (err) {
      if (err.message !== 'Sesija je istekla.') toast('error', 'Osvježavanje nije uspjelo', err.message);
    }
  }

  async function openLogs(id) {
    try {
      const data = await api('GET', `/api/bots/${encodeURIComponent(id)}/logs`);
      state.logBot = id;
      state.logs = data.logs || [];
      const card = $('#logs-card');
      if (card) {
        card.hidden = false;
        $('#logs-name').textContent = state.bots.find((b) => b.id === id)?.name || id;
        $('#logs').textContent = state.logs.length ? state.logs.join('\n') : 'Nema logova.';
      }
    } catch (err) {
      toast('error', 'Logovi nisu dostupni', err.message);
    }
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('#add-bot');
    if (!form) return;
    e.preventDefault();
    if (state.busy) return;
    state.busy = true;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await api('POST', '/api/bots', { token: form.elements.token.value.trim() });
      form.reset();
      toast('success', 'Bot je dodan', 'Pokrećem bota…');
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
    } catch (err) {
      toast('error', 'Bota nije moguće dodati', err.message);
    } finally {
      state.busy = false;
      btn.disabled = false;
    }
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'logs') return openLogs(id);
    if (action === 'delete') {
      if (!confirm('Obrisati bota i sve njegove podatke? Ovo se ne može poništiti.')) return;
      try {
        await api('DELETE', `/api/bots/${encodeURIComponent(id)}`);
        toast('success', 'Bot je obrisan');
        await refresh();
      } catch (err) { toast('error', 'Brisanje nije uspjelo', err.message); }
      return;
    }
    if (['start', 'stop', 'restart'].includes(action)) {
      try {
        await api('POST', `/api/bots/${encodeURIComponent(id)}/${action}`);
        toast('success', 'Akcija je pokrenuta', action);
        await new Promise((r) => setTimeout(r, 1200));
        await refresh();
      } catch (err) { toast('error', 'Akcija nije uspjela', err.message); }
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#logs-close')) $('#logs-card').hidden = true;
  });

  async function boot() {
    try {
      const data = await api('GET', '/api/me');
      state.me = data;
      state.bots = data.bots || [];
      renderApp();
      setInterval(refresh, 5000);
    } catch {
      // api() already rendered the sign-in screen on 401
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
