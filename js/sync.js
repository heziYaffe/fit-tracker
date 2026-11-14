/* פיט — cloud sync abstraction: change log, updatedAt, last-write-wins merge.
   Talks to Supabase when js/cloud-config.js is filled; otherwise no-ops. */
(function (root) {
  'use strict';

  var COLLECTIONS = ['workouts', 'nutrition', 'weights', 'metrics', 'foods', 'templates', 'menus', 'dayMenus', 'measures'];
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

  function rest(path, opts) {
    const c = cfg();
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + path, Object.assign({ headers: headers() }, opts || {}))
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error((body && body.message) || ('http ' + res.status));
          return body;
        });
      });
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
      if (rec.deletedAt || rec.deleted_at) return;
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

  function setSession(sess) {
    authUser = sess;
    status.user = sess && sess.user ? { id: sess.user.id, email: sess.user.email } : null;
    try {
      if (sess) localStorage.setItem('hazi-fit-auth', JSON.stringify({ access_token: sess.access_token, refresh_token: sess.refresh_token, user: status.user }));
      else localStorage.removeItem('hazi-fit-auth');
    } catch (e) {}
  }

  function restoreSession() {
    if (!isConfigured()) return Promise.resolve(null);
    try {
      const raw = localStorage.getItem('hazi-fit-auth');
      if (!raw) return Promise.resolve(null);
      const saved = JSON.parse(raw);
      if (!saved || !saved.access_token) return Promise.resolve(null);
      return rest('/auth/v1/user', { headers: headers({ Authorization: 'Bearer ' + saved.access_token }) })
        .then(function (user) {
          setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token, user: user });
          return authUser;
        })
        .catch(function () {
          if (!saved.refresh_token) { setSession(null); return null; }
          const c = cfg();
          return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { apikey: c.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: saved.refresh_token })
          }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
              if (!res.ok || !data.access_token) { setSession(null); return null; }
              setSession({ access_token: data.access_token, refresh_token: data.refresh_token || saved.refresh_token, user: data.user || saved.user });
              return authUser;
            });
          }).catch(function () { setSession(null); return null; });
        });
    } catch (e) { return Promise.resolve(null); }
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
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/user', {
      method: 'PUT',
      headers: headers(),
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
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/fit_records', {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates' }),
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
    return fetch(fnUrl() + '/start', { headers: headers({ Accept: 'application/json' }) }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) throw new Error('קודם צריך להתחבר לחשבון');
        if (!res.ok) throw new Error(authErrorMessage(body, 'שגיאה בהתחברות ל-Whoop'));
        if (!body.authorize_url) throw new Error('שגיאה בהתחברות ל-Whoop');
        return body.authorize_url;
      });
    });
  }

  function whoopStatus() {
    if (!whoopReady() || !authUser) {
      status.whoop = { connected: false };
      return Promise.resolve(status.whoop);
    }
    return fetch(fnUrl() + '/status', { headers: headers() }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (r.status === 401) {
          status.whoop = { connected: false, error: 'קודם צריך להתחבר לחשבון' };
          return status.whoop;
        }
        if (!r.ok) {
          status.whoop = { connected: false, error: authErrorMessage(body, 'לא ניתן לבדוק את מצב Whoop') };
          return status.whoop;
        }
        status.whoop = body;
        return body;
      });
    }).catch(function (err) {
      status.whoop = { connected: false, error: String(err.message || err) };
      return status.whoop;
    });
  }

  function whoopRefresh() {
    if (!whoopReady()) return Promise.reject(new Error('חיבור Whoop לא מוכן עדיין'));
    if (!authUser) return Promise.reject(new Error('קודם צריך להתחבר לחשבון'));
    return fetch(fnUrl() + '/refresh', { method: 'POST', headers: headers() }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(authErrorMessage(body, 'משיכת נתוני Whoop נכשלה'));
        return body;
      });
    });
  }

  var lastWhoopSyncSeen = null;
  function onForeground() {
    if (!isConfigured() || !authUser || !whoopReady()) return Promise.resolve(null);
    return whoopStatus().then(function (s) {
      const stamp = s && s.link && (s.link.last_sync_at || s.last_sync_at);
      if (s && s.connected && stamp && stamp !== lastWhoopSyncSeen) {
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
    status: function () { return Object.assign({}, status, { configured: isConfigured(), signedIn: !!authUser, whoopReady: whoopReady() }); },
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
    whoopRefresh: whoopRefresh,
    onForeground: onForeground,
    init: init
  };

  root.FitSync = FitSync;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitSync;
})(typeof window !== 'undefined' ? window : globalThis);
