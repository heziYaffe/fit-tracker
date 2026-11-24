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

const kinds = ['sleep', 'recovery', 'strain', 'hrv', 'rhr', 'consistency', 'nutrition', 'protein', 'calories', 'water', 'workout', 'e1rm', 'recommendation', 'trends'];
kinds.forEach(function (k) {
  const info = E.metricInfo(k);
  assert(info && info.title && info.body && info.body.length < 280, 'info for ' + k);
});

function mon(hour, dayISO) {
  const d = E.parseISO(dayISO);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const empty = { settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150 }, workouts: [], nutrition: [], templates: [], dayMenus: [], foodLog: [], metrics: [] };
const tue = '2026-11-24'; // Tuesday
assert(E.parseISO(tue).getDay() === 2, 'tue');

let act = E.homePrimaryAction(empty, mon(8, tue));
assert(act.id === 'breakfast' && act.label === 'רשום ארוחת בוקר', 'morning no breakfast, got ' + act.id);

act = E.homePrimaryAction(empty, mon(8, tue), { liveOpen: true });
assert(act.id === 'resume' && act.label === 'המשך אימון', 'open live session wins');

act = E.homePrimaryAction(empty, mon(8, tue), { cardioOpen: true });
assert(act.action === 'resume-cardio', 'open cardio session');

const ate = {
  settings: empty.settings, workouts: [], nutrition: [{ date: tue, protein: 30, calories: 400 }],
  templates: [{ id: 't1', days: [2], name: 'חזה' }], dayMenus: [], foodLog: [], metrics: []
};
act = E.homePrimaryAction(ate, mon(8, tue));
assert(act.id === 'start' && act.label === 'התחל אימון', 'planned day after breakfast, got ' + act.id + ' ' + act.label);

const trained = {
  settings: empty.settings,
  workouts: [{ id: 'w1', date: tue, type: 'chest' }],
  nutrition: [{ date: tue, protein: 160, calories: 2000 }],
  templates: [{ id: 't1', days: [2] }], dayMenus: [], foodLog: [], metrics: []
};
act = E.homePrimaryAction(trained, mon(20, tue));
assert(act.id === 'summary' && act.label === 'סיכום יום', 'evening after training, got ' + act.id);

assert(E.breakfastLogged({
  dayMenus: [{ date: tue, meals: [{ name: 'בוקר', status: 'eaten' }] }],
  foodLog: [], nutrition: []
}, tue), 'menu breakfast counts');

assert(!E.breakfastLogged({
  dayMenus: [{ date: tue, meals: [{ name: 'בוקר', status: '' }, { name: 'צהריים', status: 'eaten' }] }],
  foodLog: [], nutrition: []
}, tue), 'lunch alone is not breakfast');

assert(E.isPlannedTrainingDay({ templates: [{ days: [2] }] }, tue), 'planned tuesday');
assert(!E.isPlannedTrainingDay({ templates: [{ days: [1] }] }, tue), 'not planned monday template');

const metricsState = {
  settings: empty.settings,
  workouts: [{ id: 'w1', date: '2026-11-24', type: 'run' }],
  nutrition: [],
  metrics: [
    { date: '2026-11-17', source: 'whoop', recoveryPct: 70, rhr: 60, hrv: 50 },
    { date: '2026-11-18', source: 'whoop', recoveryPct: 72, rhr: 59, hrv: 52 },
    { date: '2026-11-19', source: 'whoop', recoveryPct: 68, rhr: 61, hrv: 48 },
    { date: '2026-11-20', source: 'whoop', recoveryPct: 74, rhr: 58, hrv: 55 },
    { date: '2026-11-21', source: 'whoop', recoveryPct: 71, rhr: 59, hrv: 53 },
    { date: '2026-11-22', source: 'whoop', recoveryPct: 69, rhr: 60, hrv: 51 },
    { date: '2026-11-23', source: 'whoop', recoveryPct: 73, rhr: 58, hrv: 54 },
    { date: '2026-11-24', source: 'whoop', recoveryPct: 80, rhr: 54, hrv: 60 }
  ]
};
const rec = E.widgetStats(metricsState, 'recovery', 30, E.parseISO(tue), tue);
assert(rec.current === 80, 'today recovery, got ' + rec.current);
assert(rec.prevAvg != null && rec.delta > 0, 'recovery up vs previous week');
assert(rec.upIsGood === true, 'higher recovery is good');
const clsUp = rec.delta > 0 && rec.upIsGood;
assert(clsUp, 'green up for recovery');

const rhr = E.widgetStats(metricsState, 'rhr', 30, E.parseISO(tue), tue);
assert(rhr.current === 54, 'today rhr');
assert(rhr.delta < 0, 'rhr went down');
assert(rhr.upIsGood === false, 'lower rhr is good');
assert((rhr.delta < 0 && rhr.upIsGood === false), 'green down for rhr');
assert(rhr.peak === 54 || rhr.peak <= 54, 'peak for rhr is the best (lowest) in range, got ' + rhr.peak);

const wed = '2026-11-25'; // not a planned day in empty templates
assert(E.parseISO(wed).getDay() === 3, 'wed');
act = E.homePrimaryAction(empty, mon(14, wed));
assert(act.id === 'start', 'midday unplanned still starts a workout, got ' + act.id);

act = E.homePrimaryAction(trained, mon(20, tue), { date: '2026-11-20' });
assert(act.id === 'summary', 'past date shows summary, got ' + act.id);

console.log('ok ux smart-button and widget stats');
