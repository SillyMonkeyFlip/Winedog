(() => {
  const API = window.WINEDOG_API;
  const KEY = 'winedog_admin';
  const $ = (id) => document.getElementById(id);
  let accounts = [];
  let emailConfigured = false;
  let editing = null;
  let sessionsFor = null;

  // ---------- api ----------
  function token() {
    try {
      const t = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (t && t.exp > Date.now()) return t.token;
    } catch {}
    localStorage.removeItem(KEY);
    return null;
  }

  async function api(path, opts = {}) {
    const t = token();
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/admin/login') {
      localStorage.removeItem(KEY);
      showLogin();
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    return data;
  }

  // ---------- helpers ----------
  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e[k] = v;
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  function when(sec) {
    if (!sec) return 'Never';
    const diff = Date.now() / 1000 - sec;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' days ago';
    return new Date(sec * 1000).toLocaleDateString();
  }

  function full(sec) { return sec ? new Date(sec * 1000).toLocaleString() : ''; }

  function device(ua) {
    if (!ua) return 'Unknown device';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return br + ' on ' + os;
  }

  let toastTimer;
  function toast(msg) {
    document.querySelector('.toast')?.remove();
    const t = el('div', { class: 'toast', textContent: msg });
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 4000);
  }

  function mailto(to, text) {
    location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent('Your WineDog code') + '&body=' + encodeURIComponent(text);
  }

  async function randomInto(input) {
    try { input.value = (await api('/api/admin/random-code')).code; } catch (e) { toast(e.message); }
  }

  // ---------- views ----------
  function showLogin() {
    $('panel').hidden = true;
    $('login').hidden = false;
    $('password').focus();
  }

  async function showPanel() {
    $('login').hidden = true;
    $('panel').hidden = false;
    await load();
  }

  async function load() {
    const data = await api('/api/admin/accounts');
    accounts = data.accounts;
    emailConfigured = data.emailConfigured;
    $('email-banner').hidden = emailConfigured;
    render();
  }

  function render() {
    const rows = $('rows');
    rows.replaceChildren();
    $('count').textContent = `Accounts (${accounts.length})`;
    $('empty').hidden = accounts.length > 0;
    for (const a of accounts) {
      const tags = el('div', {},
        el('span', { class: 'tag' + (a.role === 'Special' ? ' special' : ''), textContent: a.role }),
        a.disabled ? el('span', { class: 'tag off', textContent: 'Disabled', style: 'margin-left:6px' }) : null,
      );
      rows.append(el('tr', {},
        el('td', {}, el('div', { textContent: a.email }), a.name ? el('div', { class: 'muted', textContent: a.name }) : null),
        el('td', {}, tags),
        el('td', { class: 'code', textContent: a.code }),
        el('td', { textContent: when(a.last_login_at), title: full(a.last_login_at) }),
        el('td', {}, el('button', { class: 'small', textContent: String(a.session_count), onclick: () => openSessions(a) })),
        el('td', { class: 'notes', textContent: a.notes }),
        el('td', {}, el('div', { class: 'actions' },
          el('button', { class: 'small', textContent: 'Email code', title: a.code_sent_at ? 'Last sent ' + full(a.code_sent_at) : 'Never sent', onclick: () => sendEmail(a) }),
          el('button', { class: 'small', textContent: 'Edit', onclick: () => openEdit(a) }),
          el('button', { class: 'small', textContent: a.disabled ? 'Enable' : 'Disable', onclick: () => toggle(a) }),
          el('button', { class: 'small danger', textContent: 'Delete', onclick: () => remove(a) }),
        )),
      ));
    }
  }

  // ---------- actions ----------
  async function sendEmail(a) {
    try {
      const r = await api(`/api/admin/accounts/${a.id}/email`, { method: 'POST' });
      if (r.sent) { toast('Code sent to ' + r.to); load(); }
      else { toast(r.reason); mailto(r.to, r.text); }
    } catch (e) { toast(e.message); }
  }

  async function toggle(a) {
    try {
      await api(`/api/admin/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ disabled: !a.disabled }) });
      toast(a.disabled ? 'Account enabled' : 'Account disabled and signed out everywhere');
      load();
    } catch (e) { toast(e.message); }
  }

  async function remove(a) {
    if (!confirm(`Delete ${a.email}? This can't be undone.`)) return;
    try {
      await api(`/api/admin/accounts/${a.id}`, { method: 'DELETE' });
      toast('Account deleted');
      load();
    } catch (e) { toast(e.message); }
  }

  function openEdit(a) {
    editing = a;
    $('e-email').value = a.email;
    $('e-name').value = a.name;
    $('e-role').value = a.role;
    $('e-code').value = a.code;
    $('e-notes').value = a.notes;
    $('edit-error').textContent = '';
    $('edit').showModal();
  }

  async function openSessions(a) {
    sessionsFor = a;
    $('s-title').textContent = 'Sessions · ' + a.email;
    $('s-list').replaceChildren(el('p', { class: 'muted', textContent: 'Loading…' }));
    $('sessions').showModal();
    await renderSessions();
  }

  async function renderSessions() {
    const list = $('s-list');
    try {
      const { sessions } = await api(`/api/admin/accounts/${sessionsFor.id}/sessions`);
      list.replaceChildren();
      if (!sessions.length) list.append(el('p', { class: 'muted', textContent: 'Not signed in on any device.' }));
      for (const s of sessions) {
        list.append(el('div', { class: 'session' },
          el('div', {},
            el('div', { textContent: device(s.user_agent) + (s.location ? ' · ' + s.location : '') }),
            el('div', { class: 'ua', textContent: `Signed in ${full(s.created_at)} · Last seen ${when(s.last_seen_at)}${s.ip ? ' · ' + s.ip : ''}` }),
          ),
          el('button', { class: 'small danger', textContent: 'Sign out', onclick: async () => {
            try { await api(`/api/admin/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }); await renderSessions(); load(); }
            catch (e) { toast(e.message); }
          } }),
        ));
      }
    } catch (e) {
      list.replaceChildren(el('p', { class: 'error', textContent: e.message }));
    }
  }

  // ---------- events ----------
  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-error').textContent = '';
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
      localStorage.setItem(KEY, JSON.stringify({ token: r.token, exp: Date.now() + r.expiresIn * 1000 }));
      $('password').value = '';
      showPanel();
    } catch (e) {
      $('login-error').textContent = e.status ? e.message : 'Could not reach the server.';
    }
  });

  $('logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem(KEY);
    showLogin();
  });

  $('refresh').addEventListener('click', () => load().catch((e) => toast(e.message)));
  $('c-random').addEventListener('click', () => randomInto($('c-code')));
  $('e-random').addEventListener('click', () => randomInto($('e-code')));

  $('create-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('create-error').textContent = '';
    try {
      const r = await api('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({
          email: $('c-email').value,
          name: $('c-name').value,
          role: $('c-role').value,
          code: $('c-code').value.trim(),
          notes: $('c-notes').value,
          sendEmail: $('c-send').checked,
        }),
      });
      if (r.email && !r.email.sent) { toast(r.email.reason); mailto(r.email.to, r.email.text); }
      else toast(r.email?.sent ? `Account created and code ${r.code} emailed` : `Account created with code ${r.code}`);
      ev.target.reset();
      load();
    } catch (e) {
      $('create-error').textContent = e.message;
    }
  });

  $('edit-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await api(`/api/admin/accounts/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          email: $('e-email').value,
          name: $('e-name').value,
          role: $('e-role').value,
          code: $('e-code').value.trim(),
          notes: $('e-notes').value,
        }),
      });
      $('edit').close();
      toast(r.loggedOut ? 'Saved. Code changed, so they were signed out everywhere.' : 'Saved');
      load();
    } catch (e) {
      $('edit-error').textContent = e.message;
    }
  });
  $('e-cancel').addEventListener('click', () => $('edit').close());

  $('s-close').addEventListener('click', () => $('sessions').close());
  $('s-all').addEventListener('click', async () => {
    try {
      await api(`/api/admin/accounts/${sessionsFor.id}/sessions`, { method: 'DELETE' });
      await renderSessions();
      load();
    } catch (e) { toast(e.message); }
  });

  // ---------- start ----------
  if (token()) showPanel().catch(() => showLogin());
  else showLogin();
})();
