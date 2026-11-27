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

  function render() {
    const s = S.get();
    $('set-tab-title').value = s.tabTitle || '';
    $('tab-preview-title').textContent = s.tabTitle || 'WineDog';
    $('tab-preview-icon').src = s.tabIcon || S.DEFAULT_ICON;
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.icon === s.tabIcon && b.dataset.name === s.tabTitle));
    $('set-clock-24').checked = !!s.clock24;
    $('set-clock-seconds').checked = s.clockSeconds !== false;
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

  // Preset tab looks: one folder per preset in "Preset Tab Looks" (folder name = tab name, image = tab picture).
  // The list comes from Preset Tab Looks/presets.json, which "Update Games.bat" rebuilds.
  const PRESET_DIR = '/Preset Tab Looks/';
  fetch(encodeURI(PRESET_DIR + 'presets.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const list = (data && data.presets) || [];
      if (!list.length) return;
      const grid = $('tab-presets');
      for (const p of list) {
        const icon = encodeURI(PRESET_DIR + p.icon);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'preset';
        b.dataset.name = p.name;
        b.dataset.icon = icon;
        b.title = `Make this tab look like ${p.name}`;
        const img = document.createElement('img');
        img.src = icon;
        img.alt = '';
        const label = document.createElement('span');
        label.textContent = p.name;
        b.append(img, label);
        b.addEventListener('click', () => {
          S.set({ tabTitle: p.name, tabIcon: icon });
          render();
          toast(`Tab now looks like ${p.name}`);
        });
        grid.append(b);
      }
      $('tab-presets-field').hidden = false;
      render();
    })
    .catch(() => {});

  $('set-tab-icon-clear').addEventListener('click', () => { S.set({ tabIcon: null }); render(); });
  $('set-tab-reset').addEventListener('click', () => { S.set({ tabIcon: null, tabTitle: null }); render(); toast('Tab look reset'); });

  $('set-clock-24').addEventListener('change', (e) => S.set({ clock24: e.target.checked }));
  $('set-clock-seconds').addEventListener('change', (e) => S.set({ clockSeconds: e.target.checked }));

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
