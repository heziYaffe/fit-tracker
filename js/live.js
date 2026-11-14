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
      notes: '',
      templateId: opts.templateId || '',
      templateName: opts.templateName || '',
      templateSnapshot: opts.templateSnapshot || null
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
      targetSets: 0,
      repsMin: sug.reps,
      repsMax: sug.reps,
      restSec: session.restSec,
      notes: '',
      supersetId: '',
      suggestReason: sug.reason,
      sets: [],
      fromTemplate: false
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
    const targetSets = Number(ex.targetSets) || 0;
    let advanced = false;
    if (targetSets && ex.sets.length >= targetSets) {
      const next = session.currentEx + 1;
      if (next < session.exercises.length) {
        session.currentEx = next;
        const nxt = currentExercise();
        if (nxt) {
          const ns = E().suggestNextSet(Store().getState(), nxt.name, nxt.sets, null);
          session.draft.weight = nxt.targetWeight || ns.weight;
          session.draft.reps = nxt.targetReps || ns.reps;
        }
        advanced = true;
      }
    }
    persist();
    row.advanced = advanced;
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
    const ex = currentExercise();
    const sec = (ex && ex.restSec) ? ex.restSec : session.restSec;
    session.restUntil = nowMs() + Math.max(15, Number(sec) || 90) * 1000;
    session.restTotal = Math.max(15, Number(sec) || 90);
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


  function planSuggestion(name, plannedWeight, repsMin, repsMax) {
    const sug = E().suggestNextSet(Store().getState(), name, [], null);
    const hasHist = !!(sug && sug.reason);
    const reps = repsMin || sug.reps || 8;
    if (hasHist) {
      return {
        weight: sug.weight,
        reps: repsMax && sug.reps > repsMax ? repsMax : (repsMin && sug.reps < repsMin ? repsMin : sug.reps),
        reason: sug.reason
      };
    }
    return {
      weight: plannedWeight != null && plannedWeight !== '' ? Number(plannedWeight) : (sug.weight || 20),
      reps: reps,
      reason: plannedWeight ? 'לפי התבנית' : (sug.reason || '')
    };
  }

  function startFromTemplate(template, opts) {
    opts = opts || {};
    if (!template) return start(opts);
    const snapshot = JSON.parse(JSON.stringify(template));
    const sess = start(Object.assign({}, opts, {
      type: template.type || opts.type || 'full',
      customType: template.name || '',
      templateId: template.id,
      templateName: template.name,
      templateSnapshot: snapshot
    }));
    (template.exercises || []).forEach(function (tex) {
      const name = E().normName(tex.name);
      if (!name) return;
      const sug = planSuggestion(name, tex.weight, tex.repsMin, tex.repsMax);
      sess.exercises.push({
        name: name,
        targetSets: Number(tex.sets) || 3,
        targetWeight: sug.weight,
        targetReps: sug.reps,
        repsMin: Number(tex.repsMin) || sug.reps,
        repsMax: Number(tex.repsMax) || sug.reps,
        restSec: Number(tex.restSec) || sess.restSec,
        notes: tex.notes || '',
        supersetId: tex.supersetId || '',
        suggestReason: sug.reason,
        sets: [],
        fromTemplate: true,
        templateExId: tex.id
      });
    });
    if (sess.exercises.length) {
      sess.currentEx = 0;
      const ex = sess.exercises[0];
      sess.draft.weight = ex.targetWeight;
      sess.draft.reps = ex.targetReps;
    }
    persist();
    return sess;
  }

  function skipExercise() {
    if (!session) return;
    const next = session.currentEx + 1;
    if (next < session.exercises.length) selectExercise(next);
  }

  function moveExercise(index, dir) {
    if (!session) return;
    const to = index + dir;
    if (to < 0 || to >= session.exercises.length) return;
    const arr = session.exercises;
    const tmp = arr[index];
    arr[index] = arr[to];
    arr[to] = tmp;
    if (session.currentEx === index) session.currentEx = to;
    else if (session.currentEx === to) session.currentEx = index;
    persist();
  }

  function nextExercise() {
    if (!session) return null;
    return session.exercises[session.currentEx + 1] || null;
  }

  function progress() {
    if (!session || !session.exercises.length) return { current: 0, total: 0 };
    return { current: session.currentEx + 1, total: session.exercises.length };
  }

  function restTotal() {
    if (!session) return 0;
    return session.restTotal || session.restSec || 90;
  }

  function templateChanged() {
    if (!session || !session.templateSnapshot) return false;
    const snap = session.templateSnapshot.exercises || [];
    if (snap.length !== session.exercises.length) return true;
    for (let i = 0; i < snap.length; i++) {
      const a = snap[i];
      const b = session.exercises[i];
      if (E().normName(a.name) !== E().normName(b.name)) return true;
      if ((Number(a.sets) || 0) !== (Number(b.targetSets) || b.sets.length || 0)) return true;
    }
    return session.exercises.some(function (ex) { return !ex.fromTemplate && ex.sets.length; })
      || session.exercises.some(function (ex) { return ex.fromTemplate && ex.sets.length !== (Number(ex.targetSets) || 0); });
  }

  function templatePayloadFromSession() {
    if (!session) return null;
    return {
      exercises: session.exercises.filter(function (ex) {
        return ex.sets.length || ex.fromTemplate;
      }).map(function (ex) {
        const last = ex.sets.length ? ex.sets[ex.sets.length - 1] : null;
        return {
          id: ex.templateExId || undefined,
          name: ex.name,
          sets: ex.sets.length || ex.targetSets || 3,
          repsMin: ex.repsMin || (last && last.reps) || ex.targetReps || 8,
          repsMax: ex.repsMax || (last && last.reps) || ex.targetReps || 12,
          weight: last ? last.weight : (ex.targetWeight || ''),
          restSec: ex.restSec || session.restSec,
          notes: ex.notes || '',
          supersetId: ex.supersetId || ''
        };
      })
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
      exercises: payload.exercises,
      templateId: session.templateId || '',
      templateName: session.templateName || '',
      templateChanged: templateChanged(),
      templatePayload: templatePayloadFromSession()
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
    persist: persist,
    startFromTemplate: startFromTemplate,
    skipExercise: skipExercise,
    moveExercise: moveExercise,
    nextExercise: nextExercise,
    progress: progress,
    restTotal: restTotal,
    templateChanged: templateChanged,
    templatePayloadFromSession: templatePayloadFromSession,
    planSuggestion: planSuggestion
  };

  root.FitLive = FitLive;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitLive;
})(typeof window !== 'undefined' ? window : globalThis);
