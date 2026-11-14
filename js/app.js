/* פיט — bootstrap */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    FitStore.load();
    FitUI.init();
    if (window.FitNotify) FitNotify.start();
    if (window.FitSync) FitSync.init().then(function () { if (window.FitUI) FitUI.render(); });

    var fgTimer = 0;
    function onForeground() {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (!window.FitSync || !FitSync.onForeground) return;
      clearTimeout(fgTimer);
      fgTimer = setTimeout(function () {
        FitSync.onForeground().then(function () { if (window.FitUI) FitUI.render(); });
      }, 200);
    }
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('pageshow', onForeground);
    window.addEventListener('focus', onForeground);
  });

  function forceFreshReload(remoteVersion) {
    var key = 'fit-reloaded-for-v' + remoteVersion;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
    var swGone = ('serviceWorker' in navigator)
      ? navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        })
      : Promise.resolve();
    var cachesGone = (typeof caches !== 'undefined')
      ? caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        })
      : Promise.resolve();
    Promise.all([swGone, cachesGone]).then(function () {
      window.location.reload();
    }).catch(function () { window.location.reload(); });
  }

  function checkAppVersion() {
    var local = (window.FitConfig && FitConfig.APP_VERSION) || '';
    fetch('./version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (v) {
      if (!v || v.version == null || !local) return;
      if (Number(v.version) > Number(local)) forceFreshReload(v.version);
    }).catch(function () {});
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js?v=' + encodeURIComponent((window.FitConfig && FitConfig.APP_VERSION) || ''), { updateViaCache: 'none' }).then(function (reg) {
        reg.update();
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') {
            reg.update();
            checkAppVersion();
          }
        });
      }).catch(function (err) {
        console.warn('SW registration failed', err);
      });
      var hadController = !!navigator.serviceWorker.controller;
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      checkAppVersion();
    });
  } else {
    window.addEventListener('load', checkAppVersion);
  }
})();
