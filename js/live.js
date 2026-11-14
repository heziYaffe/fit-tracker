/* פיט — live workout session logic (no DOM except optional sound). */
(function (root) {
  'use strict';

  const SESSION_KEY = 'hazi-fit-live-session';
  let session = null;
  let restTimer = null;
  let elapsedTimer = null;
  let wakeLock = null;
  let tickFn = null;

  function C() { return root.FitConfig; }
  function E() { return root.FitEngine; }
  function Store() { return root.FitStore; }

  function nowMs() { return Date.now(); }

  function getSession() { return session; }

  function persist() {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (err) { /* ignore */ }
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      session = JSON.parse(raw);
      return session;
    } catch (err) {
      return null;
    }
  }

  function start(opts) {
    opts = opts || {};
    session = {
      id: 'live_' + nowMs(),
      date: opts.date || E().todayISO(),
      type: opts.type || 'full',
      customType: opts.customType || '',
      startedAt: nowMs(),
      restSec: (opts.restSec != null ? opts.restSec : (C().REST_DEFAULT_SEC || 90)),
      currentEx: -1,
      exercises: [],
      draft: { weight: 20, reps: 8 },
      restUntil: null,
      notes: ''
    };
    persist();
    requestWakeLock();
    return session;
  }

  function discard() {
    stopTimers();
    releaseWakeLock();
    session = null;
    persist();
  }

  function currentExercise() {
    if (!session || session.currentEx < 0) return null;
    return session.exercises[session.currentEx] || null;
  }

  function applySuggestion(name) {
    const sug = E().suggestNextSet(Store().getState(), name, [], null);
    session.draft.weight = sug.weight;
    session.draft.reps = sug.reps;
    return sug;
  }

  function addExercise(name) {
    if (!session) return null;
    const n = E().normName(name);
    if (!n) return null;
    const sug = E().suggestNextSet(Store().getState(), n, [], null);
    session.exercises.push({
      name: n,
      targetWeight: sug.weight,
      targetReps: sug.reps,
      suggestReason: sug.reason,
      sets: []
    });
    session.currentEx = session.exercises.length - 1;
    session.draft.weight = sug.weight;
    session.draft.reps = sug.reps;
    persist();
    return session.exercises[session.currentEx];
  }

  function selectExercise(index) {
    if (!session) return;
    session.currentEx = index;
    const ex = currentExercise();
    if (ex) {
      const sug = E().suggestNextSet(Store().getState(), ex.name, ex.sets, null);
      session.draft.weight = sug.weight;
      session.draft.reps = sug.reps;
    }
    persist();
  }

  function setDraft(patch) {
    if (!session) return;
    if (patch.weight != null) session.draft.weight = Math.max(0, Number(patch.weight) || 0);
    if (patch.reps != null) session.draft.reps = Math.max(0, Math.round(Number(patch.reps) || 0));
    persist();
  }

  function stepDraft(field, delta) {
    if (!session) return;
    if (field === 'weight') {
      const step = Math.abs(delta);
      session.draft.weight = Math.max(0, Math.round((Number(session.draft.weight) + delta) * 4) / 4);
    } else if (field === 'reps') {
      session.draft.reps = Math.max(0, Math.round(Number(session.draft.reps) + delta));
    }
    persist();
  }

  function setType(type, customType) {
    if (!session) return;
    session.type = type;
    if (customType != null) session.customType = customType;
    persist();
  }

  function setRestSec(sec) {
    if (!session) return;
    session.restSec = Math.max(15, Math.min(300, Number(sec) || 90));
    persist();
  }

  function prForDraft() {
    const ex = currentExercise();
    if (!ex || !session) return { isPR: false, types: [] };
    return E().setIsPR(Store().getState(), ex.name, session.draft.weight, session.draft.reps, null);
  }

  function logSet() {
    const ex = currentExercise();
    if (!ex || !session) return null;
    const weight = Number(session.draft.weight) || 0;
    const reps = Number(session.draft.reps) || 0;
    if (weight <= 0 && reps <= 0) return null;
    const pr = E().setIsPR(Store().getState(), ex.name, weight, reps, null);
    // also vs earlier sets this session
    const earlierMax = ex.sets.reduce(function (m, s) { return Math.max(m, s.weight); }, 0);
    if (weight > earlierMax && earlierMax > 0 && pr.types.indexOf('weight') === -1) {
      /* current-session PR vs history already handled; history wins */
    }
    const row = { weight: weight, reps: reps, at: nowMs(), pr: pr.isPR, prTypes: pr.types };
    ex.sets.push(row);
    const sug = E().suggestNextSet(Store().getState(), ex.name, ex.sets, null);
    session.draft.weight = sug.weight;
    session.draft.reps = ex.targetReps || sug.reps;
    startRest();
    persist();
    return row;
  }

  function undoLastSet() {
    const ex = currentExercise();
    if (!ex || !ex.sets.length) return;
    ex.sets.pop();
    const sug = E().suggestNextSet(Store().getState(), ex.name, ex.sets, null);
    session.draft.weight = sug.weight;
    session.draft.reps = sug.reps;
    cancelRest();
    persist();
  }

  function startRest() {
    if (!session) return;
    session.restUntil = nowMs() + session.restSec * 1000;
    persist();
  }

  function cancelRest() {
    if (!session) return;
    session.restUntil = null;
    persist();
  }

  function restRemaining() {
    if (!session || !session.restUntil) return 0;
    return Math.max(0, Math.ceil((session.restUntil - nowMs()) / 1000));
  }

  function elapsedMs() {
    if (!session) return 0;
    return Math.max(0, nowMs() - session.startedAt);
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setTimeout(function () { ctx.close(); }, 800);
    } catch (err) { /* ignore */ }
  }

  function vibrate() {
    try {
      if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    } catch (err) { /* ignore */ }
  }

  function onTick(fn) { tickFn = fn; }

  function startClocks() {
    stopTimers();
    let restFired = false;
    restTimer = setInterval(function () {
      if (!session) return;
      if (session.restUntil) {
        const left = restRemaining();
        if (left <= 0 && !restFired) {
          restFired = true;
          session.restUntil = null;
          persist();
          beep();
          vibrate();
          if (tickFn) tickFn({ type: 'rest-done' });
        } else if (left > 0) {
          restFired = false;
          if (tickFn) tickFn({ type: 'rest', left: left });
        }
      }
    }, 250);
    elapsedTimer = setInterval(function () {
      if (tickFn) tickFn({ type: 'elapsed', ms: elapsedMs() });
    }, 1000);
  }

  function stopTimers() {
    if (restTimer) { clearInterval(restTimer); restTimer = null; }
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  }

  function requestWakeLock() {
    releaseWakeLock();
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { wakeLock = null; });
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (err) { /* ignore */ }
      wakeLock = null;
    }
  }

  function toWorkout() {
    if (!session) return null;
    const exercises = [];
    session.exercises.forEach(function (ex) {
      if (!ex.sets.length) return;
      const top = ex.sets.reduce(function (m, s) { return s.weight > m.weight ? s : m; }, ex.sets[0]);
      exercises.push({
        name: ex.name,
        sets: ex.sets.length,
        reps: top.reps,
        weight: top.weight,
        setLogs: ex.sets.map(function (s) { return { weight: s.weight, reps: s.reps }; })
      });
    });
    if (!exercises.length) return null;
    const minutes = Math.max(1, Math.round(elapsedMs() / 60000));
    return {
      date: session.date,
      type: session.type,
      customType: session.customType || '',
      exercises: exercises,
      duration: minutes,
      notes: session.notes || ''
    };
  }

  function finish() {
    const payload = toWorkout();
    if (!payload) return null;
    const prs = [];
    session.exercises.forEach(function (ex) {
      ex.sets.forEach(function (s) {
        if (s.pr) prs.push({ name: ex.name, weight: s.weight, reps: s.reps, types: s.prTypes });
      });
    });
    const volume = payload.exercises.reduce(function (sum, ex) {
      return sum + E().setVolume(ex);
    }, 0);
    const saved = Store().addWorkout(payload);
    const summary = {
      workout: saved,
      durationMin: payload.duration,
      volume: volume,
      prs: prs,
      xp: (C().XP_RULES.workoutLogged || {}).xp || 40,
      exercises: payload.exercises
    };
    discard();
    return summary;
  }

  const FitLive = {
    getSession: getSession,
    restore: restore,
    start: start,
    discard: discard,
    addExercise: addExercise,
    selectExercise: selectExercise,
    currentExercise: currentExercise,
    setDraft: setDraft,
    stepDraft: stepDraft,
    setType: setType,
    setRestSec: setRestSec,
    prForDraft: prForDraft,
    logSet: logSet,
    undoLastSet: undoLastSet,
    startRest: startRest,
    cancelRest: cancelRest,
    restRemaining: restRemaining,
    elapsedMs: elapsedMs,
    onTick: onTick,
    startClocks: startClocks,
    stopTimers: stopTimers,
    requestWakeLock: requestWakeLock,
    releaseWakeLock: releaseWakeLock,
    toWorkout: toWorkout,
    finish: finish,
    persist: persist
  };

  root.FitLive = FitLive;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitLive;
})(typeof window !== 'undefined' ? window : globalThis);
