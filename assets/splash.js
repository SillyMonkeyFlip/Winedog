// WineDog intro: the dog photo flies together out of text characters,
// "WineDog" decodes under it, then everything scatters away to show the app.
// WDSplash.play() returns a promise that resolves when the intro is done.
// Click or press any key to skip.
(() => {
  const RAMP = ' .:+*=%$#@';
  const NOISE = '#$%@&*+=?!<>/';
  const WORD = 'WineDog';
  const COLS = 46;

  // Timeline, in ms.
  const T = { fadeIn: 250, flyStart: 150, flyEnd: 1300, textStart: 1000, textEnd: 1900, hold: 2600, out: 3400 };

  // The dog photo gives the detail; the WineDog logo shape cuts the dog and glass
  // out of the background (the logo was traced from the same photo, so they line up).
  const loadOne = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  let imgPromise = null;
  function loadImage() {
    if (!imgPromise) {
      imgPromise = Promise.all([loadOne('/image.jpg'), loadOne('/assets/icon-512.png').catch(() => null)]);
      imgPromise.catch(() => { imgPromise = null; });
    }
    return imgPromise;
  }

  // Turn the photo into a grid of brightness values (0..1).
  function sample([img, mask]) {
    const rows = Math.round(COLS * (img.naturalHeight / img.naturalWidth) * 0.92);
    const c = document.createElement('canvas');
    c.width = COLS; c.height = rows;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, COLS, rows);
    const d = g.getImageData(0, 0, COLS, rows).data;
    let m = null;
    if (mask) {
      g.clearRect(0, 0, COLS, rows);
      g.drawImage(mask, 0, 0, COLS, rows);
      m = g.getImageData(0, 0, COLS, rows).data;
    }
    const cells = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = (y * COLS + x) * 4;
        const inside = m ? m[i + 3] / 255 : 1;
        // Red channel: the dog is reddish-brown, so this keeps it bright and detailed.
        cells.push({ x, y, inside, b: (0.8 * d[i] + 0.2 * d[i + 1]) / 255 });
      }
    }
    // Stretch the brightness of the dog and glass so they use the full range.
    const sorted = cells.filter((c) => c.inside > 0.5).map((c) => c.b).sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.08)] ?? 0;
    const hi = sorted[Math.floor(sorted.length * 0.8)] ?? 1;
    for (const c of cells) {
      const v = Math.pow(Math.min(1, Math.max(0, (c.b - lo) / (hi - lo || 1))), 0.75);
      c.b = c.inside * (0.22 + 0.78 * v) + (1 - c.inside) * 0.05; // background stays faint
    }
    return { cells, rows };
  }

  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (t) => Math.max(0, Math.min(1, t));
  const pick = (s) => s[(Math.random() * s.length) | 0];

  let running = null;
  function play() {
    if (!running) running = run().finally(() => { running = null; });
    return running;
  }

  async function run() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let img;
    try { img = await loadImage(); } catch { return; }
    const { cells, rows } = sample(img);

    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0b0d';
    const cv = document.createElement('canvas');
    cv.className = 'wd-splash';
    cv.setAttribute('aria-hidden', 'true');
    document.body.append(cv);
    const ctx = cv.getContext('2d');

    let W, H, dpr, cell, ox, oy;
    function layout() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = Math.min(W * 0.7, H * 0.58, 480);
      cell = size / COLS;
      ox = (W - size) / 2;
      oy = (H - (rows * cell + cell * 6)) / 2;
    }
    layout();
    addEventListener('resize', layout);

    // Each character starts somewhere random, flies to its spot, then flies off.
    const parts = cells.map((c) => {
      const a = Math.random() * Math.PI * 2;
      return {
        ...c,
        ch: RAMP[Math.min(RAMP.length - 1, 1 + Math.round(c.b * (RAMP.length - 2)))],
        sx: Math.random(), sy: Math.random(),          // start, as a fraction of the screen
        delay: Math.random() * 0.45,                   // stagger the arrivals
        vx: Math.cos(a), vy: Math.sin(a),              // direction when scattering
        speed: 0.4 + Math.random() * 0.9,
        outDelay: Math.random() * 0.35,
      };
    });

    let done;
    const finished = new Promise((r) => { done = r; });
    let start = performance.now();
    let skipAt = null;
    const skip = () => {
      if (skipAt !== null) return;
      // Jump straight to the scatter.
      const t = performance.now() - start;
      if (t < T.hold) { start -= T.hold - t; }
      skipAt = t;
    };
    cv.addEventListener('pointerdown', skip);
    addEventListener('keydown', skip);

    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);

      // Backdrop: theme color -> black, then black -> see-through at the end.
      const inK = clamp(t / T.fadeIn);
      const outK = clamp((t - T.hold) / (T.out - T.hold));
      ctx.globalAlpha = 1 - ease(outK);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = (1 - ease(outK)) * inK;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // Picture.
      ctx.font = `700 ${cell * 1.12}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const flyLen = T.flyEnd - T.flyStart;
      for (const p of parts) {
        const tx = ox + (p.x + 0.5) * cell;
        const ty = oy + (p.y + 0.5) * cell;
        const k = clamp((t - T.flyStart - p.delay * flyLen) / (flyLen * (1 - 0.45)));
        if (k <= 0) continue;
        const e = ease(k);
        let x = p.sx * W + (tx - p.sx * W) * e;
        let y = p.sy * H + (ty - p.sy * H) * e;
        let alpha = Math.min(1, k * 2) * (0.12 + p.b * 0.88);
        const ko = clamp((outK - p.outDelay) / (1 - 0.35));
        if (ko > 0) {
          const dist = Math.pow(ko, 2) * Math.max(W, H) * 0.6 * p.speed;
          x += p.vx * dist; y += p.vy * dist;
          alpha *= 1 - ko;
        }
        if (alpha < 0.02) continue;
        const flicker = k < 1 || (ko > 0 && Math.random() < 0.3) || Math.random() < 0.004;
        const g = Math.round(70 + 185 * p.b);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillText(flicker ? pick(NOISE) : p.ch, x, y);
      }

      // Name: random characters that settle into "WineDog", one letter at a time.
      const tk = clamp((t - T.textStart) / (T.textEnd - T.textStart));
      if (tk > 0) {
        const shown = Math.min(WORD.length, Math.ceil(tk * WORD.length * 1.6));
        const settled = Math.floor(tk * WORD.length);
        let s = '';
        for (let i = 0; i < shown; i++) s += i < settled ? WORD[i] : pick(NOISE);
        const fs = Math.max(18, cell * 3.1);
        ctx.font = `700 ${fs}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
        ctx.textAlign = 'left';
        const fullW = ctx.measureText(WORD).width;
        ctx.globalAlpha = 1 - ease(Math.min(1, outK * 1.6));
        ctx.fillStyle = '#f2f2f2';
        ctx.fillText(s, (W - fullW) / 2, oy + rows * cell + fs * 1.1);
      }

      ctx.globalAlpha = 1;
      if (t < T.out) requestAnimationFrame(frame);
      else finish();
    }

    function finish() {
      removeEventListener('resize', layout);
      removeEventListener('keydown', skip);
      cv.remove();
      done();
    }

    requestAnimationFrame(frame);
    return finished;
  }

  // Start loading the photo early so the intro is ready the moment someone signs in.
  if (document.readyState === 'complete') loadImage();
  else addEventListener('load', () => loadImage().catch(() => {}));

  window.WDSplash = { play };
})();
