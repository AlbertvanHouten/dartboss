// Connects the game to the platform it runs on.
// Inside the iOS app (Capacitor): saved games and personal bests are mirrored to native storage,
// which iOS keeps safely (web storage can be cleared), and buttons give a light haptic tap.
// On the web: registers the offline cache so the game works without a connection and can be installed.
// The game itself only calls window.ocheNative?.… so it also runs without this file.
(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  // Calls a native plugin method through Capacitor's bridge (no bundler needed); resolves to null on the web
  const canCall = isNative && typeof cap.nativePromise === 'function';
  const call = (plugin, method, options = {}) => canCall ? cap.nativePromise(plugin, method, options).catch(() => null) : Promise.resolve(null);
  const KEYS = ['oche-match-v1', 'oche-bests'];

  window.ocheNative = {
    isNative,
    persist(key, value) { call('Preferences', 'set', { key, value }); },
    tap() { call('Haptics', 'impact', { style: 'LIGHT' }); },
    celebrate() { call('Haptics', 'notification', { type: 'SUCCESS' }); },
  };

  // Before the game starts, restore anything web storage lost from the native copy
  window.ocheReady = (async () => {
    if (!canCall) return;
    for (const key of KEYS) {
      try {
        const { value } = (await call('Preferences', 'get', { key })) || {};
        if (value != null && localStorage.getItem(key) == null) localStorage.setItem(key, value);
      } catch (e) { /* keep going with what web storage has */ }
    }
  })();

  if (isNative) {
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('button:not(:disabled)')) window.ocheNative.tap();
    }, true);
  } else if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
