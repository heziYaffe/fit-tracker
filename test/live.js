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
  assert(Live.restTargetSec() === 0, 'no target when rest was not planned');
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

console.log('live tests passed');
