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
      draft: { weight: 20, reps: 8, secs: 45 },
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
    const bw = E().isBodyweightName(n);
    const st = E().isStaticName ? E().isStaticName(n) : false;
    session.exercises.push({
      name: n,
      targetWeight: sug.weight,
      targetReps: st ? 0 : sug.reps,
      targetSecs: st ? (sug.secs || 45) : 0,
      targetSets: 0,
      repsMode: 'range',
      repsMin: sug.reps,
      repsMax: sug.reps,
      restSec: session.restSec,
      notes: '',
      supersetId: '',
      suggestReason: sug.reason,
      sets: [],
      fromTemplate: false,
      bodyweight: bw || st,
      static: st
    });
    session.currentEx = session.exercises.length - 1;
    session.draft.weight = sug.weight;
    session.draft.reps = st ? 0 : sug.reps;
    session.draft.secs = st ? (sug.secs || 45) : 0;
    persist();
    return session.exercises[session.currentEx];
  }

  function selectExercise(index) {
    if (!session) return;
    cancelHold();
    session.currentEx = index;
    const ex = currentExercise();
    if (ex) {
      applyDraftForExercise(ex);
    }
    persist();
  }

  function applyDraftForExercise(ex) {
    const sug = E().suggestNextSet(Store().getState(), ex.name, ex.sets, null);
    const isMax = E().isMaxReps(ex);
    const isBw = E().isBodyweightEx(ex, ex.name);
    const isSt = E().isStaticEx ? E().isStaticEx(ex, ex.name) : !!ex.static;
    session.draft.weight = ex.sets.length
      ? sug.weight
      : (ex.targetWeight != null && ex.targetWeight !== '' ? ex.targetWeight : (isBw || isSt ? (sug.weight || 0) : sug.weight));
    if (isSt) {
      const best = E().bestHoldForExercise ? E().bestHoldForExercise(Store().getState(), ex.name) : 0;
      const last = ex.sets.length ? (Number(ex.sets[ex.sets.length - 1].secs) || 0) : 0;
      if (isMax) session.draft.secs = last || best || sug.secs || 45;
      else session.draft.secs = ex.sets.length ? (last || sug.secs) : (ex.targetSecs || sug.secs || 45);
      session.draft.reps = 0;
    } else if (isMax) {
      const best = E().bestRepsForExercise(Store().getState(), ex.name);
      const last = ex.sets.length ? ex.sets[ex.sets.length - 1].reps : 0;
      session.draft.reps = last || best || sug.reps || 8;
    } else {
      session.draft.reps = ex.sets.length ? sug.reps : (ex.targetReps || sug.reps);
    }
  }

  function setDraft(patch) {
    if (!session) return;
    if (patch.weight != null) session.draft.weight = Math.max(0, Number(patch.weight) || 0);
    if (patch.reps != null) session.draft.reps = Math.max(0, Math.round(Number(patch.reps) || 0));
    if (patch.secs != null) session.draft.secs = Math.max(0, Math.round(Number(patch.secs) || 0));
    persist();
  }

  function stepDraft(field, delta) {
    if (!session) return;
    if (field === 'weight') {
      const step = Math.abs(delta);
      session.draft.weight = Math.max(0, Math.round((Number(session.draft.weight) + delta) * 4) / 4);
    } else if (field === 'reps') {
      session.draft.reps = Math.max(0, Math.round(Number(session.draft.reps) + delta));
    } else if (field === 'secs') {
      session.draft.secs = Math.max(0, Math.round(Number(session.draft.secs || 0) + delta));
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
    return E().setIsPR(Store().getState(), ex.name, session.draft.weight, session.draft.reps, null, session.draft.secs);
  }

  function logSet() {
    const ex = currentExercise();
    if (!ex || !session) return null;
    const isSt = E().isStaticEx ? E().isStaticEx(ex, ex.name) : !!ex.static;
    const weight = Number(session.draft.weight) || 0;
    const reps = isSt ? 0 : (Number(session.draft.reps) || 0);
    const secs = isSt ? (Number(session.draft.secs) || 0) : 0;
    if (isSt) {
      if (secs <= 0) return null;
    } else if (weight <= 0 && reps <= 0) {
      return null;
    }
    const pr = E().setIsPR(Store().getState(), ex.name, weight, reps, null, secs);
    const row = { weight: weight, reps: reps, secs: secs, at: nowMs(), pr: pr.isPR, prTypes: pr.types };
    ex.sets.push(row);
    const sug = E().suggestNextSet(Store().getState(), ex.name, ex.sets, null);
    session.draft.weight = sug.weight;
    if (isSt) {
      if (E().isMaxReps(ex)) session.draft.secs = secs || sug.secs || 45;
      else session.draft.secs = ex.targetSecs || sug.secs || secs;
    } else if (E().isMaxReps(ex)) {
      session.draft.reps = reps || sug.reps;
    } else {
      session.draft.reps = ex.targetReps || sug.reps;
    }
    startRest();
    const targetSets = Number(ex.targetSets) || 0;
    let advanced = false;
    if (targetSets && ex.sets.length >= targetSets) {
      const next = session.currentEx + 1;
      if (next < session.exercises.length) {
        session.currentEx = next;
        const nxt = currentExercise();
        if (nxt) applyDraftForExercise(nxt);
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
    if (sug.secs != null) session.draft.secs = sug.secs;
    cancelHold();
    cancelRest();
    persist();
  }


  function formatHoldClock(sec) {
    const n = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function startHold() {
    if (!session) return null;
    cancelRest();
    const ex = currentExercise();
    if (!ex) return null;
    const isMax = E().isMaxReps(ex);
    const target = isMax ? 0 : (Number(session.draft.secs) || Number(ex.targetSecs) || 45);
    session.hold = {
      phase: 'ready',
      readyUntil: nowMs() + 3000,
      startedAt: 0,
      targetSec: target,
      isMax: !!isMax,
      beeps: {}
    };
    requestWakeLock();
    persist();
    return session.hold;
  }

  function cancelHold() {
    if (!session || !session.hold) return;
    session.hold = null;
    persist();
  }

  function holdState() {
    if (!session || !session.hold) return null;
    const h = session.hold;
    const now = nowMs();
    if (h.phase === 'ready') {
      const leftMs = h.readyUntil - now;
      const left = Math.max(0, Math.ceil(leftMs / 1000));
      return { phase: 'ready', left: left, display: String(left || 0), target: h.targetSec, isMax: !!h.isMax };
    }
    const elapsed = Math.max(0, Math.floor((now - h.startedAt) / 1000));
    if (h.isMax || !h.targetSec) {
      return { phase: 'running', elapsed: elapsed, display: formatHoldClock(elapsed), overtime: false, isMax: true, target: 0 };
    }
    const remaining = h.targetSec - elapsed;
    if (remaining >= 0) {
      return { phase: 'running', elapsed: elapsed, remaining: remaining, display: formatHoldClock(remaining), overtime: false, isMax: false, target: h.targetSec };
    }
    return {
      phase: 'running',
      elapsed: elapsed,
      remaining: remaining,
      overtime: true,
      overtimeSec: elapsed - h.targetSec,
      display: '+' + formatHoldClock(elapsed - h.targetSec),
      isMax: false,
      target: h.targetSec
    };
  }

  function tickHold() {
    if (!session || !session.hold) return;
    const h = session.hold;
    const now = nowMs();
    if (h.phase === 'ready') {
      if (now >= h.readyUntil) {
        h.phase = 'running';
        h.startedAt = h.readyUntil;
        persist();
        beep(660);
        if (tickFn) tickFn({ type: 'hold-phase', state: holdState() });
        return;
      }
      const left = Math.max(0, Math.ceil((h.readyUntil - now) / 1000));
      const key = 'ready' + left;
      if (left >= 1 && left <= 3 && !h.beeps[key]) {
        h.beeps[key] = true;
        persist();
        beep(left === 1 ? 720 : 520);
      }
      if (tickFn) tickFn({ type: 'hold', state: holdState() });
      return;
    }
    const st = holdState();
    if (st && !st.isMax && st.target) {
      if (st.remaining != null && st.remaining <= 3 && st.remaining >= 1) {
        const key = 'end' + st.remaining;
        if (!h.beeps[key]) {
          h.beeps[key] = true;
          persist();
          beep(880);
        }
      }
      if (st.overtime && !h.beeps.done) {
        h.beeps.done = true;
        persist();
        beep(1200);
        vibrate();
      }
    }
    if (tickFn) tickFn({ type: 'hold', state: st });
  }

  function stopHold() {
    if (!session || !session.hold) return null;
    const st = holdState();
    if (!st || st.phase === 'ready') {
      cancelHold();
      return null;
    }
    const secs = Math.max(1, st.elapsed || 0);
    session.draft.secs = secs;
    session.hold = null;
    persist();
    return logSet();
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

  function beep(freq) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq || 880;
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
      if (session.hold) tickHold();
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
        setLogs: ex.sets.map(function (s) { return { weight: s.weight, reps: s.reps, secs: s.secs || 0 }; }),
        bodyweight: !!ex.bodyweight,
        static: !!ex.static,
        secs: ex.sets.reduce(function (m, s) { return Math.max(m, Number(s.secs) || 0); }, 0)
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


  function recOptsFromExercise(ex, extra) {
    extra = extra || {};
    if (!ex) return extra;
    return Object.assign({
      sets: Number(ex.targetSets) || Number(ex.sets) || 3,
      repsMin: ex.repsMin,
      repsMax: ex.repsMax,
      repsMode: ex.repsMode,
      bodyweight: !!ex.bodyweight,
      static: !!ex.static,
      increment: ex.weightStep || extra.increment
    }, extra);
  }

  function loadRecommendation(name, opts) {
    if (!E().recommendNextLoad) return null;
    return E().recommendNextLoad(Store().getState(), name, opts || {}) || null;
  }

  function applyLoadRecommendation(index) {
    if (!session) return null;
    const idx = index == null ? session.currentEx : Number(index);
    const ex = session.exercises[idx];
    if (!ex) return null;
    const rec = loadRecommendation(ex.name, recOptsFromExercise(ex));
    if (!rec) return null;
    ex.targetSets = rec.sets;
    ex.targetWeight = rec.weight;
    if (rec.kind !== 'max') ex.targetReps = rec.reps;
    if (rec.secs) ex.targetSecs = rec.secs;
    ex.suggestReason = rec.reason;
    ex.loadRec = rec;
    if (idx === session.currentEx) {
      session.draft.weight = rec.weight;
      session.draft.reps = rec.reps || 0;
      if (rec.secs) session.draft.secs = rec.secs;
    }
    persist();
    return rec;
  }

  function planSuggestion(name, plannedWeight, repsMin, repsMax, opts) {
    opts = opts || {};
    const isMax = opts.repsMode === 'max' || E().isMaxReps(opts);
    const isBw = opts.bodyweight || E().isBodyweightName(name);
    const rec = loadRecommendation(name, Object.assign({}, opts, {
      sets: opts.sets,
      repsMin: repsMin,
      repsMax: repsMax,
      bodyweight: opts.bodyweight,
      static: opts.static,
      repsMode: opts.repsMode
    }));
    const sug = E().suggestNextSet(Store().getState(), name, [], null);
    const hasHist = !!(rec || (sug && sug.reason && sug.reason.indexOf('אין היסטוריה') === -1));
    if (rec) {
      return {
        weight: rec.weight,
        reps: rec.reps,
        secs: rec.secs || 0,
        reason: rec.reason,
        label: rec.label,
        rec: rec,
        bestHold: rec.kind === 'static' ? rec.secs : 0,
        bestMaxReps: rec.kind === 'max' ? rec.reps : (E().bestRepsForExercise(Store().getState(), name) || 0)
      };
    }
    const best = E().bestRepsForExercise(Store().getState(), name);
    const planned = plannedWeight != null && plannedWeight !== '' ? Number(plannedWeight) : null;
    const isSt = !!(opts.static || (E().isStaticName && E().isStaticName(name)));
    if (isSt) {
      const bestHold = E().bestHoldForExercise ? E().bestHoldForExercise(Store().getState(), name) : 0;
      const plannedSecs = Number(opts.secsMax || opts.secsMin || sug.secs || 45) || 45;
      const weight = hasHist
        ? (sug.lastWeight != null ? sug.lastWeight : sug.weight)
        : (planned != null ? planned : 0);
      const secs = isMax
        ? (hasHist ? (sug.lastSecs || sug.secs || bestHold) : (bestHold || plannedSecs))
        : (hasHist ? (sug.lastSecs || sug.secs || plannedSecs) : plannedSecs);
      return {
        weight: weight,
        reps: 0,
        secs: secs,
        reason: bestHold ? ('שיא החזקה קודם: ' + bestHold + ' שנ׳') : (isMax ? 'החזקה עד כשל' : 'לפי התבנית'),
        bestHold: bestHold,
        bestMaxReps: 0
      };
    }
    if (isMax) {
      const weight = hasHist
        ? (sug.lastWeight != null ? sug.lastWeight : sug.weight)
        : (planned != null ? planned : (isBw ? 0 : (sug.weight || 20)));
      const reps = hasHist ? (sug.lastReps || sug.reps) : (best || 8);
      return {
        weight: weight,
        reps: reps,
        reason: best ? ('שיא MAX קודם: ' + best + ' חזרות') : (isBw ? 'משקל גוף · עד כשל' : 'עד כשל'),
        bestMaxReps: best
      };
    }
    const reps = repsMin || sug.reps || 8;
    if (hasHist) {
      let nextReps = sug.reps;
      if (!isMax && repsMax && sug.reps > repsMax) nextReps = repsMax;
      else if (!isMax && repsMin && sug.reps < repsMin) nextReps = repsMin;
      return {
        weight: sug.weight,
        reps: nextReps,
        reason: sug.reason,
        bestMaxReps: best
      };
    }
    return {
      weight: planned != null ? planned : (isBw ? 0 : (sug.weight || 20)),
      reps: reps,
      reason: isBw ? 'משקל גוף' : (planned != null ? 'לפי התבנית' : (sug.reason || '')),
      bestMaxReps: best
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
      const isMax = E().isMaxReps(tex);
      const isBw = tex.bodyweight != null ? !!tex.bodyweight : E().isBodyweightName(name);
      const isSt = tex.static != null ? !!tex.static : !!(E().isStaticName && E().isStaticName(name));
      const sug = planSuggestion(name, tex.weight, tex.repsMin, tex.repsMax, {
        repsMode: isMax ? 'max' : 'range',
        bodyweight: isBw,
        static: isSt,
        secsMin: tex.secsMin,
        secsMax: tex.secsMax,
        sets: Number(tex.sets) || 3
      });
      const targetSecs = isMax ? 0 : (Number(tex.secsMax) || Number(tex.secsMin) || sug.secs || 45);
      sess.exercises.push({
        name: name,
        targetSets: Number(tex.sets) || 3,
        targetWeight: sug.weight,
        targetReps: isSt || isMax ? null : sug.reps,
        targetSecs: isSt ? targetSecs : 0,
        repsMode: isMax ? 'max' : 'range',
        repsMin: isMax ? tex.repsMin : (Number(tex.repsMin) || sug.reps),
        repsMax: isMax ? tex.repsMax : (Number(tex.repsMax) || sug.reps),
        secsMin: Number(tex.secsMin) || targetSecs,
        secsMax: Number(tex.secsMax) || targetSecs,
        restSec: Number(tex.restSec) || sess.restSec,
        notes: tex.notes || '',
        supersetId: tex.supersetId || '',
        suggestReason: sug.reason,
        bestMaxReps: sug.bestMaxReps || 0,
        bestHold: sug.bestHold || 0,
        sets: [],
        fromTemplate: true,
        templateExId: tex.id,
        bodyweight: isBw,
        static: isSt
      });
    });
    if (sess.exercises.length) {
      sess.currentEx = 0;
      applyDraftForExercise(sess.exercises[0]);
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
          repsMode: ex.repsMode || 'range',
          repsMin: ex.repsMin || (last && last.reps) || ex.targetReps || 8,
          repsMax: ex.repsMax || (last && last.reps) || ex.targetReps || 12,
          weight: last ? last.weight : (ex.targetWeight || ''),
          restSec: ex.restSec || session.restSec,
          notes: ex.notes || '',
          supersetId: ex.supersetId || '',
          bodyweight: !!ex.bodyweight,
          static: !!ex.static,
          secsMin: ex.secsMin || ex.targetSecs || (last && last.secs) || '',
          secsMax: ex.secsMax || ex.targetSecs || (last && last.secs) || ''
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
        if (s.pr) prs.push({ name: ex.name, weight: s.weight, reps: s.reps, secs: s.secs || 0, types: s.prTypes });
      });
    });
    const volume = payload.exercises.reduce(function (sum, ex) {
      return sum + E().setVolume(ex, Store().getState(), session.date);
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
    planSuggestion: planSuggestion,
    loadRecommendation: loadRecommendation,
    applyLoadRecommendation: applyLoadRecommendation,
    recOptsFromExercise: recOptsFromExercise,
    startHold: startHold,
    stopHold: stopHold,
    cancelHold: cancelHold,
    holdState: holdState,
    formatHoldClock: formatHoldClock
  };

  root.FitLive = FitLive;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitLive;
})(typeof window !== 'undefined' ? window : globalThis);
