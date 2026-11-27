(() => {
  const API = window.WINEDOG_API;
  const KEY = 'winedog_token';
  const $ = (id) => document.getElementById(id);
  let clockTimer = null;

  async function api(path, opts = {}) {
    const token = localStorage.getItem(KEY);
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
    return data;
  }

  function showLogin() {
    $('home').hidden = true;
    $('login').hidden = false;
    $('code').focus();
  }

  function showHome(data) {
    $('login').hidden = true;
    $('home-content').innerHTML = data.home; // HTML from our own Worker
    $('home').hidden = false;
    startClock();
    window.WineDogGames?.start();
  }

  function startClock() {
    clearInterval(clockTimer);
    const c = $('clock');
    const d = $('date');
    if (!c) return;
    const tick = () => {
      const now = new Date();
      const set = window.WDSettings ? window.WDSettings.get() : {};
      const opts = { hour: '2-digit', minute: '2-digit', hour12: !set.clock24 };
      if (set.clockSeconds !== false) opts.second = '2-digit';
      c.textContent = now.toLocaleTimeString([], opts);
      if (d) d.textContent = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  async function boot() {
    if (!localStorage.getItem(KEY)) return showLogin();
    try {
      showHome(await api('/api/me'));
    } catch (e) {
      if (e.status === 401) localStorage.removeItem(KEY);
      showLogin();
      if (e.status !== 401) $('login-error').textContent = 'Could not reach the server. Try again shortly.';
    }
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('login-btn');
    $('login-error').textContent = '';
    btn.disabled = true;
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ code: $('code').value }),
      });
      localStorage.setItem(KEY, r.token);
      $('code').value = '';
      showHome(await api('/api/me'));
    } catch (e) {
      $('login-error').textContent = e.status ? e.message : 'Could not reach the server.';
    } finally {
      btn.disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem(KEY);
    clearInterval(clockTimer);
    window.WineDogGames?.stop();
    $('home-content').innerHTML = '';
    showLogin();
  });

  boot();
})();
