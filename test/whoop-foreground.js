// v47: opening the app must bring down what the server already pulled (the
// morning cron) BEFORE the slower on-demand Whoop pull, and a failed pull must
// never skip the download.
const fs = require('fs');
const path = require('path');
function assert(c, m) { if (!c) throw new Error(m); }
const src = fs.readFileSync(path.join(__dirname, '..', 'js/sync.js'), 'utf8');
const a = src.indexOf('function onForeground(');
const body = src.slice(a, src.indexOf('function init()', a));
const firstSync = body.indexOf('syncNow()');
const refresh = body.indexOf('whoopRefresh()');
assert(firstSync > 0 && refresh > 0, 'onForeground uses syncNow and whoopRefresh');
assert(firstSync < refresh, 'syncNow runs before whoopRefresh');
assert(/serverHasNew/.test(body), 'syncs when the server stamp changed');
const server = fs.readFileSync(path.join(__dirname, '..', 'server/supabase/functions/whoop/index.ts'), 'utf8');
assert(!/await upsertMetric\(sb, userId, map/.test(server.slice(server.indexOf('async function pullRecent('), server.indexOf('Deno.serve('))), 'pullRecent batches metric writes');
assert(/flushMetrics\(sb, userId, queue\)/.test(server), 'pullRecent flushes batched metrics');
console.log('whoop-foreground ok');
