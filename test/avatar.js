/* Avatar: metrics → body-parameter mapping (pure). */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite };
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js');
run('js/engine.js');
run('js/avatar-model.js');
const M = ctx.FitAvatarModel;
const E = ctx.FitEngine;
let n = 0;
function assert(c, m) { n++; if (!c) throw new Error(m); }
const today = '2026-11-24';

// ---- defaults & never-invent
const empty = { settings: {}, workouts: [], weights: [], measures: [], metrics: [] };
let inp = M.gatherInputs(empty, { sex: 'm' }, today);
assert(inp.sources.weight === 'default' && inp.sources.waist === 'default', 'no data → defaults');
assert(inp.recoveryPct === null, 'no recovery invented');
assert(Object.values(inp.strength).every((g) => g === 0), 'no strength invented');
let p = M.bodyParams(inp);
assert(p.recovery.zone === null && p.recovery.slouch === 0 && p.recovery.mood === 'neutral', 'missing recovery → neutral upright');
assert(Math.abs(p.height - 1.76) < 1e-9, 'male default height');

// ---- base config used when no measurements
inp = M.gatherInputs(empty, { sex: 'm', base: { height: 182, weight: 85, waist: 90 }, baseDate: '2026-11-01' }, today);
assert(inp.sources.height === 'base' && inp.values.height === 182, 'base height');
assert(inp.sources.waist === 'base' && inp.values.waist === 90, 'base waist');
assert(inp.sources.chest === 'default', 'chest still default');

// ---- measured beats older base, older base beats nothing; base not used before its date for "then"? (it is the fallback)
const st = {
  settings: {},
  workouts: [],
  weights: [{ date: '2026-10-20', weight: 88 }, { date: '2026-11-20', weight: 84.4 }],
  measures: [
    { date: '2026-10-20', waist: 94, chest: 104, hips: '', arm: 35, thigh: '' },
    { date: '2026-11-22', waist: 90, chest: '', hips: 100, arm: '', thigh: 58 }
  ],
  metrics: [{ date: today, source: 'whoop', recoveryPct: 22 }]
};
inp = M.gatherInputs(st, { sex: 'm', base: { height: 180, chest: 100 }, baseDate: '2026-11-01' }, today);
assert(inp.values.weight === 84.4 && inp.sources.weight === 'measured', 'latest weight');
assert(inp.values.waist === 90 && inp.dates.waist === '2026-11-22', 'latest waist, field-wise');
assert(inp.sources.arm === 'scaled' && Math.abs(inp.values.arm - Math.round(35 * Math.pow(84.4 / 88, 0.5) * 10) / 10) < 1e-9, 'arm measured at 88 kg follows the newer 84.4 kg weight, got ' + inp.values.arm);
assert(inp.sources.waist === 'measured', 'waist measured after the last weight stays measured');
assert(inp.sources.chest === 'scaled' && Math.abs(inp.values.chest - Math.round(100 * Math.pow(84.4 / 88, 0.45) * 10) / 10) < 1e-9, 'newer base beats older measurement, then follows the newer weight');
const noW = M.gatherInputs(Object.assign({}, st, { weights: [] }), { sex: 'm', base: { height: 180, chest: 100 }, baseDate: '2026-11-01' }, today);
assert(noW.values.chest === 100 && noW.sources.chest === 'base', 'newer base beats older measurement');
assert(inp.recoveryPct === 22, 'today recovery read');
const then = M.gatherInputs(st, { sex: 'm', base: { height: 180 }, baseDate: '2026-11-01' }, E.addDays(today, -30));
assert(then.values.weight === 88 && then.values.waist === 94, 'then = values as of 30 days ago');
assert(M.diff(then, inp).some((d) => d.key === 'waist' && d.delta === -4), 'waist diff -4');
assert(M.diff(then, inp).some((d) => d.key === 'weight' && Math.abs(d.delta + 3.6) < 1e-9), 'weight diff -3.6');

// ---- recovery → posture/mood
p = M.bodyParams(inp);
assert(p.recovery.zone === 'red' && p.recovery.mood === 'tired' && p.recovery.slouch > 0.75, 'red → slouched & tired');
p = M.bodyParams(Object.assign({}, inp, { recoveryPct: 85 }));
assert(p.recovery.zone === 'green' && p.recovery.slouch === 0 && p.recovery.mood === 'happy', 'green → upright & happy');
const y = M.bodyParams(Object.assign({}, inp, { recoveryPct: 50 }));
assert(y.recovery.zone === 'yellow' && y.recovery.slouch > 0 && y.recovery.slouch < 0.75, 'yellow → slight slouch');

// ---- circumferences → torso/limb sizes (monotonic, ellipse math)
const ax = M.ellipseAxes(100, 0.7);
const ram = Math.PI * (3 * (ax.w + ax.d) - Math.sqrt((3 * ax.w + ax.d) * (ax.w + 3 * ax.d)));
assert(Math.abs(ram - 1.0) < 0.01, 'ellipse axes reproduce ~100cm circumference, got ' + ram);
function P(values, extra) { return M.bodyParams(Object.assign({ sex: 'm', values: values }, extra || {})); }
assert(P({ waist: 100 }).torso.waistW > P({ waist: 80 }).torso.waistW, 'bigger waist → wider');
assert(P({ chest: 115 }).torso.chestW > P({ chest: 95 }).torso.chestW, 'bigger chest → wider');
assert(P({ hips: 110 }).torso.hipsW > P({ hips: 95 }).torso.hipsW, 'bigger hips → wider');
assert(P({ arm: 40 }).limbs.upperArmR > P({ arm: 30 }).limbs.upperArmR, 'bigger arm → thicker');
assert(P({ thigh: 64 }).limbs.thighR > P({ thigh: 52 }).limbs.thighR, 'bigger thigh → thicker');
assert(Math.abs(P({ arm: 33 }).limbs.upperArmR - 0.33 / (2 * Math.PI)) < 1e-3, 'default arm circumference → radius C/2π');
const a40 = P({ arm: 40 }).limbs.upperArmR, a33 = P({ arm: 33 }).limbs.upperArmR;
assert(Math.abs((a40 - a33) - M.STYLE_GAIN * 0.07 / (2 * Math.PI)) < 1e-3, 'stylized: girth differences exaggerated by STYLE_GAIN');
assert(P({ height: 190 }).height === 1.9, 'height in meters');
assert(P({ height: 400 }).height === 2.15 && P({ height: 50 }).height === 1.3, 'height clamped');

// ---- weight/BMI + waist-to-height → softness/definition
const lean = P({ height: 180, weight: 72, waist: 78 });
const soft = P({ height: 180, weight: 105, waist: 108 });
assert(lean.softness < 0.25 && soft.softness > 0.7, 'softness lean ' + lean.softness + ' soft ' + soft.softness);
assert(lean.definition > soft.definition, 'lean more defined');
assert(soft.torso.belly > lean.torso.belly, 'soft → belly');
assert(soft.torso.waistD / soft.torso.waistW > lean.torso.waistD / lean.torso.waistW, 'soft waist rounder');

// ---- strength progress → region volume (capped)
const base = P({ arm: 35, chest: 100 });
const strong = P({ arm: 35, chest: 100 }, { strength: { arms: 0.25, chest: 0.5, legs: 0 } });
const huge = P({ arm: 35, chest: 100 }, { strength: { chest: 3 } });
assert(strong.limbs.upperArmR > base.limbs.upperArmR, 'arm strength → bigger arm');
assert(Math.abs(strong.limbs.upperArmR / base.limbs.upperArmR - (1 + M.MAX_VOLUME / 2)) < 1e-3, 'half gain → half volume');
assert(strong.torso.chestD > base.torso.chestD, 'chest strength → deeper chest');
assert(huge.torso.chestD === strong.torso.chestD, 'gain capped at MAX_GAIN');
assert(strong.limbs.thighR === base.limbs.thighR, 'no leg gain → same thigh');
assert(strong.definition > base.definition, 'strength → more definition');

// ---- strength from real workout history (e1RM)
function wk(date, name, weight, reps) {
  return { id: date + name, date: date, type: 'push', exercises: [{ name: name, sets: 3, reps: reps, weight: weight }] };
}
const hist = {
  settings: {}, weights: [], measures: [], metrics: [],
  workouts: [
    wk('2026-08-01', 'לחיצת חזה', 60, 8), wk('2026-08-08', 'לחיצת חזה', 60, 8),
    wk('2026-11-10', 'לחיצת חזה', 75, 8), wk('2026-11-10b', 'סקוואט', 80, 5)
  ]
};
hist.workouts[3].date = '2026-11-10';
const sg = M.strengthGains(hist, today);
assert(Math.abs(sg.gains.chest - 0.25) < 1e-6, 'bench 60→75 = +25% chest, got ' + sg.gains.chest);
assert(sg.gains.shoulders > 0 && sg.gains.shoulders < sg.gains.chest, 'secondary gets partial');
assert(sg.gains.legs === 0, 'single squat session → no gain');
assert(sg.detail.chest === 'לחיצת חזה', 'detail names the lift');
const sgThen = M.strengthGains(hist, '2026-09-01');
assert(sgThen.gains.chest === 0, 'no progress as of September');

// ---- config normalization & prefill
const c = M.normalizeConfig({ sex: 'f', beard: 'full', skin: 'nope', base: { height: '170', waist: 'x' } });
assert(c.beard === 'none' && c.skin === 's2' && c.base.height === 170 && c.base.waist === '', 'normalize');
assert(M.normalizeConfig(null) === null, 'no config → null');
const pre = M.prefillConfig(st, null);
assert(pre.base.weight === 84.4 && pre.base.waist === 90 && pre.base.chest === 104 && pre.base.thigh === 58, 'prefill from stored data');
assert(pre.base.height === '', 'height not invented');

// ---- visible change across realistic ranges (builder sliders)
const w70 = P({ height: 178, weight: 70, waist: 80 }), w110 = P({ height: 178, weight: 110, waist: 112 });
assert(w110.torso.waistW / w70.torso.waistW > 1.45, 'waist 80→112 visibly wider: ' + (w110.torso.waistW / w70.torso.waistW));
assert(w110.torso.belly - w70.torso.belly > 0.04, 'belly grows by >4cm');

// ---- weight-linked sliders
const linked = M.scaleWithWeight({ chest: 100, waist: 90, hips: 100, arm: 35, thigh: 58, height: 178 }, 80, 100);
assert(linked.waist > 105 && linked.waist < 110, 'waist follows weight strongly, got ' + linked.waist);
assert(linked.chest > 100 && linked.chest / 100 < linked.waist / 90, 'chest follows less');
assert(linked.height === 178, 'height untouched');
assert(M.scaleWithWeight({ waist: '' }, 80, 100).waist === '', 'empty stays empty');

// ---- mood from recovery
const tired = M.moodFor(15), fresh = M.moodFor(92), none = M.moodFor(null);
assert(tired.zzz && tired.eyeOpen < 0.6 && tired.earDroop > 0.8 && tired.bounce === 0, 'tired: sleepy eyes, droopy ears, zzz');
assert(!fresh.zzz && fresh.eyeOpen === 1 && fresh.earDroop === 0 && fresh.bounce > 0.8, 'fresh: perky + bounce');
assert(fresh.breathRate > tired.breathRate, 'tired breathes slower');
assert(none.zone === null && none.bounce === 0 && none.slouch === 0 && !none.zzz, 'no recovery → calm neutral');

// ---- creatures share the body mapping
const cLean = M.creatureShape(P({ height: 178, weight: 70, waist: 78, arm: 32, thigh: 52 }));
const cSoft = M.creatureShape(P({ height: 178, weight: 110, waist: 112, arm: 40, thigh: 64 }));
const cTall = M.creatureShape(P({ height: 200 }));
assert(cSoft.bellyR / cLean.bellyR > 1.5, 'soft creature has a much rounder belly');
assert(cSoft.armR > cLean.armR && cSoft.legR > cLean.legR, 'limb thickness from arm/thigh');
assert(cTall.scale > M.creatureShape(P({ height: 160 })).scale, 'height scale');
const cStrong = M.creatureShape(P({ arm: 35 }, { strength: { arms: 0.5 } }));
assert(cStrong.armR > M.creatureShape(P({ arm: 35 })).armR, 'strength thickens creature arms');
const kc = M.normalizeConfig({ kind: 'dragon', color: 'nope' });
assert(kc.kind === 'dragon' && kc.color === 'mint', 'creature config + default color');
assert(M.normalizeConfig({ kind: 'unicorn' }).kind === 'human', 'unknown kind → human');
assert(M.gatherInputs(empty, kc, today).kind === 'dragon' && M.bodyParams(M.gatherInputs(empty, kc, today)).kind === 'dragon', 'kind flows to params');

console.log('avatar tests passed (' + n + ' assertions)');
