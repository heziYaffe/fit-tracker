// AI client (js/ai.js): providers plug into FitFood hooks, every failure falls
// back to rules, plan → templates with engine loads, usage readout.
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
ctx.document = { addEventListener: function () {}, visibilityState: 'visible', getElementById: function () { return null; } };
function run(f) { vm.runInNewContext(fs.readFileSync(path.join(rootDir, f), 'utf8'), ctx, { filename: f }); }
['js/config.js', 'js/cloud-config.js', 'js/engine.js', 'js/store.js', 'js/sync.js', 'js/food.js', 'js/ai.js'].forEach(run);
const F = ctx.FitFood, Store = ctx.FitStore, AI = ctx.FitAI;
function assert(c, m) { if (!c) throw new Error(m); }

// Fake signed-in sync with a scripted server.
let signedIn = false;
let calls = [];
let reply = null;
ctx.FitSync.status = function () { return { configured: true, signedIn: signedIn }; };
ctx.FitSync.authedFetch = function (url, opts) {
  calls.push({ url: url, body: opts.body ? JSON.parse(opts.body) : null });
  const r = typeof reply === 'function' ? reply(url) : reply;
  if (r === 'network') return Promise.reject(new Error('offline'));
  return Promise.resolve({ ok: r.status === 200, status: r.status, json: function () { return Promise.resolve(r.body); } });
};
const toasts = [];
ctx.FitUI = { toast: function (m) { toasts.push(m); } };

(async function () {
  assert(F.hasTextProvider() && F.hasMenuProvider(), 'providers installed');

  // signed out: no server call, rules only
  let items = await F.parseFoodText('2 ביצים וגלידת שוקולד מוזרה');
  assert(calls.length === 0, 'no call when signed out');
  assert(items.some(function (i) { return i.dbId === 'egg'; }), 'rules still work');

  signedIn = true;
  assert(AI.available(), 'available when signed in');

  // fully matched text → no AI call (cheap)
  items = await F.parseFoodText('2 ביצים ופרוסת לחם');
  assert(calls.length === 0, 'no AI call when rules matched everything');

  // unmatched → AI specs resolved against the table (numbers from the table)
  reply = { status: 200, body: { items: [{ name: 'לחם מלא', qty: 2, unit: 'פרוסה', grams: 0 }], month_usd: 0.0012, cap_usd: 10 } };
  items = await F.parseFoodText('שני פרוסות מחיטה מלאה עם קצת קוטג');
  assert(calls.length === 1 && /\/functions\/v1\/llm\/food$/.test(calls[0].url), 'called /food');
  assert(calls[0].body.names.length === F.DB.length, 'sends the table names, nothing personal');
  assert(calls[0].body.text === 'שני פרוסות מחיטה מלאה', 'only the unmatched part is sent: ' + calls[0].body.text);
  const wb = items.find(function (i) { return i.dbId === 'wbread'; });
  assert(wb && wb.grams === 60, 'two slices of whole bread from table units');
  const ct = items.find(function (i) { return i.dbId === 'cottage'; });
  assert(ct && Math.round(ct.calories) === Math.round(95 * ct.grams / 100), 'cottage kcal from table');
  assert(items.filter(function (i) { return i.dbId === 'cottage'; }).length === 1, 'rule match kept, AI only fills the unmatched part');
  assert(/\$0\.001 מתוך \$10/.test(AI.usageLine()), 'usage line ' + AI.usageLine());

  // cap reached → Hebrew toast, rule result returned
  reply = { status: 402, body: { error: 'cap', message: 'הגעת לתקרת ה-AI החודשית ($10).', month_usd: 10, cap_usd: 10 } };
  const before = toasts.length;
  items = await F.parseFoodText('משהו לא מוכר בכלל');
  assert(toasts.length === before + 1 && /תקרת/.test(toasts[toasts.length - 1]), 'cap toast');
  assert(items.length >= 1 && items[0].unmatched, 'falls back to rule result');
  assert(/\$10\.00 מתוך \$10/.test(AI.usageLine()), 'usage line at cap');

  // quota / network → fallback too
  reply = { status: 429, body: { error: 'quota', message: 'המכסה החינמית של Gemini נגמרה לעכשיו.' } };
  items = await F.parseFoodText('עוד משהו לא מוכר');
  assert(items[0].unmatched, 'quota fallback');
  reply = 'network';
  items = await F.parseFoodText('עוד משהו לא מוכר');
  assert(items[0].unmatched, 'network fallback');

  // menu: AI spec validated + refit by FitFood; failure → rule menu
  const prefs = { protein: 150, calories: 2200, meals: 3, excludes: ['nofish'], dislikes: [], note: 'בוקר מהיר' };
  reply = { status: 200, body: { reply: 'בניתי תפריט פשוט', meals: [
    { name: 'בוקר', foods: [{ dbId: 'proyogurt', grams: 200 }, { dbId: 'oats', grams: 50 }] },
    { name: 'צהריים', foods: [{ dbId: 'chicken', grams: 200 }, { dbId: 'rice', grams: 200 }, { dbId: 'salmon', grams: 150 }, { dbId: 'nope', grams: 9 }] },
    { name: 'ערב', foods: [{ dbId: 'egg', grams: 150 }, { dbId: 'wbread', grams: 60 }] }] } };
  let menu = await F.buildMenuAsync(prefs);
  const last = calls[calls.length - 1];
  assert(/\/llm\/menu$/.test(last.url) && last.body.prefs.note === 'בוקר מהיר' && last.body.catalog.length > 20, 'menu request');
  assert(AI.lastMenuReply() === 'בניתי תפריט פשוט', 'reply kept');
  const ids = [].concat.apply([], menu.meals.map(function (m) { return m.foods.map(function (f) { return f.dbId; }); }));
  assert(ids.indexOf('salmon') < 0 && ids.indexOf('nope') < 0, 'excluded/unknown dropped');
  assert(ids.indexOf('chicken') >= 0, 'AI pick kept');
  reply = { status: 503, body: { error: 'busy', message: 'Gemini עמוס כרגע.' } };
  menu = await F.buildMenuAsync(prefs);
  assert(menu && menu.meals.length === 3 && AI.lastMenuReply() === '', 'rule menu on failure');

  // plan → templates, loads from the engine, supersets, static holds
  Store.addWorkout({ date: '2026-11-10', type: 'chest', exercises: [{ name: 'לחיצת חזה', sets: 3, reps: 8, weight: 60, setLogs: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] }] });
  const known = AI.knownExercises(Store.getState());
  assert(known[0] === 'לחיצת חזה', 'history names first');
  const st = AI.planState();
  reply = { status: 200, body: { reply: 'תוכנית 2 ימים', plan: { name: 'בסיס', days: [
    { name: 'עליון', weekday: 0, type: 'chest', exercises: [
      { name: 'לחיצת חזה', sets: 3, repsMin: 6, repsMax: 10, restSec: 120, supersetWithNext: false, notes: '' },
      { name: 'כפיפת מרפקים', sets: 3, repsMin: 10, repsMax: 12, restSec: 60, supersetWithNext: true, notes: '' },
      { name: 'פשיטת מרפקים', sets: 3, repsMin: 10, repsMax: 12, restSec: 60, supersetWithNext: false, notes: '' }] },
    { name: 'תחתון', weekday: 3, type: 'legs', exercises: [
      { name: 'סקוואט', sets: 4, repsMin: 5, repsMax: 8, restSec: 150 },
      { name: 'פלאנק', sets: 3, repsMin: 0, repsMax: 0, notes: '40 שניות' }] }] } } };
  await AI.askPlan(Store.getState(), '');
  const lastPlan = calls[calls.length - 1].body;
  assert(lastPlan.prefs.goal === 'מסה' && lastPlan.known.indexOf('לחיצת חזה') >= 0, 'plan request');
  assert(st.result && st.result.days.length === 2 && st.messages.length === 1, 'plan stored');
  const tpls = AI.planToTemplates(Store.getState(), st.result);
  assert(tpls[0].days[0] === 0 && tpls[1].days[0] === 3, 'weekdays');
  assert(tpls[0].exercises[0].weight > 0, 'engine weight for known exercise');
  assert(!tpls[1].exercises[0].weight, 'no invented weight for new exercise');
  assert(tpls[0].exercises[1].supersetId && tpls[0].exercises[1].supersetId === tpls[0].exercises[2].supersetId, 'superset pair');
  assert(!tpls[0].exercises[0].supersetId, 'no superset on first');
  const plank = tpls[1].exercises[1];
  assert(plank.static && plank.secsMin === 40, 'plank hold 40s');
  const n0 = Store.listTemplates().length;
  assert(AI.savePlan(Store.getState()) === 2 && Store.listTemplates().length === n0 + 2, 'saved as templates');
  const saved = Store.listTemplates().slice(-2);
  assert(saved[0].exercises[0].repsMin === 6 && saved[0].exercises[0].repsMax === 10, 'reps range kept by store');

  // a change request carries the current plan; failure keeps the plan
  AI.planState().result = st.result;
  reply = { status: 429, body: { error: 'quota', message: 'המכסה החינמית של Gemini נגמרה לעכשיו.' } };
  let threw = false;
  try { await AI.askPlan(Store.getState(), 'בלי סקוואט'); } catch (e) { threw = true; }
  assert(threw && AI.planState().result && /מכסה/.test(AI.planState().error), 'plan kept on failure');
  assert(calls[calls.length - 1].body.current && calls[calls.length - 1].body.messages.slice(-1)[0].text === 'בלי סקוואט', 'change sent with current plan');

  // sheet renders
  const html = AI.renderPlanSheet(Store.getState());
  assert(/שמירה כתבניות/.test(html) && /המלצה/.test(html), 'sheet html');
  console.log('ai ok');
})().catch(function (e) { console.error(e); process.exit(1); });
