/* פיט — bootstrap */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  function consumeWhoopQuery() {
    try {
      var u = new URL(location.href);
      var flag = u.searchParams.get('whoop');
      if (!flag) return null;
      var reason = u.searchParams.get('reason') || '';
      u.searchParams.delete('whoop');
      u.searchParams.delete('reason');
      var search = u.searchParams.toString();
      history.replaceState({}, '', u.pathname + (search ? '?' + search : '') + u.hash);
      return { flag: flag, reason: reason };
    } catch (e) { return null; }
  }

  function handleWhoopReturn() {
    var got = consumeWhoopQuery();
    if (!got) return;
    if (got.flag === 'connected') {
      if (window.FitUI && FitUI.toast) FitUI.toast('Whoop חובר בהצלחה. מושכים נתונים…');
      if (window.FitSync && FitSync.whoopRefresh) {
        FitSync.whoopRefresh().then(function () { return FitSync.syncNow(); }).then(function () {
          if (window.FitUI && FitUI.toast) FitUI.toast('נתוני Whoop עודכנו');
          if (window.FitUI) FitUI.render();
        }).catch(function (e) {
          if (window.FitUI && FitUI.toast) FitUI.toast((e && e.message) || 'משיכת הנתונים נכשלה');
          if (window.FitUI) FitUI.render();
        });
      }
      return;
    }
    var msg = 'החיבור ל-Whoop נכשל. נסו שוב מההגדרות';
    if (got.reason === 'denied') msg = 'החיבור ל-Whoop בוטל';
    else if (got.reason === 'invalid' || got.reason === 'expired') msg = 'הבקשה לא תקינה או שפג תוקפה. נסו שוב מההגדרות';
    else if (got.reason === 'config') msg = 'חיבור Whoop לא מוכן עדיין';
    else if (got.reason === 'token') msg = 'חיבור Whoop נכשל. נסו לחבר מחדש מההגדרות';
    if (window.FitUI && FitUI.toast) FitUI.toast(msg);
  }

  var resolveSessionReady;
  var sessionReady = new Promise(function (res) { resolveSessionReady = res; });
  function whenSessionReady(fn) {
    sessionReady.then(fn, fn);
  }

  document.addEventListener('DOMContentLoaded', function () {
    FitStore.load();
    FitUI.init();
    if (window.FitNotify) FitNotify.start();
    var started = window.FitSync
      ? FitSync.init().then(function () {
          if (window.FitUI) FitUI.render();
          handleWhoopReturn();
        })
      : Promise.resolve();
    started.then(function () { resolveSessionReady(); }, function () { resolveSessionReady(); });

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

  /* Update path may only drop the service worker and Cache Storage.
     Never clear or rewrite localStorage / IndexedDB — that is where the
     auth session and user data live. */
  function forceFreshReload(remoteVersion) {
    var key = 'fit-reloaded-for-v' + remoteVersion;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
    whenSessionReady(function () {
      var swGone = ('serviceWorker' in navigator)
        ? navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
        : Promise.resolve();
      var cachesGone = (typeof caches !== 'undefined')
        ? caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) {
              return String(k).indexOf('fit-tracker') === 0;
            }).map(function (k) { return caches.delete(k); }));
          })
        : Promise.resolve();
      Promise.all([swGone, cachesGone]).then(function () {
        window.location.reload();
      }).catch(function () { window.location.reload(); });
    });
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
        whenSessionReady(function () {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });
      });
      whenSessionReady(checkAppVersion);
    });
  } else {
    window.addEventListener('load', function () { whenSessionReady(checkAppVersion); });
  }
})();
