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

console.log('ok workout-delete tombstones');
