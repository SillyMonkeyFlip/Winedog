// WineDog Maps tab: Google Maps in a frame, with search, directions,
// map types, zoom, your location, saved places and recent searches.
// Google Earth doesn't allow itself to be shown inside other sites,
// so the Earth button opens the same place in Google Earth in a new tab.
(() => {
  const $ = (id) => document.getElementById(id);
  const LS = { state: 'wd_map_state', saved: 'wd_map_saved', recent: 'wd_map_recent' };
  const MAX_RECENT = 12;
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // q: place search, or from/to for directions. t: m map, k satellite, h hybrid, p terrain.
  const DEFAULT = { q: '', from: '', to: '', mode: 'd', t: 'm', z: 4 };
  let state = { ...DEFAULT, ...read(LS.state, {}) };
  let loaded = false;

  const enc = encodeURIComponent;
  const isDirections = () => !!state.to;
  const label = () => (isDirections() ? `${state.from || 'Your location'} → ${state.to}` : state.q);

  function embedUrl() {
    const base = 'https://maps.google.com/maps?output=embed&hl=en';
    if (isDirections()) {
      const flag = { w: 'w', b: 'b', r: 'r' }[state.mode];
      return `${base}&saddr=${enc(state.from)}&daddr=${enc(state.to)}&t=${state.t}${flag ? `&dirflg=${flag}` : ''}`;
    }
    if (!state.q) return `${base}&ll=39.8,-98.6&z=${state.z}&t=${state.t}`;
    return `${base}&q=${enc(state.q)}&z=${state.z}&t=${state.t}`;
  }

  function openUrl() {
    if (isDirections()) {
      const mode = { d: 'driving', w: 'walking', b: 'bicycling', r: 'transit' }[state.mode];
      return `https://www.google.com/maps/dir/?api=1&origin=${enc(state.from)}&destination=${enc(state.to)}&travelmode=${mode}`;
    }
    return state.q ? `https://www.google.com/maps/search/?api=1&query=${enc(state.q)}` : 'https://www.google.com/maps';
  }

  function earthUrl() {
    const place = isDirections() ? state.to : state.q;
    return place ? `https://earth.google.com/web/search/${enc(place)}` : 'https://earth.google.com/web/';
  }

  function render() {
    write(LS.state, state);
    const url = embedUrl();
    if ($('map-frame').getAttribute('src') !== url) $('map-frame').src = url;
    $('map-title').textContent = label();
    document.querySelectorAll('#map-type button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.t));
    document.querySelectorAll('#map-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.mode));
    $('map-zoom-in').disabled = $('map-zoom-out').disabled = isDirections();
    const saved = read(LS.saved, []);
    const here = placeKey();
    $('map-save').disabled = !here;
    $('map-save').classList.toggle('on', !!here && saved.some((p) => p.key === here));
    $('map-save').title = $('map-save').classList.contains('on') ? 'Remove from saved places' : 'Save place';
    renderLists();
  }

  // ---------------------------------------------------------------- places

  function placeKey(s = state) {
    if (s.to) return `dir:${s.from}|${s.to}|${s.mode}`;
    return s.q ? `q:${s.q}` : '';
  }
  function snapshot() {
    return { key: placeKey(), label: label(), q: state.q, from: state.from, to: state.to, mode: state.mode };
  }
  function addRecent() {
    if (!placeKey()) return;
    const list = read(LS.recent, []).filter((p) => p.key !== placeKey());
    list.unshift(snapshot());
    write(LS.recent, list.slice(0, MAX_RECENT));
  }
  function go(p) {
    state = { ...state, q: p.q || '', from: p.from || '', to: p.to || '', mode: p.mode || 'd' };
    if (state.q && !state.to) state.z = Math.max(state.z, 13);
    $('map-q').value = state.q;
    $('map-from').value = state.from;
    $('map-to').value = state.to;
    $('map-dir').hidden = !state.to;
    $('map-error').textContent = '';
    if (!p.noRecent) addRecent();
    render();
  }

  const PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const ROUTE = '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/></svg>';

  function row(p, onRemove) {
    const el = document.createElement('div');
    el.className = 'map-place';
    el.innerHTML = p.to ? ROUTE : PIN;
    const name = document.createElement('span');
    name.textContent = p.label; // text only, so place names can't inject HTML
    name.title = p.label;
    el.append(name);
    if (onRemove) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'linkbtn';
      x.textContent = '✕';
      x.title = 'Remove';
      x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
      el.append(x);
    }
    el.addEventListener('click', () => go(p));
    return el;
  }

  function renderLists() {
    const saved = read(LS.saved, []);
    const recent = read(LS.recent, []);
    const s = $('map-saved');
    s.replaceChildren(...saved.map((p) => row(p, () => { write(LS.saved, read(LS.saved, []).filter((x) => x.key !== p.key)); render(); })));
    if (!saved.length) s.innerHTML = '<p class="muted small">Press the star to save a place here.</p>';
    const r = $('map-recent');
    r.replaceChildren(...recent.map((p) => row(p)));
    if (!recent.length) r.innerHTML = '<p class="muted small">Nothing yet.</p>';
    $('map-clear-recent').hidden = !recent.length;
  }

  // ---------------------------------------------------------------- location

  function locate(then) {
    if (!navigator.geolocation) { $('map-error').textContent = 'This browser can’t share your location.'; return; }
    $('map-error').textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('map-error').textContent = '';
        then(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
      },
      () => { $('map-error').textContent = 'Couldn’t get your location. Check that location is allowed for this site.'; },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // ---------------------------------------------------------------- events

  $('map-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('map-q').value.trim();
    if (!q) return;
    go({ q });
  });
  $('map-dir-btn').addEventListener('click', () => {
    const dir = $('map-dir');
    dir.hidden = !dir.hidden;
    if (!dir.hidden) {
      if (!$('map-to').value && state.q) $('map-to').value = state.q;
      ($('map-to').value ? $('map-from') : $('map-to')).focus();
    }
  });
  $('map-dir').addEventListener('submit', (e) => {
    e.preventDefault();
    const from = $('map-from').value.trim();
    const to = $('map-to').value.trim();
    if (!to) { $('map-to').focus(); return; }
    if (from) go({ from, to, mode: state.mode });
    else locate((here) => { $('map-from').value = ''; go({ from: here, to, mode: state.mode }); });
  });
  $('map-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.v;
    if (isDirections()) addRecent();
    render();
  });
  $('map-type').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.t = b.dataset.v;
    render();
  });
  $('map-zoom-in').addEventListener('click', () => { state.z = Math.min(21, state.z + 1); render(); });
  $('map-zoom-out').addEventListener('click', () => { state.z = Math.max(2, state.z - 1); render(); });
  $('map-locate').addEventListener('click', () => locate((here) => { state.z = Math.max(state.z, 15); go({ q: here, noRecent: true }); }));
  $('map-save').addEventListener('click', () => {
    const key = placeKey();
    if (!key) return;
    let saved = read(LS.saved, []);
    if (saved.some((p) => p.key === key)) saved = saved.filter((p) => p.key !== key);
    else saved.unshift(snapshot());
    write(LS.saved, saved);
    render();
  });
  $('map-clear-recent').addEventListener('click', () => { write(LS.recent, []); render(); });
  $('map-fullscreen').addEventListener('click', () => {
    const el = $('map-stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => {});
  });
  $('map-open').addEventListener('click', () => window.open(openUrl(), '_blank', 'noopener'));
  $('map-earth').addEventListener('click', () => window.open(earthUrl(), '_blank', 'noopener'));

  window.WDMaps = {
    show() {
      if (!loaded) {
        loaded = true;
        $('map-q').value = state.q;
        $('map-from').value = state.from;
        $('map-to').value = state.to;
        $('map-dir').hidden = !state.to;
      }
      render();
    },
  };
})();
