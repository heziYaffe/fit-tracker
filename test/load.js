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
function close(a, b, eps, m) {
  if (Math.abs(a - b) > (eps || 0.05)) throw new Error((m || 'close') + ' got ' + a + ' expected ~' + b);
}

assert(Math.abs(E.epley1RM(100, 5) - 100 * (1 + 5 / 30)) < 1e-9, 'epley 100x5');
assert(E.epley1RM(80, 1) === 80, 'epley 1RM');
const brz = E.brzycki1RM(100, 5);
close(brz, 100 * (36 / 32), 1e-6, 'brzycki');
assert(E.brzycki1RM(100, 12) === 0, 'brzycki only <=10');
assert(E.roundToStep(51.2, 2.5) === 50 || E.roundToStep(51.2, 2.5) === 52.5, 'round 51.2');
assert(E.roundToStep(51.3, 2.5) === 52.5, 'round 51.3 -> 52.5 got ' + E.roundToStep(51.3, 2.5));
assert(E.roundToStep(21.1, 1.25) === 21.25, 'small step ' + E.roundToStep(21.1, 1.25));

function state(workouts, metrics) {
  return { settings: {}, workouts: workouts || [], nutrition: [], weights: [], metrics: metrics || [] };
}

function w(date, id, exercises) {
  return { id: id, date: date, type: 'push', exercises: exercises };
}

// No history -> no recommendation
assert(E.recommendNextLoad(state([]), 'bench') == null, 'no history');

// Volume +2.5% with Epley invert in 8-12 range
// Last: 3x10x50, e1RM = 50*(1+10/30)=66.666..., V=1500
const s1 = state([w('2026-11-01', 'a', [{ name: 'Bench Press', sets: 3, reps: 8, weight: 50, setLogs: [
  { weight: 50, reps: 10 }, { weight: 50, reps: 10 }, { weight: 50, reps: 10 }
] }])]);
const rec = E.recommendNextLoad(s1, 'Bench Press', { sets: 3, repsMin: 8, repsMax: 12 });
assert(rec && rec.kind === 'weight', 'weight rec ' + (rec && rec.kind));
close(rec.e1rm, 50 * (1 + 10 / 30), 0.01, 'last e1rm');
close(rec.volumeLast, 1500, 0.1, 'v last');
close(rec.volumeNext, 1500 * 1.025, 80, 'v next near +2.5%'); // rounded weight may drift a bit
assert(rec.reps >= 8 && rec.reps <= 12, 'reps in range ' + rec.reps);
assert(rec.weight > 0, 'weight set');
assert(rec.label.indexOf('ק״ג') >= 0 && rec.label.indexOf('×') >= 0, 'label ' + rec.label);
assert(rec.reason.indexOf('2.5') >= 0 || rec.reason.indexOf('נפח') >= 0, 'reason ' + rec.reason);

// Yellow recovery holds volume (r=0)
const yellow = state(s1.workouts, [{ date: '2026-11-15', recoveryPct: 50 }]);
const recY = E.recommendNextLoad(yellow, 'Bench Press', { sets: 3, repsMin: 8, repsMax: 12, date: '2026-11-15' });
assert(recY.r === 0, 'yellow r=0 got ' + recY.r);
assert(recY.reason.indexOf('שמירה') >= 0, 'yellow reason ' + recY.reason);

// Red recovery deloads 10%
const red = state(s1.workouts, [{ date: '2026-11-15', recoveryPct: 20 }]);
const recR = E.recommendNextLoad(red, 'Bench Press', { sets: 3, repsMin: 8, repsMax: 12, date: '2026-11-15' });
assert(recR.r === -0.10, 'red r=-10% got ' + recR.r);
assert(recR.reason.indexOf('התאוששות נמוכה') >= 0, 'red reason ' + recR.reason);

// Green allows normal progression
const green = state(s1.workouts, [{ date: '2026-11-15', recoveryPct: 80 }]);
const recG = E.recommendNextLoad(green, 'Bench Press', { sets: 3, repsMin: 8, repsMax: 12, date: '2026-11-15' });
assert(recG.r === 0.025, 'green r ' + recG.r);

// Two consecutive e1RM drops -> deload even if recovery green
const drop = state([
  w('2026-10-01', 'd1', [{ name: 'Squat', setLogs: [{ weight: 100, reps: 5 }] }]),
  w('2026-10-08', 'd2', [{ name: 'Squat', setLogs: [{ weight: 100, reps: 4 }] }]),
  w('2026-10-15', 'd3', [{ name: 'Squat', setLogs: [{ weight: 100, reps: 3 }] }])
], [{ date: '2026-11-15', recoveryPct: 80 }]);
const recD = E.recommendNextLoad(drop, 'Squat', { sets: 1, repsMin: 3, repsMax: 6, date: '2026-11-15' });
assert(recD.r === -0.10, 'drop r ' + recD.r);
assert(recD.reason.indexOf('ירידה') >= 0, 'drop reason ' + recD.reason);

// NSCA 2-for-2: last set 14 (>12+2) twice -> bump
const two = state([
  w('2026-11-01', 't1', [{ name: 'OHP', setLogs: [{ weight: 40, reps: 10 }, { weight: 40, reps: 10 }, { weight: 40, reps: 14 }] }]),
  w('2026-11-08', 't2', [{ name: 'OHP', setLogs: [{ weight: 40, reps: 10 }, { weight: 40, reps: 10 }, { weight: 40, reps: 14 }] }])
]);
const rec2 = E.recommendNextLoad(two, 'OHP', { sets: 3, repsMin: 8, repsMax: 12 });
assert(rec2.twoForTwo, '2-for-2 flagged');
assert(rec2.reason.indexOf('2-for-2') >= 0, '2-for-2 reason ' + rec2.reason);

// Bodyweight: reps progression
const bw = state([w('2026-11-01', 'p1', [{ name: 'Pull Up', bodyweight: true, setLogs: [
  { weight: 0, reps: 8 }, { weight: 0, reps: 8 }, { weight: 0, reps: 8 }
] }])]);
const recBw = E.recommendNextLoad(bw, 'Pull Up', { sets: 3, repsMin: 6, repsMax: 15, bodyweight: true });
assert(recBw && recBw.kind === 'bodyweight', 'bw kind');
assert(recBw.weight === 0, 'bw no added weight');
assert(recBw.reps > 8, 'bw reps increase got ' + recBw.reps);
assert(recBw.label.indexOf('חזרות') >= 0, 'bw label ' + recBw.label);

// MAX: last max + 1
const mx = state([w('2026-11-01', 'm1', [{ name: 'Push Up', repsMode: 'max', bodyweight: true, setLogs: [
  { weight: 0, reps: 20 }
] }])]);
const recM = E.recommendNextLoad(mx, 'Push Up', { sets: 3, repsMode: 'max', bodyweight: true });
assert(recM && recM.kind === 'max' && recM.reps === 21, 'max +1 got ' + (recM && recM.reps));

// Static: +5s
const st = state([w('2026-11-01', 's1', [{ name: 'Plank', static: true, setLogs: [
  { weight: 0, reps: 0, secs: 40 }
] }])]);
const recS = E.recommendNextLoad(st, 'Plank', { sets: 3, static: true });
assert(recS && recS.kind === 'static' && recS.secs === 45, 'static +5 got ' + (recS && recS.secs));

console.log('load tests passed');
