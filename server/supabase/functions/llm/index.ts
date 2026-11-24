// Supabase Edge Function: budget-capped Gemini gateway for the fit-tracker app.
// Deploy: supabase functions deploy llm --no-verify-jwt   (auth is checked here)
// Secrets: GEMINI_API_KEY (server only), LLM_ALLOWED_USERS (comma-separated
//          auth user ids), optional LLM_MONTHLY_CAP_USD (default 10),
//          LLM_DAILY_CALLS (default 100), APP_ORIGIN.
// Routes:
//   GET  /usage                 → { month_usd, cap_usd, today_calls, daily_limit }
//   POST /food   { text, names } → { items: [{ name, qty, unit, grams }] }
//   POST /menu   { prefs, catalog, current? } → { reply, meals: [...] }
//   POST /plan   { prefs, messages, known, recovery, current? } → { reply, plan }
// Every reply carries `usage` (this call) and `month_usd`. Errors are JSON
// { error, message } with a Hebrew message; the app then falls back to rules.
// The model only parses language / composes structure. Nutrition numbers come
// from the app's food table and loads from its recommendation engine.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PRICES, costUsd, jerusalemDay, jerusalemMonth, TASKS, buildRequest, validateOutput } from "./core.ts";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "https://heziyaffe.github.io",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const MSG: Record<string, string> = {
  auth: "צריך להתחבר לחשבון כדי להשתמש ב-AI.",
  forbidden: "ה-AI פעיל רק לחשבון של בעל האפליקציה.",
  cap: "הגעת לתקרת ה-AI החודשית ($10). עד החודש הבא האפליקציה עובדת בלי AI.",
  daily: "הגעת למכסת ה-AI היומית. מחר זה יחזור; בינתיים בלי AI.",
  quota: "המכסה החינמית של Gemini נגמרה לעכשיו. ממשיכים בלי AI, נסה שוב מאוחר יותר.",
  busy: "Gemini עמוס כרגע. ממשיכים בלי AI, נסה שוב עוד מעט.",
  bad_output: "ה-AI החזיר תשובה לא תקינה. ממשיכים בלי AI.",
  bad_request: "בקשה לא תקינה.",
  not_configured: "ה-AI עוד לא הוגדר בשרת.",
};
function fail(code: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ error: code, message: MSG[code] || code, ...extra }, status);
}

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });
}

async function userFromReq(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function capUsd() { return Number(Deno.env.get("LLM_MONTHLY_CAP_USD") || 10) || 10; }
function dailyLimit() { return Number(Deno.env.get("LLM_DAILY_CALLS") || 100) || 100; }

async function usageNow(sb: ReturnType<typeof admin>, userId: string) {
  const since = new Date(Date.now() - 33 * 86400000).toISOString();
  const { data, error } = await sb.from("llm_usage").select("created_at,cost_usd").eq("user_id", userId).gte("created_at", since).limit(5000);
  if (error) throw new Error("usage_read: " + error.message);
  const month = jerusalemMonth(new Date());
  const day = jerusalemDay(new Date());
  let monthUsd = 0, todayCalls = 0;
  for (const r of data || []) {
    const at = new Date(r.created_at as string);
    if (jerusalemMonth(at) === month) monthUsd += Number(r.cost_usd) || 0;
    if (jerusalemDay(at) === day) todayCalls += 1;
  }
  return { month_usd: Math.round(monthUsd * 1e6) / 1e6, cap_usd: capUsd(), today_calls: todayCalls, daily_limit: dailyLimit() };
}

type Attempt = { model: string; status: number; inTok: number; outTok: number; text: string; err: string };

async function callModel(model: string, body: unknown, timeoutMs: number): Promise<Attempt> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(GEMINI + model + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": Deno.env.get("GEMINI_API_KEY") || "", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const j = await res.json().catch(() => ({}));
    const um = j.usageMetadata || {};
    const inTok = Number(um.promptTokenCount) || 0;
    const outTok = (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0);
    if (!res.ok) return { model, status: res.status, inTok, outTok, text: "", err: String((j.error && j.error.status) || res.status) };
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("");
    return { model, status: 200, inTok, outTok, text, err: "" };
  } catch (e) {
    return { model, status: 0, inTok: 0, outTok: 0, text: "", err: (e as Error).name === "AbortError" ? "timeout" : String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function runTask(sb: ReturnType<typeof admin>, userId: string, task: string, input: Record<string, unknown>) {
  const spec = TASKS[task];
  const started = Date.now();
  const attempts: Attempt[] = [];
  let parsed: unknown = null;
  let used = "";
  const chain = spec.models.slice();
  // One short back-off retry of the first model when everything was busy/quota.
  let retried = false;
  for (let i = 0; i < chain.length; i++) {
    const left = spec.deadlineMs - (Date.now() - started);
    if (left < 2500) break;
    const model = chain[i];
    const a = await callModel(model, buildRequest(task, input, model), Math.min(spec.attemptMs, left));
    attempts.push(a);
    if (a.status === 200) {
      try {
        const out = validateOutput(task, JSON.parse(a.text), input);
        if (out) { parsed = out; used = model; break; }
        a.err = "bad_output";
      } catch (_e) { a.err = "bad_output"; }
    }
    if (i === chain.length - 1 && !retried && attempts.every((x) => x.status === 429 || x.status === 503 || x.status === 500)) {
      retried = true;
      await new Promise((r) => setTimeout(r, 1500));
      chain.push(chain[0]);
    }
  }
  const inTok = attempts.reduce((s, a) => s + a.inTok, 0);
  const outTok = attempts.reduce((s, a) => s + a.outTok, 0);
  const cost = attempts.reduce((s, a) => s + costUsd(a.model, a.inTok, a.outTok), 0);
  const errSummary = attempts.map((a) => a.model + ":" + (a.err || a.status)).join(",").slice(0, 300);
  await sb.from("llm_usage").insert({
    user_id: userId, task, model: used || (attempts[attempts.length - 1] || {}).model || null,
    input_tokens: inTok, output_tokens: outTok, cost_usd: cost, ok: !!parsed, error: parsed ? (attempts.length > 1 ? errSummary : null) : errSummary,
  });
  const usage = { model: used, input_tokens: inTok, output_tokens: outTok, cost_usd: Math.round(cost * 1e6) / 1e6, ms: Date.now() - started, attempts: attempts.length };
  if (parsed) return { ok: true as const, data: parsed, usage };
  const anyQuota = attempts.some((a) => a.status === 429);
  const anyBad = attempts.some((a) => a.err === "bad_output");
  return { ok: false as const, code: anyBad && !anyQuota ? "bad_output" : (anyQuota ? "quota" : "busy"), usage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/llm/, "").replace(/\/+$/, "") || "/";
  if (route === "/health") return json({ ok: true, configured: !!Deno.env.get("GEMINI_API_KEY"), models: Object.keys(PRICES) });
  if (!Deno.env.get("GEMINI_API_KEY")) return fail("not_configured", 503);
  const user = await userFromReq(req);
  if (!user) return fail("auth", 401);
  const allowed = (Deno.env.get("LLM_ALLOWED_USERS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(user.id)) return fail("forbidden", 403);
  const sb = admin();
  try {
    if (route === "/usage" && req.method === "GET") return json(await usageNow(sb, user.id));
    const task = route.slice(1);
    if (req.method !== "POST" || !TASKS[task]) return fail("bad_request", 404);
    const raw = await req.text();
    if (raw.length > 60000) return fail("bad_request", 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch (_e) { return fail("bad_request", 400); }
    const u = await usageNow(sb, user.id);
    if (u.month_usd >= u.cap_usd) return fail("cap", 402, u);
    if (u.today_calls >= u.daily_limit) return fail("daily", 429, u);
    const r = await runTask(sb, user.id, task, input || {});
    const monthUsd = Math.round((u.month_usd + r.usage.cost_usd) * 1e6) / 1e6;
    if (!r.ok) return fail(r.code, r.code === "quota" ? 429 : 503, { usage: r.usage, month_usd: monthUsd, cap_usd: u.cap_usd });
    return json({ ...(r.data as Record<string, unknown>), usage: r.usage, month_usd: monthUsd, cap_usd: u.cap_usd });
  } catch (e) {
    console.error(e);
    return fail("busy", 500);
  }
});
