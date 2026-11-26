// v48/v49 menu chat: free-text memory (migration, line ops, undo), streamed
// reply text, smart suggestions, build/edit/ask replies, changes applied to
// «התפריט שלי» at once, undo one change / undo all, failure → retry, fresh
// menu resets the conversation, carbs/fat targets. No code-level blocking.
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

// memory: migrated from the wizard prefs as text lines, not written until changed
Store.updateSettings({ menuPrefs: { goal: 'cut', meals: 3, excludes: ['nodairy'], dislikes: ['tuna'], dislikeTerms: ['קוטג׳'] } });
let memText = MC.memoryText();
assert(/^לא אוכל מוצרי חלב$/m.test(memText) && /^לא אוכל טונה/m.test(memText) && /^לא אוכל קוטג׳$/m.test(memText), 'prefs migrated to lines: ' + memText);
assert(/^3 ארוחות ביום$/m.test(memText) && /^מטרה: חיטוב$/m.test(memText), 'meals + goal migrated');
assert(Store.getState().settings.menuMemoryText === undefined, 'migration is lazy');
// v48 memory items win over the old prefs
Store.updateSettings({ menuMemory: [{ id: 'a', cat: 'avoid', text: 'טונה' }, { id: 'b', cat: 'habit', text: 'אין זמן לבשל בבוקר' }, { id: 'c', cat: 'like', text: 'אוכל חריף' }, { id: 'd', cat: 'goal', text: 'חיטוב' }, { id: 'e', cat: 'avoid', text: 'בלי גלוטן' }] });
assert(MC.memoryText() === 'לא אוכל טונה\nאין זמן לבשל בבוקר\nאוהב אוכל חריף\nמטרה: חיטוב\nבלי גלוטן', 'v48 items → lines: ' + MC.memoryText());
// no blocking any more: the whole menu catalog is offered
const pre = MC.prefs();
assert(!pre.dislikes.length && !pre.excludes.length && !Object.keys(F.blockedIds(pre)).length, 'nothing blocked in code');
// start clean for the chat; free text is kept as written (trimmed)
MC.setMemoryText('');
assert(MC.memoryText() === '' && MC.memory().length === 0, 'explicit empty memory is kept');
MC.setMemoryText('  לא אוכל טונה  \r\n\n\n\nמתאמן ב-18:00   ');
assert(MC.memoryText() === 'לא אוכל טונה\n\nמתאמן ב-18:00' && MC.memory().length === 2, 'text normalised: ' + JSON.stringify(MC.memoryText()));
assert(MC.setMemoryText('x'.repeat(5000)).length === MC.MEM_MAX, 'length capped');
MC.setMemoryText('לא אוכל טונה');
// line ops
let ops = MC.applyMemoryOps(['לא אוכל טונה', ' אוהב  חריף '], []);
assert(ops.length === 1 && ops[0].text === 'אוהב חריף' && MC.memoryText() === 'לא אוכל טונה\nאוהב חריף', 'add skips duplicates');
ops = MC.applyMemoryOps([], ['חריף', 'לא קיים']);
assert(ops.length === 1 && ops[0].text === 'אוהב חריף' && MC.memoryText() === 'לא אוכל טונה', 'remove by containment, unknown ignored');

// the streamed reply parser
const P = MC.partialReply;
const fullJson = JSON.stringify({ reply: 'שלום "עולם"\nשורה \\ ✓', action: 'none' });
let prev = '', grows = true;
for (let i = 0; i <= fullJson.length; i++) { const r = P(fullJson.slice(0, i)); if (r.indexOf(prev) !== 0) grows = false; prev = r; }
assert(grows && prev === 'שלום "עולם"\nשורה \\ ✓', 'partial reply only grows and ends exact: ' + prev);
assert(P('{"reply":"a\\u05') === 'a' && P('{"reply":"a\\u05d0b') === 'aאb' && P('{"reply": "ab\\') === 'ab' && P('{"act') === '', 'incomplete escapes wait');
assert(P('{"action":"none","reply":"x"}') === 'x', 'reply found anywhere');

// a scripted model
const calls = [];
let script = [];
MC.setProvider(function (body, hooks) {
  calls.push(body);
  const s = script.shift();
  const r = typeof s === 'function' ? s(body) : s;
  // stream the reply like the server does: reply first, in small pieces
  if (hooks && r && !r.then && r.reply) {
    const json = JSON.stringify({ reply: r.reply, action: r.action });
    for (let i = 3; i < json.length; i += 4) hooks.onText(json.slice(i - 3, i + 1));
  }
  return r;
});
const streamed = [];
MC.onStream(t => streamed.push(t));
const day1 = [
  { name: 'בוקר', time: '08:00', dish: 'שקשוקה עם לחם מלא', prep: 'ביצים ברוטב עגבניות', foods: [{ dbId: 'egg', grams: 150, role: 'bp' }, { dbId: 'wbread', grams: 60, role: 'bc' }, { dbId: 'tomato', grams: 120, role: 'veg' }] },
  { name: 'צהריים', time: '13:00', dish: 'עוף עם אורז וסלט', prep: 'עוף בתנור', foods: [{ dbId: 'chicken', grams: 180, role: 'mp' }, { dbId: 'rice', grams: 200, role: 'mc' }, { dbId: 'salad', grams: 150, role: 'veg' }] },
  { name: 'ביניים', time: '16:30', dish: 'יוגורט עם תפוח', prep: '', foods: [{ dbId: 'proyogurt', grams: 200, role: 'sp' }, { dbId: 'apple', grams: 150, role: 'fruit' }] },
  { name: 'ערב', time: '20:00', dish: 'חביתה עם פיתה', prep: 'חביתה במחבת', foods: [{ dbId: 'omelet', grams: 120, role: 'bp' }, { dbId: 'pita', grams: 80, role: 'bc' }, { dbId: 'salad', grams: 150, role: 'veg' }] }
];

(async function () {
  // ask first: no menu change
  script.push({ reply: 'כמה ארוחות ביום נוח לך?', action: 'ask', meals: [], memory: { add: [], remove: [] } });
  let msg = await MC.send('תבנה לי תפריט');
  assert(msg.ask && !MC.currentMeals(), 'a question changes nothing');
  const b0 = calls[0];
  assert(b0.current === null && b0.memory === 'לא אוכל טונה' && b0.targets.carbs === 200 && b0.messages.length === 1, 'body: memory text, targets, no menu');
  assert(b0.catalog.some(c => c.id === 'tuna') && b0.blocked === undefined, 'no code blocking: the model reads the memory');
  assert(streamed.length > 3 && streamed[streamed.length - 1] === 'כמה ארוחות ביום נוח לך?' && streamed.every((x, i) => i === 0 || x.indexOf(streamed[i - 1]) === 0), 'reply streamed word by word');
  assert(MC.streamText() === '' && !MC.isBusy(), 'stream cleared when done');
  assert(MC.chips()[0] === 'תבנה לי תפריט', 'static chips before suggestions');
  assert(!JSON.stringify(b0).match(/Hazi|displayName|weight/), 'nothing identifying in the body');

  // build (+ a memory item from the words)
  script.push({ reply: 'בניתי תפריט של 4 ארוחות.', action: 'build', suggestions: ['ערב קל יותר', ' ', 'עוד חלבון בבוקר', 'בלי אורז', 'רביעי'], meals: day1, memory: { add: ['אין זמן לבשל בבוקר'], remove: [] } });
  msg = await MC.send('4 ארוחות, ואין לי זמן לבשל בבוקר');
  assert(calls[1].messages.length === 3, 'conversation sent');
  let cur = MC.currentMeals();
  assert(cur && cur.length === 4 && msg.change && msg.today, 'menu built, saved and applied today');
  const saved = MC.savedMenu();
  assert(saved.name === 'התפריט שלי' && saved.days.length === 7 && saved.applyOn === '', 'one menu, all week');
  assert(Store.getDayMenu(E.todayISO()).meals.length === 4, 'today follows');
  assert(cur[1].dish === 'עוף עם אורז וסלט', 'dish kept');
  assert(msg.mem && msg.mem[0].op === 'add' && MC.memoryText() === 'לא אוכל טונה\nאין זמן לבשל בבוקר', 'memory line auto-added');
  assert(MC.chips().join('|') === 'ערב קל יותר|עוד חלבון בבוקר|בלי אורז', 'model suggestions become the chips');
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

  // memory line + a menu edit in one reply; undo each on its own
  script.push(function (body) {
    const meals = JSON.parse(JSON.stringify(body.current));
    meals[3] = { name: 'ערב', time: '20:00', dish: 'חביתה וסלט', prep: '', foods: [{ dbId: 'omelet', grams: 150, role: 'bp' }, { dbId: 'salad', grams: 200, role: 'veg' }] };
    return { reply: 'בלי קוטג׳ מעכשיו.', action: 'edit', meals: meals, memory: { add: ['לא אוכל קוטג׳'], remove: [] } };
  });
  msg = await MC.send('אני לא אוכל קוטג׳');
  cur = MC.currentMeals();
  assert(!cur[3].foods.some(f => f.dbId === 'cottage') && /^לא אוכל קוטג׳$/m.test(MC.memoryText()), 'model swapped dinner + noted it');
  assert(msg.change && MC.change(msg.change).idx.join() === '3', 'that is a recorded change ' + JSON.stringify(MC.change(msg.change).idx));
  assert(MC.chips()[0] === 'ערב קל יותר', 'no suggestions in this reply → static chips again');
  // undo the memory op → line gone, menu stays (undo the change separately)
  assert(MC.undoMemory(msg.id) && !/קוטג/.test(MC.memoryText()) && !MC.undoMemory(msg.id), 'memory undo (once)');
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
  const memBefore = MC.memoryText();
  script.push(function (body) {
    assert(body.current === null && body.messages.length === 1, 'fresh: no old menu / conversation');
    const m = JSON.parse(JSON.stringify(day1.slice(0, 3)));
    m[2] = day1[3];
    return { reply: 'תפריט חדש.', action: 'build', meals: m, memory: { add: [], remove: [] } };
  });
  msg = await MC.send('תפריט חדש מאפס', { fresh: true });
  assert(MC.messages().length === 2 && MC.memoryText() === memBefore, 'conversation reset, memory kept');
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
  assert(msg.mem && msg.mem[0].op === 'remove' && MC.memoryText() === 'לא אוכל טונה', 'memory remove op');
  MC.undoMemory(msg.id);
  assert(MC.memoryText() === 'לא אוכל טונה\nאין זמן לבשל בבוקר', 'remove undone');
  // a v48 chat message (memory ops with items) still undoes
  MC.messages().push({ id: 'old1', role: 'model', text: 'x', mem: [{ op: 'add', item: { id: 'q', cat: 'avoid', text: 'אין זמן לבשל בבוקר' } }] });
  assert(MC.undoMemory('old1') && MC.memoryText() === 'לא אוכל טונה', 'v48 memory op undo');

  // a reset mid-stream (fallback model) starts the bubble over
  MC.setProvider(function (body, hooks) {
    hooks.onText('{"reply":"ראשון');
    hooks.onReset();
    hooks.onText('{"reply":"שני", "action":"none"}');
    return { reply: 'שני', action: 'none', meals: [], memory: { add: [], remove: [] } };
  });
  streamed.length = 0;
  await MC.send('בדיקה');
  assert(streamed.join('|') === 'ראשון||שני', 'reset clears the streamed text: ' + streamed.join('|'));

  // basic menu (AI down), and the manual memory editor
  MC.undoAll();
  const bm = MC.applyBasic();
  assert(bm.change && MC.currentMeals().length >= 3, 'basic menu on request');
  console.log('menu-chat tests passed (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
