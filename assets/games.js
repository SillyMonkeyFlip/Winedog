// WineDog games tab: list, search, favorites, recently played and the game player.
(() => {
  const $ = (id) => document.getElementById(id);
  const LS = {
    fav: 'wd_favorites',
    recent: 'wd_recent',
    muted: 'wd_muted',
  };
  const MAX_RECENT = 8;

  let games = [];
  let byPath = new Map();
  let current = null;
  let started = false;
  let loading = null;

  // ---------------------------------------------------------------- storage

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const favorites = () => read(LS.fav, []);
  const recents = () => read(LS.recent, []);
  const isMuted = () => read(LS.muted, false);

  // ---------------------------------------------------------------- helpers

  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const gameUrl = (g) => `/Games/${enc(g.path)}/index.html`;
  const iconUrl = (g) => (g.icon ? `/Games/${enc(g.path)}/${enc(g.icon)}` : null);

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e[k] = v;
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  // A plain letter tile for games without a picture.
  function initials(name) {
    const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  }
  function hue(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }

  function thumb(g, cls = 'thumb') {
    const src = iconUrl(g);
    const fallback = () => el('div', { class: cls + ' letter', textContent: initials(g.name), style: `--h:${hue(g.name)}` });
    if (!src) return fallback();
    const img = el('img', { class: cls, src, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    return img;
  }

  // ---------------------------------------------------------------- list

  function card(g) {
    const fav = favorites().includes(g.path);
    return el('a', { class: 'game', href: '#play/' + enc(g.path), title: g.name },
      thumb(g),
      el('span', { class: 'game-name', textContent: g.name }),
      fav ? el('span', { class: 'game-star', textContent: '★', title: 'Favorite' }) : null,
    );
  }

  function fill(grid, list) {
    grid.replaceChildren(...list.map(card));
  }

  function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function renderList() {
    const q = normalize($('search').value);
    const searching = q.length > 0;
    const favs = favorites().map((p) => byPath.get(p)).filter(Boolean);
    const recent = recents().map((p) => byPath.get(p)).filter(Boolean);

    $('fav-section').hidden = searching || favs.length === 0;
    $('recent-section').hidden = searching || recent.length === 0;
    if (!searching) {
      fill($('fav-grid'), favs);
      fill($('recent-grid'), recent);
    }

    const shown = searching
      ? games.filter((g) => normalize(g.name).includes(q) || normalize(g.path).includes(q))
      : games;
    $('all-title').textContent = searching ? `Results (${shown.length})` : 'All games';
    fill($('all-grid'), shown);
    $('no-results').hidden = shown.length > 0;
    $('game-count').textContent = games.length ? `· ${games.length}` : '';
  }

  async function loadGames() {
    if (loading) return loading;
    loading = fetch('/Games/games.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((data) => {
        games = (data.games || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        byPath = new Map(games.map((g) => [g.path, g]));
      })
      .catch(() => { games = []; byPath = new Map(); });
    return loading;
  }

  // ---------------------------------------------------------------- player

  function sendMute() {
    const muted = isMuted();
    window.__wdMuted = muted;
    $('btn-mute').classList.toggle('on', muted);
    $('btn-mute').title = muted ? 'Unmute' : 'Mute';
    const frame = $('game-frame');
    try { frame.contentWindow?.postMessage({ __wdMute: muted }, location.origin); } catch {}
    // Fallback for pages the helper script didn't reach.
    try {
      frame.contentDocument?.querySelectorAll('audio,video').forEach((m) => { m.muted = muted; });
    } catch {}
  }

  function updateFavButton() {
    const on = current && favorites().includes(current.path);
    $('btn-fav').classList.toggle('on', !!on);
    $('btn-fav').title = on ? 'Remove from favorites' : 'Add to favorites';
  }

  async function swReady() {
    if (!('serviceWorker' in navigator)) return;
    await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 1500))]);
  }

  async function play(g) {
    current = g;
    $('player-title').textContent = g.name;
    const icon = $('player-icon');
    const src = iconUrl(g);
    icon.hidden = !src;
    if (src) icon.src = src;
    window.WDSettings.setTitle(g.name + ' · WineDog');
    updateFavButton();
    sendMute();
    write(LS.recent, [g.path, ...recents().filter((p) => p !== g.path)].slice(0, MAX_RECENT));
    await swReady();
    if (current !== g) return; // user moved on while waiting
    const frame = $('game-frame');
    frame.src = gameUrl(g);
    frame.focus();
  }

  function stopGame() {
    current = null;
    const frame = $('game-frame');
    if (frame.getAttribute('src')) frame.src = 'about:blank';
    window.WDSettings.setTitle('WineDog');
  }

  // Opens the game in a separate blank window, so the address bar shows about:blank.
  function popOut() {
    if (!current) return;
    const g = current;
    const w = window.open('about:blank', '_blank');
    if (!w) { toast('Your browser blocked the pop-up. Allow pop-ups for this site and try again.'); return; }
    const d = w.document;
    const look = window.WDSettings.get();
    d.title = look.tabTitle || g.name;
    const link = d.createElement('link');
    link.rel = 'icon';
    link.href = look.tabIcon || (iconUrl(g) ? location.origin + iconUrl(g) : location.origin + '/assets/favicon-32.png');
    d.head.append(link);
    d.body.style.cssText = 'margin:0;height:100vh;background:#000;overflow:hidden';
    const f = d.createElement('iframe');
    f.src = location.origin + gameUrl(g);
    f.allow = 'fullscreen; autoplay; gamepad; clipboard-read; clipboard-write';
    f.allowFullscreen = true;
    f.style.cssText = 'border:0;width:100%;height:100%;display:block';
    d.body.append(f);
    f.focus();
    // Stop it here so it isn't playing twice.
    location.hash = '#games';
  }

  function fullscreen() {
    const wrap = $('frame-wrap');
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    if (req) req.call(wrap).catch?.(() => toast('Fullscreen is not available here.'));
    else toast('Fullscreen is not available here.');
  }

  // ---------------------------------------------------------------- routing

  function show(view) {
    for (const id of ['view-home', 'view-games', 'view-player', 'view-settings']) $(id).hidden = id !== view;
    const tab = view === 'view-home' ? 'home' : view === 'view-settings' ? 'settings' : 'games';
    document.querySelectorAll('.rail .tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  }

  async function route() {
    if (!started) return;
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith('play/')) {
      await loadGames();
      const g = byPath.get(h.slice(5));
      if (g) {
        show('view-player');
        if (current !== g) play(g);
        return;
      }
      location.replace('#games');
      return;
    }
    stopGame();
    if (h === 'settings') {
      show('view-settings');
      window.WDSettingsPage?.render();
    } else if (h === 'games') {
      show('view-games');
      await loadGames();
      renderList();
    } else {
      show('view-home');
    }
  }

  // ---------------------------------------------------------------- events

  $('search').addEventListener('input', renderList);
  $('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('all-grid').querySelector('a.game');
      if (first) location.hash = first.getAttribute('href');
    } else if (e.key === 'Escape') {
      $('search').value = '';
      renderList();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !$('view-games').hidden && document.activeElement !== $('search')) {
      e.preventDefault();
      $('search').focus();
    }
  });

  $('random').addEventListener('click', async () => {
    await loadGames();
    if (!games.length) return;
    const pool = games.length > 1 && current ? games.filter((g) => g !== current) : games;
    const g = pool[Math.floor(Math.random() * pool.length)];
    location.hash = '#play/' + enc(g.path);
  });

  $('btn-fav').addEventListener('click', () => {
    if (!current) return;
    const f = favorites();
    const on = f.includes(current.path);
    write(LS.fav, on ? f.filter((p) => p !== current.path) : [...f, current.path]);
    updateFavButton();
    toast(on ? 'Removed from favorites' : 'Added to favorites');
  });

  $('btn-reload').addEventListener('click', () => {
    if (!current) return;
    const frame = $('game-frame');
    try { frame.contentWindow.location.reload(); } catch { frame.src = gameUrl(current); }
  });

  $('btn-mute').addEventListener('click', () => {
    write(LS.muted, !isMuted());
    sendMute();
    toast(isMuted() ? 'Sound off' : 'Sound on');
  });

  $('btn-popout').addEventListener('click', popOut);
  $('btn-fullscreen').addEventListener('click', fullscreen);

  // Re-send the mute state whenever a game (re)loads.
  $('game-frame').addEventListener('load', sendMute);

  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- public

  window.WineDogGames = {
    start() {
      started = true;
      window.__wdMuted = isMuted();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
      }
      loadGames();
      route();
    },
    stop() {
      started = false;
      stopGame();
      if (location.hash) history.replaceState(null, '', location.pathname);
    },
  };
})();
