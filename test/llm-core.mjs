// Server-side gateway logic (server/supabase/functions/llm/core.ts): prices,
// month/day buckets in Asia/Jerusalem, request shape, output validation.
import { PRICES, costUsd, jerusalemDay, jerusalemMonth, TASKS, buildRequest, validateOutput } from "../server/supabase/functions/llm/core.ts";
function assert(c, m) { if (!c) throw new Error(m); }

for (const t of Object.keys(TASKS)) for (const m of TASKS[t].models) assert(PRICES[m], "price for " + m);
assert(Math.abs(costUsd("gemini-3.8-flash", 1e6, 0) - 1.5) < 1e-9, "in price");
assert(Math.abs(costUsd("gemini-flash-lite-latest", 537, 180) - (537 * 0.3 + 180 * 2.5) / 1e6) < 1e-12, "lite cost");
assert(costUsd("unknown-model", 1e6, 1e6) === 9, "unknown model priced at the top rate");
// 23:30 UTC on Nov 30 is already Dec 1 in Jerusalem (UTC+2)
assert(jerusalemMonth(new Date("2026-11-30T23:30:00Z")) === "2026-12", "month in Jerusalem");
assert(jerusalemDay(new Date("2026-11-24T21:59:00Z")) === "2026-11-24", "day before midnight");
assert(jerusalemDay(new Date("2026-11-24T22:01:00Z")) === "2026-11-25", "day after midnight");

const fr = buildRequest("food", { text: "2 ביצים", names: ["ביצה"] }, "gemini-flash-lite-latest");
assert(fr.generationConfig.responseMimeType === "application/json" && fr.generationConfig.responseSchema.properties.items, "food schema");
assert(fr.generationConfig.thinkingConfig.thinkingLevel === "minimal", "lite thinks minimally");
assert(fr.contents.length === 1 && /2 ביצים/.test(fr.contents[0].parts[0].text), "food text");
const long = buildRequest("food", { text: "א".repeat(5000) }, "gemini-flash-lite-latest");
assert(long.contents[0].parts[0].text.length < 1200, "input clipped");

const pr = buildRequest("plan", { prefs: { goal: "מסה", days: 4, minutes: 60 }, known: ["סקוואט"], recovery: 40,
  messages: [{ role: "user", text: "בלי דדליפט" }, { role: "model", text: "בסדר" }] }, "gemini-3.8-flash");
assert(pr.contents.length === 4 && pr.contents[3].role === "user", "conversation ends with a user turn");
assert(/סקוואט/.test(pr.contents[0].parts[0].text) && /40%/.test(pr.contents[0].parts[0].text), "known + recovery");
assert(pr.generationConfig.responseSchema.properties.plan, "plan schema");

let v = validateOutput("food", { items: [{ name: " ביצה ", qty: 2 }, { name: "" }, { name: "x", qty: -3, grams: 99999 }] });
assert(v.items.length === 2 && v.items[0].name === "ביצה" && v.items[1].qty === 1 && v.items[1].grams === 3000, "food clamps");
assert(!TASKS.menu, "v49: the one-shot /menu task is gone");
assert(validateOutput("menu", { reply: "x", meals: [{ name: "בוקר", time: "8:00", foods: [{ dbId: "egg", grams: 100 }] }] }) === null, "no menu validation either");
const catalog = [
  { id: "egg", name: "ביצה", roles: ["bp"], tags: ["egg"], per100: { kcal: 155, protein: 12.6, carbs: 1.1, fat: 10.6 }, min: 50, max: 200, state: "" },
  { id: "tuna", name: "טונה במים", roles: ["mp"], tags: ["fish"], per100: { kcal: 116, protein: 25.5, carbs: 0, fat: 0.8 }, min: 110, max: 220, state: "" },
  { id: "rice", name: "אורז", roles: ["mc"], tags: [], per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, min: 100, max: 300, state: "מבושל" },
  { id: "cottage", name: "קוטג׳ 5%", roles: ["bp"], tags: ["dairy"], per100: { kcal: 95, protein: 11, carbs: 1.5, fat: 5 }, min: 100, max: 250, state: "" },
];

// v48/v49: the menu chat. Memory is free text (the user's standing notes);
// no code-level blocking any more, the whole catalog goes to the model.
const memText = "לא אוכל טונה\nאין לי זמן לבשל בבוקר";
const cIn = { messages: [{ role: "user", text: "תבנה לי תפריט" }, { role: "model", text: "כמה ארוחות?" }, { role: "user", text: "4" }],
  memory: memText, targets: { protein: 160, calories: 2300, carbs: 260, fat: 70 }, catalog, current: null };
assert(TASKS.menuchat && TASKS.menuchat.models[0] === "gemini-flash-lite-latest" && TASKS.menuchat.deadlineMs <= 30000 && TASKS.menuchat.attemptMs <= 10000, "menuchat task");
assert(TASKS.menuchat.models.every((m) => PRICES[m]) && TASKS.menuchat.models.indexOf("gemini-3.8-flash") < 0, "menuchat models priced, fast chain");
const cr = buildRequest("menuchat", cIn, "gemini-flash-lite-latest");
const cUser = cr.contents[0].parts[0].text, cSys = cr.systemInstruction.parts[0].text;
assert(/ההוראות הקבועות שלי[^\n]*:\nלא אוכל טונה\nאין לי זמן לבשל בבוקר\n/.test(cUser), "memory text verbatim in prompt");
assert(/2300 קק״ל, 160 ג׳ חלבון, 260 ג׳ פחמימה, 70 ג׳ שומן/.test(cUser) && /אין עדיין תפריט/.test(cUser), "targets + no menu");
assert(/\ntuna\|/.test(cUser) && /\negg\|/.test(cUser), "whole catalog sent (no blocking)");
assert(/rice\|אורז\|mc\|\|100-300\|מבושל\|130/.test(cUser), "catalog line has range and cooked state");
assert(cr.contents.length === 4 && cr.contents[3].role === "user" && cr.contents[2].role === "model", "conversation turns");
assert(/action/.test(cSys) && /ask/.test(cSys) && /memory/.test(cSys) && /suggestions/.test(cSys) && /פרטים מזהים/.test(cSys) && /dish = שם מנה/.test(cSys), "chat rules");
assert(/לעולם לא בתפריט/.test(cSys), "standing notes are binding");
const cs = cr.generationConfig.responseSchema;
assert(cs.properties.action.enum.join() === "build,edit,ask,none" && cs.required.indexOf("memory") >= 0 && cs.required.indexOf("suggestions") >= 0, "chat schema");
assert(cs.propertyOrdering[0] === "reply" && cs.propertyOrdering[cs.propertyOrdering.length - 1] === "meals", "reply streams first, meals last");
assert(cs.properties.memory.properties.add.items.type === "STRING", "memory ops are lines");
assert(cs.properties.meals.items.properties.foods.items.properties.dbId.enum.join() === "egg,tuna,rice,cottage", "enum = catalog");
const mealProps = cs.properties.meals.items;
assert(mealProps.properties.dish && mealProps.properties.prep && mealProps.required.indexOf("dish") >= 0, "dish + prep required");
const withMenu = Object.assign({}, cIn, { current: [{ name: "בוקר", time: "08:00", dish: "שקשוקה", foods: [{ dbId: "egg", grams: 150 }] }] });
assert(/התפריט הנוכחי:/.test(buildRequest("menuchat", withMenu, "gemini-flash-lite-latest").contents[0].parts[0].text), "current menu sent");
// a cached v48 app still sends memory items and `blocked`
const old = buildRequest("menuchat", Object.assign({}, cIn, { memory: [{ cat: "avoid", text: "טונה" }, { cat: "habit", text: "בוקר מהיר" }], blocked: ["tuna"] }), "gemini-flash-lite-latest");
assert(/\nטונה\nבוקר מהיר\n/.test(old.contents[0].parts[0].text) && !/\ntuna\|/.test(old.contents[0].parts[0].text), "v48 memory array still readable");
assert(/\(ריק\)/.test(buildRequest("menuchat", Object.assign({}, cIn, { memory: "" }), "gemini-flash-lite-latest").contents[0].parts[0].text), "empty memory marked");
v = validateOutput("menuchat", { reply: "באיזו ארוחה?", action: "ask", suggestions: [" ערב קל ", "", "בלי בישול", "x", "y"], meals: [{ name: "x", foods: [{ dbId: "egg", grams: 1 }] }], memory: { add: ["  אוהב   חריף "], remove: ["לא אוכל טונה"] } }, cIn);
assert(v.action === "ask" && v.meals.length === 0 && v.memory.add[0] === "אוהב חריף" && v.memory.remove[0] === "לא אוכל טונה", "ask + memory line ops");
assert(v.suggestions.join("|") === "ערב קל|בלי בישול|x", "suggestions trimmed to 3");
assert(validateOutput("menuchat", { reply: "x", action: "none", meals: [], memory: {} }, cIn).suggestions.length === 0, "missing suggestions ok");
assert(validateOutput("menuchat", { reply: "x", action: "build", meals: [], memory: {} }, cIn) === null, "build without meals is bad output");
assert(validateOutput("menuchat", { reply: "", action: "ask", meals: [], memory: {} }, cIn) === null, "empty question is bad output");
v = validateOutput("menuchat", { reply: "ok", action: "edit", meals: [{ name: "ערב", time: "20:00", dish: " שקשוקה ", prep: "א".repeat(300), foods: [{ dbId: "nope", grams: 100 }, { dbId: "egg", grams: 100 }] }], memory: { add: [], remove: [] } }, cIn);
assert(v.meals[0].foods.length === 1 && v.meals[0].foods[0].dbId === "egg", "unknown food dropped on the server");
assert(v.meals[0].dish === "שקשוקה" && v.meals[0].prep.length === 140, "dish/prep clipped");
assert(!/Hazi|weight|משקל גוף/.test(JSON.stringify(cr)), "nothing identifying");

v = validateOutput("plan", { reply: "שאלה?", plan: { name: "", days: [] } });
assert(v.plan === null && v.reply === "שאלה?", "question-only reply allowed");
v = validateOutput("plan", { reply: "ok", plan: { name: "p", days: [{ name: "A", weekday: 9, type: "weird", exercises: [{ name: "סקוואט", sets: 40, repsMin: 8, repsMax: 5 }] }] } });
const ex = v.plan.days[0].exercises[0];
assert(v.plan.days[0].weekday === 6 && v.plan.days[0].type === "custom", "day clamps");
assert(ex.sets === 10 && ex.repsMax === 8 && ex.restSec === 90, "exercise clamps");
assert(validateOutput("food", null) === null && validateOutput("nope", {}) === null, "junk rejected");
console.log("llm-core ok");
