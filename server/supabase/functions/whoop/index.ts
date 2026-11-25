// Supabase Edge Function: Whoop OAuth2 + webhook + token refresh.
// Deploy: supabase functions deploy whoop --no-verify-jwt
// Secrets: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI,
//          APP_ORIGIN, APP_RETURN_URL (optional).
//          SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected.
//
// Routes (PATH_PREFIX is the function URL):
//   GET  /health           → { ok, whoop_configured } (no auth; safe before Whoop secrets exist)
//   GET  /                 → start OAuth (requires ?access_token= or Authorization)
//   GET  /callback         → Whoop redirect with ?code&state
//   POST /webhook          → Whoop webhooks (signature verified)
//   POST /refresh          → refresh the calling user's token and pull recent data
//   POST /cron             → scheduled pull for every connected user (WHOOP_CRON_SECRET)
//   GET  /status           → { connected, needs_reconnect, last_sync_at, token_updated_at }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WHOOP_AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer";
const SCOPES = "read:recovery read:cycles read:sleep read:workout read:profile offline";

function appOrigin() {
  return (Deno.env.get("APP_ORIGIN") || "https://heziyaffe.github.io").replace(/\/+$/, "");
}

function appReturnUrl() {
  const explicit = (Deno.env.get("APP_RETURN_URL") || "").replace(/\/+$/, "");
  if (explicit) return explicit;
  const origin = appOrigin();
  if (origin.endsWith("/fit-tracker")) return origin;
  return origin + "/fit-tracker";
}

function appRedirect(status: "connected" | "error", reason?: string) {
  const base = appReturnUrl().replace(/\/+$/, "") + "/";
  const dest = new URL(base);
  dest.searchParams.set("whoop", status);
  if (status === "error") dest.searchParams.set("reason", (reason || "server").slice(0, 40));
  return Response.redirect(dest.toString(), 302);
}

function whoopConfigured() {
  return !!(Deno.env.get("WHOOP_CLIENT_ID") && Deno.env.get("WHOOP_CLIENT_SECRET"));
}

function missingWhoopConfig() {
  return json({
    error: "whoop_not_configured",
    message: "WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are not set yet.",
  }, 503);
}

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "https://heziyaffe.github.io",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}


function waitUntil(task: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
    return;
  }
  task.catch((err) => console.error(err));
}

function withTimeout(task: Promise<unknown>, ms: number, label: string) {
  let timer: number | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.error(label + " timed out after " + ms + "ms");
      resolve();
    }, ms) as unknown as number;
  });
  return Promise.race([
    task.then(() => { if (timer) clearTimeout(timer); }, (err) => {
      if (timer) clearTimeout(timer);
      console.error(label, err);
    }),
    timeout,
  ]);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

function htmlPage(title: string, inner: string, status = 200) {
  const page = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#1a1228;color:#f4eefe;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
    main{max-width:28rem}
    h1{font-size:1.35rem;margin:0 0 12px}
    p{line-height:1.55;color:#d8cce8}
    a{color:#c4a0ff}
  </style>
</head>
<body><main>${inner}</main></body>
</html>`;
  return new Response(page, {
    status,
    headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
  });
}

function admin() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, { auth: { persistSession: false } });
}

async function userFromReq(req: Request) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const header = req.headers.get("Authorization") || "";
  const qs = new URL(req.url).searchParams.get("access_token") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : qs;
  if (!token) return null;
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function b64url(bytes: Uint8Array) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signState(payload: string) {
  const secret = Deno.env.get("WHOOP_CLIENT_SECRET") || "state";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig)).slice(0, 24);
}

async function verifyWhoopSignature(req: Request, raw: string) {
  const sig = req.headers.get("X-WHOOP-Signature") || "";
  const ts = req.headers.get("X-WHOOP-Signature-Timestamp") || "";
  const secret = Deno.env.get("WHOOP_CLIENT_SECRET") || "";
  if (!sig || !ts || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + raw));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === sig;
}

async function whoopToken(params: Record<string, string>) {
  const body = new URLSearchParams({
    client_id: Deno.env.get("WHOOP_CLIENT_ID") || "",
    client_secret: Deno.env.get("WHOOP_CLIENT_SECRET") || "",
    ...params,
  });
  const res = await fetch(WHOOP_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (_) { parsed = {}; }
  if (!res.ok) {
    const code = String(parsed.error || "token_exchange_failed");
    const desc = String(parsed.error_description || "").slice(0, 160);
    const err = new Error("token_exchange_failed " + res.status + " " + code + (desc ? " " + desc : ""));
    (err as { code?: string; status?: number }).code = code;
    (err as { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return parsed;
}

function isDefinitiveAuthLoss(err: unknown) {
  const e = err as { code?: string; message?: string };
  const code = String(e && e.code || "").toLowerCase();
  const msg = String(e && e.message || err || "").toLowerCase();
  if (code === "invalid_grant" || code === "invalid_token") return true;
  return msg.includes("invalid_grant") || msg.includes("invalid_token") || msg.includes("refresh_token_not_found");
}

async function saveTokens(sb: ReturnType<typeof admin>, userId: string, token: Record<string, unknown>, whoopUserId?: string) {
  const expires = token.expires_in
    ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
    : null;
  const { data: existing } = await sb.from("whoop_tokens").select("refresh_token, whoop_user_id").eq("user_id", userId).maybeSingle();
  // Whoop rotates refresh tokens; persist the new one, but never wipe the old if omitted.
  const refresh = (token.refresh_token ? String(token.refresh_token) : "") || (existing && existing.refresh_token) || null;
  const row = {
    user_id: userId,
    whoop_user_id: whoopUserId || (existing && existing.whoop_user_id) || null,
    access_token: token.access_token,
    refresh_token: refresh,
    expires_at: expires,
    scope: token.scope || SCOPES,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("whoop_tokens").upsert(row);
  if (error) throw error;
  await sb.from("whoop_links").upsert({
    user_id: userId,
    whoop_user_id: whoopUserId || null,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
}

const refreshInFlight = new Map<string, Promise<Record<string, unknown> | null>>();

function accessStillValid(row: { expires_at?: string | null } | null, skewMs = 60_000) {
  if (!row || !row.expires_at) return false;
  const exp = new Date(row.expires_at).getTime();
  return !!(exp && exp - skewMs > Date.now());
}

async function markLinkError(sb: ReturnType<typeof admin>, userId: string, lastError: string | null) {
  await sb.from("whoop_links").upsert({
    user_id: userId,
    last_error: lastError,
  });
}

async function refreshAndSave(
  sb: ReturnType<typeof admin>,
  userId: string,
  current: Record<string, unknown>,
  attempt = 0,
): Promise<Record<string, unknown> | null> {
  const usedRefresh = String(current.refresh_token || "");
  if (!usedRefresh) return current;
  try {
    // Whoop's documented refresh payload uses scope=offline only, not the full
    // data scopes. Sending the authorize scopes here can fail the refresh, and
    // the access token then dies after ~1 hour so the app asks to reconnect.
    const fresh = await whoopToken({
      grant_type: "refresh_token",
      refresh_token: usedRefresh,
      scope: "offline",
    });
    const expires = fresh.expires_in
      ? new Date(Date.now() + Number(fresh.expires_in) * 1000).toISOString()
      : null;
    const newRefresh = (fresh.refresh_token ? String(fresh.refresh_token) : "") || usedRefresh;
    const patch = {
      access_token: fresh.access_token,
      refresh_token: newRefresh,
      expires_at: expires,
      scope: fresh.scope || current.scope || SCOPES,
      updated_at: new Date().toISOString(),
    };
    // Compare-and-swap so a concurrent refresh cannot overwrite a newer token.
    const { data: updated, error } = await sb.from("whoop_tokens")
      .update(patch)
      .eq("user_id", userId)
      .eq("refresh_token", usedRefresh)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) {
      const { data: latest } = await sb.from("whoop_tokens").select("*").eq("user_id", userId).maybeSingle();
      if (latest && accessStillValid(latest)) return latest;
      if (latest && latest.refresh_token && String(latest.refresh_token) !== usedRefresh && attempt < 1) {
        return refreshAndSave(sb, userId, latest, attempt + 1);
      }
      return latest || { ...current, ...patch };
    }
    await markLinkError(sb, userId, null);
    console.log("whoop refresh ok", JSON.stringify({
      user: String(userId).slice(0, 8),
      expires_in: fresh.expires_in || null,
      rotated_refresh: !!(fresh.refresh_token && String(fresh.refresh_token) !== usedRefresh),
    }));
    return updated;
  } catch (err) {
    if (isDefinitiveAuthLoss(err)) {
      const { data: latest } = await sb.from("whoop_tokens").select("*").eq("user_id", userId).maybeSingle();
      if (latest && latest.refresh_token && String(latest.refresh_token) !== usedRefresh) {
        if (accessStillValid(latest)) return latest;
        if (attempt < 1) return refreshAndSave(sb, userId, latest, attempt + 1);
        return latest;
      }
      await markLinkError(sb, userId, "invalid_grant");
      console.error("whoop refresh invalid_grant", String(userId).slice(0, 8));
      const e = new Error("invalid_grant");
      (e as { code?: string }).code = "invalid_grant";
      throw e;
    }
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { data: latest } = await sb.from("whoop_tokens").select("*").eq("user_id", userId).maybeSingle();
      return refreshAndSave(sb, userId, latest || current, attempt + 1);
    }
    console.error("whoop refresh transient failure", String((err as Error).message || err).slice(0, 200));
    throw err;
  }
}

async function getValidToken(sb: ReturnType<typeof admin>, userId: string) {
  const pending = refreshInFlight.get(userId);
  if (pending) return pending;
  const work = (async () => {
    const { data, error } = await sb.from("whoop_tokens").select("*").eq("user_id", userId).maybeSingle();
    if (error || !data) return null;
    if (accessStillValid(data)) return data;
    if (!data.refresh_token) return data;
    return refreshAndSave(sb, userId, data);
  })();
  refreshInFlight.set(userId, work);
  try {
    return await work;
  } finally {
    if (refreshInFlight.get(userId) === work) refreshInFlight.delete(userId);
  }
}

async function tokenMeta(sb: ReturnType<typeof admin>, userId: string) {
  const { data } = await sb.from("whoop_tokens").select("expires_at, updated_at, refresh_token, scope").eq("user_id", userId).maybeSingle();
  if (!data) return { has_token: false, has_refresh: false, access_expires_at: null, token_updated_at: null };
  return {
    has_token: true,
    has_refresh: !!(data.refresh_token && String(data.refresh_token).length),
    access_expires_at: data.expires_at || null,
    token_updated_at: data.updated_at || null,
    scope: data.scope || null,
  };
}

async function whoopGet(access: string, path: string) {
  const res = await fetch(WHOOP_API + path, { headers: { Authorization: "Bearer " + access } });
  if (!res.ok) throw new Error("whoop_get " + path + " " + res.status);
  return await res.json();
}

async function whoopGetAll(access: string, path: string) {
  const records: Record<string, unknown>[] = [];
  let next = "";
  const [base, qs] = path.split("?");
  const params = new URLSearchParams(qs || "");
  for (let page = 0; page < 20; page++) {
    if (next) params.set("nextToken", next);
    const url = base + (params.toString() ? "?" + params.toString() : "");
    const data = await whoopGet(access, url);
    const rows = (data && data.records) || [];
    for (const row of rows) records.push(row);
    next = data && data.next_token ? String(data.next_token) : "";
    if (!next) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { records };
}

function localDateJerusalem(iso: string, offset?: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    const sign = offset[0] === "-" ? -1 : 1;
    const [hh, mm] = offset.slice(1).split(":").map(Number);
    const shifted = new Date(d.getTime() + sign * (hh * 60 + mm) * 60000);
    return shifted.toISOString().slice(0, 10);
  }
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(d);
  } catch (_) {
    return d.toISOString().slice(0, 10);
  }
}

function localDateFromStart(start: string, offset?: string) {
  return localDateJerusalem(start, offset);
}

function jerusalemToday(offset?: string) {
  return localDateJerusalem(new Date().toISOString(), offset);
}

function cycleDayDate(cycle: Record<string, unknown>) {
  const offset = String(cycle.timezone_offset || "");
  // An open cycle is "today" — its strain is accumulating after wake-up.
  if (!cycle.end) return jerusalemToday(offset || undefined);
  // A closed cycle represents the day it started (wake-to-wake).
  return localDateJerusalem(String(cycle.start || ""), offset);
}

function recoveryDayDate(
  rec: Record<string, unknown>,
  sleepDateById: Record<string, { date: string; cycleId?: string }>,
  cycleById: Record<string, Record<string, unknown>>,
) {
  const sleepId = rec.sleep_id != null ? String(rec.sleep_id) : "";
  const cycleId = rec.cycle_id != null ? String(rec.cycle_id) : "";
  if (sleepId && sleepDateById[sleepId] && sleepDateById[sleepId].date) return sleepDateById[sleepId].date;
  const cycle = cycleId ? cycleById[cycleId] : undefined;
  if (cycle && cycle.end) return localDateJerusalem(String(cycle.end), String(cycle.timezone_offset || ""));
  if (cycle && !cycle.end) return jerusalemToday(String(cycle.timezone_offset || "") || undefined);
  // Recovery without a cycle/sleep: wake-up day from created_at, in Jerusalem — never bare UTC.
  return localDateJerusalem(String(rec.created_at || rec.updated_at || new Date().toISOString()), String((rec as { timezone_offset?: string }).timezone_offset || ""));
}

function hoursFromMilli(ms: unknown) {
  const n = Number(ms || 0);
  return n ? Math.round((n / 3_600_000) * 100) / 100 : null;
}

function numOrNull(v: unknown) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapSleep(sleep: Record<string, unknown>) {
  const score = (sleep.score || {}) as Record<string, unknown>;
  const stages = (score.stage_summary || {}) as Record<string, unknown>;
  const sleepHours = hoursFromMilli(stages.total_sleep_time_milli) || hoursFromMilli(stages.total_in_bed_time_milli);
  const sleepInBedHours = hoursFromMilli(stages.total_in_bed_time_milli);
  const perf = numOrNull(score.sleep_performance_percentage);
  const date = localDateFromStart(String(sleep.end || sleep.start || ""), String(sleep.timezone_offset || ""));
  const notes = perf != null ? ("ביצועי שינה " + Math.round(perf) + "%") : "";
  return {
    date,
    sleepHours,
    sleepInBedHours,
    sleepPerformance: perf,
    sleepEfficiency: numOrNull(score.sleep_efficiency_percentage),
    sleepConsistency: numOrNull(score.sleep_consistency_percentage),
    sleepLightHours: hoursFromMilli(stages.total_light_sleep_time_milli),
    sleepDeepHours: hoursFromMilli(stages.total_slow_wave_sleep_time_milli),
    sleepRemHours: hoursFromMilli(stages.total_rem_sleep_time_milli),
    sleepAwakeHours: hoursFromMilli(stages.total_awake_time_milli),
    sleepCycles: numOrNull(stages.sleep_cycle_count),
    sleepDisturbances: numOrNull(stages.disturbance_count),
    respiratoryRate: numOrNull(score.respiratory_rate),
    notes,
  };
}

function mapRecovery(rec: Record<string, unknown>, date: string) {
  const score = (rec.score || {}) as Record<string, unknown>;
  return {
    date,
    recoveryPct: numOrNull(score.recovery_score),
    hrv: numOrNull(score.hrv_rmssd_milli != null ? score.hrv_rmssd_milli : score.hrv_rmssd),
    rhr: numOrNull(score.resting_heart_rate),
    spo2: numOrNull(score.spo2_percentage),
    skinTempC: numOrNull(score.skin_temp_celsius),
  };
}

function mapCycle(cycle: Record<string, unknown>) {
  const score = (cycle.score || {}) as Record<string, unknown>;
  const date = cycleDayDate(cycle);
  return {
    date,
    strain: numOrNull(score.strain),
    kilojoule: numOrNull(score.kilojoule),
    avgHr: numOrNull(score.average_heart_rate),
    maxHr: numOrNull(score.max_heart_rate),
    cycleId: cycle.id != null ? String(cycle.id) : null,
  };
}

function kjToKcal(kj: number | null) {
  if (kj == null || !Number.isFinite(kj) || kj <= 0) return null;
  return Math.round(kj / 4.184);
}

function mapHrZones(score: Record<string, unknown>) {
  const raw = (score.zone_durations || score.zone_duration || null) as Record<string, unknown> | null;
  if (!raw) return null;
  const names = ["zero", "one", "two", "three", "four", "five"];
  const out: Record<string, number> = {};
  let any = false;
  names.forEach((name, i) => {
    const v = numOrNull(raw["zone_" + name + "_milli"]);
    if (v != null) {
      out[String(i)] = v;
      any = true;
    }
  });
  return any ? out : null;
}

function mapWorkout(w: Record<string, unknown>) {
  const score = (w.score || {}) as Record<string, unknown>;
  const start = String(w.start || "");
  const end = String(w.end || "");
  const date = localDateFromStart(start, String(w.timezone_offset || ""));
  const ms = start && end ? (new Date(end).getTime() - new Date(start).getTime()) : 0;
  const minutes = ms > 0 ? Math.round(ms / 60000) : null;
  const distanceM = numOrNull(score.distance_meter);
  const kj = numOrNull(score.kilojoule);
  return {
    date,
    type: "cardio",
    customType: String(w.sport_name || "Whoop"),
    duration: minutes,
    notes: "Whoop" + (score.strain != null ? (" · Strain " + Number(score.strain).toFixed(1)) : ""),
    source: "whoop",
    whoopId: w.id,
    startedAt: start || null,
    endedAt: end || null,
    sportName: w.sport_name != null ? String(w.sport_name) : "",
    avgHr: numOrNull(score.average_heart_rate),
    maxHr: numOrNull(score.max_heart_rate),
    strain: numOrNull(score.strain),
    kilojoule: kj,
    kcal: kjToKcal(kj),
    distanceKm: distanceM != null ? Math.round(distanceM / 10) / 100 : null,
    hrZones: mapHrZones(score),
    scoreState: w.score_state != null ? String(w.score_state) : null,
    exercises: [],
  };
}

async function upsertMetric(sb: ReturnType<typeof admin>, userId: string, patch: Record<string, unknown>) {
  if (!patch.date) return;
  const recordId = "whoop-" + patch.date;
  const { data: existing } = await sb.from("fit_records")
    .select("data")
    .eq("user_id", userId)
    .eq("collection", "metrics")
    .eq("record_id", recordId)
    .maybeSingle();
  const prev = (existing && existing.data) || { id: recordId, date: patch.date, source: "whoop" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  const next = { ...prev, ...clean, source: "whoop", id: recordId, date: patch.date, updatedAt: new Date().toISOString() };
  await sb.from("fit_records").upsert({
    user_id: userId,
    collection: "metrics",
    record_id: recordId,
    data: next,
    updated_at: next.updatedAt,
    deleted_at: null,
  });
}

async function upsertWorkout(sb: ReturnType<typeof admin>, userId: string, w: Record<string, unknown>) {
  const recordId = "whoop-wo-" + String(w.whoopId || w.id || crypto.randomUUID());
  const data = { ...w, id: recordId, updatedAt: new Date().toISOString() };
  await sb.from("fit_records").upsert({
    user_id: userId,
    collection: "workouts",
    record_id: recordId,
    data,
    updated_at: data.updatedAt,
    deleted_at: null,
  });
}

async function userIdForWhoop(sb: ReturnType<typeof admin>, whoopUserId: string) {
  const { data } = await sb.from("whoop_tokens").select("user_id").eq("whoop_user_id", String(whoopUserId)).maybeSingle();
  return data && data.user_id;
}

async function ingestByType(sb: ReturnType<typeof admin>, userId: string, access: string, type: string, id: string) {
  if (type.startsWith("sleep.")) {
    const sleep = await whoopGet(access, "/v2/activity/sleep/" + id);
    const mapped = mapSleep(sleep);
    await upsertMetric(sb, userId, mapped);
  } else if (type.startsWith("recovery.")) {
    // v2 recovery webhook id is the associated sleep UUID.
    const sleep = await whoopGet(access, "/v2/activity/sleep/" + id);
    const mappedSleep = mapSleep(sleep);
    let rec: Record<string, unknown> | null = null;
    try {
      rec = await whoopGet(access, "/v2/cycle/" + (sleep.cycle_id || "") + "/recovery");
    } catch (_) {
      try { rec = await whoopGet(access, "/v2/activity/sleep/" + id + "/recovery"); } catch (__) { rec = null; }
    }
    const patch = rec ? { ...mappedSleep, ...mapRecovery(rec, mappedSleep.date) } : mappedSleep;
    await upsertMetric(sb, userId, patch);
  } else if (type.startsWith("workout.")) {
    if (type.endsWith(".deleted")) {
      const recordId = "whoop-wo-" + id;
      await sb.from("fit_records").upsert({
        user_id: userId,
        collection: "workouts",
        record_id: recordId,
        data: { id: recordId, deleted: true },
        updated_at: new Date().toISOString(),
        deleted_at: new Date().toISOString(),
      });
      return;
    }
    const workout = await whoopGet(access, "/v2/activity/workout/" + id);
    await upsertWorkout(sb, userId, mapWorkout(workout));
  }
}

function mergeRecordsById(groups: Array<{ records?: Record<string, unknown>[] }>) {
  const map: Record<string, Record<string, unknown>> = {};
  for (const g of groups) {
    for (const row of g.records || []) {
      const id = row.id != null ? String(row.id) : "";
      if (id) map[id] = row;
      else map["anon-" + Object.keys(map).length] = row;
    }
  }
  return Object.values(map);
}

// Batched writers: a 90-day pull used to do ~600 sequential round trips (each
// metric = a select + an upsert) and was killed by the platform before it
// finished, so the app's pull-on-open never completed. Collect patches in
// memory and write them with one select and one upsert.
function cleanPatch(patch: Record<string, unknown>) {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return clean;
}

function queueMetric(queue: Map<string, Record<string, unknown>>, patch: Record<string, unknown>) {
  if (!patch.date) return;
  const key = String(patch.date);
  queue.set(key, { ...(queue.get(key) || {}), ...cleanPatch(patch) });
}

async function flushMetrics(sb: ReturnType<typeof admin>, userId: string, queue: Map<string, Record<string, unknown>>) {
  if (!queue.size) return;
  const ids = Array.from(queue.keys()).map((d) => "whoop-" + d);
  const prevById: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("fit_records")
      .select("record_id, data")
      .eq("user_id", userId)
      .eq("collection", "metrics")
      .in("record_id", ids.slice(i, i + 100));
    if (error) throw error;
    for (const row of data || []) prevById[String(row.record_id)] = (row.data || {}) as Record<string, unknown>;
  }
  const now = new Date().toISOString();
  const rows = Array.from(queue.entries()).map(([date, patch]) => {
    const recordId = "whoop-" + date;
    const prev = prevById[recordId] || { id: recordId, date, source: "whoop" };
    const next = { ...prev, ...patch, source: "whoop", id: recordId, date, updatedAt: now };
    return { user_id: userId, collection: "metrics", record_id: recordId, data: next, updated_at: now, deleted_at: null };
  });
  const { error } = await sb.from("fit_records").upsert(rows);
  if (error) throw error;
}

async function flushWorkouts(sb: ReturnType<typeof admin>, userId: string, list: Record<string, unknown>[]) {
  if (!list.length) return;
  const now = new Date().toISOString();
  const byId = new Map<string, Record<string, unknown>>();
  for (const w of list) {
    const recordId = "whoop-wo-" + String(w.whoopId || w.id || crypto.randomUUID());
    byId.set(recordId, {
      user_id: userId, collection: "workouts", record_id: recordId,
      data: { ...w, id: recordId, updatedAt: now }, updated_at: now, deleted_at: null,
    });
  }
  const rows = Array.from(byId.values());
  const { error } = await sb.from("fit_records").upsert(rows);
  if (error) throw error;
}

async function pullRecent(sb: ReturnType<typeof admin>, userId: string, access: string, days = 90) {
  const queue = new Map<string, Record<string, unknown>>();
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(14, days) * 86400000);
  const q = "?start=" + start.toISOString() + "&end=" + end.toISOString() + "&limit=25";
  const rangedCycles = await whoopGetAll(access, "/v2/cycle" + q).catch((e) => {
    console.error("cycle range", e);
    return { records: [] as Record<string, unknown>[] };
  });
  // Also fetch the newest cycles so an open current cycle isn't missed by the date filter.
  const latestCycles = await whoopGet(access, "/v2/cycle?limit=10").catch((e) => {
    console.error("cycle latest", e);
    return { records: [] as Record<string, unknown>[] };
  });
  const cycleList = mergeRecordsById([rangedCycles, latestCycles]);
  const cycleById: Record<string, Record<string, unknown>> = {};
  for (const c of cycleList) {
    if (c.id != null) cycleById[String(c.id)] = c;
  }
  const sleeps = await whoopGetAll(access, "/v2/activity/sleep" + q).catch((e) => {
    console.error("sleep", e);
    return { records: [] as Record<string, unknown>[] };
  });
  const sleepDateById: Record<string, { date: string; cycleId?: string }> = {};
  const sleepDateByCycle: Record<string, string> = {};
  for (const s of sleeps.records || []) {
    const mapped = mapSleep(s);
    if (s.id != null && mapped.date) {
      sleepDateById[String(s.id)] = { date: mapped.date, cycleId: s.cycle_id != null ? String(s.cycle_id) : undefined };
    }
    if (s.cycle_id != null && mapped.date) sleepDateByCycle[String(s.cycle_id)] = mapped.date;
    queueMetric(queue, mapped);
  }
  // Strain belongs on the wake-up day of the cycle's sleep, not bedtime (cycle.start).
  for (const c of cycleList) {
    const mapped = mapCycle(c);
    const fromSleep = c.id != null ? sleepDateByCycle[String(c.id)] : undefined;
    if (fromSleep) mapped.date = fromSleep;
    queueMetric(queue, mapped);
  }
  const recs = await whoopGetAll(access, "/v2/recovery" + q).catch((e) => {
    console.error("recovery", e);
    return { records: [] as Record<string, unknown>[] };
  });
  const recByCycle: Record<string, Record<string, unknown>> = {};
  for (const r of recs.records || []) {
    if (r.cycle_id != null) recByCycle[String(r.cycle_id)] = r;
    const date = recoveryDayDate(r, sleepDateById, cycleById);
    queueMetric(queue, mapRecovery(r, date));
  }
  // Per-cycle recovery for the current / recent cycles if the list endpoint omitted them.
  let fallbackCalls = 0;
  for (const c of cycleList) {
    const id = c.id != null ? String(c.id) : "";
    if (!id || recByCycle[id]) continue;
    if (++fallbackCalls > 4) break;
    try {
      const rec = await whoopGet(access, "/v2/cycle/" + id + "/recovery");
      if (rec) {
        const date = recoveryDayDate(rec, sleepDateById, cycleById);
        queueMetric(queue, mapRecovery(rec, date));
      }
    } catch (err) {
      console.error("cycle recovery " + id, err);
    }
  }
  await flushMetrics(sb, userId, queue);
  const workouts = await whoopGetAll(access, "/v2/activity/workout" + q).catch(() => ({ records: [] as Record<string, unknown>[] }));
  await flushWorkouts(sb, userId, (workouts.records || []).map((w) => mapWorkout(w)));
  await sb.from("whoop_links").upsert({
    user_id: userId,
    last_sync_at: new Date().toISOString(),
    last_error: null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  // Platform may prefix /functions/v1/whoop or just /whoop.
  const idx = parts.lastIndexOf("whoop");
  const tail = idx >= 0 ? parts.slice(idx + 1) : parts;
  const route = "/" + tail.join("/");

  try {
    if (req.method === "GET" && (route === "/health" || route === "/ready")) {
      return json({
        ok: true,
        whoop_configured: whoopConfigured(),
        redirect_uri_set: !!Deno.env.get("WHOOP_REDIRECT_URI"),
      });
    }

    if ((req.method === "GET" || req.method === "POST") && (route === "/" || route === "/start")) {
      const user = await userFromReq(req);
      if (!user) return json({ error: "auth_required", message: "not signed in — sign in first" }, 401);
      if (!whoopConfigured()) return missingWhoopConfig();
      const statePayload = user.id + "." + Date.now();
      const state = statePayload + "." + await signState(statePayload);
      const redirect = Deno.env.get("WHOOP_REDIRECT_URI") || "";
      const dest = WHOOP_AUTH +
        "?client_id=" + encodeURIComponent(Deno.env.get("WHOOP_CLIENT_ID") || "") +
        "&redirect_uri=" + encodeURIComponent(redirect) +
        "&response_type=code" +
        "&scope=" + encodeURIComponent(SCOPES) +
        "&state=" + encodeURIComponent(state);
      const accept = req.headers.get("Accept") || "";
      const wantsJson = req.method === "POST" || accept.includes("application/json") || url.searchParams.get("redirect") === "0";
      if (wantsJson) return json({ authorize_url: dest });
      return Response.redirect(dest, 302);
    }

    if (req.method === "GET" && (route === "/callback" || url.searchParams.has("code") || url.searchParams.has("error"))) {
      // supabase.co cannot serve HTML (forced text/plain). Always 302 back to the app.
      // Never await the Whoop pull before redirecting — it left Grant spinning on iPhone.
      const oauthErr = url.searchParams.get("error");
      if (oauthErr) {
        const reason = oauthErr === "access_denied" ? "denied" : "invalid";
        return appRedirect("error", reason);
      }
      if (!whoopConfigured()) return appRedirect("error", "config");
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const [userId, ts, sig] = state.split(".");
      if (!code || !userId || sig !== await signState(userId + "." + ts)) {
        return appRedirect("error", "invalid");
      }
      try {
        const token = await whoopToken({
          grant_type: "authorization_code",
          code,
          redirect_uri: Deno.env.get("WHOOP_REDIRECT_URI") || "",
        });
        const profile = await fetch(WHOOP_API + "/v2/user/profile/basic", {
          headers: { Authorization: "Bearer " + token.access_token },
        }).then((r) => r.json()).catch(() => ({}));
        const sb = admin();
        await saveTokens(sb, userId, token, profile.user_id ? String(profile.user_id) : undefined);
        const access = token && token.access_token ? String(token.access_token) : "";
        if (access) {
          waitUntil(withTimeout(
            pullRecent(sb, userId, access),
            90_000,
            "whoop initial sync",
          ));
        }
      } catch (err) {
        console.error(err);
        const msg = String((err as Error).message || err).toLowerCase();
        const reason = msg.includes("token") ? "token" : "server";
        return appRedirect("error", reason);
      }
      return appRedirect("connected");
    }

    if (req.method === "POST" && route === "/webhook") {
      if (!Deno.env.get("WHOOP_CLIENT_SECRET")) return missingWhoopConfig();
      const raw = await req.text();
      if (!await verifyWhoopSignature(req, raw)) return json({ error: "bad_signature" }, 401);
      const event = JSON.parse(raw || "{}");
      const sb = admin();
      if (event.trace_id) {
        const { error } = await sb.from("whoop_webhook_events").insert({
          trace_id: event.trace_id,
          whoop_user_id: String(event.user_id || ""),
          event_type: event.type,
        });
        if (error && String(error.message || "").includes("duplicate")) return json({ ok: true, deduped: true });
      }
      const userId = await userIdForWhoop(sb, String(event.user_id || ""));
      if (!userId) return json({ ok: true, ignored: "unknown_user" });
      const tok = await getValidToken(sb, userId);
      if (!tok) return json({ ok: true, ignored: "no_token" });
      if (String(event.type || "").endsWith(".deleted") && String(event.type).startsWith("sleep")) {
        // leave metrics; whoop recovery.deleted covers associated recovery
      }
      await ingestByType(sb, userId, tok.access_token, String(event.type || ""), String(event.id || ""));
      await sb.from("whoop_links").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("user_id", userId);
      return json({ ok: true });
    }

    if (req.method === "POST" && route === "/refresh") {
      const user = await userFromReq(req);
      if (!user) return json({ error: "auth_required" }, 401);
      const sb = admin();
      try {
        const before = await tokenMeta(sb, user.id);
        const tok = await getValidToken(sb, user.id);
        if (!tok) return json({ error: "not_connected" }, 400);
        // Opening the app must be quick: a 14-day window is plenty once the
        // link has synced before; only the very first pull backfills 90 days.
        const { data: linkRow } = await sb.from("whoop_links").select("last_sync_at").eq("user_id", user.id).maybeSingle();
        const asked = Number(url.searchParams.get("days") || 0);
        const days = asked > 0 ? Math.min(asked, 180) : (linkRow && linkRow.last_sync_at ? 14 : 90);
        await pullRecent(sb, user.id, tok.access_token as string, days);
        const meta = await tokenMeta(sb, user.id);
        return json({ ok: true, refreshed: before.token_updated_at !== meta.token_updated_at, ...meta });
      } catch (err) {
        if (isDefinitiveAuthLoss(err)) {
          return json({ error: "invalid_grant", message: "whoop needs reconnect" }, 409);
        }
        throw err;
      }
    }

    if ((req.method === "POST" || req.method === "GET") && route === "/cron") {
      const secret = Deno.env.get("WHOOP_CRON_SECRET") || "";
      const header = req.headers.get("Authorization") || "";
      const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
      const alt = req.headers.get("x-cron-secret") || url.searchParams.get("secret") || "";
      if (!secret || (bearer !== secret && alt !== secret)) {
        return json({ error: "auth_required" }, 401);
      }
      const sb = admin();
      const { data: rows, error } = await sb.from("whoop_tokens").select("user_id");
      if (error) throw error;
      let pulled = 0, refreshed = 0, reconnect = 0, failed = 0;
      for (const row of rows || []) {
        const userId = String(row.user_id);
        try {
          const before = await tokenMeta(sb, userId);
          const tok = await getValidToken(sb, userId);
          if (!tok || !tok.access_token) { failed += 1; continue; }
          const after = await tokenMeta(sb, userId);
          if (before.token_updated_at !== after.token_updated_at) refreshed += 1;
          await pullRecent(sb, userId, String(tok.access_token), Math.min(Number(url.searchParams.get("days") || 0) || 7, 180));
          pulled += 1;
        } catch (err) {
          if (isDefinitiveAuthLoss(err)) reconnect += 1;
          else {
            failed += 1;
            console.error("whoop cron user failed", String((err as Error).message || err).slice(0, 200));
          }
        }
      }
      // Leave a trace of every scheduled run (and whether today's recovery has
      // landed yet) so a missing morning can be diagnosed from the database.
      try {
        const today = jerusalemToday();
        const summary = { at: new Date().toISOString(), pulled, refreshed, reconnect, failed, today, today_recovery: [] as boolean[] };
        for (const row of rows || []) {
          const { data: m } = await sb.from("fit_records").select("data").eq("user_id", String(row.user_id))
            .eq("collection", "metrics").eq("record_id", "whoop-" + today).maybeSingle();
          summary.today_recovery.push(!!(m && m.data && (m.data as Record<string, unknown>).recoveryPct != null));
        }
        await sb.from("app_private_settings").upsert({ key: "whoop_last_cron", value: JSON.stringify(summary), updated_at: new Date().toISOString() });
      } catch (err) {
        console.error("whoop cron log failed", String((err as Error).message || err).slice(0, 200));
      }
      return json({ ok: true, pulled, refreshed, reconnect, failed });
    }

    if (req.method === "GET" && route === "/status") {
      const user = await userFromReq(req);
      if (!user) return json({ error: "auth_required" }, 401);
      const sb = admin();
      const { data } = await sb.from("whoop_links").select("whoop_user_id, connected_at, last_sync_at, last_error").eq("user_id", user.id).maybeSingle();
      const meta = await tokenMeta(sb, user.id);
      const lastError = data && data.last_error ? String(data.last_error) : "";
      const needsReconnect = !!(lastError === "invalid_grant" || (data && !meta.has_token) || (meta.has_token && !meta.has_refresh && !accessStillValid({ expires_at: meta.access_expires_at })));
      return json({
        connected: !!(data && meta.has_token && !needsReconnect),
        needs_reconnect: needsReconnect,
        link: data || null,
        ...meta,
      });
    }

    return json({ error: "not_found", route }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "server_error", message: String((err as Error).message || err) }, 500);
  }
});
