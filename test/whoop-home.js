const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite,
  localStorage: {
    getItem: function (k) { return store[k] || null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  }
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js');
run('js/engine.js');
const E = ctx.FitEngine;
function assert(c, m) { if (!c) throw new Error(m); }

assert(E.formatHoursClock(5.88) === '5:53', 'clock 5.88 got ' + E.formatHoursClock(5.88));
assert(E.formatHoursClock(7) === '7:00', 'clock 7 got ' + E.formatHoursClock(7));
assert(E.recoveryZone(67) === 'green', 'zone 67');
assert(E.recoveryZone(66) === 'yellow', 'zone 66');
assert(E.recoveryZone(34) === 'yellow', 'zone 34');
assert(E.recoveryZone(33) === 'red', 'zone 33');
assert(E.recoveryZone(null) === null, 'zone null');

const state = {
  settings: { dailyProteinTarget: 150, weeklyWorkoutTarget: 4 },
  workouts: [],
  nutrition: [],
  metrics: [{
    id: 'whoop-2026-11-14',
    date: '2026-11-14',
    source: 'whoop',
    sleepHours: 5.88,
    sleepPerformance: 50,
    recoveryPct: 44,
    strain: 4.3686204,
    hrv: 61.96475
  }]
};
const snap = E.metricSnapshot(state, '2026-11-14');
assert(snap.hasWhoop && snap.hasAny, 'snapshot flags');
assert(snap.recoveryPct === 44, 'recovery');
assert(snap.sleepPerformance === 50, 'sleep perf');
const insight = E.homeInsight(state, '2026-11-14');
assert(insight.tone === 'yellow', 'insight tone ' + insight.tone);
assert(insight.title.indexOf('מתאושש') >= 0, 'insight title ' + insight.title);
assert(insight.body.indexOf('44') >= 0, 'insight body ' + insight.body);

const empty = E.homeInsight({ settings: {}, workouts: [], metrics: [] }, '2026-11-14');
assert(empty.tone === 'empty', 'empty insight');

const green = E.homeInsight({
  settings: {},
  workouts: [],
  metrics: [{ date: '2026-11-14', source: 'whoop', recoveryPct: 85, sleepPerformance: 80 }]
}, '2026-11-14');
assert(green.tone === 'green' && green.body.indexOf('אימון') >= 0, 'green push day: ' + green.body);

const red = E.homeInsight({
  settings: {},
  workouts: [{ id: 'w1', date: '2026-11-14', type: 'push' }],
  metrics: [{ date: '2026-11-14', source: 'whoop', recoveryPct: 14, sleepPerformance: 27 }]
}, '2026-11-14');
assert(red.tone === 'red', 'red tone');
assert(red.body.indexOf('התאוששות') >= 0 || red.body.indexOf('קל') >= 0, 'red body ' + red.body);

console.log('whoop-home tests passed');
