// v46 menu: dishes with a title + prep (tap for ingredients), explicit AI
// failure instead of a silent basic menu, dish titles survive save/apply and
// are renamed after a swap.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const mem = {};
const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite, Promise, setTimeout, clearTimeout,
  localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } }
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
['js/config.js', 'js/engine.js', 'js/store.js', 'js/food.js'].forEach(run);
const F = ctx.FitFood, Store = ctx.FitStore;
function assert(c, m) { if (!c) throw new Error(m); }

// rule-based dish titles
assert(F.dishName([{ dbId: 'chicken', role: 'mp' }, { dbId: 'rice', role: 'mc' }, { dbId: 'salad', role: 'veg' }]) === 'חזה עוף עם אורז וסלט ירקות', 'main dish title: ' + F.dishName([{ dbId: 'chicken', role: 'mp' }, { dbId: 'rice', role: 'mc' }, { dbId: 'salad', role: 'veg' }]));
assert(F.dishName([{ dbId: 'cottage', role: 'sp' }, { dbId: 'apple', role: 'fruit' }]) === 'קוטג׳ ותפוח', 'snack title, no "5%"');
assert(F.dishName([{ dbId: 'whey', role: 'sp' }]) === 'שייק חלבון', 'whey reads as a shake');
assert(F.dishName([{ name: 'משהו ידני' }]) === '', 'custom foods → no title (list shown instead)');
const rule = F.buildMenu({ protein: 150, calories: 2200, meals: 4 });
assert(rule.meals.every(m => m.dish && m.dish.length > 3), 'every rule meal has a dish title');

// AI dish/prep kept when untouched, replaced when a food was swapped out or the title names a blocked food
const prefs = { protein: 150, calories: 2200, meals: 3, dislikes: ['tuna'] };
const spec = { meals: [
  { name: 'בוקר', dish: 'שקשוקה עם לחם מלא', prep: 'ביצים ברוטב עגבניות, 10 דקות', foods: [{ dbId: 'egg', grams: 150, role: 'bp' }, { dbId: 'wbread', grams: 60, role: 'bc' }, { dbId: 'tomato', grams: 120, role: 'veg' }] },
  { name: 'צהריים', dish: 'סלט טונה בפיתה', prep: 'מערבבים טונה עם ירקות', foods: [{ dbId: 'tuna', grams: 110, role: 'mp' }, { dbId: 'pita', grams: 80, role: 'bc' }] },
  { name: 'ערב', dish: 'טונה עם סלט', prep: '', foods: [{ dbId: 'omelet', grams: 100, role: 'bp' }, { dbId: 'salad', grams: 150, role: 'veg' }] }
] };
const m = F.menuFromSpec(spec, prefs);
assert(m.meals[0].dish === 'שקשוקה עם לחם מלא' && /עגבניות/.test(m.meals[0].prep), 'AI dish + prep kept');
assert(!/טונה/.test(m.meals[1].dish) && m.meals[1].dish && m.meals[1].prep === '', 'replaced food → rule title, no stale prep: ' + m.meals[1].dish);
assert(!/טונה/.test(m.meals[2].dish), 'a title naming a blocked food is not shown');

// AI failure is marked, not silent
(async function () {
  let menu = await F.buildMenuAsync({ protein: 150, calories: 2200, meals: 3 }, { provider: () => Promise.reject(Object.assign(new Error('Gemini עמוס כרגע.'), { code: 'busy' })) });
  assert(menu.fallback && menu.fallback.code === 'busy' && /עמוס/.test(menu.fallback.reason), 'failure flagged with reason');
  assert(menu.meals.length === 3, 'basic menu still available as an explicit choice');
  menu = await F.buildMenuAsync({ protein: 150, calories: 2200, meals: 3 }, { provider: () => Promise.resolve({ meals: [] }) });
  assert(menu.fallback, 'empty AI reply flagged too');
  menu = await F.buildMenuAsync({ protein: 150, calories: 2200, meals: 3 }, { provider: () => Promise.resolve(spec) });
  assert(!menu.fallback && menu.meals[0].dish === 'שקשוקה עם לחם מלא', 'good reply not flagged');
  menu = await F.buildMenuAsync({ protein: 150, calories: 2200, meals: 3 }, { provider: () => new Promise(() => {}), timeoutMs: 50 });
  assert(menu.fallback && menu.fallback.reason === 'timeout', 'timeout flagged');

  // dish/prep survive save + apply; a swap on the day renames the dish
  const saved = Store.addMenu({ name: 'התפריט שלי', days: [0, 1, 2, 3, 4, 5, 6], meals: m.meals });
  const day = Store.applyMenuToDate(saved.id, '2026-11-24');
  assert(day.meals[0].dish === 'שקשוקה עם לחם מלא' && day.meals[0].prep, 'dish + prep kept on the day');
  const egg = day.meals[0].foods.find(f => f.dbId === 'egg');
  const alt = F.swapOptions(egg, {}, day.meals[0].foods)[0];
  Store.replaceDayMealFood('2026-11-24', day.meals[0].id, egg.id, alt);
  const after = Store.getDayMenu('2026-11-24').meals[0];
  assert(after.dish !== 'שקשוקה עם לחם מלא' && after.dish.length > 3 && after.prep === '', 'swap renames the dish: ' + after.dish);
  console.log('menu-dishes tests passed');
})().catch(e => { console.error(e); process.exit(1); });
