// v48 menu chat: memory card (migration, blocking), build/edit/ask replies,
// changes applied to «התפריט שלי» at once, undo one change / undo all,
// memory ops + undo, failure → retry, fresh menu resets the conversation,
// carbs/fat targets.
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
['js/config.js', 'js/engine.js', 'js/store.js', 'js/food.js', 'js/menu-chat.js'].forEach(run);
const F = ctx.FitFood, Store = ctx.FitStore, MC = ctx.FitMenuChat, E = ctx.FitEngine;
let n = 0;
function assert(c, m) { n++; if (!c) throw new Error(m); }

// targets: carbs/fat derived from calories + protein, settings win
Store.updateSettings({ dailyProteinTarget: 160, dailyCalorieTarget: 2400, dailyCarbTarget: '', dailyFatTarget: '' });
let t = E.nutritionTargets(Store.getState());
assert(t.fat === 70 && t.carbs === Math.round((2400 - 640 - 630) / 4 / 5) * 5 && t.auto.carbs && t.auto.fat, 'derived carbs/fat ' + JSON.stringify(t));
Store.updateSettings({ dailyCarbTarget: 200 });
t = E.nutritionTargets(Store.getState());
assert(t.carbs === 200 && !t.auto.carbs, 'carb setting wins');

// fitPortions with carbs/fat gets the day closer than protein/calories only
const base = F.buildMenu({ protein: 160, calories: 2400, meals: 4 });
const withMacros = F.buildMenu({ protein: 160, calories: 2400, carbs: 150, fat: 110, meals: 4 });
function tot(m) { return m.meals.reduce((a, x) => { x.foods.forEach(f => { a.c += f.carbs; a.f += f.fat; a.p += f.protein; a.k += f.calories; }); return a; }, { c: 0, f: 0, p: 0, k: 0 }); }
const t0 = tot(base), t1 = tot(withMacros);
assert(Math.abs(t1.c - 150) + Math.abs(t1.f - 110) < Math.abs(t0.c - 150) + Math.abs(t0.f - 110) - 30, 'carbs/fat closer: ' + JSON.stringify([t0, t1]));
assert(t1.p >= 145 && Math.abs(t1.k - 2400) < 250, 'protein/calories still hit: ' + JSON.stringify(t1));

// memory: migrated from the wizard prefs, not written until changed
Store.updateSettings({ menuPrefs: { goal: 'cut', meals: 3, excludes: ['nodairy'], dislikes: ['tuna'], dislikeTerms: ['קוטג׳'] } });
let memList = MC.memory();
assert(memList.some(m => m.cat === 'avoid' && m.text === 'מוצרי חלב' && m.excl === 'nodairy'), 'exclude chip migrated');
assert(memList.some(m => m.cat === 'avoid' && m.dbId === 'tuna'), 'dislike migrated');
assert(memList.some(m => m.text === '3 ארוחות ביום') && memList.some(m => m.cat === 'goal' && m.text === 'חיטוב'), 'meals + goal migrated');
let blocked = F.blockedIds(MC.prefs());
assert(blocked.tuna && blocked.tunaoil && blocked.cottage && blocked.yogurt, 'memory blocks foods + dairy: ' + Object.keys(blocked).length);
// start clean for the chat
Store.updateSettings({ menuMemory: [] });
assert(MC.memory().length === 0, 'explicit empty memory is kept');
MC.addMemory('avoid', 'טונה');
assert(F.blockedIds(MC.prefs()).tuna, 'manual "לא אוכל טונה" blocks tuna');
assert(MC.addMemory('avoid', 'טונה') === null, 'no duplicates');

// a scripted model
const calls = [];
let script = [];
MC.setProvider(function (body) { calls.push(body); const s = script.shift(); return typeof s === 'function' ? s(body) : s; });
const day1 = [
  { name: 'בוקר', time: '08:00', dish: 'שקשוקה עם לחם מלא', prep: 'ביצים ברוטב עגבניות', foods: [{ dbId: 'egg', grams: 150, role: 'bp' }, { dbId: 'wbread', grams: 60, role: 'bc' }, { dbId: 'tomato', grams: 120, role: 'veg' }] },
  { name: 'צהריים', time: '13:00', dish: 'עוף עם אורז וסלט', prep: 'עוף בתנור', foods: [{ dbId: 'chicken', grams: 180, role: 'mp' }, { dbId: 'rice', grams: 200, role: 'mc' }, { dbId: 'salad', grams: 150, role: 'veg' }] },
  { name: 'ביניים', time: '16:30', dish: 'יוגורט עם תפוח', prep: '', foods: [{ dbId: 'yogurt', grams: 200, role: 'sp' }, { dbId: 'apple', grams: 150, role: 'fruit' }] },
  { name: 'ערב', time: '20:00', dish: 'חביתה עם פיתה', prep: 'חביתה במחבת', foods: [{ dbId: 'omelet', grams: 120, role: 'bp' }, { dbId: 'pita', grams: 80, role: 'bc' }, { dbId: 'salad', grams: 150, role: 'veg' }] }
];

(async function () {
  // ask first: no menu change
  script.push({ reply: 'כמה ארוחות ביום נוח לך?', action: 'ask', meals: [], memory: { add: [], remove: [] } });
  let msg = await MC.send('תבנה לי תפריט');
  assert(msg.ask && !MC.currentMeals(), 'a question changes nothing');
  const b0 = calls[0];
  assert(b0.current === null && b0.memory.length === 1 && b0.targets.carbs === 200 && b0.messages.length === 1, 'body: memory, targets, no menu');
  assert(!b0.catalog.some(c => c.id === 'tuna') && b0.blocked.indexOf('tuna') >= 0, 'tuna never offered');
  assert(!JSON.stringify(b0).match(/Hazi|displayName|weight/), 'nothing identifying in the body');

  // build (+ a memory item from the words)
  script.push({ reply: 'בניתי תפריט של 4 ארוחות.', action: 'build', meals: day1, memory: { add: [{ cat: 'habit', text: 'אין זמן לבשל בבוקר' }], remove: [] } });
  msg = await MC.send('4 ארוחות, ואין לי זמן לבשל בבוקר');
  assert(calls[1].messages.length === 3, 'conversation sent');
  let cur = MC.currentMeals();
  assert(cur && cur.length === 4 && msg.change && msg.today, 'menu built, saved and applied today');
  const saved = MC.savedMenu();
  assert(saved.name === 'התפריט שלי' && saved.days.length === 7 && saved.applyOn === '', 'one menu, all week');
  assert(Store.getDayMenu(E.todayISO()).meals.length === 4, 'today follows');
  assert(cur[1].dish === 'עוף עם אורז וסלט', 'dish kept');
  assert(msg.mem && msg.mem[0].op === 'add' && MC.memory().some(m => m.text === 'אין זמן לבשל בבוקר'), 'memory auto-added');
  const built = JSON.parse(JSON.stringify(cur));

  // edit dinner only: other meals keep their exact grams
  const dinnerEdit = JSON.parse(JSON.stringify(calls[1].current || [])); // null (no menu then)
  script.push(function (body) {
    assert(body.current && body.current.length === 4, 'current menu sent');
    const meals = JSON.parse(JSON.stringify(body.current));
    meals[3] = { name: 'ערב', time: '20:00', dish: 'סלט קוטג׳', prep: 'קוצצים ירקות', foods: [{ dbId: 'cottage', grams: 250, role: 'bp' }, { dbId: 'salad', grams: 200, role: 'veg' }] };
    return { reply: 'ערב קל יותר.', action: 'edit', meals: meals, memory: { add: [], remove: [] } };
  });
  msg = await MC.send('ערב קל יותר');
  cur = MC.currentMeals();
  const ch = MC.change(msg.change);
  assert(ch && ch.idx.length === 1 && ch.idx[0] === 3, 'only dinner changed: ' + JSON.stringify(ch && ch.idx));
  [0, 1, 2].forEach(i => assert(MC.sameMeal(cur[i], built[i]), 'meal ' + i + ' untouched'));
  assert(cur[3].foods.some(f => f.dbId === 'cottage'), 'dinner edited');
  let hl = MC.highlights();
  assert(hl[3] === 'fresh' && hl[0] === 'touched', 'changed meal highlighted: ' + JSON.stringify(hl));

  // memory "לא אוכל קוטג׳" in the same reply as a menu using it → enforced in code
  script.push(function (body) {
    return { reply: 'בלי קוטג׳ מעכשיו.', action: 'edit', meals: body.current, memory: { add: [{ cat: 'avoid', text: 'קוטג׳' }], remove: [] } };
  });
  msg = await MC.send('אני לא אוכל קוטג׳');
  cur = MC.currentMeals();
  assert(!cur.some(m => m.foods.some(f => f.dbId === 'cottage')), 'blocked food replaced in code even though the model kept it');
  assert(msg.change && MC.change(msg.change).idx.indexOf(3) >= 0, 'that is a recorded change');

  // undo the memory op → item gone, menu stays (undo the change separately)
  assert(MC.undoMemory(msg.id) && !MC.memory().some(m => m.text === 'קוטג׳'), 'memory undo');
  // undo the specific change → dinner back to the cottage version
  let u = MC.undoChange(msg.change);
  assert(u.ok && MC.currentMeals()[3].foods.some(f => f.dbId === 'cottage'), 'undo one change');
  // undo all → the first built menu? no: base is "no menu" → menu removed
  assert(MC.canUndoAll(), 'undo-all offered');
  MC.undoAll();
  assert(!MC.currentMeals(), 'undo all → back to before the chat (no menu)');

  // failure: error message with retry, nothing changes; retry works
  script.push(Promise.reject(Object.assign(new Error('Gemini עמוס כרגע.'), { code: 'busy' })));
  msg = await MC.send('תבנה לי תפריט');
  assert(msg.error && msg.retry === 'תבנה לי תפריט' && !MC.currentMeals(), 'failure is shown, not hidden');
  script.push({ reply: 'הנה.', action: 'build', meals: day1, memory: { add: [], remove: [] } });
  msg = await MC.retry(msg.id);
  assert(msg && msg.change && MC.currentMeals().length === 4, 'retry builds');
  assert(!MC.messages().some(m => m.error), 'error bubble removed on retry');

  // a fresh menu resets the conversation, memory stays, undo-all → menu before it
  const beforeFresh = JSON.parse(JSON.stringify(MC.currentMeals()));
  const memCount = MC.memory().length;
  script.push(function (body) {
    assert(body.current === null && body.messages.length === 1, 'fresh: no old menu / conversation');
    const m = JSON.parse(JSON.stringify(day1.slice(0, 3)));
    m[2] = day1[3];
    return { reply: 'תפריט חדש.', action: 'build', meals: m, memory: { add: [], remove: [] } };
  });
  msg = await MC.send('תפריט חדש מאפס', { fresh: true });
  assert(MC.messages().length === 2 && MC.memory().length === memCount, 'conversation reset, memory kept');
  assert(MC.currentMeals().length === 3, 'new menu');
  MC.undoAll();
  assert(MC.currentMeals().length === 4 && MC.sameMeal(MC.currentMeals()[0], beforeFresh[0]), 'undo all restores the previous menu');

  // eaten today → the saved menu changes, today does not
  Store.setMealStatus(E.todayISO(), Store.getDayMenu(E.todayISO()).meals[0].id, 'eaten');
  script.push(function (body) {
    const meals = JSON.parse(JSON.stringify(body.current));
    meals[1].foods[0] = { dbId: 'thigh', grams: 180, role: 'mp' };
    meals[1].dish = 'פרגית עם אורז וסלט';
    return { reply: 'פרגית בצהריים.', action: 'edit', meals: meals, memory: { add: [], remove: [] } };
  });
  msg = await MC.send('פרגית בצהריים');
  assert(msg.change && msg.today === false, 'today kept once a meal was eaten');
  assert(Store.getDayMenu(E.todayISO()).meals[1].foods[0].dbId === 'chicken' && MC.currentMeals()[1].foods[0].dbId === 'thigh', 'saved menu changed, today not');

  // memory remove op
  script.push({ reply: 'עדכנתי.', action: 'none', meals: [], memory: { add: [], remove: ['אין זמן לבשל בבוקר'] } });
  msg = await MC.send('דווקא יש לי זמן בבוקר');
  assert(msg.mem && msg.mem[0].op === 'remove' && !MC.memory().some(m => m.text === 'אין זמן לבשל בבוקר'), 'memory remove op');
  MC.undoMemory(msg.id);
  assert(MC.memory().some(m => m.text === 'אין זמן לבשל בבוקר'), 'remove undone');

  // basic menu (AI down), and the manual memory editor
  MC.undoAll();
  const bm = MC.applyBasic();
  assert(bm.change && MC.currentMeals().length >= 3, 'basic menu on request');
  const it = MC.memory().find(m => m.text === 'טונה');
  MC.updateMemory(it.id, { text: 'טונה וסלמון' });
  assert(F.blockedIds(MC.prefs()).salmon && F.blockedIds(MC.prefs()).tuna, 'edited item blocks both');
  MC.removeMemory(it.id);
  assert(!F.blockedIds(MC.prefs()).tuna, 'deleted item unblocks');
  console.log('menu-chat tests passed (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
