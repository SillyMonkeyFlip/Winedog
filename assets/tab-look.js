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

  window.WDSettings = {
    get,
    set(patch) {
      const s = { ...get(), ...patch };
      for (const k of Object.keys(s)) if (s[k] === null || s[k] === '') delete s[k];
      localStorage.setItem(KEY, JSON.stringify(s));
      applyTab();
      return s;
    },
    // Pages call this instead of setting document.title, so a custom tab name always wins.
    setTitle(t) { pageTitle = t; applyTab(); },
    applyTab,
    DEFAULT_ICON,
  };

  document.querySelectorAll('link[rel~="icon"]').forEach((l) => { if (l.sizes?.value) l.dataset.sizes = l.sizes.value; });
  applyTab();
})();
