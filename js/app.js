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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
        reg.update();
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') reg.update();
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
    });
  }
})();
