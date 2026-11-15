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

  let clockNow = null;
  function nowMs() { return clockNow != null ? clockNow : Date.now(); }
  function setClock(ms) { clockNow = (ms == null || ms === '') ? null : Number(ms); }

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
      if (session && session.restUntil && !session.restStartedAt) {
        const total = Number(session.restTotal) || Number(session.restSec) || 0;
        session.restStartedAt = total ? (session.restUntil - total * 1000) : Date.now();
        session.restTargetSec = total || 0;
        session.restTargetNotified = total ? (session.restUntil <= Date.now()) : false;
        session.restUntil = null;
      }
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
      restStartedAt: null,
      restTargetSec: 0,
      restTargetNotified: false,
      restFor: null,
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

  function supersetGroup(index) {
    if (!session || index == null || index < 0 || index >= session.exercises.length) return [];
    const sid = session.exercises[index] && session.exercises[index].supersetId;
    if (!sid) return [index];
    let start = index;
    let end = index;
    while (start > 0 && session.exercises[start - 1].supersetId === sid) start -= 1;
    while (end < session.exercises.length - 1 && session.exercises[end + 1].supersetId === sid) end += 1;
    if (start === end) return [index];
    const out = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }

  function isParked(ex) {
    return !!(ex && (ex.skipped || ex.finishedEarly));
  }

  function needsMoreSets(ex) {
    if (!ex || isParked(ex)) return false;
    const t = Number(ex.targetSets) || 0;
    if (!t) return false;
    return (ex.sets || []).length < t;
  }

  function defaultRestTarget() {
    try {
      const st = Store() && Store().getState && Store().getState();
      const n = st && st.settings ? Number(st.settings.restTargetSec) : 0;
      if (n > 0) return Math.max(15, Math.min(600, Math.round(n)));
    } catch (err) { /* ignore */ }
    return (C() && C().REST_DEFAULT_SEC) || 90;
  }

  function plannedRestForRound(exIndex) {
    const group = supersetGroup(exIndex);
    const idxs = group.length ? group : [exIndex];
    for (let k = 0; k < idxs.length; k++) {
      const n = plannedRestSec(session.exercises[idxs[k]]);
      if (n > 0) return n;
    }
    return defaultRestTarget();
  }

  function applySuggestion(name) {
    const sug = E().suggestNextSet(Store().getState(), name, [], null);
    session.draft.weight = sug.weight;
    session.draft.reps = sug.reps;
    return sug;
  }

  function addExercise(name) {
    if (!session) return null;
    commitRest();
    const n = Store().addExerciseName ? Store().addExerciseName(name) : E().normName(name);
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
      restSec: 0,
      notes: '',
      supersetId: '',
      suggestReason: sug.reason,
      sets: [],
      fromTemplate: false,
      bodyweight: bw || st,
      static: st,
      originalName: n,
      planSets: 0
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
    if (index !== session.currentEx) commitRest();
    cancelHold();
    const ex = session.exercises[index];
    if (ex && (ex.skipped || ex.finishedEarly)) {
      ex.skipped = false;
      ex.finishedEarly = false;
    }
    session.currentEx = index;
    if (ex) {
      applyDraftForExercise(ex);
    }
    persist();
  }

  function prefillDraftFromLastSet(ex) {
    if (!session || !ex || !ex.sets || !ex.sets.length) return false;
    const last = ex.sets[ex.sets.length - 1];
    const isSt = E().isStaticEx ? E().isStaticEx(ex, ex.name) : !!ex.static;
    session.draft.weight = Number(last.weight) || 0;
    if (isSt) {
      session.draft.secs = Number(last.secs) || 0;
      session.draft.reps = 0;
    } else {
      session.draft.reps = Number(last.reps) || 0;
    }
    return true;
  }

  function applyDraftForExercise(ex) {
    if (prefillDraftFromLastSet(ex)) return;
    const sug = E().suggestNextSet(Store().getState(), ex.name, ex.sets, null);
    const isMax = E().isMaxReps(ex);
    const isBw = E().isBodyweightEx(ex, ex.name);
    const isSt = E().isStaticEx ? E().isStaticEx(ex, ex.name) : !!ex.static;
    const blankSwap = !!(ex.insteadOf && (ex.targetWeight === '' || ex.targetWeight == null));
    session.draft.weight = (ex.targetWeight != null && ex.targetWeight !== '')
      ? ex.targetWeight
      : (blankSwap ? 0 : (isBw || isSt ? (sug.weight || 0) : sug.weight));
    if (isSt) {
      const best = E().bestHoldForExercise ? E().bestHoldForExercise(Store().getState(), ex.name) : 0;
      if (isMax) session.draft.secs = best || sug.secs || 45;
      else session.draft.secs = ex.targetSecs || sug.secs || 45;
      session.draft.reps = 0;
    } else if (isMax) {
      const best = E().bestRepsForExercise(Store().getState(), ex.name);
      session.draft.reps = best || sug.reps || 8;
    } else {
      session.draft.reps = ex.targetReps || sug.reps;
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
    unlockAudio();
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
    commitRest();
    ex.sets.push(row);
    ex.skipped = false;
    ex.finishedEarly = false;
    prefillDraftFromLastSet(ex);
    const loggedIndex = session.currentEx;
    let advanced = false;
    const group = supersetGroup(loggedIndex);
    if (group.length >= 2) {
      const justLogged = ex.sets.length;
      const pos = group.indexOf(loggedIndex);
      let nextIdx = null;
      for (let step = 1; step < group.length; step++) {
        const idx = group[(pos + step) % group.length];
        const partner = session.exercises[idx];
        if (isParked(partner)) continue;
        if (partner.sets.length < justLogged) {
          nextIdx = idx;
          break;
        }
      }
      if (nextIdx != null) {
        session.currentEx = nextIdx;
        applyDraftForExercise(session.exercises[nextIdx]);
        advanced = true;
      } else {
        startRest();
        let still = -1;
        for (let g = 0; g < group.length; g++) {
          if (needsMoreSets(session.exercises[group[g]])) { still = group[g]; break; }
        }
        if (still >= 0) {
          session.currentEx = still;
          applyDraftForExercise(session.exercises[still]);
          advanced = true;
        } else {
          const after = group[group.length - 1] + 1;
          if (after < session.exercises.length) {
            session.currentEx = after;
            applyDraftForExercise(session.exercises[after]);
            advanced = true;
          }
        }
      }
    } else {
      startRest();
      const targetSets = Number(ex.targetSets) || 0;
      if (targetSets && ex.sets.length >= targetSets) {
        const next = loggedIndex + 1;
        if (next < session.exercises.length) {
          session.currentEx = next;
          const nxt = currentExercise();
          if (nxt) applyDraftForExercise(nxt);
          advanced = true;
        }
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
    applyDraftForExercise(ex);
    cancelHold();
    stopRest();
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
    unlockAudio();
    commitRest();
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

  function plannedRestSec(ex) {
    const n = Number(ex && ex.restSec);
    return n > 0 ? n : 0;
  }

  function clearRestClock() {
    if (!session) return;
    session.restStartedAt = null;
    session.restTargetSec = 0;
    session.restTargetNotified = false;
    session.restFor = null;
    session.restUntil = null;
  }

  function startRest() {
    if (!session) return;
    const ex = currentExercise();
    if (!ex || !ex.sets.length) return;
    unlockAudio();
    session.restStartedAt = nowMs();
    session.restTargetSec = plannedRestForRound(session.currentEx);
    session.restTargetNotified = false;
    session.restFor = { exIndex: session.currentEx, setIndex: ex.sets.length - 1 };
    session.restUntil = null;
    persist();
  }

  function restElapsedSec() {
    if (!session || !session.restStartedAt) return 0;
    return Math.max(0, Math.round((nowMs() - session.restStartedAt) / 1000));
  }

  function isRestRunning() {
    return !!(session && session.restStartedAt);
  }

  function restTargetSec() {
    return (session && Number(session.restTargetSec) > 0) ? Number(session.restTargetSec) : 0;
  }

  function setRestOnRef(ref, sec) {
    if (!session || !ref) return false;
    const ex = session.exercises[ref.exIndex];
    const row = ex && ex.sets && ex.sets[ref.setIndex];
    if (!row) return false;
    row.restAfter = Math.max(0, Math.round(Number(sec) || 0));
    return true;
  }

  function commitRest() {
    if (!session || !session.restStartedAt) return 0;
    const sec = restElapsedSec();
    setRestOnRef(session.restFor, sec);
    clearRestClock();
    persist();
    return sec;
  }

  function stopRest() {
    if (!session) return;
    clearRestClock();
    persist();
  }

  function cancelRest() {
    stopRest();
  }

  function setSetRest(exIndex, setIndex, sec) {
    if (!session) return;
    const ok = setRestOnRef({ exIndex: Number(exIndex), setIndex: Number(setIndex) }, sec);
    if (!ok) return;
    if (session.restFor && session.restFor.exIndex === Number(exIndex) && session.restFor.setIndex === Number(setIndex)) {
      clearRestClock();
    }
    persist();
  }

  function isPageHidden() {
    try {
      return typeof document !== 'undefined' && document && document.visibilityState === 'hidden';
    } catch (err) {
      return false;
    }
  }

  function pulseRest() {
    if (!session || !session.restStartedAt) return false;
    const target = restTargetSec();
    if (!(target > 0) || session.restTargetNotified) return false;
    if (restElapsedSec() < target) return false;
    if (isPageHidden()) return false;
    session.restTargetNotified = true;
    persist();
    beep();
    vibrate();
    if (tickFn) tickFn({ type: 'rest-target', elapsed: restElapsedSec(), target: target });
    return true;
  }

  function restRemaining() {
    if (session && session.restStartedAt) {
      const target = restTargetSec();
      if (!(target > 0)) return 0;
      return Math.max(0, target - restElapsedSec());
    }
    if (!session || !session.restUntil) return 0;
    return Math.max(0, Math.ceil((session.restUntil - nowMs()) / 1000));
  }

  function elapsedMs() {
    if (!session) return 0;
    return Math.max(0, nowMs() - session.startedAt);
  }

  let audioCtx = null;

  function getAudioContext() {
    const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
      || (typeof AudioContext !== 'undefined' ? AudioContext : null);
    if (!AC) return null;
    if (!audioCtx || audioCtx.state === 'closed') {
      try { audioCtx = new AC(); } catch (err) { return null; }
    }
    return audioCtx;
  }

  function unlockAudio() {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (err) { /* ignore */ }
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.00001, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
    } catch (err) { /* ignore */ }
  }

  function beep(freq) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const play = function () {
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
      };
      if (ctx.state === 'suspended' && ctx.resume) {
        Promise.resolve(ctx.resume()).then(play).catch(function () { try { play(); } catch (err) { /* ignore */ } });
      } else {
        play();
      }
    } catch (err) { /* ignore */ }
  }

  function vibrate() {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([200, 80, 200]);
    } catch (err) { /* ignore */ }
  }

  function onTick(fn) { tickFn = fn; }

  function startClocks() {
    stopTimers();
    restTimer = setInterval(function () {
      if (!session) return;
      if (session.hold) tickHold();
      if (session.restStartedAt) {
        pulseRest();
        if (tickFn) tickFn({ type: 'rest', elapsed: restElapsedSec(), target: restTargetSec() });
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
      if (!ex.sets.length && !ex.skipped) return;
      const top = ex.sets.length ? ex.sets.reduce(function (m, s) { return s.weight > m.weight ? s : m; }, ex.sets[0]) : { weight: 0, reps: 0, secs: 0 };
      exercises.push({
        name: ex.name,
        sets: ex.sets.length,
        reps: top.reps || 0,
        weight: top.weight || 0,
        setLogs: ex.sets.map(function (s) {
          const log = { weight: s.weight, reps: s.reps, secs: s.secs || 0 };
          if (s.restAfter != null && s.restAfter !== '') log.restAfter = Number(s.restAfter) || 0;
          return log;
        }),
        bodyweight: !!ex.bodyweight,
        static: !!ex.static,
        secs: ex.sets.reduce(function (m, s) { return Math.max(m, Number(s.secs) || 0); }, 0),
        insteadOf: ex.insteadOf || '',
        skipped: !!ex.skipped,
        finishedEarly: !!ex.finishedEarly,
        notes: (function () {
          const bits = [];
          if (ex.notes) bits.push(ex.notes);
          if (ex.insteadOf) bits.push('במקום ' + ex.insteadOf);
          if (ex.skipped) bits.push('דולג');
          else if (ex.finishedEarly) bits.push('סיום מוקדם');
          return bits.join(' · ');
        }())
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
        restSec: (tex.restSec !== '' && tex.restSec != null && Number(tex.restSec) > 0) ? Number(tex.restSec) : 0,
        notes: tex.notes || '',
        supersetId: tex.supersetId || '',
        suggestReason: sug.reason,
        bestMaxReps: sug.bestMaxReps || 0,
        bestHold: sug.bestHold || 0,
        sets: [],
        fromTemplate: true,
        originalName: name,
        planSets: Number(tex.sets) || 3,
        planRepsMin: Number(tex.repsMin) || 0,
        planRepsMax: Number(tex.repsMax) || 0,
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

  function nextIndexAfterSkip(fromIdx) {
    if (!session) return null;
    const group = supersetGroup(fromIdx);
    if (group.length >= 2) {
      const pos = group.indexOf(fromIdx);
      for (let step = 1; step < group.length; step++) {
        const idx = group[(pos + step) % group.length];
        if (needsMoreSets(session.exercises[idx])) return idx;
      }
    }
    for (let i = fromIdx + 1; i < session.exercises.length; i++) {
      const ex = session.exercises[i];
      if (isParked(ex)) continue;
      if (needsMoreSets(ex) || !(Number(ex.targetSets) > 0)) return i;
    }
    for (let i = 0; i < session.exercises.length; i++) {
      if (i === fromIdx) continue;
      if (needsMoreSets(session.exercises[i])) return i;
    }
    for (let i = fromIdx + 1; i < session.exercises.length; i++) {
      if (!isParked(session.exercises[i])) return i;
    }
    return null;
  }

  function skipExercise(index) {
    if (!session) return null;
    const idx = index == null ? session.currentEx : Number(index);
    const ex = session.exercises[idx];
    if (!ex) return null;
    cancelHold();
    stopRest();
    if (ex.sets && ex.sets.length) {
      ex.finishedEarly = true;
      ex.skipped = false;
    } else {
      ex.skipped = true;
      ex.finishedEarly = false;
    }
    const nextIdx = nextIndexAfterSkip(idx);
    if (nextIdx != null) {
      session.currentEx = nextIdx;
      applyDraftForExercise(session.exercises[nextIdx]);
    }
    persist();
    return ex;
  }

  function unskipExercise(index) {
    if (!session) return null;
    const idx = index == null ? session.currentEx : Number(index);
    const ex = session.exercises[idx];
    if (!ex) return null;
    ex.skipped = false;
    ex.finishedEarly = false;
    session.currentEx = idx;
    applyDraftForExercise(ex);
    persist();
    return ex;
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
    const i = session.currentEx;
    const group = supersetGroup(i);
    if (group.length >= 2) {
      const pos = group.indexOf(i);
      for (let step = 1; step < group.length; step++) {
        const idx = group[(pos + step) % group.length];
        const partner = session.exercises[idx];
        if (needsMoreSets(partner)) return partner;
      }
      const after = group[group.length - 1] + 1;
      for (let k = after; k < session.exercises.length; k++) {
        if (!isParked(session.exercises[k])) return session.exercises[k];
      }
      return null;
    }
    for (let k = i + 1; k < session.exercises.length; k++) {
      if (!isParked(session.exercises[k])) return session.exercises[k];
    }
    return null;
  }

  function progress() {
    if (!session || !session.exercises.length) return { current: 0, total: 0 };
    return { current: session.currentEx + 1, total: session.exercises.length };
  }

  function restTotal() {
    return restTargetSec();
  }

  function templateChanged() {
    if (!session || !session.templateSnapshot) return false;
    const snap = session.templateSnapshot.exercises || [];
    if (snap.length !== session.exercises.length) return true;
    for (let i = 0; i < snap.length; i++) {
      const a = snap[i];
      const b = session.exercises[i];
      const bName = b.originalName || b.name;
      if (E().normName(a.name) !== E().normName(bName)) return true;
      const planSets = b.planSets != null && b.planSets !== '' ? Number(b.planSets) : (Number(b.targetSets) || b.sets.length || 0);
      if ((Number(a.sets) || 0) !== planSets) return true;
    }
    return session.exercises.some(function (ex) { return !ex.fromTemplate && ex.sets.length; })
      || session.exercises.some(function (ex) {
        if (!ex.fromTemplate || ex.skipped || ex.finishedEarly) return false;
        return ex.sets.length !== (Number(ex.targetSets) || 0);
      });
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
          name: ex.originalName || ex.name,
          sets: (ex.planSets != null && ex.planSets !== '') ? (Number(ex.planSets) || 3) : (ex.sets.length || ex.targetSets || 3),
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
    stopRest();
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

  function snapshotExercisePlan(ex) {
    return {
      name: ex.name,
      bodyweight: !!ex.bodyweight,
      static: !!ex.static,
      targetWeight: ex.targetWeight,
      targetReps: ex.targetReps,
      targetSecs: ex.targetSecs,
      repsMode: ex.repsMode,
      suggestReason: ex.suggestReason || '',
      bestMaxReps: ex.bestMaxReps || 0,
      bestHold: ex.bestHold || 0
    };
  }

  function applySwapLoad(ex) {
    const rec = loadRecommendation(ex.name, recOptsFromExercise(ex));
    const last = E().lastPerformance(Store().getState(), ex.name);
    const hasHist = !!(rec || last);
    if (hasHist && rec) {
      ex.targetWeight = rec.weight || 0;
      if (rec.kind !== 'max' && rec.reps) ex.targetReps = rec.reps;
      if (rec.secs) ex.targetSecs = rec.secs;
      ex.suggestReason = rec.reason || '';
      ex.loadRec = rec;
    } else if (hasHist && last && last.last) {
      ex.targetWeight = last.last.weight || 0;
      if (last.last.reps) ex.targetReps = last.last.reps;
      if (last.last.secs) ex.targetSecs = last.last.secs;
      ex.suggestReason = '';
    } else {
      ex.targetWeight = '';
      ex.suggestReason = '';
      ex.loadRec = null;
    }
  }

  function swapExercise(index, rawName) {
    if (!session) return { ok: false, error: 'no-session' };
    const idx = index == null ? session.currentEx : Number(index);
    const ex = session.exercises[idx];
    if (!ex) return { ok: false, error: 'no-exercise' };
    if (ex.sets && ex.sets.length) return { ok: false, error: 'has-sets' };
    const name = Store().addExerciseName ? Store().addExerciseName(rawName) : E().canonicalName(rawName, E().exerciseCatalog(Store().getState()));
    if (!name) return { ok: false, error: 'bad-name' };
    if (E().foldName(ex.name) === E().foldName(name)) return { ok: true, exercise: ex, same: true };
    if (!ex.originalName) ex.originalName = ex.name;
    if (!ex.originalPlan) ex.originalPlan = snapshotExercisePlan(ex);
    const from = ex.insteadOf || ex.originalName || ex.name;
    ex.name = name;
    ex.insteadOf = from;
    ex.bodyweight = E().isBodyweightName(name) || (E().isStaticName && E().isStaticName(name));
    ex.static = !!(E().isStaticName && E().isStaticName(name));
    applySwapLoad(ex);
    if (Store().recordSubstitution) Store().recordSubstitution(from, name);
    if (idx === session.currentEx) applyDraftForExercise(ex);
    if (!hasHistWeight(ex)) {
      if (idx === session.currentEx) {
        session.draft.weight = ex.static || ex.bodyweight ? (Number(ex.targetWeight) || 0) : (Number(ex.targetWeight) || 0);
        if (ex.targetWeight === '' && !ex.static) session.draft.weight = 0;
      }
    }
    persist();
    return { ok: true, exercise: ex };
  }

  function hasHistWeight(ex) {
    return ex && ex.targetWeight !== '' && ex.targetWeight != null;
  }

  function unswapExercise(index) {
    if (!session) return { ok: false, error: 'no-session' };
    const idx = index == null ? session.currentEx : Number(index);
    const ex = session.exercises[idx];
    if (!ex) return { ok: false, error: 'no-exercise' };
    if (ex.sets && ex.sets.length) return { ok: false, error: 'has-sets' };
    if (!ex.insteadOf && !ex.originalPlan) return { ok: false, error: 'not-swapped' };
    const snap = ex.originalPlan;
    if (snap) {
      ex.name = snap.name;
      ex.bodyweight = !!snap.bodyweight;
      ex.static = !!snap.static;
      ex.targetWeight = snap.targetWeight;
      ex.targetReps = snap.targetReps;
      ex.targetSecs = snap.targetSecs;
      ex.repsMode = snap.repsMode;
      ex.suggestReason = snap.suggestReason;
      ex.bestMaxReps = snap.bestMaxReps;
      ex.bestHold = snap.bestHold;
    } else {
      ex.name = ex.originalName || ex.name;
    }
    ex.insteadOf = '';
    ex.originalPlan = null;
    if (idx === session.currentEx) applyDraftForExercise(ex);
    persist();
    return { ok: true, exercise: ex };
  }

  function editSessionTarget(index, patch) {
    if (!session) return null;
    const idx = index == null ? session.currentEx : Number(index);
    const ex = session.exercises[idx];
    if (!ex) return null;
    patch = patch || {};
    if (patch.targetSets != null && patch.targetSets !== '') {
      ex.targetSets = Math.max(1, Math.round(Number(patch.targetSets) || 1));
    }
    if (patch.repsMin != null && patch.repsMin !== '') ex.repsMin = Math.max(0, Math.round(Number(patch.repsMin) || 0));
    if (patch.repsMax != null && patch.repsMax !== '') ex.repsMax = Math.max(Number(ex.repsMin) || 0, Math.round(Number(patch.repsMax) || 0));
    if (patch.targetReps != null && patch.targetReps !== '') ex.targetReps = Math.max(0, Math.round(Number(patch.targetReps) || 0));
    if (patch.targetSecs != null && patch.targetSecs !== '') ex.targetSecs = Math.max(0, Math.round(Number(patch.targetSecs) || 0));
    if (patch.repsMode) ex.repsMode = patch.repsMode;
    if (!(ex.sets && ex.sets.length) && idx === session.currentEx) applyDraftForExercise(ex);
    persist();
    return ex;
  }

  const FitLive = {
    getSession: getSession,
    restore: restore,
    start: start,
    discard: discard,
    addExercise: addExercise,
    selectExercise: selectExercise,
    currentExercise: currentExercise,
    supersetGroup: supersetGroup,
    setDraft: setDraft,
    stepDraft: stepDraft,
    setType: setType,
    setRestSec: setRestSec,
    prForDraft: prForDraft,
    logSet: logSet,
    undoLastSet: undoLastSet,
    startRest: startRest,
    cancelRest: cancelRest,
    commitRest: commitRest,
    stopRest: stopRest,
    restRemaining: restRemaining,
    restElapsedSec: restElapsedSec,
    restTargetSec: restTargetSec,
    isRestRunning: isRestRunning,
    setSetRest: setSetRest,
    pulseRest: pulseRest,
    unlockAudio: unlockAudio,
    defaultRestTarget: defaultRestTarget,
    setClock: setClock,
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
    unskipExercise: unskipExercise,
    isParked: isParked,
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
    swapExercise: swapExercise,
    unswapExercise: unswapExercise,
    editSessionTarget: editSessionTarget,
    startHold: startHold,
    stopHold: stopHold,
    cancelHold: cancelHold,
    holdState: holdState,
    formatHoldClock: formatHoldClock
  };

  root.FitLive = FitLive;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitLive;
})(typeof window !== 'undefined' ? window : globalThis);
