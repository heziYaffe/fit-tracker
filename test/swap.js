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

const catalog = E.exerciseCatalog(Store.getState());

assert(E.normName('  לחיצת   חזה  ') === 'לחיצת חזה', 'collapse spaces');
assert(E.canonicalName('לחיצת  חזה', catalog) === 'לחיצת חזה', 'dedupe extra spaces to library name');
assert(E.canonicalName('לחיצת-חזה', catalog) === 'לחיצת חזה', 'hyphen folds to library name, got ' + E.canonicalName('לחיצת-חזה', catalog));
assert(E.canonicalName('חתירהה', catalog) === 'חתירה', 'near-duplicate typo, got ' + E.canonicalName('חתירהה', catalog));
assert(E.canonicalName('מתח', catalog) === 'מתח', 'does not collapse מתח into מתח צר');
assert(E.canonicalName('L sit', catalog) === 'L-sit' || E.canonicalName('l-sit', catalog) === 'L-sit', 'latin hyphen variant, got ' + E.canonicalName('L sit', catalog));
const fresh = E.canonicalName('לחיצה במכונה סמית', catalog);
assert(fresh === 'לחיצה במכונה סמית', 'new name stays cleaned, got ' + fresh);

Store.recordSubstitution('לחיצת חזה', 'לחיצה בשיפוע');
Store.recordSubstitution('לחיצת חזה', 'פרפר');
Store.recordSubstitution('לחיצת חזה', 'לחיצה בשיפוע');
const recents = Store.substitutesFor('לחיצת חזה');
assert(recents.length >= 2, 'stored two substitutes');
assert(recents[0].name === 'לחיצה בשיפוע', 'most recent first, got ' + recents[0].name);
assert(recents[0].count === 2, 'frequency counted, got ' + recents[0].count);
assert(recents.some(function (r) { return r.name === 'פרפר'; }), 'kept the other substitute');

const added = Store.addExerciseName('  לחיצה   במכונה סמית ');
assert(added === 'לחיצה במכונה סמית', 'new exercise saved canonically, got ' + added);
const addedAgain = Store.addExerciseName('לחיצה  במכונה סמית');
assert(addedAgain === added, 'second add reuses the same name');
assert(Store.exerciseCatalog().indexOf(added) >= 0, 'name is in the catalog');

try {
  const sess = Live.startFromTemplate({
    id: 'sw1',
    name: 'Push',
    type: 'push',
    exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 8, repsMax: 12, weight: 50, restSec: 90, supersetId: 'ss_ab' },
      { name: 'חתירה', sets: 3, repsMin: 10, repsMax: 10, weight: 40, supersetId: 'ss_ab' }
    ]
  }, { date: '2026-11-15' });
  const swapped = Live.swapExercise(0, 'לחיצה במכונה סמית');
  assert(swapped.ok, 'swap ok');
  assert(sess.exercises[0].name === 'לחיצה במכונה סמית', 'current name is the substitute');
  assert(sess.exercises[0].insteadOf === 'לחיצת חזה', 'remembers the original');
  assert(sess.exercises[0].supersetId === 'ss_ab', 'keeps the superset');
  assert(sess.exercises[0].targetSets === 3, 'keeps planned sets');
  assert(Number(sess.exercises[0].repsMin) === 8 && Number(sess.exercises[0].repsMax) === 12, 'keeps planned rep range');
  assert(sess.exercises[0].targetWeight === '' || sess.exercises[0].targetWeight === 0 || sess.draft.weight === 0,
    'no history → blank/zero weight, got ' + sess.exercises[0].targetWeight + '/' + sess.draft.weight);
  const snapName = sess.templateSnapshot.exercises[0].name;
  assert(E.normName(sess.exercises[0].originalName) === E.normName(snapName), 'original name still matches the plan');

  const undone = Live.unswapExercise(0);
  assert(undone.ok, 'undo swap');
  assert(sess.exercises[0].name === 'לחיצת חזה', 'restored original name');
  assert(!sess.exercises[0].insteadOf, 'cleared insteadOf');

  Live.swapExercise(0, 'לחיצה במכונה סמית');
  Live.setDraft({ weight: 40, reps: 8 });
  Live.logSet();
  const blocked = Live.unswapExercise(0);
  assert(!blocked.ok && blocked.error === 'has-sets', 'cannot undo after a set is logged');
  const blockedSwap = Live.swapExercise(0, 'פרפר');
  assert(!blockedSwap.ok && blockedSwap.error === 'has-sets', 'cannot swap after a set is logged');

  // finish records the substitute name and an instead-of note
  const payload = Live.toWorkout();
  assert(payload.exercises[0].name === 'לחיצה במכונה סמית', 'logged under the substitute');
  assert(payload.exercises[0].insteadOf === 'לחיצת חזה', 'insteadOf on the record');
  assert(String(payload.exercises[0].notes).indexOf('במקום לחיצת חזה') >= 0, 'Hebrew note, got ' + payload.exercises[0].notes);

  if (Live.getSession()) Live.discard();
  Live.startFromTemplate({
    id: 'sw2',
    name: 'Push',
    type: 'push',
    exercises: [{ name: 'חתירה', sets: 4, repsMin: 8, repsMax: 10, weight: 40 }]
  }, { date: '2026-11-15' });
  Live.editSessionTarget(0, { targetSets: 5, repsMin: 6, repsMax: 8, targetReps: 6 });
  const ex = Live.currentExercise();
  assert(ex.targetSets === 5, 'session sets edited, got ' + ex.targetSets);
  assert(ex.repsMin === 6 && ex.repsMax === 8, 'session rep range edited');
  assert(ex.planSets === 4, 'plan sets stay 4');
  const payloadTpl = Live.templatePayloadFromSession();
  assert(payloadTpl.exercises[0].name === 'חתירה', 'template payload keeps the plan name');
  assert(payloadTpl.exercises[0].sets === 4, 'template payload keeps plan sets, got ' + payloadTpl.exercises[0].sets);
} finally {
  if (Live.setClock) Live.setClock(null);
  if (Live.getSession()) Live.discard();
}

console.log('swap tests passed');
