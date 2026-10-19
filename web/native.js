// Connects the game to the platform it runs on.
// Inside the iOS and Android apps (Capacitor): saved games and personal bests are mirrored to native storage,
// which the OS keeps safely (web storage can be cleared), and buttons give a light haptic tap.
// On the web: registers the offline cache so the game works without a connection and can be installed.
// The game itself only calls window.ocheNative?.… so it also runs without this file.
(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  // Calls a native plugin method through Capacitor's bridge (no bundler needed); resolves to null on the web
  const canCall = isNative && typeof cap.nativePromise === 'function';
  const call = (plugin, method, options = {}) => canCall ? cap.nativePromise(plugin, method, options).catch(() => null) : Promise.resolve(null);
  const KEYS = ['oche-match-v1', 'oche-bests', 'oche-history-v1', 'oche-settings-v1'];

  // Web wake lock: the sentinel is dropped by the browser when the tab is hidden, so it is re-requested on return
  let awake = false, lock = null;
  // A request can finish after keepAwake(false), so a late lock is released straight away
  const holdLock = () => navigator.wakeLock.request('screen').then(l => { if (awake) lock = l; else l.release(); }).catch(() => {});

  window.ocheNative = {
    isNative,
    haptics: true,
    persist(key, value) { call('Preferences', 'set', { key, value }); },
    remove(key) { call('Preferences', 'remove', { key }); },
    tap() { if (this.haptics) call('Haptics', 'impact', { style: 'LIGHT' }); },
    celebrate() { if (this.haptics) call('Haptics', 'notification', { type: 'SUCCESS' }); },
    // Called on every render, so only act when the state changes
    keepAwake(on) {
      on = !!on;
      if (on === awake) return;
      awake = on;
      if (canCall) call('KeepAwake', on ? 'keepAwake' : 'allowSleep');
      else if (!('wakeLock' in navigator)) return;
      else if (on) holdLock();
      else if (lock) { lock.release().catch(() => {}); lock = null; }
    },
    async share({ title, text }) {
      try {
        if (canCall) return (await call('Share', 'share', { title, text })) ? 'shared' : 'failed';
        if (navigator.share) { await navigator.share({ title, text }); return 'shared'; }
        await navigator.clipboard.writeText(text);
        return 'copied';
      } catch (e) { return 'failed'; } // includes the user dismissing the share sheet
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (awake && !canCall && 'wakeLock' in navigator && document.visibilityState === 'visible') holdLock();
  });

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
    if (canCall && cap.getPlatform() === 'android') {
      // Hardware back: the game closes a dialog or goes back to the menu (window.ocheBack); on the menu the app goes to the background
      cap.addListener('App', 'backButton', () => { if (!window.ocheBack?.()) call('App', 'minimizeApp'); });
      // Status and navigation bar icons follow the in-app theme (data-theme on <html>), or the system one when it is unset
      const barStyle = () => call('SystemBars', 'setStyle', { style: { dark: 'DARK', light: 'LIGHT' }[document.documentElement.dataset.theme] || 'DEFAULT' });
      new MutationObserver(barStyle).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', barStyle);
      barStyle();
    }
  } else if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
