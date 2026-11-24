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
const C = ctx.FitConfig;
function assert(c, m) { if (!c) throw new Error(m); }

assert(C.CARDIO_ACTIVITIES && C.CARDIO_ACTIVITIES[0].id === 'run', 'catalog starts with running');
assert(C.CARDIO_ACTIVITIES[1].id === 'walk', 'then walking');
assert(C.CARDIO_ACTIVITIES.some(function (a) { return a.id === 'hiit'; }), 'includes HIIT');

const empty = E.sortCardioActivities([], '2026-11-24T08:00:00');
assert(empty.map(function (a) { return a.id; }).join(',') === C.CARDIO_ACTIVITIES.map(function (a) { return a.id; }).join(','),
  'unused activities keep default order');

const frequent = [
  { type: 'cardio', activityId: 'swim', date: '2026-11-01' },
  { type: 'cardio', activityId: 'swim', date: '2026-11-02' },
  { type: 'cardio', activityId: 'swim', date: '2026-11-03' },
  { type: 'cardio', activityId: 'walk', date: '2026-11-04' }
];
const byFreq = E.sortCardioActivities(frequent, '2026-11-24T08:00:00');
assert(byFreq[0].id === 'swim', 'most used floats to the top, got ' + byFreq[0].id);
assert(byFreq[1].id === 'walk', 'next used follows, got ' + byFreq[1].id);
assert(byFreq[2].id === 'run', 'unused keep catalog order after used ones, got ' + byFreq[2].id);

// Same frequency: recent use can lift an activity above a stale one.
const recency = [
  { type: 'cardio', activityId: 'run', date: '2026-10-01' },
  { type: 'cardio', activityId: 'run', date: '2026-10-02' },
  { type: 'cardio', activityId: 'run', date: '2026-10-03' },
  { type: 'cardio', activityId: 'run', date: '2026-10-04' },
  { type: 'cardio', activityId: 'run', date: '2026-10-05' },
  { type: 'cardio', activityId: 'walk', date: '2026-11-23' },
  { type: 'cardio', activityId: 'walk', date: '2026-11-22' },
  { type: 'cardio', activityId: 'walk', date: '2026-11-21' },
  { type: 'cardio', activityId: 'walk', date: '2026-11-20' },
  { type: 'cardio', activityId: 'walk', date: '2026-11-19' }
];
const byRecent = E.sortCardioActivities(recency, '2026-11-24T08:00:00');
assert(byRecent[0].id === 'walk', 'recent frequency tie floats the fresher activity, got ' + byRecent[0].id + ' score ' + byRecent[0].score);

const tie = [
  { type: 'cardio', activityId: 'swim', date: '2026-11-20' },
  { type: 'cardio', activityId: 'row', date: '2026-11-20' }
];
const tied = E.sortCardioActivities(tie, '2026-11-24T08:00:00');
const swimI = tied.findIndex(function (a) { return a.id === 'swim'; });
const rowI = tied.findIndex(function (a) { return a.id === 'row'; });
assert(rowI < swimI, 'equal scores keep catalog order (row before swim)');

assert(E.inferCardioActivityId({ type: 'cardio', customType: 'ריצה' }) === 'run', 'hebrew label');
assert(E.inferCardioActivityId({ source: 'whoop', customType: 'running' }) === 'run', 'whoop running');
assert(E.inferCardioActivityId({ source: 'whoop', customType: 'cycling' }) === 'bike', 'whoop cycling');
assert(E.inferCardioActivityId({ type: 'chest' }) === '', 'strength workout is not cardio');

assert(E.formatCardioClock(0) === '00:00', 'zero clock');
assert(E.formatCardioClock(65000) === '01:05', 'mm:ss');
assert(E.formatCardioClock(3723000) === '1:02:03', 'h:mm:ss');

const started = { running: true, startedAt: 1_000_000, elapsedMs: 5000 };
assert(E.cardioElapsedMs(started, 1_010_000) === 15000, 'running elapsed adds current segment');
assert(E.cardioElapsedMs({ running: false, elapsedMs: 90000 }, 1_000_000) === 90000, 'paused uses stored elapsed');

const noDur = E.buildCardioWorkout({ activityId: 'run' }, 1_000_000);
assert(!noDur.ok && noDur.error === 'no-duration', 'save requires a duration');

const fromTimer = E.buildCardioWorkout({
  activityId: 'run',
  running: false,
  elapsedMs: 25 * 60 * 1000,
  date: '2026-11-24'
}, 1_000_000);
assert(fromTimer.ok, 'timer session can be saved');
assert(fromTimer.workout.type === 'cardio', 'saved as cardio');
assert(fromTimer.workout.activityId === 'run', 'keeps activity id');
assert(fromTimer.workout.customType === 'ריצה', 'hebrew name');
assert(fromTimer.workout.duration === 25, 'minutes from timer, got ' + fromTimer.workout.duration);

const override = E.buildCardioWorkout({
  activityId: 'walk',
  durationMin: 40,
  elapsedMs: 10 * 60 * 1000,
  distanceKm: 3.25,
  avgHr: 132.4,
  rpe: 6,
  notes: 'פארק',
  date: '2026-11-24'
});
assert(override.workout.duration === 40, 'manual duration wins');
assert(override.workout.distanceKm === 3.25, 'distance kept');
assert(override.workout.avgHr === 132, 'hr rounded');
assert(override.workout.rpe === 6, 'rpe kept');
assert(override.workout.notes === 'פארק', 'notes kept');

const named = E.buildCardioWorkout({
  activityId: 'other',
  label: 'קיקבוקס',
  durationMin: 30,
  date: '2026-11-24'
});
assert(named.workout.customType === 'קיקבוקס', 'custom other name');

const state = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150 },
  workouts: [fromTimer.workout],
  nutrition: []
};
assert(E.workoutsOn(state, '2026-11-24').length === 1, 'cardio appears on that day');
assert(E.dayQualifies(state, '2026-11-24'), 'cardio counts as a consistency day');
const cons = E.computeConsistency(state, E.parseISO('2026-11-24'));
assert(cons.workoutsDone === 1, 'cardio counts toward workout consistency, got ' + cons.workoutsDone);
assert(cons.todayQualifies, 'today qualifies after a cardio session');

console.log('ok cardio ' + C.CARDIO_ACTIVITIES.length + ' activities');

// --- Whoop match, enrich, backfill, and hidden/deleted workouts ---
assert(E.kjToKcal(4184) === 1000, 'kj to kcal');

const whoopRun = {
  id: 'whoop-wo-abc',
  source: 'whoop',
  whoopId: 'abc',
  type: 'cardio',
  customType: 'running',
  date: '2026-11-24',
  startedAt: '2026-11-24T06:00:00.000Z',
  endedAt: '2026-11-24T06:40:00.000Z',
  avgHr: 148,
  maxHr: 176,
  strain: 10.2,
  kilojoule: 2092,
  kcal: 500,
  distanceKm: 7.2,
  hrZones: { 1: 120000, 2: 600000, 3: 480000 }
};
const manual = {
  id: 'id_manual',
  source: 'manual',
  type: 'cardio',
  activityId: 'run',
  customType: 'ריצה',
  date: '2026-11-24',
  startedAt: '2026-11-24T06:05:00.000Z',
  endedAt: '2026-11-24T06:38:00.000Z',
  duration: 33
};
const hit = E.matchWhoopWorkout(manual, [whoopRun]);
assert(hit && hit.whoopId === 'abc', 'overlap + sport matches running');

const noOverlap = E.matchWhoopWorkout(Object.assign({}, manual, {
  startedAt: '2026-11-24T16:00:00.000Z',
  endedAt: '2026-11-24T16:30:00.000Z'
}), [whoopRun]);
assert(!noOverlap, 'non-overlapping evening session does not match morning whoop');

const dateOnly = { id: 'd1', type: 'cardio', activityId: 'run', date: '2026-11-24' };
assert(E.matchWhoopWorkout(dateOnly, [whoopRun]) && E.matchWhoopWorkout(dateOnly, [whoopRun]).whoopId === 'abc', 'unique same-day fallback');
const whoopWalk = Object.assign({}, whoopRun, { id: 'whoop-wo-w', whoopId: 'walk1', customType: 'walking', startedAt: '2026-11-24T08:00:00.000Z', endedAt: '2026-11-24T08:20:00.000Z' });
assert(E.matchWhoopWorkout(dateOnly, [whoopRun, whoopWalk]).whoopId === 'abc', 'same-day picks the matching sport');
const whoopRun2 = Object.assign({}, whoopRun, { id: 'whoop-wo-r2', whoopId: 'run2', startedAt: '2026-11-24T16:00:00.000Z', endedAt: '2026-11-24T16:30:00.000Z' });
assert(!E.matchWhoopWorkout(dateOnly, [whoopRun, whoopRun2]), 'two same-sport sessions the same day stay unmatched without times');

const typed = { avgHr: 160, duration: 33, type: 'cardio', activityId: 'run' };
const enriched = E.enrichCardioFromWhoop(typed, whoopRun);
assert(enriched.workout.avgHr === 160, 'never overwrite a typed avg HR');
assert(enriched.workout.maxHr === 176, 'fill missing max HR');
assert(enriched.workout.kcal === 500, 'fill kcal');
assert(enriched.workout.distanceKm === 7.2, 'fill distance');
assert(enriched.workout.fromWhoop.maxHr && !enriched.workout.fromWhoop.avgHr, 'fromWhoop only on auto-filled fields');
assert(enriched.workout.whoopId === 'abc', 'link whoop id');

const back = E.backfillCardioWorkouts([manual, whoopRun]);
assert(back.changed, 'backfill writes missing fields later');
const filledManual = back.workouts.find(function (w) { return w.id === 'id_manual'; });
assert(filledManual.avgHr === 148 && filledManual.whoopId === 'abc', 'manual session gets whoop metrics');

const deleted = { id: 'gone', date: '2026-11-24', type: 'cardio', deletedAt: '2026-11-24T10:00:00.000Z' };
const mixed = {
  settings: { weeklyWorkoutTarget: 4, dailyProteinTarget: 150 },
  workouts: [filledManual, whoopRun, deleted],
  nutrition: []
};
const active = E.activeWorkouts(mixed);
assert(active.length === 1 && active[0].id === 'id_manual', 'hide deleted and linked Whoop duplicates, got ' + active.map(function (w) { return w.id; }));
assert(E.workoutsOn(mixed, '2026-11-24').length === 1, 'consistency day counts the manual session once');
assert(E.computeConsistency(mixed, E.parseISO('2026-11-24')).workoutsDone === 1, 'deleted/duplicate not in workoutsDone');

const sess = E.applyWhoopToCardioSession({
  activityId: 'run',
  date: '2026-11-24',
  periodStart: Date.parse('2026-11-24T06:05:00.000Z'),
  elapsedMs: 33 * 60 * 1000,
  running: false
}, [whoopRun]);
assert(sess.filled.indexOf('avgHr') >= 0 && sess.session.avgHr === 148, 'open logger can autofill from whoop');

const built2 = E.buildCardioWorkout({
  activityId: 'run',
  durationMin: 33,
  periodStart: Date.parse('2026-11-24T06:05:00.000Z'),
  endedAt: Date.parse('2026-11-24T06:38:00.000Z'),
  avgHr: 148,
  fromWhoop: { avgHr: true },
  whoopId: 'abc',
  date: '2026-11-24'
}, Date.parse('2026-11-24T06:38:00.000Z'));
assert(built2.ok && built2.workout.startedAt && built2.workout.whoopId === 'abc', 'saved payload keeps times and whoop link');

console.log('ok cardio whoop match/backfill');
