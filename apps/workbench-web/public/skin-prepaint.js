/* Palette-only cache: prevent a light flash, including on the server-rendered login page. */
(() => {
  try {
    const root = document.documentElement;
    const legacy = localStorage.getItem('codywork.theme');
    root.dataset.theme = ['professional', 'midnight', 'forest', 'qq-2007'].includes(legacy) ? legacy : 'professional';
    root.style.colorScheme = legacy === 'midnight' ? 'dark' : 'light';
    const cache = JSON.parse(localStorage.getItem('codywork.skin-paint.v1') || 'null');
    if (!cache || !['light', 'dark'].includes(cache.mode)) return;
    root.style.colorScheme = cache.mode;
    for (const [key, value] of Object.entries(cache.variables || {})) {
      if (/^--(?:surface-|ink-|border-|nav-|accent|on-accent|success|warning|danger|code-|overlay|shadow-|radius-|font-)/.test(key)
          && typeof value === 'string' && value.length < 300 && !/[{};\\]|url\s*\(|image|@|expression/iu.test(value)) root.style.setProperty(key, value);
    }
  } catch { /* Storage disabled or corrupt: CSS defaults remain readable. */ }
})();
