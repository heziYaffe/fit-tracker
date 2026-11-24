// Dislikes are a hard rule everywhere (AI catalog, AI reply, rule menu, swaps),
// Hebrew free text ("לא אוהב טונה") counts, and raw/cooked weights convert so
// the macros stay right.
const F = require('../js/food.js');
function assert(c, m) { if (!c) throw new Error(m); }
const allIds = m => [].concat.apply([], m.meals.map(x => x.foods.map(f => f.dbId)));

// --- term matching (Hebrew synonyms / families)
const has = (term, ids) => { const got = F.termIds(term); ids.forEach(id => assert(got.indexOf(id) >= 0, term + ' → ' + id + ' (got ' + got + ')')); return got; };
has('טונה', ['tuna', 'tunaoil']);
has('הטונה', ['tuna', 'tunaoil']);
has('עוף', ['chicken', 'thigh', 'schnitzel']);
has('דגים', ['salmon', 'whitefish', 'tuna']);
has('ביצים', ['egg', 'omelet']);
has('קוטג׳', ['cottage']);
has("קוטג'", ['cottage']);
assert(F.termIds('אורז').indexOf('ricecake') < 0, 'rice does not block rice cakes');
assert(F.termIds('שניצל עוף').join() === 'schnitzel', 'a specific dish blocks only that dish');
assert(F.termIds('גבינה').indexOf('whey') < 0, 'cheese does not block whey');
assert(F.termIds('לי זמן').length === 0, 'junk matches nothing');

// --- free text → dislikes
const ex = F.extractDislikes;
assert(JSON.stringify(ex('לא אוהב טונה וקוטג׳, אין לי זמן לבשל בבוקר')) === JSON.stringify(['טונה', "קוטג'"]), 'note dislikes: ' + ex('לא אוהב טונה וקוטג׳, אין לי זמן לבשל בבוקר'));
assert(ex('אוהב עוף ואורז אבל בלי סלמון').join() === 'סלמון', 'positive part ignored');
assert(ex('אין בעיה עם ביצים').length === 0, '"אין בעיה" is not a dislike');
assert(ex('בלי זמן להכין, אוהב טונה').length === 0, 'no food after the trigger');
assert(ex('שונא דגים').join() === 'דגים', 'plural group');

// --- blocked set: chip id + family, note text, change text, exclusions
let b = F.blockedIds({ dislikes: ['tuna'] });
assert(b.tuna && b.tunaoil && !b.salmon, 'chip blocks its variant');
b = F.blockedIds({ dislikes: [], note: 'לא אוהב קוטג׳' });
assert(b.cottage, 'note blocks');
b = F.blockedIds({ change: 'בלי עוף' });
assert(b.chicken && b.thigh, 'change request blocks');
b = F.blockedIds({ dislikeTerms: ['טונה'] });
assert(b.tuna && b.tunaoil, 'saved terms block');
b = F.blockedIds({ note: 'בלי מוצרי חלב' });
assert(b.cottage && b.milk && b.proyogurt && !b.chicken, 'text exclusion → dairy tag');

// --- the model never sees blocked foods
const prefs = { protein: 150, calories: 2200, meals: 4, dislikes: ['tuna'], note: 'לא אוהב קוטג׳ וסלמון' };
const cat = F.catalog(prefs).map(c => c.id);
['tuna', 'tunaoil', 'cottage', 'salmon', 'pizza', 'bamba'].forEach(id => assert(cat.indexOf(id) < 0, id + ' not in catalog'));
assert(F.catalog(prefs).find(c => c.id === 'rice').state === 'מבושל', 'catalog says rice grams are cooked');
assert(F.catalog(prefs).find(c => c.id === 'oats').state === 'יבש', 'catalog says oats grams are dry');

// --- the reply is re-checked; blocked/unknown/off-catalog items get a same-role stand-in
const spec = { meals: [
  { name: 'בוקר', foods: [{ dbId: 'cottage', grams: 200, role: 'bp' }, { dbId: 'wbread', grams: 60, role: 'bc' }] },
  { name: 'צהריים', foods: [{ dbId: 'tunaoil', grams: 110, role: 'mp' }, { dbId: 'rice', grams: 200, role: 'mc' }, { dbId: 'made-up', role: 'veg' }] },
  { name: 'ביניים', foods: [{ dbId: 'pizza', grams: 100 }, { dbId: 'banana', grams: 118, role: 'fruit' }] },
  { name: 'ערב', foods: [{ dbId: 'salmon', grams: 150, role: 'mp' }, { dbId: 'egg', grams: 100, role: 'bp' }, { dbId: 'egg', grams: 100, role: 'bp' }] }
] };
const m = F.menuFromSpec(spec, prefs);
const ids = allIds(m);
['cottage', 'tuna', 'tunaoil', 'salmon', 'pizza', 'made-up'].forEach(id => assert(ids.indexOf(id) < 0, id + ' removed from AI menu'));
const lunch = m.meals[1].foods.map(f => f.dbId);
assert(m.meals[1].foods.some(f => f.role === 'mp') && lunch.some(id => ['chicken', 'thigh', 'turkey', 'beef', 'steak', 'whitefish', 'schnitzel', 'tofu'].indexOf(id) >= 0), 'lunch protein replaced, not dropped: ' + lunch);
assert(m.meals[1].foods.some(f => f.role === 'veg'), 'unknown veg replaced by a real veg');
assert(m.meals[3].foods.filter(f => f.dbId === 'egg').length === 1, 'no duplicate food in a meal');
assert(m.replaced.length >= 5, 'replacements reported');

// --- rule-based fallback, every seed
for (let seed = 0; seed < 12; seed++) {
  const r = F.buildMenu(Object.assign({ seed: seed }, prefs));
  const rid = allIds(r);
  ['tuna', 'tunaoil', 'cottage', 'salmon'].forEach(id => assert(rid.indexOf(id) < 0, 'rule menu seed ' + seed + ' has ' + id));
}
// --- swaps never offer a disliked food
const sw = F.swapOptions({ dbId: 'chicken', role: 'mp', protein: 45, calories: 250 }, prefs, []);
assert(sw.length && sw.every(f => ['tuna', 'salmon', 'tunaoil'].indexOf(f.dbId) < 0), 'swap respects dislikes');

// --- raw / cooked
const p1 = t => F.parse(t)[0];
let it = p1('150 גרם אורז');
assert(it.dbId === 'rice' && it.grams === 150 && it.calories === 195, 'rice defaults to cooked weight');
it = p1('150 גרם אורז מבושל');
assert(it.grams === 150, 'explicit cooked');
it = p1('50 גרם אורז לא מבושל');
assert(it.grams === 140 && Math.abs(it.calories - 182) <= 2, 'raw rice → cooked grams, same kcal as 50 g raw (~182): ' + it.calories);
it = p1('100 גרם פסטה יבשה');
assert(it.dbId === 'pasta' && Math.abs(it.calories - 371) <= 4, 'dry pasta kcal ~371: ' + it.calories);
it = p1('200 גרם חזה עוף נא');
assert(it.dbId === 'chicken' && it.grams === 150, 'raw chicken 200 g → 150 g cooked');
it = p1('אורז לא מבושל');
assert(it.grams === 150, 'default portion is not converted');
it = p1('50 גרם שיבולת שועל');
assert(it.grams === 50, 'oats stay dry');
it = p1('200 גרם דייסת שיבולת שועל מבושלת');
assert(it.dbId === 'oats' && it.grams === 50, 'cooked porridge → dry oats');
assert(p1('חומוס מבושל').dbId === 'chickpeas', '"חומוס מבושל" is still chickpeas');
assert(p1('טחינה גולמית').dbId === 'rawtahini', 'raw tahini alias unchanged');
let alt = F.cookAlt('rice', 150);
assert(alt.state === 'cooked' && alt.raw === 55 && /לפני: ≈ 55 ג׳/.test(alt.text), 'rice second line: ' + alt.text);
alt = F.cookAlt('chicken', 150);
assert(alt.raw === 200, 'chicken raw 200');
alt = F.cookAlt('oats', 50);
assert(alt.state === 'raw' && alt.cooked === 200 && /אחרי בישול: ≈ 200/.test(alt.text), 'oats second line: ' + alt.text);
assert(F.cookAlt('banana', 100) === null && F.cookAlt('potato', 200) === null, 'no second line where it does not matter');

console.log('menu-dislikes tests passed');
