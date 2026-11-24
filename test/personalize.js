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

function at(iso, hour) {
  const d = E.parseISO(iso);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const tue = '2026-11-24'; // Tuesday
assert(E.parseISO(tue).getDay() === 2, 'tue is tuesday');

assert(E.recoveryZone(67) === 'green', '67 is green');
assert(E.recoveryZone(66) === 'yellow', '66 is yellow');
assert(E.recoveryZone(34) === 'yellow', '34 is yellow');
assert(E.recoveryZone(33) === 'red', '33 is red');
assert(E.recoveryZone(null) === null, 'missing recovery has no zone');

const empty = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150 },
  workouts: [], nutrition: [], templates: [], metrics: [], weights: []
};

// Greeting: time of day, no hardcoded name when displayName is missing
let g = E.personalGreeting(empty, at(tue, 8));
assert(g.hello === 'בוקר טוב', 'morning without name, got ' + g.hello);
assert(!g.line, 'no contextual line without data, got ' + JSON.stringify(g.line));

g = E.personalGreeting({ settings: { displayName: '  חזי  ' } }, at(tue, 8));
assert(g.hello === 'בוקר טוב, חזי', 'uses trimmed display name, got ' + g.hello);

g = E.personalGreeting({ settings: { displayName: 'חזי' } }, at(tue, 13));
assert(g.hello === 'צהריים טובים, חזי', 'afternoon, got ' + g.hello);

g = E.personalGreeting({ settings: { displayName: 'חזי' } }, at(tue, 19));
assert(g.hello === 'ערב טוב, חזי', 'evening, got ' + g.hello);

g = E.personalGreeting({ settings: { displayName: 'חזי' } }, at(tue, 22));
assert(g.hello === 'לילה טוב, חזי', 'night, got ' + g.hello);

g = E.personalGreeting({ settings: { displayName: 'חזי' } }, at(tue, 2));
assert(g.hello === 'לילה טוב, חזי', 'late night, got ' + g.hello);

g = E.personalGreeting({ settings: { displayName: '' } }, at(tue, 8));
assert(g.hello === 'בוקר טוב', 'empty name is omitted, got ' + g.hello);
assert(g.hello.indexOf('Hazi') === -1 && g.hello.indexOf('חזי') === -1, 'does not hardcode a name');

// Low recovery nudge wins, and includes sleep when present
const lowRec = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150, displayName: 'חזי' },
  workouts: [], nutrition: [], templates: [{ id: 't1', name: 'רגליים', days: [2] }],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 28, sleepHours: 5.5 }],
  weights: []
};
g = E.personalGreeting(lowRec, at(tue, 8));
assert(g.line.indexOf('5:30') >= 0, 'nudge mentions sleep, got ' + g.line);
assert(g.line.indexOf('התאוששות') >= 0 && g.line.indexOf('מנוחה') >= 0, 'nudge is gentle, got ' + g.line);
assert(g.line.indexOf('מוכן ליום') === -1, 'does not cheer a hard session on a red day');

// Missing sleep: still nudge from recovery alone; do not invent sleep
const lowRecNoSleep = {
  settings: empty.settings,
  workouts: [], nutrition: [], templates: [],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 20 }],
  weights: []
};
g = E.personalGreeting(lowRecNoSleep, at(tue, 8));
assert(g.line.indexOf('ישנת') === -1, 'does not invent sleep, got ' + g.line);
assert(g.line.indexOf('התאוששות נמוכה') >= 0, 'recovery-only nudge, got ' + g.line);

// Sleep + recovery + planned workout (green)
const ready = {
  settings: empty.settings,
  workouts: [], nutrition: [],
  templates: [{ id: 't1', name: 'רגליים', days: [2] }],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 78, sleepHours: 7 + 40 / 60 }],
  weights: []
};
g = E.personalGreeting(ready, at(tue, 8));
assert(g.line === 'ישנת 7:40 והגוף מוכן ליום רגליים.', 'ready line, got ' + g.line);

// No planned workout: still mention sleep + recovery, never invent a session name
const noPlan = {
  settings: empty.settings,
  workouts: [], nutrition: [], templates: [],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 78, sleepHours: 7 + 40 / 60 }],
  weights: []
};
g = E.personalGreeting(noPlan, at(tue, 8));
assert(g.line === 'ישנת 7:40 וההתאוששות 78%.', 'sleep+recovery only, got ' + g.line);

// Already trained: do not say "ready for legs"
const trainedReady = {
  settings: empty.settings,
  workouts: [{ id: 'w1', date: tue, type: 'legs', exercises: [{ name: 'סקוואט', weight: 80, reps: 5, sets: 3 }] }],
  nutrition: [],
  templates: [{ id: 't1', name: 'רגליים', days: [2] }],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 78, sleepHours: 7.5 }],
  weights: []
};
g = E.personalGreeting(trainedReady, at(tue, 8));
assert(g.line.indexOf('מוכן ליום') === -1, 'already trained, got ' + g.line);
assert(g.line.indexOf('7:30') >= 0 && g.line.indexOf('78%') >= 0, 'still reports real metrics, got ' + g.line);

// Yellow + planned
const yellow = {
  settings: empty.settings,
  workouts: [], nutrition: [],
  templates: [{ id: 't1', name: 'חזה', days: [2] }],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 50, sleepHours: 6.5 }],
  weights: []
};
g = E.personalGreeting(yellow, at(tue, 8));
assert(g.line.indexOf('חזה') >= 0 && g.line.indexOf('בלי להגזים') >= 0, 'moderate day, got ' + g.line);

// Notable protein streak overrides the Whoop line
const days = [];
for (let i = 0; i < 7; i++) days.push(E.addDays(tue, -i));
const proteinWeek = {
  settings: Object.assign({}, empty.settings, { dailyCalorieTarget: 2200 }),
  workouts: [],
  nutrition: days.map(function (d) { return { date: d, protein: 160, calories: 2100 }; }),
  templates: [{ id: 't1', name: 'רגליים', days: [2] }],
  metrics: [{ date: tue, source: 'whoop', recoveryPct: 80, sleepHours: 8 }],
  weights: []
};
g = E.personalGreeting(proteinWeek, at(tue, 8));
assert(g.line.indexOf('שבוע ברצף') >= 0 && g.line.indexOf('חלבון') >= 0, 'protein streak line, got ' + g.line);
assert(E.nutritionStreak(proteinWeek, 'protein', at(tue, 8)) === 7, 'protein streak is 7');
assert(E.nutritionStreak(proteinWeek, 'calories', at(tue, 8)) === 0, 'calories not hit, streak 0');

// Calorie streak when protein is not at a notable mark (2 days)
const calDays = [tue, E.addDays(tue, -1), E.addDays(tue, -2)];
const calState = {
  settings: Object.assign({}, empty.settings, { dailyCalorieTarget: 2200 }),
  workouts: [],
  nutrition: calDays.map(function (d) { return { date: d, protein: 100, calories: 2200 }; }),
  templates: [], metrics: [], weights: []
};
assert(E.nutritionStreak(calState, 'calories', at(tue, 8)) === 3, 'calorie streak 3');
g = E.personalGreeting(calState, at(tue, 8));
assert(g.line.indexOf('שלושה ימים ברצף') >= 0 && g.line.indexOf('קלוריות') >= 0, 'calorie streak line, got ' + g.line);

// No calorie target: skip calorie streak entirely
const noCalTarget = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150, dailyCalorieTarget: '' },
  workouts: [],
  nutrition: [{ date: tue, protein: 100, calories: 3000 }],
  templates: [], metrics: [], weights: []
};
assert(E.nutritionStreak(noCalTarget, 'calories', at(tue, 8)) === 0, 'no target means no calorie streak');

// Workouts this week vs usual (no Whoop, no notable streak)
function wo(id, date) { return { id: id, date: date, type: 'full', exercises: [{ name: 'סקוואט', weight: 60, reps: 5, sets: 3 }] }; }
// Week of Nov 24 2026 starts Sunday Nov 22. Previous weeks: Nov 15, Nov 8, Nov 1, Oct 25
const vsUsual = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150 },
  workouts: [
    wo('a1', '2026-11-22'), wo('a2', '2026-11-23'), wo('a3', '2026-11-24'),
    wo('b1', '2026-11-15'), wo('b2', '2026-11-16'), wo('b3', '2026-11-17'), wo('b4', '2026-11-18'),
    wo('c1', '2026-11-08'), wo('c2', '2026-11-09'), wo('c3', '2026-11-10'), wo('c4', '2026-11-12')
  ],
  nutrition: [], templates: [], metrics: [], weights: []
};
assert(E.usualWeeklyWorkouts(vsUsual, at(tue, 18)) === 4, 'usual is 4, got ' + E.usualWeeklyWorkouts(vsUsual, at(tue, 18)));
g = E.personalGreeting(vsUsual, at(tue, 18));
assert(g.line.indexOf('3 אימונים השבוע') >= 0 || g.line.indexOf('שלושה') >= 0 || g.line.indexOf('האימון ה-3') >= 0 || g.line.indexOf('האימון ה-4') >= 0, 'mentions this week vs usual, got ' + g.line);
// 3 this week vs usual 4, and hitting weekly target is not yet true
assert(g.line.indexOf('בדרך כלל 4') >= 0, 'compares to usual, got ' + g.line);

// ---------- Milestones ----------
const firstWo = {
  settings: empty.settings,
  workouts: [wo('w1', tue)],
  nutrition: [], templates: [], metrics: [], weights: []
};
let ms = E.detectMilestones(firstWo, at(tue, 20), []);
assert(ms.some(function (m) { return m.id === 'first-workout'; }), 'first workout milestone');
assert(E.detectMilestones(firstWo, at(tue, 20), ['first-workout']).every(function (m) { return m.id !== 'first-workout'; }), 'seen first workout is hidden');

// Historical first workout is not resurfaced
const oldFirst = {
  settings: empty.settings,
  workouts: [wo('w1', '2026-10-01')],
  nutrition: [], templates: [], metrics: [], weights: []
};
ms = E.detectMilestones(oldFirst, at(tue, 20), []);
assert(ms.length === 0, 'old firsts stay quiet, got ' + JSON.stringify(ms));

// Weight / e1RM PR (second session beats the first)
const prState = {
  settings: empty.settings,
  workouts: [
    { id: 'w0', date: '2026-11-20', exercises: [{ name: 'סקוואט', weight: 90, reps: 5, sets: 3 }] },
    { id: 'w1', date: tue, exercises: [{ name: 'סקוואט', weight: 100, reps: 5, sets: 3 }] }
  ],
  nutrition: [], templates: [], metrics: [], weights: []
};
ms = E.detectMilestones(prState, at(tue, 20), []);
const pr = ms.find(function (m) { return m.type === 'pr'; });
assert(pr, 'PR milestone exists: ' + JSON.stringify(ms));
assert(pr.title.indexOf('סקוואט') >= 0 && pr.title.indexOf('100') >= 0, 'PR text, got ' + pr.title);
assert(pr.id.indexOf('pr-') === 0, 'pr id ' + pr.id);

// Baseline only (one session) is not a PR
const baseline = {
  settings: empty.settings,
  workouts: [{ id: 'w0', date: tue, exercises: [{ name: 'סקוואט', weight: 100, reps: 5, sets: 3 }] }],
  nutrition: [], templates: [], metrics: [], weights: []
};
ms = E.detectMilestones(baseline, at(tue, 20), []);
assert(ms.every(function (m) { return m.type !== 'pr'; }), 'first session is not a PR');

// Protein streak milestone
const pDays = [];
for (let i = 0; i < 7; i++) pDays.push({ date: E.addDays(tue, -i), protein: 160, calories: 1800 });
const pState = { settings: empty.settings, workouts: [], nutrition: pDays, templates: [], metrics: [], weights: [] };
ms = E.detectMilestones(pState, at(tue, 20), []);
assert(ms.some(function (m) { return m.id === 'protein-streak-7'; }), '7-day protein milestone present');
assert(ms.every(function (m) { return m.id !== 'protein-streak-3'; }), 'lower protein mark is hidden when a higher one exists');
assert(E.detectMilestones(pState, at(tue, 20), ['protein-streak-7']).every(function (m) {
  return m.id.indexOf('protein-streak') === -1;
}), 'seen protein streaks hidden');

// Workout week streak: 3 consecutive weeks with >= 4 workouts, current week already at 4
function weekWorkouts(start, n, prefix) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(wo(prefix + i, E.addDays(start, i)));
  return out;
}
// this week starts 2026-11-22; previous 11-15, 11-08
const weekStreakState = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150 },
  workouts: []
    .concat(weekWorkouts('2026-11-22', 4, 't'))
    .concat(weekWorkouts('2026-11-15', 4, 'p'))
    .concat(weekWorkouts('2026-11-08', 4, 'q')),
  nutrition: [], templates: [], metrics: [], weights: []
};
assert(E.workoutWeekStreak(weekStreakState, at(tue, 20)).weeks === 3, '3-week streak, got ' + JSON.stringify(E.workoutWeekStreak(weekStreakState, at(tue, 20))));
ms = E.detectMilestones(weekStreakState, at(tue, 20), []);
assert(ms.some(function (m) { return m.id === 'workout-weeks-3'; }), '3-week mark');
assert(ms.every(function (m) { return m.id !== 'workout-weeks-2'; }), 'lower week mark is hidden when a higher one exists');

// Body-weight progress toward a cut goal
const cutState = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150, menuPrefs: { goal: 'cut' } },
  workouts: [], nutrition: [], templates: [], metrics: [],
  weights: [
    { date: '2026-10-01', weight: 86 },
    { date: tue, weight: 83.8 }
  ]
};
ms = E.detectMilestones(cutState, at(tue, 20), []);
const wt = ms.find(function (m) { return m.id === 'weight-cut-2'; });
assert(wt, '2kg cut milestone, got ' + JSON.stringify(ms));
assert(wt.title.indexOf('ירדת') >= 0 && wt.title.indexOf('2') >= 0, 'cut text, got ' + wt.title);
assert(ms.every(function (m) { return m.id !== 'weight-cut-5'; }), 'does not invent a 5kg drop');

// No goal: no weight-progress card (first weigh-in still allowed if recent)
const noGoal = {
  settings: empty.settings,
  workouts: [], nutrition: [], templates: [], metrics: [],
  weights: [
    { date: '2026-10-01', weight: 86 },
    { date: tue, weight: 83.8 }
  ]
};
ms = E.detectMilestones(noGoal, at(tue, 20), []);
assert(ms.every(function (m) { return m.type !== 'weight'; }), 'no weight progress without a goal');

// First weigh-in today is celebrated; no progress card
const firstW = {
  settings: Object.assign({}, empty.settings, { menuPrefs: { goal: 'cut' } }),
  workouts: [], nutrition: [], templates: [], metrics: [],
  weights: [{ date: tue, weight: 82 }]
};
ms = E.detectMilestones(firstW, at(tue, 20), []);
assert(ms.some(function (m) { return m.id === 'first-weight' && m.title.indexOf('82') >= 0; }), 'first weigh-in, got ' + JSON.stringify(ms));
assert(ms.every(function (m) { return m.type !== 'weight'; }), 'single weigh-in is not progress');

console.log('ok personalize greeting and milestones');
