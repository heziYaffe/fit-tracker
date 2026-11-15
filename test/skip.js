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
const E = ctx.FitEngine;
const Store = ctx.FitStore;
const Live = ctx.FitLive;
function assert(c, m) { if (!c) throw new Error(m); }

const baseLogs = [{ weight: 50, reps: 10 }, { weight: 50, reps: 10 }, { weight: 50, reps: 10 }];
const prior = {
  id: 'prior',
  date: '2026-11-01',
  type: 'push',
  exercises: [{ name: 'לחיצת חזה', sets: 3, reps: 10, weight: 50, setLogs: baseLogs }]
};
const recOpts = { sets: 3, repsMin: 8, repsMax: 12 };
const rec0 = E.recommendNextLoad({ workouts: [prior], metrics: [], settings: {} }, 'לחיצת חזה', recOpts);
assert(rec0 && rec0.weight > 0, 'baseline rec exists');

const skippedOnly = {
  id: 'skip1',
  date: '2026-11-10',
  type: 'push',
  exercises: [{ name: 'לחיצת חזה', sets: 0, weight: 0, reps: 0, setLogs: [], skipped: true, notes: 'דולג' }]
};
assert(E.setVolume(skippedOnly.exercises[0]) === 0, 'skipped exercise has no volume');
assert(E.expandSets(skippedOnly.exercises[0]).length === 0, 'expandSets of a skip is empty');
assert(E.sessionsForExercise({ workouts: [prior, skippedOnly] }, 'לחיצת חזה').length === 1, 'skipped session is not history');
const recSkip = E.recommendNextLoad({ workouts: [prior, skippedOnly], metrics: [], settings: {} }, 'לחיצת חזה', recOpts);
assert(recSkip && recSkip.weight === rec0.weight && recSkip.reps === rec0.reps, 'full skip does not change the load rec');

const early = {
  id: 'early1',
  date: '2026-11-12',
  type: 'push',
  exercises: [{
    name: 'לחיצת חזה',
    sets: 1,
    reps: 5,
    weight: 50,
    setLogs: [{ weight: 50, reps: 5 }],
    finishedEarly: true,
    notes: 'סיום מוקדם'
  }]
};
assert(E.setVolume(early.exercises[0]) === 250, 'logged sets of an early finish count in volume, got ' + E.setVolume(early.exercises[0]));
const histEarly = E.sessionsForExercise({ workouts: [prior, early] }, 'לחיצת חזה');
assert(histEarly.length === 2, 'early finish stays in history for 1RM');
assert(histEarly[1].finishedEarly, 'session marked finishedEarly');
assert(histEarly[1].e1rm > 0, '1RM from the logged set is kept');
const recEarly = E.recommendNextLoad({ workouts: [prior, early], metrics: [], settings: {} }, 'לחיצת חזה', recOpts);
assert(recEarly && recEarly.weight === rec0.weight, 'early finish does not pull the next load down, got ' + (recEarly && recEarly.weight) + ' vs ' + rec0.weight);
assert(recEarly.volumeLast === rec0.volumeLast, 'load rec still uses the last complete session volume');

try {
  const sess = Live.startFromTemplate({
    id: 'sk1',
    name: 'Push',
    type: 'push',
    exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 12, weight: 50, restSec: 90, supersetId: 'ss_ab' },
      { name: 'חתירה', sets: 3, repsMin: 10, repsMax: 10, weight: 40, supersetId: 'ss_ab' },
      { name: 'פלאנק', sets: 3, secsMin: 45, secsMax: 45, static: true }
    ]
  }, { date: '2026-11-15' });

  // Full skip of the first partner: round continues with the other, rest is not started.
  Live.skipExercise();
  assert(sess.exercises[0].skipped, 'first is skipped');
  assert(!sess.exercises[0].sets.length, 'no sets on a full skip');
  assert(sess.currentEx === 1, 'superset continues with the partner, got ' + sess.currentEx);
  assert(sess.exercises[1].name.indexOf('חתירה') >= 0, 'now on the partner');
  assert(!Live.isRestRunning(), 'skip does not start a rest');

  const payloadSkip = Live.toWorkout();
  assert(payloadSkip && payloadSkip.exercises[0].skipped, 'workout record marks skipped');
  assert(payloadSkip.exercises[0].name === 'לחיצת חזה', 'skipped name kept');
  assert(String(payloadSkip.exercises[0].notes).indexOf('דולג') >= 0, 'Hebrew skipped note');

  // Undo skip by reopening.
  Live.unskipExercise(0);
  assert(!sess.exercises[0].skipped, 'unskip clears the flag');
  assert(sess.currentEx === 0, 'reopened the original exercise');

  // Partial skip keeps logged sets; rest is discarded, not written.
  Live.setDraft({ weight: 50, reps: 8 });
  Live.logSet();
  assert(Live.isRestRunning() || sess.exercises[0].sets.length === 1, 'set logged');
  // In a superset, after logging the first the session advances to the partner without rest.
  // Go back to the first, log a second set so a rest starts (after a full round)... 
  // Simpler path: skip the current (row, 0 sets) after the first chest set? 
  // Current may be rowing. Select chest (unparks nothing) and skip with 1 set.
  const chestIdx = 0;
  if (sess.currentEx !== chestIdx) Live.selectExercise(chestIdx);
  assert(sess.exercises[0].sets.length >= 1, 'chest has a logged set');
  // Start a rest manually to prove skip does not record it.
  if (!Live.isRestRunning()) Live.startRest();
  assert(Live.isRestRunning(), 'rest running before skip');
  const setIdx = sess.exercises[0].sets.length - 1;
  Live.skipExercise(0);
  assert(sess.exercises[0].finishedEarly, 'partial skip is finished early');
  assert(!sess.exercises[0].skipped, 'partial skip is not a full skip');
  assert(sess.exercises[0].sets.length >= 1, 'logged sets are kept');
  assert(sess.exercises[0].sets[setIdx].restAfter == null || sess.exercises[0].sets[setIdx].restAfter === undefined,
    'skip does not record rest, got ' + sess.exercises[0].sets[setIdx].restAfter);
  assert(!Live.isRestRunning(), 'rest stopped on skip');
  assert(sess.currentEx !== 0, 'moved off the skipped exercise, at ' + sess.currentEx);

  // Reopening undoes the early finish.
  Live.selectExercise(0);
  assert(!sess.exercises[0].finishedEarly && !sess.exercises[0].skipped, 'reopen undoes the skip');
  assert(sess.exercises[0].sets.length >= 1, 'sets still there after reopen');

  // template is unchanged by a skip
  Live.skipExercise(0);
  const tpl = Live.templatePayloadFromSession();
  assert(tpl.exercises[0].name === 'לחיצת חזה', 'plan still has the original exercise');
  assert(tpl.exercises[0].sets === 3, 'plan set count unchanged, got ' + tpl.exercises[0].sets);
} finally {
  if (Live.setClock) Live.setClock(null);
  if (Live.getSession()) Live.discard();
}

console.log('skip tests passed');
