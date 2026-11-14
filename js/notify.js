/* פיט — local reminder scheduling + Notification API.
   Web Push can plug in later via FitNotify.subscribePush() and the SW 'push' handler. */
(function (root) {
  'use strict';

  var CHECK_MS = 30000;
  var timer = 0;
  var started = false;

  function defaultNotifications() {
    return {
      workoutEnabled: false,
      workoutTime: '18:00',
      mealEnabled: false,
      lowHpEnabled: false,
      lowHpThreshold: 50,
      lastFired: { workoutDate: '', meals: {}, lowHpDate: '' }
    };
  }

  function notifOf(state) {
    var base = defaultNotifications();
    var n = (state && state.settings && state.settings.notifications) || {};
    var last = n.lastFired || {};
    return {
      workoutEnabled: !!n.workoutEnabled,
      workoutTime: n.workoutTime || base.workoutTime,
      mealEnabled: !!n.mealEnabled,
      lowHpEnabled: !!n.lowHpEnabled,
      lowHpThreshold: n.lowHpThreshold == null || n.lowHpThreshold === '' ? base.lowHpThreshold : Number(n.lowHpThreshold),
      lastFired: {
        workoutDate: last.workoutDate || '',
        meals: last.meals && typeof last.meals === 'object' ? last.meals : {},
        lowHpDate: last.lowHpDate || ''
      }
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function dateISO(d) {
    if (root.FitEngine && root.FitEngine.todayISO) return root.FitEngine.todayISO(d);
    d = d ? new Date(d) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function timeHM(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function timeReached(now, hhmm) {
    if (!hhmm) return false;
    return timeHM(now) >= hhmm;
  }

  function templatesForDay(state, dow) {
    return (state.templates || []).filter(function (t) {
      return Array.isArray(t.days) && t.days.map(Number).indexOf(dow) !== -1;
    });
  }

  function dayMenuFor(state, date) {
    var list = state.dayMenus || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].date === date) return list[i];
    }
    return null;
  }

  function workoutDue(state, now) {
    var n = notifOf(state);
    if (!n.workoutEnabled) return null;
    var date = dateISO(now);
    if (n.lastFired.workoutDate === date) return null;
    var workouts = state.workouts || [];
    for (var i = 0; i < workouts.length; i++) {
      if (workouts[i] && workouts[i].date === date) return null;
    }
    var matches = templatesForDay(state, now.getDay());
    if (!matches.length) return null;
    if (!timeReached(now, n.workoutTime)) return null;
    var names = matches.map(function (t) { return t.name; }).filter(Boolean).join(', ');
    return {
      kind: 'workout',
      tag: 'fit-workout-' + date,
      title: 'זמן לאימון',
      body: names ? ('היום מתוכנן: ' + names) : 'מועד האימון הגיע',
      url: './#/workouts'
    };
  }

  function mealsDue(state, now) {
    var n = notifOf(state);
    if (!n.mealEnabled) return [];
    var date = dateISO(now);
    var dm = dayMenuFor(state, date);
    if (!dm || !Array.isArray(dm.meals)) return [];
    var fired = n.lastFired.meals || {};
    var out = [];
    dm.meals.forEach(function (meal) {
      if (!meal || !meal.time) return;
      if (meal.status === 'eaten' || meal.status === 'skipped') return;
      if (!timeReached(now, meal.time)) return;
      var key = date + ':' + (meal.id || meal.name || meal.time);
      if (fired[key]) return;
      out.push({
        kind: 'meal',
        mealKey: key,
        tag: 'fit-meal-' + key,
        title: 'זמן לארוחה',
        body: (meal.name || 'ארוחה') + ' · ' + meal.time,
        url: './#/nutrition'
      });
    });
    return out;
  }

  function lowHpDue(state, now, hpPct) {
    var n = notifOf(state);
    if (!n.lowHpEnabled) return null;
    if (hpPct == null || !isFinite(hpPct)) return null;
    if (hpPct >= n.lowHpThreshold) return null;
    var date = dateISO(now);
    if (n.lastFired.lowHpDate === date) return null;
    return {
      kind: 'lowHp',
      tag: 'fit-lowhp-' + date,
      title: 'מד העקביות נמוך',
      body: 'המד עומד על ' + Math.round(hpPct) + '%. כדאי לחזור למסלול היום.',
      url: './#/home'
    };
  }

  function dueReminders(state, now, hpPct) {
    now = now instanceof Date ? now : new Date(now);
    var list = [];
    var w = workoutDue(state, now);
    if (w) list.push(w);
    list = list.concat(mealsDue(state, now));
    var hp = lowHpDue(state, now, hpPct);
    if (hp) list.push(hp);
    return list;
  }

  function supported() {
    return typeof Notification !== 'undefined';
  }

  function permission() {
    if (!supported()) return 'unsupported';
    return Notification.permission || 'default';
  }

  function isIOS() {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    if (typeof window === 'undefined') return false;
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function requestPermission() {
    if (!supported()) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    return Notification.requestPermission();
  }

  function show(note) {
    if (!note || permission() !== 'granted') return Promise.resolve(false);
    var opts = {
      body: note.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: note.tag || ('fit-' + Date.now()),
      renotify: false,
      dir: 'rtl',
      lang: 'he',
      data: { url: note.url || './' }
    };
    function viaPage() {
      try { new Notification(note.title || 'פיט', opts); return true; }
      catch (e) { return false; }
    }
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.ready) {
      return navigator.serviceWorker.ready.then(function (reg) {
        if (reg && reg.showNotification) return reg.showNotification(note.title || 'פיט', opts).then(function () { return true; });
        return viaPage();
      }).catch(function () { return viaPage(); });
    }
    return Promise.resolve(viaPage());
  }

  function markFired(notes) {
    if (!notes || !notes.length || !root.FitStore) return;
    var state = root.FitStore.getState();
    var n = notifOf(state);
    var last = {
      workoutDate: n.lastFired.workoutDate,
      meals: Object.assign({}, n.lastFired.meals),
      lowHpDate: n.lastFired.lowHpDate
    };
    var date = dateISO(new Date());
    notes.forEach(function (note) {
      if (note.kind === 'workout') last.workoutDate = date;
      if (note.kind === 'meal' && note.mealKey) last.meals[note.mealKey] = date;
      if (note.kind === 'lowHp') last.lowHpDate = date;
    });
    root.FitStore.updateSettings({
      notifications: Object.assign({}, n, { lastFired: last })
    });
  }

  function hpPercent(state) {
    if (!root.FitEngine || !root.FitEngine.computeConsistency) return null;
    var cons = root.FitEngine.computeConsistency(state);
    if (!cons || !cons.hasData) return null;
    return (cons.combined || 0) * 100;
  }

  function tick() {
    if (permission() !== 'granted') return Promise.resolve([]);
    if (!root.FitStore) return Promise.resolve([]);
    var state = root.FitStore.getState();
    var due = dueReminders(state, new Date(), hpPercent(state));
    if (!due.length) return Promise.resolve([]);
    markFired(due);
    return Promise.all(due.map(function (note) { return show(note); })).then(function () { return due; });
  }

  function start() {
    if (started) return;
    started = true;
    tick();
    if (typeof window === 'undefined') return;
    timer = setInterval(tick, CHECK_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
    window.addEventListener('focus', tick);
  }

  function patchNotifications(patch) {
    if (!root.FitStore) return;
    var n = Object.assign({}, notifOf(root.FitStore.getState()), patch);
    root.FitStore.updateSettings({ notifications: n });
  }

  /* Reserved for a future VAPID / server Web Push subscription. */
  function subscribePush() {
    return Promise.resolve({ ok: false, reason: 'no-config' });
  }

  var FitNotify = {
    defaultNotifications: defaultNotifications,
    notifOf: notifOf,
    dueReminders: dueReminders,
    supported: supported,
    permission: permission,
    isIOS: isIOS,
    isStandalone: isStandalone,
    requestPermission: requestPermission,
    show: show,
    tick: tick,
    start: start,
    patchNotifications: patchNotifications,
    subscribePush: subscribePush
  };

  root.FitNotify = FitNotify;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitNotify;
})(typeof window !== 'undefined' ? window : globalThis);
