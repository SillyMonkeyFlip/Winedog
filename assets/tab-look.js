// Device settings store + custom tab name/picture. Loaded in <head> so the tab changes right away.
(() => {
  const KEY = 'wd_settings';
  const DEFAULT_ICON = '/assets/favicon-32.png';
  let pageTitle = document.title || 'WineDog';

  const get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

  function applyTab() {
    const s = get();
    document.title = s.tabTitle || pageTitle;
    const href = s.tabIcon || DEFAULT_ICON;
    const links = document.querySelectorAll('link[rel~="icon"]');
    if (!links.length) {
      const l = document.createElement('link');
      l.rel = 'icon';
      document.head.append(l);
    }
    document.querySelectorAll('link[rel~="icon"]').forEach((l) => {
      l.href = href;
      if (s.tabIcon) l.removeAttribute('sizes'); else if (l.dataset.sizes) l.sizes = l.dataset.sizes;
    });
  }

  const THEME_COLORS = {
    midnight: '#0b0b0d', wine: '#140a0e', ocean: '#08111a', forest: '#0a120d',
    violet: '#100b18', ember: '#140d08', oled: '#000000', light: '#f4f4f6',
  };

  function applyTheme() {
    const t = get().theme || 'midnight';
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEME_COLORS[t] || THEME_COLORS.midnight;
  }

  window.WDSettings = {
    get,
    set(patch) {
      const s = { ...get(), ...patch };
      for (const k of Object.keys(s)) if (s[k] === null || s[k] === '') delete s[k];
      localStorage.setItem(KEY, JSON.stringify(s));
      applyTheme();
      applyTab();
      return s;
    },
    // Pages call this instead of setting document.title, so a custom tab name always wins.
    setTitle(t) { pageTitle = t; applyTab(); },
    applyTab,
    DEFAULT_ICON,
    THEMES: Object.keys(THEME_COLORS),
  };

  document.querySelectorAll('link[rel~="icon"]').forEach((l) => { if (l.sizes?.value) l.dataset.sizes = l.sizes.value; });
  applyTheme();
  applyTab();

  // Register the service worker early so the site can be installed as an app.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}));
  }

  // Chrome offers installing only through this event; keep it for the Install button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__wdInstallPrompt = e;
    window.dispatchEvent(new Event('wd-installable'));
  });
})();
