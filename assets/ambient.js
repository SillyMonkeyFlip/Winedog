// Ambient light for the Videos tab: a soft glow around the player in the colors of the video.
//
// YouTube plays inside a frame from another site, so a page can't read the video's pixels
// (that's how the browser extension does it). Instead this uses YouTube's preview frames,
// the small pictures shown when you hover the progress bar, which exist every couple of
// seconds through the whole video. Frames are blended into each other so the glow moves
// smoothly. If preview frames can't be loaded, it falls back to three still frames.
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'wd_ambient';
  const DEFAULTS = {
    on: false,
    strength: 85, spread: 40, blur: 45, edge: 70, fadeIn: 800,
    smooth: true, detail: 'high', fps: 30,
    brightness: 100, contrast: 100, saturation: 100, glowSat: 120,
    shadow: true, page: 'dim',
  };
  const read = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; } };
  let o = read();

  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 90;
  const ctx = cv.getContext('2d');
  const layer = $('vid-ambient');
  layer.replaceChildren(cv);

  let getPlayer = () => null;
  let videoId = null;
  let board = null;          // { levels } from the server
  let thumbs = [];           // fallback: three stills
  const sheets = new Map();  // url -> Image
  let raf = 0;
  let lastDraw = 0;
  let shown = false;
  // The player only reports its time a few times a second, so estimate in between.
  let baseT = 0, baseAt = 0, rawT = -1;

  // ---------------------------------------------------------------- pictures

  function img(url) {
    let i = sheets.get(url);
    if (!i) {
      i = new Image();
      i.decoding = 'async';
      i.referrerPolicy = 'no-referrer';
      i.src = url;
      sheets.set(url, i);
      if (sheets.size > 40) sheets.delete(sheets.keys().next().value);
    }
    return i;
  }
  const ready = (i) => i && i.complete && i.naturalWidth > 0;

  function level() {
    const ls = board?.levels || [];
    if (!ls.length) return null;
    const timed = ls.filter((l) => l.interval > 0);
    if (o.detail === 'low') return ls[0];
    if (o.detail === 'med') return timed[0] || ls[0];
    return timed[timed.length - 1] || ls[ls.length - 1];
  }

  // Draws frame number n of a storyboard level. Returns false if its sheet isn't loaded yet.
  function drawBoardFrame(L, n, alpha) {
    const per = L.cols * L.rows;
    const page = Math.floor(n / per);
    const k = n % per;
    const sheet = img(L.url.replace('{page}', page));
    if (!ready(sheet)) return false;
    // Sheets can be bigger than cols*w if YouTube scaled them; measure from the image.
    const fw = sheet.naturalWidth / L.cols;
    const fh = Math.min(sheet.naturalHeight / L.rows, fw * (L.h / L.w));
    ctx.globalAlpha = alpha;
    ctx.drawImage(sheet, (k % L.cols) * fw, Math.floor(k / L.cols) * fh, fw, fh, 0, 0, cv.width, cv.height);
    // Load the next sheet early so the glow never waits.
    if (k > per - 6) img(L.url.replace('{page}', page + 1));
    return true;
  }

  function draw(t, dur) {
    const L = level();
    if (L) {
      let f = L.interval > 0 ? (t * 1000) / L.interval : dur ? (t / dur) * (L.count - 1) : 0;
      f = Math.max(0, Math.min(L.count - 1, f));
      const a = Math.floor(f);
      const frac = f - a;
      if (!drawBoardFrame(L, a, 1)) return false;
      if (o.smooth && frac > 0.01 && a + 1 < L.count) drawBoardFrame(L, a + 1, frac);
      ctx.globalAlpha = 1;
      return true;
    }
    if (!thumbs.length) return false;
    // Fallback: blend between stills from about a quarter, half and three quarters in.
    let f = dur ? Math.max(0, Math.min(2, (t / dur) * 3 - 0.5)) : 0;
    if (!o.smooth) f = Math.round(f);
    const a = Math.floor(f);
    const A = thumbs[a];
    const B = thumbs[Math.min(2, a + 1)];
    if (!ready(A)) return ready(thumbs[0]) ? (ctx.drawImage(thumbs[0], 0, 45, 480, 270, 0, 0, cv.width, cv.height), true) : false;
    // hq thumbnails are 480x360 with black bars top and bottom; skip the bars.
    ctx.globalAlpha = 1;
    ctx.drawImage(A, 0, 45, 480, 270, 0, 0, cv.width, cv.height);
    if (f - a > 0.01 && ready(B)) {
      ctx.globalAlpha = f - a;
      ctx.drawImage(B, 0, 45, 480, 270, 0, 0, cv.width, cv.height);
    }
    ctx.globalAlpha = 1;
    return true;
  }

  // ---------------------------------------------------------------- loop

  function loop(now) {
    raf = 0;
    if (!active()) return;
    raf = requestAnimationFrame(loop);
    if (now - lastDraw < 1000 / o.fps - 2) return;
    lastDraw = now;
    const p = getPlayer();
    let t = 0, dur = 0, playing = false;
    try {
      t = p?.getCurrentTime?.() || 0;
      dur = p?.getDuration?.() || 0;
      playing = p?.getPlayerState?.() === 1;
    } catch {}
    if (t !== rawT) { rawT = t; baseT = t; baseAt = now; }
    const est = playing ? Math.min(baseT + (now - baseAt) / 1000, baseT + 1.5) : baseT;
    if (draw(est, dur) && !shown) {
      shown = true;
      layer.style.opacity = String(o.strength / 100);
    }
  }

  function active() {
    return o.on && videoId && !$('view-videos').hidden && !document.hidden;
  }
  function kick() { if (!raf && active()) raf = requestAnimationFrame(loop); }
  document.addEventListener('visibilitychange', kick);

  async function loadBoard(id) {
    board = null;
    try {
      const token = localStorage.getItem('winedog_token');
      const r = await fetch(`${window.WINEDOG_API}/api/storyboard?v=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const data = await r.json();
      if (videoId === id && Array.isArray(data.levels)) {
        board = data;
        // Warm up the first sheet.
        const L = level();
        if (L) img(L.url.replace('{page}', 0));
      }
    } catch {}
  }

  // ---------------------------------------------------------------- options

  function apply() {
    const wrap = $('videos-wrap');
    const stage = $('vid-stage');
    wrap.classList.toggle('ambient-on', !!o.on);
    wrap.dataset.amPage = o.page;
    stage.classList.toggle('am-shadow', !!o.on && o.shadow);
    $('vid-ambient-btn').classList.toggle('on', !!o.on);
    $('vid-ambient-btn').title = o.on ? 'Turn off ambient light' : 'Ambient light';

    const w = stage.clientWidth || 800;
    // Spread: how far the light reaches past the video, as a share of its size.
    const sp = o.spread / 100;
    const mx = sp * 30, my = sp * 45; // % of the video's width / height, on each side
    layer.style.inset = `${-my}% ${-mx}%`;
    const blurPx = Math.round((o.blur / 100) * w * 0.14);
    layer.style.filter = `blur(${blurPx}px) brightness(${o.brightness / 100}) contrast(${o.contrast / 100}) saturate(${(o.saturation / 100) * (o.glowSat / 100)})`;
    // Edge fade: the light is full strength behind the video and fades out toward its outer edge.
    const fx = (mx / (100 + 2 * mx)) * 100, fy = (my / (100 + 2 * my)) * 100; // margin, % of the layer
    const k = 0.25 + (o.edge / 100) * 0.75;
    const ramp = (m) => `transparent 0%, rgba(0,0,0,.35) ${(m * k * 0.5).toFixed(1)}%, #000 ${(m * k).toFixed(1)}%, #000 ${(100 - m * k).toFixed(1)}%, rgba(0,0,0,.35) ${(100 - m * k * 0.5).toFixed(1)}%, transparent 100%`;
    const mask = `linear-gradient(to right, ${ramp(fx)}), linear-gradient(to bottom, ${ramp(fy)})`;
    layer.style.maskImage = layer.style.webkitMaskImage = mask;
    layer.style.maskComposite = 'intersect';
    layer.style.webkitMaskComposite = 'source-in';
    layer.style.transition = `opacity ${o.fadeIn}ms ease`;
    if (!o.on) layer.style.opacity = '0';
    else if (shown) layer.style.opacity = String(o.strength / 100);
    // Filters apply to the video too, like the extension.
    const vf = `brightness(${o.brightness / 100}) contrast(${o.contrast / 100}) saturate(${o.saturation / 100})`;
    stage.style.setProperty('--vid-filter', vf === 'brightness(1) contrast(1) saturate(1)' ? 'none' : vf);

    // Controls
    document.querySelectorAll('#am-panel [data-am]').forEach((el) => {
      const k = el.dataset.am;
      if (el.type === 'range') {
        el.value = o[k];
        const out = el.parentElement.querySelector('output');
        if (out) out.textContent = k === 'fadeIn' ? `${(o[k] / 1000).toFixed(1)}s` : `${o[k]}%`;
      } else if (el.classList.contains('seg')) {
        el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(o[k]) === b.dataset.v));
      }
    });
    kick();
  }

  function set(patch) {
    const before = o.detail;
    o = { ...o, ...patch };
    localStorage.setItem(KEY, JSON.stringify(o));
    if (patch.detail && patch.detail !== before) { const L = level(); if (L) img(L.url.replace('{page}', 0)); }
    apply();
  }

  document.querySelectorAll('#am-panel input[type=range][data-am]').forEach((el) => {
    el.addEventListener('input', () => set({ [el.dataset.am]: Number(el.value) }));
  });
  document.querySelectorAll('#am-panel .seg[data-am]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const v = b.dataset.v;
      set({ [seg.dataset.am]: v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v });
    });
  });
  $('am-reset').addEventListener('click', () => set({ ...DEFAULTS, on: o.on }));
  $('vid-ambient-btn').addEventListener('click', () => set({ on: !o.on }));
  addEventListener('resize', () => { if (o.on) apply(); });

  window.WDAmbient = {
    attach(fn) { getPlayer = fn; },
    setVideo(id) {
      if (id === videoId) return;
      videoId = id;
      shown = false;
      rawT = -1;
      layer.style.opacity = '0';
      ctx.clearRect(0, 0, cv.width, cv.height);
      thumbs = id ? ['hq1', 'hq2', 'hq3'].map((n) => img(`https://i.ytimg.com/vi/${id}/${n}.jpg`)) : [];
      if (id) loadBoard(id);
      kick();
    },
    apply,
    kick,
  };
  apply();
})();
