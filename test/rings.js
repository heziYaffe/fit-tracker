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

// Recovery: Whoop thresholds
assert(E.ringZone('recovery', 33) === 'red', 'recovery 33 red, got ' + E.ringZone('recovery', 33));
assert(E.ringZone('recovery', 34) === 'amber', 'recovery 34 amber');
assert(E.ringZone('recovery', 66) === 'amber', 'recovery 66 amber');
assert(E.ringZone('recovery', 67) === 'green', 'recovery 67 green');
assert(E.ringZone('recovery', 90) === 'green', 'recovery 90 green');
assert(E.ringZone('recovery', null) === 'empty', 'recovery missing is empty');
assert(E.ringZone('recovery', 90, { empty: true }) === 'empty', 'empty flag wins');

// Sleep performance
assert(E.ringZone('sleep', 49) === 'red', 'sleep 49 red');
assert(E.ringZone('sleep', 50) === 'orange', 'sleep 50 orange');
assert(E.ringZone('sleep', 69) === 'orange', 'sleep 69 orange');
assert(E.ringZone('sleep', 70) === 'amber', 'sleep 70 amber');
assert(E.ringZone('sleep', 76) === 'amber', 'sleep 76 amber, not green');
assert(E.ringZone('sleep', 84) === 'amber', 'sleep 84 amber');
assert(E.ringZone('sleep', 85) === 'green', 'sleep 85 green');
assert(E.ringZone('sleep', 7.5, { unit: 'שע׳' }) === 'empty', 'sleep hours are not a performance band');
assert(E.ringZone('sleepHours', 7.5) === 'empty', 'sleepHours kind is not banded');

// Strain stays in the blue family (not red/green)
assert(E.ringZone('strain', 5.5) === 'strainLow', 'strain 5.5 low blue');
assert(E.ringZone('strain', 10) === 'strainMid', 'strain 10 mid blue');
assert(E.ringZone('strain', 13.9) === 'strainMid', 'strain 13.9 mid');
assert(E.ringZone('strain', 14) === 'strainHigh', 'strain 14 high blue');
['strainLow', 'strainMid', 'strainHigh'].forEach(function (z) {
  const c = E.RING_COLOR[z];
  assert(c && c.indexOf('--ring-strain') >= 0, z + ' uses a strain token, got ' + c);
  assert(c.indexOf('green') === -1 && c.indexOf('red') === -1, z + ' is not a good/bad color');
});

// Percent-of-target: consistency, protein, water, workouts
function targetKinds() { return ['consistency', 'nutrition', 'protein', 'water', 'workout']; }
targetKinds().forEach(function (k) {
  assert(E.ringZone(k, 0.39) === 'red', k + ' 39% red');
  assert(E.ringZone(k, 0.4) === 'amber', k + ' 40% amber');
  assert(E.ringZone(k, 0.5) === 'amber', k + ' 50% amber, not green — this was the bug');
  assert(E.ringZone(k, 0.69) === 'amber', k + ' 69% amber');
  assert(E.ringZone(k, 0.7) === 'greenSoft', k + ' 70% light green');
  assert(E.ringZone(k, 0.89) === 'greenSoft', k + ' 89% light green');
  assert(E.ringZone(k, 0.9) === 'green', k + ' 90% strong green');
  assert(E.ringZone(k, 1.25) === 'green', k + ' over-target stays green, not treated as percent');
});

// Consistency detail sheets pass 0–100 with unit %
assert(E.ringZone('consistency', 50, { unit: '%' }) === 'amber', 'consistency 50% via unit');
assert(E.ringZone('consistency', 90, { unit: '%' }) === 'green', 'consistency 90% via unit');
assert(E.ringZone('consistency', 50, { percent: true }) === 'amber', 'percent flag');

// 2/4 workouts is 50% → amber, 4/4 → green
assert(E.ringZone('workout', 2 / 4) === 'amber', '2/4 workouts amber');
assert(E.ringZone('workout', 4 / 4) === 'green', '4/4 workouts green');

// Empty / no data
assert(E.ringZone('consistency', null) === 'empty', 'null empty');
assert(E.ringZone('water', 0.0, { empty: true }) === 'empty', 'explicit empty');
assert(E.ringColor('protein', null) === E.RING_COLOR.empty, 'color for missing data is empty gray');

// Colors are distinct tokens, not --accent (so the recovery tint cannot retint them)
const used = ['red', 'orange', 'amber', 'greenSoft', 'green', 'empty', 'strainLow', 'strainMid', 'strainHigh'];
const vars = used.map(function (z) { return E.RING_COLOR[z]; });
assert(new Set(vars).size === used.length, 'every zone has a distinct CSS variable');
vars.forEach(function (c) {
  assert(c.indexOf('--accent') === -1, 'ring color must not use --accent: ' + c);
  assert(c.indexOf('--ring-') === 0 || c.indexOf('var(--ring-') === 0, 'uses --ring-* token: ' + c);
});
assert(E.ringColor('consistency', 0.5) !== E.ringColor('recovery', 90), '50% consistency is not the same color as 90% recovery');
assert(E.ringColor('consistency', 0.5) === E.RING_COLOR.amber, '50% is amber');
assert(E.ringColor('recovery', 90) === E.RING_COLOR.green, '90% recovery is strong green');
assert(E.ringColor('sleep', 76) === E.RING_COLOR.amber, '76% sleep is amber');
assert(E.ringColor('strain', 5.5) === E.RING_COLOR.strainLow, '5.5 strain is low blue');

// ⓘ copy stays consistent with the thresholds
const recInfo = E.metricInfo('recovery').body;
assert(recInfo.indexOf('67') >= 0 && recInfo.indexOf('34') >= 0 && recInfo.indexOf('33') >= 0, 'recovery info keeps Whoop bands');
const sleepInfo = E.metricInfo('sleep').body;
assert(sleepInfo.indexOf('85') >= 0 && sleepInfo.indexOf('70') >= 0, 'sleep info mentions 70 and 85');
const consInfo = E.metricInfo('consistency').body;
assert(consInfo.indexOf('70') >= 0 && consInfo.indexOf('40') >= 0 && consInfo.indexOf('90') >= 0, 'consistency info mentions the target bands');
['sleep', 'recovery', 'strain', 'consistency'].forEach(function (k) {
  assert(E.metricInfo(k).body.length < 280, k + ' info still short');
});

console.log('ok ring color scale');
