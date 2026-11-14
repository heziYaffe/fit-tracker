/* פיט — bootstrap */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  document.addEventListener('DOMContentLoaded', function () {
    FitStore.load();
    FitUI.init();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.warn('SW registration failed', err);
      });
    });
  }
})();
