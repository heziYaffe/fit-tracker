/* Avatar: day-state rules, time of day, reaction detection and queue (pure). */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite, Intl };
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js');
run('js/engine.js');
run('js/avatar-model.js');
const M = ctx.FitAvatarModel;
let n = 0;
function assert(c, m) { n++; if (!c) throw new Error(m); }

// time of day
assert(M.timeOfDay(7) === 'morning' && M.timeOfDay(12) === 'midday' && M.timeOfDay(17) === 'sunset' && M.timeOfDay(22) === 'night' && M.timeOfDay(3) === 'night', 'tod buckets');
assert(M.timeOfDay(5) === 'morning' && M.timeOfDay(10) === 'midday' && M.timeOfDay(16) === 'sunset' && M.timeOfDay(19) === 'night', 'tod edges');
// Israel hour: 2026-11-24 10:30 UTC = 12:30 Israel (UTC+2)
assert(M.israelHour(Date.UTC(2026, 10, 24, 10, 30)) === 12, 'israel hour from UTC, got ' + M.israelHour(Date.UTC(2026, 10, 24, 10, 30)));

const today = '2026-11-24'; // Tuesday (dow 2)
function at(h) { const d = new Date(Date.UTC(2026, 10, 24, h - 2, 0)); return d; } // Israel hour h
function base() { return { settings: { dailyWaterTarget: 2000, waterInMl: true, dailyProteinTarget: 150 }, workouts: [], nutrition: [], metrics: [], weights: [], templates: [] }; }

// nothing known → nothing invented
let d = M.dayState(base(), at(9));
assert(!d.sleepy && !d.sore && !d.thirsty && !d.rest && d.primary === null && d.chip === '', 'no data → no state');
assert(d.tod === 'morning', 'morning tod');

// poor sleep by performance or hours
let s = base(); s.metrics = [{ date: today, source: 'whoop', sleepPerformance: 64 }];
d = M.dayState(s, at(9));
assert(d.sleepy && d.primary === 'sleepy' && /ישנת מעט/.test(d.chip), 'sleep perf 64 → sleepy');
s.metrics = [{ date: today, source: 'whoop', sleepPerformance: 85, sleepHours: 5.5 }];
assert(M.dayState(s, at(9)).sleepy, '5.5h → sleepy');
s.metrics = [{ date: today, source: 'whoop', sleepPerformance: 85, sleepHours: 7.2 }];
assert(!M.dayState(s, at(9)).sleepy, 'good sleep → not sleepy');

// high strain yesterday
s = base(); s.metrics = [{ date: '2026-11-23', source: 'whoop', strain: 15.2 }];
d = M.dayState(s, at(9));
assert(d.sore && d.sore.strain === 15.2 && d.primary === 'sore', 'strain 15.2 yesterday → sore');
s.metrics = [{ date: '2026-11-23', source: 'whoop', strain: 11 }];
assert(!M.dayState(s, at(9)).sore, 'strain 11 → not sore');
s.metrics = [{ date: today, source: 'whoop', strain: 18 }];
assert(!M.dayState(s, at(9)).sore, "today's strain is not yesterday's");

// low water only late afternoon and with data
s = base(); s.nutrition = [{ date: today, water: 500, protein: 40 }];
assert(!M.dayState(s, at(12)).thirsty, 'midday → not judged yet');
d = M.dayState(s, at(17));
assert(d.thirsty && d.thirsty.pct === 0.25 && d.primary === 'thirsty', '25% at 17:00 → thirsty');
s.nutrition = [{ date: today, water: 1000 }];
assert(!M.dayState(s, at(17)).thirsty, '50% → fine');
s.nutrition = [];
assert(!M.dayState(s, at(18)).thirsty, 'no nutrition row → skip');
s = base(); s.settings.waterInMl = false; s.settings.dailyWaterTarget = 8; s.nutrition = [{ date: today, water: 2 }];
assert(M.dayState(s, at(18)).thirsty, 'cups: 2 of 8 → thirsty');

// rest day needs a plan, today not planned, nothing done
s = base(); s.templates = [{ name: 'A', days: [0, 4] }];
assert(M.dayState(s, at(9)).rest && M.dayState(s, at(9)).primary === 'rest', 'Tuesday not in plan → rest');
s.workouts = [{ id: 'w', date: today, type: 'full', exercises: [] }];
assert(!M.dayState(s, at(9)).rest, 'worked out → not rest');
s = base(); s.templates = [{ name: 'A', days: [2] }];
assert(!M.dayState(s, at(9)).rest, 'planned today → not rest');
assert(!M.dayState(base(), at(9)).rest, 'no plan → not rest');

// priority blend
s = base(); s.metrics = [{ date: today, source: 'whoop', recoveryPct: 20, sleepPerformance: 50 }, { date: '2026-11-23', source: 'whoop', strain: 16 }];
d = M.dayState(s, at(9));
assert(d.primary === 'tired' && d.sleepy && d.sore, 'red recovery leads, flags kept');
s.metrics[0].recoveryPct = 80;
assert(M.dayState(s, at(9)).primary === 'sleepy', 'poor sleep beats green');
s.metrics = [{ date: today, source: 'whoop', recoveryPct: 80 }];
assert(M.dayState(s, at(9)).primary === 'happy', 'green alone → happy');
s.metrics = [{ date: today, source: 'whoop', recoveryPct: 50 }];
assert(M.dayState(s, at(9)).primary === 'neutral', 'yellow alone → neutral');

// reactions: detection
s = base();
const a0 = M.actionSnapshot(s, today);
s.workouts = [{ id: 'w1', date: today, type: 'full', exercises: [] }];
assert(JSON.stringify(M.detectReactions(a0, M.actionSnapshot(s, today))) === '["workout"]', 'workout saved');
const a1 = M.actionSnapshot(s, today);
s.nutrition = [{ date: today, protein: 160, calories: 600 }];
assert(JSON.stringify(M.detectReactions(a1, M.actionSnapshot(s, today))) === '["meal","goal"]', 'meal that crosses protein goal');
const a2 = M.actionSnapshot(s, today);
s.nutrition = [{ date: today, protein: 160, calories: 600, water: 250 }];
assert(JSON.stringify(M.detectReactions(a2, M.actionSnapshot(s, today))) === '["water"]', 'water');
const a3 = M.actionSnapshot(s, today);
s.nutrition = [{ date: today, protein: 170, calories: 700, water: 250 }];
assert(JSON.stringify(M.detectReactions(a3, M.actionSnapshot(s, today))) === '["meal"]', 'already over goal → no second cheer');
assert(M.detectReactions(null, a3).length === 0, 'no baseline → nothing');
assert(M.detectReactions(Object.assign({}, a3, { day: '2026-11-23' }), a3).length === 0, 'day change → baseline only');
const a4 = M.actionSnapshot(s, today);
s.workouts = [];
assert(M.detectReactions(a4, M.actionSnapshot(s, today)).length === 0, 'delete → nothing');

// reactions: queue
let q = [];
q = M.enqueueReaction(q, 'meal', 1000);
q = M.enqueueReaction(q, 'goal', 2000);
q = M.enqueueReaction(q, 'meal', 3000);
assert(q.length === 2 && q[0].type === 'goal' && q[1].type === 'meal' && q[1].at === 3000, 'repeat merges to latest');
q = M.enqueueReaction(q, 'nope', 4000);
assert(q.length === 2, 'unknown type ignored');
q = M.enqueueReaction(q, 'water', 4000); q = M.enqueueReaction(q, 'workout', 5000);
assert(q.length === 3 && q[0].type === 'meal', 'capped at 3, oldest dropped');
let nx = M.nextReaction(q, 6000);
assert(nx.type === 'meal' && nx.rest.length === 2, 'oldest first');
nx = M.nextReaction(q, 3000 + 31 * 60 * 1000);
assert(nx.type === 'water' || nx.type === 'workout' || nx.type === null, 'expired skipped');
assert(M.nextReaction(q, 10 * 60 * 60 * 1000).type === null, 'all expired → none');
assert(M.nextReaction([], 0).type === null, 'empty');

console.log('avatar day/reaction tests passed (' + n + ' assertions)');
