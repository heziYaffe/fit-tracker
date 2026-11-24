/* פיט — personal 3D avatar: home hero, build sheet and full 3D view.
   One WebGL renderer for the whole app: the same canvas moves between the home hero, the builder
   preview and the full view. three.js (vendored, tree-shaken) + js/avatar3d.js load lazily. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const M = root.FitAvatarModel;
  const SNAP_KEY = 'fit-avatar-snap-v2';
  const THEN_DAYS = 30;
  const COMPARE = { then: { days: 30, label: 'לפני חודש' }, then90: { days: 90, label: 'לפני 3 חודשים' } };
  const view = { el: null, engine: null, mode: 'now', kind: null, draft: null, loading: null, token: 0, heroKey: '', failed: false };
  const reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function E() { return root.FitEngine; }
  function S() { return root.FitStore; }
  function st() { return S().getState(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() { return E().todayISO(); }
  function cfgOf(s) { return M.normalizeConfig(s && s.settings && s.settings.avatar); }
  function hexOf(list, id) { const x = (list || []).find(function (i) { return i.id === id; }); return x ? x.hex : (list && list[0] ? list[0].hex : '#cccccc'); }
  function kindOf(id) { return M.KINDS.find(function (k) { return k.id === id; }) || M.KINDS[0]; }
  function lookOf(cfg) {
    return {
      kind: cfg.kind || 'human',
      color: hexOf(M.CREATURE_COLORS[cfg.kind], cfg.color),
      skin: hexOf(M.SKIN_TONES, cfg.skin), hair: cfg.hair, hairColor: hexOf(M.HAIR_COLORS, cfg.hairColor), beard: cfg.beard
    };
  }
  function fmt(n) { return String(Math.round(n * 10) / 10); }
  function ltr(t) { return '<bdi dir="ltr">' + esc(t) + '</bdi>'; }

  function dataFor(s, cfg, date) {
    const inp = M.gatherInputs(s, cfg, date);
    return { inp: inp, params: M.bodyParams(inp) };
  }
  function hashOf(o) {
    const str = JSON.stringify(o);
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }
  function readSnap() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { return null; } }
  function writeSnap(k, url) { try { if (url) localStorage.setItem(SNAP_KEY, JSON.stringify({ k: k, url: url })); } catch (e) { /* quota */ } }

  /* Cheap flat front silhouette, used before the 3D loads or when WebGL is unavailable. */
  function silhouette(p, look) {
    const H = p.height, T = p.torso, L = p.limbs;
    const k = 200 / (H * 1.08);
    const X = function (x) { return 60 + x * k; };
    const Y = function (y) { return 205 - y * k; };
    const pts = [
      [T.hipsW * 0.86, 0.47], [T.hipsW, 0.52], [T.waistW, 0.6], [T.chestW, 0.72], [T.shoulderW * 0.86, 0.805], [T.shoulderW * 0.5, 0.83], [0.07 * H / 1.75, 0.845]
    ];
    let d = 'M' + X(-pts[0][0]) + ' ' + Y(pts[0][1] * H);
    pts.forEach(function (q) { d += ' L' + X(-q[0]).toFixed(1) + ' ' + Y(q[1] * H).toFixed(1); });
    for (let i = pts.length - 1; i >= 0; i--) d += ' L' + X(pts[i][0]).toFixed(1) + ' ' + Y(pts[i][1] * H).toFixed(1);
    d += 'Z';
    function limb(x1, y1, x2, y2, r) {
      return '<line x1="' + X(x1).toFixed(1) + '" y1="' + Y(y1).toFixed(1) + '" x2="' + X(x2).toFixed(1) + '" y2="' + Y(y2).toFixed(1) +
        '" stroke="' + look.skin + '" stroke-width="' + (r * 2 * k).toFixed(1) + '" stroke-linecap="round"/>';
    }
    let out = '<svg class="av-sil" viewBox="0 0 120 210" aria-hidden="true">';
    [-1, 1].forEach(function (sd) {
      const hx = sd * T.hipsW * 0.48;
      out += limb(hx, 0.48 * H, hx * 0.95, 0.27 * H, L.thighR * 0.9);
      out += limb(hx * 0.95, 0.27 * H, hx * 0.92, 0.04 * H, L.calfR * 0.8);
      const sx = sd * T.shoulderW * 0.9;
      out += limb(sx, 0.8 * H, sx + sd * 0.07 * H, 0.63 * H, L.upperArmR);
      out += limb(sx + sd * 0.07 * H, 0.63 * H, sx + sd * 0.1 * H, 0.47 * H, L.forearmR);
    });
    out += '<path d="' + d + '" fill="' + look.skin + '"/>';
    out += '<ellipse cx="60" cy="' + Y(0.905 * H).toFixed(1) + '" rx="' + (0.058 * H * k).toFixed(1) + '" ry="' + (0.07 * H * k).toFixed(1) + '" fill="' + look.skin + '"/>';
    if (look.hair !== 'bald') out += '<ellipse cx="60" cy="' + Y(0.95 * H).toFixed(1) + '" rx="' + (0.06 * H * k).toFixed(1) + '" ry="' + (0.035 * H * k).toFixed(1) + '" fill="' + look.hairColor + '"/>';
    out += '<rect x="' + X(-T.hipsW * 1.03).toFixed(1) + '" y="' + Y(0.6 * H).toFixed(1) + '" width="' + (T.hipsW * 2.06 * k).toFixed(1) + '" height="' + (0.16 * H * k).toFixed(1) + '" rx="4" fill="var(--bg-soft)"/>';
    return out + '</svg>';
  }

  function recoveryText(r) {
    if (r.pct == null) return '';
    const word = r.zone === 'green' ? 'זקוף ורענן' : r.zone === 'yellow' ? 'קצת עייף' : 'עייף, כתפיים נופלות';
    return 'התאוששות ' + Math.round(r.pct) + '% · ' + word;
  }


  function fallbackArt(params, look) {
    if (look.kind && look.kind !== 'human') return '<span class="av-emoji" aria-hidden="true">' + kindOf(look.kind).emoji + '</span>';
    return silhouette(params, look);
  }
  function moodText(r) {
    if (r.pct == null) return '';
    return r.zone === 'green' ? 'מלא אנרגיה' : r.zone === 'yellow' ? 'בסדר, קצת עייף' : 'עייף היום';
  }
  function zzz(r) {
    return r && r.zzz ? '<span class="av-zzz' + (reducedMotion ? ' still' : '') + '" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>' : '';
  }

  /* ---------- home hero (top of home, wraps the greeting) ---------- */
  function homeHero(s, helloHtml) {
    if (!M || !s) return helloHtml || '';
    const cfg = cfgOf(s);
    if (!cfg) {
      const p = M.bodyParams({ sex: 'm', values: {} });
      return '<section class="av-hero av-hero-empty">' +
        '<button type="button" class="av-hero-stage" data-avatar="build" aria-label="בניית הדמות שלי">' +
        silhouette(p, { skin: 'var(--text-dim)', hairColor: 'var(--text-dim)', hair: 'short' }) + '</button>' +
        '<div class="av-hero-text">' + (helloHtml || '') +
        '<button type="button" class="btn tiny primary" data-avatar="build">בנו את הדמות שלכם</button></div></section>';
    }
    const d = dataFor(s, cfg, today());
    const look = lookOf(cfg);
    const k = hashOf({ p: d.params, l: look });
    const snap = readSnap();
    const art = snap && snap.k === k && snap.url ? '<img src="' + esc(snap.url) + '" alt="" />' : fallbackArt(d.params, look);
    const r = d.params.recovery;
    const day = M.dayState(s, new Date());
    const chip = day.chip || moodText(r);
    const pct = r.pct != null && (!day.primary || day.primary === 'tired' || day.primary === 'happy' || day.primary === 'neutral') ? ' · ' + ltr(Math.round(r.pct) + '%') : '';
    return '<section class="av-hero zone-' + (r.zone || 'none') + '">' +
      '<button type="button" class="av-hero-stage tod-' + day.tod + '" id="av-hero-slot" data-avatar="open" data-k="' + k + '" aria-label="פתיחת הדמות בתלת־ממד">' +
      '<span class="av-fallback">' + art + '</span>' + zzz(r) + '</button>' +
      '<div class="av-hero-text">' + (helloHtml || '') +
      (chip ? '<button type="button" class="av-mood" data-avatar="open">' + esc(chip) + pct + '</button>' : '') +
      '</div></section>';
  }
  // kept for older callers: the avatar now lives in the hero, so the lower card is gone
  function homeCard() { return ''; }

  function settingsCard(s) {
    if (!M) return '';
    const has = !!cfgOf(s);
    return '<section class="card"><h2>הדמות שלי</h2>' +
      '<div class="setting"><div class="grow"><div>דמות תלת־ממד</div><div class="desc">בן אדם, דרקון, ארנב, דובי או רובוט. הדמות מתעדכנת לפי המדידות וההתאוששות שלך.</div></div>' +
      '<button type="button" class="btn tiny" data-avatar="build">' + (has ? 'עריכה' : 'בנייה') + '</button></div>' +
      (has ? '<div class="setting"><div class="grow"><div>תצוגה</div></div><button type="button" class="btn tiny" data-avatar="open">פתיחה</button></div>' : '') +
      '</section>';
  }

  /* ---------- engine (one renderer) ---------- */
  function loadEngine() {
    if (!view.loading) {
      const url = new URL('js/avatar3d.js', document.baseURI).href;
      view.loading = import(url).catch(function (e) { view.loading = null; throw e; });
    }
    return view.loading;
  }
  function webglOk() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  /* Put the single canvas into `slot`. Resolves to the engine, or null (fallback art stays). */
  function placeEngine(slot, params, look, mode, instant) {
    if (view.failed || !webglOk()) { view.failed = true; return Promise.resolve(null); }
    return loadEngine().then(function (mod) {
      if (!slot.isConnected) return null;
      if (!view.engine) view.engine = mod.mount(slot, { params: params, look: look, mode: mode });
      else {
        if (view.engine.host !== slot || view.engine.mode !== mode) view.engine.attach(slot, mode);
        view.engine.setPaused(false);
        view.engine.update(params, look, { instant: !!instant });
      }
      slot.classList.add('live');
      if (mode === 'hero' && view.engine.setCompare) view.engine.setCompare(null);
      if (view.engine.setDay) view.engine.setDay(M.dayState(st(), new Date()));
      return view.engine;
    }).catch(function () { view.failed = true; return null; });
  }

  /* After every home render: move the live canvas into the new hero slot (or pause it). */
  function syncHero() {
    if (view.el) return; // a full screen owns the canvas
    const slot = document.getElementById('av-hero-slot');
    if (!slot) { if (view.engine) view.engine.setPaused(true); return; }
    const s = st();
    const cfg = cfgOf(s);
    if (!cfg) return;
    const d = dataFor(s, cfg, today());
    const look = lookOf(cfg);
    const k = slot.getAttribute('data-k');
    const changed = k !== view.heroKey;
    view.heroKey = k;
    const go = function () {
      if (!slot.isConnected) return;
      placeEngine(slot, d.params, look, 'hero', !changed).then(function (eng) {
        if (!eng) return;
        setTimeout(playQueued, 700);
        const snap = readSnap();
        if (!snap || snap.k !== k) setTimeout(function () { if (view.engine && view.engine.host === slot) writeSnap(k, view.engine.snapshot(220)); }, 600);
      });
    };
    if (view.engine) go();
    else if (root.requestIdleCallback) root.requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 300);
  }
  /* ---------- reactions: detect user actions from store changes, queue, play on the visible avatar ---------- */
  const RQ_KEY = 'fit-avatar-reactions';
  let lastSnap = null, lastInput = 0, playing = false;
  function readQ() { try { return JSON.parse(sessionStorage.getItem(RQ_KEY) || '[]'); } catch (e) { return []; } }
  function writeQ(q) { try { sessionStorage.setItem(RQ_KEY, JSON.stringify(q)); } catch (e) { /* ignore */ } }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, function () { lastInput = Date.now(); }, { capture: true, passive: true });
  });
  function onStore() {
    const s = st();
    if (!cfgOf(s)) { lastSnap = M.actionSnapshot(s, today()); return; }
    const next = M.actionSnapshot(s, today());
    const types = M.detectReactions(lastSnap, next);
    lastSnap = next;
    // only react to things the user just did here (not to a background cloud sync)
    if (!types.length || Date.now() - lastInput > 20000) return;
    let q = readQ();
    types.forEach(function (t) { q = M.enqueueReaction(q, t, Date.now()); });
    writeQ(q);
    setTimeout(playQueued, 350);
  }
  function playQueued() {
    if (playing || !view.engine || !view.engine.react) return;
    const host = view.engine.host;
    const onHero = host && host.id === 'av-hero-slot' && host.isConnected;
    const onView = view.kind === 'view' && host && host.isConnected;
    if (!onHero && !onView) return;
    const nx = M.nextReaction(readQ(), Date.now());
    if (!nx.type) { writeQ([]); return; }
    const dur = view.engine.react(nx.type);
    if (!(dur > 0)) return;
    writeQ(nx.rest);
    playing = true;
    setTimeout(function () { playing = false; playQueued(); }, dur * 1000 + 450);
  }
  // a queued reaction plays when the hero scrolls back into view or the app comes back
  let scrollT = 0;
  root.addEventListener('scroll', function () {
    if (scrollT || !readQ().length) return;
    scrollT = setTimeout(function () { scrollT = 0; playQueued(); }, 250);
  }, { passive: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(playQueued, 600); });
  // keep time-of-day light and day state fresh
  setInterval(function () {
    if (!view.engine || !view.engine.setDay || document.hidden) return;
    if (view.kind === 'view' && view.mode !== 'now') return;
    view.engine.setDay(M.dayState(st(), new Date()));
  }, 5 * 60 * 1000);

  function watchHome() {
    if (root.FitStore && root.FitStore.subscribe && M.actionSnapshot) {
      lastSnap = M.actionSnapshot(st(), today());
      root.FitStore.subscribe(onStore);
    }
    const main = document.getElementById('main');
    if (!main || typeof MutationObserver === 'undefined') return;
    let queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      Promise.resolve().then(function () { queued = false; syncHero(); });
    }).observe(main, { childList: true });
    syncHero();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(watchHome, 0); });
  else setTimeout(watchHome, 0);

  // ---------- screen shell ----------
  function openScreen(kind, html) {
    closeScreen(true);
    const el = document.createElement('div');
    el.className = 'av-screen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.dir = 'rtl';
    el.innerHTML = html;
    document.body.appendChild(el);
    document.documentElement.classList.add('av-lock');
    view.el = el; view.kind = kind;
    return el;
  }
  function closeScreen(silent) {
    view.token++;
    if (view.engine && view.kind === 'view' && view.snapKey && view.nowParams) {
      try {
        if (view.engine.setCompare) view.engine.setCompare(null);
        if (view.mode !== 'now') view.engine.update(view.nowParams.params, view.nowParams.look, { instant: true });
        writeSnap(view.snapKey, view.engine.snapshot(220));
      } catch (e) { /* ignore */ }
    }
    if (view.engine) { if (view.engine.setCompare) view.engine.setCompare(null); view.engine.setPaused(true); }
    if (view.el && view.el.parentNode) view.el.parentNode.removeChild(view.el);
    const was = !!view.el;
    view.el = null; view.kind = null; view.snapKey = null; view.nowParams = null; view.heroKey = '';
    document.documentElement.classList.remove('av-lock');
    if (!silent && was) {
      if (root.FitUI && root.FitUI.render) root.FitUI.render();
      syncHero();
    }
  }
  function mountStage(stage, params, look) {
    const tok = view.token;
    stage.classList.add('tod-' + M.dayState(st(), new Date()).tod);
    stage.innerHTML = '<span class="av-fallback">' + fallbackArt(params, look) + '</span>' + zzz(params.recovery);
    return placeEngine(stage, params, look, 'full', true).then(function (eng) {
      if (tok !== view.token) return null;
      if (!eng) {
        const msg = document.createElement('p');
        msg.className = 'av-stage-msg';
        msg.textContent = 'התלת־ממד לא זמין במכשיר הזה. מוצגת דמות שטוחה.';
        stage.appendChild(msg);
      }
      return eng;
    });
  }
  function setZzz(stage, r) {
    if (!stage) return;
    const old = stage.querySelector('.av-zzz');
    if (old) old.remove();
    if (r && r.zzz) stage.insertAdjacentHTML('beforeend', zzz(r));
  }

  // ---------- full 3D view ----------
  function openView() {
    const s = st();
    const cfg = cfgOf(s);
    if (!cfg) { openBuilder(); return; }
    view.mode = 'now';
    const el = openScreen('view',
      '<header class="av-top"><button type="button" class="av-x" data-avatar="close" aria-label="סגירה">×</button>' +
      '<h2>הדמות שלי</h2><button type="button" class="btn tiny" data-avatar="build">עריכה</button></header>' +
      '<div class="av-stage" id="av-stage"></div>' +
      '<div class="av-seg" role="tablist"><button type="button" class="chip active" data-avatar="mode" data-mode="now">היום</button>' +
      Object.keys(COMPARE).map(function (k) { return '<button type="button" class="chip" data-avatar="mode" data-mode="' + k + '">' + COMPARE[k].label + '</button>'; }).join('') + '</div>' +
      '<div class="av-info" id="av-info"></div>');
    const d = dataFor(s, cfg, today());
    const look = lookOf(cfg);
    view.snapKey = hashOf({ p: d.params, l: look });
    view.nowParams = { params: d.params, look: look };
    renderInfo();
    mountStage(el.querySelector('#av-stage'), d.params, look);
  }

  /* 0..100 for the info card: an index, not a level */
  function idx(v) { return Math.round((Number(v) || 0) * 100); }
  /* the day had real numbers (not defaults) to build a body from */
  function hasRealData(inp) {
    return !!inp && (inp.sources.weight !== 'default' || M.FIELDS.some(function (k) { return inp.sources[k] !== 'default'; }) || !!inp.training);
  }
  function axisChips(thenP, nowP, thenInp) {
    const out = [];
    if (thenInp && !hasRealData(thenInp)) return out;
    const df = idx(nowP.axes.fat) - idx(thenP.axes.fat), dm = idx(nowP.axes.muscle) - idx(thenP.axes.muscle);
    if (Math.abs(df) >= 2) out.push('<span class="av-chip ' + (df < 0 ? 'up' : 'down') + '">' + (df < 0 ? 'פחות שומן' : 'יותר שומן') + ' ' + ltr((df > 0 ? '+' : '') + df) + '</span>');
    if (Math.abs(dm) >= 2) out.push('<span class="av-chip ' + (dm > 0 ? 'up' : 'down') + '">' + (dm > 0 ? 'יותר שריר' : 'פחות שריר') + ' ' + ltr((dm > 0 ? '+' : '') + dm) + '</span>');
    return out;
  }
  function compareData(s, cfg, mode) {
    const c = COMPARE[mode];
    if (!c) return null;
    const date = E().addDays(today(), -c.days);
    const d = dataFor(s, cfg, date);
    return { date: date, label: c.label, d: d };
  }
  /* is there anything from back then that differs from today? (otherwise one figure, and say so) */
  function hasHistory(thenD, nowD) {
    return M.diff(thenD.inp, nowD.inp).length > 0 || axisChips(thenD.params, nowD.params, thenD.inp).length > 0;
  }

  function renderInfo() {
    if (!view.el) return;
    const s = st();
    const cfg = cfgOf(s);
    const nowD = dataFor(s, cfg, today());
    const cmp = view.mode !== 'now' ? compareData(s, cfg, view.mode) : null;
    const cur = nowD;
    const lines = M.explain(cur.inp);
    let html = '';
    if (cmp) {
      const thenD = cmp.d;
      const diffs = M.diff(thenD.inp, nowD.inp);
      const ax = axisChips(thenD.params, nowD.params, thenD.inp);
      const has = diffs.length || ax.length;
      html += '<div class="card av-diff"><h3>מאז ' + esc(E().formatDay ? E().formatDay(cmp.date) : cmp.date) + '</h3>' +
        (has
          ? '<div class="av-chips">' + diffs.map(function (x) {
            const good = x.key === 'weight' || x.key === 'waist' || x.key === 'hips' ? x.delta < 0 : x.delta > 0;
            return '<span class="av-chip ' + (good ? 'up' : 'down') + '">' + esc(x.label) + ' ' + ltr((x.delta > 0 ? '+' : '') + fmt(x.delta)) + ' ' + esc(x.unit) + '</span>';
          }).join('') + ax.join('') + '</div>' +
            '<p class="hp-legend">מימין הדמות של ' + esc(cmp.label) + ', משמאל היום. ' + esc(M.buildLabel(thenD.params.axes)) + ' ← ' + esc(M.buildLabel(nowD.params.axes)) + '.</p>'
          : '<p class="hp-legend">אין נתונים מ' + esc(cmp.label) + ' (משקל, מדידות או אימוני כוח) שונים מהיום, אז אין מה להשוות עדיין.</p>') +
        '</div>';
    }
    const A = cur.params.axes, AF = cur.params.axesFrom;
    const mFrom = { strength: 'שיפור בכוח', training: 'קצב אימוני כוח', size: 'היקפי יד וחזה ביחס למותן' };
    html += '<div class="card"><h3>מבנה הגוף</h3><ul class="av-list">' +
      '<li><span>מדד שומן</span><b>' + ltr(String(idx(A.fat))) + '</b><em>' + (AF.fat === 'bmi+waist' ? 'משקל, גובה ומותן' : 'משקל וגובה (אין מדידת מותן)') + '</em></li>' +
      '<li><span>מדד שריר</span><b>' + ltr(String(idx(A.muscle))) + '</b><em>' + esc(AF.muscle === 'none' ? 'אין עדיין נתונים' : AF.muscle.split('+').map(function (k) { return mFrom[k] || k; }).join(' · ')) + '</em></li></ul>' +
      '<p class="hp-legend">' + esc(M.buildLabel(A)) + '. שומן מעגל את הבטן והלחיים; שריר מרחיב כתפיים, מעבה ידיים ומוסיף קווי בטן כשהשומן נמוך. שני המדדים נפרדים, אז "חטוב" ו"רך" נראים שונה. 0–100, לא שלבים.</p></div>';
    const rec = recoveryText(cur.params.recovery);
    html += '<div class="card"><h3>מה מעצב את הדמות</h3><ul class="av-list">' +
      lines.map(function (l) {
        return '<li><span>' + esc(l.label) + '</span><b>' + ltr(l.value) + '</b><em class="src-' + l.source + '">' + esc(l.sourceLabel) + '</em></li>';
      }).join('') + '</ul>' +
      '<p class="hp-legend">מדוד = מהמדידה האחרונה עד היום הזה · בסיס = מה שהוזן בבניית הדמות · ברירת מחדל = עוד אין ערך.</p></div>';
    const regs = Object.keys(M.REGIONS).filter(function (r) { return cur.inp.strength[r] > 0; });
    html += '<div class="card"><h3>כוח</h3>' + (regs.length
      ? '<ul class="av-list">' + regs.map(function (r) {
        return '<li><span>' + esc(M.REGION_LABELS[r]) + '</span><b>' + ltr('+' + Math.round(cur.inp.strength[r] * 100) + '% 1RM') + '</b><em>' + esc(cur.inp.strengthFrom[r] || '') + '</em></li>';
      }).join('') + '</ul><p class="hp-legend">שיפור ב-1RM המשוער מאז האימונים הראשונים מגדיל מעט את נפח השריר באזור.</p>'
      : '<p class="hp-legend">עוד אין מספיק אימוני כוח עם משקלים כדי לראות שיפור.</p>') + '</div>';
    html += '<div class="card"><h3>התאוששות</h3><p class="hp-legend">' +
      (rec ? esc(rec) + '. הדמות עומדת זקופה ביום ירוק, ומתכופפת מעט ביום אדום. גם צבע ההילה משתנה.' : 'אין היום נתון התאוששות, אז הדמות בתנוחה רגילה.') +
      '</p></div>';
    if (view.mode === 'now') {
      const dy = M.dayState(s, new Date());
      const bits = [];
      if (dy.sleepy) bits.push('ישנת מעט' + (dy.sleepy.hours != null ? ' (' + fmt(dy.sleepy.hours) + ' שע׳)' : dy.sleepy.perf != null ? ' (' + Math.round(dy.sleepy.perf) + '% שינה)' : '') + ': פיהוקים ושקיות מתחת לעיניים.');
      if (dy.sore) bits.push('מאמץ ' + fmt(dy.sore.strain) + ' אתמול: תנועה איטית, צליעה קלה ויד על הגב.');
      if (dy.thirsty) bits.push('שתית ' + Math.round(dy.thirsty.pct * 100) + '% מיעד המים: הראש קצת נבול.');
      if (dy.rest) bits.push('יום מנוחה לפי התוכנית: הדמות נחה על פוף.');
      html += '<div class="card"><h3>מצב היום</h3><p class="hp-legend">' +
        (bits.length ? bits.map(esc).join('<br>') : 'אין היום סימנים מיוחדים משינה, מאמץ או שתייה.') +
        '</p><p class="hp-legend">הדמות מגיבה גם למה שאתה עושה: מתמתחת ומזיעה אחרי אימון, לועסת אחרי ארוחה, שותה אחרי מים ומריעה כשמגיעים ליעד.</p></div>';
    }
    const box = view.el.querySelector('#av-info');
    if (box) box.innerHTML = html;
    return cur;
  }

  function setMode(mode) {
    if (!view.el || view.kind !== 'view') return;
    view.mode = COMPARE[mode] ? mode : 'now';
    view.el.querySelectorAll('[data-avatar="mode"]').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === view.mode); });
    const cur = renderInfo();
    const stage = view.el.querySelector('#av-stage');
    setZzz(stage, cur.params.recovery);
    const old = stage && stage.querySelector('.av-cmp');
    if (old) old.remove();
    const s = st(), cfg = cfgOf(s);
    const cmp = view.mode !== 'now' ? compareData(s, cfg, view.mode) : null;
    const show = cmp && hasHistory(cmp.d, cur);
    if (stage) stage.classList.toggle('compare', !!show);
    if (show && stage) stage.insertAdjacentHTML('beforeend', '<div class="av-cmp" aria-hidden="true"><span>' + esc(cmp.label) + '</span><span>היום</span></div>');
    if (view.engine) {
      view.engine.update(cur.params, lookOf(cfg), { instant: true });
      if (view.engine.setCompare) view.engine.setCompare(show ? cmp.d.params : null);
      const dn = M.dayState(s, new Date());
      // side by side both stand (no beanbag)
      view.engine.setDay(show ? Object.assign({}, dn, { rest: null }) : dn);
    }
  }

  // ---------- build sheet ----------
  const SLIDERS = {
    height: { min: 140, max: 210, step: 1, unit: 'ס״מ' },
    weight: { min: 40, max: 160, step: 0.5, unit: 'ק״ג' },
    chest: { min: 70, max: 140, step: 0.5, unit: 'ס״מ' },
    waist: { min: 55, max: 140, step: 0.5, unit: 'ס״מ' },
    hips: { min: 70, max: 140, step: 0.5, unit: 'ס״מ' },
    arm: { min: 20, max: 50, step: 0.5, unit: 'ס״מ' },
    thigh: { min: 35, max: 80, step: 0.5, unit: 'ס״מ' }
  };
  function openBuilder() {
    const s = st();
    view.draft = M.prefillConfig(s, s.settings && s.settings.avatar);
    view.prefilled = {};
    view.link = true;
    view.linkFrom = null;
    const raw = (s.settings && s.settings.avatar && s.settings.avatar.base) || {};
    ['weight'].concat(M.FIELDS).forEach(function (k) { if ((raw[k] === '' || raw[k] == null) && view.draft.base[k] !== '') view.prefilled[k] = true; });
    const el = openScreen('build',
      '<header class="av-top"><button type="button" class="av-x" data-avatar="close" aria-label="סגירה">×</button>' +
      '<h2>בניית הדמות</h2><button type="button" class="btn tiny primary" data-avatar="save">שמירה</button></header>' +
      '<div class="av-kinds" id="av-kinds"></div>' +
      '<div class="av-stage small" id="av-stage"></div>' +
      '<form class="av-form" id="av-form" onsubmit="return false"></form>');
    renderForm();
    mountStage(el.querySelector('#av-stage'), previewParams(), lookOf(view.draft));
  }

  /* The preview uses ONLY the builder values (never stored measurements), plus today's strength/recovery. */
  function previewParams() {
    const d = view.draft;
    const values = {};
    ['height', 'weight'].concat(M.FIELDS).forEach(function (k) { if (d.base[k] !== '') values[k] = d.base[k]; });
    const live = M.gatherInputs(st(), d, today());
    return M.bodyParams({ kind: d.kind, sex: d.sex, values: values, strength: live.strength, training: live.training, recoveryPct: live.recoveryPct });
  }

  function chips(name, list, cur) {
    return '<div class="av-chips">' + list.map(function (x) {
      return '<button type="button" class="chip' + (x.id === cur ? ' active' : '') + '" data-avatar="pick" data-field="' + name + '" data-val="' + x.id + '">' + esc(x.label) + '</button>';
    }).join('') + '</div>';
  }
  function swatches(name, list, cur) {
    return '<div class="av-swatches">' + list.map(function (x) {
      return '<button type="button" class="av-sw' + (x.id === cur ? ' active' : '') + '" style="background:' + x.hex + '" data-avatar="pick" data-field="' + name + '" data-val="' + x.id + '" aria-label="' + esc(x.label) + '"></button>';
    }).join('') + '</div>';
  }
  function sliderVal(k) {
    const d = view.draft;
    return d.base[k] !== '' ? Number(d.base[k]) : M.SEX_DEFAULTS[d.sex][k];
  }
  function sliderOut(k) {
    const d = view.draft;
    return d.base[k] === '' ? 'ממוצע' : fmt(d.base[k]) + ' ' + SLIDERS[k].unit;
  }
  function renderForm() {
    const f = view.el && view.el.querySelector('#av-form');
    const kinds = view.el && view.el.querySelector('#av-kinds');
    if (!f) return;
    const d = view.draft;
    const human = d.kind === 'human';
    if (kinds) {
      kinds.innerHTML = M.KINDS.map(function (k) {
        return '<button type="button" class="av-kind' + (k.id === d.kind ? ' active' : '') + '" data-avatar="pick" data-field="kind" data-val="' + k.id + '">' +
          '<span>' + k.emoji + '</span>' + esc(k.label) + '</button>';
      }).join('');
    }
    const slider = function (k, label, hint) {
      const c = SLIDERS[k];
      const note = view.prefilled[k] ? 'מולא מהמדידה האחרונה' : hint || '';
      return '<label class="av-slider"><span class="av-sl-top"><span>' + esc(label) + '</span><output data-avatar-out="' + k + '">' + esc(sliderOut(k)) + '</output></span>' +
        '<input type="range" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + sliderVal(k) + '" data-avatar-num="' + k + '" dir="ltr" />' +
        (note ? '<small>' + esc(note) + '</small>' : '') + '</label>';
    };
    f.innerHTML =
      '<div class="card"><h3>מראה</h3>' +
      '<div class="av-row"><span>מבנה גוף</span>' + chips('sex', [{ id: 'm', label: 'גבר' }, { id: 'f', label: 'אישה' }], d.sex) + '</div>' +
      (human
        ? '<div class="av-row"><span>גוון עור</span>' + swatches('skin', M.SKIN_TONES, d.skin) + '</div>' +
          '<div class="av-row"><span>שיער</span>' + chips('hair', M.HAIR_STYLES, d.hair) + '</div>' +
          '<div class="av-row"><span>צבע שיער</span>' + swatches('hairColor', M.HAIR_COLORS, d.hairColor) + '</div>' +
          (d.sex === 'm' ? '<div class="av-row"><span>זקן</span>' + chips('beard', M.BEARDS, d.beard) + '</div>' : '')
        : '<div class="av-row"><span>צבע</span>' + swatches('color', M.CREATURE_COLORS[d.kind], d.color) + '</div>') +
      '</div>' +
      '<div class="card"><h3>מידות</h3><p class="hp-legend">הזיזו והדמות משתנה מיד. מדידות חדשות שתוסיפו בהמשך יעדכנו אותה לבד.</p>' +
      slider('height', 'גובה') + slider('weight', 'משקל') +
      '<label class="av-link"><input type="checkbox" data-avatar-link' + (view.link ? ' checked' : '') + ' /> ההיקפים זזים יחד עם המשקל</label>' +
      slider('chest', 'חזה') + slider('waist', 'מותן', 'בגובה הטבור') + slider('hips', 'ירכיים') +
      slider('arm', 'יד', 'זרוע, בנקודה הרחבה') + slider('thigh', 'ירך') +
      '</div>';
  }
  function setSliderUI(k) {
    if (!view.el) return;
    const out = view.el.querySelector('[data-avatar-out="' + k + '"]');
    if (out) out.textContent = sliderOut(k);
    const inp = view.el.querySelector('[data-avatar-num="' + k + '"]');
    if (inp && document.activeElement !== inp) inp.value = sliderVal(k);
  }

  let previewRaf = 0;
  function refreshPreview(dur) {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(function () {
      previewRaf = 0;
      if (view.engine && view.kind === 'build') view.engine.update(previewParams(), lookOf(view.draft), { dur: dur || 220 });
      setZzz(view.el && view.el.querySelector('#av-stage'), previewParams().recovery);
    });
  }

  function saveBuilder() {
    const d = view.draft;
    const cfg = M.normalizeConfig(Object.assign({}, d, { baseDate: today() }));
    S().updateSettings({ avatar: cfg });
    try { localStorage.removeItem(SNAP_KEY); } catch (e) { /* ignore */ }
    if (root.FitUI && root.FitUI.toast) root.FitUI.toast('הדמות נשמרה');
    openView();
  }

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-avatar]') : null;
    if (!t) return;
    const a = t.getAttribute('data-avatar');
    if (a === 'open') { ev.preventDefault(); openView(); }
    else if (a === 'build') { ev.preventDefault(); openBuilder(); }
    else if (a === 'close') { ev.preventDefault(); closeScreen(); }
    else if (a === 'mode') { ev.preventDefault(); setMode(t.dataset.mode); }
    else if (a === 'save') { ev.preventDefault(); saveBuilder(); }
    else if (a === 'pick' && view.draft) {
      ev.preventDefault();
      const field = t.dataset.field;
      view.draft[field] = t.dataset.val;
      if (field === 'sex') {
        if (view.draft.sex === 'f') view.draft.beard = 'none';
        if (view.draft.sex === 'f' && view.draft.hair === 'short') view.draft.hair = 'long';
      }
      if (field === 'kind') {
        const pal = M.CREATURE_COLORS[view.draft.kind] || [];
        if (pal.length && !pal.some(function (c) { return c.id === view.draft.color; })) view.draft.color = pal[0].id;
      }
      const sc = view.el ? view.el.scrollTop : 0;
      renderForm();
      if (view.el) view.el.scrollTop = sc;
      refreshPreview(field === 'kind' ? 1 : 260);
    }
  });
  function onSlide(ev, done) {
    const t = ev.target;
    if (!t || !t.getAttribute || !view.draft) return;
    if (t.hasAttribute('data-avatar-link')) { view.link = !!t.checked; return; }
    const k = t.getAttribute('data-avatar-num');
    if (!k) return;
    const n = Number(t.value);
    if (!(n > 0)) return;
    const val = Math.max(M.RANGES[k][0], Math.min(M.RANGES[k][1], n));
    if (k === 'weight' && view.link) {
      if (!view.linkFrom) {
        const from = {};
        M.FIELDS.forEach(function (f) { from[f] = sliderVal(f); });
        view.linkFrom = { base: from, weight: sliderVal('weight') };
      }
      const scaled = M.scaleWithWeight(view.linkFrom.base, view.linkFrom.weight, val);
      M.FIELDS.forEach(function (f) { view.draft.base[f] = scaled[f]; view.prefilled[f] = false; setSliderUI(f); });
    }
    view.draft.base[k] = val;
    view.prefilled[k] = false;
    setSliderUI(k);
    if (done) view.linkFrom = null;
    refreshPreview();
  }
  document.addEventListener('input', function (ev) { onSlide(ev, false); });
  document.addEventListener('change', function (ev) { onSlide(ev, true); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && view.el) closeScreen();
  });

  root.FitAvatar = { homeHero: homeHero, homeCard: homeCard, settingsCard: settingsCard, open: openView, build: openBuilder, close: closeScreen, silhouette: silhouette, syncHero: syncHero, _engine: function () { return view.engine; } };
})(typeof window !== 'undefined' ? window : globalThis);
