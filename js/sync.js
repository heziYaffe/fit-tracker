/* פיט — cloud sync abstraction: change log, updatedAt, last-write-wins merge.
   Talks to Supabase when js/cloud-config.js is filled; otherwise no-ops. */
(function (root) {
  'use strict';

  var COLLECTIONS = ['workouts', 'nutrition', 'weights', 'metrics', 'foods', 'templates', 'menus', 'dayMenus', 'measures', 'foodLog'];
  var authUser = null;
  var status = { configured: false, user: null, lastSync: null, error: null };

  function cfg() { return root.FitCloudConfig || {}; }

  function isConfigured() {
    const c = cfg();
    return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
  }

  function whoopReady() {
    const c = cfg();
    if (!isConfigured() || !(c.WHOOP_FN_URL || c.SUPABASE_URL)) return false;
    // The Edge Function builds the Whoop authorize URL. Enable the UI when
    // a client id is present or WHOOP_ENABLED is set.
    return !!(c.WHOOP_CLIENT_ID || c.WHOOP_ENABLED);
  }

  function fnUrl() {
    const c = cfg();
    if (c.WHOOP_FN_URL) return c.WHOOP_FN_URL.replace(/\/+$/, '');
    if (c.SUPABASE_URL) return c.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/whoop';
    return '';
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function normalizePassword(password) {
    return String(password || '').trim();
  }

  function headers(extra) {
    const c = cfg();
    const h = {
      apikey: c.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + ((authUser && authUser.access_token) || c.SUPABASE_ANON_KEY)
    };
    return Object.assign(h, extra || {});
  }

  function parseJsonRes(res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      if (!res.ok) throw new Error((body && (body.message || body.msg)) || ('http ' + res.status));
      return body;
    });
  }

  function authedFetch(url, opts) {
    opts = opts || {};
    return ensureFreshAccess().then(function () {
      return fetch(url, Object.assign({}, opts, { headers: headers(opts.headers) }));
    }).then(function (res) {
      if (res.status !== 401) return res;
      return refreshSession().then(function (sess) {
        if (!sess) return res;
        return fetch(url, Object.assign({}, opts, { headers: headers(opts.headers) }));
      });
    });
  }

  function rest(path, opts) {
    const c = cfg();
    return authedFetch(c.SUPABASE_URL.replace(/\/+$/, '') + path, opts || {}).then(parseJsonRes);
  }

  function mergeRecords(localArr, remoteArr) {
    const map = {};
    function eat(row, src) {
      if (!row || !row.id) return;
      const cur = map[row.id];
      const ts = Date.parse(row.updatedAt || row.updated_at || 0) || 0;
      if (!cur) { map[row.id] = { row: row, ts: ts, src: src }; return; }
      if (ts > cur.ts) map[row.id] = { row: row, ts: ts, src: src };
    }
    (localArr || []).forEach(function (r) { eat(r, 'local'); });
    (remoteArr || []).forEach(function (r) { eat(r, 'remote'); });
    const out = [];
    Object.keys(map).forEach(function (id) {
      const rec = map[id].row;
      // Local tombstones (deletedAt) stay so the next push records the delete.
      if (rec.deleted_at && !rec.deletedAt) return;
      out.push(rec);
    });
    return out;
  }

  function mergeStates(local, remote) {
    const next = Object.assign({}, local);
    COLLECTIONS.forEach(function (col) {
      next[col] = mergeRecords(local[col] || [], remote[col] || []);
    });
    if (remote.settings && local.settings) {
      const lt = Date.parse((local.settings && local.settings.updatedAt) || 0) || 0;
      const rt = Date.parse((remote.settings && remote.settings.updatedAt) || 0) || 0;
      next.settings = rt > lt ? Object.assign({}, local.settings, remote.settings) : Object.assign({}, remote.settings, local.settings);
    }
    return next;
  }

  function packCollections(state) {
    const rows = [];
    COLLECTIONS.forEach(function (col) {
      (state[col] || []).forEach(function (rec) {
        if (!rec || !rec.id) return;
        rows.push({
          collection: col,
          record_id: rec.id,
          data: rec,
          updated_at: rec.updatedAt || rec.updated_at || new Date().toISOString(),
          deleted_at: rec.deletedAt || null
        });
      });
    });
    if (state.settings) {
      rows.push({
        collection: 'settings',
        record_id: 'settings',
        data: state.settings,
        updated_at: state.settings.updatedAt || new Date().toISOString(),
        deleted_at: null
      });
    }
    return rows;
  }

  function unpackCollections(rows) {
    const state = {};
    COLLECTIONS.forEach(function (c) { state[c] = []; });
    (rows || []).forEach(function (row) {
      if (row.deleted_at) return;
      const col = row.collection;
      const data = row.data || {};
      if (!data.updatedAt && row.updated_at) data.updatedAt = row.updated_at;
      if (col === 'settings') state.settings = data;
      else if (state[col]) state[col].push(data);
    });
    return state;
  }

  var AUTH_KEY = 'hazi-fit-auth';
  var refreshInFlight = null;
  var ACCESS_SKEW_MS = 60 * 1000;

  function decodeJwtExpMs(access) {
    if (!access) return 0;
    try {
      var part = String(access).split('.')[1];
      if (!part) return 0;
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var json = JSON.parse(typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8'));
      return (Number(json.exp) || 0) * 1000;
    } catch (e) { return 0; }
  }

  function publicUser(user) {
    if (!user || !user.id) return null;
    return { id: user.id, email: user.email };
  }

  function readStoredAuth() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || (!saved.access_token && !saved.refresh_token)) return null;
      return saved;
    } catch (e) { return null; }
  }

  function writeStoredAuth(sess) {
    try {
      if (!sess) localStorage.removeItem(AUTH_KEY);
      else localStorage.setItem(AUTH_KEY, JSON.stringify({
        access_token: sess.access_token || '',
        refresh_token: sess.refresh_token || '',
        user: publicUser(sess.user) || sess.user || null,
        expires_at: sess.expires_at || decodeJwtExpMs(sess.access_token)
      }));
    } catch (e) {}
  }

  function accessValid(sess, skew) {
    if (!sess || !sess.access_token) return false;
    var exp = Number(sess.expires_at) || decodeJwtExpMs(sess.access_token);
    if (!exp) return false;
    return exp - (skew == null ? ACCESS_SKEW_MS : skew) > Date.now();
  }

  function setSession(sess) {
    if (!sess) {
      authUser = null;
      status.user = null;
      status.whoop = undefined;
      try { localStorage.removeItem('fit-whoop-status'); } catch (e) { /* ignore */ }
      writeStoredAuth(null);
      return;
    }
    var prev = readStoredAuth() || authUser || {};
    var next = {
      access_token: sess.access_token || prev.access_token || '',
      refresh_token: sess.refresh_token || prev.refresh_token || '',
      user: (sess.user && sess.user.id) ? sess.user : (prev.user || {}),
      expires_at: sess.expires_at || decodeJwtExpMs(sess.access_token || prev.access_token)
    };
    authUser = next;
    status.user = publicUser(next.user);
    writeStoredAuth(next);
  }

  function isDefinitiveInvalidRefresh(res, data) {
    var err = String((data && (data.error || data.error_description || data.error_code || data.msg || data.message)) || '').toLowerCase();
    var code = String((data && (data.error_code || data.code || data.error)) || '').toLowerCase();
    if (code === 'invalid_grant' || err === 'invalid_grant') return true;
    if (err.indexOf('refresh_token_not_found') >= 0 || code.indexOf('refresh_token_not_found') >= 0) return true;
    if (err.indexOf('invalid refresh') >= 0 || err.indexOf('invalid_refresh_token') >= 0) return true;
    if ((res && (res.status === 400 || res.status === 401)) && err.indexOf('refresh') >= 0 &&
        (err.indexOf('invalid') >= 0 || err.indexOf('expired') >= 0 || err.indexOf('not found') >= 0)) {
      return true;
    }
    return false;
  }

  function postRefresh(token) {
    var c = cfg();
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: c.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { res: res, data: data };
      });
    });
  }

  function doRefresh(preferredToken) {
    var stored = readStoredAuth() || {};
    var token = preferredToken || (authUser && authUser.refresh_token) || stored.refresh_token;
    if (!token) return Promise.resolve(authUser || null);
    var usedToken = token;
    return postRefresh(token).then(function (out) {
      var res = out.res;
      var data = out.data || {};
      if (res.ok && data.access_token) {
        var expiresAt = data.expires_in
          ? (Date.now() + Number(data.expires_in) * 1000)
          : decodeJwtExpMs(data.access_token);
        setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token || usedToken,
          user: data.user || stored.user || (authUser && authUser.user),
          expires_at: expiresAt
        });
        return authUser;
      }
      if (isDefinitiveInvalidRefresh(res, data)) {
        var now = readStoredAuth();
        if (now && now.refresh_token && now.refresh_token !== usedToken) {
          return doRefresh(now.refresh_token);
        }
        setSession(null);
        return null;
      }
      if (!authUser && (stored.refresh_token || stored.access_token)) setSession(stored);
      return authUser || null;
    }).catch(function () {
      if (!authUser && (stored.refresh_token || stored.access_token)) setSession(stored);
      return authUser || null;
    });
  }

  function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = doRefresh(null).then(function (v) {
      refreshInFlight = null;
      return v;
    }, function (err) {
      refreshInFlight = null;
      throw err;
    });
    return refreshInFlight;
  }

  function ensureFreshAccess() {
    var sess = authUser || readStoredAuth();
    if (sess && !authUser) setSession(sess);
    if (accessValid(authUser, ACCESS_SKEW_MS)) return Promise.resolve(authUser);
    if (authUser && authUser.refresh_token) return refreshSession();
    var stored = readStoredAuth();
    if (stored && stored.refresh_token) {
      if (!authUser) setSession(stored);
      return refreshSession();
    }
    return Promise.resolve(authUser);
  }

  function restoreSession() {
    if (!isConfigured()) return Promise.resolve(null);
    var saved = readStoredAuth();
    if (!saved) return Promise.resolve(null);
    setSession(saved);
    if (!saved.access_token || !accessValid(saved, 0)) return refreshSession();
    var c = cfg();
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user', {
      headers: { apikey: c.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + saved.access_token }
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (user) {
        if (res.ok && user && user.id) {
          setSession({
            access_token: saved.access_token,
            refresh_token: saved.refresh_token,
            user: user,
            expires_at: saved.expires_at || decodeJwtExpMs(saved.access_token)
          });
          return authUser;
        }
        if (res.status === 401 || res.status === 403) return refreshSession();
        return authUser;
      });
    }).catch(function () { return authUser; });
  }

  function hydrateSession() {
    var saved = readStoredAuth();
    if (saved) setSession(saved);
  }

  function authErrorMessage(body, fallback) {
    const raw = String((body && (body.msg || body.error_description || body.error || body.message)) || fallback || '');
    const low = raw.toLowerCase();
    const code = String((body && (body.error_code || body.code || '')) || '').toLowerCase();
    if (code.indexOf('over_email_send_rate_limit') >= 0 || low.indexOf('rate limit') >= 0 || low.indexOf('email rate') >= 0) {
      return 'נשלחו יותר מדי מיילים, נסה בעוד שעה או היכנס עם סיסמה';
    }
    if (code === 'invalid_credentials' || low.indexOf('invalid login') >= 0 || low.indexOf('invalid credentials') >= 0) {
      return 'אימייל או סיסמה שגויים';
    }
    if (low.indexOf('already registered') >= 0 || low.indexOf('user already') >= 0) {
      return 'החשבון כבר קיים. היכנסו עם סיסמה, או שלחו קוד למייל';
    }
    if (low.indexOf('password') >= 0 && (low.indexOf('6') >= 0 || low.indexOf('least') >= 0 || low.indexOf('short') >= 0)) {
      return 'הסיסמה קצרה מדי (לפחות 6 תווים)';
    }
    if (code.indexOf('otp') >= 0 || ((low.indexOf('invalid') >= 0 || low.indexOf('expired') >= 0) && (low.indexOf('otp') >= 0 || low.indexOf('token') >= 0 || low.indexOf('code') >= 0))) {
      return 'הקוד שגוי או שפג תוקפו';
    }
    if (low.indexOf('signup is disabled') >= 0) return 'הרשמה חדשה כבויה כרגע';
    if (raw === 'not-signed-in' || fallback === 'not-signed-in') return 'קודם צריך להתחבר לחשבון';
    if (raw === 'whoop-not-ready' || raw === 'not-ready') return 'חיבור Whoop לא מוכן עדיין';
    if (low.indexOf('failed to fetch') >= 0 || low.indexOf('networkerror') >= 0 || low.indexOf('load failed') >= 0 || low.indexOf('network request failed') >= 0) {
      return 'אין חיבור לשרת. בדקו את הרשת ונסו שוב';
    }
    const extra = code && raw.indexOf(code) < 0 ? (' (' + code + ')') : '';
    return (raw || fallback || 'הפעולה נכשלה') + extra;
  }

  function authFetch(path, body) {
    const c = cfg();
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(authErrorMessage(b, 'הפעולה נכשלה'));
        return b;
      });
    }).catch(function (err) {
      if (err && err.message && err.message !== 'Failed to fetch' && !/failed to fetch|networkerror|load failed|network request failed/i.test(err.message)) throw err;
      throw new Error(authErrorMessage({ message: err && err.message }, 'ההתחברות נכשלה'));
    });
  }

  function applySession(data) {
    if (!data || !data.access_token) throw new Error('ההתחברות נכשלה');
    setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user || {}
    });
    if (data.user && data.user.id) return Promise.resolve(authUser);
    return restoreSession().then(function () {
      if (!authUser) throw new Error('ההתחברות נכשלה');
      return authUser;
    });
  }

  function signInWithPassword(email, password) {
    if (!isConfigured()) return Promise.reject(new Error('not-configured'));
    email = normalizeEmail(email);
    password = normalizePassword(password);
    if (!email || !password) return Promise.reject(new Error('יש להזין אימייל וסיסמה'));
    return authFetch('/auth/v1/token?grant_type=password', { email: email, password: password }).then(applySession);
  }

  function signUpWithPassword(email, password) {
    if (!isConfigured()) return Promise.reject(new Error('not-configured'));
    email = normalizeEmail(email);
    password = normalizePassword(password);
    if (!email || !password) return Promise.reject(new Error('יש להזין אימייל וסיסמה'));
    if (password.length < 6) return Promise.reject(new Error('הסיסמה קצרה מדי (לפחות 6 תווים)'));
    return authFetch('/auth/v1/signup', { email: email, password: password }).then(function (data) {
      if (data && data.access_token) return applySession(data);
      throw new Error('ההרשמה נקלטה. אם לא התחברתם אוטומטית, נסו כניסה עם הסיסמה');
    });
  }

  function sendOtp(email, redirectTo) {
    if (!isConfigured()) return Promise.reject(new Error('not-configured'));
    email = normalizeEmail(email);
    if (!email) return Promise.reject(new Error('יש להזין אימייל'));
    const c = cfg();
    const back = redirectTo || (typeof location !== 'undefined' ? (location.origin + location.pathname.replace(/index\.html$/, '')) : '');
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/otp?redirect_to=' + encodeURIComponent(back), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email: email, create_user: true })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(authErrorMessage(b, 'שליחת הקוד נכשלה'));
        return { ok: true };
      });
    });
  }

  function verifyOtp(email, token) {
    if (!isConfigured()) return Promise.reject(new Error('not-configured'));
    email = normalizeEmail(email);
    token = String(token || '').trim();
    if (!email || !token) return Promise.reject(new Error('יש להזין אימייל וקוד'));
    return authFetch('/auth/v1/verify', { type: 'email', email: email, token: token }).then(applySession);
  }

  function updatePassword(password) {
    if (!authUser) return Promise.reject(new Error('not-signed-in'));
    password = normalizePassword(password);
    if (!password || password.length < 6) return Promise.reject(new Error('הסיסמה קצרה מדי (לפחות 6 תווים)'));
    const c = cfg();
    return authedFetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ password: password })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (!res.ok) throw new Error(authErrorMessage(b, 'עדכון הסיסמה נכשל'));
        return { ok: true };
      });
    });
  }

  function sendMagicLink(email, redirectTo) {
    return sendOtp(email, redirectTo);
  }

  function handleAuthRedirect() {
    if (typeof location === 'undefined') return Promise.resolve(null);
    const hash = (location.hash || '').replace(/^#/, '');
    const qs = new URLSearchParams(hash.indexOf('access_token') >= 0 ? hash : location.search.replace(/^\?/, ''));
    const access = qs.get('access_token');
    if (!access) return restoreSession();
    const refresh = qs.get('refresh_token');
    setSession({ access_token: access, refresh_token: refresh, user: {} });
    return restoreSession();
  }

  function signOut() {
    setSession(null);
    return Promise.resolve();
  }

  function pull() {
    if (!authUser) return Promise.reject(new Error('not-signed-in'));
    return rest('/rest/v1/fit_records?select=collection,record_id,data,updated_at,deleted_at')
      .then(unpackCollections);
  }

  function push(state) {
    if (!authUser) return Promise.reject(new Error('not-signed-in'));
    const rows = packCollections(state).map(function (r) {
      return Object.assign({ user_id: authUser.user.id }, r);
    });
    if (!rows.length) return Promise.resolve({ pushed: 0 });
    const c = cfg();
    return authedFetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/fit_records', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows)
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(t || 'push failed'); });
      return { pushed: rows.length };
    });
  }

  function syncNow() {
    if (!isConfigured() || !authUser || !root.FitStore) return Promise.resolve({ skipped: true });
    return pull().then(function (remote) {
      const local = root.FitStore.getState();
      const merged = mergeStates(local, remote);
      if (root.FitEngine && root.FitEngine.backfillCardioWorkouts) {
        const filled = root.FitEngine.backfillCardioWorkouts(merged.workouts || []);
        if (filled && filled.changed) {
          merged.workouts = filled.workouts;
          const now = new Date().toISOString();
          (merged.workouts || []).forEach(function (w) {
            if (w && filled.touched && filled.touched.indexOf(w.id) >= 0) w.updatedAt = now;
          });
        }
      }
      root.FitStore.importJSON({ data: Object.assign({}, local, merged) });
      return push(root.FitStore.getState());
    }).then(function (res) {
      status.lastSync = new Date().toISOString();
      status.error = null;
      return res;
    }).catch(function (err) {
      status.error = String(err.message || err);
      throw err;
    });
  }

  function whoopStartUrl() {
    if (!whoopReady() || !authUser) return '';
    return fnUrl() + '/start?access_token=' + encodeURIComponent(authUser.access_token);
  }

  function whoopAuthorizeUrl() {
    if (!whoopReady()) return Promise.reject(new Error('חיבור Whoop לא מוכן עדיין'));
    if (!authUser) return Promise.reject(new Error('קודם צריך להתחבר לחשבון'));
    return authedFetch(fnUrl() + '/start', { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) throw new Error('קודם צריך להתחבר לחשבון');
        if (!res.ok) throw new Error(authErrorMessage(body, 'שגיאה בהתחברות ל-Whoop'));
        if (!body.authorize_url) throw new Error('שגיאה בהתחברות ל-Whoop');
        return body.authorize_url;
      });
    });
  }

  // Last answer the server gave about the Whoop link, so the first paint after
  // opening the app already knows "connected" (no flash of «חבר Whoop» while
  // the status call is in flight, offline, or the app session is refreshing).
  var WHOOP_STATUS_KEY = 'fit-whoop-status';
  function saveWhoopStatus(w) {
    try {
      if (!w || !w.definitive) return;
      localStorage.setItem(WHOOP_STATUS_KEY, JSON.stringify({
        connected: !!w.connected, needs_reconnect: !!w.needs_reconnect, definitive: true,
        link: w.link ? { connected_at: w.link.connected_at || null, last_sync_at: w.link.last_sync_at || null } : null,
        at: new Date().toISOString()
      }));
    } catch (e) { /* ignore */ }
  }
  function loadWhoopStatus() {
    try {
      var w = JSON.parse(localStorage.getItem(WHOOP_STATUS_KEY) || 'null');
      return w && w.definitive ? Object.assign({}, w, { cached: true }) : null;
    } catch (e) { return null; }
  }
  if (readStoredAuth()) status.whoop = loadWhoopStatus() || undefined;

  // 'connected' | 'reconnect' | 'disconnected' | 'unknown'. Only a definitive
  // server answer (status 200, or a refresh that said invalid_grant /
  // not_connected) can make it 'reconnect' or 'disconnected'; a 401 from the
  // app session, a 5xx, no network or "not checked yet" stays 'unknown'.
  function whoopConnState(w) {
    w = w === undefined ? status.whoop : w;
    if (!w) return 'unknown';
    if (w.needs_reconnect && w.definitive) return 'reconnect';
    if (w.connected && !w.needs_reconnect) return 'connected';
    if (w.definitive && !w.connected) return 'disconnected';
    return 'unknown';
  }

  function applyWhoopStatusResponse(prev, httpStatus, body) {
    prev = prev || {};
    body = body || {};
    if (httpStatus === 401) {
      return Object.assign({}, prev, {
        authRequired: true,
        error: 'קודם צריך להתחבר לחשבון'
      });
    }
    if (!(httpStatus >= 200 && httpStatus < 300)) {
      return Object.assign({}, prev, {
        statusFailed: true,
        error: authErrorMessage(body, 'לא ניתן לבדוק את מצב Whoop')
      });
    }
    if (!body || typeof body.connected !== 'boolean') {
      return Object.assign({}, prev, { statusFailed: true });
    }
    return Object.assign({}, body, { definitive: true });
  }

  function whoopStatus() {
    if (!whoopReady() || !(authUser || readStoredAuth())) {
      status.whoop = { connected: false };
      return Promise.resolve(status.whoop);
    }
    return authedFetch(fnUrl() + '/status').then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        status.whoop = applyWhoopStatusResponse(status.whoop, r.status, body);
        saveWhoopStatus(status.whoop);
        return status.whoop;
      });
    }).catch(function (err) {
      status.whoop = Object.assign({}, status.whoop || {}, { error: String(err.message || err), statusFailed: true });
      return status.whoop;
    });
  }

  function markWhoopPulled() {
    try { localStorage.setItem('fit-whoop-last-pull', String(Date.now())); } catch (e) {}
  }

  function lastWhoopPullAt() {
    try { return Number(localStorage.getItem('fit-whoop-last-pull') || 0) || 0; } catch (e) { return 0; }
  }

  function whoopRefresh() {
    if (!whoopReady()) return Promise.reject(new Error('חיבור Whoop לא מוכן עדיין'));
    if (!authUser) return Promise.reject(new Error('קודם צריך להתחבר לחשבון'));
    return authedFetch(fnUrl() + '/refresh', { method: 'POST' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) {
          if (body && (body.error === 'invalid_grant' || body.error === 'not_connected')) {
            status.whoop = Object.assign({}, status.whoop || {}, {
              needs_reconnect: true,
              definitive: true,
              connected: false,
              error: 'החיבור ל-Whoop פג. לחצו «חבר Whoop» פעם אחת.'
            });
            saveWhoopStatus(status.whoop);
          }
          throw new Error(authErrorMessage(body, 'משיכת נתוני Whoop נכשלה'));
        }
        markWhoopPulled();
        if (body) {
          // a successful pull proves the link works
          status.whoop = Object.assign({}, status.whoop || {}, body, { connected: true, needs_reconnect: false, definitive: true, error: null });
          saveWhoopStatus(status.whoop);
        }
        return body;
      });
    });
  }

  var lastWhoopSyncSeen = null;
  var WHOOP_PULL_EVERY_MS = 15 * 60 * 1000;

  function onForeground(opts) {
    if (!isConfigured() || !authUser || !whoopReady()) return Promise.resolve(null);
    const force = !!(opts && opts.force);
    return whoopStatus().then(function (s) {
      if (!(s && s.connected)) return s;
      const due = force || (Date.now() - lastWhoopPullAt() >= WHOOP_PULL_EVERY_MS);
      if (due) {
        return whoopRefresh().then(function () {
          return syncNow().then(function () { return s; });
        }).catch(function (err) {
          status.whoop = Object.assign({}, s, { error: err && err.message });
          return s;
        });
      }
      const stamp = s && s.link && (s.link.last_sync_at || s.last_sync_at);
      if (stamp && stamp !== lastWhoopSyncSeen) {
        lastWhoopSyncSeen = stamp;
        return syncNow().then(function () { return s; }).catch(function () { return s; });
      }
      return s;
    });
  }

  function init() {
    status.configured = isConfigured();
    return handleAuthRedirect().then(function () {
      if (authUser && whoopReady()) return whoopStatus().then(function () { return authUser; });
      return authUser;
    });
  }

  var FitSync = {
    COLLECTIONS: COLLECTIONS,
    isConfigured: isConfigured,
    whoopReady: whoopReady,
    status: function () {
      return Object.assign({}, status, {
        configured: isConfigured(), signedIn: !!authUser, whoopReady: whoopReady(),
        // a stored session that is still being restored counts as signed in for display
        maybeSignedIn: !!(authUser || readStoredAuth()),
        whoopState: whoopConnState()
      });
    },
    whoopConnState: whoopConnState,
    mergeRecords: mergeRecords,
    mergeStates: mergeStates,
    packCollections: packCollections,
    unpackCollections: unpackCollections,
    sendMagicLink: sendMagicLink,
    sendOtp: sendOtp,
    verifyOtp: verifyOtp,
    signInWithPassword: signInWithPassword,
    signUpWithPassword: signUpWithPassword,
    updatePassword: updatePassword,
    authErrorMessage: authErrorMessage,
    signOut: signOut,
    restoreSession: restoreSession,
    syncNow: syncNow,
    whoopStartUrl: whoopStartUrl,
    whoopAuthorizeUrl: whoopAuthorizeUrl,
    whoopStatus: whoopStatus,
    applyWhoopStatusResponse: applyWhoopStatusResponse,
    whoopRefresh: whoopRefresh,
    onForeground: onForeground,
    init: init,
    refreshSession: refreshSession,
    ensureFreshAccess: ensureFreshAccess,
    authedFetch: authedFetch
  };

  hydrateSession();
  root.FitSync = FitSync;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitSync;
})(typeof window !== 'undefined' ? window : globalThis);
