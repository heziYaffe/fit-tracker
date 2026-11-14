// Alternative to the Supabase Edge Function. Same routes and env names.
// wrangler secret put WHOOP_CLIENT_SECRET / SUPABASE_SERVICE_ROLE_KEY
// See ../README.md

const WHOOP_AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer";
const SCOPES = "read:recovery read:cycles read:sleep read:workout read:profile offline";

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": env.APP_ORIGIN || "*" } });
    // Delegate the heavy lifting by forwarding to the documented setup:
    // This worker is a drop-in if you prefer Cloudflare. It implements
    // the same surface; for the full mapping logic we recommend the
    // Supabase Edge Function (server/supabase/functions/whoop/index.ts),
    // which this file can import after you copy the helpers, or you can
    // set WHOOP_FN_URL to that function as a proxy.
    if (env.WHOOP_FN_URL) {
      const url = new URL(req.url);
      const dest = env.WHOOP_FN_URL.replace(/\/+$/, "") + url.pathname.replace(/^\/whoop/, "") + url.search;
      return fetch(dest, req);
    }
    return json({
      error: "configure_me",
      message: "Set WHOOP_FN_URL to the deployed Supabase function, or copy the Deno function logic into this worker. See server/README.md.",
    }, 501, env.APP_ORIGIN);
  },
};
