/* פיט — personal 3D avatar: home card, build sheet and full 3D view.
   three.js (vendored, tree-shaken) + js/avatar3d.js load only when the 3D view opens. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const M = root.FitAvatarModel;
  const SNAP_KEY = 'fit-avatar-snap-v1';
  const THEN_DAYS = 30;
  const view = { el: null, engine: null, mode: 'now', kind: null, draft: null, loading: null, token: 0 };

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
  function hexOf(list, id) { const x = list.find(function (i) { return i.id === id; }); return x ? x.hex : list[0].hex; }
  function lookOf(cfg) {
    return { skin: hexOf(M.SKIN_TONES, cfg.skin), hair: cfg.hair, hairColor: hexOf(M.HAIR_COLORS, cfg.hairColor), beard: cfg.beard };
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

  /* Cheap flat front silhouette for the home card when there is no fresh 3D snapshot. */
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

  function homeCard(s) {
    if (!M || !s) return '';
    const cfg = cfgOf(s);
    if (!cfg) {
      const p = M.bodyParams({ sex: 'm', values: {} });
      return '<section class="card av-card av-empty" data-avatar="build" role="button" tabindex="0" aria-label="בניית הדמות שלי">' +
        '<div class="av-thumb">' + silhouette(p, { skin: 'var(--text-dim)', hairColor: 'var(--text-dim)', hair: 'short' }) + '</div>' +
        '<div class="av-meta"><p class="kicker">חדש</p><h2>הדמות שלי בתלת־ממד</h2>' +
        '<p class="hp-legend">דמות שמשתנה לפי המשקל, ההיקפים, הכוח וההתאוששות שלך.</p>' +
        '<span class="btn tiny primary">בנו את הדמות</span></div></section>';
    }
    const d = dataFor(s, cfg, today());
    const look = lookOf(cfg);
    const snap = readSnap();
    const k = hashOf({ p: d.params, l: look });
    const thumb = snap && snap.k === k && snap.url
      ? '<img src="' + esc(snap.url) + '" alt="" />'
      : silhouette(d.params, look);
    const v = d.inp.values, src = d.inp.sources;
    const bits = [];
    if (src.weight !== 'default') bits.push(ltr(fmt(v.weight)) + ' ק״ג');
    if (src.waist !== 'default') bits.push('מותן ' + ltr(fmt(v.waist)));
    const rec = recoveryText(d.params.recovery);
    return '<section class="card av-card zone-' + (d.params.recovery.zone || 'none') + '" data-avatar="open" role="button" tabindex="0" aria-label="פתיחת הדמות בתלת־ממד">' +
      '<div class="av-thumb">' + thumb + '</div>' +
      '<div class="av-meta"><p class="kicker">הדמות שלי</p>' +
      '<h2>' + (bits.length ? bits.join(' · ') : 'לפי ערכי הבסיס') + '</h2>' +
      (rec ? '<p class="hp-legend">' + esc(rec) + '</p>' : '') +
      '<span class="av-open">לסיבוב בתלת־ממד ›</span></div></section>';
  }

  function settingsCard(s) {
    if (!M) return '';
    const has = !!cfgOf(s);
    return '<section class="card"><h2>הדמות שלי</h2>' +
      '<div class="setting"><div class="grow"><div>דמות תלת־ממד</div><div class="desc">מין, מראה, גובה והיקפים. הדמות מתעדכנת לפי המדידות שלך.</div></div>' +
      '<button type="button" class="btn tiny" data-avatar="build">' + (has ? 'עריכה' : 'בנייה') + '</button></div>' +
      (has ? '<div class="setting"><div class="grow"><div>תצוגה</div></div><button type="button" class="btn tiny" data-avatar="open">פתיחה</button></div>' : '') +
      '</section>';
  }

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
    if (view.engine) {
      try {
        if (view.kind === 'view' && view.snapKey && view.nowParams) {
          if (view.mode !== 'now') view.engine.update(view.nowParams.params, view.nowParams.look);
          writeSnap(view.snapKey, view.engine.snapshot(200));
        }
      } catch (e) { /* ignore */ }
      view.engine.dispose();
      view.engine = null;
    }
    if (view.el && view.el.parentNode) view.el.parentNode.removeChild(view.el);
    view.el = null; view.kind = null; view.snapKey = null; view.nowParams = null;
    document.documentElement.classList.remove('av-lock');
    if (!silent && root.FitUI && root.FitUI.render) root.FitUI.render();
  }

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

  function mountStage(stage, params, look) {
    const tok = view.token;
    if (!webglOk()) { stage.innerHTML = '<p class="av-stage-msg">המכשיר לא תומך בתלת־ממד. מוצגת דמות שטוחה.</p>' + silhouette(params, look); return Promise.resolve(null); }
    return loadEngine().then(function (mod) {
      if (tok !== view.token || !stage.isConnected) return null;
      stage.innerHTML = '';
      view.engine = mod.mount(stage, { params: params, look: look });
      return view.engine;
    }).catch(function () {
      if (tok !== view.token) return null;
      stage.innerHTML = '<p class="av-stage-msg">לא הצלחנו לטעון את התלת־ממד. מוצגת דמות שטוחה.</p>' + silhouette(params, look);
      return null;
    });
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
      '<div class="av-stage" id="av-stage"><p class="av-stage-msg">טוען תלת־ממד…</p></div>' +
      '<div class="av-seg" role="tablist"><button type="button" class="chip active" data-avatar="mode" data-mode="now">היום</button>' +
      '<button type="button" class="chip" data-avatar="mode" data-mode="then">לפני ' + THEN_DAYS + ' יום</button></div>' +
      '<div class="av-info" id="av-info"></div>');
    const d = dataFor(s, cfg, today());
    const look = lookOf(cfg);
    view.snapKey = hashOf({ p: d.params, l: look });
    view.nowParams = { params: d.params, look: look };
    renderInfo();
    mountStage(el.querySelector('#av-stage'), d.params, look);
  }

  function renderInfo() {
    if (!view.el) return;
    const s = st();
    const cfg = cfgOf(s);
    const nowD = dataFor(s, cfg, today());
    const thenDate = E().addDays(today(), -THEN_DAYS);
    const thenD = dataFor(s, cfg, thenDate);
    const cur = view.mode === 'then' ? thenD : nowD;
    const lines = M.explain(cur.inp);
    let html = '';
    if (view.mode === 'then') {
      const diffs = M.diff(thenD.inp, nowD.inp);
      html += '<div class="card av-diff"><h3>מאז ' + esc(E().formatDay ? E().formatDay(thenDate) : thenDate) + '</h3>' +
        (diffs.length
          ? '<div class="av-chips">' + diffs.map(function (x) {
            const good = x.key === 'weight' || x.key === 'waist' || x.key === 'hips' ? x.delta < 0 : x.delta > 0;
            return '<span class="av-chip ' + (good ? 'up' : 'down') + '">' + esc(x.label) + ' ' + ltr((x.delta > 0 ? '+' : '') + fmt(x.delta)) + ' ' + esc(x.unit) + '</span>';
          }).join('') + '</div>'
          : '<p class="hp-legend">אין מדידות מלפני ' + THEN_DAYS + ' יום להשוואה, אז שתי הדמויות נבנות מאותם ערכים.</p>') +
        '</div>';
    }
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
    const box = view.el.querySelector('#av-info');
    if (box) box.innerHTML = html;
    return cur;
  }

  function setMode(mode) {
    if (!view.el || view.kind !== 'view') return;
    view.mode = mode === 'then' ? 'then' : 'now';
    view.el.querySelectorAll('[data-avatar="mode"]').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === view.mode); });
    const cur = renderInfo();
    if (view.engine) view.engine.update(cur.params, lookOf(cfgOf(st())));
  }

  // ---------- build sheet ----------
  function openBuilder() {
    const s = st();
    view.draft = M.prefillConfig(s, s.settings && s.settings.avatar);
    view.prefilled = {};
    const raw = (s.settings && s.settings.avatar && s.settings.avatar.base) || {};
    ['weight'].concat(M.FIELDS).forEach(function (k) { if ((raw[k] === '' || raw[k] == null) && view.draft.base[k] !== '') view.prefilled[k] = true; });
    const el = openScreen('build',
      '<header class="av-top"><button type="button" class="av-x" data-avatar="close" aria-label="סגירה">×</button>' +
      '<h2>בניית הדמות</h2><button type="button" class="btn tiny primary" data-avatar="save">שמירה</button></header>' +
      '<div class="av-stage small" id="av-stage"><p class="av-stage-msg">טוען תלת־ממד…</p></div>' +
      '<form class="av-form" id="av-form" onsubmit="return false"></form>');
    renderForm();
    const p = previewParams();
    mountStage(el.querySelector('#av-stage'), p, lookOf(view.draft));
  }

  function previewParams() {
    const d = view.draft;
    const values = {};
    ['height', 'weight'].concat(M.FIELDS).forEach(function (k) { if (d.base[k] !== '') values[k] = d.base[k]; });
    // the preview shows today's strength/recovery too, so the look matches the real view
    const live = M.gatherInputs(st(), d, today());
    return M.bodyParams({ sex: d.sex, values: values, strength: live.strength, recoveryPct: live.recoveryPct });
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
  function renderForm() {
    const f = view.el && view.el.querySelector('#av-form');
    if (!f) return;
    const d = view.draft;
    const num = function (k, label, unit, hint) {
      const ph = M.SEX_DEFAULTS[d.sex][k];
      return '<label class="av-num"><span>' + esc(label) + '</span><input type="number" inputmode="decimal" step="0.5" data-avatar-num="' + k + '" value="' + esc(d.base[k]) + '" placeholder="' + ph + '" />' +
        '<i>' + unit + '</i>' + (view.prefilled[k] ? '<small>מולא מהמדידה האחרונה</small>' : hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
    };
    f.innerHTML =
      '<div class="card"><h3>מראה</h3>' +
      '<div class="av-row"><span>מין</span>' + chips('sex', [{ id: 'm', label: 'גבר' }, { id: 'f', label: 'אישה' }], d.sex) + '</div>' +
      '<div class="av-row"><span>גוון עור</span>' + swatches('skin', M.SKIN_TONES, d.skin) + '</div>' +
      '<div class="av-row"><span>שיער</span>' + chips('hair', M.HAIR_STYLES, d.hair) + '</div>' +
      '<div class="av-row"><span>צבע שיער</span>' + swatches('hairColor', M.HAIR_COLORS, d.hairColor) + '</div>' +
      (d.sex === 'm' ? '<div class="av-row"><span>זקן</span>' + chips('beard', M.BEARDS, d.beard) + '</div>' : '') +
      '</div>' +
      '<div class="card"><h3>מידות בסיס</h3><p class="hp-legend">מדידות חדשות שתוסיפו בהמשך יעדכנו את הדמות לבד. שדה ריק = ערך ממוצע.</p>' +
      '<div class="av-nums">' +
      num('height', 'גובה', 'ס״מ') + num('weight', 'משקל', 'ק״ג') + num('chest', 'חזה', 'ס״מ') + num('waist', 'מותן', 'ס״מ', 'בגובה הטבור') +
      num('hips', 'ירכיים', 'ס״מ') + num('arm', 'יד', 'ס״מ', 'זרוע, בנקודה הרחבה') + num('thigh', 'ירך', 'ס״מ') +
      '</div></div>';
  }

  let previewTimer = 0;
  function refreshPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      if (view.engine && view.kind === 'build') view.engine.update(previewParams(), lookOf(view.draft));
    }, 120);
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
      view.draft[t.dataset.field] = t.dataset.val;
      if (t.dataset.field === 'sex') {
        if (view.draft.sex === 'f') view.draft.beard = 'none';
        if (view.draft.sex === 'f' && view.draft.hair === 'short') view.draft.hair = 'long';
      }
      renderForm();
      refreshPreview();
    }
  });
  document.addEventListener('input', function (ev) {
    const t = ev.target;
    if (!t || !t.getAttribute || !view.draft) return;
    const k = t.getAttribute('data-avatar-num');
    if (!k) return;
    const n = Number(t.value);
    view.draft.base[k] = t.value === '' || !(n > 0) ? '' : Math.max(M.RANGES[k][0], Math.min(M.RANGES[k][1], n));
    refreshPreview();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && view.el) closeScreen();
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.classList && ev.target.classList.contains('av-card')) {
      ev.preventDefault();
      ev.target.click();
    }
  });

  root.FitAvatar = { homeCard: homeCard, settingsCard: settingsCard, open: openView, build: openBuilder, close: closeScreen, silhouette: silhouette };
})(typeof window !== 'undefined' ? window : globalThis);
