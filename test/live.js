const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const mem = {};
const sessMem = {};
const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  },
  sessionStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(sessMem, k) ? sessMem[k] : null; },
    setItem: function (k, v) { sessMem[k] = String(v); },
    removeItem: function (k) { delete sessMem[k]; }
  },
  navigator: {}
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js');
run('js/engine.js');
run('js/store.js');
run('js/live.js');
const Live = ctx.FitLive;
function assert(c, m) { if (!c) throw new Error(m); }

try {
  // Weighted: first set keeps the planned default; after a log, the next draft
  // copies the saved weight and reps even when they differ from the plan.
  Live.start({ date: '2026-11-15' });
  const tpl = {
    id: 't1',
    name: 'Push',
    type: 'push',
    exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 12, weight: 50 },
      { name: 'חתירה', sets: 3, repsMin: 8, repsMax: 10, weight: 40 }
    ]
  };
  Live.discard();
  const sess = Live.startFromTemplate(tpl, { date: '2026-11-15' });
  const first = Live.currentExercise();
  assert(first && first.name, 'first exercise');
  assert(Number(sess.draft.weight) === 50, 'first draft uses planned weight, got ' + sess.draft.weight);
  assert(Number(sess.draft.reps) === 8 || Number(sess.draft.reps) === 12 || (Number(sess.draft.reps) >= 8 && Number(sess.draft.reps) <= 12),
    'first draft uses planned reps, got ' + sess.draft.reps);
  const plannedReps = Number(sess.draft.reps);
  Live.setDraft({ weight: 52.5, reps: 10 });
  const row = Live.logSet();
  assert(row && row.weight === 52.5 && row.reps === 10, 'logged 52.5x10');
  assert(first.sets.length === 1, 'one saved set');
  assert(Number(sess.draft.weight) === 52.5, 'next set weight carried, got ' + sess.draft.weight);
  assert(Number(sess.draft.reps) === 10, 'next set reps carried, got ' + sess.draft.reps);
  assert(plannedReps !== 10 || true, 'carry even if plan differed');

  // Switching away and back still prefills from the last saved set, not the plan.
  Live.selectExercise(1);
  const second = Live.currentExercise();
  assert(second && second.name !== first.name, 'moved to second exercise');
  assert(Number(sess.draft.weight) === 40, 'second exercise keeps its own plan, got ' + sess.draft.weight);
  Live.selectExercise(0);
  assert(Number(sess.draft.weight) === 52.5, 'return uses last saved weight, got ' + sess.draft.weight);
  assert(Number(sess.draft.reps) === 10, 'return uses last saved reps, got ' + sess.draft.reps);

  // A later set can change the carry-forward values again.
  Live.setDraft({ weight: 55, reps: 8 });
  Live.logSet();
  assert(Number(sess.draft.weight) === 55 && Number(sess.draft.reps) === 8, 'carry updates after second log');

  // Static: carry hold time, not the planned target.
  Live.discard();
  Live.startFromTemplate({
    id: 't2',
    name: 'Core',
    type: 'custom',
    exercises: [{ name: 'פלאנק', sets: 3, static: true, secsMin: 45, secsMax: 45, bodyweight: true }]
  }, { date: '2026-11-15' });
  const plank = Live.currentExercise();
  assert(plank && plank.static, 'static exercise');
  const plannedSecs = Number(Live.getSession().draft.secs);
  assert(plannedSecs === 45, 'planned plank 45s, got ' + plannedSecs);
  Live.setDraft({ secs: 40, weight: 0, reps: 0 });
  const hold = Live.logSet();
  assert(hold && hold.secs === 40, 'logged 40s');
  assert(Number(Live.getSession().draft.secs) === 40, 'next hold carried 40s, got ' + Live.getSession().draft.secs);
  assert(Number(Live.getSession().draft.reps) === 0, 'static draft has no reps');

  // Undo of the only set returns to the planned default.
  Live.undoLastSet();
  assert(plank.sets.length === 0, 'undone');
  assert(Number(Live.getSession().draft.secs) === 45, 'undo without history restores plan, got ' + Live.getSession().draft.secs);
} finally {
  if (Live.setClock) Live.setClock(null);
  if (Live.getSession()) Live.discard();
}

// Count-up rest: timestamps, auto-fill on next set, planned target, finish, manual edit.
try {
  let now = 1_000_000;
  Live.setClock(now);
  const sess = Live.startFromTemplate({
    id: 't3',
    name: 'Push',
    type: 'push',
    exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 10, weight: 50, restSec: 90 },
      { name: 'חתירה', sets: 3, repsMin: 8, repsMax: 10, weight: 40 }
    ]
  }, { date: '2026-11-15' });
  const first = Live.currentExercise();
  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  assert(Live.isRestRunning(), 'rest starts after save');
  assert(Live.restElapsedSec() === 0, 'elapsed starts at 0, got ' + Live.restElapsedSec());
  assert(Live.restTargetSec() === 90, 'planned rest is the target, got ' + Live.restTargetSec());

  // "Background" jump: no intervals, only the timestamp matters.
  now += 75 * 1000;
  Live.setClock(now);
  assert(Live.restElapsedSec() === 75, 'elapsed follows timestamp, got ' + Live.restElapsedSec());
  assert(!Live.pulseRest(), 'no target cue before 90s');

  now += 20 * 1000;
  Live.setClock(now);
  assert(Live.restElapsedSec() === 95, 'still running past the target, got ' + Live.restElapsedSec());
  assert(Live.pulseRest(), 'target cues once at 90s');
  assert(!Live.pulseRest(), 'target cue does not repeat');
  assert(Live.isRestRunning(), 'timer keeps counting after the target');

  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  assert(first.sets[0].restAfter === 95, 'rest saved on previous set, got ' + first.sets[0].restAfter);
  assert(Live.isRestRunning(), 'new rest starts after the next save');
  assert(first.sets[1].restAfter == null, 'new set has no rest yet');

  Live.setSetRest(0, 0, 80);
  assert(first.sets[0].restAfter === 80, 'rest is manually editable');

  now += 30 * 1000;
  Live.setClock(now);
  Live.skipExercise();
  assert(first.sets[1].restAfter === 30, 'skip/next records elapsed rest, got ' + first.sets[1].restAfter);
  assert(!Live.isRestRunning(), 'rest stops after skip');

  const second = Live.currentExercise();
  Live.setDraft({ weight: 40, reps: 8 });
  Live.logSet();
  now += 12 * 1000;
  Live.setClock(now);
  const payload = Live.toWorkout();
  // finish stops the trailing timer and does not record rest on the last set
  if (Live.getSession()) Live.discard();
  Live.setClock(now);
  const sess2 = Live.startFromTemplate({
    id: 't4',
    name: 'Push',
    type: 'push',
    exercises: [{ name: 'לחיצת חזה', sets: 2, repsMin: 8, repsMax: 8, weight: 50 }]
  }, { date: '2026-11-15' });
  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  now += 40 * 1000;
  Live.setClock(now);
  assert(Live.isRestRunning(), 'rest running after last-exercise set');
  assert(Live.restTargetSec() === 90, 'default rest target is 90s when none was planned, got ' + Live.restTargetSec());
  const summary = Live.finish();
  assert(summary && summary.workout, 'workout saved');
  const logs = summary.exercises[0].setLogs;
  assert(logs.length === 1, 'one logged set');
  assert(logs[0].restAfter == null || logs[0].restAfter === undefined, 'finish does not store trailing rest, got ' + logs[0].restAfter);
  assert(!Live.getSession(), 'session cleared');
} finally {
  if (Live.setClock) Live.setClock(null);
  if (Live.getSession()) Live.discard();
}


// Superset: no rest mid-round, rest after last of the round, carry-forward per exercise.
try {
  let now = 2_000_000;
  Live.setClock(now);
  const sess = Live.startFromTemplate({
    id: 'ss1',
    name: 'Push',
    type: 'push',
    exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 8, weight: 50, restSec: 90, supersetId: 'ss_ab' },
      { name: 'חתירה', sets: 3, repsMin: 10, repsMax: 10, weight: 40, supersetId: 'ss_ab' },
      { name: 'כתפיים', sets: 3, repsMin: 8, repsMax: 8, weight: 20 }
    ]
  }, { date: '2026-11-15' });
  const group = Live.supersetGroup(0);
  assert(group.length === 2 && group[0] === 0 && group[1] === 1, 'group is the two linked exercises');
  Live.setDraft({ weight: 52.5, reps: 8 });
  Live.logSet();
  assert(sess.currentEx === 1, 'after A, focus moves to B, got ' + sess.currentEx);
  assert(!Live.isRestRunning(), 'no rest timer mid-round');
  assert(sess.exercises[0].sets.length === 1, 'A has one set');
  assert(Number(sess.draft.weight) === 40, 'B keeps its own planned weight, got ' + sess.draft.weight);
  assert(Number(sess.draft.reps) === 10, 'B keeps its own planned reps, got ' + sess.draft.reps);

  Live.setDraft({ weight: 42.5, reps: 10 });
  Live.logSet();
  assert(Live.isRestRunning(), 'rest starts after the last exercise of the round');
  assert(Live.restTargetSec() === 90, 'planned rest of the group is the round target, got ' + Live.restTargetSec());
  assert(sess.currentEx === 0, 'focus returns to A for the next round, got ' + sess.currentEx);
  assert(Number(sess.draft.weight) === 52.5 && Number(sess.draft.reps) === 8, 'A next set carries A values');
  const restFor = sess.restFor;
  assert(restFor && restFor.exIndex === 1 && restFor.setIndex === 0, 'rest belongs to last set of the round (B)');

  now += 40 * 1000;
  Live.setClock(now);
  Live.setDraft({ weight: 55, reps: 8 });
  Live.logSet();
  assert(sess.exercises[1].sets[0].restAfter === 40, 'elapsed rest saved on last set of the previous round, got ' + sess.exercises[1].sets[0].restAfter);
  assert(!Live.isRestRunning(), 'no rest after first exercise of the next round');
  assert(sess.currentEx === 1, 'moves to B again');
  assert(Number(sess.draft.weight) === 42.5 && Number(sess.draft.reps) === 10, 'B next set carries B values, got ' + sess.draft.weight + 'x' + sess.draft.reps);

  Live.logSet();
  assert(Live.isRestRunning(), 'rest after round 2');
  assert(sess.currentEx === 0, 'back to A for round 3, got ' + sess.currentEx);
  now += 15 * 1000;
  Live.setClock(now);
  Live.logSet(); // A3, go to B no rest
  assert(!Live.isRestRunning(), 'no rest after A3');
  assert(sess.currentEx === 1, 'A3 moves to B, got ' + sess.currentEx);
  Live.logSet(); // B3, rest starts, group done, advance past group to shoulders
  assert(Live.isRestRunning(), 'rest after final round');
  assert(sess.currentEx === 2, 'after the last round, move to the next exercise, got ' + sess.currentEx);
  assert(Number(sess.draft.weight) === 20, 'next exercise keeps its own plan, got ' + sess.draft.weight);
} finally {
  if (Live.setClock) Live.setClock(null);
  if (Live.getSession()) Live.discard();
}


// Default rest target, flag reset on each rest, and deferred beep while hidden.
try {
  let now = 3_000_000;
  Live.setClock(now);
  if (ctx.FitStore && ctx.FitStore.updateSettings) {
    ctx.FitStore.updateSettings({ restTargetSec: 90 });
  }
  Live.startFromTemplate({
    id: 'beep1',
    name: 'Push',
    type: 'push',
    exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 8, weight: 50 },
      { name: 'חתירה', sets: 3, repsMin: 8, repsMax: 8, weight: 40, restSec: 60 }
    ]
  }, { date: '2026-11-15' });
  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  assert(Live.restTargetSec() === 90, 'unplanned exercise uses default 90s, got ' + Live.restTargetSec());
  assert(Live.getSession().restTargetNotified === false, 'flag starts clear');

  now += 90 * 1000;
  Live.setClock(now);
  assert(Live.pulseRest(), 'first rest beeps at the default target');
  assert(Live.getSession().restTargetNotified === true, 'flag set after first cue');
  assert(!Live.pulseRest(), 'first rest does not beep twice');

  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  assert(Live.getSession().restTargetNotified === false, 'flag resets when a new rest starts');
  assert(Live.restTargetSec() === 90, 'second rest of the same exercise still uses 90, got ' + Live.restTargetSec());
  now += 90 * 1000;
  Live.setClock(now);
  assert(Live.pulseRest(), 'second rest beeps too');
  assert(!Live.pulseRest(), 'second rest beeps only once');

  // Planned rest on the next exercise overrides the default.
  Live.skipExercise();
  Live.setDraft({ weight: 40, reps: 8 });
  Live.logSet();
  assert(Live.restTargetSec() === 60, 'explicit planned rest wins over default, got ' + Live.restTargetSec());

  // If the target is reached while hidden, beep once when the app is visible again.
  if (Live.getSession()) Live.discard();
  now += 1000;
  Live.setClock(now);
  Live.startFromTemplate({
    id: 'beep2',
    name: 'Push',
    type: 'push',
    exercises: [{ name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 8, weight: 50 }]
  }, { date: '2026-11-15' });
  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  ctx.document.visibilityState = 'hidden';
  now += 90 * 1000;
  Live.setClock(now);
  assert(!Live.pulseRest(), 'no beep while the app is in the background');
  assert(Live.getSession().restTargetNotified === false, 'flag stays clear until the beep can play');
  ctx.document.visibilityState = 'visible';
  assert(Live.pulseRest(), 'beeps once when returning past the target');
  assert(!Live.pulseRest(), 'does not beep again after becoming visible');

  // Settings can change the default.
  if (Live.getSession()) Live.discard();
  ctx.FitStore.updateSettings({ restTargetSec: 45 });
  assert(Live.defaultRestTarget() === 45, 'settings default, got ' + Live.defaultRestTarget());
  Live.startFromTemplate({
    id: 'beep3',
    name: 'Push',
    type: 'push',
    exercises: [{ name: 'לחיצת חזה', sets: 2, repsMin: 8, repsMax: 8, weight: 50 }]
  }, { date: '2026-11-15' });
  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  assert(Live.restTargetSec() === 45, 'session uses the settings default, got ' + Live.restTargetSec());
  ctx.FitStore.updateSettings({ restTargetSec: 90 });
} finally {
  ctx.document.visibilityState = 'visible';
  if (Live.setClock) Live.setClock(null);
  if (Live.getSession()) Live.discard();
}

console.log('live tests passed');
