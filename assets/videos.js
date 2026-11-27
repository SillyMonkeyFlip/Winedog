// Videos tab: plays YouTube videos through YouTube's official privacy-enhanced embed,
// with a queue, history, theater mode, transcript, WineDog captions and ambient mode.
(() => {
  const $ = (id) => document.getElementById(id);
  const LS = {
    queue: 'wd_vid_queue', history: 'wd_vid_history', theater: 'wd_vid_theater',
    titles: 'wd_vid_titles', opts: 'wd_vid_opts', pane: 'wd_vid_pane',
  };
  const MAX_HISTORY = 40;
  const DEFAULT_OPTS = {
    cc: false,
    ccSize: 'm', ccBg: 'box', ccPos: 'bottom', ccFont: 'sans', ccLang: 'en',
  };

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const opts = () => ({ ...DEFAULT_OPTS, ...read(LS.opts, {}) });
  const setOpt = (patch) => { write(LS.opts, { ...read(LS.opts, {}), ...patch }); applyOpts(); };

  let player = null;
  let apiReady = null;
  let current = null;        // { id, start, list }
  let ticker = 0;
  let lines = [];            // transcript lines for the current video
  let tracks = [];
  let lastLine = -1;
  let userScrolledAt = 0;

  // ---------------------------------------------------------------- links

  // Accepts youtu.be, youtube.com/watch, /shorts, /embed, /live links, or a bare 11-character id.
  function parse(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    if (/^[\w-]{11}$/.test(text)) return { id: text, start: 0 };
    let url;
    try { url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); } catch { return null; }
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else {
        const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
        if (m) id = m[2];
      }
      if (!id && url.pathname === '/playlist' && url.searchParams.get('list')) {
        return { id: null, list: url.searchParams.get('list'), start: 0 };
      }
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const t = url.searchParams.get('t') || url.searchParams.get('start') || '';
    let start = 0;
    const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (hms) start = (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0);
    return { id, start, list: url.searchParams.get('list') || null };
  }

  const thumb = (id, name = 'mqdefault') => `https://i.ytimg.com/vi/${id}/${name}.jpg`;
  const keyOf = (v) => v.id || 'list:' + v.list;
  const watchUrl = (v) => v.id
    ? `https://www.youtube.com/watch?v=${v.id}${v.list ? '&list=' + encodeURIComponent(v.list) : ''}${v.start ? '&t=' + v.start + 's' : ''}`
    : `https://www.youtube.com/playlist?list=${encodeURIComponent(v.list)}`;
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  };

  // Video titles come from YouTube's public oEmbed lookup and are remembered.
  const titles = read(LS.titles, {});
  async function titleFor(v) {
    const key = keyOf(v);
    if (titles[key]) return titles[key];
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watchUrl(v)));
      if (r.ok) {
        const data = await r.json();
        titles[key] = data.title;
        const keys = Object.keys(titles);
        if (keys.length > 300) delete titles[keys[0]];
        write(LS.titles, titles);
        return data.title;
      }
    } catch {}
    return v.id ? 'YouTube video' : 'YouTube playlist';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  // ---------------------------------------------------------------- player

  function loadApi() {
    if (apiReady) return apiReady;
    apiReady = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiReady = null; reject(new Error('api')); };
      setTimeout(() => { if (!(window.YT && window.YT.Player)) { apiReady = null; reject(new Error('timeout')); } }, 12000);
      document.head.append(s);
    });
    return apiReady;
  }

  function onState(e) {
    if (e.data === 0 /* ended */ && !current?.list) playNext(true);
    // Playlists change video on their own; follow along.
    if (e.data === 1 && current?.list) {
      try {
        const vid = player.getVideoData()?.video_id;
        if (vid && vid !== current.id) { current = { ...current, id: vid }; afterVideoChange(); }
      } catch {}
    }
  }

  function onError(e) {
    const msg = {
      2: "That link doesn't point to a valid video.",
      5: "This video can't play here.",
      100: 'That video was removed or is private.',
      101: "The owner doesn't allow this video to play on other sites. Use the open-on-YouTube button.",
      150: "The owner doesn't allow this video to play on other sites. Use the open-on-YouTube button.",
    }[e.data] || "This video couldn't be played.";
    $('vid-error').textContent = msg;
  }

  async function play(v, { addToHistory = true } = {}) {
    $('vid-error').textContent = '';
    current = v;
    $('vid-empty').hidden = true;
    if (addToHistory) {
      write(LS.history, [{ id: v.id, list: v.list || null }, ...read(LS.history, []).filter((h) => keyOf(h) !== keyOf(v))].slice(0, MAX_HISTORY));
    }
    afterVideoChange();

    try { await loadApi(); } catch {
      $('vid-error').textContent = "Couldn't load the YouTube player. Check your connection.";
      return;
    }
    const vars = { autoplay: 1, rel: 0, playsinline: 1, start: v.start || 0, cc_load_policy: 0, iv_load_policy: 3 };
    if (v.list) { vars.listType = 'playlist'; vars.list = v.list; }
    if (player && player.loadVideoById && !v.list && !player.__list) {
      player.loadVideoById({ videoId: v.id, startSeconds: v.start || 0 });
    } else {
      // Playlists (or switching away from one) need a fresh player.
      if (player) { try { player.destroy(); } catch {} player = null; }
      const holder = document.createElement('div');
      holder.id = 'vid-player';
      $('vid-player').replaceWith(holder);
      player = new YT.Player('vid-player', {
        host: 'https://www.youtube-nocookie.com',
        videoId: v.id || undefined,
        playerVars: vars,
        events: { onStateChange: onState, onError },
      });
      player.__list = !!v.list;
    }
    clearInterval(ticker);
    ticker = setInterval(tick, 250);
  }

  // Everything that depends on which video is showing.
  function afterVideoChange() {
    const v = current;
    $('vid-title').textContent = titles[keyOf(v)] || '';
    titleFor(v).then((t) => { if (current === v) $('vid-title').textContent = t; renderLists(); });
    window.WDAmbient?.setVideo(v.id);
    renderLists();
    loadTranscript();
  }

  function playNext(auto) {
    const q = read(LS.queue, []);
    if (!q.length) { if (!auto) toast('The queue is empty'); return; }
    const [nextV, ...rest] = q;
    write(LS.queue, rest);
    play({ id: nextV.id, list: nextV.list || null, start: 0 });
  }

  function now() {
    try { return player?.getCurrentTime?.() || 0; } catch { return 0; }
  }

  function seek(t) {
    try { player.seekTo(t, true); player.playVideo(); } catch {}
  }

  // ---------------------------------------------------------------- transcript

  async function loadTranscript() {
    lines = [];
    tracks = [];
    lastLine = -1;
    $('tr-list').replaceChildren();
    $('vid-cc').hidden = true;
    const v = current;
    if (!v?.id) { $('tr-status').textContent = 'Transcripts are available once a video is playing.'; return; }
    $('tr-status').textContent = 'Loading transcript…';
    const token = localStorage.getItem('winedog_token');
    try {
      const r = await fetch(`${window.WINEDOG_API}/api/transcript?v=${v.id}&lang=${encodeURIComponent(opts().ccLang)}`, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const data = await r.json().catch(() => ({}));
      if (current !== v) return;
      if (!r.ok) { $('tr-status').textContent = data.error || "This video's transcript isn't available."; renderLangs(); return; }
      lines = data.lines || [];
      tracks = data.tracks || [];
      renderLangs(data.lang);
      renderTranscript();
      $('tr-status').textContent = lines.length ? '' : "This video doesn't have a transcript.";
    } catch {
      if (current === v) $('tr-status').textContent = "Couldn't reach the server for the transcript.";
    }
  }

  function renderLangs(selected) {
    const sel = $('cc-lang');
    sel.replaceChildren();
    if (!tracks.length) {
      const o = document.createElement('option');
      o.textContent = 'No captions';
      sel.append(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    for (const t of tracks) {
      const o = document.createElement('option');
      o.value = t.lang;
      o.textContent = t.name + (t.auto ? ' (auto)' : '');
      if (t.lang === selected) o.selected = true;
      sel.append(o);
    }
  }

  function renderTranscript() {
    const q = $('tr-search').value.trim().toLowerCase();
    const list = $('tr-list');
    const rows = [];
    lines.forEach((l, i) => {
      if (q && !l.text.toLowerCase().includes(q)) return;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tr-line';
      row.dataset.i = i;
      const time = document.createElement('span');
      time.className = 'tr-time';
      time.textContent = fmtTime(l.start);
      const text = document.createElement('span');
      text.className = 'tr-text';
      if (q) {
        const lower = l.text.toLowerCase();
        let pos = 0, idx;
        while ((idx = lower.indexOf(q, pos)) !== -1) {
          text.append(l.text.slice(pos, idx));
          const mk = document.createElement('mark');
          mk.textContent = l.text.slice(idx, idx + q.length);
          text.append(mk);
          pos = idx + q.length;
        }
        text.append(l.text.slice(pos));
      } else text.textContent = l.text;
      row.append(time, text);
      row.addEventListener('click', () => seek(l.start));
      rows.push(row);
    });
    list.replaceChildren(...rows);
    if (q) $('tr-status').textContent = rows.length ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : 'No matches.';
    else if (lines.length) $('tr-status').textContent = '';
    lastLine = -1;
  }

  function lineAt(t) {
    // Last line that has started by time t.
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // ---------------------------------------------------------------- every 250ms while playing

  function tick() {
    if (!player || !current) return;
    const t = now();
    const i = lines.length ? lineAt(t) : -1;
    const o = opts();

    // WineDog captions
    const cc = $('vid-cc');
    const active = i >= 0 && t < lines[i].start + Math.max(lines[i].dur, 1.2) + 0.4;
    if (o.cc && active) {
      if (cc.firstChild.textContent !== lines[i].text) cc.firstChild.textContent = lines[i].text;
      cc.hidden = false;
    } else cc.hidden = true;

    // Transcript highlight
    if (i !== lastLine) {
      document.querySelectorAll('.tr-line.on').forEach((el) => el.classList.remove('on'));
      const row = document.querySelector(`.tr-line[data-i="${i}"]`);
      if (row) {
        row.classList.add('on');
        if ($('tr-follow').checked && Date.now() - userScrolledAt > 4000) {
          const list = $('tr-list');
          list.scrollTo({ top: row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2, behavior: 'smooth' });
        }
      }
      lastLine = i;
    }
  }

  // ---------------------------------------------------------------- options

  function applyOpts() {
    const o = opts();
    const wrap = $('videos-wrap');
    for (const k of ['ccSize', 'ccBg', 'ccPos', 'ccFont']) wrap.dataset[k] = o[k];
    $('vid-cc-btn').classList.toggle('on', !!o.cc);
    $('vid-cc-btn').title = o.cc ? 'Turn off WineDog captions' : 'WineDog captions';
    document.querySelectorAll('#cc-panel .seg[data-opt]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === o[seg.dataset.opt]));
    });
    if (!o.cc) $('vid-cc').hidden = true;
  }

  // ---------------------------------------------------------------- queue + history

  function item(v, actions) {
    const row = document.createElement('div');
    row.className = 'vid-item';
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.classList.add('broken'), { once: true });
    if (v.id) img.src = thumb(v.id); else img.classList.add('broken');
    const name = document.createElement('div');
    name.className = 'vid-item-title';
    name.dataset.k = keyOf(v);
    name.textContent = titles[keyOf(v)] || (v.id ? 'YouTube video' : 'YouTube playlist');
    row.append(img, name);
    const btns = document.createElement('div');
    btns.className = 'vid-item-actions';
    for (const [label, title, fn] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'linkbtn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      btns.append(b);
    }
    row.append(btns);
    row.addEventListener('click', () => play({ id: v.id, list: v.list || null, start: 0 }));
    return row;
  }

  function renderLists() {
    const q = read(LS.queue, []);
    const h = read(LS.history, []);
    $('vid-queue').replaceChildren(...q.map((v, i) => item(v, [
      ['↑', 'Move up', () => { if (i > 0) { const a = read(LS.queue, []); [a[i - 1], a[i]] = [a[i], a[i - 1]]; write(LS.queue, a); renderLists(); } }],
      ['✕', 'Remove', () => { const a = read(LS.queue, []); a.splice(i, 1); write(LS.queue, a); renderLists(); }],
    ])));
    $('vid-queue-empty').hidden = q.length > 0;
    $('vid-queue-count').textContent = q.length ? `(${q.length})` : '';
    $('vid-history').replaceChildren(...h.map((v) => item(v, [
      ['+', 'Add to queue', () => { write(LS.queue, [...read(LS.queue, []), v]); renderLists(); toast('Added to queue'); }],
    ])));
    $('vid-history-empty').hidden = h.length > 0;
    $('vid-history-clear').hidden = h.length === 0;
    for (const v of [...q, ...h]) {
      const k = keyOf(v);
      if (titles[k]) continue;
      titleFor(v).then((t) => {
        document.querySelectorAll('.vid-item-title').forEach((el) => { if (el.dataset.k === k) el.textContent = t; });
      });
    }
  }

  function showPane(name) {
    write(LS.pane, name);
    document.querySelectorAll('#vid-side-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === name));
    document.querySelectorAll('.vid-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }

  function setTheater(on) {
    write(LS.theater, on);
    $('videos-wrap').classList.toggle('theater', on);
    $('vid-theater').classList.toggle('on', on);
    $('vid-theater').title = on ? 'Exit theater mode' : 'Theater mode';
  }

  // ---------------------------------------------------------------- events

  function submitLink(queue) {
    const v = parse($('vid-url').value);
    if (!v) { $('vid-error').textContent = "That doesn't look like a YouTube link."; return; }
    $('vid-error').textContent = '';
    $('vid-url').value = '';
    if (!queue) return play(v);
    write(LS.queue, [...read(LS.queue, []), { id: v.id, list: v.list || null }]);
    titleFor(v).then(renderLists);
    renderLists();
    toast('Added to queue');
    if (!current) playNext(true);
  }

  $('vid-form').addEventListener('submit', (e) => { e.preventDefault(); submitLink(false); });
  $('vid-queue-add').addEventListener('click', () => submitLink(true));
  $('vid-next').addEventListener('click', () => playNext(false));
  $('vid-theater').addEventListener('click', () => setTheater(!read(LS.theater, false)));
  $('vid-open').addEventListener('click', () => {
    if (!current) return;
    const t = Math.floor(now());
    try { player?.pauseVideo?.(); } catch {}
    window.open(watchUrl({ ...current, start: t || current.start }), '_blank', 'noopener');
  });
  $('vid-fullscreen').addEventListener('click', () => {
    const el = $('vid-stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  });
  $('vid-history-clear').addEventListener('click', () => { write(LS.history, []); renderLists(); });

  $('vid-cc-btn').addEventListener('click', () => {
    const on = !opts().cc;
    setOpt({ cc: on });
    if (on && !lines.length) toast(current ? 'No captions loaded for this video yet.' : 'Captions will show when a video plays.');
  });
  $('vid-cc-settings').addEventListener('click', () => {
    const p = $('cc-panel');
    p.hidden = !p.hidden;
    $('vid-cc-settings').classList.toggle('on', !p.hidden);
  });
  document.querySelectorAll('#cc-panel .seg[data-opt]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) setOpt({ [seg.dataset.opt]: b.dataset.v });
    });
  });
  $('cc-lang').addEventListener('change', (e) => { setOpt({ ccLang: e.target.value }); loadTranscript(); });

  $('vid-side-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pane]');
    if (b) showPane(b.dataset.pane);
  });
  $('tr-search').addEventListener('input', renderTranscript);
  $('tr-list').addEventListener('wheel', () => { userScrolledAt = Date.now(); }, { passive: true });
  $('tr-list').addEventListener('touchmove', () => { userScrolledAt = Date.now(); }, { passive: true });
  $('tr-copy').addEventListener('click', async () => {
    if (!lines.length) return toast('No transcript to copy');
    try {
      await navigator.clipboard.writeText(lines.map((l) => l.text).join('\n'));
      toast('Transcript copied');
    } catch { toast("Couldn't copy. Your browser blocked it."); }
  });

  // ---------------------------------------------------------------- pop out
  // Opens the video in a small always-on-top window (Chrome's picture-in-picture window),
  // or a normal small popup in browsers without it. It picks up where you were, and when
  // the small window closes, the video here continues from where it got to.

  let pip = null;

  async function popOut() {
    if (!current) return toast('Play a video first');
    if (pip) { pip.close(); return; }
    const t = Math.floor(now());
    const p = new URLSearchParams({ autoplay: '1', start: String(t), rel: '0', playsinline: '1', enablejsapi: '1', origin: location.origin, iv_load_policy: '3' });
    if (current.list) p.set('list', current.list);
    const src = `https://www.youtube-nocookie.com/embed/${current.id || ''}?${p}`;
    try { player?.pauseVideo?.(); } catch {}

    if (!window.documentPictureInPicture) {
      const w = window.open(src, 'wd-popout', 'popup,width=640,height=360');
      if (!w) toast('Your browser blocked the pop-out window.');
      return;
    }

    let lastTime = t;
    let lastId = current.id;
    try {
      pip = await documentPictureInPicture.requestWindow({ width: 480, height: 270 });
    } catch {
      toast("Couldn't open the pop-out window.");
      return;
    }
    const doc = pip.document;
    doc.title = $('vid-title').textContent || 'WineDog video';
    doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
    const f = doc.createElement('iframe');
    f.src = src;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
    doc.body.append(f);

    // Ask the player to report its time, so the main page can continue from there.
    const listen = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'wdpip', channel: 'widget' }), '*'); } catch {} };
    f.addEventListener('load', () => { listen(); setTimeout(listen, 1000); });
    pip.addEventListener('message', (e) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      const info = d?.info;
      if (info && typeof info.currentTime === 'number') lastTime = info.currentTime;
      if (info?.videoData?.video_id) lastId = info.videoData.video_id;
    });
    $('vid-popout').classList.add('on');
    $('vid-popout').title = 'Bring the video back';

    pip.addEventListener('pagehide', () => {
      pip = null;
      $('vid-popout').classList.remove('on');
      $('vid-popout').title = 'Pop out (keeps playing in a small window on top)';
      if (lastId && current && lastId !== current.id && current.list) { current = { ...current, id: lastId }; afterVideoChange(); }
      try {
        if (lastId && current && lastId === current.id) player.seekTo(lastTime, true);
        player.playVideo();
      } catch {}
    });
  }

  $('vid-popout').addEventListener('click', popOut);

  window.WDAmbient?.attach(() => player);

  window.WDVideos = {
    show() {
      setTheater(read(LS.theater, false));
      showPane(read(LS.pane, 'transcript'));
      applyOpts();
      window.WDAmbient?.apply();
      renderLists();
      if (!current) $('vid-url').focus();
    },
    pause() { try { player?.pauseVideo?.(); } catch {} },
    parse,
  };
})();
