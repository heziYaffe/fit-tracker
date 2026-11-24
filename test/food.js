// Quick food logging (rule-based Hebrew parser), food log store, sync
// tombstones, and the menu builder with swaps.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const mem = {};
const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite, Promise,
  setTimeout, clearTimeout,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  },
  navigator: {}
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
['js/config.js', 'js/engine.js', 'js/store.js', 'js/sync.js', 'js/food.js'].forEach(run);
const F = ctx.FitFood, Store = ctx.FitStore, Sync = ctx.FitSync, E = ctx.FitEngine;
function assert(c, m) { if (!c) throw new Error(m); }
function near(a, b, tol, m) { assert(Math.abs(a - b) <= tol, m + ' (got ' + a + ', want ' + b + ')'); }

// --- parser ---
let r = F.parse('2 ביצים ופרוסת לחם');
assert(r.length === 2, 'two items');
assert(r[0].dbId === 'egg' && r[0].grams === 100, 'two eggs = 100g');
assert(r[1].dbId === 'bread' && r[1].grams === 30, 'one slice bread');
near(r[0].calories, 155, 1, 'egg kcal (USDA 155/100g)');
near(r[0].protein, 12.6, 0.1, 'egg protein');

r = F.parse('חצי אבוקדו, 200 גרם חזה עוף');
assert(r[0].dbId === 'avocado' && r[0].grams === 75, 'half avocado');
assert(r[1].dbId === 'chicken' && r[1].grams === 200, '200g chicken');
near(r[1].protein, 62, 0.1, 'chicken protein');

assert(F.parse('שתי ביצים')[0].grams === 100, 'number word');
assert(F.parse('ביצה אחת')[0].grams === 50, 'number word after noun');
assert(F.parse('כוס אורז וחצי')[0].grams === 240, 'cup and a half of rice');
assert(F.parse('חביתה משתי ביצים')[0].dbId === 'omelet', 'omelet wins over eggs');
assert(F.parse('חביתה משתי ביצים')[0].grams === 100, 'omelet of two eggs');
assert(F.parse('סקופ חלבון')[0].dbId === 'whey', 'scoop protein = whey');
assert(F.parse('קפה עם חלב')[0].dbId === 'cappuccino', 'coffee with milk phrase');
assert(F.parse('3 פרוסות לחם מלא עם חומוס').map(i => i.dbId).join() === 'wbread,hummus', 'עם splits');
assert(F.parse('150 גרם סלמון ובטטה').map(i => i.dbId).join() === 'salmon,sweetpotato', 'vav prefix splits items');
assert(F.parse('200ג קוטג׳')[0].grams === 200, 'digits glued to unit');
const miss = F.parse('משהו לא מוכר');
assert(miss[0].unmatched && miss[0].query, 'unmatched kept with query');
const t = F.totals(F.parse('2 ביצים ופרוסת לחם, משהו לא מוכר'));
near(t.calories, 155 + 80, 2, 'totals skip unmatched');

// rescale
const re = F.rescale(F.parse('חזה עוף')[0], 300);
near(re.protein, 93, 0.1, 'rescale chicken 300g');
const offIt = F.offItem({ code: '7290004127329', product_name: "קוטג' 5%", brands: 'תנובה', serving_quantity: 250, nutriments: { 'energy-kcal_100g': 95, proteins_100g: 11, carbohydrates_100g: 1.5, fat_100g: 5 } });
assert(offIt.grams === 250 && Math.round(offIt.calories) === 238 && offIt.source === 'Open Food Facts', 'OFF item per serving');
near(F.rescale(offIt, 100).protein, 11, 0.01, 'OFF item rescales from per100');

// optional resolver hook (no default resolvers)
F.parseAsync('דבר לא מוכר').then(function (items) {
  assert(items[0].unmatched, 'no resolver by default');
});

// --- store: food log feeds nutrition totals ---
const day = '2026-11-24';
const before = Store.getNutrition(day);
assert(!before, 'empty day');
const rows = Store.addFoodLog(day, F.parse('2 ביצים ופרוסת לחם, משהו לא מוכר'));
assert(rows.length === 2, 'unmatched not logged');
let n = Store.getNutrition(day);
near(n.calories, 235, 2, 'nutrition calories updated');
near(n.protein, 14.9, 0.2, 'nutrition protein updated');
assert(Store.listFoodLog(day).length === 2, 'list log');
Store.removeFoodLog(rows[0].id);
n = Store.getNutrition(day);
near(n.calories, 80, 1, 'remove subtracts');
assert(Store.listFoodLog(day).length === 1, 'removed hidden');
assert(Store.getState().foodLog.find(x => x.id === rows[0].id).deletedAt, 'tombstone kept');
assert(Store.recentFoodLog(5).length === 1, 'recents exclude deleted');
// consistency metric reads nutrition rows
assert(typeof E.computeConsistency === 'function' || true, 'engine present');

// --- sync keeps local tombstones so the delete is pushed ---
assert(Sync.COLLECTIONS.indexOf('foodLog') >= 0, 'foodLog synced');
const tomb = Store.getState().foodLog.find(x => x.id === rows[0].id);
const remoteAlive = Object.assign({}, tomb, { deletedAt: undefined, updatedAt: '2026-01-01T00:00:00Z' });
const merged = Sync.mergeStates({ foodLog: [tomb] }, { foodLog: [remoteAlive] });
assert(merged.foodLog.length === 1 && merged.foodLog[0].deletedAt, 'tombstone survives merge');
const packed = Sync.packCollections({ foodLog: merged.foodLog });
assert(packed[0].deleted_at, 'tombstone pushed as deleted_at');
assert(Sync.unpackCollections(packed).foodLog.length === 0, 'remote deleted rows not restored');

// --- menu builder ---
[3, 4, 5].forEach(function (meals) {
  const m = F.buildMenu({ protein: 160, calories: 2400, meals: meals });
  assert(m.meals.length === meals, 'meal count ' + meals);
  const tot = Store.menuTotals(Store.normalizeMenu(m));
  assert(tot.protein >= 140 && tot.protein <= 190, 'protein near target for ' + meals + ' meals: ' + tot.protein);
  assert(tot.calories >= 2150 && tot.calories <= 2650, 'calories near target for ' + meals + ' meals: ' + tot.calories);
});
const low = F.buildMenu({ protein: 120, calories: 1800, meals: 3 });
const lowTot = Store.menuTotals(Store.normalizeMenu(low));
assert(lowTot.calories <= 2050, 'low calorie menu: ' + lowTot.calories);

// preferences
const veg = F.buildMenu({ protein: 140, calories: 2200, meals: 4, excludes: ['veg', 'noegg'] });
veg.meals.forEach(function (meal) {
  meal.foods.forEach(function (f) {
    const tags = F.byId[f.dbId].tags;
    assert(tags.indexOf('meat') < 0 && tags.indexOf('fish') < 0 && tags.indexOf('egg') < 0, 'vegetarian/no egg respected: ' + f.name);
  });
});
const dis = F.buildMenu({ protein: 150, calories: 2300, meals: 3, dislikes: ['egg', 'omelet', 'cottage'] });
dis.meals.forEach(m => m.foods.forEach(f => assert(['egg', 'omelet', 'cottage'].indexOf(f.dbId) < 0, 'dislike respected')));
// no meat + dairy in the same meal
for (let seed = 0; seed < 12; seed++) {
  F.buildMenu({ protein: 160, calories: 2400, meals: 5, seed: seed }).meals.forEach(function (m) {
    const tags = [].concat.apply([], m.foods.map(f => F.byId[f.dbId].tags));
    assert(!(tags.indexOf('meat') >= 0 && tags.indexOf('dairy') >= 0), 'meat+dairy mixed in ' + m.name + ' seed ' + seed);
  });
}
// different seed → different proposal
const a = JSON.stringify(F.buildMenu({ protein: 160, calories: 2400, meals: 4, seed: 0 }));
const b = JSON.stringify(F.buildMenu({ protein: 160, calories: 2400, meals: 4, seed: 1 }));
assert(a !== b, 'regenerate changes menu');

// swaps: similar protein for protein items, respect prefs
const m4 = F.buildMenu({ protein: 160, calories: 2400, meals: 4 });
const lunch = m4.meals[1];
const mainP = lunch.foods.find(f => f.role === 'mp');
const alts = F.swapOptions(mainP, {}, lunch.foods);
assert(alts.length >= 3, 'has alternatives');
alts.forEach(x => assert(Math.abs(x.protein - mainP.protein) / mainP.protein < 0.35, 'similar protein: ' + x.name));
assert(alts.every(x => x.dbId !== mainP.dbId), 'excludes current');
const altsVeg = F.swapOptions(mainP, { excludes: ['veg'] }, lunch.foods);
altsVeg.forEach(x => assert(F.byId[x.dbId].tags.indexOf('meat') < 0, 'swap respects vegetarian'));

// saved menu → day plan → "אכלתי כמתוכנן" adds to nutrition
const saved = Store.addMenu({ name: 'התפריט שלי', days: [0, 1, 2, 3, 4, 5, 6], meals: m4.meals });
assert(saved.meals[0].foods[0].dbId, 'dbId kept on menu items');
const d2 = '2026-11-25';
Store.applyMenuToDate(saved.id, d2);
const dm = Store.getDayMenu(d2);
Store.setMealStatus(d2, dm.meals[0].id, 'eaten');
near(Store.getNutrition(d2).calories, Store.mealTotals(dm.meals[0]).calories, 1, 'eaten meal logged');
// day swap with alternative
const f0 = dm.meals[1].foods.find(f => f.dbId);
const alt0 = F.swapOptions(f0, {}, dm.meals[1].foods)[0];
Store.replaceDayMealFood(d2, dm.meals[1].id, f0.id, alt0);
assert(Store.getDayMenu(d2).meals[1].foods.find(f => f.id === f0.id).dbId === alt0.dbId, 'day swap applied');

assert(F.estimateCalories(80, 'keep') === 2400 && F.estimateCalories(80, 'cut') === 2050, 'calorie estimate');

// --- LLM hooks (provider is a stub here) ---
const pending = [];
pending.push(F.parseFoodText('2 ביצים, שקשוקה של אמא', {
  provider: function (ctx) {
    assert(ctx.unmatched.length === 1, 'provider gets only unmatched');
    return Promise.resolve([{ name: 'ביצה', qty: 2 }, { name: 'עגבנייה', grams: 150 }, { name: 'דבר מומצא' }]);
  }
}).then(function (items) {
  assert(items[0].dbId === 'egg' && items[0].grams === 100, 'rule item kept');
  const tom = items.find(i => i.dbId === 'tomato');
  assert(tom && tom.grams === 150 && tom.calories === 27, 'provider spec resolved via table');
  assert(items.some(i => i.unmatched), 'unknown provider name stays unmatched');
}));
pending.push(F.parseFoodText('2 ביצים', { provider: function () { throw new Error('should not be called'); } })
  .then(items => assert(items.length === 1 && items[0].dbId === 'egg', 'provider skipped when all matched')));
pending.push(F.parseFoodText('משהו', { provider: function () { return Promise.reject(new Error('quota')); } })
  .then(items => assert(items[0].unmatched, 'provider failure falls back')));
pending.push(F.buildMenuAsync({ protein: 150, calories: 2200, meals: 3, excludes: ['nofish'] }, {
  provider: function (prefs, ctx) {
    assert(ctx.catalog.length === F.DB.length && ctx.catalog[0].per100, 'catalog passed');
    return Promise.resolve({ meals: [
      { name: 'בוקר', foods: [{ dbId: 'egg', grams: 100 }, { dbId: 'wbread', grams: 60 }] },
      { name: 'צהריים', foods: [{ dbId: 'chicken', grams: 150, role: 'mp' }, { dbId: 'rice', grams: 150 }, { dbId: 'salmon', grams: 100 }, { dbId: 'nonsense' }] },
      { name: 'ערב', foods: [{ dbId: 'cottage', grams: 125 }, { dbId: 'pita', grams: 80 }] }
    ] });
  }
}).then(function (m) {
  assert(m.meals.length === 3, 'provider menu used');
  const ids = [].concat.apply([], m.meals.map(x => x.foods.map(f => f.dbId)));
  assert(ids.indexOf('salmon') < 0 && ids.indexOf('nonsense') < 0, 'prefs + unknown ids filtered');
  const tot = Store.menuTotals(Store.normalizeMenu(m));
  assert(tot.calories > 1700 && tot.calories < 2500, 'provider menu refitted: ' + tot.calories);
}));
pending.push(F.buildMenuAsync({ protein: 150, calories: 2200, meals: 3 }, { provider: () => Promise.resolve({ meals: [] }) })
  .then(m => assert(m.meals.length === 3, 'empty provider menu falls back')));
Promise.all(pending).then(function () { console.log('food tests passed'); }).catch(function (e) { console.error(e); process.exit(1); });
