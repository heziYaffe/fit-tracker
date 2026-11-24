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
assert(validateOutput("menu", { reply: "x", meals: [{ name: "a", foods: [] }] }) === null, "empty menu rejected");
v = validateOutput("menu", { reply: "x", meals: [{ name: "בוקר", time: "8:00", foods: [{ dbId: "egg", grams: 100 }] }] });
assert(v.meals[0].time === "8:00" && v.meals[0].foods[0].dbId === "egg", "menu ok");
v = validateOutput("plan", { reply: "שאלה?", plan: { name: "", days: [] } });
assert(v.plan === null && v.reply === "שאלה?", "question-only reply allowed");
v = validateOutput("plan", { reply: "ok", plan: { name: "p", days: [{ name: "A", weekday: 9, type: "weird", exercises: [{ name: "סקוואט", sets: 40, repsMin: 8, repsMax: 5 }] }] } });
const ex = v.plan.days[0].exercises[0];
assert(v.plan.days[0].weekday === 6 && v.plan.days[0].type === "custom", "day clamps");
assert(ex.sets === 10 && ex.repsMax === 8 && ex.restSec === 90, "exercise clamps");
assert(validateOutput("food", null) === null && validateOutput("nope", {}) === null, "junk rejected");
console.log("llm-core ok");
