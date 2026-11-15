const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js');
run('js/engine.js');
const E = ctx.FitEngine;
function assert(c, m) { if (!c) throw new Error(m); }

const avg = E.rollingAverage([1, 2, 3, 4, 5, 6, 7], 3);
assert(avg.length === 7, 'len');
assert(Math.abs(avg[2] - 2) < 1e-9, 'first window ' + avg[2]);
assert(Math.abs(avg[6] - 6) < 1e-9, 'last window ' + avg[6]);
assert(E.rollingAverage([null, 10, null, 20], 2)[1] === 10, 'sparse skip');
assert(E.rollingAverage([null, 10, null, 20], 2)[3] === 20, 'sparse last');

const now = new Date(2026, 10, 15); // Nov 15 2026 local
const dates = [];
for (let i = 89; i >= 0; i--) {
  const d = new Date(2026, 10, 15);
  d.setDate(d.getDate() - i);
  dates.push(E.todayISO(d));
}
const metrics = dates.map(function (d, i) {
  return {
    date: d,
    hrv: 50 + i * 0.2,
    rhr: 60 - i * 0.05,
    recoveryPct: 40 + (i % 20),
    sleepPerformance: 70,
    sleepHours: 7
  };
});
const workouts = [];
for (let i = 0; i < 12; i++) {
  const d = dates[dates.length - 1 - i * 7];
  if (!d) continue;
  workouts.push({
    id: 'w' + i,
    date: d,
    exercises: [{ name: 'Bench Press', setLogs: [{ weight: 50 + i, reps: 8 }] }]
  });
}
const weights = dates.filter(function (_, i) { return i % 7 === 0; }).map(function (d, i) {
  return { date: d, weight: 80 - i * 0.2 };
});
const nutrition = dates.map(function (d) { return { date: d, calories: 2200, protein: 150 }; });
const st = { settings: {}, workouts: workouts, nutrition: nutrition, weights: weights, metrics: metrics };
const tr = E.computeTrends(st, 90, now);
assert(tr.days === 90, 'days');
const hrv = tr.series.find(function (s) { return s.id === 'hrv'; });
assert(hrv && hrv.points === 90, 'hrv points ' + (hrv && hrv.points));
assert(hrv.current > hrv.start, 'hrv up');
assert(hrv.change > 0 && hrv.upIsGood === true, 'hrv change positive');
const rhr = tr.series.find(function (s) { return s.id === 'rhr'; });
assert(rhr && rhr.upIsGood === false, 'rhr down is good');
assert(rhr.current < rhr.start, 'rhr declined');
const weekly = tr.series.find(function (s) { return s.id === 'weeklyVolume'; });
assert(weekly && weekly.points > 0, 'weekly volume points');
const wt = tr.series.find(function (s) { return s.id === 'weight'; });
assert(wt && wt.points >= 10, 'weight sparse still counted ' + (wt && wt.points));
assert(tr.e1rm.length >= 1 && tr.e1rm[0].exercise === 'Bench Press', 'top e1rm');
assert(tr.e1rm[0].current > 0, 'e1rm current');

const empty = E.computeTrends({ settings: {}, workouts: [], nutrition: [], weights: [], metrics: [] }, 30, now);
assert(empty.series.every(function (s) { return s.points === 0 || s.current == null; }), 'empty sparse');

console.log('trends tests passed');
