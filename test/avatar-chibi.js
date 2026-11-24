/* v44 cozy villager avatars: kinds, palettes, face-expression rule, and that the module ships offline. */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
run('js/config.js'); run('js/engine.js'); run('js/avatar-model.js');
const M = ctx.FitAvatarModel;
let n = 0;
function assert(c, m) { n++; if (!c) throw new Error(m); }

// kinds & palettes
['human', 'bunny', 'cat', 'bear', 'dragon', 'robot'].forEach((k) => assert(M.KINDS.some((x) => x.id === k), 'kind ' + k));
M.KINDS.filter((k) => k.id !== 'human').forEach((k) => {
  const pal = M.CREATURE_COLORS[k.id];
  assert(Array.isArray(pal) && pal.length >= 3 && pal.every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)), 'palette ' + k.id);
});

// face expression: clip first, then mood
assert(M.faceExpr('meal', 0.5, {}, {}) === 'chew', 'meal chews');
assert(M.faceExpr('goal', 0.5, { zone: 'red' }, {}) === 'joy', 'goal beats tired mood');
assert(M.faceExpr('water', 0.5, {}, {}) === 'sip' && M.faceExpr('water', 0.1, {}, {}) === 'happy', 'water sips mid-clip');
assert(M.faceExpr('yawn', 0.5, {}, {}) === 'yawn', 'yawn');
assert(M.faceExpr('workout', 0.3, {}, {}) === 'effort' && M.faceExpr('workout', 0.7, {}, {}) === 'joy', 'workout effort → joy');
assert(M.faceExpr(null, 0, {}, { sleepy: true }) === 'sleepy', 'sleepy day');
assert(M.faceExpr(null, 0, { zone: 'red', mood: 'tired' }, {}) === 'tired', 'red recovery tired');
assert(M.faceExpr(null, 0, { zone: 'green' }, {}) === 'happy', 'green happy');
assert(M.faceExpr(null, 0, { zone: 'yellow' }, {}) === 'neutral', 'yellow neutral');
assert(M.faceExpr('lookAround', 0.5, { zone: 'green' }, {}) === 'happy', 'idle fidget keeps the mood face');

// creature shapes stay sane for every kind × body extreme (the villager builder scales from these)
['m', 'f'].forEach((sex) => M.KINDS.forEach((k) => [{ weight: 50, height: 190, waist: 66 }, { weight: 130, height: 160, waist: 125 }].forEach((v) => {
  const p = M.bodyParams({ sex, kind: k.id, values: v, recoveryPct: 50 });
  const c = M.creatureShape(p);
  ['scale', 'bodyR', 'bellyR', 'headR', 'armR', 'legR', 'armLen', 'legLen'].forEach((f) => assert(isFinite(c[f]) && c[f] > 0, k.id + ' ' + f));
})));

// module wiring + offline cache
const av3 = fs.readFileSync(path.join(rootDir, 'js/avatar3d.js'), 'utf8');
const chibi = fs.readFileSync(path.join(rootDir, 'js/avatar-chibi.js'), 'utf8');
const sw = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
assert(/import \{ buildChibi \} from '\.\/avatar-chibi\.js'/.test(av3), 'avatar3d imports the villager builder');
assert(/try \{ return buildChibi\(/.test(av3), 'classic figure stays as the fallback');
assert(/export function buildChibi/.test(chibi) && /MeshToonMaterial/.test(chibi), 'toon villager builder');
assert(sw.includes("'./js/avatar-chibi.js'"), 'service worker caches the villager module');
assert(!fs.existsSync(path.join(rootDir, 'js/avatar-rig.js')), 'v43 realistic rig removed');

console.log('avatar-chibi: ' + n + ' assertions ok');
