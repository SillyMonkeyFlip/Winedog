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
    showGreeting(data.account);
    $('home').hidden = false;
    startClock();
    window.WineDogGames?.start();
  }

  // "Good evening, Sam" above the clock. Uses the name from the dev panel,
  // or the start of the email if no name was set.
  let greetName = '';
  function showGreeting(account) {
    const a = account || {};
    greetName = (a.name || '').trim() || String(a.email || '').split('@')[0];
    const wrap = document.querySelector('#home-content .clock-wrap');
    if (!wrap) return;
    let g = $('greeting');
    if (!g) {
      g = document.createElement('div');
      g.id = 'greeting';
      g.className = 'greeting';
      wrap.prepend(g);
    }
    updateGreeting();
  }
  function updateGreeting() {
    const g = $('greeting');
    if (!g) return;
    const h = new Date().getHours();
    const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
    g.textContent = greetName ? `${part}, ${greetName}` : part; // textContent, so names can't inject HTML
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
      if (now.getSeconds() === 0) updateGreeting();
      if (d) d.textContent = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  // Intro animation. Setting "intro": "login" (default), "open" (every visit) or "off".
  function intro(reason) {
    const mode = (window.WDSettings?.get().intro) || 'login';
    if (mode === 'off' || !window.WDSplash) return;
    if (reason === 'open') {
      if (mode !== 'open' || sessionStorage.getItem('wd_intro_seen')) return;
    }
    sessionStorage.setItem('wd_intro_seen', '1');
    window.WDSplash.play();
  }

  async function boot() {
    if (!localStorage.getItem(KEY)) return showLogin();
    try {
      const data = await api('/api/me');
      intro('open');
      showHome(data);
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
      const data = await api('/api/me');
      intro('login');
      showHome(data);
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
