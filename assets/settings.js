// Settings tab.
(() => {
  const $ = (id) => document.getElementById(id);
  const S = window.WDSettings;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  const THEME_INFO = {
    midnight: { name: 'Midnight', bg: '#0b0b0d', panel: '#1a1a20', accent: '#e8e8ec' },
    wine:     { name: 'Wine',     bg: '#140a0e', panel: '#2a1219', accent: '#d8456f' },
    ocean:    { name: 'Ocean',    bg: '#08111a', panel: '#10202e', accent: '#3fa7f5' },
    forest:   { name: 'Forest',   bg: '#0a120d', panel: '#14241a', accent: '#4cc38a' },
    violet:   { name: 'Violet',   bg: '#100b18', panel: '#20172e', accent: '#a78bfa' },
    ember:    { name: 'Ember',    bg: '#140d08', panel: '#2a1b10', accent: '#f59e42' },
    oled:     { name: 'Pure black', bg: '#000000', panel: '#121212', accent: '#ffffff' },
    light:    { name: 'Light',    bg: '#f4f4f6', panel: '#ffffff', accent: '#18181b' },
  };

  function renderThemes() {
    const current = S.get().theme || 'midnight';
    const grid = $('theme-grid');
    grid.replaceChildren(...Object.entries(THEME_INFO).map(([id, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-swatch' + (id === current ? ' on' : '');
      b.innerHTML = `<span class="sw" style="background:${t.bg}"><i style="background:${t.panel}"></i><b style="background:${t.accent}"></b></span><span class="nm"></span>`;
      b.querySelector('.nm').textContent = t.name;
      b.addEventListener('click', () => { S.set({ theme: id === 'midnight' ? null : id }); renderThemes(); });
      return b;
    }));
  }

  function renderInstall() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const btn = $('install-btn');
    const help = $('install-help');
    if (standalone) {
      btn.hidden = true;
      help.hidden = false;
      help.textContent = "You're using the installed app.";
      return;
    }
    if (window.__wdInstallPrompt) {
      btn.hidden = false;
      help.hidden = true;
      return;
    }
    btn.hidden = true;
    help.hidden = false;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    help.textContent = ios
      ? 'On iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".'
      : 'If no Install button shows up, open your browser menu (⋮) and choose "Install WineDog" or "Cast, save and share → Install page as app". It may already be installed.';
  }

  $('install-btn').addEventListener('click', async () => {
    const p = window.__wdInstallPrompt;
    if (!p) return renderInstall();
    p.prompt();
    const { outcome } = await p.userChoice;
    window.__wdInstallPrompt = null;
    if (outcome === 'accepted') toast('Installing WineDog…');
    renderInstall();
  });
  window.addEventListener('wd-installable', renderInstall);
  window.addEventListener('appinstalled', () => { window.__wdInstallPrompt = null; toast('WineDog is installed'); renderInstall(); });

  function render() {
    renderThemes();
    renderInstall();
    const s = S.get();
    $('set-tab-title').value = s.tabTitle || '';
    $('tab-preview-title').textContent = s.tabTitle || 'WineDog';
    $('tab-preview-icon').src = s.tabIcon || S.DEFAULT_ICON;
    renderPresets();
    $('set-clock-24').checked = !!s.clock24;
    $('set-clock-seconds').checked = s.clockSeconds !== false;
    document.querySelectorAll('#set-intro button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.intro || 'login')));
    try { $('set-muted').checked = !!JSON.parse(localStorage.getItem('wd_muted')); } catch { $('set-muted').checked = false; }
  }

  // Shrink an uploaded picture to a 64x64 PNG so it fits in browser storage.
  function toIcon(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const size = 64;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- tab presets
  // KEEP: the owner asked that tab presets never be removed.
  // Listed in "Tab Presets/presets.json" by Update Tab Presets.bat: one per folder,
  // the folder name is the tab name and its picture is the icon.
  const PRESET_DIR = '/Tab Presets/';
  let presets = null;

  async function loadPresets() {
    if (presets) return presets;
    try {
      const r = await fetch(encodeURI(PRESET_DIR + 'presets.json'), { cache: 'no-cache' });
      presets = r.ok ? ((await r.json()).presets || []) : [];
    } catch { presets = []; }
    return presets;
  }

  async function renderPresets() {
    const list = await loadPresets();
    const grid = $('tab-presets');
    $('tab-presets-field').hidden = !list.length;
    const s = S.get();
    grid.replaceChildren(...list.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-preset';
      b.classList.toggle('on', s.tabPreset === p.name && s.tabTitle === p.name);
      const img = document.createElement('img');
      img.alt = '';
      img.src = PRESET_DIR.replace(/ /g, '%20') + p.icon.split('/').map(encodeURIComponent).join('/');
      const name = document.createElement('span');
      name.textContent = p.name;
      b.append(img, name);
      b.addEventListener('click', async () => {
        try {
          const blob = await (await fetch(img.src)).blob();
          S.set({ tabTitle: p.name, tabIcon: await toIcon(blob), tabPreset: p.name });
          render();
          toast(`Tab look: ${p.name}`);
        } catch {
          toast("That preset's picture couldn't be loaded.");
        }
      });
      return b;
    }));
  }

  $('set-tab-title').addEventListener('input', (e) => {
    S.set({ tabTitle: e.target.value.trim() });
    $('tab-preview-title').textContent = e.target.value.trim() || 'WineDog';
  });

  $('set-tab-icon').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const icon = await toIcon(file);
      S.set({ tabIcon: icon });
      render();
      toast('Tab picture updated');
    } catch {
      toast("That file couldn't be used as a picture.");
    }
  });

  $('set-tab-icon-clear').addEventListener('click', () => { S.set({ tabIcon: null }); render(); });
  $('set-tab-reset').addEventListener('click', () => { S.set({ tabIcon: null, tabTitle: null, tabPreset: null }); render(); toast('Tab look reset'); });

  $('set-clock-24').addEventListener('change', (e) => S.set({ clock24: e.target.checked }));
  $('set-clock-seconds').addEventListener('change', (e) => S.set({ clockSeconds: e.target.checked }));
  $('set-intro').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.set({ intro: b.dataset.v });
    document.querySelectorAll('#set-intro button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('set-intro-preview').addEventListener('click', () => window.WDSplash?.play());

  $('set-muted').addEventListener('change', (e) => {
    localStorage.setItem('wd_muted', JSON.stringify(e.target.checked));
    window.__wdMuted = e.target.checked;
  });
  $('set-clear-recent').addEventListener('click', () => { localStorage.removeItem('wd_recent'); toast('Recently played cleared'); });
  $('set-clear-fav').addEventListener('click', () => {
    if (!confirm('Clear all your favorite games?')) return;
    localStorage.removeItem('wd_favorites');
    toast('Favorites cleared');
  });

  window.WDSettingsPage = { render };
})();
