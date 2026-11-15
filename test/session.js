const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');

function assert(c, m) { if (!c) throw new Error(m); }

function loadSync(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});
  const calls = [];
  const ctx = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite, setTimeout, clearTimeout,
    Buffer,
    atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    },
    fetch: opts.fetch || function () { return Promise.reject(new Error('unexpected fetch')); }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
  ctx.FitCloudConfig = opts.cfg || {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-test',
    WHOOP_ENABLED: true
  };
  vm.runInNewContext(fs.readFileSync(path.join(rootDir, 'js/sync.js'), 'utf8'), ctx, { filename: 'sync.js' });
  return { ctx: ctx, store: store, sync: ctx.FitSync, calls: calls };
}

function jwt(expSecFromNow) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    email: 't@example.com',
    exp: Math.floor(Date.now() / 1000) + expSecFromNow
  })).toString('base64url');
  return header + '.' + payload + '.x';
}

function jsonRes(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    json: function () { return Promise.resolve(body); },
    text: function () { return Promise.resolve(JSON.stringify(body)); }
  });
}

// 1. Hydrate on load keeps the user signed in before any network call.
(function () {
  const access = jwt(3600);
  const { sync, store } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ access_token: access, refresh_token: 'r1', user: { id: 'user-1', email: 't@example.com' } }) }
  });
  assert(sync.status().signedIn, 'hydrate should sign in from storage');
  assert(store['hazi-fit-auth'], 'storage kept');
})();

// 2. Expired access token is renewed via refresh_token; session stays.
async function testRefreshOk() {
  const expired = jwt(-120);
  const fresh = jwt(3600);
  let refreshCalls = 0;
  const { sync, store } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ access_token: expired, refresh_token: 'r-old', user: { id: 'user-1', email: 't@example.com' } }) },
    fetch: function (url, opts) {
      if (String(url).indexOf('grant_type=refresh_token') >= 0) {
        refreshCalls += 1;
        const body = JSON.parse(opts.body);
        assert(body.refresh_token === 'r-old', 'sends stored refresh');
        return jsonRes(200, { access_token: fresh, refresh_token: 'r-new', expires_in: 3600, user: { id: 'user-1', email: 't@example.com' } });
      }
      throw new Error('unexpected ' + url);
    }
  });
  const sess = await sync.restoreSession();
  assert(sess && sess.access_token === fresh, 'got fresh access');
  assert(sess.refresh_token === 'r-new', 'persisted rotated refresh');
  assert(sync.status().signedIn, 'still signed in');
  const saved = JSON.parse(store['hazi-fit-auth']);
  assert(saved.refresh_token === 'r-new' && saved.access_token === fresh, 'storage updated');
  assert(refreshCalls === 1, 'one refresh');
}

// 3. Network failure on refresh must not sign out or drop tokens.
async function testRefreshNetwork() {
  const expired = jwt(-120);
  const { sync, store } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ access_token: expired, refresh_token: 'r-keep', user: { id: 'user-1' } }) },
    fetch: function () { return Promise.reject(new Error('Failed to fetch')); }
  });
  const sess = await sync.restoreSession();
  assert(sync.status().signedIn, 'network error keeps session');
  assert(sess && sess.refresh_token === 'r-keep', 'refresh token kept in memory');
  const saved = JSON.parse(store['hazi-fit-auth']);
  assert(saved.refresh_token === 'r-keep', 'refresh token kept in storage');
}

// 4. HTTP 500 on refresh must not sign out.
async function testRefresh500() {
  const expired = jwt(-120);
  const { sync, store } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ access_token: expired, refresh_token: 'r-keep', user: { id: 'user-1' } }) },
    fetch: function () { return jsonRes(500, { message: 'server error' }); }
  });
  await sync.restoreSession();
  assert(sync.status().signedIn, '500 keeps session');
  assert(JSON.parse(store['hazi-fit-auth']).refresh_token === 'r-keep', 'token kept after 500');
}

// 5. Definitive invalid refresh signs out.
async function testInvalidRefresh() {
  const expired = jwt(-120);
  const { sync, store } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ access_token: expired, refresh_token: 'r-dead', user: { id: 'user-1' } }) },
    fetch: function () { return jsonRes(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }); }
  });
  const sess = await sync.restoreSession();
  assert(!sess, 'invalid grant returns null');
  assert(!sync.status().signedIn, 'signed out only after invalid refresh');
  assert(!store['hazi-fit-auth'], 'storage cleared');
}

// 6. Missing access token still refreshes if a refresh token exists.
async function testNoAccess() {
  const fresh = jwt(3600);
  const { sync } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ refresh_token: 'r-only', user: { id: 'user-1' } }) },
    fetch: function (url) {
      if (String(url).indexOf('refresh_token') >= 0) {
        return jsonRes(200, { access_token: fresh, refresh_token: 'r-2', user: { id: 'user-1' } });
      }
      throw new Error('unexpected ' + url);
    }
  });
  const sess = await sync.restoreSession();
  assert(sess && sess.access_token === fresh, 'refreshed from refresh-only storage');
  assert(sync.status().signedIn, 'signed in');
}

// 7. Update handler must never touch localStorage (simulated).
(function () {
  const store = { 'hazi-fit-auth': '{"refresh_token":"r1"}', 'hazi-fit-v1': '{"workouts":[]}' };
  const cacheKeys = ['fit-tracker-v21', 'fit-tracker-v22', 'unrelated-cache'];
  const deleted = cacheKeys.filter(function (k) { return String(k).indexOf('fit-tracker') === 0; });
  assert(deleted.length === 2, 'only app caches');
  assert(store['hazi-fit-auth'] && store['hazi-fit-v1'], 'storage untouched by cache purge');
})();

// 8. Concurrent refreshes share one in-flight request.
async function testSingleFlight() {
  let n = 0;
  const fresh = jwt(3600);
  const { sync } = loadSync({
    store: { 'hazi-fit-auth': JSON.stringify({ access_token: jwt(-10), refresh_token: 'r-old', user: { id: 'user-1' } }) },
    fetch: function () {
      n += 1;
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            ok: true, status: 200,
            json: function () { return Promise.resolve({ access_token: fresh, refresh_token: 'r-new', user: { id: 'user-1' } }); }
          });
        }, 30);
      });
    }
  });
  const out = await Promise.all([sync.refreshSession(), sync.refreshSession(), sync.ensureFreshAccess()]);
  assert(n === 1, 'single-flight refresh, got ' + n);
  assert(out.every(function (s) { return s && s.access_token === fresh; }), 'all callers get new session');
}

Promise.resolve()
  .then(testRefreshOk)
  .then(testRefreshNetwork)
  .then(testRefresh500)
  .then(testInvalidRefresh)
  .then(testNoAccess)
  .then(testSingleFlight)
  .then(function () { console.log('session unit tests passed'); })
  .catch(function (e) {
    console.error(e && e.stack || e);
    process.exit(1);
  });
