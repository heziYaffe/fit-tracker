/* v45 build axes: fat and muscle are independent, computed from history, and degrade to weight-only. */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js'); run('js/engine.js'); run('js/avatar-model.js');
const M = ctx.FitAvatarModel, E = ctx.FitEngine;
let n = 0;
function assert(c, m) { n++; if (!c) throw new Error(m); }
const meas = (v) => { const s = {}; Object.keys(v).forEach((k) => { s[k] = 'measured'; }); return Object.assign({ height: 'base', weight: 'default', chest: 'default', waist: 'default', hips: 'default', arm: 'default', thigh: 'default' }, s); };
const P = (v, extra) => M.bodyParams(Object.assign({ sex: 'm', values: v, sources: meas(v) }, extra || {}));
const G = (g) => ({ chest: g, shoulders: g, arms: g, back: g, core: g, legs: g });

// ---- shape of the result
let p = P({});
assert(p.axes && p.axes.fat >= 0 && p.axes.fat <= 1 && p.axes.muscle === 0, 'no data: fat from defaults, muscle 0');
assert(p.axesFrom.muscle === 'none' && p.axesFrom.fat === 'bmi', 'no data: sources say so');

// ---- fat: waist dominates when measured, BMI only otherwise
const slim = P({ weight: 80, height: 180, waist: 78 }), round = P({ weight: 80, height: 180, waist: 104 });
assert(round.axes.fat - slim.axes.fat > 0.4, 'same weight, bigger waist → much more fat');
assert(slim.axesFrom.fat === 'bmi+waist', 'waist measured → bmi+waist');
const wOnly = P({ weight: 100, height: 175 }), wOnlyLight = P({ weight: 65, height: 175 });
assert(wOnly.axesFrom.fat === 'bmi' && wOnly.axes.fat > wOnlyLight.axes.fat + 0.4, 'weight-only fallback still moves');
assert(p.softness === p.axes.fat, 'renderer softness = fat axis');

// ---- muscle: strength progress, training rhythm, girth vs waist
const lifter = P({ weight: 84, height: 178, waist: 80, chest: 112, arm: 39 }, { strength: G(0.4), training: { perWeek: 4, volumeTrend: 0.15 } });
const couch = P({ weight: 96, height: 178, waist: 104, chest: 106, arm: 33 }, { strength: G(0), training: null });
assert(lifter.axes.muscle > 0.75 && lifter.axes.fat < 0.25, 'cut: muscle high, fat low');
assert(couch.axes.muscle < 0.15 && couch.axes.fat > 0.7, 'soft: fat high, no muscle');
assert(M.buildLabel(lifter.axes).indexOf('חטוב') === 0 && M.buildLabel(couch.axes).indexOf('רך') === 0, 'plain labels');
const bulky = P({ weight: 100, height: 178, waist: 98, chest: 120, arm: 42 }, { strength: G(0.4), training: { perWeek: 4, volumeTrend: 0.1 } });
assert(bulky.axes.muscle > 0.6 && bulky.axes.fat > 0.45, 'independent: strong AND soft is possible');
// muscle discounts BMI for fat
const sameBody = { weight: 90, height: 178 };
assert(P(sameBody, { strength: G(0.5), training: { perWeek: 4, volumeTrend: 0.2 } }).axes.fat < P(sameBody).axes.fat, 'muscle mass is not counted as fat');
// strength alone (no circumferences) still counts; girth alone too
assert(P({}, { strength: G(0.3) }).axes.muscle > 0.4, 'e1RM progress alone → muscle');
assert(P({ waist: 80, arm: 40, chest: 112 }).axes.muscle > 0.6, 'girth vs waist alone → muscle');
assert(P({ waist: 80, arm: 40, chest: 112 }).axesFrom.muscle === 'size', 'muscle source = size');
// monotonic in training rhythm
assert(P({}, { training: { perWeek: 4, volumeTrend: 0 } }).axes.muscle > P({}, { training: { perWeek: 1, volumeTrend: 0 } }).axes.muscle, 'more sessions → more muscle');
// builder preview (no sources): given values count as known
assert(M.bodyParams({ sex: 'm', values: { waist: 104, weight: 80, height: 180 } }).axesFrom.fat === 'bmi+waist', 'preview values known');

// ---- history: trainingTrend + then vs now
const today = '2026-11-24';
const d = (k) => E.addDays(today, k);
const st = { settings: {}, weights: [{ id: 'a', date: d(-95), weight: 94 }, { id: 'b', date: d(-2), weight: 84 }],
  measures: [{ id: 'm0', date: d(-95), waist: 100, chest: 104, arm: 33 }, { id: 'm1', date: d(-2), waist: 86, chest: 108, arm: 37 }], workouts: [], metrics: [] };
for (let i = 80; i >= 1; i -= 3) {
  const w = 60 + (80 - i) * 0.4;
  st.workouts.push({ id: 'k' + i, date: d(-i), exercises: [{ name: 'לחיצת חזה', setLogs: [{ weight: w, reps: 8 }, { weight: w, reps: 8 }] }] });
}
const tr = M.trainingTrend(st, today);
assert(tr && tr.perWeek > 2 && tr.perWeek < 3 && tr.volumeTrend > 0, 'training: ~2.3/week and rising volume ' + JSON.stringify(tr));
assert(M.trainingTrend(st, d(-90)) === null, 'nothing lifted before → null');
assert(M.trainingTrend({ workouts: [] }, today) === null, 'no workouts → null');
const cfg = { sex: 'm', base: { height: 178 } };
const nowP = M.bodyParams(M.gatherInputs(st, cfg, today)), thenP = M.bodyParams(M.gatherInputs(st, cfg, d(-90)));
assert(thenP.axes.fat > nowP.axes.fat + 0.2, '3 months ago: more fat');
assert(nowP.axes.muscle > thenP.axes.muscle + 0.2, '3 months ago: less muscle');

// ---- UI + engine wiring
const ui = fs.readFileSync(path.join(rootDir, 'js/avatar.js'), 'utf8');
const av3 = fs.readFileSync(path.join(rootDir, 'js/avatar3d.js'), 'utf8');
const chibi = fs.readFileSync(path.join(rootDir, 'js/avatar-chibi.js'), 'utf8');
assert(/then: \{ days: 30/.test(ui) && /then90: \{ days: 90/.test(ui), 'compare 1 and 3 months');
assert(/setCompare\(params\)/.test(av3) && /setCompare\(null\)/.test(ui), 'side-by-side compare, cleared on close');
assert(/hasRealData/.test(ui), 'no fake "before" built from defaults');
assert(/p\.axes && p\.axes\.muscle/.test(chibi) && /absTexture/.test(chibi), 'villager reads the muscle axis, draws abs');

console.log('avatar-axes: ' + n + ' assertions ok');
