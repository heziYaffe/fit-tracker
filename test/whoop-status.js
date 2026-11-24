const vm = require('vm');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
function assert(c, m) { if (!c) throw new Error(m); }

const ctx = {
  console, Date, Math, Number, String, Array, Object, JSON, parseInt, isFinite,
  localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  fetch: function () { return Promise.reject(new Error('no fetch')); }
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.document = { addEventListener: function () {}, visibilityState: 'visible' };
ctx.FitCloudConfig = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', WHOOP_ENABLED: true };
vm.runInNewContext(fs.readFileSync(path.join(rootDir, 'js/sync.js'), 'utf8'), ctx, { filename: 'sync.js' });
const apply = ctx.FitSync.applyWhoopStatusResponse;
assert(typeof apply === 'function', 'applyWhoopStatusResponse exported');

const prev = { connected: true, link: { connected_at: '2026-11-15T00:00:00Z' }, has_refresh: true };
const from401 = apply(prev, 401, { error: 'auth_required' });
assert(from401.connected === true, 'a 401 from the app session does not mark Whoop as disconnected');
assert(from401.authRequired === true, '401 is flagged as account auth');
assert(from401.link && from401.link.connected_at, 'previous link is kept');

const from500 = apply(prev, 500, { error: 'server_error' });
assert(from500.connected === true, 'a server error does not mark Whoop as disconnected');
assert(from500.statusFailed === true, '500 is flagged as a status failure');

const ok = apply(prev, 200, { connected: true, needs_reconnect: false, has_refresh: true, link: { connected_at: '2026-11-24T00:00:00Z' } });
assert(ok.connected === true && ok.needs_reconnect === false, 'healthy status passes through');

const lost = apply(prev, 200, { connected: false, needs_reconnect: true, last_error: 'invalid_grant' });
assert(lost.needs_reconnect === true, 'definitive invalid_grant asks to reconnect');
assert(lost.connected === false, 'reconnect required is not treated as a healthy connection');

const emptyStart = apply(undefined, 200, { connected: false });
assert(emptyStart.connected === false, 'no previous link stays disconnected');

// Connect button only on a definitive server answer
const state = ctx.FitSync.whoopConnState;
assert(state(undefined) === 'unknown', 'not checked yet → unknown (no connect button)');
assert(state({ error: 'offline', statusFailed: true }) === 'unknown', 'network error → unknown');
assert(state(apply(undefined, 401, {})) === 'unknown', 'app-session 401 → unknown');
assert(state(apply(undefined, 500, {})) === 'unknown', '5xx → unknown');
assert(state(apply(prev, 500, {})) === 'connected', '5xx keeps the last connected state');
assert(state(apply(undefined, 200, {})) === 'unknown', 'a 200 without a status body is not definitive');
assert(state(ok) === 'connected', 'server connected');
assert(state(lost) === 'reconnect', 'server invalid_grant → reconnect');
assert(state(emptyStart) === 'disconnected', 'server says never connected');
// cached last answer is used on the first paint after reopening
const store2 = { 'hazi-fit-auth': JSON.stringify({ access_token: 'x', refresh_token: 'y', user: { id: 'u' } }),
  'fit-whoop-status': JSON.stringify({ connected: true, needs_reconnect: false, definitive: true, link: { last_sync_at: '2026-11-24T06:46:45Z' } }) };
const ctx2 = Object.assign({}, ctx, { localStorage: { getItem: k => store2[k] || null, setItem: (k, v) => { store2[k] = v; }, removeItem: k => { delete store2[k]; } } });
ctx2.window = ctx2; ctx2.globalThis = ctx2;
vm.runInNewContext(fs.readFileSync(path.join(rootDir, 'js/sync.js'), 'utf8'), ctx2, { filename: 'sync.js' });
assert(ctx2.FitSync.status().whoopState === 'connected', 'cached server status shows connected immediately');
assert(ctx2.FitSync.status().maybeSignedIn === true, 'stored session counts as signed in for display');

console.log('whoop-status tests passed');
