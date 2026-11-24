/* Realistic avatar (experimental): body → shape keys, reaction → clip, assets, setting. */
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
const read = (f) => fs.readFileSync(path.join(rootDir, f), 'utf8');

// ---- body parameters → morph influences
const P = (sex, v) => M.bodyParams({ sex: sex, values: v || {} });
['m', 'f'].forEach(function (sex) {
  const z = M.rigMorphs(P(sex));
  assert(M.RIG_KEYS.every(function (k) { return z[k] === 0; }), sex + ': neutral body → all keys 0, got ' + JSON.stringify(z));
});
const heavy = M.rigMorphs(P('m', { weight: 110, waist: 112, chest: 116, hips: 112, arm: 37, thigh: 64 }));
const lean = M.rigMorphs(P('m', { weight: 64, waist: 74, chest: 92, hips: 92, arm: 29, thigh: 50 }));
assert(heavy.weightUp > 0.5 && heavy.weightDown === 0, 'heavy → weightUp ' + JSON.stringify(heavy));
assert(lean.weightDown > 0.3 && lean.weightUp === 0, 'lean → weightDown ' + JSON.stringify(lean));
assert(heavy.waist > lean.waist && heavy.chest > lean.chest && heavy.thighs > lean.thighs, 'bigger girths → bigger keys');
M.RIG_KEYS.forEach(function (k) {
  [heavy, lean].forEach(function (o) { assert(typeof o[k] === 'number' && o[k] >= -1 && o[k] <= 1.5, k + ' in range: ' + o[k]); });
});
// only the waist grows → the waist key grows, the arms key does not
const w1 = M.rigMorphs(P('m', { waist: 86 })), w2 = M.rigMorphs(P('m', { waist: 100 }));
function girth(o, region) { let t = 0; Object.keys(o).forEach(function (k) { const c = M.RIG_CAL.m[k]; if (c && c[region]) t += o[k] * c[region]; }); return t; }
assert(w2.waist > w1.waist, 'a bigger waist → a bigger waist key');
// a softer body adds fat everywhere; the arm key compensates so the arm girth stays as measured
assert(w2.weightUp > 0 && Math.abs(girth(w2, 'arm')) < 0.005, 'arm girth unchanged by a waist-only change: ' + girth(w2, 'arm'));
assert(girth(w2, 'waist') > girth(w1, 'waist') + 0.1, 'waist girth follows');
// arm gains (strength) widen the arms key through bodyParams
const strong = M.rigMorphs(M.bodyParams({ sex: 'm', values: {}, strength: { arms: 0.5, chest: 0.5, shoulders: 0.5, back: 0.5, legs: 0.5, core: 0.5 } }));
assert(strong.arms > 0 && strong.muscleUp > 0, 'strength gains → arms + muscle ' + JSON.stringify(strong));
// height is a scale, not a key
const tall = M.rigMorphs(P('m', { height: 195 }));
assert(Object.keys(tall).length === M.RIG_KEYS.length, 'keys only');
// the 1.4× style gain is inherited from bodyParams: a 10 cm bigger waist is a bigger key than 10/86 would be
const g = M.rigMorphs(P('m', { waist: 96 })).waist * M.RIG_CAL.m.waist.waist;
assert(g > 0.1 * 1.2, 'style gain carried into the waist key: ' + g);

// ---- reaction → clip
assert(M.rigClipFor('meal', false) === 'eat_stand' && M.rigClipFor('water', true) === 'drink_sit', 'meal/water clips');
assert(M.rigClipFor('workout', false) === 'workout_stand' && M.rigClipFor('goal', true) === 'goal_sit', 'workout/goal clips');
assert(M.rigClipFor('dance', false) === null, 'unknown reaction → no clip');
const rigSrc = read('js/avatar-rig.js');
['eat', 'drink', 'workout', 'goal'].forEach(function (c) { assert(new RegExp('\\n  ' + c + ': \\{ dur:').test(rigSrc), 'authored clip ' + c); });
assert(/'eat' : type === 'water' \? 'drink'/.test(rigSrc), 'rig maps meal/water like rigClipFor');

// ---- assets: present, compressed, small, with the bones and keys the code binds by name
function glbJson(f) {
  const b = fs.readFileSync(path.join(rootDir, f));
  assert(b.readUInt32LE(0) === 0x46546c67, f + ' is a GLB');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.slice(20, 20 + len).toString('utf8'));
}
let total = 0;
['human_m.glb', 'human_f.glb', 'human_anims.glb'].forEach(function (f) { total += fs.statSync(path.join(rootDir, 'assets/avatar', f)).size; });
assert(total <= 1.5 * 1024 * 1024, 'avatar assets ≤ 1.5 MB, got ' + total);
['human_m.glb', 'human_f.glb'].forEach(function (f) {
  const j = glbJson('assets/avatar/' + f);
  assert((j.extensionsUsed || []).some(function (e) { return /meshopt/i.test(e); }), f + ' meshopt-compressed');
  const names = (j.nodes || []).map(function (x) { return x.name; });
  ['pelvis', 'spine_02', 'Head', 'hand_r', 'upperarm_l', 'lowerarm_r', 'middle_01_r', 'eye_l', 'eye_r'].forEach(function (b) { assert(names.indexOf(b) >= 0, f + ' has bone ' + b); });
  const tn = [];
  (j.meshes || []).forEach(function (m) { ((m.extras && m.extras.targetNames) || []).forEach(function (t) { tn.push(t); }); });
  M.RIG_KEYS.concat(['blink']).forEach(function (k) { assert(tn.indexOf(k) >= 0, f + ' has shape key ' + k); });
  assert((j.skins || []).length === 1, f + ' one skin');
});
const A = glbJson('assets/avatar/human_anims.glb');
const clips = (A.animations || []).map(function (a) { return a.name; });
['Idle_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit', 'Idle_FoldArms_Loop', 'Yes', 'Punch_Cross'].forEach(function (c) { assert(clips.indexOf(c) >= 0, 'clip ' + c); });
assert(clips.every(function (c) { return rigSrc.indexOf(c) >= 0 || ['Consume', 'Dance_Loop', 'Jump_Start', 'Jump_Land'].indexOf(c) >= 0; }), 'no unknown clips shipped');
const readme = read('assets/avatar/README.md');
assert(/MakeHuman[\s\S]*CC0/.test(readme) && /Universal Animation Library[\s\S]*CC0/.test(readme), 'asset licenses documented');

// ---- wiring: setting default off, synced settings, service worker
const C = ctx.FitConfig;
assert(C.DEFAULT_SETTINGS ? C.DEFAULT_SETTINGS.avatarRealistic === false : /avatarRealistic: false/.test(read('js/config.js')), 'setting off by default');
assert(/set\.avatarRealistic = set\.avatarRealistic === true/.test(read('js/store.js')), 'store normalizes the setting');
assert(/דמות ריאליסטית \(ניסיוני\)/.test(read('js/ui.js')) && /toggle-avatar-realistic/.test(read('js/ui.js')), 'settings toggle');
assert(/realistic: realisticOn\(\)/.test(read('js/avatar.js')), 'look carries the setting');
const sw = read('sw.js');
assert(sw.indexOf("'./js/avatar-rig.js'") >= 0, 'sw precaches avatar-rig.js');
assert(/assets\/avatar\//.test(sw) && /caches\.match\(request\)\.then\(\(hit\) => hit \|\|/.test(sw), 'sw caches the models cache-first');
const a3 = read('js/avatar3d.js');
assert(/import\('\.\/avatar-rig\.js'\)/.test(a3), 'rig module loads lazily');
assert(/rigFailed = true/.test(a3) && /buildFigure\(params, look, colors\)/.test(a3), 'built-in figure stays the fallback');
const vend = read('js/vendor/three-avatar.js');
assert(/GLTFLoader/.test(rigSrc) && vend.indexOf('KHR_mesh_quantization') >= 0 && vend.indexOf('EXT_meshopt_compression') >= 0, 'vendor bundle has the GLTF loader + meshopt');

console.log('avatar-rig: ' + n + ' assertions passed');
