// Pure logic for the llm gateway (no Deno APIs) so it can be unit-tested in Node.

// USD per 1M tokens (paid Standard tier, gemini-api/docs/pricing, read 2026-11-24).
// Where a price rises on a published date we use the higher price so the cap
// is never under-counted. Output includes thinking tokens. On the free tier
// Google charges $0; this is the list-price estimate the cap is enforced on.
export const PRICES: Record<string, { in: number; out: number }> = {
  "gemini-3.8-flash": { in: 1.5, out: 7.5 },
  "gemini-3-flash-preview": { in: 0.5, out: 3.0 },
  "gemini-flash-latest": { in: 1.5, out: 7.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-3.1-flash-lite-preview": { in: 0.25, out: 1.5 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-flash-lite-latest": { in: 0.3, out: 2.5 },
};

export function costUsd(model: string, inTok: number, outTok: number) {
  const p = PRICES[model] || { in: 1.5, out: 7.5 };
  return ((Number(inTok) || 0) * p.in + (Number(outTok) || 0) * p.out) / 1e6;
}

function tzParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // YYYY-MM-DD
}
export function jerusalemDay(d: Date) { return tzParts(d); }
export function jerusalemMonth(d: Date) { return tzParts(d).slice(0, 7); }

const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

const FOOD_SCHEMA = S("OBJECT", {
  properties: {
    items: S("ARRAY", {
      items: S("OBJECT", {
        properties: {
          name: S("STRING", { description: "שם המאכל בעברית, יחיד. אם יש שם תואם ברשימה – בדיוק אותו שם" }),
          qty: S("NUMBER", { description: "כמות; 1 אם לא נאמר" }),
          unit: S("STRING", { description: "יחידה בעברית (פרוסה, כף, כוס, גביע, יחידה...) או ריק" }),
          grams: S("NUMBER", { description: "גרמים רק אם נאמרו במפורש, אחרת 0" }),
        },
        required: ["name", "qty"],
      }),
    }),
  },
  required: ["items"],
});

const MENU_SCHEMA = S("OBJECT", {
  properties: {
    reply: S("STRING", { description: "משפט-שניים בעברית: מה בנית/שינית ולמה" }),
    meals: S("ARRAY", {
      items: S("OBJECT", {
        properties: {
          name: S("STRING"),
          time: S("STRING", { description: "HH:MM" }),
          dish: S("STRING", { description: "שם המנה בעברית" }),
          prep: S("STRING", { description: "שורה אחת: איך מכינים" }),
          foods: S("ARRAY", {
            items: S("OBJECT", {
              properties: { dbId: S("STRING"), grams: S("NUMBER"), role: S("STRING") },
              required: ["dbId", "grams"],
            }),
          }),
        },
        required: ["name", "foods"],
      }),
    }),
  },
  required: ["reply", "meals"],
});

const PLAN_SCHEMA = S("OBJECT", {
  properties: {
    reply: S("STRING", { description: "2-4 משפטים בעברית: מבנה התוכנית ולמה, או שאלה אחת קצרה אם חסר מידע קריטי" }),
    plan: S("OBJECT", {
      properties: {
        name: S("STRING"),
        days: S("ARRAY", {
          items: S("OBJECT", {
            properties: {
              name: S("STRING", { description: "שם קצר, למשל 'דחיפה A' או 'רגליים'" }),
              weekday: S("INTEGER", { description: "0=ראשון ... 6=שבת" }),
              type: S("STRING", { enum: ["chest", "back", "legs", "shoulders", "arms", "full", "custom"] }),
              exercises: S("ARRAY", {
                items: S("OBJECT", {
                  properties: {
                    name: S("STRING"),
                    sets: S("INTEGER"),
                    repsMin: S("INTEGER"),
                    repsMax: S("INTEGER"),
                    restSec: S("INTEGER"),
                    supersetWithNext: S("BOOLEAN"),
                    notes: S("STRING"),
                  },
                  required: ["name", "sets", "repsMin", "repsMax"],
                }),
              }),
            },
            required: ["name", "weekday", "exercises"],
          }),
        }),
      },
      required: ["name", "days"],
    }),
  },
  required: ["reply", "plan"],
});

type Task = { models: string[]; attemptMs: number; deadlineMs: number; maxOut: number; thinking: string };
export const TASKS: Record<string, Task> = {
  food: { models: ["gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3-flash-preview"], attemptMs: 5000, deadlineMs: 11000, maxOut: 1200, thinking: "minimal" },
  // flash-lite answers a menu in ~3 s; gemini-3.8-flash never finished in 14 s
  // on the free tier, so it is no longer in the chain.
  menu: { models: ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"], attemptMs: 9000, deadlineMs: 24000, maxOut: 4000, thinking: "low" },
  // v48: the menu chat (one flow: build, edit, ask, with memory updates)
  menuchat: { models: ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"], attemptMs: 10000, deadlineMs: 24000, maxOut: 4000, thinking: "low" },
  plan: { models: ["gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3-flash-preview"], attemptMs: 18000, deadlineMs: 55000, maxOut: 8000, thinking: "low" },
};

const clip = (s: unknown, n: number) => String(s == null ? "" : s).slice(0, n);
const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []);

function foodPrompt(input: Record<string, unknown>) {
  const names = arr(input.names, 400).map((x) => clip(x, 40)).join(", ");
  return {
    system: "אתה מפרק תיאור חופשי בעברית של מה שמישהו אכל לרשימת פריטים וכמויות. אל תחשב קלוריות או ערכים תזונתיים. " +
      "פריט מורכב (למשל 'סנדוויץ׳ טונה') פרק לרכיבים העיקריים. כתוב name כפי שמופיע ברשימת המאכלים המוכרים כשיש התאמה סבירה; אחרת שם גנרי קצר בעברית. " +
      "אל תמציא פריטים שלא נאמרו. qty מספר (שתיים=2, חצי=0.5). grams רק אם נאמר במפורש משקל בגרמים.",
    user: "מאכלים מוכרים: " + names + "\n\nהטקסט: " + clip(input.text, 600),
  };
}

const MEAL_SHARE: Record<string, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.28, snack: 0.12 };
const GOAL_HE: Record<string, string> = { cut: "חיטוב (גירעון קלורי, חלבון גבוה, נפח ירקות)", keep: "שמירה", bulk: "מסה (עודף קל, פחמימה סביב האימון)" };
const DEFAULT_SLOTS: Record<number, Array<[string, string, string]>> = {
  3: [["בוקר", "08:00", "breakfast"], ["צהריים", "13:30", "lunch"], ["ערב", "19:30", "dinner"]],
  4: [["בוקר", "08:00", "breakfast"], ["צהריים", "13:00", "lunch"], ["ביניים", "16:30", "snack"], ["ערב", "20:00", "dinner"]],
  5: [["בוקר", "07:30", "breakfast"], ["ביניים", "10:30", "snack"], ["צהריים", "13:30", "lunch"], ["ביניים אחה״צ", "16:30", "snack"], ["ערב", "20:00", "dinner"]],
};

// The catalog the model may use: what the app sent minus anything blocked
// (dislikes/exclusions; older app versions sent `prefs.dislikes`).
export function menuCatalog(input: Record<string, unknown>) {
  const p = (input.prefs || {}) as Record<string, unknown>;
  const blocked = new Set<string>([...arr(input.blocked, 120), ...arr(p.dislikes, 120)].map((x) => String(x)));
  return (arr(input.catalog, 300) as Array<Record<string, unknown>>).filter((f) => f && f.id && !blocked.has(String(f.id)));
}

export function menuSlots(input: Record<string, unknown>) {
  const p = (input.prefs || {}) as Record<string, unknown>;
  const sent = (arr(input.slots, 6) as Array<Record<string, unknown>>).filter((s) => s && s.name);
  if (sent.length) return sent.map((s) => ({ name: clip(s.name, 20), time: clip(s.time, 5), kind: MEAL_SHARE[String(s.kind)] ? String(s.kind) : "snack" }));
  const n = DEFAULT_SLOTS[Number(p.meals)] ? Number(p.meals) : 4;
  return DEFAULT_SLOTS[n].map(([name, time, kind]) => ({ name, time, kind }));
}

function menuPrompt(input: Record<string, unknown>) {
  const p = (input.prefs || {}) as Record<string, unknown>;
  const kcal = Math.round(Number(p.calories) || 0);
  const prot = Math.round(Number(p.protein) || 0);
  const slots = menuSlots(input);
  const total = slots.reduce((a, s) => a + MEAL_SHARE[s.kind], 0) || 1;
  const mealLines = slots.map((s) => {
    const sh = MEAL_SHARE[s.kind] / total;
    return "- " + s.name + " " + s.time + ": ~" + Math.round(kcal * sh / 10) * 10 + " קק״ל, ~" + Math.round(prot * sh) + " ג׳ חלבון";
  }).join("\n");
  const cat = menuCatalog(input).map((f) => {
    const n = (f.per100 || {}) as Record<string, unknown>;
    const range = f.min && f.max ? Number(f.min) + "-" + Number(f.max) : "";
    return [clip(f.id, 30), clip(f.name, 40), arr(f.roles, 6).join("/"), arr(f.tags, 6).join("/"), range, clip(f.state, 8),
      n.kcal + "/" + n.protein + "/" + n.carbs + "/" + n.fat].join("|");
  }).join("\n");
  const goal = GOAL_HE[String(p.goal)] || clip(p.goal, 20) || "שמירה";
  const excl = arr(p.excludes, 10).map((x) => clip(x, 20)).filter(Boolean).join(", ");
  const cur = input.current ? "\nהתפריט הנוכחי (שנה רק מה שהתבקש, השאר כמו שהוא):\n" + clip(JSON.stringify(input.current), 3000) : "";
  return {
    system: "אתה דיאטן ספורט ישראלי. בונים תפריט ליום אחד מתוך קטלוג סגור.\n" +
      "חוקים מחייבים (הפרה פוסלת את התשובה):\n" +
      "1. dbId רק מהקטלוג, מועתק בדיוק. מאכל שלא בקטלוג אסור – המשתמש לא אוכל אותו. אל תציע אותו גם ב-reply.\n" +
      "2. בדיוק הארוחות שברשימה, באותו סדר, אותו name ו-time.\n" +
      "3. אין בשר (meat) ומוצרי חלב (dairy) באותה ארוחה.\n" +
      "4. grams בתוך טווח הגרמים של המאכל, במצב שבעמודת המצב (מבושל = משקל אחרי בישול, יבש = לפני). בלי מצב = כפי שנאכל.\n" +
      "5. ארוחה עיקרית: מקור חלבון (bp/mp) + פחמימה (bc/mc) + ירק (veg), ואפשר תוספת שומן (fat). ביניים: 1-2 פריטים (sp/fruit/nut).\n" +
      "6. אותו מקור חלבון עיקרי לא חוזר ביותר מארוחה אחת; לא אותו מאכל פעמיים באותה ארוחה.\n" +
      "יעדים: התקרב ליעד היומי ולחלוקה לארוחות (±10%); האפליקציה מכווננת גרמים בסוף, אז העיקר לבחור מאכלים שמאפשרים להגיע לחלבון בלי לחרוג בקלוריות.\n" +
      "העדפות (רכות, לפי הסדר): מה שהמשתמש כתב במילים שלו; אוכל ישראלי יומיומי מהסופר; הכנה עד 15 דקות; בוקר וערב חלביים/ביצים וצהריים בשרי או דג; גיוון בין הארוחות.\n" +
      "לכל ארוחה: dish = שם מנה טבעי בעברית כמו שאומרים בבית (למשל 'שקשוקה עם לחם מלא', 'קערת עוף, אורז וברוקולי', 'יוגורט חלבון עם בננה'), שמתאר רק את המאכלים שבחרת; prep = שורה אחת קצרה איך מכינים (בלי כמויות).\n" +
      "role = התפקיד של המאכל מהקטלוג. reply: משפט-שניים חמים בעברית מה בנית ולמה, בלי מספרים.",
    user: "יעד יומי: " + kcal + " קק״ל, " + prot + " ג׳ חלבון. מטרה: " + goal + "." +
      (excl ? "\nהגבלות: " + excl + " (כבר הוסרו מהקטלוג)." : "") +
      "\nארוחות:\n" + mealLines +
      (p.note ? "\nבמילים שלו: " + clip(p.note, 400) : "") + (p.change ? "\nבקשת שינוי: " + clip(p.change, 400) : "") + cur +
      "\n\nקטלוג (id|שם|תפקידים|תגיות|גרם מינ׳-מקס׳|מצב|ל-100 ג׳: קק״ל/חלבון/פחמימה/שומן):\n" + cat,
  };
}

// Same shape as MENU_SCHEMA but dbId/role are enums of the allowed values, so
// the model cannot even emit a food outside the (filtered) catalog.
function menuSchema(input: Record<string, unknown>) {
  const ids = menuCatalog(input).map((f) => clip(f.id, 30)).filter(Boolean);
  if (!ids.length) return MENU_SCHEMA;
  return S("OBJECT", {
    properties: {
      reply: S("STRING", { description: "משפט-שניים בעברית: מה בנית/שינית ולמה" }),
      meals: S("ARRAY", {
        items: S("OBJECT", {
          properties: {
            name: S("STRING"),
            time: S("STRING", { description: "HH:MM" }),
            dish: S("STRING", { description: "שם מנה קצר וטבעי בעברית, 2-6 מילים" }),
            prep: S("STRING", { description: "שורה אחת, עד 14 מילים: איך מכינים" }),
            foods: S("ARRAY", {
              items: S("OBJECT", {
                properties: {
                  dbId: S("STRING", { format: "enum", enum: ids }),
                  grams: S("NUMBER"),
                  role: S("STRING", { format: "enum", enum: ["bp", "bc", "mp", "mc", "veg", "fat", "sp", "fruit", "nut"] }),
                },
                required: ["dbId", "grams", "role"],
              }),
            }),
          },
          required: ["name", "time", "dish", "prep", "foods"],
        }),
      }),
    },
    required: ["reply", "meals"],
  });
}

export const MEMORY_CATS: Record<string, string> = { avoid: "לא אוכל", like: "מועדף", habit: "הרגלים", logistics: "לוגיסטיקה", goal: "מטרות" };

function catalogLines(input: Record<string, unknown>) {
  return menuCatalog(input).map((f) => {
    const n = (f.per100 || {}) as Record<string, unknown>;
    const range = f.min && f.max ? Number(f.min) + "-" + Number(f.max) : "";
    return [clip(f.id, 30), clip(f.name, 40), arr(f.roles, 6).join("/"), arr(f.tags, 6).join("/"), range, clip(f.state, 8),
      n.kcal + "/" + n.protein + "/" + n.carbs + "/" + n.fat].join("|");
  }).join("\n");
}

// The menu chat. Only what the user wrote about food habits (memory), the
// targets, the current menu and the catalog: no name, weight or account data.
function menuChatPrompt(input: Record<string, unknown>) {
  const t = (input.targets || {}) as Record<string, unknown>;
  const r = (v: unknown) => Math.round(Number(v) || 0);
  const mem = (arr(input.memory, 40) as Array<Record<string, unknown>>)
    .map((m) => "- " + (MEMORY_CATS[String(m && m.cat)] || "הערה") + ": " + clip(m && m.text, 80)).join("\n");
  const cur = input.current ? clip(JSON.stringify(input.current), 3500) : "";
  return {
    system: "אתה דיאטן ספורט ישראלי שמנהל בצ'אט קצר בעברית את התפריט הקבוע של המשתמש (יום אחד שחוזר כל השבוע), מתוך קטלוג סגור.\n" +
      "בכל תור בחר action:\n" +
      "- build: תפריט חדש ומלא (כשאין תפריט, או כשביקש תפריט חדש).\n" +
      "- edit: שינוי בתפריט הקיים. החזר את כל הארוחות; ארוחה שלא ביקשו לשנות – העתק אותה בדיוק (אותם dbId, grams, dish, prep, name, time).\n" +
      "- ask: חסר מידע שבלעדיו אי אפשר לבנות טוב – שאלה קצרה אחת ב-reply ו-meals ריק. אל תשאל סתם; אם אפשר לנחש בסבירות, בנה.\n" +
      "- none: רק תשובה או הסבר, meals ריק.\n" +
      "חוקים מחייבים בכל תפריט (הפרה פוסלת את התשובה):\n" +
      "1. dbId רק מהקטלוג, מועתק בדיוק. מאכל שלא בקטלוג אסור – המשתמש לא אוכל אותו. אל תציע אותו גם ב-reply.\n" +
      "2. בתפריט חדש: מספר הארוחות לפי הזיכרון או הבקשה, אחרת 4 (בוקר 08:00, צהריים 13:00, ביניים 16:30, ערב 20:00). בעריכה: אותן ארוחות, שמות ושעות, אלא אם ביקש אחרת.\n" +
      "3. אין בשר (meat) ומוצרי חלב (dairy) באותה ארוחה.\n" +
      "4. grams בתוך טווח הגרמים של המאכל, במצב שבעמודת המצב (מבושל = משקל אחרי בישול, יבש = לפני). בלי מצב = כפי שנאכל.\n" +
      "5. ארוחה עיקרית: מקור חלבון (bp/mp) + פחמימה (bc/mc) + ירק (veg), ואפשר שומן (fat). ביניים: 1-2 פריטים (sp/fruit/nut).\n" +
      "6. אותו מקור חלבון עיקרי לא חוזר ביותר מארוחה אחת; לא אותו מאכל פעמיים באותה ארוחה.\n" +
      "יעדים: התקרב ליעדים היומיים; האפליקציה מכווננת גרמים בסוף, אז העיקר לבחור מאכלים שמאפשרים להגיע אליהם.\n" +
      "הזיכרון הוא מה שהמשתמש סיפר על עצמו – כבד אותו תמיד. העדפות נוספות: אוכל ישראלי יומיומי מהסופר, הכנה קצרה, גיוון.\n" +
      "memory: עדכוני זיכרון רק ממה שהמשתמש כתב בהודעה האחרונה. add: העדפה קבועה חדשה שלא מופיעה כבר, טקסט קצר עד 6 מילים בלי 'המשתמש' " +
      "(cat: avoid = לא אוכל – רק שם המאכל, למשל 'טונה'; like = מועדף; habit = הרגלים, למשל 'אין זמן לבשל בבוקר'; logistics = לוגיסטיקה, למשל 'צהריים בעבודה'; goal = מטרות). " +
      "לא דברים זמניים (היום, הערב, השבוע) ולא פרטים מזהים (שם, גיל, משקל, מקום). remove: הטקסט המדויק של פריטי זיכרון שהמשתמש ביטל או סתר. אם אין – מערכים ריקים.\n" +
      "לכל ארוחה: dish = שם מנה טבעי בעברית כמו שאומרים בבית, שמתאר רק את המאכלים שבחרת; prep = שורה אחת קצרה איך מכינים (בלי כמויות).\n" +
      "role = התפקיד של המאכל מהקטלוג. reply: משפט-שניים חמים בעברית – מה שינית ולמה, או השאלה – בלי מספרים.",
    user: "יעדים יומיים: " + r(t.calories) + " קק״ל, " + r(t.protein) + " ג׳ חלבון, " + r(t.carbs) + " ג׳ פחמימה, " + r(t.fat) + " ג׳ שומן." +
      "\nזיכרון:\n" + (mem || "(ריק)") +
      "\n" + (cur ? "התפריט הנוכחי:\n" + cur : "אין עדיין תפריט.") +
      "\n\nקטלוג (id|שם|תפקידים|תגיות|גרם מינ׳-מקס׳|מצב|ל-100 ג׳: קק״ל/חלבון/פחמימה/שומן):\n" + catalogLines(input),
  };
}

function menuChatSchema(input: Record<string, unknown>) {
  const ids = menuCatalog(input).map((f) => clip(f.id, 30)).filter(Boolean);
  const food = ids.length
    ? S("OBJECT", {
      properties: {
        dbId: S("STRING", { format: "enum", enum: ids }),
        grams: S("NUMBER"),
        role: S("STRING", { format: "enum", enum: ["bp", "bc", "mp", "mc", "veg", "fat", "sp", "fruit", "nut"] }),
      },
      required: ["dbId", "grams", "role"],
    })
    : S("OBJECT", { properties: { dbId: S("STRING"), grams: S("NUMBER"), role: S("STRING") }, required: ["dbId", "grams"] });
  return S("OBJECT", {
    properties: {
      reply: S("STRING", { description: "משפט-שניים בעברית: מה עשית, או שאלה אחת" }),
      action: S("STRING", { format: "enum", enum: ["build", "edit", "ask", "none"] }),
      meals: S("ARRAY", {
        items: S("OBJECT", {
          properties: {
            name: S("STRING"),
            time: S("STRING", { description: "HH:MM" }),
            dish: S("STRING", { description: "שם מנה קצר וטבעי בעברית, 2-6 מילים" }),
            prep: S("STRING", { description: "שורה אחת, עד 14 מילים: איך מכינים" }),
            foods: S("ARRAY", { items: food }),
          },
          required: ["name", "time", "dish", "prep", "foods"],
        }),
      }),
      memory: S("OBJECT", {
        properties: {
          add: S("ARRAY", {
            items: S("OBJECT", {
              properties: { cat: S("STRING", { format: "enum", enum: Object.keys(MEMORY_CATS) }), text: S("STRING") },
              required: ["cat", "text"],
            }),
          }),
          remove: S("ARRAY", { items: S("STRING") }),
        },
        required: ["add", "remove"],
      }),
    },
    required: ["reply", "action", "meals", "memory"],
  });
}

function planPrompt(input: Record<string, unknown>) {
  const p = (input.prefs || {}) as Record<string, unknown>;
  const known = arr(input.known, 150).map((x) => clip(x, 40)).join(", ");
  const rec = input.recovery == null || input.recovery === "" ? "לא ידוע" : Number(input.recovery) + "%";
  const cur = input.current ? "\nהתוכנית הנוכחית (שנה רק מה שהתבקש):\n" + clip(JSON.stringify(input.current), 5000) : "";
  return {
    system: "אתה מאמן כוח מוסמך שבונה תוכנית אימונים שבועית בעברית, בשיחה קצרה עם המשתמש. עקוב אחרי עקרונות מבוססים (ACSM/NSCA): " +
      "תרגילים מורכבים קודם, 10-20 סטים שבועיים לקבוצת שריר גדולה, טווחי חזרות לפי המטרה (כוח 3-6, מסה 6-12, סיבולת/חיטוב 10-15), מנוחה 60-180 שנ׳, " +
      "והתאמה לזמן האימון ולציוד: בערך תרגיל אחד לכל 8-10 דקות (45 דק׳ ≈ 5 תרגילים, 60 דק׳ ≈ 6, 90 דק׳ ≈ 8), כל יום אימון שלם ומאוזן. אל תציע משקלים – האפליקציה ממלאת משקל לפי ההיסטוריה. " +
      "כשתרגיל קיים ברשימת התרגילים המוכרים, השתמש בשם בדיוק כפי שהוא שם (חשוב להמשכיות ההיסטוריה). שמות חדשים – בעברית פשוטה ומקובלת. " +
      "פלאנק ותרגילי החזקה: repsMin=repsMax=0 ובהערה כמה שניות. אם יש ריקברי Whoop נמוך, הזכר שהאפליקציה תוריד עומס באותו יום; אל תשנה את התוכנית בגללו. " +
      "ימים: weekday 0=ראשון..6=שבת, פזר ימי מנוחה. supersetWithNext רק אם זה חוסך זמן ונדרש. reply קצר בעברית.",
    user: "מטרה: " + clip(p.goal, 30) + "\nימים בשבוע: " + Number(p.days || 3) + "\nדקות לאימון: " + Number(p.minutes || 60) + "\nציוד: " + clip(p.equipment, 60) +
      (p.weekdays ? "\nימים מועדפים: " + clip(p.weekdays, 60) : "") + (p.note ? "\nעוד: " + clip(p.note, 600) : "") +
      "\nריקברי היום: " + rec + "\nתרגילים מוכרים מההיסטוריה שלו: " + (known || "אין") + cur,
  };
}

export function buildRequest(task: string, input: Record<string, unknown>, model: string) {
  const spec = TASKS[task];
  const pr = task === "food" ? foodPrompt(input) : task === "menu" ? menuPrompt(input) : task === "menuchat" ? menuChatPrompt(input) : planPrompt(input);
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [{ role: "user", parts: [{ text: pr.user }] }];
  if (task === "plan" || task === "menu" || task === "menuchat") {
    // earlier turns of the conversation (short), newest last
    const msgs = arr(input.messages, 12) as Array<{ role?: string; text?: string }>;
    for (const m of msgs) {
      const t = clip(m && m.text, 800);
      if (!t) continue;
      contents.push({ role: m.role === "model" ? "model" : "user", parts: [{ text: t }] });
    }
    if (contents[contents.length - 1].role !== "user") contents.push({ role: "user", parts: [{ text: "המשך." }] });
  }
  const schema = task === "food" ? FOOD_SCHEMA : task === "menu" ? menuSchema(input) : task === "menuchat" ? menuChatSchema(input) : PLAN_SCHEMA;
  const thinking = model.indexOf("lite") >= 0 ? "minimal" : spec.thinking;
  return {
    systemInstruction: { parts: [{ text: pr.system }] },
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      maxOutputTokens: spec.maxOut,
      temperature: task === "food" ? 0.1 : (task === "menu" || task === "menuchat") ? 0.5 : 0.6,
      thinkingConfig: { thinkingLevel: thinking },
    },
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};

function validMeals(list: unknown, input?: Record<string, unknown>) {
  const cat = input ? menuCatalog(input) : [];
  const allowedIds = cat.length ? new Set(cat.map((f) => String(f.id))) : null;
  return arr(list, 8).map((m: Record<string, unknown>) => ({
    name: clip(m && m.name, 30),
    time: /^\d{1,2}:\d{2}$/.test(String(m && m.time)) ? String(m.time) : "",
    dish: clip(m && m.dish, 50).trim(),
    prep: clip(m && m.prep, 140).trim(),
    foods: arr(m && m.foods, 12).map((f: Record<string, unknown>) => ({
      dbId: clip(f && f.dbId, 40), grams: num(f && f.grams, 0, 1500, 0), role: clip(f && f.role, 10),
    })).filter((f) => f.dbId && (!allowedIds || allowedIds.has(f.dbId))),
  })).filter((m) => m.foods.length);
}

export function validateOutput(task: string, out: unknown, input?: Record<string, unknown>): unknown {
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  if (task === "food") {
    const items = arr(o.items, 30).map((it: Record<string, unknown>) => ({
      name: clip(it && it.name, 60).trim(),
      qty: num(it && it.qty, 0, 50, 1) || 1,
      unit: clip(it && it.unit, 20).trim(),
      grams: num(it && it.grams, 0, 3000, 0),
    })).filter((x) => x.name);
    return { items };
  }
  if (task === "menuchat") {
    const acts = ["build", "edit", "ask", "none"];
    const meals = validMeals(o.meals, input);
    let action = acts.indexOf(String(o.action)) >= 0 ? String(o.action) : (meals.length ? "edit" : "none");
    if ((action === "ask" || action === "none") && meals.length && !clip(o.reply, 600).trim()) action = "edit";
    if ((action === "build" || action === "edit") && !meals.length) return null;
    const reply = clip(o.reply, 600).trim();
    if ((action === "ask" || action === "none") && !reply) return null;
    const mem = (o.memory || {}) as Record<string, unknown>;
    const add = (arr(mem.add, 6) as Array<Record<string, unknown>>).map((a) => ({
      cat: MEMORY_CATS[String(a && a.cat)] ? String(a.cat) : "habit",
      text: clip(a && a.text, 60).trim(),
    })).filter((a) => a.text);
    const remove = arr(mem.remove, 6).map((x) => clip(x, 60).trim()).filter(Boolean);
    return { reply, action, meals: action === "build" || action === "edit" ? meals : [], memory: { add, remove } };
  }
  if (task === "menu") {
    const meals = validMeals(o.meals, input);
    if (!meals.length) return null;
    return { reply: clip(o.reply, 600), meals };
  }
  if (task === "plan") {
    const plan = (o.plan || {}) as Record<string, unknown>;
    const types = ["chest", "back", "legs", "shoulders", "arms", "full", "custom"];
    const days = arr(plan.days, 7).map((d: Record<string, unknown>) => ({
      name: clip(d && d.name, 40) || "אימון",
      weekday: Math.round(num(d && d.weekday, 0, 6, 0)),
      type: types.indexOf(String(d && d.type)) >= 0 ? String(d.type) : "custom",
      exercises: arr(d && d.exercises, 14).map((e: Record<string, unknown>) => {
        const rmin = Math.round(num(e && e.repsMin, 0, 50, 8));
        const rmax = Math.round(num(e && e.repsMax, 0, 60, rmin));
        return {
          name: clip(e && e.name, 50).trim(),
          sets: Math.round(num(e && e.sets, 1, 10, 3)),
          repsMin: rmin, repsMax: Math.max(rmin, rmax),
          restSec: Math.round(num(e && e.restSec, 0, 600, 90)),
          supersetWithNext: !!(e && e.supersetWithNext),
          notes: clip(e && e.notes, 120),
        };
      }).filter((e) => e.name),
    })).filter((d) => d.exercises.length);
    if (!days.length) return { reply: clip(o.reply, 800), plan: null };
    return { reply: clip(o.reply, 800), plan: { name: clip(plan.name, 40) || "התוכנית שלי", days } };
  }
  return null;
}
