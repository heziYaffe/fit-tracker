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
  menu: { models: ["gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3-flash-preview"], attemptMs: 14000, deadlineMs: 40000, maxOut: 6000, thinking: "low" },
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

function menuPrompt(input: Record<string, unknown>) {
  const p = (input.prefs || {}) as Record<string, unknown>;
  const cat = arr(input.catalog, 300).map((f: Record<string, unknown>) => {
    const n = (f.per100 || {}) as Record<string, unknown>;
    return [clip(f.id, 30), clip(f.name, 40), arr(f.roles, 6).join("/"), arr(f.tags, 6).join("/"), "k" + n.kcal, "p" + n.protein, "c" + n.carbs, "f" + n.fat].join("|");
  }).join("\n");
  const cur = input.current ? "\nהתפריט הנוכחי (לשינוי לפי הבקשה, שמור על מה שלא התבקש לשנות):\n" + clip(JSON.stringify(input.current), 4000) : "";
  return {
    system: "אתה דיאטן ספורט שבונה תפריט יומי ישראלי פשוט ומעשי יחד עם המשתמש. מותר להשתמש רק במאכלים מהקטלוג (dbId מדויק). " +
      "שורות הקטלוג: id|שם|תפקידים|תגיות|ערכים ל-100 גרם. תפקידים: bp חלבון בוקר, bc פחמימה בוקר, mp חלבון עיקרי, mc פחמימה עיקרית, veg ירק, fat שומן, sp חלבון ביניים, fruit פרי, nut אגוזים. " +
      "בלי בשר וחלב באותה ארוחה. התאם ככל האפשר ליעדי החלבון והקלוריות (האפליקציה תכוונן מנות בסוף). כבד העדפות והחרגות. שמות ארוחות בעברית (בוקר, ביניים, צהריים, ערב). reply קצר וחם בעברית.",
    user: "יעדים: חלבון " + Number(p.protein || 0) + " ג׳, קלוריות " + Number(p.calories || 0) + ", ארוחות " + Number(p.meals || 4) + ", מטרה " + clip(p.goal, 10) +
      "\nהחרגות: " + arr(p.excludes, 20).map((x) => clip(x, 20)).join(", ") + "\nלא אוהב (dbId): " + arr(p.dislikes, 60).map((x) => clip(x, 30)).join(", ") +
      (p.note ? "\nהעדפות במילים שלו: " + clip(p.note, 500) : "") + (p.change ? "\nבקשת שינוי: " + clip(p.change, 500) : "") + cur +
      "\n\nקטלוג:\n" + cat,
  };
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
  const pr = task === "food" ? foodPrompt(input) : task === "menu" ? menuPrompt(input) : planPrompt(input);
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [{ role: "user", parts: [{ text: pr.user }] }];
  if (task === "plan" || task === "menu") {
    // earlier turns of the conversation (short), newest last
    const msgs = arr(input.messages, 12) as Array<{ role?: string; text?: string }>;
    for (const m of msgs) {
      const t = clip(m && m.text, 800);
      if (!t) continue;
      contents.push({ role: m.role === "model" ? "model" : "user", parts: [{ text: t }] });
    }
    if (contents[contents.length - 1].role !== "user") contents.push({ role: "user", parts: [{ text: "המשך." }] });
  }
  const schema = task === "food" ? FOOD_SCHEMA : task === "menu" ? MENU_SCHEMA : PLAN_SCHEMA;
  const thinking = model.indexOf("lite") >= 0 ? "minimal" : spec.thinking;
  return {
    systemInstruction: { parts: [{ text: pr.system }] },
    contents,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      maxOutputTokens: spec.maxOut,
      temperature: task === "food" ? 0.1 : 0.6,
      thinkingConfig: { thinkingLevel: thinking },
    },
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};

export function validateOutput(task: string, out: unknown): unknown {
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
  if (task === "menu") {
    const meals = arr(o.meals, 8).map((m: Record<string, unknown>) => ({
      name: clip(m && m.name, 30),
      time: /^\d{1,2}:\d{2}$/.test(String(m && m.time)) ? String(m.time) : "",
      foods: arr(m && m.foods, 12).map((f: Record<string, unknown>) => ({
        dbId: clip(f && f.dbId, 40), grams: num(f && f.grams, 0, 1500, 0), role: clip(f && f.role, 10),
      })).filter((f) => f.dbId),
    })).filter((m) => m.foods.length);
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
