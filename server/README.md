# Cloud sync + Whoop — setup

This folder is a **ready-to-deploy backend**. The live GitHub Pages app stays fully usable offline until you fill in the public config. Do **not** commit secrets (`service_role`, Whoop client secret, or a filled `env` file).

---

## עברית

האפליקציה בטלפון כבר יודעת לסנכרן ולחבר Whoop, אבל הסעיפים «חשבון וסנכרון» ו«חיבור Whoop» בהגדרות יוצגו כ**בקרוב** עד שתמלא את הקובץ `js/cloud-config.js` בכתובת Supabase, במפתח anon, ובמזהה הלקוח של Whoop.

### 1. יצירת פרויקט Supabase

1. היכנסו ל-[https://supabase.com](https://supabase.com) וצרו פרויקט חדש (אפשר בחינם).
2. ב-Project Settings → API העתיקו:
   - **Project URL** (למשל `https://abcd.supabase.co`)
   - **anon public** key
   - **service_role** key (סודי — רק לשרת, לעולם לא לאפליקציה ולא לגיט)
3. ב-Authentication → Providers ודאו ש-Email פעיל, והפעילו **Magic link**. ב-URL Configuration הוסיפו Redirect URL:
   - `https://heziyaffe.github.io/fit-tracker/`
   - וגם `http://localhost:8765/` אם אתם בודקים מקומית.

### 2. הרצת הסכימה

1. ב-Supabase: SQL Editor → New query.
2. הדביקו את כל הקובץ `server/supabase/schema.sql` והריצו.
3. ודאו שהטבלאות `profiles`, `fit_records`, `whoop_tokens`, `whoop_links`, `whoop_webhook_events` נוצרו, ושל-`fit_records` / `profiles` / `whoop_links` יש RLS.

### 3. רישום אפליקציית Whoop

1. היכנסו ל-[https://developer.whoop.com](https://developer.whoop.com) וצרו אפליקציה.
2. Scopes לבקש: `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile`, ו-`offline` (כדי לקבל refresh token).
3. **Redirect URI** (חייב להתאים בדיוק):
   - `https://YOUR_PROJECT.supabase.co/functions/v1/whoop/callback`
   - אם תשתמשו ב-Cloudflare Worker במקום: `https://YOUR_WORKER.workers.dev/callback`
4. שמרו את **Client ID** (אפשר לשים באפליקציה) ואת **Client Secret** (רק בשרת).
5. Webhook URL (אחרי הפריסה):
   - `https://YOUR_PROJECT.supabase.co/functions/v1/whoop/webhook`
   - מודל v2. אימות החתימה משתמש ב-Client Secret (HMAC-SHA256 של `timestamp + body`, ב-Base64; כותרות `X-WHOOP-Signature` ו-`X-WHOOP-Signature-Timestamp`).

### 4. פריסת ה-Edge Function

במחשב שלכם, עם [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
# מהשורש של הריפו, או העתיקו את server/supabase/functions/whoop
supabase functions deploy whoop --no-verify-jwt
supabase secrets set \
  WHOOP_CLIENT_ID=... \
  WHOOP_CLIENT_SECRET=... \
  WHOOP_REDIRECT_URI=https://YOUR_PROJECT.supabase.co/functions/v1/whoop/callback \
  APP_ORIGIN=https://heziyaffe.github.io \
  SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=...
```

`--no-verify-jwt` נחוץ ל-callback של Whoop ול-webhook (אין להם JWT של המשתמש). הנתיבים שכן דורשים התחברות (`/start`, `/refresh`, `/status`) בודקים את האסימון בעצמם.

### 5. מילוי קונפיג באפליקציה

פתחו את `js/cloud-config.js` ומלאו **רק** את שלושת השדות הציבוריים:

```js
window.FitCloudConfig = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key",
  WHOOP_CLIENT_ID: "your-whoop-client-id",
  WHOOP_FN_URL: "https://YOUR_PROJECT.supabase.co/functions/v1/whoop"
};
```

אל תשימו כאן את `service_role` או את Whoop client secret. אחרי push ל-GitHub Pages, סעיפי החשבון ו-Whoop בהגדרות יהפכו לפעילים: כניסה בקישור מייל, סנכרון, ו«חבר Whoop».


### 6. משיכה יומית אוטומטית

אחרי פריסת הפונקציה, הגדירו את הסוד `WHOOP_CRON_SECRET` ב-Edge Function secrets, ואת אותו ערך בטבלה `public.app_private_settings` תחת המפתח `whoop_cron_secret`. אחר כך הריצו את `server/supabase/cron.sql` כדי לתזמן משיכה כל יום ב-07:10 שעון ישראל. החיבור עצמו נשמר בשרת; צריך לאשר ב-Whoop רק פעם אחת, אלא אם Whoop ביטל את ההרשאה.

### חלופה: Cloudflare Worker

אם תעדיפו Worker במקום Edge Function, ראו `server/cloudflare-worker/`. אפשר להעתיק את `wrangler.toml.example`, לשים סודות ב-`wrangler secret put`, ולעדכן את `WHOOP_REDIRECT_URI` ואת כתובת ה-webhook ב-Whoop. אפשר גם להפנות (`WHOOP_FN_URL`) לפונקציית Supabase שכבר נפרסה.

### מיפוי Whoop → פיט

| Whoop | אצלנו |
| --- | --- |
| Recovery score | `metrics.recoveryPct`, `source: "whoop"` |
| HRV (`hrv_rmssd_milli`) | `metrics.hrv` |
| Cycle strain | `metrics.strain` |
| Sleep duration / performance | `metrics.sleepHours` + הערה על ביצועי השינה |
| Workout | אימון עם `source: "whoop"` (סוג קרדיו / שם הספורט) |

---

## English

The phone app already contains the sync and Whoop client, but the Settings sections **Account & sync** and **Whoop connection** stay in a **Coming soon** state until you fill `js/cloud-config.js` with your Supabase URL, anon key, and Whoop client id.

### 1. Create a Supabase project

1. Create a project at [https://supabase.com](https://supabase.com) (the free tier is enough).
2. From Project Settings → API copy the **Project URL**, the **anon public** key, and the **service_role** key. The service role is secret: never put it in the app or in git.
3. Authentication → Providers: enable Email **Magic link**. Under URL Configuration add redirect URLs:
   - `https://heziyaffe.github.io/fit-tracker/`
   - `http://localhost:8765/` for local tests.

### 2. Run the schema

1. Supabase SQL Editor → New query.
2. Paste and run `server/supabase/schema.sql`.
3. Confirm tables `profiles`, `fit_records`, `whoop_tokens`, `whoop_links`, `whoop_webhook_events` exist, with RLS on the client-facing tables.

### 3. Register a Whoop developer app

1. Create an app at [https://developer.whoop.com](https://developer.whoop.com).
2. Request scopes: `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile`, plus `offline` (required for a refresh token).
3. Redirect URI (must match exactly):
   - `https://YOUR_PROJECT.supabase.co/functions/v1/whoop/callback`
   - or, if you use the Cloudflare Worker: `https://YOUR_WORKER.workers.dev/callback`
4. Keep the **Client ID** (safe in the client config) and the **Client Secret** (server only).
5. After deploy, set the webhook URL to `https://YOUR_PROJECT.supabase.co/functions/v1/whoop/webhook` (v2). Signature check is HMAC-SHA256 of `timestamp + raw body`, Base64-encoded, using the client secret (`X-WHOOP-Signature` / `X-WHOOP-Signature-Timestamp`).

### 4. Deploy the Edge Function

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy whoop --no-verify-jwt
supabase secrets set \
  WHOOP_CLIENT_ID=... \
  WHOOP_CLIENT_SECRET=... \
  WHOOP_REDIRECT_URI=https://YOUR_PROJECT.supabase.co/functions/v1/whoop/callback \
  APP_ORIGIN=https://heziyaffe.github.io \
  SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=...
```

`--no-verify-jwt` is required so Whoop’s callback and webhooks can reach the function. `/start`, `/refresh`, and `/status` still validate the user JWT themselves.

### 5. Fill in the app config

Edit `js/cloud-config.js` with the three public values (and the function URL). Never put `service_role` or the Whoop client secret there. After you push to GitHub Pages, Settings will enable magic-link sign-in, sync, and **Connect Whoop**.

### Alternative: Cloudflare Worker

See `server/cloudflare-worker/`. Copy `wrangler.toml.example`, set secrets with `wrangler secret put`, and point Whoop’s redirect + webhook at the worker. You can also set `WHOOP_FN_URL` so the worker proxies to the already-deployed Supabase function.

### Whoop → Fit mapping

| Whoop | In the app |
| --- | --- |
| Recovery score | `metrics.recoveryPct`, `source: "whoop"` |
| HRV (`hrv_rmssd_milli`) | `metrics.hrv` |
| Cycle strain | `metrics.strain` |
| Sleep duration / performance | `metrics.sleepHours` plus a sleep-performance note |
| Workout | a workout with `source: "whoop"` (cardio / sport name) |
