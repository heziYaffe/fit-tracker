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
    return isConfigured() && !!(cfg().WHOOP_CLIENT_ID && (cfg().WHOOP_FN_URL || cfg().SUPABASE_URL));
  }

  function fnUrl() {
    const c = cfg();
    if (c.WHOOP_FN_URL) return c.WHOOP_FN_URL.replace(/\/+$/, '');
    if (c.SUPABASE_URL) return c.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/whoop';
    return '';
  }

  function headers(extra) {
    const c = cfg();
    const h = { apikey: c.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
    if (authUser && authUser.access_token) h.Authorization = 'Bearer ' + authUser.access_token;
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
        .catch(function () { setSession(null); return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function sendMagicLink(email, redirectTo) {
    if (!isConfigured()) return Promise.reject(new Error('not-configured'));
    const c = cfg();
    return fetch(c.SUPABASE_URL.replace(/\/+$/, '') + '/auth/v1/magiclink', {
      method: 'POST',
      headers: { apikey: c.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, options: { emailRedirectTo: redirectTo || (location.origin + location.pathname) } })
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (b) { throw new Error((b && b.msg) || 'magiclink failed'); });
      return { ok: true };
    });
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

  function whoopStatus() {
    if (!whoopReady() || !authUser) return Promise.resolve({ connected: false });
    return fetch(fnUrl() + '/status', { headers: headers() }).then(function (r) { return r.json(); });
  }

  function whoopRefresh() {
    if (!whoopReady() || !authUser) return Promise.reject(new Error('not-ready'));
    return fetch(fnUrl() + '/refresh', { method: 'POST', headers: headers() }).then(function (r) { return r.json(); });
  }

  function init() {
    status.configured = isConfigured();
    return handleAuthRedirect();
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
    signOut: signOut,
    restoreSession: restoreSession,
    syncNow: syncNow,
    whoopStartUrl: whoopStartUrl,
    whoopStatus: whoopStatus,
    whoopRefresh: whoopRefresh,
    init: init
  };

  root.FitSync = FitSync;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitSync;
})(typeof window !== 'undefined' ? window : globalThis);
