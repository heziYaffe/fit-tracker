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
run('js/planparse.js');
run('js/engine.js');
run('js/demo.js');
run('js/store.js');
const C = ctx.FitConfig;
const E = ctx.FitEngine;
const Store = ctx.FitStore;
function assert(c, m) { if (!c) throw new Error(m); }

assert(C.APP_VERSION === '47', 'version ' + C.APP_VERSION);
assert(E.formatLiters(2000) === '2', '2L got ' + E.formatLiters(2000));
assert(E.formatLiters(1500) === '1.5', '1.5L got ' + E.formatLiters(1500));
assert(E.formatWaterProgress(1500, 3000) === '1.5 / 3 ל׳', E.formatWaterProgress(1500, 3000));
assert(E.formatWaterUnits(750, { ml: 250, label: 'כוס', labelPlural: 'כוסות', labelOne: 'כוס' }) === '3 כוסות', '3 cups');
assert(E.formatWaterUnits(500, { ml: 500, label: 'בקבוק', labelPlural: 'בקבוקים', labelOne: 'בקבוק' }) === '1 בקבוק', '1 bottle');

// migrate old cups
Store.importJSON({
  app: 'fit-tracker',
  data: {
    settings: { dailyWaterTarget: 8, dailyProteinTarget: 150, weeklyWorkoutTarget: 4 },
    nutrition: [
      { date: '2026-11-01', protein: 160, calories: 2000, water: 6 },
      { date: '2026-11-02', protein: 80, water: 0 }
    ]
  }
});
let st = Store.getState();
assert(st.settings.waterInMl === true, 'flag set');
assert(st.settings.dailyWaterTarget === 2000, 'goal 8*250, got ' + st.settings.dailyWaterTarget);
assert(st.settings.waterVessel === 'cup', 'default cup');
assert(st.settings.waterVesselMl === 250, 'cup 250');
const n1 = st.nutrition.find(function (n) { return n.date === '2026-11-01'; });
assert(n1.water === 1500, '6 cups -> 1500, got ' + n1.water);
assert(E.hitsWater(st, '2026-11-01') === false, '1500 < 2000');
assert(E.waterTarget(st) === 2000, 'target ml');

// already migrated must not double
const snap = Store.exportJSON();
Store.importJSON(snap);
st = Store.getState();
assert(st.settings.dailyWaterTarget === 2000, 'no double goal');
assert(st.nutrition.find(function (n) { return n.date === '2026-11-01'; }).water === 1500, 'no double water');

// demo is already in ml
const demo = ctx.FitDemo.generate(new Date('2026-11-14T10:00:00+02:00'));
assert(demo.settings.waterInMl, 'demo flag');
assert(demo.settings.dailyWaterTarget === 2000, 'demo goal');
assert(demo.nutrition.every(function (n) { return !n.water || n.water >= 250 || n.water === 0; }), 'demo water in ml');
assert(demo.nutrition.some(function (n) { return n.water >= 1000; }), 'demo has liter-scale water');

Store.importJSON({ app: 'fit-tracker', data: demo });
st = Store.getState();
assert(st.settings.dailyWaterTarget === 2000, 'demo import goal stays');
const dw = st.nutrition[0].water;
assert(dw === demo.nutrition[0].water, 'demo import not remultiplied ' + dw + ' vs ' + demo.nutrition[0].water);
assert(E.hitsWater(st, st.nutrition.find(function (n) { return n.water >= 2000; }).date), 'xp still hits at ml goal');

console.log('water tests passed');
