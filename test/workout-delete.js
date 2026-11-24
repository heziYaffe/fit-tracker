const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const mem = {};
const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite,
  setTimeout, clearTimeout,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  }
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js');
run('js/engine.js');
run('js/store.js');
run('js/sync.js');
const Store = ctx.FitStore;
const Sync = ctx.FitSync;
const E = ctx.FitEngine;
function assert(c, m) { if (!c) throw new Error(m); }

Store.load();
const saved = Store.addWorkout({ date: '2026-11-24', type: 'cardio', customType: 'ריצה', duration: 30, activityId: 'run' });
assert(Store.getWorkout(saved.id), 'saved');
Store.deleteWorkout(saved.id);
assert(!Store.getWorkout(saved.id), 'getWorkout hides tombstone');
const raw = Store.getState().workouts.find(function (w) { return w.id === saved.id; });
assert(raw && raw.deletedAt, 'tombstone stays in state for sync');
assert(E.activeWorkouts(Store.getState()).every(function (w) { return w.id !== saved.id; }), 'active list excludes it');

const local = [{ id: 'w1', date: '2026-11-24', type: 'full', updatedAt: '2026-11-24T12:00:00.000Z', deletedAt: '2026-11-24T12:00:00.000Z' }];
const remote = [{ id: 'w1', date: '2026-11-24', type: 'full', updatedAt: '2026-11-24T09:00:00.000Z', duration: 40 }];
const merged = Sync.mergeRecords(local, remote);
assert(merged.length === 1 && merged[0].deletedAt, 'newer local tombstone wins and is kept for push, not resurrected');

const remoteDel = [{ id: 'w2', date: '2026-11-23', type: 'full', updated_at: '2026-11-24T12:00:00.000Z', deleted_at: '2026-11-24T12:00:00.000Z' }];
const merged2 = Sync.mergeRecords([], remoteDel);
assert(merged2.length === 0, 'remote-only deleted_at rows stay out of local lists');

const undone = Store.undeleteWorkout(saved.id);
assert(undone && !undone.deletedAt, 'undelete clears tombstone');
assert(Store.getWorkout(saved.id), 'workout is visible again after undo');

Store.load();
const food = Store.addFoodLog('2026-11-24', [{ name: 'ביצה', label: 'ביצה', calories: 80, protein: 7 }])[0];
const beforeNut = Store.getNutrition('2026-11-24');
const beforeP = Number(beforeNut && beforeNut.protein) || 0;
const beforeC = Number(beforeNut && beforeNut.calories) || 0;
assert(beforeP >= 7 && beforeC >= 80, 'food added to nutrition');
Store.removeFoodLog(food.id);
assert(!(Store.listFoodLog('2026-11-24') || []).some(function (r) { return r.id === food.id; }), 'food log hidden');
const mid = Store.getNutrition('2026-11-24');
assert((Number(mid && mid.protein) || 0) === beforeP - 7, 'nutrition dropped on delete');
Store.restoreFoodLog(food.id);
assert((Store.listFoodLog('2026-11-24') || []).some(function (r) { return r.id === food.id; }), 'food log restored');
const after = Store.getNutrition('2026-11-24');
assert(Number(after.protein) === beforeP && Number(after.calories) === beforeC, 'nutrition restored');

console.log('ok workout-delete tombstones');
