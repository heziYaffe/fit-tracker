/* פיט — food knowledge: a built-in nutrition table (per 100 g), a rule-based
   Hebrew free-text parser ("2 ביצים ופרוסת לחם"), a menu generator that hits
   daily targets, and Open Food Facts lookups for packaged products.
   Sources: generic foods use USDA FoodData Central (SR Legacy / Foundation)
   values; Israeli packaged staples use the manufacturer label as published on
   Open Food Facts. No paid APIs and no API keys.
   LLM HOOKS (optional, nothing registered by default; numbers always come
   from this table / Open Food Facts, never from the model):
   1) Free text → items:
        FitFood.parseFoodText(text, { provider }) → Promise<items>
        provider({ text, items, unmatched }) → Promise<Array<spec>>
          spec = { name: 'ביצה', qty?: 2, unit?: 'יחידה'|'כף'|..., grams?: 100 }
        or globally: FitFood.setTextProvider(provider). Called only when the
        rules left something unmatched (or opts.always). Specs are resolved
        against the table with resolveSpec(); unknown names stay unmatched.
        Provider errors/timeouts fall back to the rule-based result.
   2) Menu chat (js/menu-chat.js): the model's meals go through
        FitFood.menuFromSpec(spec, prefs, { locked }) → menu: unknown dbIds
        dropped, meat/dairy kept apart, portions re-fitted to the targets.
        catalog(prefs) = [{ id, name, roles, tags, per100 }] (allowed dbIds).
   registerResolver(fn) is the older per-segment hook (fn(unmatchedItem) →
   item|null) and still works. */
(function (root) {
  'use strict';

  // u: default countable unit {n: singular, p: plural, g: grams}.
  // units: extra unit grams (slice, cup, tbsp, tsp, can, scoop, handful, bowl, bag, container).
  // b/mn/mx/st: base, min, max portion and step in grams for the menu builder.
  // roles: bp breakfast protein, bc breakfast carb, mp main protein, mc main carb,
  //        veg, fat, sp snack protein, fruit, nut. tags: meat, dairy, fish, egg, gluten.
  const DB = [
    // eggs & dairy
    { id: 'egg', name: 'ביצה', al: ['ביצה', 'ביצים', 'ביצה קשה', 'ביצים קשות', 'ביצה רכה'], k: 155, p: 12.6, c: 1.1, f: 10.6, u: { n: 'ביצה', p: 'ביצים', g: 50 }, b: 100, mn: 50, mx: 200, st: 50, roles: ['bp'], tags: ['egg'], src: 'USDA' },
    { id: 'omelet', name: 'חביתה', al: ['חביתה', 'חביתות', 'ביצת עין', 'ביצי עין', 'ביצה מקושקשת', 'ביצים מקושקשות', 'מקושקשת'], k: 196, p: 13.6, c: 0.8, f: 14.8, u: { n: 'ביצה', p: 'ביצים', g: 50 }, b: 100, mn: 50, mx: 150, st: 50, roles: ['bp'], tags: ['egg'], src: 'USDA' },
    { id: 'eggwhite', name: 'חלבון ביצה', al: ['חלבון ביצה', 'חלבוני ביצה', 'חלבונים'], k: 52, p: 10.9, c: 0.7, f: 0.2, u: { n: 'חלבון', p: 'חלבונים', g: 33 }, b: 99, mn: 66, mx: 198, st: 33, roles: [], tags: ['egg'], src: 'USDA' },
    { id: 'cottage', name: 'קוטג׳ 5%', al: ["קוטג'", 'קוטג', "קוטג' 5%", 'גבינת קוטג'], k: 95, p: 11, c: 1.5, f: 5, units: { container: 250, cup: 225 }, u: { n: 'כף', p: 'כפות', g: 30 }, b: 125, mn: 100, mx: 250, st: 25, roles: ['bp', 'sp'], tags: ['dairy'], src: 'תווית תנובה' },
    { id: 'whitecheese', name: 'גבינה לבנה 5%', al: ['גבינה לבנה', 'לבנה 5%', 'גבינה לבנה 5%'], k: 98, p: 9, c: 4.3, f: 5, units: { container: 250 }, u: { n: 'כף', p: 'כפות', g: 30 }, b: 100, mn: 60, mx: 250, st: 30, roles: ['bp'], tags: ['dairy'], src: 'תווית תנובה' },
    { id: 'yellowcheese', name: 'גבינה צהובה 28%', al: ['גבינה צהובה', 'צהובה', 'עמק'], k: 340, p: 22, c: 0, f: 28, u: { n: 'פרוסה', p: 'פרוסות', g: 20 }, units: { slice: 20 }, b: 40, mn: 20, mx: 80, st: 20, roles: ['bp'], tags: ['dairy'], src: 'תווית עמק' },
    { id: 'bulgarian', name: 'בולגרית 5%', al: ['בולגרית', 'גבינה בולגרית', 'פטה', 'גבינת פטה'], k: 103, p: 11.5, c: 3, f: 5, u: { n: 'כף', p: 'כפות', g: 30 }, b: 60, mn: 30, mx: 150, st: 30, roles: ['bp'], tags: ['dairy'], src: 'תווית פיראוס' },
    { id: 'labane', name: 'לבנה', al: ['לבנה'], k: 155, p: 12, c: 2, f: 11, u: { n: 'כף', p: 'כפות', g: 30 }, b: 60, mn: 30, mx: 120, st: 30, roles: [], tags: ['dairy'], src: 'תווית' },
    { id: 'proyogurt', name: 'יוגורט חלבון', al: ['יוגורט חלבון', 'יוגורט פרו', 'פרו', 'דנונה פרו', 'יופרו', 'יוגורט PRO', 'גו'], k: 65, p: 10, c: 4, f: 0.7, units: { container: 200 }, u: { n: 'גביע', p: 'גביעים', g: 200 }, b: 200, mn: 200, mx: 400, st: 200, roles: ['bp', 'sp'], tags: ['dairy'], src: 'תווית דנונה PRO' },
    { id: 'yogurt', name: 'יוגורט 3%', al: ['יוגורט', 'יוגורט טבעי', 'יוגורט 3%', 'אשל', 'לבן'], k: 60, p: 3.5, c: 4.7, f: 3, units: { container: 200 }, u: { n: 'גביע', p: 'גביעים', g: 200 }, b: 200, mn: 150, mx: 300, st: 50, roles: [], tags: ['dairy'], src: 'USDA' },
    { id: 'milk', name: 'חלב 3%', al: ['חלב', 'חלב 3%', 'חלב 1%'], k: 60, p: 3.3, c: 4.95, f: 3, u: { n: 'כוס', p: 'כוסות', g: 240 }, units: { cup: 240, tbsp: 15 }, b: 240, mn: 100, mx: 480, st: 60, roles: [], tags: ['dairy'], src: 'תווית תנובה' },
    { id: 'whey', name: 'אבקת חלבון', al: ['אבקת חלבון', 'חלבון', 'שייק חלבון', 'שייק', 'סקופ חלבון', 'חלבון מי גבינה', 'וואי'], k: 380, p: 78, c: 8, f: 5, u: { n: 'סקופ', p: 'סקופים', g: 30 }, units: { scoop: 30 }, b: 30, mn: 30, mx: 60, st: 15, roles: ['sp'], tags: ['dairy'], src: 'USDA' },
    // protein mains
    { id: 'chicken', name: 'חזה עוף', al: ['חזה עוף', 'חזה', 'עוף', 'חזה עוף צלוי', 'עוף בגריל', 'פרגית חזה', 'שווארמה עוף'], k: 165, p: 31, c: 0, f: 3.6, b: 150, mn: 100, mx: 300, st: 25, roles: ['mp'], tags: ['meat'], src: 'USDA' },
    { id: 'thigh', name: 'פרגית', al: ['פרגית', 'פרגיות', 'ירך עוף', 'שוק עוף', 'כרעיים'], k: 179, p: 24.8, c: 0, f: 8.2, u: { n: 'פרגית', p: 'פרגיות', g: 100 }, b: 150, mn: 100, mx: 300, st: 50, roles: ['mp'], tags: ['meat'], src: 'USDA' },
    { id: 'turkey', name: 'הודו', al: ['הודו', 'חזה הודו', 'שניצל הודו', 'פסטרמה הודו', 'פסטרמה'], k: 147, p: 30, c: 0, f: 2.1, units: { slice: 10 }, b: 150, mn: 100, mx: 300, st: 25, roles: ['mp'], tags: ['meat'], src: 'USDA' },
    { id: 'schnitzel', name: 'שניצל', al: ['שניצל', 'שניצלים', 'שניצל עוף'], k: 250, p: 22, c: 11, f: 13, u: { n: 'שניצל', p: 'שניצלים', g: 120 }, b: 120, mn: 120, mx: 240, st: 60, roles: ['mp'], tags: ['meat', 'gluten'], src: 'USDA' },
    { id: 'beef', name: 'בשר בקר טחון', al: ['בשר טחון', 'בקר טחון', 'קציצות', 'קציצה', 'המבורגר', 'קבב'], k: 250, p: 26, c: 0, f: 15.4, u: { n: 'קציצה', p: 'קציצות', g: 60 }, b: 150, mn: 100, mx: 250, st: 25, roles: ['mp'], tags: ['meat'], src: 'USDA' },
    { id: 'steak', name: 'סטייק', al: ['סטייק', 'אנטריקוט', 'בשר בקר', 'בקר', 'סינטה', 'בשר'], k: 205, p: 29, c: 0, f: 9, b: 200, mn: 150, mx: 300, st: 50, roles: ['mp'], tags: ['meat'], src: 'USDA' },
    { id: 'salmon', name: 'סלמון', al: ['סלמון', 'סלומון', 'פילה סלמון'], k: 206, p: 22, c: 0, f: 12.4, b: 150, mn: 100, mx: 250, st: 25, roles: ['mp'], tags: ['fish'], src: 'USDA' },
    { id: 'whitefish', name: 'דג לבן', al: ['דג', 'אמנון', 'דניס', 'לוקוס', 'בורי', 'פילה דג', 'דג לבן', 'מושט'], k: 128, p: 26, c: 0, f: 2.7, b: 200, mn: 150, mx: 300, st: 50, roles: ['mp'], tags: ['fish'], src: 'USDA' },
    { id: 'tuna', name: 'טונה במים', al: ['טונה', 'טונה במים', 'קופסת טונה'], k: 116, p: 25.5, c: 0, f: 0.8, u: { n: 'קופסה', p: 'קופסאות', g: 110 }, units: { can: 110 }, b: 110, mn: 110, mx: 220, st: 55, roles: ['mp', 'bp'], tags: ['fish'], src: 'USDA' },
    { id: 'tunaoil', name: 'טונה בשמן', al: ['טונה בשמן'], k: 194, p: 26, c: 0, f: 10, u: { n: 'קופסה', p: 'קופסאות', g: 110 }, units: { can: 110 }, b: 110, mn: 110, mx: 220, st: 55, roles: [], tags: ['fish'], src: 'תווית' },
    { id: 'tofu', name: 'טופו', al: ['טופו'], k: 76, p: 8, c: 1.9, f: 4.8, b: 200, mn: 150, mx: 300, st: 50, roles: ['mp'], tags: [], src: 'USDA' },
    { id: 'falafel', name: 'פלאפל', al: ['פלאפל', 'כדורי פלאפל'], k: 333, p: 13.3, c: 31.8, f: 17.8, u: { n: 'כדור', p: 'כדורים', g: 17 }, b: 85, mn: 51, mx: 170, st: 17, roles: [], tags: [], src: 'USDA' },
    // carbs
    { id: 'bread', name: 'לחם', al: ['לחם', 'לחם לבן', 'פרוסת לחם', 'חלה', 'לחמניה', 'לחמנייה', 'באגט'], k: 266, p: 7.6, c: 49, f: 3.3, u: { n: 'פרוסה', p: 'פרוסות', g: 30 }, units: { slice: 30 }, b: 60, mn: 30, mx: 120, st: 30, roles: [], tags: ['gluten'], src: 'USDA' },
    { id: 'wbread', name: 'לחם מלא', al: ['לחם מלא', 'לחם קל', 'לחם שיפון', 'לחם כוסמין', 'כוסמין'], k: 252, p: 12.4, c: 43, f: 3.5, u: { n: 'פרוסה', p: 'פרוסות', g: 30 }, units: { slice: 30 }, b: 60, mn: 30, mx: 150, st: 30, roles: ['bc'], tags: ['gluten'], src: 'USDA' },
    { id: 'pita', name: 'פיתה', al: ['פיתה', 'פיתות', 'פיתה מלאה'], k: 275, p: 9.1, c: 55.7, f: 1.2, u: { n: 'פיתה', p: 'פיתות', g: 80 }, b: 80, mn: 40, mx: 160, st: 40, roles: ['bc', 'mc'], tags: ['gluten'], src: 'USDA' },
    { id: 'tortilla', name: 'טורטייה', al: ['טורטייה', 'טורטיה', 'לאפה', 'טורטיות'], k: 306, p: 8.2, c: 50, f: 8, u: { n: 'יחידה', p: 'יחידות', g: 60 }, b: 60, mn: 60, mx: 120, st: 60, roles: ['bc'], tags: ['gluten'], src: 'USDA' },
    { id: 'ricecake', name: 'פריכית אורז', al: ['פריכית', 'פריכיות', 'פריכיות אורז', 'פריכית אורז'], k: 387, p: 8, c: 81, f: 2.8, u: { n: 'פריכית', p: 'פריכיות', g: 9 }, b: 27, mn: 18, mx: 54, st: 9, roles: ['bc'], tags: [], src: 'USDA' },
    { id: 'oats', name: 'שיבולת שועל', al: ['שיבולת שועל', 'קוואקר', 'דייסת שיבולת שועל', 'דייסה', 'אוטמיל', 'פתיתי שיבולת שועל'], k: 379, p: 13.2, c: 67.7, f: 6.5, u: { n: 'כף', p: 'כפות', g: 10 }, units: { cup: 80, tbsp: 10 }, b: 50, mn: 30, mx: 100, st: 10, roles: ['bc'], tags: [], src: 'USDA' },
    { id: 'granola', name: 'גרנולה', al: ['גרנולה'], k: 471, p: 10, c: 64, f: 20, u: { n: 'כף', p: 'כפות', g: 12 }, units: { cup: 110, tbsp: 12 }, b: 36, mn: 24, mx: 72, st: 12, roles: [], tags: ['gluten'], src: 'USDA' },
    { id: 'cornflakes', name: 'קורנפלקס', al: ['קורנפלקס', 'דגני בוקר', 'צ׳יריוס', 'כריות'], k: 357, p: 7.5, c: 84, f: 0.4, units: { cup: 30 }, b: 40, mn: 30, mx: 80, st: 10, roles: [], tags: [], src: 'USDA' },
    { id: 'rice', name: 'אורז', al: ['אורז', 'אורז לבן', 'אורז מבושל', 'מג׳דרה', 'מג׳דרה אורז'], k: 130, p: 2.7, c: 28, f: 0.3, units: { cup: 160, tbsp: 15, bowl: 250 }, b: 150, mn: 75, mx: 350, st: 25, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'brownrice', name: 'אורז מלא', al: ['אורז מלא', 'אורז בסמטי מלא'], k: 112, p: 2.3, c: 23.5, f: 0.8, units: { cup: 195, tbsp: 15, bowl: 250 }, b: 150, mn: 75, mx: 350, st: 25, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'pasta', name: 'פסטה', al: ['פסטה', 'ספגטי', 'פתיתים', 'מקרוני', 'נודלס', 'אטריות', 'פנה'], k: 158, p: 5.8, c: 31, f: 0.9, units: { cup: 140, bowl: 250 }, b: 150, mn: 75, mx: 350, st: 25, roles: ['mc'], tags: ['gluten'], src: 'USDA' },
    { id: 'quinoa', name: 'קינואה', al: ['קינואה', 'קינואה מבושלת'], k: 120, p: 4.4, c: 21.3, f: 1.9, units: { cup: 185, bowl: 250 }, b: 150, mn: 75, mx: 350, st: 25, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'buckwheat', name: 'כוסמת', al: ['כוסמת', 'בורגול', 'קוסקוס'], k: 92, p: 3.4, c: 20, f: 0.6, units: { cup: 170, bowl: 250 }, b: 150, mn: 75, mx: 350, st: 25, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'sweetpotato', name: 'בטטה', al: ['בטטה', 'בטטות', 'בטטה אפויה'], k: 90, p: 2, c: 20.7, f: 0.2, u: { n: 'בטטה', p: 'בטטות', g: 150 }, b: 200, mn: 100, mx: 400, st: 50, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'potato', name: 'תפוח אדמה', al: ['תפוח אדמה', 'תפוחי אדמה', 'פירה', 'תפו״א', 'תפוא'], k: 93, p: 2.5, c: 21, f: 0.1, u: { n: 'תפוח אדמה', p: 'תפוחי אדמה', g: 170 }, b: 200, mn: 100, mx: 400, st: 50, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'fries', name: 'צ׳יפס', al: ["צ'יפס", 'ציפס', 'צ׳יפס', 'פרנץ׳ פרייז'], k: 312, p: 3.4, c: 41, f: 15, units: { serving: 120 }, b: 120, mn: 60, mx: 200, st: 30, roles: [], tags: [], src: 'USDA' },
    { id: 'lentils', name: 'עדשים', al: ['עדשים', 'עדשים מבושלות', 'מרק עדשים'], k: 116, p: 9, c: 20, f: 0.4, units: { cup: 200, bowl: 250 }, b: 200, mn: 100, mx: 300, st: 50, roles: ['mc'], tags: [], src: 'USDA' },
    { id: 'chickpeas', name: 'גרגרי חומוס', al: ['גרגרי חומוס', 'חומוס גרגרים', 'חומוס מבושל', 'מסבחה'], k: 164, p: 8.9, c: 27.4, f: 2.6, units: { cup: 165 }, b: 150, mn: 75, mx: 250, st: 25, roles: [], tags: [], src: 'USDA' },
    { id: 'corn', name: 'תירס', al: ['תירס', 'קלח תירס'], k: 96, p: 3.4, c: 21, f: 1.5, u: { n: 'קלח', p: 'קלחים', g: 100 }, units: { cup: 150 }, b: 100, mn: 50, mx: 200, st: 50, roles: [], tags: [], src: 'USDA' },
    // fats & spreads
    { id: 'hummus', name: 'חומוס', al: ['חומוס', 'ממרח חומוס', 'צלחת חומוס'], k: 204, p: 8.6, c: 10, f: 13.4, u: { n: 'כף', p: 'כפות', g: 30 }, units: { bowl: 200 }, b: 60, mn: 30, mx: 150, st: 30, roles: ['fat'], tags: [], src: 'תווית אחלה' },
    { id: 'tahini', name: 'טחינה', al: ['טחינה', 'טחינה מוכנה', 'סלט טחינה'], k: 300, p: 8.5, c: 10.5, f: 27, u: { n: 'כף', p: 'כפות', g: 15 }, b: 30, mn: 15, mx: 60, st: 15, roles: ['fat'], tags: [], src: 'USDA (מדולל)' },
    { id: 'rawtahini', name: 'טחינה גולמית', al: ['טחינה גולמית', 'טחינה גולמית מלאה'], k: 595, p: 17, c: 21.2, f: 53.8, u: { n: 'כף', p: 'כפות', g: 15 }, b: 15, mn: 15, mx: 45, st: 15, roles: [], tags: [], src: 'USDA' },
    { id: 'oliveoil', name: 'שמן זית', al: ['שמן זית', 'שמן', 'שמן קנולה'], k: 884, p: 0, c: 0, f: 100, u: { n: 'כף', p: 'כפות', g: 13 }, units: { tbsp: 13, tsp: 4.5 }, b: 10, mn: 5, mx: 25, st: 5, roles: ['fat'], tags: [], src: 'USDA' },
    { id: 'avocado', name: 'אבוקדו', al: ['אבוקדו'], k: 160, p: 2, c: 8.5, f: 14.7, u: { n: 'אבוקדו', p: 'אבוקדו', g: 150 }, units: { tbsp: 15 }, b: 75, mn: 50, mx: 150, st: 25, roles: ['fat'], tags: [], src: 'USDA' },
    { id: 'peanutbutter', name: 'חמאת בוטנים', al: ['חמאת בוטנים'], k: 588, p: 25, c: 20, f: 50, u: { n: 'כף', p: 'כפות', g: 16 }, units: { tbsp: 16, tsp: 5 }, b: 16, mn: 16, mx: 32, st: 16, roles: ['nut'], tags: [], src: 'USDA' },
    { id: 'almonds', name: 'שקדים', al: ['שקדים', 'שקד', 'אגוזים', 'אגוזי מלך', 'קשיו', 'פיסטוק', 'אגוזי לוז', 'מיקס אגוזים'], k: 600, p: 20, c: 20, f: 52, units: { handful: 28 }, b: 28, mn: 14, mx: 42, st: 7, roles: ['nut'], tags: [], src: 'USDA' },
    // vegetables
    { id: 'salad', name: 'סלט ירקות', al: ['סלט', 'סלט ירקות', 'סלט ישראלי', 'ירקות', 'סלט קצוץ'], k: 20, p: 0.8, c: 4, f: 0.2, units: { bowl: 250 }, b: 200, mn: 100, mx: 400, st: 50, roles: ['veg'], tags: [], src: 'USDA' },
    { id: 'cucumber', name: 'מלפפון', al: ['מלפפון', 'מלפפונים'], k: 15, p: 0.7, c: 3.6, f: 0.1, u: { n: 'מלפפון', p: 'מלפפונים', g: 100 }, b: 200, mn: 100, mx: 300, st: 100, roles: ['veg'], tags: [], src: 'USDA' },
    { id: 'tomato', name: 'עגבנייה', al: ['עגבנייה', 'עגבניה', 'עגבניות', 'עגבניות שרי', 'שרי'], k: 18, p: 0.9, c: 3.9, f: 0.2, u: { n: 'עגבנייה', p: 'עגבניות', g: 120 }, b: 120, mn: 120, mx: 240, st: 120, roles: ['veg'], tags: [], src: 'USDA' },
    { id: 'broccoli', name: 'ברוקולי', al: ['ברוקולי', 'כרובית', 'שעועית ירוקה', 'ירקות מאודים', 'ירקות מבושלים'], k: 35, p: 2.4, c: 7.2, f: 0.4, units: { cup: 150 }, b: 150, mn: 100, mx: 300, st: 50, roles: ['veg'], tags: [], src: 'USDA' },
    { id: 'carrot', name: 'גזר', al: ['גזר', 'גזרים'], k: 41, p: 0.9, c: 9.6, f: 0.2, u: { n: 'גזר', p: 'גזרים', g: 60 }, b: 120, mn: 60, mx: 180, st: 60, roles: ['veg'], tags: [], src: 'USDA' },
    { id: 'pepper', name: 'פלפל', al: ['פלפל', 'פלפלים', 'גמבה'], k: 31, p: 1, c: 6, f: 0.3, u: { n: 'פלפל', p: 'פלפלים', g: 120 }, b: 120, mn: 120, mx: 240, st: 120, roles: ['veg'], tags: [], src: 'USDA' },
    // fruit
    { id: 'banana', name: 'בננה', al: ['בננה', 'בננות'], k: 89, p: 1.1, c: 22.8, f: 0.3, u: { n: 'בננה', p: 'בננות', g: 118 }, b: 118, mn: 118, mx: 236, st: 118, roles: ['fruit'], tags: [], src: 'USDA' },
    { id: 'apple', name: 'תפוח', al: ['תפוח', 'תפוחים', 'תפוח עץ'], k: 52, p: 0.3, c: 13.8, f: 0.2, u: { n: 'תפוח', p: 'תפוחים', g: 180 }, b: 180, mn: 180, mx: 360, st: 180, roles: ['fruit'], tags: [], src: 'USDA' },
    { id: 'orange', name: 'תפוז', al: ['תפוז', 'תפוזים', 'קלמנטינה', 'קלמנטינות', 'מנדרינה', 'אשכולית'], k: 47, p: 0.9, c: 11.8, f: 0.1, u: { n: 'יחידה', p: 'יחידות', g: 130 }, b: 130, mn: 130, mx: 260, st: 130, roles: ['fruit'], tags: [], src: 'USDA' },
    { id: 'dates', name: 'תמר', al: ['תמר', 'תמרים', 'מג׳הול'], k: 277, p: 1.8, c: 75, f: 0.2, u: { n: 'תמר', p: 'תמרים', g: 24 }, b: 48, mn: 24, mx: 96, st: 24, roles: ['fruit'], tags: [], src: 'USDA' },
    { id: 'grapes', name: 'ענבים', al: ['ענבים', 'ענב'], k: 69, p: 0.7, c: 18, f: 0.2, units: { cup: 150, bowl: 250 }, b: 150, mn: 100, mx: 300, st: 50, roles: ['fruit'], tags: [], src: 'USDA' },
    { id: 'strawberries', name: 'תותים', al: ['תותים', 'תות', 'פירות יער', 'אוכמניות'], k: 32, p: 0.7, c: 7.7, f: 0.3, units: { cup: 150, bowl: 250 }, b: 150, mn: 100, mx: 300, st: 50, roles: ['fruit'], tags: [], src: 'USDA' },
    { id: 'watermelon', name: 'אבטיח', al: ['אבטיח', 'מלון'], k: 30, p: 0.6, c: 7.6, f: 0.2, units: { slice: 280, cup: 150 }, b: 280, mn: 150, mx: 500, st: 50, roles: [], tags: [], src: 'USDA' },
    // misc
    { id: 'pizza', name: 'פיצה', al: ['פיצה', 'משולש פיצה', 'משולשי פיצה'], k: 266, p: 11.4, c: 33, f: 10, u: { n: 'משולש', p: 'משולשים', g: 107 }, units: { slice: 107 }, b: 214, mn: 107, mx: 428, st: 107, roles: [], tags: ['dairy', 'gluten'], src: 'USDA' },
    { id: 'bamba', name: 'במבה', al: ['במבה'], k: 535, p: 15, c: 41, f: 34, u: { n: 'שקית', p: 'שקיות', g: 25 }, units: { bag: 25 }, b: 25, mn: 25, mx: 80, st: 25, roles: [], tags: [], src: 'תווית אסם' },
    { id: 'chocolate', name: 'שוקולד', al: ['שוקולד', 'שוקולד מריר', 'קוביית שוקולד', 'קוביות שוקולד'], k: 546, p: 6, c: 58, f: 31, u: { n: 'קובייה', p: 'קוביות', g: 5 }, b: 20, mn: 5, mx: 100, st: 5, roles: [], tags: ['dairy'], src: 'USDA' },
    { id: 'honey', name: 'דבש', al: ['דבש', 'סילאן', 'ריבה'], k: 304, p: 0.3, c: 82.4, f: 0, u: { n: 'כפית', p: 'כפיות', g: 7 }, units: { tsp: 7, tbsp: 21 }, b: 7, mn: 7, mx: 21, st: 7, roles: [], tags: [], src: 'USDA' },
    { id: 'sugar', name: 'סוכר', al: ['סוכר'], k: 387, p: 0, c: 100, f: 0, u: { n: 'כפית', p: 'כפיות', g: 4 }, units: { tsp: 4, tbsp: 12 }, b: 4, mn: 4, mx: 12, st: 4, roles: [], tags: [], src: 'USDA' },
    { id: 'coffee', name: 'קפה', al: ['קפה', 'אספרסו', 'קפה שחור', 'נס', 'נס קפה', 'תה'], k: 2, p: 0.3, c: 0, f: 0, u: { n: 'כוס', p: 'כוסות', g: 240 }, units: { cup: 240 }, b: 240, mn: 240, mx: 480, st: 240, roles: [], tags: [], src: 'USDA' },
    { id: 'cappuccino', name: 'הפוך', al: ['הפוך', 'קפה הפוך', 'קפוצ׳ינו', 'לאטה', 'קפה עם חלב'], k: 46, p: 2.5, c: 3.8, f: 2.4, u: { n: 'כוס', p: 'כוסות', g: 240 }, units: { cup: 240 }, b: 240, mn: 240, mx: 480, st: 240, roles: [], tags: ['dairy'], src: 'USDA' }
  ];

  const GENERIC_UNITS = { tbsp: 15, tsp: 5, cup: 200, slice: 30, handful: 28, bowl: 250, scoop: 30, can: 110, bag: 50, container: 200 };

  // Hebrew unit words → unit key. 'g' grams, 'kg', 'ml' (treated as grams).
  const UNIT_WORDS = {
    'גרם': 'g', 'גר': 'g', 'ג': 'g', "ג'": 'g', "גר'": 'g', 'גרמים': 'g', 'קילו': 'kg', 'קג': 'kg', 'מל': 'ml', 'מ"ל': 'ml', 'ליטר': 'l',
    'כף': 'tbsp', 'כפות': 'tbsp', 'כפית': 'tsp', 'כפיות': 'tsp',
    'כוס': 'cup', 'כוסות': 'cup', 'ספל': 'cup',
    'פרוסה': 'slice', 'פרוסות': 'slice', 'פרוסת': 'slice', 'משולש': 'slice', 'משולשים': 'slice', 'משולשי': 'slice',
    'יחידה': 'unit', 'יחידות': 'unit', 'יח': 'unit', "יח'": 'unit', 'כדור': 'unit', 'כדורים': 'unit', 'כדורי': 'unit',
    'קופסה': 'can', 'קופסת': 'can', 'קופסא': 'can', 'קופסאות': 'can', 'פחית': 'can',
    'סקופ': 'scoop', 'סקופים': 'scoop', 'מצקת': 'scoop',
    'חופן': 'handful', 'חופנים': 'handful', 'חופני': 'handful',
    'קערה': 'bowl', 'קערת': 'bowl', 'קערות': 'bowl', 'צלחת': 'bowl', 'צלחות': 'bowl',
    'מנה': 'serving', 'מנות': 'serving', 'מנת': 'serving',
    'שקית': 'bag', 'שקיות': 'bag', 'שקיק': 'bag',
    'גביע': 'container', 'גביעים': 'container', 'גביעי': 'container'
  };

  const NUM_WORDS = {
    'אחד': 1, 'אחת': 1, 'שני': 2, 'שתי': 2, 'שניים': 2, 'שתיים': 2, 'שנים': 2, 'שתים': 2, 'זוג': 2,
    'שלוש': 3, 'שלושה': 3, 'שלושת': 3, 'ארבע': 4, 'ארבעה': 4, 'ארבעת': 4, 'חמש': 5, 'חמישה': 5, 'חמשת': 5,
    'שש': 6, 'שישה': 6, 'ששת': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10,
    'חצי': 0.5, 'רבע': 0.25, 'שליש': 0.33
  };
  const SIZE_WORDS = { 'קטן': 0.7, 'קטנה': 0.7, 'קטנים': 0.7, 'קטנות': 0.7, 'גדול': 1.3, 'גדולה': 1.3, 'גדולים': 1.3, 'גדולות': 1.3 };
  const FILLER = { 'של': 1, 'אכלתי': 1, 'שתיתי': 1, 'בערך': 1, 'כ': 1, 'כמה': 1, 'עוד': 1, 'גם': 1, 'היום': 1, 'בבוקר': 1, 'בצהריים': 1, 'בערב': 1, 'מנה': 0 };

  const PHRASES = { 'קפה עם חלב': 'הפוך', 'תה עם חלב': 'הפוך' };

  const byId = {};
  DB.forEach(function (f) { byId[f.id] = f; });

  // Cooking yields (cooked weight / raw weight). The table values above are
  // for the state in `base`: grains, legumes and meat/fish are per 100 g
  // COOKED (USDA "cooked" entries), oats per 100 g DRY. Starches use the USDA
  // raw/cooked energy ratio (so a raw weight converts to the same calories);
  // meat and fish use USDA cooking weight yields (fat/water drip).
  const COOK = {
    rice: { y: 2.8, base: 'cooked' }, brownrice: { y: 3.2, base: 'cooked' }, pasta: { y: 2.35, base: 'cooked' },
    quinoa: { y: 3, base: 'cooked' }, buckwheat: { y: 3.7, base: 'cooked' }, lentils: { y: 3, base: 'cooked' },
    chickpeas: { y: 2.3, base: 'cooked' },
    chicken: { y: 0.75, base: 'cooked' }, thigh: { y: 0.7, base: 'cooked' }, turkey: { y: 0.75, base: 'cooked' },
    beef: { y: 0.75, base: 'cooked' }, steak: { y: 0.75, base: 'cooked' },
    salmon: { y: 0.8, base: 'cooked' }, whitefish: { y: 0.8, base: 'cooked' },
    oats: { y: 4, base: 'raw' } // porridge with water; depends on how much water
  };
  function cookInfo(foodOrId) {
    const id = typeof foodOrId === 'string' ? foodOrId : (foodOrId && foodOrId.id);
    return (id && COOK[id]) || null;
  }
  function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }
  // Second line for a portion: the other weight. grams are in the table's state.
  function cookAlt(dbId, grams) {
    const c = cookInfo(dbId);
    const g = Number(grams) || 0;
    if (!c || g <= 0) return null;
    if (c.base === 'cooked') {
      const raw = round5(g / c.y);
      return { state: 'cooked', raw: raw, cooked: Math.round(g), text: 'אחרי בישול · לפני: ≈ ' + raw + ' ג׳' };
    }
    const cooked = round5(g * c.y);
    return { state: 'raw', raw: Math.round(g), cooked: cooked, text: 'יבש · אחרי בישול: ≈ ' + cooked + ' ג׳' };
  }
  const RAW_RE = /(^| )(לא מבושל(ת|ים|ות)?|לפני (ה)?בישול|יבש(ה|ים|ות)?|נא|גולמי(ת|ים|ות)?)(?= |$)/g;
  const COOKED_RE = /(^| )(מבושל(ת|ים|ות)?|אחרי (ה)?בישול|מוכן|מוכנה)(?= |$)/g;
  function cookStateOf(text) {
    const t = bare(text);
    if (RAW_RE.test(t)) { RAW_RE.lastIndex = 0; return 'raw'; }
    RAW_RE.lastIndex = 0;
    if (COOKED_RE.test(t)) { COOKED_RE.lastIndex = 0; return 'cooked'; }
    COOKED_RE.lastIndex = 0;
    return '';
  }
  function stripCookWords(text) {
    return bare(text).replace(RAW_RE, ' ').replace(COOKED_RE, ' ').replace(/\s+/g, ' ').trim();
  }
  // grams the user gave in `state` → grams in the table's state
  function toTableGrams(food, grams, state) {
    const c = cookInfo(food);
    if (!c || !state || state === c.base) return grams;
    return c.base === 'cooked' ? grams * c.y : grams / c.y;
  }

  function norm(s) {
    return String(s || '')
      .replace(/[\u0591-\u05C7]/g, '')
      .replace(/[׳`’‘]/g, "'")
      .replace(/[״“”]/g, '"')
      .replace(/½/g, ' 0.5 ').replace(/¼/g, ' 0.25 ')
      .replace(/(\d)([א-ת])/g, '$1 $2')
      .replace(/([א-ת])(\d)/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // alias index: normalized alias → food id, longest first
  const ALIASES = [];
  DB.forEach(function (f) {
    const seen = {};
    [f.name].concat(f.al || []).forEach(function (a) {
      const n = norm(a).replace(/"/g, '').replace(/'/g, '');
      if (!n || seen[n]) return;
      seen[n] = 1;
      ALIASES.push({ a: n, id: f.id });
    });
  });
  ALIASES.sort(function (x, y) { return y.a.length - x.a.length; });

  function bare(s) { return norm(s).replace(/"/g, '').replace(/'/g, ''); }

  function wordIn(hay, needle) {
    const h = ' ' + hay + ' ';
    if (h.indexOf(' ' + needle + ' ') >= 0) return true;
    // Hebrew prefixes ה/ב/ל/ו glued to the first word
    return /[הבלו]/.test(needle[0] || '') ? false : (h.indexOf(' ה' + needle + ' ') >= 0 || h.indexOf(' ב' + needle + ' ') >= 0);
  }

  function matchFood(text) {
    const t = bare(text);
    if (!t) return null;
    for (let i = 0; i < ALIASES.length; i++) if (ALIASES[i].a === t) return byId[ALIASES[i].id];
    let best = null;
    for (let i = 0; i < ALIASES.length; i++) {
      const a = ALIASES[i].a;
      if (!wordIn(t, a)) continue;
      const pos = (' ' + t + ' ').indexOf(' ' + a + ' ');
      const p2 = pos < 0 ? 999 : pos;
      if (!best || a.length > best.len + 2 || (a.length >= best.len - 2 && p2 < best.pos)) best = { id: ALIASES[i].id, len: a.length, pos: p2 };
    }
    if (best) return byId[best.id];
    if (t.length >= 3) {
      for (let i = ALIASES.length - 1; i >= 0; i--) if (ALIASES[i].a.indexOf(t) === 0) return byId[ALIASES[i].id];
    }
    return null;
  }

  function isQtyWord(w) {
    return /^\d/.test(w) || NUM_WORDS[w] != null || UNIT_WORDS[w] != null;
  }

  // Split free text into item segments on commas/newlines/plus, "עם", and the
  // Hebrew conjunction ו when it starts a new item ("ופרוסת לחם", "ו2 ביצים").
  function splitSegments(text) {
    const out = [];
    let src = ' ' + norm(text) + ' ';
    Object.keys(PHRASES).forEach(function (k) { src = src.split(' ' + k + ' ').join(' ' + PHRASES[k] + ' '); });
    src.trim().split(/[,،;\n+]|\s+עם\s+|\s+and\s+/).forEach(function (piece) {
      const words = piece.trim().split(' ').filter(Boolean);
      let cur = [];
      words.forEach(function (w, i) {
        if (i > 0 && w.length > 1 && w[0] === 'ו' && w !== 'וחצי' && cur.length) {
          const rest = w.slice(1);
          const tail = [rest].concat(words.slice(i + 1)).join(' ');
          const withVav = [w].concat(words.slice(i + 1)).join(' ');
          if (isQtyWord(rest) || (matchFood(tail) && !matchFood(withVav.split(' ')[0]))) {
            out.push(cur.join(' '));
            cur = [rest];
            return;
          }
        }
        cur.push(w);
      });
      if (cur.length) out.push(cur.join(' '));
    });
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function unitGrams(food, unit) {
    if (!food) return 0;
    if (unit === 'unit' || !unit) return food.u ? food.u.g : 0;
    if (food.units && food.units[unit]) return food.units[unit];
    if (food.u && unitKeyOfName(food.u.n) === unit) return food.u.g;
    if (unit === 'serving') return food.b;
    return GENERIC_UNITS[unit] || 0;
  }

  function unitKeyOfName(n) { return UNIT_WORDS[n] || ''; }

  function parseSegment(seg) {
    const words = norm(seg).split(' ').filter(Boolean);
    let qty = null;
    let unit = '';
    let size = 1;
    let half = 0;
    const rest = [];
    words.forEach(function (w) {
      const wc = w.replace(/^ו(?=חצי$)/, '');
      if (wc === 'חצי' && w === 'וחצי') { half = 0.5; return; }
      if (/^\d+([.,]\d+)?$/.test(w)) { qty = (qty || 0) + Number(w.replace(',', '.')); return; }
      if (/^\d+\/\d+$/.test(w)) { const p = w.split('/'); qty = (qty || 0) + Number(p[0]) / Number(p[1]); return; }
      const numW = NUM_WORDS[w] != null ? w : (/^[מבוה]/.test(w) && NUM_WORDS[w.slice(1)] != null ? w.slice(1) : '');
      if (numW) {
        qty = qty == null ? NUM_WORDS[numW] : qty * NUM_WORDS[numW];
        return;
      }
      if (UNIT_WORDS[w] && !unit) {
        // "פרוסת לחם" — unit word; but keep words that are themselves foods (e.g. "חלבון")
        unit = UNIT_WORDS[w];
        return;
      }
      if (SIZE_WORDS[w]) { size = SIZE_WORDS[w]; return; }
      if (FILLER[w]) return;
      rest.push(w);
    });
    if (half) qty = (qty == null ? 1 : qty) + half;
    const name = rest.join(' ');
    // "אורז מבושל" / "אורז לא מבושל" / "50 גרם שיבולת שועל יבשה": the full name
    // first (some aliases include the word, e.g. "חומוס מבושל"), then without it.
    const food = matchFood(name) || (stripCookWords(name) ? matchFood(stripCookWords(name)) : null);
    if (!food) return { text: seg, query: name || seg, unmatched: true, qty: qty, unit: unit };
    const cookState = cookInfo(food) ? cookStateOf(name) : '';
    let grams;
    if (unit === 'g' || unit === 'ml') grams = qty || food.b;
    else if (unit === 'kg' || unit === 'l') grams = (qty || 1) * 1000;
    else if (unit) grams = (qty == null ? 1 : qty) * (unitGrams(food, unit) || food.b);
    else if (qty != null) {
      if (food.u) grams = qty >= 20 && qty > food.u.g * 4 ? qty : qty * food.u.g;
      else grams = qty >= 20 ? qty : qty * food.b;
    } else grams = food.u && food.b < food.u.g ? food.u.g : (food.u ? food.u.g * Math.max(1, Math.round(food.b / food.u.g)) : food.b);
    if (!unit && qty == null && food.u && food.u.g >= 50) grams = food.u.g; // "ביצה" = one egg
    // Only a weight the user typed is converted; default portions are already
    // in the table's state.
    const typedWeight = unit === 'g' || unit === 'kg' || (!unit && qty != null && qty >= 20 && grams === qty);
    grams = Math.round(typedWeight ? toTableGrams(food, grams * size, cookState) : grams * size);
    return itemFor(food, grams, seg);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function macros(per100, grams) {
    const g = Number(grams) || 0;
    return {
      calories: Math.round(per100.k * g / 100),
      protein: round1(per100.p * g / 100),
      carbs: round1(per100.c * g / 100),
      fat: round1(per100.f * g / 100)
    };
  }

  function portionLabel(food, grams) {
    if (food.u) {
      const n = grams / food.u.g;
      const r = Math.round(n * 2) / 2;
      if (Math.abs(n - r) < 0.05 && r > 0) {
        const cnt = r === 0.5 ? 'חצי' : (r === 1 ? '1' : String(r));
        const unitWord = r > 1 ? food.u.p : food.u.n;
        if (unitWord === food.name || food.u.p === food.name) return cnt + ' ' + unitWord;
        return food.name + ' · ' + cnt + ' ' + unitWord;
      }
    }
    return food.name + ' · ' + Math.round(grams) + ' ג׳';
  }

  function itemFor(food, grams, text) {
    const m = macros(food, grams);
    return {
      dbId: food.id,
      name: food.name,
      label: portionLabel(food, grams),
      grams: Math.round(grams),
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
      source: food.src || 'USDA',
      text: text || ''
    };
  }

  function rescale(item, grams) {
    grams = Math.max(1, Math.round(Number(grams) || 0));
    if (item.dbId && byId[item.dbId]) return Object.assign({}, item, itemFor(byId[item.dbId], grams, item.text));
    if (item.per100) {
      const m = macros(item.per100, grams);
      return Object.assign({}, item, m, { grams: grams, label: (item.name || '') + ' · ' + grams + ' ג׳' });
    }
    const base = Number(item.grams) || grams;
    const r = grams / base;
    return Object.assign({}, item, {
      grams: grams,
      calories: Math.round((item.calories || 0) * r),
      protein: round1((item.protein || 0) * r),
      carbs: round1((item.carbs || 0) * r),
      fat: round1((item.fat || 0) * r)
    });
  }

  const resolvers = [];
  function registerResolver(fn) { if (typeof fn === 'function') resolvers.push(fn); }

  function parse(text) {
    return splitSegments(text).map(parseSegment);
  }

  // Async variant: unmatched segments go through registered resolvers (none by default).
  function parseAsync(text) {
    const items = parse(text);
    if (!resolvers.length) return Promise.resolve(items);
    return Promise.all(items.map(function (it) {
      if (!it.unmatched) return it;
      let p = Promise.resolve(null);
      resolvers.forEach(function (r) { p = p.then(function (hit) { return hit || r(it); }); });
      return p.then(function (hit) { return hit || it; }).catch(function () { return it; });
    }));
  }

  function totals(items) {
    const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    (items || []).forEach(function (i) {
      if (!i || i.unmatched) return;
      t.calories += Number(i.calories) || 0;
      t.protein += Number(i.protein) || 0;
      t.carbs += Number(i.carbs) || 0;
      t.fat += Number(i.fat) || 0;
    });
    t.calories = Math.round(t.calories); t.protein = round1(t.protein); t.carbs = round1(t.carbs); t.fat = round1(t.fat);
    return t;
  }

  // ---------- Open Food Facts (packaged products, barcode) ----------
  const OFF = 'https://world.openfoodfacts.org';
  const OFF_IL = 'https://il.openfoodfacts.org';
  const OFF_FIELDS = 'code,product_name,product_name_he,brands,nutriments,serving_quantity';

  function offItem(p) {
    if (!p) return null;
    const n = p.nutriments || {};
    const kcal = Number(n['energy-kcal_100g']);
    if (!Number.isFinite(kcal)) return null;
    const per100 = { k: kcal, p: Number(n.proteins_100g) || 0, c: Number(n.carbohydrates_100g) || 0, f: Number(n.fat_100g) || 0 };
    const srv = Number(p.serving_quantity);
    const grams = Number.isFinite(srv) && srv >= 5 && srv <= 600 ? Math.round(srv) : 100;
    const name = String(p.product_name_he || p.product_name || '').trim() || 'מוצר';
    const brand = String(p.brands || '').split(',')[0].trim();
    const m = macros(per100, grams);
    return {
      name: name + (brand && name.indexOf(brand) < 0 ? ' (' + brand + ')' : ''),
      label: name + ' · ' + grams + ' ג׳',
      grams: grams, per100: per100, code: p.code || '',
      calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat,
      source: 'Open Food Facts'
    };
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // OFF's error pages (503/429) carry no CORS header, so the browser reports
  // them as network errors; retry those a couple of times.
  function getJSON(url, tries) {
    tries = tries || 2;
    return fetch(url).then(function (res) {
      if ((res.status === 503 || res.status === 429 || res.status === 502) && tries > 1) {
        return wait(1200).then(function () { return getJSON(url, tries - 1); });
      }
      if (!res.ok && res.status !== 404) throw new Error('http ' + res.status);
      return res.json();
    }, function (err) {
      if (tries > 1) return wait(1200).then(function () { return getJSON(url, tries - 1); });
      throw err;
    });
  }

  function searchOn(host, q) {
    const url = host + '/cgi/search.pl?search_simple=1&json=1&page_size=12&fields=' + OFF_FIELDS +
      '&search_terms=' + encodeURIComponent(String(q || '').trim());
    return getJSON(url, 2).then(function (d) {
      return ((d && d.products) || []).map(offItem).filter(Boolean).slice(0, 8);
    });
  }

  // World catalogue (has the Hebrew names of Israeli products); the Israeli
  // mirror is a fallback when the main search is busy.
  function searchProducts(q) {
    return searchOn(OFF, q).then(function (list) {
      return list.length ? list : searchOn(OFF_IL, q);
    }, function () { return searchOn(OFF_IL, q); });
  }

  function lookupBarcode(code) {
    const c = String(code || '').replace(/\D/g, '');
    if (c.length < 6) return Promise.resolve(null);
    return getJSON(OFF + '/api/v2/product/' + c + '.json?fields=' + OFF_FIELDS, 2).then(function (d) {
      return d && d.status === 1 ? offItem(d.product) : null;
    });
  }

  // ---------- Menu builder ----------
  const SLOT_PLANS = {
    3: [['בוקר', 'breakfast'], ['צהריים', 'lunch'], ['ערב', 'dinner']],
    4: [['בוקר', 'breakfast'], ['צהריים', 'lunch'], ['ביניים', 'snack'], ['ערב', 'dinner']],
    5: [['בוקר', 'breakfast'], ['ביניים', 'snack'], ['צהריים', 'lunch'], ['ביניים אחה״צ', 'snack'], ['ערב', 'dinner']]
  };
  const SLOT_TIMES = { 3: ['08:00', '13:30', '19:30'], 4: ['08:00', '13:00', '16:30', '20:00'], 5: ['07:30', '10:30', '13:30', '16:30', '20:00'] };
  const SLOT_ROLES = {
    breakfast: ['bp', 'bc', 'veg'],
    lunch: ['mp', 'mc', 'veg', 'fat'],
    dinner: ['bp', 'bc', 'veg', 'fat'],
    snack: ['sp', 'fruit']
  };
  const SLOT_AVOID = { dinner: ['oats'], lunch: ['tuna'] };
  const PROTEIN_ROLES = { bp: 1, mp: 1, sp: 1 };
  const CARB_ROLES = { bc: 1, mc: 1, fruit: 1 };

  const EXCLUDE_OPTIONS = [
    { id: 'veg', label: 'צמחוני', tags: ['meat', 'fish'] },
    { id: 'nodairy', label: 'בלי מוצרי חלב', tags: ['dairy'] },
    { id: 'noegg', label: 'בלי ביצים', tags: ['egg'] },
    { id: 'nofish', label: 'בלי דגים', tags: ['fish'] },
    { id: 'nogluten', label: 'בלי גלוטן', tags: ['gluten'] }
  ];

  function blockedTags(excludes) {
    const out = {};
    (excludes || []).forEach(function (id) {
      const o = EXCLUDE_OPTIONS.find(function (x) { return x.id === id; });
      if (o) o.tags.forEach(function (t) { out[t] = 1; });
    });
    return out;
  }

  // ---------- Dislikes (hard constraint everywhere: AI catalog, AI output, rules, swaps) ----------
  // A disliked table food also blocks its close variants that have no chip of
  // their own (e.g. "טונה במים" → "טונה בשמן").
  const FAMILY = { tuna: ['tunaoil'], tahini: ['rawtahini'], hummus: ['chickpeas'], potato: ['fries'] };

  // Generic words that mean a whole group.
  const GROUP_WORDS = {
    'עוף': ['chicken', 'thigh', 'schnitzel'],
    'דג': ['whitefish', 'salmon', 'tuna', 'tunaoil'], 'דגים': ['whitefish', 'salmon', 'tuna', 'tunaoil'],
    'בשר': ['beef', 'steak'], 'בשר אדום': ['beef', 'steak'],
    'גבינה': ['cottage', 'whitecheese', 'yellowcheese', 'bulgarian', 'labane'], 'גבינות': ['cottage', 'whitecheese', 'yellowcheese', 'bulgarian', 'labane'],
    'ביצה': ['egg', 'omelet', 'eggwhite'], 'ביצים': ['egg', 'omelet', 'eggwhite'],
    'קטניות': ['lentils', 'chickpeas', 'hummus'], 'יוגורט': ['yogurt', 'proyogurt']
  };

  function singular(w) {
    if (w.length >= 4 && /(ים|ות)$/.test(w)) return w.slice(0, -2);
    return w;
  }

  // Free-text term ("טונה", "עוף", "קוטג׳", "דגים") → table ids. Matches the
  // best food for the phrase plus every food whose name/alias contains the
  // term as a whole word ("טונה" → טונה במים + טונה בשמן; "עוף" → חזה עוף,
  // פרגית (ירך עוף), שניצל (שניצל עוף)).
  function termIds(term) {
    const out = {};
    const t = bare(term).replace(/^(את|ה)\s+/, '');
    if (!t || t.length < 2) return [];
    const variants = [t];
    const sg = t.split(' ').map(singular).join(' ');
    if (sg !== t) variants.push(sg);
    if (t.length > 3 && t[0] === 'ה' && t.indexOf(' ') < 0) variants.push(t.slice(1));
    variants.forEach(function (v) {
      (GROUP_WORDS[v] || []).forEach(function (id) { out[id] = 1; });
      // the term as the head word of a food name/alias (Hebrew puts the head
      // noun first: "טונה בשמן", "גבינה לבנה", "לחם מלא" — but not "פריכיות אורז")
      ALIASES.forEach(function (a) { if (a.a === v || (a.a + ' ').indexOf(v + ' ') === 0) out[a.id] = 1; });
      // the best food named inside a longer phrase ("שניצל עוף" → שניצל only)
      const f = matchFood(v);
      if (f && ALIASES.some(function (a) { return a.id === f.id && wordIn(v, a.a); })) out[f.id] = 1;
    });
    return Object.keys(out);
  }

  const NEG_TRIGGER = /(?:^| )ו?(?:לא אוהב(?:ת|ים)?|לא אוכל(?:ת|ים)?|לא רוצה|לא בא לי|שונא(?:ת)?|אלרגי(?:ת|ה)?(?: ל)?|רגיש(?:ה)? ל|בלי|ללא|אין|בלעדי|תוריד(?:י)?|להוריד|הורד|תחליף את|להחליף את|מספיק עם|נמאס(?: לי)? מ)(?= )/;
  const TEXT_EXCLUDES = [
    { re: /טבעוני/, ids: ['veg', 'nodairy', 'noegg'] },
    { re: /צמחוני/, ids: ['veg'] },
    { re: /(בלי|ללא|לא אוכל|לא אוהב|אין|אלרגי)[^.,;\n]*(מוצרי חלב|חלבי|לקטוז)/, ids: ['nodairy'] },
    { re: /(בלי|ללא|לא אוכל|לא אוהב|שונא|אין|אלרגי)[^.,;\n]*(דגים|דג)(?= |$|[.,;])/, ids: ['nofish'] },
    { re: /(בלי|ללא|לא אוכל|אלרגי|רגיש)[^.,;\n]*(גלוטן|צליאק)/, ids: ['nogluten'] }
  ];

  // "לא אוהב טונה וקוטג׳, אין לי זמן לבשל" → ['טונה', 'קוטג׳'] (only phrases that
  // match a table food are kept, so "זמן לבשל" is ignored).
  function extractDislikes(text) {
    const out = [];
    const seen = {};
    String(text || '').split(/[.,;:!?\n()]+| אבל | כי | במקום | חוץ מ/).forEach(function (clause) {
      let c = ' ' + norm(clause) + ' ';
      let m = c.match(NEG_TRIGGER);
      while (m) {
        let rest = c.slice(m.index + m[0].length).trim();
        // a second trigger in the same clause starts its own list
        const next = (' ' + rest).match(NEG_TRIGGER);
        let tail = '';
        if (next) { tail = (' ' + rest).slice(next.index); rest = (' ' + rest).slice(0, next.index).trim(); }
        if (/^(לי )?(בעיה|מניעה|צורך לוותר)/.test(rest)) rest = ''; // "אין בעיה עם ביצים"
        rest.split(/ או | וגם | ולא | ו(?=[א-ת])/).forEach(function (piece) {
          const words = piece.trim().split(' ').filter(function (w) { return w && !FILLER[w] && w !== 'לי' && w !== 'את' && w !== 'בכלל'; }).slice(0, 3);
          if (!words.length) return;
          const term = words.join(' ');
          if (seen[term]) return;
          if (termIds(term).length) { seen[term] = 1; out.push(term); }
        });
        c = tail ? tail + ' ' : '';
        m = c ? c.match(NEG_TRIGGER) : null;
      }
    });
    return out;
  }

  function textExcludes(text) {
    const t = ' ' + norm(text) + ' ';
    const out = [];
    TEXT_EXCLUDES.forEach(function (x) { if (x.re.test(t)) x.ids.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); });
    return out;
  }

  function prefsText(prefs) {
    return [prefs.note, prefs.change].concat(prefs.rules || []).filter(Boolean).join('\n');
  }

  function effectiveExcludes(prefs) {
    const ex = (prefs.excludes || []).slice();
    textExcludes(prefsText(prefs)).forEach(function (id) { if (ex.indexOf(id) < 0) ex.push(id); });
    return ex;
  }

  const blockCache = {};
  // Every table id the menu must never contain for these prefs.
  function blockedIds(prefs) {
    prefs = prefs || {};
    const key = JSON.stringify([prefs.dislikes || [], prefs.dislikeTerms || [], prefsText(prefs), prefs.excludes || []]);
    if (blockCache[key]) return blockCache[key];
    const out = {};
    (prefs.dislikes || []).forEach(function (d) {
      if (byId[d]) { out[d] = 1; (FAMILY[d] || []).forEach(function (x) { out[x] = 1; }); return; }
      termIds(d).forEach(function (id) { out[id] = 1; });
    });
    (prefs.dislikeTerms || []).concat(extractDislikes(prefsText(prefs))).forEach(function (term) {
      termIds(term).forEach(function (id) { out[id] = 1; (FAMILY[id] || []).forEach(function (x) { out[x] = 1; }); });
    });
    const tags = blockedTags(effectiveExcludes(prefs));
    DB.forEach(function (f) { if ((f.tags || []).some(function (t) { return tags[t]; })) out[f.id] = 1; });
    const keys = Object.keys(blockCache);
    if (keys.length > 40) keys.forEach(function (k) { delete blockCache[k]; });
    blockCache[key] = out;
    return out;
  }

  function allowed(food, prefs, mealHas) {
    if (blockedIds(prefs)[food.id]) return false;
    // kosher-style: no meat and dairy in the same meal
    if (mealHas) {
      if (mealHas.meat && (food.tags || []).indexOf('dairy') >= 0) return false;
      if (mealHas.dairy && (food.tags || []).indexOf('meat') >= 0) return false;
    }
    return true;
  }

  function candidates(role, prefs, mealHas) {
    return DB.filter(function (f) { return (f.roles || []).indexOf(role) >= 0 && allowed(f, prefs, mealHas); });
  }

  function hasOf(foods) {
    const h = { meat: false, dairy: false };
    foods.forEach(function (f) {
      if ((f.tags || []).indexOf('meat') >= 0) h.meat = true;
      if ((f.tags || []).indexOf('dairy') >= 0) h.dairy = true;
    });
    return h;
  }

  function snap(food, g) {
    const st = food.st || 25;
    g = Math.round(g / st) * st;
    return Math.min(food.mx, Math.max(food.mn, g));
  }

  function choiceMenuFoods(prefs) {
    const n = SLOT_PLANS[prefs.meals] ? prefs.meals : 3;
    const seed = Number(prefs.seed) || 0;
    const used = {};
    return SLOT_PLANS[n].map(function (slot, si) {
      const foods = [];
      const items = [];
      SLOT_ROLES[slot[1]].forEach(function (role, ri) {
        const avoid = SLOT_AVOID[slot[1]] || [];
        const list = candidates(role, prefs, hasOf(foods)).filter(function (f) { return !used[f.id] && avoid.indexOf(f.id) < 0; });
        const pool = list.length ? list : candidates(role, prefs, hasOf(foods));
        if (!pool.length) return;
        const pick = pool[(seed + si * 3 + ri) % pool.length];
        used[pick.id] = 1;
        foods.push(pick);
        items.push({ food: pick, role: role, grams: pick.b });
      });
      return { name: slot[0], time: SLOT_TIMES[n][si], items: items };
    });
  }

  function sumMeals(meals) {
    const t = { k: 0, p: 0 };
    meals.forEach(function (m) {
      m.items.forEach(function (it) { t.k += it.food.k * it.grams / 100; t.p += it.food.p * it.grams / 100; });
    });
    return t;
  }

  function sumMacros(meals) {
    const t = { k: 0, p: 0, c: 0, f: 0 };
    meals.forEach(function (m) {
      m.items.forEach(function (it) {
        const r = it.grams / 100;
        t.k += it.food.k * r; t.p += it.food.p * r; t.c += (it.food.c || 0) * r; t.f += (it.food.f || 0) * r;
      });
    });
    return t;
  }

  // How far a day is from the targets (0 = inside every tolerance). Protein
  // short of target weighs most; carbs/fat only count when there is a target.
  function portionError(t, target) {
    const pT = Number(target.protein) || 0, kT = Number(target.calories) || 0;
    const cT = Number(target.carbs) || 0, fT = Number(target.fat) || 0;
    let e = 0;
    if (pT) { if (t.p < pT - 4) e += 3 * (pT - 4 - t.p) / pT; else if (t.p > pT + 20) e += (t.p - pT - 20) / pT; }
    if (kT) { const d = Math.abs(t.k - kT) - 60; if (d > 0) e += 2 * d / kT; }
    if (cT) { const d = Math.abs(t.c - cT) - 0.08 * cT; if (d > 0) e += 0.7 * d / cT; }
    if (fT) { const d = Math.abs(t.f - fT) - 0.1 * fT; if (d > 0) e += 0.7 * d / fT; }
    return e;
  }

  // Day-level carbs/fat (v48): after the protein/calorie pass, single portion
  // steps that bring the day closer to all four targets.
  function refineMacros(meals, items, target) {
    let err = portionError(sumMacros(meals), target);
    for (let n = 0; n < 160 && err > 0; n++) {
      let best = null;
      items.forEach(function (it) {
        const st = it.food.st || 25;
        [st, -st].forEach(function (d) {
          const ng = it.grams + d;
          if (ng > it.food.mx || ng < it.food.mn) return;
          const old = it.grams;
          it.grams = ng;
          const e = portionError(sumMacros(meals), target);
          it.grams = old;
          if (e < err - 1e-4 && (!best || e < best.e)) best = { it: it, ng: ng, e: e };
        });
      });
      if (!best) break;
      best.it.grams = best.ng;
      err = best.e;
    }
  }

  function fitPortions(meals, target) {
    const all = [];
    // locked items (meals the user did not ask to change) count toward the
    // totals but keep their grams
    meals.forEach(function (m) { m.items.forEach(function (it) { if (!it.locked) all.push(it); }); });
    const prot = all.filter(function (it) { return PROTEIN_ROLES[it.role]; });
    const carbs = all.filter(function (it) { return CARB_ROLES[it.role]; });
    const fats = all.filter(function (it) { return it.role === 'fat'; });
    const pT = Number(target.protein) || 0;
    const kT = Number(target.calories) || 0;
    let guard = 0;
    function step(list, dir, metric) {
      // grow/shrink the item that moves the metric most per calorie
      let best = null;
      list.forEach(function (it) {
        const st = it.food.st || 25;
        const ng = it.grams + dir * st;
        if (ng > it.food.mx || ng < it.food.mn) return;
        const score = metric === 'p' ? it.food.p / Math.max(1, it.food.k) : it.food.k;
        if (!best || score > best.score) best = { it: it, ng: ng, score: score };
      });
      if (best) best.it.grams = best.ng;
      return !!best;
    }
    if (pT) {
      while (guard++ < 200 && sumMeals(meals).p < pT - 4) if (!step(prot, 1, 'p')) break;
      while (guard++ < 400 && sumMeals(meals).p > pT + 20) if (!step(prot, -1, 'p')) break;
    }
    if (kT) {
      let rr = 0;
      while (guard++ < 800 && sumMeals(meals).k < kT - 60) {
        const order = [carbs, fats, prot];
        let moved = false;
        for (let i = 0; i < order.length && !moved; i++) {
          const list = order[i];
          if (!list.length) continue;
          for (let j = 0; j < list.length && !moved; j++) {
            const it = list[(rr + j) % list.length];
            const ng = it.grams + (it.food.st || 25);
            if (ng <= it.food.mx) { it.grams = ng; moved = true; }
          }
        }
        rr++;
        if (!moved) break;
      }
      while (guard++ < 1200 && sumMeals(meals).k > kT + 60) {
        const order = [fats, carbs];
        let moved = false;
        for (let i = 0; i < order.length && !moved; i++) {
          const list = order[i];
          for (let j = 0; j < list.length && !moved; j++) {
            const it = list[(rr + j) % list.length];
            const ng = it.grams - (it.food.st || 25);
            if (ng >= it.food.mn) { it.grams = ng; moved = true; }
          }
        }
        rr++;
        if (!moved) break;
      }
    }
    all.forEach(function (it) { it.grams = snap(it.food, it.grams); });
    if (Number(target.carbs) || Number(target.fat)) {
      refineMacros(meals, all, target);
      all.forEach(function (it) { it.grams = snap(it.food, it.grams); });
    }
  }

  function toMenuFood(food, grams, role) {
    const it = itemFor(food, grams);
    return { foodId: '', dbId: food.id, role: role || '', grams: it.grams, name: it.label, qty: 1,
      protein: it.protein, calories: it.calories, carbs: it.carbs, fat: it.fat };
  }

  // prefs: { protein, calories, meals: 3|4|5, excludes: [ids], dislikes: [foodIds], seed }
  // A plain dish title from a meal's foods when the AI did not name it (rule
  // menus, old saved menus, after a swap): "חזה עוף עם אורז וסלט ירקות".
  function shortName(food) {
    return String(food.name || '').replace(/\s*\d+(\.\d+)?%/, '').replace(/^אבקת חלבון$/, 'שייק חלבון').trim();
  }
  function withVav(w) { return 'ו' + w; }
  function dishName(foods) {
    const list = (foods || []).map(function (f) {
      const food = f && (byId[f.dbId] || null);
      return food ? { food: food, role: f.role || (food.roles || [])[0] || '' } : null;
    }).filter(Boolean);
    if (!list.length) return '';
    const pick = function (roles) { const x = list.find(function (it) { return roles.indexOf(it.role) >= 0; }); return x ? shortName(x.food) : ''; };
    const prot = pick(['mp', 'bp', 'sp']);
    const carb = pick(['mc', 'bc']);
    const veg = pick(['veg']);
    const fruit = pick(['fruit', 'nut']);
    if (prot && carb) return prot + ' עם ' + carb + (veg ? ' ' + withVav(veg) : '');
    if (prot && (veg || fruit)) return prot + ' ' + withVav(veg || fruit);
    const names = list.slice(0, 2).map(function (it) { return shortName(it.food); });
    return names.length === 2 ? names[0] + ' ' + withVav(names[1]) : names[0];
  }

  function buildMenu(prefs) {
    prefs = prefs || {};
    const meals = choiceMenuFoods(prefs);
    fitPortions(meals, prefs);
    return {
      name: 'התפריט שלי',
      meals: meals.map(function (m) {
        const foods = m.items.map(function (it) { return toMenuFood(it.food, it.grams, it.role); });
        return { name: m.name, time: m.time, dish: dishName(foods), prep: '', foods: foods };
      })
    };
  }

  // Alternatives for a menu item: same role, allowed, sized to match the
  // original's protein (protein roles) or calories (others).
  function swapOptions(item, prefs, mealFoods) {
    const cur = byId[item.dbId];
    const role = item.role || (cur && cur.roles && cur.roles[0]) || '';
    const others = (mealFoods || []).filter(function (f) { return f.dbId !== item.dbId; }).map(function (f) { return byId[f.dbId]; }).filter(Boolean);
    const h = hasOf(others);
    let pool = role ? candidates(role, prefs || {}, h) : [];
    if (!pool.length && cur) pool = DB.filter(function (f) { return f.id !== cur.id && allowed(f, prefs || {}, h); });
    const usePro = !!PROTEIN_ROLES[role];
    const goal = usePro ? Number(item.protein) || 0 : Number(item.calories) || 0;
    return pool.filter(function (f) { return f.id !== item.dbId; }).map(function (f) {
      const per = usePro ? f.p : f.k;
      const g = per > 0 && goal > 0 ? snap(f, goal / per * 100) : f.b;
      const mf = toMenuFood(f, g, role);
      const diff = Math.abs((usePro ? mf.protein : mf.calories) - goal) / Math.max(1, goal);
      return { food: mf, diff: diff };
    }).sort(function (a, b) { return a.diff - b.diff; }).slice(0, 6).map(function (x) { return x.food; });
  }

  // Calorie estimate when no target is set: bodyweight × 30 (maintenance), goal-adjusted.
  function estimateCalories(weightKg, goal) {
    const w = Number(weightKg) || 0;
    const base = w > 30 ? w * 30 : 2200;
    const mult = goal === 'cut' ? 0.85 : (goal === 'bulk' ? 1.1 : 1);
    return Math.round(base * mult / 50) * 50;
  }

  function choosable() {
    return DB.filter(function (f) { return (f.roles || []).length; });
  }


  // ---------- Hooks for an optional (LLM) provider ----------
  const UNIT_ALIASES = { 'יחידה': 'unit', 'unit': 'unit', 'piece': 'unit', 'g': 'g', 'גרם': 'g', 'ml': 'ml' };
  let textProvider = null;
  function setTextProvider(fn) { textProvider = typeof fn === 'function' ? fn : null; }

  // Turn a provider spec into a table-backed item (or an unmatched item).
  function resolveSpec(spec) {
    if (!spec || !spec.name) return null;
    const food = matchFood(spec.name);
    const g = Number(spec.grams);
    if (food && g > 0 && g < 5000) return itemFor(food, g, spec.name);
    const unitKey = spec.unit ? (UNIT_WORDS[norm(spec.unit)] || UNIT_ALIASES[spec.unit] || '') : '';
    let unitWord = '';
    if (unitKey) unitWord = Object.keys(UNIT_WORDS).find(function (w) { return UNIT_WORDS[w] === unitKey; }) || '';
    const q = Number(spec.qty) > 0 ? String(spec.qty) : '';
    return parseSegment([q, unitWord, spec.name].filter(Boolean).join(' '));
  }

  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function parseFoodText(text, opts) {
    opts = opts || {};
    const provider = opts.provider || textProvider;
    return parseAsync(text).then(function (items) {
      const unmatched = items.filter(function (i) { return i.unmatched; });
      if (!provider || (!unmatched.length && !opts.always)) return items;
      return withTimeout(Promise.resolve(provider({ text: text, items: items, unmatched: unmatched })), opts.timeoutMs || 12000)
        .then(function (specs) {
          const resolved = (Array.isArray(specs) ? specs : []).map(resolveSpec).filter(Boolean);
          if (!resolved.length) return items;
          if (opts.always) return resolved;
          // keep rule-matched items, replace the unmatched ones with provider results
          return items.filter(function (i) { return !i.unmatched; }).concat(resolved);
        })
        .catch(function () { return items; });
    });
  }

  // The foods the model may pick from: menu foods (with a role) that these
  // prefs allow. Disliked/excluded foods are never even shown to the model.
  function catalog(prefs) {
    const list = prefs ? choosable().filter(function (f) { return allowed(f, prefs); }) : DB;
    return list.map(function (f) {
      const c = COOK[f.id];
      return {
        id: f.id, name: f.name, roles: (f.roles || []).slice(), tags: (f.tags || []).slice(),
        per100: { kcal: f.k, protein: f.p, carbs: f.c, fat: f.f },
        min: f.mn, max: f.mx, state: c ? (c.base === 'cooked' ? 'מבושל' : 'יבש') : ''
      };
    });
  }

  // Meal slots (name, time, kind) for the chosen number of meals.
  function slotsFor(prefs) {
    const n = SLOT_PLANS[prefs && prefs.meals] ? prefs.meals : 4;
    return SLOT_PLANS[n].map(function (sl, i) { return { name: sl[0], time: SLOT_TIMES[n][i], kind: sl[1] }; });
  }

  // A role-matching stand-in for a food the menu may not contain.
  function replacementFor(role, prefs, mealFoods, usedIds) {
    const pool = role ? candidates(role, prefs, hasOf(mealFoods)) : [];
    const fresh = pool.filter(function (f) { return !usedIds[f.id] && mealFoods.indexOf(f) < 0; });
    return fresh[0] || pool.filter(function (f) { return mealFoods.indexOf(f) < 0; })[0] || null;
  }

  // Validate a provider menu spec into the same shape buildMenu returns.
  // Hard rules re-applied here no matter what the model returned: only table
  // foods that were in the catalog, nothing disliked/excluded, no meat+dairy
  // in one meal, no duplicates in a meal. A dropped food is replaced by an
  // allowed food with the same role so the meal stays balanced.
  // opts.locked: { specMealIndex: true } — meals kept as they are (their
  // grams are not re-fitted) unless a food in them had to be replaced.
  function menuFromSpec(spec, prefs, opts) {
    prefs = prefs || {};
    opts = opts || {};
    const locked = opts.locked || {};
    const okIds = {};
    catalog(prefs).forEach(function (c) { okIds[c.id] = 1; });
    const used = {};
    const replaced = [];
    const meals = ((spec && spec.meals) || []).map(function (m, i) {
      const items = [];
      const replacedBefore = replaced.length;
      ((m && m.foods) || []).forEach(function (f) {
        if (!f) return;
        let food = byId[f.dbId] || null;
        const others = items.map(function (x) { return x.food; });
        let role = f.role && food && (food.roles || []).indexOf(f.role) >= 0 ? f.role
          : (food && (food.roles || [])[0]) || (ROLE_NAMES[f.role] ? f.role : '');
        if (!food || !okIds[food.id] || !allowed(food, prefs, hasOf(others)) || others.indexOf(food) >= 0) {
          const alt = replacementFor(role, prefs, others, used);
          replaced.push({ from: food ? food.id : String(f.dbId || ''), to: alt ? alt.id : '' });
          if (!alt) return;
          food = alt;
          f = { grams: 0 };
        }
        used[food.id] = 1;
        const g = Number(f.grams) > 0 ? snap(food, Number(f.grams)) : food.b;
        items.push({ food: food, role: role || ((food.roles || [])[0] || ''), grams: g });
      });
      // The AI's dish title/prep only if every food it named is still there
      // and the title does not mention something blocked.
      const keepText = replaced.length === replacedBefore && !mentionsBlocked(m && m.dish, prefs) && !mentionsBlocked(m && m.prep, prefs);
      const lock = !!locked[i] && replaced.length === replacedBefore;
      if (lock) items.forEach(function (it) { it.locked = true; });
      return {
        src: i, locked: lock,
        name: String((m && m.name) || ('ארוחה ' + (i + 1))), time: (m && m.time) || '', items: items,
        dish: keepText ? String((m && m.dish) || '').trim().slice(0, 50) : '',
        prep: keepText ? String((m && m.prep) || '').trim().slice(0, 140) : ''
      };
    }).filter(function (m) { return m.items.length; });
    if (!meals.length) return null;
    fitPortions(meals, prefs);
    return {
      name: 'התפריט שלי',
      replaced: replaced,
      meals: meals.map(function (m) {
        const foods = m.items.map(function (it) { return toMenuFood(it.food, it.grams, it.role); });
        const out = { name: m.name, time: m.time, dish: m.dish || dishName(foods), prep: m.prep, foods: foods };
        if (opts.locked) { out.src = m.src; out.locked = m.locked; }
        return out;
      })
    };
  }

  // Does free text name a blocked food? (head word of the food's name/aliases)
  function mentionsBlocked(text, prefs) {
    const t = bare(text || '');
    if (!t) return false;
    const blocked = blockedIds(prefs);
    return Object.keys(blocked).some(function (id) {
      const f = byId[id];
      if (!f) return false;
      return [f.name].concat(f.al || []).some(function (a) {
        const head = bare(a).replace(/\s*\d+%?$/, '').trim();
        return head.length >= 3 && wordIn(t, head);
      });
    });
  }
  const ROLE_NAMES = { bp: 1, bc: 1, mp: 1, mc: 1, veg: 1, fat: 1, sp: 1, fruit: 1, nut: 1 };

  const FitFood = {
    DB: DB, byId: byId, norm: norm, splitSegments: splitSegments, matchFood: matchFood,
    parse: parse, parseAsync: parseAsync, parseSegment: parseSegment, registerResolver: registerResolver,
    itemFor: itemFor, rescale: rescale, totals: totals, macros: macros, portionLabel: portionLabel,
    searchProducts: searchProducts, lookupBarcode: lookupBarcode, offItem: offItem,
    buildMenu: buildMenu, swapOptions: swapOptions, estimateCalories: estimateCalories,
    EXCLUDE_OPTIONS: EXCLUDE_OPTIONS, choosable: choosable, unitGrams: unitGrams,
    parseFoodText: parseFoodText, setTextProvider: setTextProvider, resolveSpec: resolveSpec,
    menuFromSpec: menuFromSpec, catalog: catalog,
    slotsFor: slotsFor, blockedIds: blockedIds, fitPortions: fitPortions, sumMacros: sumMacros, textExcludes: textExcludes, dishName: dishName, mentionsBlocked: mentionsBlocked, extractDislikes: extractDislikes, termIds: termIds,
    COOK: COOK, cookInfo: cookInfo, cookAlt: cookAlt, cookStateOf: cookStateOf,
    hasTextProvider: function () { return !!textProvider; }
  };
  root.FitFood = FitFood;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitFood;
})(typeof window !== 'undefined' ? window : globalThis);
