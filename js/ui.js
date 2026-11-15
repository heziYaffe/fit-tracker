/* פיט — UI layer. Reads from FitStore / FitEngine; does not own persistence. */
(function (root) {
  'use strict';

  const C = root.FitConfig;
  const E = root.FitEngine;
  const P = root.FitPlanParse || {};
  const Store = root.FitStore;
  const Charts = root.FitCharts;

  const ui = {
    tab: 'home',
    nutritionDate: null,
    modal: null,
    toastTimer: 0,
    exerciseName: null,
    view: null,
    summaryStart: null,
    photoList: null,
    photoUrls: {},
    measureKey: 'waist',
    compareMode: 'side',
    compareA: null,
    compareB: null,
    comparePos: 50,
    exerciseBack: 'progress',
    exerciseSort: 'recent',
    editingTemplate: null,
    editingMenu: null,
    celebQueue: [],
    seenXP: null,
    suppressCeleb: false,
    animHome: false,
    homeDate: null,
    swapMeal: null
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ltr(s) {
    return '<span dir="ltr">' + esc(s) + '</span>';
  }

  function state() { return Store.getState(); }

  function typeLabel(workout) {
    if (!workout) return '';
    if (workout.type === 'custom' && workout.customType) return workout.customType;
    const found = C.WORKOUT_TYPES.find(function (t) { return t.id === workout.type; });
    return found ? found.label : (workout.customType || workout.type || '');
  }

  function hpClass(score, hasData) {
    if (!hasData) return 'hp-empty';
    if (score >= 0.7) return 'hp-green';
    if (score >= 0.4) return 'hp-yellow';
    return 'hp-red';
  }

  function hpBar(score, size, hasData) {
    const pct = Math.max(0, Math.min(100, (score || 0) * 100));
    const cls = hpClass(score, hasData !== false);
    return '<div class="hp-track ' + size + ' ' + cls + '" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="hp-fill" style="width:' + pct + '%"></div>' +
      '<div class="hp-ticks"></div>' +
      '</div>';
  }

  function fmtExpected(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function installDismissed() {
    try { return localStorage.getItem(C.INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { el.hidden = true; }, 2400);
  }

  function openModal(type, props) {
    ui.modal = { type: type, props: props || {} };
    try { history.pushState({ modal: true, tab: ui.tab }, ''); } catch (e) { /* ignore */ }
    render();
  }

  function closeModal() {
    const typ = ui.modal && ui.modal.type;
    ui.modal = null;
    render();
    if (typ === 'levelup' || typ === 'unlock') showNextCeleb();
  }

  function bindSheetDrag(overlay) {
    const sheet = overlay && overlay.querySelector('.sheet');
    if (!sheet) return;
    let startY = 0;
    let dragging = false;
    function onStart(ev) {
      const tch = ev.touches ? ev.touches[0] : ev;
      startY = tch.clientY;
      dragging = true;
    }
    function onMove(ev) {
      if (!dragging) return;
      const tch = ev.touches ? ev.touches[0] : ev;
      const dy = tch.clientY - startY;
      if (dy > 0) sheet.style.transform = 'translateY(' + dy + 'px)';
    }
    function onEnd(ev) {
      if (!dragging) return;
      dragging = false;
      const tch = ev.changedTouches ? ev.changedTouches[0] : ev;
      const dy = tch.clientY - startY;
      sheet.style.transform = '';
      if (dy > 80) closeModal();
    }
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: true });
    sheet.addEventListener('touchend', onEnd);
  }

  function showChartTip(target, text) {
    document.querySelectorAll('.chart-tip').forEach(function (n) { n.remove(); });
    if (!text) return;
    const wrap = target.closest('.chart-wrap') || target.closest('section') || target.parentElement;
    if (!wrap) return;
    if (!wrap.style || getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.textContent = text;
    wrap.appendChild(tip);
    setTimeout(function () { tip.remove(); }, 2200);
  }


  /* ---------- screens ---------- */

  function demoBanner() {
    if (!Store.isDemoMode()) return '';
    return '<div class="banner demo-banner">' +
      '<p><strong>מצב דמו</strong> — הנתונים להדגמה בלבד. האמיתיים שלך לא הוחלפו.</p>' +
      '<button type="button" class="btn tiny" data-action="exit-demo">צא ממצב דמו</button>' +
      '</div>';
  }

  function emptyDemoCta() {
    if (Store.isDemoMode()) return '';
    const s = state();
    const has = (s.workouts && s.workouts.length) || (s.nutrition && s.nutrition.length) || (s.weights && s.weights.length);
    if (has) return '';
    return '<section class="card demo-cta"><p>רוצים לראות איך האפליקציה נראית עם היסטוריה, גרפים ושיאים? טענו נתוני דמו. אפשר לצאת בכל רגע — הנתונים האמיתיים יישארו כמו שהם.</p>' +
      '<button type="button" class="btn primary wide" data-action="enter-demo">טען נתוני דמו</button></section>';
  }

  function prTags(types) {
    const map = { weight: 'שיא משקל', e1rm: 'שיא 1RM', volume: 'שיא נפח', reps: 'שיא חזרות', time: 'שיא החזקה', hold: 'שיא החזקה' };
    return (types || []).map(function (tp) {
      return '<span class="pr-tag">' + (map[tp] || tp) + '</span>';
    }).join('');
  }

  function isMaxReps(ex) {
    return E.isMaxReps ? E.isMaxReps(ex) : !!(ex && ex.repsMode === 'max');
  }
  function isBwEx(ex, name) {
    return E.isBodyweightEx ? E.isBodyweightEx(ex, name) : !!(ex && ex.bodyweight);
  }
  function isStaticEx(ex, name) {
    return E.isStaticEx ? E.isStaticEx(ex, name) : !!(ex && ex.static);
  }
  function formatSecs(sec) {
    if (P.formatDurationHe) return P.formatDurationHe(sec);
    const n = Math.max(0, Math.round(Number(sec) || 0));
    if (n < 60) return n + ' שנ׳';
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function bwBadge(ex, name) {
    return isBwEx(ex, name) ? '<span class="bw-badge">משקל גוף</span>' : '';
  }
  function maxBadge(ex) {
    return isMaxReps(ex) ? '<span class="max-badge">MAX</span>' : '';
  }
  function staticBadge(ex, name) {
    return isStaticEx(ex, name) ? '<span class="static-badge">סטטי</span>' : '';
  }
  function repsTargetLabel(ex) {
    if (isStaticEx(ex)) {
      if (isMaxReps(ex)) return 'MAX · עד כשל';
      const a = Number(ex.secsMin || ex.targetSecs || 0);
      const b = Number(ex.secsMax || ex.targetSecs || a);
      if (!a && !b) return '—';
      if (!b || a === b) return formatSecs(a || b);
      return formatSecs(a) + '–' + formatSecs(b);
    }
    if (isMaxReps(ex)) return 'MAX · עד כשל';
    const a = ex.repsMin;
    const b = ex.repsMax;
    if (a == null && b == null) return '—';
    if (a === b) return String(a);
    return a + '–' + b;
  }
  function loadLabel(weight, bodyweight) {
    const w = Number(weight) || 0;
    if (bodyweight) return w > 0 ? ('משקל גוף +' + w + ' ק״ג') : 'משקל גוף';
    return w + ' ק״ג';
  }
  function setShort(s, ex) {
    const st = isStaticEx(ex, ex && ex.name) || (Number(s.secs) || 0) > 0;
    const bw = isBwEx(ex, ex && ex.name);
    const w = Number(s.weight) || 0;
    if (st) {
      const hold = formatSecs(s.secs || 0);
      if (bw) return w > 0 ? ('+' + w + ' · ' + hold) : hold;
      return w > 0 ? (w + ' ק״ג · ' + hold) : hold;
    }
    if (bw) return w > 0 ? ('+' + w + '×' + s.reps) : (s.reps + ' חזרות');
    return w + '×' + s.reps;
  }


  const THEME_KEY = (C && C.THEME_KEY) || 'hazi-fit-theme';
  const DAY_LABELS = (C && C.DAY_NAMES) || [];

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function haptic(ms) {
    if (reducedMotion()) return;
    try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { /* ignore */ }
  }

  function getThemePref() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
  }

  function resolvedTheme(pref) {
    pref = pref || getThemePref();
    if (pref === 'light' || pref === 'dark') return pref;
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; }
  }

  function applyTheme(pref) {
    pref = pref || getThemePref();
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* ignore */ }
    const resolved = resolvedTheme(pref);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-pref', pref);
    const color = resolved === 'light' ? '#f6f1fa' : '#0c0714';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', resolved);
  }

  function iconGear() {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z"/><path d="M19.2 13.1a7.6 7.6 0 0 0 .08-2.2l1.9-1.5-1.8-3.2-2.3.9a7.4 7.4 0 0 0-1.9-1.1L14.8 3h-5.6l-.4 3a7.4 7.4 0 0 0-1.9 1.1l-2.3-.9-1.8 3.2 1.9 1.5a7.6 7.6 0 0 0 .08 2.2l-1.9 1.5 1.8 3.2 2.3-.9a7.4 7.4 0 0 0 1.9 1.1l.4 3h5.6l.4-3a7.4 7.4 0 0 0 1.9-1.1l2.3.9 1.8-3.2-1.9-1.5Z"/></svg>';
  }

  function pageHead(titleHtml, actionsHtml, opts) {
    opts = opts || {};
    const gear = opts.noGear ? '' : '<button type="button" class="head-btn" data-action="tab" data-tab="settings" aria-label="הגדרות">' + iconGear() + '</button>';
    return '<header class="page-head">' + titleHtml + '<div class="actions">' + (actionsHtml || '') + gear + '</div></header>';
  }

  function emptyArt(kind) {
    const map = {
      workout: '<svg class="empty-art" viewBox="0 0 120 88" aria-hidden="true"><rect x="8" y="30" width="14" height="28" rx="4" fill="currentColor" opacity=".35"/><rect x="98" y="30" width="14" height="28" rx="4" fill="currentColor" opacity=".35"/><rect x="26" y="38" width="68" height="12" rx="6" fill="currentColor" opacity=".55"/></svg>',
      food: '<svg class="empty-art" viewBox="0 0 120 88" aria-hidden="true"><ellipse cx="60" cy="58" rx="34" ry="14" fill="currentColor" opacity=".2"/><path d="M30 58c0-20 13-36 30-36s30 16 30 36" fill="none" stroke="currentColor" stroke-width="4" opacity=".55"/></svg>',
      chart: '<svg class="empty-art" viewBox="0 0 120 88" aria-hidden="true"><path d="M20 68V28h12v40H20zm22 0V40h12v28H42zm22 0V20h12v48H64zm22 0V48h12v20H86z" fill="currentColor" opacity=".45"/></svg>'
    };
    return map[kind] || '';
  }

  function waterIcon(kind, cls) {
    const bottle = kind === 'bottle';
    if (bottle) {
      return '<svg class="water-ico ' + (cls || '') + '" viewBox="0 0 32 44" aria-hidden="true">' +
        '<rect class="water-cap" x="12" y="1.2" width="8" height="4.2" rx="1.2" />' +
        '<path class="water-body" d="M13.2 5.4h5.6v3.6c2.5 1.15 4 3.4 4 7.1v19.6A3.7 3.7 0 0 1 19.2 39.4h-6.4A3.7 3.7 0 0 1 9.2 35.7V16.1c0-3.7 1.5-5.95 4-7.1V5.4z"/>' +
        '<path class="water-fill" d="M12.6 18.5h6.8v16.4A2 2 0 0 1 17.5 37h-3a2 2 0 0 1-1.9-2.1V18.5z"/>' +
        '</svg>';
    }
    return '<svg class="water-ico ' + (cls || '') + '" viewBox="0 0 32 40" aria-hidden="true">' +
      '<path class="water-body" d="M7.2 5.2h17.6l-1.55 24.5A4.3 4.3 0 0 1 19 34.2h-6a4.3 4.3 0 0 1-4.25-4.5L7.2 5.2z"/>' +
      '<path class="water-rim" d="M6.2 5.2h19.6"/>' +
      '<path class="water-fill" d="M9.6 14.2h12.8l-1.05 14.4A2.4 2.4 0 0 1 19 31.1h-6a2.4 2.4 0 0 1-2.35-2.4L9.6 14.2z"/>' +
      '</svg>';
  }

  function vesselOf(s) {
    return E.waterVessel ? E.waterVessel(s || state()) : { kind: 'cup', ml: 250, label: 'כוס', labelPlural: 'כוסות', labelOne: 'כוס' };
  }

  function waterLabel(current, target, s) {
    const v = vesselOf(s);
    const prog = E.formatWaterProgress ? E.formatWaterProgress(current, target) : ((current || 0) + ' / ' + (target || 0) + ' מ״ל');
    const units = E.formatWaterUnits ? E.formatWaterUnits(current, v) : '';
    return { progress: prog, units: units, vessel: v };
  }

  function fmtMacros(t, compact) {
    if (!t) return '';
    const bits = [Math.round(t.protein) + ' ג׳ חלבון', Math.round(t.calories) + ' קק״ל'];
    if (t.hasCarbs) bits.push(Math.round(t.carbs) + ' פחמ׳');
    if (t.hasFat) bits.push(Math.round(t.fat) + ' שומן');
    return bits.join(compact ? ' · ' : ' · ');
  }

  function daysChips(selected, action) {
    return '<div class="chips">' + DAY_LABELS.map(function (d) {
      const on = (selected || []).map(Number).indexOf(d.id) >= 0;
      return '<button type="button" class="chip' + (on ? ' active' : '') + '" data-action="' + action + '" data-day="' + d.id + '">' + esc(d.short) + '</button>';
    }).join('') + '</div>';
  }

  function activityRing(pct, color, label, value) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct || 0));
    const off = c * (1 - p);
    return '<div class="ring-item"><svg viewBox="0 0 72 72" aria-hidden="true">' +
      '<circle class="ring-track" cx="36" cy="36" r="' + r + '"/>' +
      '<circle class="ring-fill" cx="36" cy="36" r="' + r + '" stroke="' + color + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"/>' +
      '</svg><div class="ring-val">' + value + '</div><div class="ring-label">' + esc(label) + '</div></div>';
  }

  function renderRecentPRs(s) {
    const index = E.exerciseIndex(s) || [];
    const prs = [];
    index.forEach(function (it) {
      const list = E.attachPRs(E.sessionsForExercise(s, it.name));
      const last = list.filter(function (x) { return x.isPR; }).pop();
      if (last) prs.push({ name: it.name, date: last.date, types: last.prTypes || last.types, weight: last.topWeight });
    });
    prs.sort(function (a, b) { return b.date.localeCompare(a.date); });
    const top = prs.slice(0, 4);
    if (!top.length) return '';
    return '<div class="section-title"><h2>שיאים אחרונים</h2></div><section class="card">' +
      top.map(function (p) {
        return '<div class="pr-row"><div><strong>' + esc(p.name) + '</strong><div class="kicker">' + esc(E.formatDay(p.date)) + '</div></div>' +
          '<div>' + ltr(String(p.weight)) + ' ק״ג ' + prTags(p.types) + '</div></div>';
      }).join('') + '</section>';
  }

  function floatXP(amount) {
    if (!amount || reducedMotion()) {
      if (amount) toast('+' + amount + ' XP');
      return;
    }
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = '+' + amount + ' XP';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1200);
  }

  function burstConfetti() {
    if (reducedMotion()) return;
    const canvas = document.getElementById('fx-layer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = window.innerWidth;
    const h = canvas.height = window.innerHeight;
    const colors = ['#d36bff', '#ff3dce', '#ffc46b', '#8ab4ff', '#f3eaff'];
    const parts = [];
    for (let i = 0; i < 80; i++) {
      parts.push({
        x: w * 0.5 + (Math.random() - 0.5) * 80,
        y: h * 0.32,
        vx: (Math.random() - 0.5) * 9,
        vy: Math.random() * -8 - 2,
        g: 0.18 + Math.random() * 0.08,
        s: 4 + Math.random() * 5,
        c: colors[i % colors.length],
        a: 1,
        r: Math.random() * 6
      });
    }
    let frame = 0;
    function tick() {
      frame += 1;
      ctx.clearRect(0, 0, w, h);
      parts.forEach(function (p) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.a *= 0.985;
        ctx.globalAlpha = Math.max(0, p.a);
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.s, p.s * 0.7);
      });
      ctx.globalAlpha = 1;
      if (frame < 90) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(tick);
  }

  function snapshotXP() {
    const s = state();
    const xp = E.computeXP(s);
    const badges = E.computeAchievements(s, xp);
    ui.seenXP = {
      total: xp.level.total,
      level: xp.level.level,
      badges: badges.filter(function (b) { return b.unlocked; }).map(function (b) { return b.id; })
    };
  }

  function queueCeleb(type, props) {
    ui.celebQueue = ui.celebQueue || [];
    ui.celebQueue.push({ type: type, props: props || {} });
    const cur = ui.modal && ui.modal.type;
    if (cur !== 'levelup' && cur !== 'unlock') showNextCeleb();
  }

  function showNextCeleb() {
    if (!ui.celebQueue || !ui.celebQueue.length) return;
    const next = ui.celebQueue.shift();
    burstConfetti();
    haptic(30);
    openModal(next.type, next.props);
  }

  function maybeCelebrate() {
    /* XP celebrations are hidden; progress is shown on the metric rings. */
    snapshotXP();
  }

  function badgeArt(b) {
    const label = esc((b && b.icon) || '★');
    return '<svg class="badge-art" viewBox="0 0 96 96" aria-hidden="true">' +
      '<defs><linearGradient id="bgold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0b8ff"/><stop offset="1" stop-color="#d36bff"/></linearGradient></defs>' +
      '<circle cx="48" cy="48" r="44" fill="url(#bgold)" opacity=".25"/>' +
      '<circle cx="48" cy="48" r="32" fill="none" stroke="#d36bff" stroke-width="3"/>' +
      '<text x="48" y="58" text-anchor="middle" font-size="28">' + label + '</text></svg>';
  }

  function exercisesByMuscle() {
    const groups = {};
    (C.MUSCLES || []).forEach(function (m) { groups[m.id] = { id: m.id, label: m.label, items: [] }; });
    const other = { id: 'other', label: 'אחר', items: [] };
    Object.keys(C.EXERCISE_MUSCLES || {}).forEach(function (name) {
      const prim = ((C.EXERCISE_MUSCLES[name] || {}).primary || [])[0];
      if (prim && groups[prim]) groups[prim].items.push(name);
      else other.items.push(name);
    });
    (E.exerciseNames(state()) || []).forEach(function (n) {
      const known = Object.keys(C.EXERCISE_MUSCLES || {}).some(function (k) { return E.normName(k) === E.normName(n); });
      if (!known) other.items.push(n);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.items.length; }).concat(other.items.length ? [other] : []);
  }


  function homeDay() {
    const today = E.todayISO();
    var day = ui.homeDate || today;
    if (day > today) day = today;
    const min = E.addDays(today, -60);
    if (day < min) day = min;
    if (day === today) ui.homeDate = null;
    else ui.homeDate = day;
    return { today: today, day: day, isToday: day === today };
  }

  function scoreRing(opts) {
    const compact = !!opts.compact;
    const size = compact ? 78 : 108;
    const r = compact ? 28 : 42;
    const sw = compact ? 6.5 : 7.5;
    const c = 2 * Math.PI * r;
    const empty = !!opts.empty;
    const p = empty ? 0 : Math.max(0, Math.min(1, Number(opts.pct) || 0));
    const off = c * (1 - p);
    const color = opts.color || 'var(--accent)';
    const mid = size / 2;
    const action = opts.action ? (' data-action="' + esc(opts.action) + '"') : '';
    const kind = opts.kind ? (' data-kind="' + esc(opts.kind) + '"') : '';
    const valHtml = empty ? '—' : (opts.value || '');
    return '<button type="button" class="score-ring"' + action + kind + ' aria-label="' + esc(opts.label || '') + (empty ? '' : (', ' + String(opts.value || '').replace(/<[^>]+>/g, ''))) + '">' +
      '<span class="score-dial">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle class="ring-track" cx="' + mid + '" cy="' + mid + '" r="' + r + '" stroke-width="' + sw + '"/>' +
      (empty ? '' : ('<circle class="ring-fill" cx="' + mid + '" cy="' + mid + '" r="' + r + '" stroke="' + color + '" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"/>')) +
      '</svg>' +
      '<span class="score-num' + (empty ? ' empty' : '') + '"' + (empty ? '' : (' style="color:' + color + '"')) + '>' + valHtml + '</span>' +
      '</span>' +
      '<span class="score-label">' + esc(opts.label || '') + (opts.chev === false ? '' : '<i class="chev" aria-hidden="true">›</i>') + '</span>' +
      '</button>';
  }

  function recoveryColor(zone) {
    if (zone === 'green') return 'var(--whoop-green)';
    if (zone === 'yellow') return 'var(--whoop-yellow)';
    if (zone === 'red') return 'var(--whoop-red)';
    return 'var(--text-dim)';
  }

  function whoopSportLabel(name) {
    const map = {
      walking: 'הליכה', running: 'ריצה', cycling: 'רכיבה', weightlifting: 'משקולות',
      dance: 'ריקוד', swimming: 'שחייה', yoga: 'יוגה', hiking: 'טיול', activity: 'פעילות'
    };
    const key = String(name || '').toLowerCase();
    return map[key] || name || 'Whoop';
  }

  function fmtPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return Math.round(v) + '%';
  }

  function fmtStrain(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return String(Math.round(v * 10) / 10);
  }

  function fmtHrv(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return String(Math.round(v * 10) / 10);
  }

  function renderLoadRecLine(rec, applyAction, extra) {
    if (!rec || !rec.label) return '';
    extra = extra || '';
    return '<div class="load-rec">' +
      '<button type="button" class="load-rec-main"' +
      (applyAction ? (' data-action="' + applyAction + '" ' + extra) : ' disabled') + '>' +
      'המלצה: ' + esc(rec.label) + '</button>' +
      '<button type="button" class="load-rec-info" data-action="load-rec-info" data-reason="' + esc(rec.reason || '') + '" aria-label="הסבר ההמלצה">i</button>' +
      '</div>';
  }

  function trendChangeHtml(s) {
    if (s.change == null && s.changeAbs == null) return '<span class="trend-delta muted">—</span>';
    const up = (s.changeAbs != null ? s.changeAbs > 0 : s.change > 0);
    const down = (s.changeAbs != null ? s.changeAbs < 0 : s.change < 0);
    const good = s.upIsGood == null ? null : ((up && s.upIsGood) || (down && s.upIsGood === false));
    const cls = good == null ? 'neutral' : (good ? 'good' : 'bad');
    const arrow = up ? '↑' : (down ? '↓' : '→');
    let bit = arrow + ' ';
    if (s.changeAbs != null && s.unit === '%') bit += (s.changeAbs > 0 ? '+' : '') + (Math.round(s.changeAbs * 10) / 10) + '%';
    else if (s.change != null) bit += (s.change > 0 ? '+' : '') + Math.round(s.change * 100) + '%';
    else bit += (s.changeAbs > 0 ? '+' : '') + String(Math.round(s.changeAbs * 10) / 10);
    return '<span class="trend-delta ' + cls + '">' + bit + '</span>';
  }

  function formatTrendValue(s) {
    if (s.current == null) return '—';
    const n = Number(s.current);
    if (s.unit === 'bpm' || s.unit === '%') return String(Math.round(n));
    if (s.unit === 'שע׳') return (E.formatHoursClock ? E.formatHoursClock(n) : (Math.round(n * 10) / 10));
    if (Math.abs(n) >= 100) return String(Math.round(n));
    return String(Math.round(n * 10) / 10);
  }

  function renderTrendCard(s) {
    if (!s || s.points < 3) {
      return '<section class="card trend-card sparse"><div class="trend-head"><h3>' + esc(s.title) + '</h3>' +
        '<p class="hp-legend">אין מספיק נתונים בטווח הזה</p></div></section>';
    }
    return '<section class="card trend-card">' +
      '<div class="trend-head"><div><h3>' + esc(s.title) + '</h3>' +
      '<p class="trend-now">' + esc(formatTrendValue(s)) + (s.unit && s.current != null ? (' <span class="unit">' + esc(s.unit) + '</span>') : '') +
      '</p></div>' + trendChangeHtml(s) + '</div>' +
      Charts.lineChart({
        labels: s.labels,
        values: s.values,
        color: s.upIsGood === false ? '#ff8a7a' : (s.id === 'weight' || s.id === 'calories' ? '#8ab4ff' : '#d36bff'),
        tighten: true,
        height: 140,
        aria: s.title
      }) +
      '<p class="hp-legend">ממוצע נע של 7 ימים' + (s.id === 'weeklyVolume' ? ' · סה״כ שבועי' : '') + '</p></section>';
  }

  function renderTrends(s) {
    if (!E.computeTrends) return '';
    const days = Number(ui.trendRange) || 90;
    const tr = E.computeTrends(s, days);
    const chips = [[30, '30 ימים'], [90, '90 ימים'], [365, 'שנה']].map(function (pair) {
      return '<button type="button" class="chip' + (days === pair[0] ? ' active' : '') + '" data-action="trend-range" data-days="' + pair[0] + '">' + pair[1] + '</button>';
    }).join('');
    const main = (tr.series || []).map(renderTrendCard).join('');
    const e1 = (tr.e1rm || []).map(renderTrendCard).join('');
    return '<section class="trends-block"><div class="section-title"><h2>מגמות</h2></div>' +
      '<div class="chips trend-range">' + chips + '</div>' +
      main + (e1 ? '<p class="section-kicker">1RM משוער</p>' + e1 : '') +
      '</section>';
  }

  function renderDatePill(info) {
    const label = info.isToday ? 'היום' : E.formatDay(info.day);
    return '<div class="date-pill" role="group" aria-label="בחירת יום">' +
      '<button type="button" data-action="home-prev-day" aria-label="יום קודם">‹</button>' +
      '<button type="button" class="date-pill-label' + (info.isToday ? ' is-today' : '') + '" data-action="home-today">' + esc(label) + '</button>' +
      '<button type="button" data-action="home-next-day" aria-label="יום הבא"' + (info.isToday ? ' disabled' : '') + '>›</button>' +
      '</div>';
  }

  function weekWorkoutStats(s, iso) {
    const list = E.workoutsInWeek ? E.workoutsInWeek(s, iso) : (E.workoutsOn(s, iso) || []);
    const target = Number(s.settings.weeklyWorkoutTarget) || 4;
    const done = list.length;
    return { list: list, done: done, target: target, pct: target ? done / target : 0 };
  }

  function renderHomeDashboard(s, info, cons) {
    const snap = E.metricSnapshot ? E.metricSnapshot(s, info.day) : {};
    const st = window.FitSync ? FitSync.status() : { signedIn: false, whoop: {} };
    const whoopSt = st.whoop || {};
    const signedIn = !!st.signedIn;
    const connected = !!(whoopSt.connected || (whoopSt.link && whoopSt.link.connected_at));
    const rec = snap.recoveryPct;
    const sleepP = snap.sleepPerformance;
    const strain = snap.strain;
    const zone = E.recoveryZone ? E.recoveryZone(rec) : null;
    const hasSleep = sleepP != null;
    const hasRec = rec != null;
    const hasStrain = strain != null;

    const pTarget = E.proteinTarget(s);
    const wTarget = E.waterTarget(s);
    const cTarget = Number(s.settings.dailyCalorieTarget) || 0;
    const nut = E.nutritionOn(s, info.day);
    const protein = nut ? Number(nut.protein) || 0 : 0;
    const calories = nut ? Number(nut.calories) || 0 : 0;
    const water = nut ? Number(nut.water) || 0 : 0;
    const nutPct = cTarget ? (calories / cTarget) : (pTarget ? protein / pTarget : 0);
    const nutVal = cTarget ? (Math.round(calories) + '') : (Math.round(protein) + '');
    const nutEmpty = cTarget ? !calories : !protein;
    const waterPct = wTarget ? water / wTarget : 0;
    const consPct = cons && cons.hasData ? cons.combined : 0;
    const week = weekWorkoutStats(s, info.day);

    const rings = '<div class="home-rings" aria-label="מדדי היום">' +
      scoreRing({
        compact: true, label: 'שינה', action: 'open-whoop-ring', kind: 'sleep',
        empty: !hasSleep, pct: hasSleep ? Number(sleepP) / 100 : 0,
        value: hasSleep ? esc(fmtPct(sleepP)) : '—',
        color: 'var(--whoop-sleep)'
      }) +
      scoreRing({
        compact: true, label: 'התאוששות', action: 'open-whoop-ring', kind: 'recovery',
        empty: !hasRec, pct: hasRec ? Number(rec) / 100 : 0,
        value: hasRec ? esc(fmtPct(rec)) : '—',
        color: recoveryColor(zone)
      }) +
      scoreRing({
        compact: true, label: 'מאמץ', action: 'open-whoop-ring', kind: 'strain',
        empty: !hasStrain, pct: hasStrain ? Number(strain) / 21 : 0,
        value: hasStrain ? esc(fmtStrain(strain)) : '—',
        color: 'var(--whoop-strain)'
      }) +
      scoreRing({
        compact: true, label: 'עקביות', action: 'open-fit-ring', kind: 'consistency',
        empty: !(cons && cons.hasData), pct: consPct,
        value: (cons && cons.hasData) ? esc(Math.round(cons.combined * 100) + '%') : '—',
        color: 'var(--accent)'
      }) +
      scoreRing({
        compact: true, label: cTarget ? 'תזונה' : 'חלבון', action: 'open-fit-ring', kind: 'nutrition',
        empty: nutEmpty, pct: nutPct,
        value: nutEmpty ? '—' : esc(nutVal),
        color: 'var(--protein)'
      }) +
      scoreRing({
        compact: true, label: 'מים', action: 'open-fit-ring', kind: 'water',
        empty: !water, pct: waterPct,
        value: water ? esc((E.formatLiters ? E.formatLiters(water) : String(water))) : '—',
        color: 'var(--water)'
      }) +
      scoreRing({
        compact: true, label: 'אימון', action: 'open-fit-ring', kind: 'workout',
        empty: !week.done, pct: week.pct,
        value: week.done ? esc(week.done + '/' + week.target) : '—',
        color: 'var(--accent-2)'
      }) +
      '</div>';

    var actions = '';
    if (!signedIn) {
      actions = '<div class="whoop-empty-actions"><button type="button" class="btn primary" data-action="tab" data-tab="settings">התחברות לחשבון</button></div>';
    } else if (!connected) {
      actions = '<div class="whoop-empty-actions"><button type="button" class="btn primary" data-action="whoop-connect">חבר Whoop</button></div>';
    } else if (!hasSleep && !hasRec && !hasStrain) {
      actions = '<div class="whoop-empty-actions"><button type="button" class="btn" data-action="whoop-refresh">משיכת נתונים</button></div>';
    }

    const insight = (E.homeInsight ? E.homeInsight(s, info.day) : { title: '', body: '', tone: 'empty' });
    const insightCard = '<section class="card insight-card tone-' + esc(insight.tone || 'empty') + '">' +
      '<h2>' + esc(insight.title) + '</h2>' +
      '<p>' + esc(insight.body) + '</p></section>';

    const hrv = snap.hrv;
    const rhr = snap.rhr;
    const sleepH = snap.sleepHours;
    const tile2 = (rhr != null)
      ? { kind: 'recovery', kicker: 'דופק מנוחה', val: String(Math.round(rhr)), unit: 'bpm', empty: false }
      : (sleepH != null
        ? { kind: 'sleep', kicker: 'משך שינה', val: E.formatHoursClock(sleepH), unit: 'שעות', empty: false }
        : { kind: 'sleep', kicker: 'משך שינה', val: '—', unit: '', empty: true });
    const tiles = '<div class="dash-tiles">' +
      '<button type="button" class="dash-tile" data-action="open-whoop-ring" data-kind="recovery">' +
      '<p class="kicker">HRV</p>' +
      '<div class="dash-tile-val' + (hrv == null ? ' empty' : '') + '">' + (hrv == null ? '—' : esc(fmtHrv(hrv))) + (hrv == null ? '' : ' <span>ms</span>') + '</div></button>' +
      '<button type="button" class="dash-tile" data-action="open-whoop-ring" data-kind="' + tile2.kind + '">' +
      '<p class="kicker">' + esc(tile2.kicker) + '</p>' +
      '<div class="dash-tile-val' + (tile2.empty ? ' empty' : '') + '">' + esc(tile2.val) + (tile2.unit && !tile2.empty ? (' <span>' + esc(tile2.unit) + '</span>') : '') + '</div></button>' +
      '</div>';

    return rings + actions + insightCard + tiles;
  }

  function metricRow(label, value) {
    if (value == null || value === '') return '';
    return '<div class="metric-row"><span class="label">' + esc(label) + '</span><span class="value">' + value + '</span></div>';
  }

  function renderWhoopDetailSheet() {
    const props = (ui.modal && ui.modal.props) || {};
    const s = state();
    const day = props.date || (homeDay().day);
    const snap = E.metricSnapshot ? E.metricSnapshot(s, day) : {};
    const kind = props.kind || 'recovery';
    const titles = { sleep: 'שינה', recovery: 'התאוששות', strain: 'מאמץ' };
    const title = titles[kind] || 'Whoop';
    var body = '';
    if (kind === 'sleep') {
      body += metricRow('ביצועי שינה', snap.sleepPerformance != null ? ltr(fmtPct(snap.sleepPerformance)) : '');
      body += metricRow('משך שינה', snap.sleepHours != null ? ltr(E.formatHoursClock(snap.sleepHours)) : '');
      body += metricRow('זמן במיטה', snap.sleepInBedHours != null ? ltr(E.formatHoursClock(snap.sleepInBedHours)) : '');
      body += metricRow('יעילות', snap.sleepEfficiency != null ? ltr(fmtPct(snap.sleepEfficiency)) : '');
      body += metricRow('עקביות שינה', snap.sleepConsistency != null ? ltr(fmtPct(snap.sleepConsistency)) : '');
      body += metricRow('שינה קלה', snap.sleepLightHours != null ? ltr(E.formatHoursClock(snap.sleepLightHours)) : '');
      body += metricRow('שינה עמוקה', snap.sleepDeepHours != null ? ltr(E.formatHoursClock(snap.sleepDeepHours)) : '');
      body += metricRow('REM', snap.sleepRemHours != null ? ltr(E.formatHoursClock(snap.sleepRemHours)) : '');
      body += metricRow('ערות', snap.sleepAwakeHours != null ? ltr(E.formatHoursClock(snap.sleepAwakeHours)) : '');
      body += metricRow('מחזורים', snap.sleepCycles != null ? ltr(String(Math.round(snap.sleepCycles))) : '');
      body += metricRow('הפרעות', snap.sleepDisturbances != null ? ltr(String(Math.round(snap.sleepDisturbances))) : '');
      body += metricRow('קצב נשימה', snap.respiratoryRate != null ? ltr((Math.round(snap.respiratoryRate * 10) / 10) + ' / דק׳') : '');
    } else if (kind === 'recovery') {
      const zone = E.recoveryZone ? E.recoveryZone(snap.recoveryPct) : null;
      const zoneLabel = zone === 'green' ? 'ירוק' : (zone === 'yellow' ? 'צהוב' : (zone === 'red' ? 'אדום' : ''));
      body += metricRow('התאוששות', snap.recoveryPct != null ? ltr(fmtPct(snap.recoveryPct) + (zoneLabel ? ' · ' + zoneLabel : '')) : '');
      body += metricRow('HRV', snap.hrv != null ? ltr(fmtHrv(snap.hrv) + ' ms') : '');
      body += metricRow('דופק מנוחה', snap.rhr != null ? ltr(Math.round(snap.rhr) + ' bpm') : '');
      body += metricRow('ספיגת חמצן', snap.spo2 != null ? ltr((Math.round(snap.spo2 * 10) / 10) + '%') : '');
      body += metricRow('טמפ׳ עור', snap.skinTempC != null ? ltr((Math.round(snap.skinTempC * 10) / 10) + '°C') : '');
    } else {
      body += metricRow('מאמץ', snap.strain != null ? ltr(fmtStrain(snap.strain) + ' / 21') : '');
      body += metricRow('אנרגיה', snap.kilojoule != null ? ltr(Math.round(snap.kilojoule) + ' קג׳ול') : '');
      body += metricRow('דופק ממוצע', snap.avgHr != null ? ltr(Math.round(snap.avgHr) + ' bpm') : '');
      body += metricRow('דופק שיא', snap.maxHr != null ? ltr(Math.round(snap.maxHr) + ' bpm') : '');
      const wos = (E.workoutsOn(s, day) || []).filter(function (w) { return w.source === 'whoop'; });
      if (wos.length) {
        body += wos.map(function (w) {
          const bits = [whoopSportLabel(w.customType || w.type)];
          if (w.duration) bits.push(w.duration + ' דק׳');
          if (w.notes) bits.push(w.notes.replace(/^Whoop\s*·\s*/, ''));
          return metricRow('אימון Whoop', esc(bits.join(' · ')));
        }).join('');
      }
    }
    if (!body) body = '<p class="hp-legend">אין פירוט זמין ליום הזה. מוצגים רק שדות שמסונכרנים בפועל.</p>';
    return '<div class="sheet" role="dialog" aria-label="' + esc(title) + '"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="btn ghost" data-action="close">סגירה</button></div>' +
      '<p class="kicker">' + esc(E.formatDayLong(day)) + '</p>' +
      '<div class="metric-rows">' + body + '</div></div>';
  }

  function renderFitDetailSheet() {
    const props = (ui.modal && ui.modal.props) || {};
    const s = state();
    const infoDay = props.date || homeDay().day;
    const cons = E.computeConsistency(s, E.parseISO(infoDay));
    const nut = E.nutritionOn(s, infoDay);
    const pTarget = E.proteinTarget(s);
    const wTarget = E.waterTarget(s);
    const cTarget = Number(s.settings.dailyCalorieTarget) || 0;
    const protein = nut ? Number(nut.protein) || 0 : 0;
    const calories = nut ? Number(nut.calories) || 0 : 0;
    const water = nut ? Number(nut.water) || 0 : 0;
    const workouts = E.workoutsOn(s, infoDay) || [];
    const kind = props.kind || 'consistency';
    const titles = { consistency: 'עקביות', nutrition: 'תזונה', water: 'מים', workout: 'אימון' };
    var body = '';
    var go = '';
    if (kind === 'consistency') {
      body += metricRow('מד עקביות', cons.hasData ? ltr(Math.round(cons.combined * 100) + '%') : '—');
      body += metricRow('אימונים ב־14 יום', ltr((cons.workoutsDone || 0) + ' / ' + (cons.expectedWorkouts || 0)));
      body += metricRow('ימים ביעד חלבון', ltr((cons.proteinHits || 0) + ' / ' + (cons.days || 0)));
      body += metricRow('רצף נוכחי', ltr(String(cons.streak || 0)));
      go = '<button type="button" class="btn wide" data-action="tab" data-tab="progress">להתקדמות</button>';
    } else if (kind === 'nutrition') {
      body += metricRow('חלבון', ltr(Math.round(protein) + ' / ' + pTarget + ' גרם'));
      if (cTarget) body += metricRow('קלוריות', ltr(Math.round(calories) + ' / ' + cTarget + ' קק״ל'));
      go = '<button type="button" class="btn primary wide" data-action="tab" data-tab="nutrition">לתזונה</button>';
    } else if (kind === 'water') {
      const wl = waterLabel(water, wTarget, s);
      body += metricRow('כמות', ltr(wl.progress));
      if (wl.units) body += metricRow('יחידות', esc(wl.units));
      go = '<button type="button" class="btn primary wide" data-action="tab" data-tab="nutrition">לתזונה</button>';
    } else {
      const week = weekWorkoutStats(s, infoDay);
      body += metricRow('השבוע', ltr(week.done + ' / ' + week.target + ' אימונים'));
      if (!workouts.length) body += '<p class="hp-legend">עדיין לא תועד אימון ביום הזה.</p>';
      body += workouts.map(function (w) {
        return metricRow(typeLabel(w), esc((w.duration ? (w.duration + ' דק׳') : (w.source === 'whoop' ? whoopSportLabel(w.customType) : 'תועד'))));
      }).join('');
      go = '<button type="button" class="btn primary wide" data-action="open-start">התחלת אימון</button>';
    }
    return '<div class="sheet" role="dialog" aria-label="' + esc(titles[kind] || 'מדד') + '"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><h2>' + esc(titles[kind] || 'מדד') + '</h2>' +
      '<button type="button" class="btn ghost" data-action="close">סגירה</button></div>' +
      '<p class="kicker">' + esc(E.formatDayLong(infoDay)) + '</p>' +
      '<div class="metric-rows">' + body + '</div>' + go + '</div>';
  }

  function renderHome() {
    const s = state();
    const info = homeDay();
    const day = info.day;
    const cons = E.computeConsistency(s, E.parseISO(day));
    const name = s.settings.displayName || 'Hazi';
    const pTarget = E.proteinTarget(s);
    const wTarget = E.waterTarget(s);
    const cTarget = Number(s.settings.dailyCalorieTarget) || 0;
    const nut = E.nutritionOn(s, day);
    const protein = nut ? Number(nut.protein) || 0 : 0;
    const calories = nut ? Number(nut.calories) || 0 : 0;
    const water = nut ? Number(nut.water) || 0 : 0;
    const workouts = E.workoutsOn(s, day);
    const lastW = Store.latestWeight();
    const weightToday = (s.weights || []).find(function (w) { return w.date === day; });

    let install = '';
    if (!isStandalone() && !installDismissed()) {
      install = '<div class="banner" id="install-banner">' +
        '<p>להוספה למסך הבית: באייפון לחצו על שיתוף ואז «הוסף למסך הבית». באנדרואיד — תפריט ואז «התקן אפליקציה».</p>' +
        '<button type="button" class="close" data-action="dismiss-install" aria-label="סגירה">×</button>' +
        '</div>';
    }

    const rows = [];
    if (!workouts.length) {
      rows.push('<div class="today-row"><div class="today-ico">🏋️</div><div>' +
        '<div class="label">אימון</div>' +
        '<div class="value muted">עדיין לא תועד אימון ביום הזה</div></div>' +
        '<button type="button" class="btn tiny primary" data-action="open-start">התחלה</button></div>');
    }
    if (protein < pTarget) {
      rows.push('<div class="today-row"><div class="today-ico">🥩</div><div>' +
        '<div class="label">חלבון</div>' +
        '<div class="value">' + ltr(protein + ' / ' + pTarget) + ' <span class="unit">גרם</span></div>' +
        '<div class="protein-mini"><i style="width:' + Math.min(100, pTarget ? protein / pTarget * 100 : 0) + '%"></i></div>' +
        '</div><div class="today-side">' +
        '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + day + '" data-delta="25">+25</button>' +
        '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + day + '" data-delta="50">+50</button>' +
        '</div></div>');
    }
    if (water < wTarget) {
      const wl = waterLabel(water, wTarget, s);
      rows.push('<div class="today-row"><div class="today-ico water-ico-wrap">' + waterIcon(vesselOf(s).kind) + '</div><div>' +
        '<div class="label">מים</div>' +
        '<div class="value">' + ltr(wl.progress) +
        ' <span class="unit">' + esc(wl.units) + '</span></div></div>' +
        '<div class="today-side"><button type="button" class="btn tiny" data-action="bump-water" data-date="' + day + '" data-delta="1">+1</button></div></div>');
    }
    if (cTarget && calories < cTarget) {
      rows.push('<div class="today-row"><div class="today-ico">🔥</div><div><div class="label">קלוריות</div>' +
        '<div class="value">' + ltr(calories + ' / ' + cTarget) + ' <span class="unit">קק״ל</span></div></div>' +
        '<button type="button" class="btn tiny" data-action="tab" data-tab="nutrition">תיעוד</button></div>');
    }
    const dayMenu = Store.getDayMenu(day) || (Store.autoApplyMenu ? Store.autoApplyMenu(day) : null);
    if (dayMenu && dayMenu.meals && dayMenu.meals.length) {
      const eaten = dayMenu.meals.filter(function (m) { return m.status === 'eaten'; }).length;
      if (eaten < dayMenu.meals.length) {
        rows.push('<div class="today-row"><div class="today-ico">🍽️</div><div>' +
          '<div class="label">תפריט · ' + esc(dayMenu.menuName || '') + '</div>' +
          '<div class="value">' + ltr(eaten + ' / ' + dayMenu.meals.length) + ' ארוחות</div></div>' +
          '<button type="button" class="btn tiny" data-action="tab" data-tab="nutrition">פתיחה</button></div>');
      }
    }
    if (!weightToday) {
      rows.push('<div class="today-row"><div class="today-ico">⚖️</div><div>' +
        '<div class="label">משקל</div>' +
        '<div class="value' + (lastW ? '' : ' muted') + '">' +
        (lastW ? 'אחרון: ' + ltr(String(lastW.weight)) + ' ק״ג (' + esc(E.formatDay(lastW.date)) + ')' : 'טרם תועד') +
        '</div></div>' +
        '<button type="button" class="btn tiny" data-action="open-weight">+ משקל</button></div>');
    }

    const todayCard = rows.length
      ? ('<section class="card today-card"><h2>היום שלי</h2>' + rows.join('') + '</section>')
      : (info.isToday
        ? '<section class="card today-card done"><h2>היום שלי</h2><p class="hp-legend">הכול מעודכן להיום.</p></section>'
        : '');

    return install + emptyDemoCta() +
      '<p class="section-kicker">שלום, ' + esc(name) + '</p>' +
      renderDatePill(info) +
      renderHomeDashboard(s, info, cons) +
      todayCard +
      renderWeeklyCard(s);
  }

  function renderTodayMetrics(m) {
    if (!m || !(m.hasAny || m.sleepHours != null || m.recoveryPct != null || m.strain != null || m.hrv != null || m.sleepPerformance != null)) {
      return '<div class="today-row"><div class="today-ico">❤️</div><div>' +
        '<div class="label">מדדים</div>' +
        '<div class="value muted">שינה, התאוששות, HRV — עדיין לא תועדו ביום הזה</div></div>' +
        '<button type="button" class="btn tiny" data-action="open-metrics">תיעוד</button></div>';
    }
    const bits = [];
    if (m.sleepPerformance != null) bits.push(Math.round(m.sleepPerformance) + '% שינה');
    else if (m.sleepHours != null) bits.push((E.formatHoursClock ? E.formatHoursClock(m.sleepHours) : m.sleepHours) + ' שע׳ שינה');
    if (m.recoveryPct != null) bits.push(Math.round(m.recoveryPct) + '% התאוששות');
    if (m.strain != null) bits.push('מאמץ ' + (Math.round(Number(m.strain) * 10) / 10));
    if (m.hrv != null) bits.push('HRV ' + (Math.round(Number(m.hrv) * 10) / 10));
    return '<div class="today-row"><div class="today-ico">❤️</div><div>' +
      '<div class="label">מדדים</div>' +
      '<div class="value">' + esc(bits.join(' · ') || 'תועד') + '</div></div>' +
      '<button type="button" class="btn tiny" data-action="open-metrics">עריכה</button></div>';
  }

  function renderBadge(b) {
    return '<button type="button" class="badge ' + (b.unlocked ? 'on' : '') + '" data-action="badge-info" data-id="' + b.id + '">' +
      '<span class="badge-ico" aria-hidden="true">' + b.icon + '</span>' +
      '<span class="badge-name">' + esc(b.title) + '</span></button>';
  }

  function renderWorkouts() {
    const s = state();
    const list = s.workouts.slice().sort(function (a, b) {
      return b.date.localeCompare(a.date) || (b.id < a.id ? -1 : 1);
    });
    let body;
    if (!list.length) {
      body = '<div class="empty card"><span class="emoji">🏋️</span><p>אין אימונים עדיין. תעדו את האימון הראשון שלכם.</p>' +
        '<button type="button" class="btn primary" data-action="open-workout">אימון חדש</button>' +
        emptyDemoCta() + '</div>';
    } else {
      let lastDate = '';
      const parts = [];
      list.forEach(function (w) {
        if (w.date !== lastDate) {
          parts.push('<div class="list-date">' + esc(E.formatDayLong(w.date)) + '</div>');
          lastDate = w.date;
        }
        const named = (w.exercises || []).filter(function (e) { return e.name; });
        const links = named.map(function (e) {
          const bits = [];
          if (e.sets || e.reps) bits.push((e.sets || '?') + '×' + (e.reps || '?'));
          if (e.weight) bits.push(e.weight + ' ק״ג');
          return '<button type="button" class="ex-link" data-action="open-exercise" data-name="' + esc(e.name) + '">' +
            esc(e.name) + (bits.length ? ' <span>' + esc(bits.join(' · ')) + '</span>' : '') + '</button>';
        }).join('');
        const meta = [];
        if (w.duration) meta.push(w.duration + ' דק׳');
        parts.push(
          '<div class="list-item workout-card">' +
          '<button type="button" class="workout-main" data-action="edit-workout" data-id="' + esc(w.id) + '">' +
          '<div class="meta">' + esc(meta.join(' · ') || 'אימון') + '</div>' +
          '<div class="title">' + esc(typeLabel(w)) + '</div>' +
          (w.notes ? '<div class="sub">' + esc(w.notes) + '</div>' : '') +
          '</button>' +
          (links ? '<div class="ex-links">' + links + '</div>' : '') +
          '</div>'
        );
      });
      body = '<div class="list">' + parts.join('') + '</div>';
    }
    return pageHead('<h1>אימונים</h1>',
      '<button type="button" class="btn primary" data-action="open-start">אימון חי</button>' +
      '<button type="button" class="btn" data-action="open-workout">תיעוד ידני</button>') +
      renderTemplateList() + body;
  }

  function renderNutrition() {
    const s = state();
    const date = ui.nutritionDate || E.todayISO();
    ui.nutritionDate = date;
    const nut = E.nutritionOn(s, date) || { protein: 0, calories: 0, water: 0, notes: '' };
    const pTarget = E.proteinTarget(s);
    const wTarget = E.waterTarget(s);
    const cTarget = Number(s.settings.dailyCalorieTarget) || 0;
    const isToday = date === E.todayISO();
    const title = isToday ? 'היום' : E.formatDayLong(date);

    const vessel = vesselOf(s);
    const currentMl = Number(nut.water) || 0;
    const filledUnits = Math.floor((currentMl + 0.001) / vessel.ml);
    const targetUnits = Math.max(1, Math.ceil((wTarget || vessel.ml) / vessel.ml));
    const maxUnits = Math.min(24, Math.max(targetUnits, filledUnits, 4));
    const cups = [];
    for (let i = 1; i <= maxUnits; i++) {
      const on = i <= filledUnits;
      const label = vessel.label + ' ' + i;
      cups.push('<button type="button" class="vessel-btn ' + vessel.kind + (on ? ' on' : '') + '" data-action="set-water" data-date="' + date + '" data-value="' + i + '" aria-label="' + label + '">' + waterIcon(vessel.kind) + '</button>');
    }
    const wLab = waterLabel(currentMl, wTarget, s);

    const recent = s.nutrition.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 7);
    let recentHtml = '';
    if (recent.length) {
      recentHtml = '<div class="section-title"><h2>ימים אחרונים</h2></div><div class="list">' +
        recent.map(function (n) {
          const ok = Number(n.protein) >= pTarget;
          return '<button type="button" class="list-item" data-action="goto-nutrition" data-date="' + n.date + '">' +
            '<div class="meta">' + esc(E.formatDay(n.date)) + (ok ? ' · יעד חלבון ✓' : '') + '</div>' +
            '<div class="title">' + (Number(n.protein) || 0) + ' גרם חלבון' +
            (n.calories ? ' · ' + n.calories + ' קק״ל' : '') +
            (n.water ? ' · ' + (E.formatWaterUnits ? E.formatWaterUnits(n.water, vesselOf(s)) : (n.water + ' מ״ל')) : '') + '</div></button>';
        }).join('') + '</div>';
    } else {
      recentHtml = '<div class="empty"><p>אין נתוני תזונה עדיין. הזינו חלבון, קלוריות או מים ליום הזה.</p></div>';
    }

    const metrics = E.bestMetricsByDate(s)[date];

    return pageHead('<h1>תזונה</h1>') +
      '<div class="day-nav">' +
      '<button type="button" class="btn" data-action="shift-day" data-delta="-1" aria-label="היום הקודם">→</button>' +
      '<h2>' + esc(title) + '</h2>' +
      '<button type="button" class="btn" data-action="shift-day" data-delta="1" aria-label="היום הבא" ' + (isToday ? 'disabled' : '') + '>←</button>' +
      '</div>' +
      renderTodayMeals(date) +
      renderFoodsLibrary(date) +
      '<section class="card">' +
      '<div class="metric"><div><span class="label kicker">חלבון</span><div><span class="big">' + ltr(String(Number(nut.protein) || 0)) + '</span><span class="unit"> / ' + ltr(String(pTarget)) + ' גרם</span></div></div></div>' +
      hpBar(pTarget ? Math.min(1, (Number(nut.protein) || 0) / pTarget) : 0, 'sm', true) +
      '<div class="adders">' +
      '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + date + '" data-delta="-10">−10</button>' +
      '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + date + '" data-delta="10">+10</button>' +
      '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + date + '" data-delta="25">+25</button>' +
      '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + date + '" data-delta="50">+50</button>' +
      '</div>' +
      '<label class="field"><span>עדכון ידני (גרם)</span>' +
      '<input type="number" min="0" step="1" inputmode="numeric" data-field="protein" data-date="' + date + '" data-action="nutrition-field" value="' + (Number(nut.protein) || 0) + '" />' +
      '</label></section>' +

      '<section class="card">' +
      '<div class="metric"><div><span class="label kicker">קלוריות</span><div><span class="big">' + ltr(String(Number(nut.calories) || 0)) + '</span>' +
      (cTarget ? '<span class="unit"> / ' + ltr(String(cTarget)) + '</span>' : '<span class="unit"> קק״ל</span>') +
      '</div></div></div>' +
      '<div class="adders">' +
      '<button type="button" class="btn tiny" data-action="bump-calories" data-date="' + date + '" data-delta="-100">−100</button>' +
      '<button type="button" class="btn tiny" data-action="bump-calories" data-date="' + date + '" data-delta="100">+100</button>' +
      '<button type="button" class="btn tiny" data-action="bump-calories" data-date="' + date + '" data-delta="250">+250</button>' +
      '</div>' +
      '<label class="field"><span>עדכון ידני</span>' +
      '<input type="number" min="0" step="1" inputmode="numeric" data-field="calories" data-date="' + date + '" data-action="nutrition-field" value="' + (Number(nut.calories) || 0) + '" />' +
      '</label></section>' +

      '<section class="card">' +
      '<div class="metric"><div class="today-ico water-ico-wrap">' + waterIcon(vessel.kind) + '</div><div><span class="label kicker">מים</span><div><span class="big">' + ltr(wLab.progress) + '</span></div>' +
      '<div class="unit">' + esc(wLab.units) + ' · ' + vessel.ml + ' מ״ל ל' + vessel.label + '</div></div></div>' +
      '<div class="cups">' + cups.join('') + '</div>' +
      '<div class="adders"><button type="button" class="btn tiny" data-action="bump-water" data-date="' + date + '" data-delta="-1">−1</button>' +
      '<button type="button" class="btn tiny" data-action="bump-water" data-date="' + date + '" data-delta="1">+1 ' + esc(vessel.label) + '</button></div>' +
      '<div class="partial-water"><label class="field"><span>הוספה חלקית (מ״ל)</span>' +
      '<div class="reps-editor">' +
      '<input type="number" min="1" step="50" inputmode="numeric" id="water-partial-ml" placeholder="למשל 100" />' +
      '<button type="button" class="btn tiny" data-action="add-water-ml" data-date="' + date + '">הוסף</button>' +
      '</div></label></div>' +
      '</section>' +

      '<section class="card"><label class="field"><span>הערות</span>' +
      '<textarea data-field="notes" data-date="' + date + '" data-action="nutrition-field" placeholder="מה אכלתם, איך הרגשתם…">' + esc(nut.notes || '') + '</textarea>' +
      '</label></section>' +

      '<section class="card"><div class="section-title" style="margin-top:0"><h2>מדדי גוף</h2>' +
      '<button type="button" class="linkish" data-action="open-metrics" data-date="' + date + '">עריכה</button></div>' +
      renderMetricsPills(metrics) +
      '<p class="hp-legend">מקור: Whoop אם מחובר, או הזנה ידנית.</p>' +
      '</section>' +
      recentHtml;
  }

  function renderMetricsPills(m) {
    if (!m) return '<p class="kicker">אין מדדים ליום הזה עדיין.</p>';
    const fields = C.METRIC_FIELDS;
    return '<div class="metrics-grid">' + fields.map(function (f) {
      const v = m[f.key];
      const shown = v == null || v === '' ? '—' : v;
      return '<div class="metric-pill"><div class="label">' + esc(f.label) + '</div>' +
        '<div class="value">' + esc(String(shown)) + (v != null && v !== '' && f.unit ? ' <span class="unit">' + esc(f.unit) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>' +
      '<span class="source-tag">' + esc((m.sources && m.sources.length) ? m.sources.map(function (src) {
        return (C.METRIC_SOURCES[src] || { label: src }).label;
      }).join(' · ') : 'הזנה ידנית') + '</span>';
  }

  function renderProgress() { /* head uses existing markup */
    const s = state();
    const today = E.todayISO();
    const hasAny = s.workouts.length || s.nutrition.length || s.weights.length || s.metrics.length;
    if (!hasAny) {
      return pageHead('<h1>התקדמות</h1>') +
        '<div class="empty card"><span class="emoji">📈</span><p>אין עדיין מספיק נתונים. התחילו לתעד אימונים, תזונה ומשקל כדי לראות כאן גרפים.</p>' +
        '<button type="button" class="btn primary" data-action="open-workout">אימון ראשון</button>' +
        emptyDemoCta() + '</div>';
    }

    // Workouts per week — last 8 weeks (Sun–Sat, Israel)
    const weeks = [];
    const thisWeek = E.weekStartSunday(today);
    for (let i = 7; i >= 0; i--) weeks.push(E.addDays(thisWeek, -i * 7));
    const weekCounts = weeks.map(function (ws) {
      const we = E.addDays(ws, 6);
      const count = s.workouts.filter(function (w) { return w.date >= ws && w.date <= we; }).length;
      const lab = E.parseISO(ws).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
      return { label: lab, value: count };
    });
    const weeklyTarget = Number(s.settings.weeklyWorkoutTarget) || 4;

    const days14 = E.lastNDates(14).slice().reverse();
    const proteinVals = days14.map(function (d) {
      const n = E.nutritionOn(s, d);
      return n ? Number(n.protein) || 0 : null;
    });
    const proteinLabels = days14.map(function (d) {
      return E.parseISO(d).toLocaleDateString('he-IL', { day: 'numeric' });
    });

    const weights = s.weights.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    const weightChart = weights.length
      ? Charts.lineChart({
        labels: weights.map(function (w) { return E.parseISO(w.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }); }),
        values: weights.map(function (w) { return w.weight; }),
        color: '#8ab4ff',
        tighten: true,
        aria: 'משקל גוף'
      })
      : '<div class="empty"><p>אין עדיין מדידות משקל. תעדו משקל מהמסך הראשי או מההגדרות.</p></div>';

    const pTarget = E.proteinTarget(s);

    function hmClass(iso) {
      const hasW = E.workoutsOn(s, iso).length > 0;
      const hasP = E.hitsProtein(s, iso);
      const n = E.nutritionOn(s, iso);
      if (hasW && hasP) return 'hm-both';
      if (hasW) return 'hm-work';
      if (hasP) return 'hm-protein';
      if (n && Number(n.protein) > 0) return 'hm-partial';
      return 'hm-empty';
    }

    const metricMap = E.bestMetricsByDate(s);
    const metricDates = Object.keys(metricMap).sort();
    let recoveryChart = '';
    if (metricDates.length) {
      const last = E.lastNDates(14).slice().reverse();
      recoveryChart = '<section class="card"><h2>התאוששות ושינה</h2>' +
        Charts.lineChart({
          labels: last.map(function (d) { return E.parseISO(d).toLocaleDateString('he-IL', { day: 'numeric' }); }),
          values: last.map(function (d) { return metricMap[d] ? metricMap[d].recoveryPct : null; }),
          target: C.XP_RULES.metrics.recoveryPct.min,
          color: '#d36bff',
          aria: 'התאוששות'
        }) +
        '<p class="hp-legend">קו מקווקו: יעד התאוששות (' + C.XP_RULES.metrics.recoveryPct.min + '%).</p>' +
        Charts.lineChart({
          labels: last.map(function (d) { return E.parseISO(d).toLocaleDateString('he-IL', { day: 'numeric' }); }),
          values: last.map(function (d) { return metricMap[d] ? metricMap[d].sleepHours : null; }),
          target: C.XP_RULES.metrics.sleepHours.min,
          color: '#8ab4ff',
          aria: 'שינה'
        }) +
        '</section>';
    }

    const xp = E.computeXP(s);
    const badges = E.computeAchievements(s, xp);

    return pageHead('<h1>התקדמות</h1>') +
      '<button type="button" class="card weekly-card" data-action="open-summary"><p class="kicker">סיכום שבועי</p><h2>שיאים, נפח והמלצות</h2><p class="linkish">פתחו את הסיכום לשיתוף</p></button>' +
      '<button type="button" class="card weekly-card" data-action="open-body"><p class="kicker">גוף</p><h2>תמונות ומדידות היקפים</h2><p class="linkish">לפני/אחרי, שכבת רפאים ומעקב היקפים</p></button>' +
      renderBodyMapCard(s, false) +
      renderTrends(s) +
      '<section class="card"><h2>אימונים לפי שבוע</h2>' +
      Charts.barChart({
        labels: weekCounts.map(function (w) { return w.label; }),
        values: weekCounts.map(function (w) { return w.value; }),
        target: weeklyTarget,
        color: '#8ab4ff',
        aria: 'אימונים לפי שבוע'
      }) +
      '<p class="hp-legend">הקו המקווקו הוא יעד האימונים השבועי (' + weeklyTarget + ').</p></section>' +
      '<section class="card"><h2>חלבון יומי</h2>' +
      Charts.lineChart({
        labels: proteinLabels,
        values: proteinVals,
        target: pTarget,
        color: '#ffb14a',
        aria: 'חלבון יומי'
      }) +
      '<p class="hp-legend">14 הימים האחרונים מול יעד של ' + pTarget + ' גרם.</p></section>' +
      '<section class="card"><h2>משקל גוף</h2>' + weightChart + '</section>' +
      '<section class="card"><h2>לוח פעילות</h2>' +
      Charts.heatmap({ weeks: 16, getClass: hmClass }) +
      '<div class="legend">' +
      '<span><i class="hm-work" style="background:#3b7ad9"></i>אימון</span>' +
      '<span><i class="hm-protein" style="background:#2a9a6a"></i>יעד חלבון</span>' +
      '<span><i class="hm-both" style="background:#3ee0a0"></i>שניהם</span>' +
      '<span><i class="hm-partial" style="background:#3a4a3a"></i>חלבון חלקי</span>' +
      '</div></section>' +
      renderExerciseLibrary(s);
  }


  function summaryStats(s, now) {
    if (!root.FitSummary) return null;
    now = now || new Date();
    let range;
    if (ui.summaryStart && E.parseISO) {
      const start = ui.summaryStart;
      const end = E.addDays(start, 6);
      const today = E.todayISO(now);
      range = { start: start, end: end > today ? today : end, kind: end > today ? 'partial' : 'complete' };
    }
    return root.FitSummary.compute(s, now, range);
  }

  function changeLabel(change) {
    if (change == null) return 'אין בסיס להשוואה';
    const rnd = Math.round(change);
    const sign = rnd > 0 ? '+' : '';
    return sign + rnd + '% מול השבוע הקודם';
  }

  function changeShort(change) {
    if (change == null) return '—';
    const rnd = Math.round(change);
    return (rnd > 0 ? '+' : '') + rnd + '%';
  }


  function revokePhotoUrls() {
    Object.keys(ui.photoUrls || {}).forEach(function (id) {
      try { URL.revokeObjectURL(ui.photoUrls[id]); } catch (e) {}
    });
    ui.photoUrls = {};
  }

  function photoSrc(row) {
    if (!row) return '';
    if (ui.photoUrls[row.id]) return ui.photoUrls[row.id];
    if (!row.blob) return '';
    const url = URL.createObjectURL(row.blob);
    ui.photoUrls[row.id] = url;
    return url;
  }

  function loadPhotos(force) {
    if (!window.FitPhotos) { ui.photoList = []; return Promise.resolve([]); }
    if (ui.photoList && !force) return Promise.resolve(ui.photoList);
    return FitPhotos.listPhotos().then(function (rows) {
      revokePhotoUrls();
      ui.photoList = rows || [];
      render();
      return ui.photoList;
    }).catch(function () { ui.photoList = []; return []; });
  }

  function saveMeasureForm() {
    const dateEl = document.getElementById('measure-date');
    const row = { date: dateEl ? dateEl.value : E.todayISO() };
    const fields = window.FitPhotos ? FitPhotos.measureFields() : [];
    fields.forEach(function (f) {
      const el = document.getElementById('measure-' + f.key);
      row[f.key] = el && el.value !== '' ? Number(el.value) : '';
    });
    const has = fields.some(function (f) { return row[f.key] !== ''; });
    if (!has) { toast('יש להזין לפחות היקף אחד'); return; }
    Store.upsertMeasure(row);
    toast('המדידה נשמרה');
    render();
  }

  function poseLabel(pose) {
    return pose === 'side' ? 'צד' : (pose === 'back' ? 'אחורי' : 'קדמי');
  }

  function renderBody() {
    const fields = window.FitPhotos ? FitPhotos.measureFields() : [];
    const measures = Store.listMeasures ? Store.listMeasures() : [];
    const key = ui.measureKey || 'waist';
    const field = fields.find(function (f) { return f.key === key; }) || fields[0] || { key: 'waist', label: 'מותן' };
    const labels = measures.slice().reverse().map(function (m) { return E.formatDay(m.date); });
    const values = measures.slice().reverse().map(function (m) { return m[field.key]; });
    const chart = labels.length
      ? Charts.lineChart({ labels: labels, values: values, color: 'var(--accent)', tighten: true })
      : '<p class="hp-legend">עדיין אין מדידות לגרף.</p>';
    const hist = measures.map(function (m) {
      const bits = fields.map(function (f) {
        return m[f.key] !== '' && m[f.key] != null ? (f.label + ' ' + m[f.key]) : '';
      }).filter(Boolean).join(' · ');
      return '<div class="measure-row"><div><div class="meta">' + esc(E.formatDay(m.date)) + '</div><div>' + esc(bits || '—') + '</div></div>' +
        '<button type="button" class="linkish" data-action="del-measure" data-id="' + esc(m.id) + '">מחיקה</button></div>';
    }).join('') || '<p class="hp-legend">טרם נשמרו היקפים.</p>';
    const form = fields.map(function (f) {
      return '<label class="field"><span>' + esc(f.label) + ' (ס״מ)</span>' +
        '<input type="number" min="20" max="200" step="0.5" inputmode="decimal" id="measure-' + f.key + '" /></label>';
    }).join('');
    const chips = fields.map(function (f) {
      return '<button type="button" class="chip' + (f.key === field.key ? ' active' : '') + '" data-action="measure-chart" data-key="' + f.key + '">' + esc(f.label) + '</button>';
    }).join('');
    const photos = ui.photoList || [];
    const thumbs = photos.map(function (ph) {
      const onA = ui.compareA === ph.id ? ' on' : '';
      const onB = ui.compareB === ph.id ? ' on' : '';
      return '<div class="photo-card">' +
        '<img alt="" src="' + photoSrc(ph) + '" />' +
        '<div class="meta">' + esc(E.formatDay(ph.date)) + ' · ' + poseLabel(ph.pose) + '</div>' +
        '<div class="photo-actions">' +
        '<button type="button" class="chip' + onA + '" data-action="compare-pick" data-slot="a" data-id="' + esc(ph.id) + '">לפני</button>' +
        '<button type="button" class="chip' + onB + '" data-action="compare-pick" data-slot="b" data-id="' + esc(ph.id) + '">אחרי</button>' +
        '<button type="button" class="linkish" data-action="del-photo" data-id="' + esc(ph.id) + '">מחיקה</button>' +
        '</div></div>';
    }).join('') || '<p class="hp-legend">אין עדיין תמונות. הוסיפו תמונה שבועית, רצוי באותה תאורה וזווית.</p>';
    const photoA = photos.find(function (p) { return p.id === ui.compareA; }) || photos[photos.length - 1] || null;
    const photoB = photos.find(function (p) { return p.id === ui.compareB; }) || photos[0] || null;
    if (photoA && !ui.compareA) ui.compareA = photoA.id;
    if (photoB && !ui.compareB && photoB !== photoA) ui.compareB = photoB.id;
    let compare = '<p class="hp-legend">בחרו שתי תמונות להשוואה.</p>';
    if (photoA && photoB && photoA.id !== photoB.id) {
      const srcA = photoSrc(photoA);
      const srcB = photoSrc(photoB);
      const modes = ['side', 'slider', 'ghost'].map(function (m) {
        const label = m === 'side' ? 'זה לצד זה' : (m === 'slider' ? 'סליידר' : 'שכבת רפאים');
        return '<button type="button" class="chip' + (ui.compareMode === m ? ' active' : '') + '" data-action="compare-mode" data-mode="' + m + '">' + label + '</button>';
      }).join('');
      let stage = '';
      if (ui.compareMode === 'slider') {
        const pos = Number(ui.comparePos) || 50;
        stage = '<div class="compare-slider" dir="ltr" id="compare-slider" style="--pos:' + pos + '%">' +
          '<img class="cmp-after" alt="אחרי" src="' + srcB + '" />' +
          '<img class="cmp-before" alt="לפני" src="' + srcA + '" />' +
          '<input type="range" min="0" max="100" value="' + pos + '" data-action="compare-slider" aria-label="סליידר השוואה" />' +
          '</div>';
      } else if (ui.compareMode === 'ghost') {
        stage = '<div class="ghost-wrap"><img class="ghost-base" alt="אחרי" src="' + srcB + '" /><img class="ghost-prev" alt="שכבת רפאים" src="' + srcA + '" /></div>' +
          '<p class="hp-legend">התמונה הקודמת מונחת בשקיפות מעל הנוכחית, כדי ליישר את הפוזה.</p>';
      } else {
        stage = '<div class="compare-side"><figure><img alt="לפני" src="' + srcA + '" /><figcaption>לפני · ' + esc(E.formatDay(photoA.date)) + '</figcaption></figure>' +
          '<figure><img alt="אחרי" src="' + srcB + '" /><figcaption>אחרי · ' + esc(E.formatDay(photoB.date)) + '</figcaption></figure></div>';
      }
      compare = '<div class="chips">' + modes + '</div>' + stage;
    }
    return pageHead('<div><p class="kicker">התקדמות</p><h1>תמונות ומדידות</h1></div>',
      '<button type="button" class="btn" data-action="tab" data-tab="progress">חזרה</button>', { noGear: true }) +
      '<section class="card"><h2>מדידות היקפים</h2>' +
      '<label class="field"><span>תאריך</span><input type="date" id="measure-date" value="' + esc(E.todayISO()) + '" /></label>' +
      '<div class="builder-grid">' + form + '</div>' +
      '<button type="button" class="btn primary wide" data-action="save-measure">שמירת מדידה</button></section>' +
      '<section class="card"><h2>גרף היקפים</h2><div class="chips">' + chips + '</div>' + chart + '</section>' +
      '<section class="card"><h2>היסטוריה</h2>' + hist + '</section>' +
      '<section class="card"><h2>תמונות התקדמות</h2>' +
      '<p class="hp-legend">התמונות נשמרות במכשיר (IndexedDB), אחרי כיווץ. מומלץ צילום שבועי באותה תאורה.</p>' +
      '<div class="photo-add">' +
      '<select id="photo-pose" aria-label="זווית"><option value="front">קדמי</option><option value="side">צד</option><option value="back">אחורי</option></select>' +
      '<input type="date" id="photo-date" value="' + esc(E.todayISO()) + '" />' +
      '<input type="file" id="photo-file" accept="image/*" capture="environment" hidden />' +
      '<button type="button" class="btn primary" data-action="add-photo">הוספת תמונה</button>' +
      '</div>' +
      '<div class="photo-grid">' + thumbs + '</div></section>' +
      '<section class="card"><h2>השוואה לפני ואחרי</h2>' + compare + '</section>';
  }

  function renderWeeklyCard(s) {
    if (!root.FitSummary || !root.FitSummary.isSunday(new Date())) return '';
    const stats = root.FitSummary.compute(s, new Date(), root.FitSummary.lastCompleteWeek(new Date()));
    const prN = (stats.prs || []).length;
    return '<button type="button" class="card weekly-card" data-action="open-summary" data-start="' + esc(stats.start) + '">' +
      '<p class="kicker">סיכום שבועי</p>' +
      '<h2>השבוע שעבר</h2>' +
      '<p class="hp-legend">' + esc(root.FitSummary.formatRange(stats)) + '</p>' +
      '<div class="weekly-mini">' +
      '<span>' + stats.workouts + ' אימונים</span>' +
      '<span>' + prN + ' שיאים</span>' +
      '<span>נפח ' + esc(changeShort(stats.volumeChange)) + '</span>' +
      '</div>' +
      '<p class="linkish">לצפייה ולשיתוף</p>' +
      '</button>';
  }

  function renderSummary() {
    const s = state();
    const stats = summaryStats(s);
    if (!stats) {
      return pageHead('<h1>סיכום שבועי</h1>', '<button type="button" class="btn" data-action="tab" data-tab="progress">חזרה</button>', { noGear: true }) +
        '<div class="empty card"><p>אין עדיין מספיק נתונים לסיכום.</p></div>';
    }
    const prevStart = E.addDays(stats.start, -7);
    const nextStart = E.addDays(stats.start, 7);
    const today = E.todayISO();
    const canNext = nextStart <= today;
    const prList = (stats.prs || []).slice(0, 8).map(function (p) {
      return '<li>' + esc(p.name) + ' · ' + esc(E.formatDay(p.date)) + '</li>';
    }).join('') || '<li class="muted">אין שיאים חדשים השבוע</li>';
    const stalled = (stats.stalled || []).slice(0, 5).map(function (p) {
      return '<li>' + esc(p.name) + ' · ' + p.days + ' ימים</li>';
    }).join('') || '<li class="muted">אין תרגילים שנתקעו</li>';
    const neglected = (stats.neglected || []).slice(0, 6).map(function (m) {
      return '<li>' + esc(m.label) + '</li>';
    }).join('') || '<li class="muted">כיסוי טוב לשרירים</li>';
    const nutr = stats.nutrition || { hits: 0, days: 0, rate: 0 };
    const tips = (stats.tips || []).map(function (tip) {
      return '<li class="tip-item">' + esc(tip.text) + '</li>';
    }).join('');
    const title = stats.kind === 'partial' ? 'השבוע עד כה' : 'סיכום שבועי';
    return pageHead('<div><p class="kicker">' + esc(root.FitSummary.formatRange(stats)) + '</p><h1>' + title + '</h1></div>',
      '<button type="button" class="btn" data-action="tab" data-tab="progress">חזרה</button>', { noGear: true }) +
      '<div class="date-nav">' +
      '<button type="button" class="icon-btn" data-action="summary-week" data-start="' + esc(prevStart) + '" aria-label="שבוע קודם">→</button>' +
      '<div>' + esc(root.FitSummary.formatRange(stats)) + '</div>' +
      '<button type="button" class="icon-btn"' + (canNext ? ' data-action="summary-week" data-start="' + esc(nextStart) + '"' : ' disabled') + ' aria-label="שבוע הבא">←</button>' +
      '</div>' +
      '<div class="summary-grid">' +
      '<div class="card stat-tile"><div class="kicker">אימונים</div><div class="big">' + stats.workouts + '</div></div>' +
      '<div class="card stat-tile"><div class="kicker">שיאים</div><div class="big">' + (stats.prs || []).length + '</div></div>' +
      '<div class="card stat-tile"><div class="kicker">נפח מול שבוע קודם</div><div class="big">' + esc(changeShort(stats.volumeChange)) + '</div></div>' +
      '<div class="card stat-tile"><div class="kicker">רצף</div><div class="big">' + ltr(String(stats.streak || 0)) + '</div></div>' +
      '</div>' +
      '<section class="card"><h2>תזונה ושינה</h2>' +
      '<p>חלבון: ' + nutr.hits + ' מתוך ' + nutr.days + ' ימים (' + Math.round((nutr.rate || 0) * 100) + '%)</p>' +
      '<p class="water-summary">' + waterIcon(vesselOf(state()).kind, 'inline') + ' מים: ' + (nutr.waterHits || 0) + ' מתוך ' + nutr.days + ' ימים ביעד</p>' +
      '<p>שינה ממוצעת: ' + (stats.sleepAvg != null ? stats.sleepAvg.toFixed(1) + ' שעות' : 'אין נתונים') + '</p>' +
      '<p>התאוששות ממוצעת: ' + (stats.recoveryAvg != null ? Math.round(stats.recoveryAvg) + '%' : 'אין נתונים') + '</p>' +
      '<p>רצף בסוף השבוע: ' + stats.streak + ' ימים</p>' +
      '</section>' +
      '<section class="card"><h2>שיאים שנשברו</h2><ul class="summary-list">' + prList + '</ul></section>' +
      '<section class="card"><h2>תרגילים שנתקעו</h2><ul class="summary-list">' + stalled + '</ul></section>' +
      '<section class="card"><h2>שרירים שהוזנחו</h2><ul class="summary-list">' + neglected + '</ul></section>' +
      '<section class="card"><h2>המלצות לשבוע הבא</h2><ul class="tips">' + tips + '</ul></section>' +
      '<button type="button" class="btn primary wide" data-action="share-summary">שיתוף הסיכום</button>' +
      '<div class="share-preview-wrap card"><p class="kicker">תצוגה לשיתוף</p><canvas id="summary-canvas" width="1080" height="1920"></canvas></div>';
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || '').split(' ');
    let line = '';
    const lines = [];
    words.forEach(function (word) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    });
    if (line) lines.push(line);
    lines.forEach(function (ln, i) { ctx.fillText(ln, x, y + i * lineHeight); });
    return lines.length * lineHeight;
  }

  function paintSummaryCanvas(canvas, stats) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1b1028');
    bg.addColorStop(1, '#0c0714');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(211,107,255,0.18)';
    ctx.beginPath(); ctx.arc(900, -40, 420, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,61,206,0.10)';
    ctx.beginPath(); ctx.arc(120, 1800, 380, 0, Math.PI * 2); ctx.fill();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b49cc8';
    ctx.font = '600 36px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    ctx.fillText('פיט', w - 80, 110);
    ctx.fillStyle = '#f3eaff';
    ctx.font = '800 86px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    ctx.fillText(stats.kind === 'partial' ? 'השבוע עד כה' : 'סיכום שבועי', w - 80, 210);
    ctx.fillStyle = '#d36bff';
    ctx.font = '600 36px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    ctx.fillText(root.FitSummary.formatRange(stats), w - 80, 270);
    function tile(x, y, label, value) {
      ctx.fillStyle = '#1b1028';
      roundRect(ctx, x, y, 440, 200, 32);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,120,255,0.28)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#b49cc8';
      ctx.font = '600 30px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(label, x + 400, y + 60);
      ctx.fillStyle = '#f3eaff';
      ctx.font = '800 56px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
      ctx.fillText(String(value), x + 400, y + 140);
    }
    tile(80, 340, 'אימונים', stats.workouts);
    tile(560, 340, 'שיאים', (stats.prs || []).length);
    tile(80, 570, 'נפח מול שבוע קודם', changeShort(stats.volumeChange));
    tile(560, 570, 'רצף', stats.streak || 0);
    // nutrition + streak
    ctx.fillStyle = '#1b1028';
    roundRect(ctx, 80, 810, 920, 260, 32); ctx.fill();
    ctx.strokeStyle = 'rgba(200,120,255,0.28)'; ctx.stroke();
    ctx.fillStyle = '#f3eaff';
    ctx.font = '700 40px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    const nutr = stats.nutrition || { hits: 0, days: 0 };
    ctx.fillText('חלבון ' + nutr.hits + '/' + nutr.days + '  ·  רצף ' + stats.streak, w - 120, 890);
    ctx.fillStyle = '#b49cc8';
    ctx.font = '600 32px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    const sleep = stats.sleepAvg != null ? ('שינה ' + stats.sleepAvg.toFixed(1) + ' שע׳') : 'אין שינה מתועדת';
    const rec = stats.recoveryAvg != null ? ('התאוששות ' + Math.round(stats.recoveryAvg) + '%') : 'אין התאוששות';
    ctx.fillText(sleep + '  ·  ' + rec, w - 120, 970);
    // tips
    ctx.fillStyle = '#f3eaff';
    ctx.font = '800 44px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    ctx.fillText('המלצות', w - 80, 1160);
    let y = 1220;
    ctx.font = '600 34px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    (stats.tips || []).forEach(function (tip) {
      ctx.fillStyle = '#d36bff';
      ctx.fillText('●', w - 80, y);
      ctx.fillStyle = '#f3eaff';
      const used = wrapCanvasText(ctx, tip.text, w - 130, y, 860, 48);
      y += Math.max(used, 48) + 28;
    });
    ctx.fillStyle = '#806894';
    ctx.font = '600 28px "Noto Sans Hebrew","Arial Hebrew",sans-serif';
    ctx.fillText('heziyaffe.github.io/fit-tracker', w - 80, h - 80);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function paintSummaryPreview() {
    const canvas = document.getElementById('summary-canvas');
    if (!canvas || !root.FitSummary) return;
    const stats = summaryStats(state());
    if (stats) paintSummaryCanvas(canvas, stats);
  }

  function shareSummary() {
    const stats = summaryStats(state());
    if (!stats) { toast('אין סיכום לשיתוף'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    paintSummaryCanvas(canvas, stats);
    const text = root.FitSummary.shareText(stats);
    canvas.toBlob(function (blob) {
      if (!blob) return;
      const file = new File([blob], 'fit-weekly.png', { type: 'image/png' });
      const tryShare = function () {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: 'סיכום שבועי', text: text });
        }
        if (navigator.share) return navigator.share({ title: 'סיכום שבועי', text: text });
        return Promise.reject();
      };
      Promise.resolve()
        .then(tryShare)
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'fit-weekly.png';
          a.click();
          toast('התמונה ירדה. אפשר לשתף אותה מהגלריה.');
        });
    }, 'image/png');
  }

  function renderExerciseLibrary(s) {
    const items = E.exerciseIndex(s);
    if (!items.length) return '';
    const sort = ui.exerciseSort || 'recent';
    items.sort(function (a, b) {
      if (sort === 'freq') return b.sessions - a.sessions || b.lastDate.localeCompare(a.lastDate);
      return b.lastDate.localeCompare(a.lastDate) || b.sessions - a.sessions;
    });
    const rows = items.map(function (it) {
      const last = it.last || {};
      const bits = [];
      const bw = isBwEx(last, it.name);
      const st = isStaticEx(last, it.name);
      if (st && (last.sets || last.secs)) bits.push((last.sets || '?') + '×' + formatSecs(last.secs || last.secsMax || 0));
      else if (last.sets || last.reps) bits.push((last.sets || '?') + '×' + (last.reps || '?'));
      if (bw) bits.push(loadLabel(last.weight, true));
      else if (last.weight) bits.push(last.weight + ' ק״ג');
      return '<button type="button" class="list-item" data-action="open-exercise" data-name="' + esc(it.name) + '">' +
        '<div class="meta">' + esc(E.formatDay(it.lastDate)) + ' · ' + it.sessions + ' אימונים</div>' +
        '<div class="title">' + esc(it.name) + ' ' + staticBadge(last, it.name) + ' ' + bwBadge(last, it.name) + '</div>' +
        (bits.length ? '<div class="sub">אחרון: ' + esc(bits.join(' · ')) + '</div>' : '') +
        '</button>';
    }).join('');
    return '<div class="section-title"><h2>תרגילים</h2>' +
      '<span class="sort-tabs">' +
      '<button type="button" class="linkish' + (sort === 'recent' ? ' on' : '') + '" data-action="ex-sort" data-sort="recent">אחרונים</button>' +
      ' · ' +
      '<button type="button" class="linkish' + (sort === 'freq' ? ' on' : '') + '" data-action="ex-sort" data-sort="freq">לפי תדירות</button>' +
      '</span></div>' +
      '<p class="hp-legend" style="margin-top:-4px;margin-bottom:8px">לחצו על תרגיל כדי לראות התקדמות ושיאים.</p>' +
      '<div class="list">' + rows + '</div>';
  }

  function renderExerciseDetail() {
    const name = ui.exerciseName;
    const s = state();
    const sessions = E.sessionsForExercise(s, name);
    if (!sessions.length) {
      return '<header class="page-head"><button type="button" class="btn" data-action="close-exercise">חזרה</button><h1>' + esc(name || 'תרגיל') + '</h1></header>' +
        '<div class="empty card"><p>אין עדיין סטים לתרגיל הזה.</p></div>';
    }
    const stats = E.exerciseStats(sessions);
    const list = stats.sessions;
    const labels = list.map(function (sess) {
      return E.parseISO(sess.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
    });
    const marks = list.map(function (sess) { return !!sess.isPR; });
    const daysSince = stats.daysSinceLastPR;
    const sinceText = daysSince == null ? 'אין שיא עדיין' : (daysSince === 0 ? 'היום' : (daysSince === 1 ? 'אתמול' : daysSince + ' ימים'));
    const rate = (stats.prPerWeek * 10) / 10;
    const rateTxt = (Math.round(stats.prPerWeek * 10) / 10).toString();
    const pctTxt = Math.round(stats.prSessionPct * 100);

    const st = !!(stats.static || (E.isStaticName && E.isStaticName(name)));
    const bw = !!(stats.bodyweight || (E.isBodyweightName && E.isBodyweightName(name)));
    const hasBodyKg = list.some(function (sess) { return sess.bodyWeightUsed > 0; });
    const hasAdded = list.some(function (sess) { return (sess.topWeight || 0) > 0; });
    const table = st
      ? '<p class="kicker">השיא הנוכחי: ' + formatSecs(stats.currentMaxHold || 0) + '.</p>'
      : (stats.bestReps.length
      ? '<div class="reps-table">' + stats.bestReps.map(function (row) {
          return '<div class="reps-row"><span>' + esc(loadLabel(row.weight, row.bodyweight || bw)) + '</span><strong>' + row.reps + ' חזרות</strong><span class="muted">' + esc(E.formatDay(row.date)) + '</span></div>';
        }).join('') + '</div>'
      : '<p class="kicker">אין עדיין נתוני חזרות.</p>');

    const history = list.slice().reverse().map(function (sess) {
      const rowBits = (sess.rows || []).map(function (e) {
        if (st || isStaticEx(e, name)) {
          const hold = e.secs || sess.maxHold || 0;
          return (e.sets || '?') + '×' + formatSecs(hold) + (e.weight ? ' · ' + loadLabel(e.weight, bw || isBwEx(e, name)) : '');
        }
        return (e.sets || '?') + '×' + (e.reps || '?') + ' · ' + loadLabel(e.weight, bw || isBwEx(e, name));
      }).join(' · ');
      const sub = st
        ? ('שיא ' + formatSecs(sess.maxHold || 0) + ' · סה״כ ' + formatSecs(sess.totalSecs || 0))
        : (bw
        ? ('שיא ' + (sess.maxReps || 0) + ' חזרות · סה״כ ' + (sess.totalReps || 0) + (hasBodyKg ? ' · נפח ' + ltr(String(Math.round(sess.volume))) : ''))
        : ('נפח ' + ltr(String(Math.round(sess.volume))) + ' · 1RM משוער ' + ltr((Math.round(sess.e1rm * 10) / 10) + ' ק״ג')));
      return '<div class="list-item">' +
        '<div class="meta">' + esc(E.formatDayLong(sess.date)) + (sess.isPR ? ' ' + prTags(sess.prTypes) : (sess.isBaseline ? ' <span class="pr-tag dim">בסיס</span>' : '')) + '</div>' +
        '<div class="title">' + esc(rowBits) + '</div>' +
        '<div class="sub">' + sub + '</div>' +
        '</div>';
    }).join('');

    const charts = st
      ? ('<section class="card"><h2>שיא החזקה</h2>' +
        Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.maxHold || 0; }), marks: marks, color: '#d36bff', tighten: true, aria: 'שיא החזקה' }) +
        '<p class="hp-legend">השיא הנוכחי: ' + formatSecs(stats.currentMaxHold || 0) + '. נקודה צהובה = שיא.</p></section>' +
        '<section class="card"><h2>סה״כ זמן לאימון</h2>' +
        Charts.barChart({ labels: labels, values: list.map(function (sess) { return sess.totalSecs || 0; }), marks: marks, color: '#8ab4ff', aria: 'סה״כ זמן', height: 170 }) +
        '</section>' +
        (hasAdded ? ('<section class="card"><h2>תוספת משקל</h2>' +
          Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.topWeight || 0; }), marks: marks, color: '#ffb14a', tighten: true, aria: 'תוספת משקל' }) +
          '</section>') : ''))
      : (bw
      ? ('<section class="card"><h2>שיא חזרות בסט</h2>' +
        Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.maxReps || 0; }), marks: marks, color: '#d36bff', tighten: true, aria: 'שיא חזרות בסט' }) +
        '<p class="hp-legend">השיא הנוכחי: ' + (stats.currentMaxReps || 0) + ' חזרות. נקודה צהובה = שיא.</p></section>' +
        '<section class="card"><h2>סה״כ חזרות לאימון</h2>' +
        Charts.barChart({ labels: labels, values: list.map(function (sess) { return sess.totalReps || 0; }), marks: marks, color: '#8ab4ff', aria: 'סה״כ חזרות', height: 170 }) +
        '</section>' +
        (hasAdded ? ('<section class="card"><h2>תוספת משקל</h2>' +
          Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.topWeight || 0; }), marks: marks, color: '#ffb14a', tighten: true, aria: 'תוספת משקל' }) +
          '<p class="hp-legend">משקל נוסף מעבר למשקל הגוף, למשל חגורת משקולות.</p></section>') : '') +
        (hasBodyKg ? ('<section class="card"><h2>נפח (משקל גוף + תוספת)</h2>' +
          Charts.barChart({ labels: labels, values: list.map(function (sess) { return sess.volume; }), marks: marks, color: '#ffb14a', aria: 'נפח', height: 170 }) +
          '<p class="hp-legend">נפח = חזרות × (משקל גוף באותו יום + תוספת).</p></section>') : ''))
      : ('<section class="card"><h2>נפח כולל לאימון</h2>' +
        Charts.barChart({ labels: labels, values: list.map(function (sess) { return sess.volume; }), marks: marks, color: '#8ab4ff', aria: 'נפח כולל', height: 170 }) +
        '<p class="hp-legend">נפח = סטים × חזרות × משקל. נקודה צהובה / עמודה צהובה = שיא.</p></section>' +
        '<section class="card"><h2>משקל בסט הכבד</h2>' +
        Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.topWeight; }), marks: marks, color: '#d36bff', tighten: true, aria: 'משקל בסט הכבד' }) +
        '</section>' +
        '<section class="card"><h2>1RM משוער (Epley)</h2>' +
        Charts.lineChart({ labels: labels, values: list.map(function (sess) { return Math.round(sess.e1rm * 10) / 10; }), marks: marks, color: '#ffb14a', tighten: true, aria: '1RM משוער' }) +
        '<p class="hp-legend">נוסחת Epley: משקל × (1 + חזרות/30). השיא הנוכחי: ' + ltr((Math.round(stats.currentMaxE1rm * 10) / 10) + ' ק״ג') + '.</p></section>'));

    return '<header class="page-head">' +
      '<button type="button" class="btn" data-action="close-exercise">חזרה</button>' +
      '<h1>' + esc(name) + ' ' + staticBadge({ static: st }, name) + ' ' + (bw ? '<span class="bw-badge">משקל גוף</span>' : '') + '</h1></header>' +

      '<div class="stats-grid">' +
      '<div class="metric-pill"><div class="label">שיאים סה״כ</div><div class="value">' + stats.totalPRs + '</div></div>' +
      '<div class="metric-pill"><div class="label">שיאים ב־30 יום</div><div class="value">' + stats.prLast30 + '</div></div>' +
      '<div class="metric-pill"><div class="label">שיאים לשבוע</div><div class="value">' + ltr(rateTxt) + '</div></div>' +
      '<div class="metric-pill"><div class="label">% אימונים עם שיא</div><div class="value">' + pctTxt + '<span class="unit">%</span></div></div>' +
      '<div class="metric-pill"><div class="label">ימים מאז שיא</div><div class="value">' + esc(sinceText) + '</div></div>' +
      '<div class="metric-pill"><div class="label">' + (st ? 'שיא החזקה' : (bw ? 'שיא חזרות' : 'אימונים')) + '</div><div class="value">' + (st ? esc(formatSecs(stats.currentMaxHold || 0)) : (bw ? (stats.currentMaxReps || 0) : stats.totalSessions)) + '</div></div>' +
      '</div>' +
      charts +
      (st ? '' : '<section class="card"><h2>' + (bw ? 'שיא חזרות לפי עומס' : 'שיא חזרות לפי משקל') + '</h2>' + table + '</section>') +
      '<div class="section-title"><h2>היסטוריית אימונים</h2></div>' +
      '<div class="list">' + history + '</div>';
  }


  function renderWaterSettings(s) {
    const set = s.settings || {};
    const v = vesselOf(s);
    const goal = E.waterTarget(s);
    const presets = ((C.WATER_VESSEL_PRESETS || {})[v.kind] || []).slice();
    const isCustom = presets.indexOf(v.ml) === -1;
    const presetChips = presets.map(function (ml) {
      return '<button type="button" class="chip' + (v.ml === ml ? ' active' : '') + '" data-action="set-vessel-ml" data-ml="' + ml + '">' + ml + ' מ״ל</button>';
    }).join('') +
      '<button type="button" class="chip' + (isCustom ? ' active' : '') + '" data-action="vessel-custom">מותאם</button>';
    return '<section class="card"><h2>מים</h2>' +
      '<div class="water-preview">' +
      '<div class="today-ico water-ico-wrap large">' + waterIcon(v.kind) + '</div>' +
      '<div><div class="label">כלי השתייה</div><div class="value">' + esc(v.label) + ' של ' + v.ml + ' מ״ל</div></div></div>' +
      '<div class="chips" style="margin:10px 0">' +
      '<button type="button" class="chip' + (v.kind === 'cup' ? ' active' : '') + '" data-action="set-water-vessel" data-kind="cup">כוס</button>' +
      '<button type="button" class="chip' + (v.kind === 'bottle' ? ' active' : '') + '" data-action="set-water-vessel" data-kind="bottle">בקבוק</button>' +
      '</div>' +
      '<div class="field"><span>נפח הכלי</span><div class="chips">' + presetChips + '</div></div>' +
      '<label class="field"><span>נפח מותאם (מ״ל)</span>' +
      '<input type="number" min="50" step="50" inputmode="numeric" data-action="setting-vessel-ml" value="' + v.ml + '" /></label>' +
      '<div class="setting"><div class="grow"><div>יעד מים יומי</div><div class="desc">מוצג בליטרים</div></div>' +
      '<div class="stepper">' +
      '<button type="button" data-action="step-water-goal" data-delta="-250" aria-label="הורדה">−</button>' +
      '<div class="num">' + ltr(E.formatLiters(goal) + ' ל׳') + '</div>' +
      '<button type="button" data-action="step-water-goal" data-delta="250" aria-label="העלאה">+</button>' +
      '</div></div></section>';
  }

  function renderSettings() {
    const s = state();
    const set = s.settings;
    const lastW = Store.latestWeight();
    const demoCard = Store.isDemoMode()
      ? '<section class="card demo-cta"><h2>מצב דמו</h2><p class="hp-legend" style="margin-bottom:12px">מוצגים נתוני הדגמה. הנתונים האמיתיים שמורים בנפרד ולא הוחלפו.</p>' +
        '<button type="button" class="btn wide" data-action="exit-demo">צא ממצב דמו</button></section>'
      : '<section class="card demo-cta"><h2>נתוני דמו</h2><p class="hp-legend" style="margin-bottom:12px">טעינת הדמו לא מוחקת ולא דורסת את הנתונים האמיתיים. אפשר לצאת בכל רגע.</p>' +
        '<button type="button" class="btn primary wide" data-action="enter-demo">טען נתוני דמו</button></section>';
    const themePref = getThemePref();
    const themeCard = '<section class="card"><h2>מראה</h2>' +
      '<div class="setting"><div class="grow"><div>ערכת נושא</div><div class="desc">כהה בסגנון Royal Violet, או בהיר עם אותם מבטאים</div></div>' +
      '<div class="theme-switch">' +
      '<button type="button" class="chip' + (themePref === 'system' ? ' active' : '') + '" data-action="set-theme" data-theme="system">מערכת</button>' +
      '<button type="button" class="chip' + (themePref === 'dark' ? ' active' : '') + '" data-action="set-theme" data-theme="dark">כהה</button>' +
      '<button type="button" class="chip' + (themePref === 'light' ? ' active' : '') + '" data-action="set-theme" data-theme="light">בהיר</button>' +
      '</div></div></section>';

    const N = (window.FitNotify && FitNotify.notifOf(s)) || (set.notifications || {});
    const perm = window.FitNotify ? FitNotify.permission() : 'unsupported';
    const permLabel = perm === 'granted' ? 'ההרשאה ניתנה' : (perm === 'denied' ? 'ההרשאה נחסמה בהגדרות המכשיר' : (perm === 'unsupported' ? 'הדפדפן לא תומך בהתראות' : 'ממתינים לאישור'));
    const iosNote = (window.FitNotify && FitNotify.isIOS() && !FitNotify.isStandalone())
      ? '<p class="hp-legend notify-note">באייפון צריך קודם להוסיף את האפליקציה למסך הבית (iOS 16.4 ומעלה) כדי לקבל התראות.</p>'
      : '<p class="hp-legend notify-note">באייפון ההתראות זמינות רק אחרי שמוסיפים את האפליקציה למסך הבית (iOS 16.4 ומעלה). התזמון המקומי עובד כשהאפליקציה פתוחה או ברקע. שרת התראות (Web Push) יתווסף בהמשך.</p>';
    const permBtn = perm === 'granted' || perm === 'unsupported'
      ? ''
      : '<button type="button" class="btn primary wide" data-action="notify-request">אפשר התראות</button>';
    const notifyCard = '<section class="card" id="notify-card"><h2>התראות</h2>' +
      '<p class="hp-legend" style="margin-bottom:10px">מצב הרשאה: ' + permLabel + '</p>' +
      permBtn + iosNote +
      '<div class="setting"><div class="grow"><div>תזכורת לאימון</div><div class="desc">בימים שיש תבנית, בשעה שנבחרה. לא נשלחת אם כבר תיעדת אימון היום.</div></div>' +
      '<label class="toggle"><input type="checkbox" data-action="notify-toggle" data-key="workoutEnabled"' + (N.workoutEnabled ? ' checked' : '') + ' /><span></span></label></div>' +
      '<label class="field"><span>שעת תזכורת לאימון</span>' +
      '<input type="time" lang="he-IL" dir="ltr" data-action="notify-setting" data-key="workoutTime" value="' + esc(N.workoutTime || '18:00') + '" /></label>' +
      '<div class="setting"><div class="grow"><div>תזכורות לארוחות</div><div class="desc">לפי השעות בתפריט של היום, רק לארוחות שעוד לא סומנו.</div></div>' +
      '<label class="toggle"><input type="checkbox" data-action="notify-toggle" data-key="mealEnabled"' + (N.mealEnabled ? ' checked' : '') + ' /><span></span></label></div>' +
      '<div class="setting"><div class="grow"><div>אזהרת מד נמוך</div><div class="desc">פעם ביום, אם מד העקביות יורד מתחת לסף.</div></div>' +
      '<label class="toggle"><input type="checkbox" data-action="notify-toggle" data-key="lowHpEnabled"' + (N.lowHpEnabled ? ' checked' : '') + ' /><span></span></label></div>' +
      '<label class="field"><span>סף אזהרה (%)</span>' +
      '<input type="number" min="10" max="90" step="5" inputmode="numeric" data-action="notify-setting" data-key="lowHpThreshold" value="' + esc(N.lowHpThreshold || 50) + '" style="width:90px" /></label>' +
      '</section>';


    const syncOn = window.FitSync && FitSync.isConfigured();
    const whoopOn = window.FitSync && FitSync.whoopReady();
    const syncSt = window.FitSync ? FitSync.status() : { signedIn: false };
    const soon = '<span class="soon-badge">בקרוב</span>';
    const accountCard = !syncOn
      ? ('<section class="card is-soon"><h2>חשבון וסנכרון ' + soon + '</h2>' +
        '<p class="hp-legend">סנכרון בענן (כניסה בקישור למייל) יופיע כאן אחרי שתקימו פרויקט Supabase ותמלאו את <code>js/cloud-config.js</code>. ההוראות המדויקות ב-<code>server/README.md</code>. עד אז כל הנתונים נשארים במכשיר.</p></section>')
      : ('<section class="card"><h2>חשבון וסנכרון</h2>' +
        (syncSt.signedIn
          ? ('<p class="hp-legend">מחוברים' + (syncSt.user && syncSt.user.email ? (': ' + esc(syncSt.user.email)) : '') + '</p>' +
            '<div class="btn-row" style="grid-template-columns:1fr 1fr">' +
            '<button type="button" class="btn primary" data-action="sync-now">סנכרון עכשיו</button>' +
            '<button type="button" class="btn" data-action="sync-signout">התנתקות</button></div>' +
            (syncSt.lastSync ? '<p class="hp-legend">סונכרן לאחרונה: ' + esc(syncSt.lastSync) + '</p>' : '') +
            (syncSt.error ? '<p class="hp-legend">' + esc(syncSt.error) + '</p>' : ''))
          : ('<p class="hp-legend">הכניסה המומלצת באפליקציה שעל מסך הבית היא עם אימייל וסיסמה. אם השדות נראים מלאים והכניסה נכשלת, הקישו בתוך השדה והקלידו שוב. אפשר גם לקבל קוד למייל ולהזין אותו כאן, בלי ללחוץ על קישור.</p>' +
            '<form id="sync-auth-form" action="#" method="post" novalidate>' +
            '<label class="field"><span>אימייל</span><input type="email" id="sync-email" name="email" dir="ltr" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>' +
            '<label class="field"><span>סיסמה</span><input type="password" id="sync-password" name="password" dir="ltr" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>' +
            '<div class="btn-row" style="grid-template-columns:1fr 1fr">' +
            '<button type="submit" class="btn primary" id="sync-signin-btn">כניסה</button>' +
            '<button type="button" class="btn" data-action="sync-signup">הרשמה</button></div>' +
            '</form>' +
            '<button type="button" class="btn wide" data-action="sync-send-otp">שלחו קוד למייל</button>' +
            '<label class="field"><span>קוד בן 8 ספרות מהמייל</span><input type="text" id="sync-otp" dir="ltr" inputmode="numeric" autocomplete="one-time-code" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="8" /></label>' +
            '<button type="button" class="btn wide" data-action="sync-verify-otp">אימות קוד</button>' +
            '<button type="button" class="btn wide" data-action="sync-magic">שלחו קישור כניסה</button>')) +
        (syncSt.signedIn
          ? ('<label class="field" style="margin-top:12px"><span>סיסמה חדשה (לפעם הבאה)</span><input type="password" id="sync-new-password" dir="ltr" autocomplete="new-password" autocapitalize="none" autocorrect="off" spellcheck="false" /></label>' +
            '<button type="button" class="btn" data-action="sync-set-password">שמירת סיסמה</button>')
          : '') +
        '</section>');
    const whoopSt = syncSt.whoop || {};
    const whoopErr = whoopSt.error || whoopSt.last_error || (whoopSt.link && whoopSt.link.last_error);
    const whoopSyncAt = (whoopSt.link && (whoopSt.link.last_sync_at || whoopSt.last_sync_at)) || '';
    const whoopCard = !whoopOn
      ? ('<section class="card is-soon"><h2>חיבור Whoop ' + soon + '</h2>' +
        '<p class="hp-legend">אחרי הקמת השרת ומילוי מזהה הלקוח של Whoop ב-<code>js/cloud-config.js</code>, אפשר יהיה לחבר את החשבון. מדדי Recovery, Strain, שינה, HRV ואימונים ייכנסו עם מקור whoop.</p></section>')
      : ('<section class="card"><h2>חיבור Whoop</h2>' +
        (syncSt.signedIn
          ? ((whoopSt.connected
              ? ('<p class="hp-legend">מחוברים ל-Whoop' + (whoopSyncAt ? (' · סונכרן לאחרונה: ' + esc(String(whoopSyncAt).replace('T', ' ').slice(0, 16))) : '') + '.</p>')
              : '<p class="hp-legend">לחיצה תפתח את אתר Whoop לאישור. אחרי האישור חזרו לאפליקציה — החיבור נשמר בשרת גם אם נפתח בדפדפן.</p>') +
            '<div class="btn-row" style="grid-template-columns:1fr 1fr">' +
            '<button type="button" class="btn primary" data-action="whoop-connect">' + (whoopSt.connected ? 'חיבור מחדש' : 'חבר Whoop') + '</button>' +
            '<button type="button" class="btn" data-action="whoop-refresh">משיכת נתונים</button></div>' +
            (whoopErr ? '<p class="hp-legend">' + esc(whoopErr) + '</p>' : ''))
          : '<p class="hp-legend">קודם התחברו לחשבון, ואז אפשר לחבר את Whoop.</p>') +
        '</section>');

    return pageHead('<h1>הגדרות</h1>', '', { noGear: true }) + demoCard + themeCard + notifyCard + accountCard + whoopCard +
      '<section class="card">' +
      '<label class="field"><span>שם תצוגה</span>' +
      '<input type="text" data-action="setting" data-key="displayName" value="' + esc(set.displayName || '') + '" /></label>' +
      '<div class="setting"><div class="grow"><div>יעד אימונים בשבוע</div><div class="desc">משמש לחישוב מד העקביות</div></div>' +
      '<div class="stepper">' +
      '<button type="button" data-action="step-setting" data-key="weeklyWorkoutTarget" data-delta="-1" aria-label="הורדה">−</button>' +
      '<div class="num">' + (Number(set.weeklyWorkoutTarget) || 4) + '</div>' +
      '<button type="button" data-action="step-setting" data-key="weeklyWorkoutTarget" data-delta="1" aria-label="העלאה">+</button>' +
      '</div></div>' +
      '<div class="setting"><div class="grow"><div>יעד חלבון יומי</div><div class="desc">גרם ליום</div></div>' +
      '<input type="number" min="1" step="5" inputmode="numeric" data-action="setting" data-key="dailyProteinTarget" value="' + (Number(set.dailyProteinTarget) || 150) + '" style="width:90px" /></div>' +
      '<div class="setting"><div class="grow"><div>יעד קלוריות יומי</div><div class="desc">אופציונלי — השאירו ריק כדי להסתיר</div></div>' +
      '<input type="number" min="0" step="50" inputmode="numeric" data-action="setting" data-key="dailyCalorieTarget" value="' + esc(set.dailyCalorieTarget == null ? '' : set.dailyCalorieTarget) + '" placeholder="אין" style="width:90px" /></div>' +
      '</section>' +
      renderWaterSettings(s) +
      '<section class="card">' +
      '<div class="setting"><div class="grow"><div>משקל גוף</div><div class="desc">' +
      (lastW ? 'אחרון: ' + lastW.weight + ' ק״ג · ' + E.formatDay(lastW.date) : 'טרם תועד') +
      '</div></div>' +
      '<button type="button" class="btn tiny" data-action="open-weight">תיעוד</button></div>' +
      '</section>' +

      '<section class="card"><h2>גיבוי</h2>' +
      '<p class="hp-legend" style="margin-bottom:12px">הנתונים נשמרים במכשיר הזה בלבד. ייצוא יוצר קובץ JSON שאפשר לייבא בגיבוי או במכשיר אחר. תמונות התקדמות אופציונליות בגיבוי, כי הן כבדות.</p>' +
      '<div class="btn-row" style="grid-template-columns:1fr 1fr">' +
      '<button type="button" class="btn primary" data-action="export">ייצוא JSON</button>' +
      '<button type="button" class="btn" data-action="import">ייבוא JSON</button>' +
      '</div>' +
      '<input type="file" id="import-file" accept="application/json,.json" hidden />' +
      '</section>' +

      '<section class="card"><h2>הוספה למסך הבית</h2>' +
      '<ol class="install-steps">' +
      '<li>באייפון: לחצו על שיתוף, ואז «הוסף למסך הבית».</li>' +
      '<li>באנדרואיד: בתפריט בחרו «התקן אפליקציה» או «הוסף למסך הבית».</li>' +
      '</ol></section>' +



      '<section class="card"><button type="button" class="btn danger wide" data-action="confirm-clear">מחיקת כל הנתונים</button></section>' +
      '<p class="hp-legend" dir="ltr" style="text-align:center;margin:8px 0 24px">v' + esc((window.FitConfig && FitConfig.APP_VERSION) || '') + '</p>';
  }

  /* ---------- modals ---------- */


  function renderTemplateList() {
    const list = Store.listTemplates();
    let body;
    if (!list.length) {
      body = '<div class="empty card">' + emptyArt('workout') + '<p>עדיין אין תבניות אימון. בנו תבנית (למשל Push A) ואז התחילו אימון חי לפי הסדר.</p>' +
        '<button type="button" class="btn primary" data-action="new-template">תבנית חדשה</button></div>';
    } else {
      body = list.map(function (tpl) {
        const days = (tpl.days || []).map(function (d) {
          const found = DAY_LABELS.find(function (x) { return x.id === Number(d); });
          return found ? found.short : d;
        }).join(' · ');
        const n = (tpl.exercises || []).length;
        return '<div class="card tpl-card">' +
          '<div><div class="title">' + esc(tpl.name || 'תבנית') + '</div>' +
          '<div class="meta">' + n + ' תרגילים' + (days ? ' · ' + days : '') + '</div></div>' +
          '<button type="button" class="btn primary tiny" data-action="start-template" data-id="' + esc(tpl.id) + '">התחל</button>' +
          '<div class="actions">' +
          '<button type="button" class="btn tiny" data-action="edit-template" data-id="' + esc(tpl.id) + '">עריכה</button>' +
          '<button type="button" class="btn tiny" data-action="dup-template" data-id="' + esc(tpl.id) + '">שכפול</button>' +
          '<button type="button" class="btn tiny danger" data-action="del-template" data-id="' + esc(tpl.id) + '">מחיקה</button>' +
          '</div></div>';
      }).join('');
    }
    return '<div class="section-title"><h2>תבניות אימון</h2>' +
      '<button type="button" class="linkish" data-action="new-template">+ חדשה</button></div>' + body;
  }

  function renderTemplateEditor() {
    const draft = ui.editingTemplate;
    if (!draft) return '';
    const isNew = !draft.id || String(draft.id).indexOf('tmp_') === 0;
    const exHtml = (draft.exercises || []).map(function (ex, i) {
      const ss = ex.supersetId && draft.exercises[i + 1] && draft.exercises[i + 1].supersetId === ex.supersetId;
      const ssPrev = ex.supersetId && i > 0 && draft.exercises[i - 1].supersetId === ex.supersetId;
      return '<div class="builder-ex' + (ex.supersetId ? ' superset' : '') + '" data-ex-index="' + i + '">' +
        ((ss || ssPrev) ? '<div class="ss-label">סופרסט</div>' : '') +
        '<div class="builder-head">' +
        '<span class="drag-handle" data-action="drag-tex" data-index="' + i + '" aria-label="גרירה">⠿</span>' +
        '<input type="text" data-tex="' + i + '" data-texk="name" placeholder="שם התרגיל" value="' + esc(ex.name || '') + '" />' +
        '<div class="reorder">' +
        '<button type="button" class="icon-btn" data-action="move-tex" data-index="' + i + '" data-dir="-1" aria-label="למעלה">↑</button>' +
        '<button type="button" class="icon-btn" data-action="move-tex" data-index="' + i + '" data-dir="1" aria-label="למטה">↓</button>' +
        '<button type="button" class="icon-btn" data-action="del-tex" data-index="' + i + '" aria-label="מחיקה">×</button>' +
        '</div></div>' +
        '<div class="builder-flags">' +
        '<button type="button" class="chip' + (isBwEx(ex, ex.name) ? ' active' : '') + '" data-action="toggle-tex-bw" data-index="' + i + '">משקל גוף</button>' +
        '<button type="button" class="chip' + (isStaticEx(ex, ex.name) ? ' active' : '') + '" data-action="toggle-tex-static" data-index="' + i + '">סטטי</button>' +
        '</div>' +
        '<label class="field quick-field"><span>הזנה מהירה</span>' +
        '<input type="text" dir="ltr" inputmode="text" autocomplete="off" data-tex="' + i + '" data-texk="quick" value="' + esc(P.formatQuick(ex)) + '" placeholder="' + (isStaticEx(ex, ex.name) ? '3×45s' : '3×8-12×50') + '" /></label>' +
        '<p class="quick-hint' + (ex._quickError ? ' err' : '') + '" data-quick-hint="' + i + '">' +
        (ex._quickError
          ? (isStaticEx(ex, ex.name) ? 'לא הצלחתי לקרוא. נסו 3x45s, 3*45 או 3x1:00' : 'לא הצלחתי לקרוא. נסו 3*8-12*50 או 3x8-12x50')
          : (isStaticEx(ex, ex.name) ? 'סטים × זמן × תוספת, למשל 3x45s, 3*45 או 3x1:00x10' : 'סטים × טווח חזרות × משקל, למשל 3*8-12*50 או 3x8-12')) +
        '</p>' +
        '<div class="builder-grid">' +
        '<label class="field"><span>סטים</span><input type="number" min="1" data-tex="' + i + '" data-texk="sets" value="' + esc(ex.sets || '') + '" /></label>' +
        '<label class="field"><span>' + (isBwEx(ex, ex.name) ? 'תוספת (ק״ג)' : 'משקל') + '</span>' +
        '<input type="number" min="0" step="0.5" data-tex="' + i + '" data-texk="weight" value="' + esc(ex.weight === 0 ? 0 : (ex.weight || '')) + '" placeholder="' + (isBwEx(ex, ex.name) ? '+ ק״ג' : 'ק״ג, אופציונלי') + '" /></label>' +
        '<label class="field span-2"><span>' + (isStaticEx(ex, ex.name) ? 'זמן יעד' : 'טווח חזרות') + '</span><div class="reps-editor">' +
        (isStaticEx(ex, ex.name)
          ? '<input type="text" dir="ltr" inputmode="text" autocomplete="off" data-tex="' + i + '" data-texk="secsRange" value="' + esc(P.formatDurationRange ? P.formatDurationRange(ex) : '') + '" placeholder="45s" />'
          : '<input type="text" dir="ltr" inputmode="text" autocomplete="off" data-tex="' + i + '" data-texk="repsRange" value="' + esc(P.formatRepsRange(ex)) + '" placeholder="8-12" />') +
        '<button type="button" class="chip max-chip' + (isMaxReps(ex) ? ' active' : '') + '" data-action="toggle-tex-max" data-index="' + i + '">MAX</button>' +
        '</div></label>' +
        '</div>' +
        (ex.restSec !== '' && ex.restSec != null
          ? '<label class="field rest-field"><span>מנוחה (שנ׳)</span><div class="reps-editor">' +
            '<input type="number" min="15" step="15" data-tex="' + i + '" data-texk="restSec" value="' + esc(ex.restSec) + '" />' +
            '<button type="button" class="linkish" data-action="hide-tex-rest" data-index="' + i + '">הסרה</button>' +
            '</div></label>'
          : '<button type="button" class="linkish add-rest" data-action="show-tex-rest" data-index="' + i + '">+ מנוחה</button>') +
        '<label class="field"><span>הערות</span><input type="text" data-tex="' + i + '" data-texk="notes" value="' + esc(ex.notes || '') + '" placeholder="אופציונלי" /></label>' +
        (ss ? '' : '<button type="button" class="linkish" data-action="superset-tex" data-index="' + i + '">סופרסט עם הבא</button>') +
        '</div>';
    }).join('') || '<p class="hp-legend">הוסיפו תרגיל מהספרייה או הקלידו שם.</p>';

    const groups = exercisesByMuscle().map(function (g) {
      return '<div class="lib-group"><h3>' + esc(g.label) + '</h3><div class="chips">' +
        g.items.map(function (n) {
          return '<button type="button" class="chip" data-action="add-tex-name" data-name="' + esc(n) + '">' + esc(n) + (E.isStaticName && E.isStaticName(n) ? ' <span class="bw-dot">סטטי</span>' : '') + (E.isBodyweightName && E.isBodyweightName(n) ? ' <span class="bw-dot">גוף</span>' : '') + '</button>';
        }).join('') + '</div></div>';
    }).join('');

    return pageHead('<div><p class="kicker">בונה אימונים</p><h1>' + (isNew ? 'תבנית חדשה' : 'עריכת תבנית') + '</h1></div>',
      '<button type="button" class="btn" data-action="close-template">ביטול</button>', { noGear: true }) +
      '<section class="card">' +
      '<label class="field"><span>שם התבנית</span><input type="text" id="tpl-name" value="' + esc(draft.name || '') + '" placeholder="למשל Push A" /></label>' +
      '<div class="field"><span>ימים (אופציונלי)</span>' + daysChips(draft.days, 'toggle-tpl-day') + '</div>' +
      '<div class="field"><span>סוג</span><div class="chips">' +
      C.WORKOUT_TYPES.map(function (tp) {
        return '<button type="button" class="chip' + (draft.type === tp.id ? ' active' : '') + '" data-action="tpl-type" data-type="' + tp.id + '">' + esc(tp.label) + '</button>';
      }).join('') + '</div></div>' +
      '</section>' +
      '<div class="section-title"><h2>תרגילים לפי סדר</h2></div>' + exHtml +
      '<section class="card"><h2>הוספת תרגיל</h2>' +
      '<div class="live-add"><input type="text" id="tpl-ex-name" placeholder="שם התרגיל" autocomplete="off" />' +
      '<button type="button" class="btn primary" data-action="add-tex">הוספה</button></div>' +
      groups + '</section>' +
      '<button type="button" class="btn primary wide" data-action="save-template">שמירת תבנית</button>';
  }

  function renderMenuList() {
    const list = Store.listMenus();
    if (!list.length) {
      return '<div class="empty card">' + emptyArt('food') + '<p>עדיין אין תפריטים. בנו תבנית יומית (יום אימון / יום מנוחה) ואז יישמו אותה להיום.</p>' +
        '<button type="button" class="btn primary" data-action="new-menu">תפריט חדש</button></div>';
    }
    return list.map(function (menu) {
      const tot = Store.menuTotals(menu);
      const n = (menu.meals || []).length;
      const apply = menu.applyOn === 'workout' ? 'ביום אימון' : (menu.applyOn === 'rest' ? 'ביום מנוחה' : '');
      return '<div class="card tpl-card">' +
        '<div><div class="title">' + esc(menu.name || 'תפריט') + '</div>' +
        '<div class="meta">' + n + ' ארוחות · ' + fmtMacros(tot, true) + (apply ? ' · ' + apply : '') + '</div></div>' +
        '<button type="button" class="btn primary tiny" data-action="apply-menu" data-id="' + esc(menu.id) + '">החל על היום</button>' +
        '<div class="actions">' +
        '<button type="button" class="btn tiny" data-action="edit-menu" data-id="' + esc(menu.id) + '">עריכה</button>' +
        '<button type="button" class="btn tiny" data-action="dup-menu" data-id="' + esc(menu.id) + '">שכפול</button>' +
        '<button type="button" class="btn tiny danger" data-action="del-menu" data-id="' + esc(menu.id) + '">מחיקה</button>' +
        '</div></div>';
    }).join('');
  }

  function renderMenuEditor() {
    const draft = ui.editingMenu;
    if (!draft) return '';
    const isNew = !draft.id || String(draft.id).indexOf('tmp_') === 0;
    const tot = Store.menuTotals(draft);
    const s = state();
    const pTarget = E.proteinTarget(s);
    const cTarget = Number(s.settings.dailyCalorieTarget) || 0;
    const meals = (draft.meals || []).map(function (meal, i) {
      const mt = Store.mealTotals(meal);
      const foods = (meal.foods || []).map(function (f, fi) {
        return '<div class="meal-food"><div>' + esc(f.name) + ' ×' + (f.qty || 1) + '</div>' +
          '<div>' + Math.round((f.protein || 0) * (f.qty || 1)) + 'ג׳' +
          ' <button type="button" class="linkish" data-action="del-menu-food" data-mi="' + i + '" data-fi="' + fi + '">הסרה</button></div></div>';
      }).join('') || '<p class="kicker">אין מאכלים עדיין</p>';
      return '<div class="builder-meal">' +
        '<div class="builder-head">' +
        '<span class="drag-handle" data-action="drag-meal" data-index="' + i + '">⠿</span>' +
        '<input type="text" data-meal="' + i + '" data-mealk="name" value="' + esc(meal.name || '') + '" placeholder="שם הארוחה" />' +
        '<input type="time" lang="he-IL" dir="ltr" data-meal="' + i + '" data-mealk="time" value="' + esc(meal.time || '') + '" aria-label="שעה" />' +
        '<div class="reorder">' +
        '<button type="button" class="icon-btn" data-action="move-meal" data-index="' + i + '" data-dir="-1" aria-label="למעלה">↑</button>' +
        '<button type="button" class="icon-btn" data-action="move-meal" data-index="' + i + '" data-dir="1" aria-label="למטה">↓</button>' +
        '<button type="button" class="icon-btn" data-action="del-meal-row" data-index="' + i + '" aria-label="מחיקה">×</button>' +
        '</div></div>' +
        '<div class="meal-totals">' + fmtMacros(mt, true) + '</div>' +
        '<div class="meal-foods">' + foods + '</div>' +
        '<div class="chips">' + Store.listFoods().map(function (f) {
          return '<button type="button" class="chip" data-action="add-meal-food" data-mi="' + i + '" data-id="' + esc(f.id) + '">+ ' + esc(f.name) + '</button>';
        }).join('') + '</div>' +
        '</div>';
    }).join('');

    const slots = (C.MEAL_SLOTS || []).map(function (n) {
      return '<button type="button" class="chip" data-action="add-meal-slot" data-name="' + esc(n) + '">+ ' + esc(n) + '</button>';
    }).join('');

    return pageHead('<div><p class="kicker">בונה תפריט</p><h1>' + (isNew ? 'תפריט חדש' : 'עריכת תפריט') + '</h1></div>',
      '<button type="button" class="btn" data-action="close-menu">ביטול</button>', { noGear: true }) +
      '<section class="card">' +
      '<label class="field"><span>שם התפריט</span><input type="text" id="menu-name" value="' + esc(draft.name || '') + '" placeholder="למשל יום אימון" /></label>' +
      '<div class="field"><span>החלה אוטומטית</span><div class="chips">' +
      '<button type="button" class="chip' + (draft.applyOn === 'workout' ? ' active' : '') + '" data-action="menu-apply" data-val="workout">יום אימון</button>' +
      '<button type="button" class="chip' + (draft.applyOn === 'rest' ? ' active' : '') + '" data-action="menu-apply" data-val="rest">יום מנוחה</button>' +
      '<button type="button" class="chip' + (!draft.applyOn ? ' active' : '') + '" data-action="menu-apply" data-val="">ידני בלבד</button>' +
      '</div></div>' +
      '<div class="field"><span>ימים (אופציונלי)</span>' + daysChips(draft.days, 'toggle-menu-day') + '</div>' +
      '<p class="hp-legend">סה״כ יומי: ' + fmtMacros(tot, true) +
      ' · יעד חלבון ' + pTarget + (cTarget ? ' · יעד קלוריות ' + cTarget : '') + '</p>' +
      '</section>' +
      '<div class="section-title"><h2>ארוחות לפי סדר</h2></div>' + meals +
      '<section class="card"><h2>הוספת ארוחה</h2><div class="chips">' + slots +
      '<button type="button" class="chip" data-action="add-meal-slot" data-name="ארוחה">+ אחר</button></div></section>' +
      '<button type="button" class="btn primary wide" data-action="save-menu">שמירת תפריט</button>';
  }

  function renderTodayMeals(date) {
    Store.autoApplyMenu(date);
    const day = Store.getDayMenu(date);
    const menus = Store.listMenus();
    const header = '<div class="section-title"><h2>תפריט היום</h2>' +
      '<button type="button" class="linkish" data-action="new-menu">+ תפריט</button></div>';
    if (!day) {
      return header + (menus.length ? renderMenuList() : '<div class="empty card">' + emptyArt('food') +
        '<p>אין תפריט ליום הזה. בנו תבנית או החילו תפריט קיים.</p>' +
        '<button type="button" class="btn primary" data-action="new-menu">תפריט חדש</button></div>');
    }
    const eaten = (day.meals || []).filter(function (m) { return m.status === 'eaten'; }).length;
    const total = (day.meals || []).length;
    const s = state();
    const nut = E.nutritionOn(s, date) || { protein: 0 };
    const pTarget = E.proteinTarget(s);
    const cards = (day.meals || []).map(function (meal) {
      const mt = Store.mealTotals(meal);
      const st = meal.status || 'pending';
      const foods = (meal.foods || []).map(function (f) {
        return '<div class="meal-food"><div>' + esc(f.name) + (f.qty && f.qty !== 1 ? ' ×' + f.qty : '') + '</div>' +
          '<div>' + Math.round((f.protein || 0) * (f.qty || 1)) + 'ג׳' +
          (st === 'pending' ? ' <button type="button" class="linkish" data-action="swap-food" data-date="' + date + '" data-mid="' + esc(meal.id) + '" data-fid="' + esc(f.id) + '">החלפה</button>' : '') +
          '</div></div>';
      }).join('');
      return '<div class="meal-card ' + st + '">' +
        '<div class="meal-head"><div><strong>' + esc(meal.name) + '</strong>' +
        (meal.time ? '<div class="kicker">' + esc(meal.time) + '</div>' : '') + '</div>' +
        '<div class="meal-totals">' + fmtMacros(mt, true) + '</div></div>' +
        '<div class="meal-foods">' + foods + '</div>' +
        (st === 'pending'
          ? '<div class="live-actions"><button type="button" class="btn primary" data-action="eat-meal" data-date="' + date + '" data-mid="' + esc(meal.id) + '">אכלתי</button>' +
            '<button type="button" class="btn" data-action="skip-meal" data-date="' + date + '" data-mid="' + esc(meal.id) + '">דילוג</button></div>'
          : '<div class="live-actions"><p class="kicker">' + (st === 'eaten' ? 'נאכלה ✓' : 'דולגה') + '</p>' +
            '<button type="button" class="linkish" data-action="undo-meal" data-date="' + date + '" data-mid="' + esc(meal.id) + '">ביטול</button></div>') +
        '</div>';
    }).join('');
    return header +
      '<p class="plan-progress">ארוחות ' + ltr(eaten + ' / ' + total) +
      ' · חלבון עד כה ' + ltr((Number(nut.protein) || 0) + ' / ' + pTarget) + '</p>' +
      '<p class="kicker" style="margin-bottom:8px">' + esc(day.menuName || '') + '</p>' +
      cards +
      '<details class="card" style="margin-top:8px"><summary>החלפת תפריט או עריכה</summary>' + renderMenuList() + '</details>';
  }

  function renderStartSheet() {
    const list = Store.listTemplates();
    const today = new Date().getDay();
    const rec = list.filter(function (t) { return (t.days || []).map(Number).indexOf(today) >= 0; });
    const rows = list.map(function (tpl) {
      const isRec = rec.some(function (r) { return r.id === tpl.id; });
      const n = (tpl.exercises || []).length;
      return '<button type="button" class="list-item' + (isRec ? ' on' : '') + '" data-action="start-template" data-id="' + esc(tpl.id) + '">' +
        '<div class="title">' + esc(tpl.name) + (isRec ? ' · היום' : '') + '</div>' +
        '<div class="sub">' + n + ' תרגילים</div></button>';
    }).join('');
    return '<div class="sheet" role="dialog" aria-label="התחלת אימון"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><h2>התחלת אימון</h2>' +
      '<button type="button" class="btn ghost" data-action="close">סגירה</button></div>' +
      (rows ? '<div class="list">' + rows + '</div>' : '<p class="hp-legend">אין תבניות עדיין. אפשר להתחיל אימון חופשי או לבנות תבנית.</p>') +
      '<button type="button" class="btn wide" data-action="start-live" style="margin-top:12px">אימון חופשי</button>' +
      '<button type="button" class="btn wide" data-action="new-template" style="margin-top:8px">בניית תבנית חדשה</button></div>';
  }

  function renderStartPreview() {
    const id = (ui.modal && ui.modal.props && ui.modal.props.templateId) || '';
    const tpl = Store.getTemplate(id);
    if (!tpl) return '<div class="sheet"><p>התבנית לא נמצאה</p></div>';
    const rows = (tpl.exercises || []).map(function (tex, i) {
      const name = E.normName(tex.name);
      const rec = E.recommendNextLoad ? E.recommendNextLoad(state(), name, {
        sets: Number(tex.sets) || 3,
        repsMin: tex.repsMin,
        repsMax: tex.repsMax,
        repsMode: tex.repsMode,
        bodyweight: tex.bodyweight,
        static: tex.static
      }) : null;
      const sid = tex.supersetId;
      const ssPrev = !!(sid && i > 0 && tpl.exercises[i - 1].supersetId === sid);
      const ssHead = !!(sid && !ssPrev && tpl.exercises[i + 1] && tpl.exercises[i + 1].supersetId === sid);
      return '<div class="preview-ex' + (sid && (ssHead || ssPrev) ? ' superset' : '') + '">' +
        (ssHead ? '<div class="ss-label">סופרסט</div>' : '') +
        '<div class="title">' + (i + 1) + '. ' + esc(name) + '</div>' +
        (rec ? renderLoadRecLine(rec, '') : '<p class="hp-legend">אין היסטוריה — בלי המלצה</p>') +
        '</div>';
    }).join('');
    return '<div class="sheet" role="dialog" aria-label="תצוגת אימון"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><h2>' + esc(tpl.name) + '</h2>' +
      '<button type="button" class="btn ghost" data-action="close">סגירה</button></div>' +
      '<p class="hp-legend">המלצה לכל תרגיל לפי האימון הקודם. אפשר לשנות בתוך האימון.</p>' +
      '<div class="preview-list">' + (rows || '<p class="hp-legend">אין תרגילים בתבנית.</p>') + '</div>' +
      '<button type="button" class="btn primary wide" data-action="start-template-go" data-id="' + esc(tpl.id) + '">התחלת אימון</button></div>';
  }

  function renderLevelUp() {
    const lv = (ui.modal.props || {}).level || '';
    return '<div class="dialog celebrate" role="dialog" aria-label="עליית רמה">' +
      badgeArt({ icon: '⭐' }) +
      '<div class="level-burst">' + lv + '</div>' +
      '    <h2>רמה חדשה!</h2><p>הגעתם לרמה ' + lv + '. כך ממשיכים לצבור XP.</p>' +
      '<button type="button" class="btn primary wide" data-action="close">יאללה</button></div>';
  }

  function renderUnlock() {
    const b = (ui.modal.props || {}).badge || {};
    return '<div class="dialog celebrate" role="dialog" aria-label="הישג חדש">' +
      badgeArt(b) +
      '<h2>' + esc(b.title || 'הישג חדש') + '</h2>' +
      '<p>' + esc(b.desc || '') + '</p>' +
      '<button type="button" class="btn primary wide" data-action="close">אש!</button></div>';
  }

  function renderSwapFoodSheet() {
    const foods = Store.listFoods();
    return '<div class="sheet" role="dialog" aria-label="החלפת מאכל"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><h2>החלפת מאכל להיום</h2>' +
      '<button type="button" class="btn ghost" data-action="close">סגירה</button></div>' +
      '<div class="list">' + foods.map(function (f) {
        return '<button type="button" class="list-item" data-action="pick-swap-food" data-id="' + esc(f.id) + '">' +
          '<div class="title">' + esc(f.name) + '</div>' +
          '<div class="sub">' + (f.protein || 0) + 'ג׳ · ' + (f.calories || 0) + ' קק״ל</div></button>';
      }).join('') + '</div></div>';
  }

  function renderOverlay() {
    const overlay = document.getElementById('overlay');
    if (!ui.modal) {
      overlay.hidden = true;
      overlay.innerHTML = '';
      return;
    }
    overlay.hidden = false;
    const type = ui.modal.type;
    if (type === 'workout') {
      overlay.innerHTML = renderWorkoutSheet();
      fillLastHints();
    } else if (type === 'weight') overlay.innerHTML = renderWeightSheet();
    else if (type === 'metrics') overlay.innerHTML = renderMetricsSheet();
    else if (type === 'confirm') overlay.innerHTML = renderConfirm();
    else if (type === 'badge') overlay.innerHTML = renderBadgeDialog();
    else if (type === 'food') overlay.innerHTML = renderFoodSheet();
    else if (type === 'start') overlay.innerHTML = renderStartSheet();
    else if (type === 'start-preview') overlay.innerHTML = renderStartPreview();
    else if (type === 'levelup') overlay.innerHTML = renderLevelUp();
    else if (type === 'unlock') overlay.innerHTML = renderUnlock();
    else if (type === 'swap-food') overlay.innerHTML = renderSwapFoodSheet();
    else if (type === 'whoop-detail') overlay.innerHTML = renderWhoopDetailSheet();
    else if (type === 'fit-detail') overlay.innerHTML = renderFitDetailSheet();
    else overlay.innerHTML = '';
    bindSheetDrag(overlay);
  }

  function workoutDraft() {
    return ui.modal && ui.modal.props && ui.modal.props.draft;
  }

  function renderWorkoutSheet() {
    const draft = workoutDraft();
    const isEdit = !!draft.id;
    const chips = C.WORKOUT_TYPES.map(function (t) {
      return '<button type="button" class="chip' + (draft.type === t.id ? ' active' : '') + '" data-action="draft-type" data-type="' + t.id + '">' + esc(t.label) + '</button>';
    }).join('');
    const exercises = (draft.exercises || []).map(function (ex, i) {
      const bw = isBwEx(ex, ex.name);
      return '<div class="ex-block">' +
        '<div class="ex-row">' +
        '<input type="text" data-ex="' + i + '" data-exk="name" placeholder="תרגיל" autocomplete="off" value="' + esc(ex.name || '') + '" />' +
        '<input type="number" data-ex="' + i + '" data-exk="sets" min="0" placeholder="סטים" value="' + esc(ex.sets || '') + '" />' +
        '<input type="number" data-ex="' + i + '" data-exk="' + (isStaticEx(ex, ex.name) ? 'secs' : 'reps') + '" min="0" placeholder="' + (isStaticEx(ex, ex.name) ? 'שניות' : 'חזרות') + '" value="' + esc((isStaticEx(ex, ex.name) ? (ex.secs || '') : (ex.reps || ''))) + '" />' +
        '<input type="number" data-ex="' + i + '" data-exk="weight" min="0" step="0.5" placeholder="' + (bw ? '+ ק״ג' : 'ק״ג') + '" value="' + esc(ex.weight || '') + '" />' +
        '<button type="button" class="icon-btn" data-action="remove-ex" data-index="' + i + '" aria-label="מחיקה">×</button>' +
        '</div>' +
        '<div class="builder-flags tight">' +
        '<button type="button" class="chip' + (bw ? ' active' : '') + '" data-action="toggle-sheet-bw" data-index="' + i + '">משקל גוף</button>' +
        '<button type="button" class="chip' + (isStaticEx(ex, ex.name) ? ' active' : '') + '" data-action="toggle-sheet-static" data-index="' + i + '">סטטי</button>' +
        (isStaticEx(ex, ex.name) ? staticBadge(ex, ex.name) : '') +
        (bw ? bwBadge(ex, ex.name) : '') +
        '</div>' +
        '<div class="ex-suggest" data-ex-suggest="' + i + '" hidden></div>' +
        '<div class="ex-last" data-ex-last="' + i + '"></div>' +
        '</div>';
    }).join('');
    return '<div class="sheet" role="dialog" aria-labelledby="wo-title">' +
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-head">' +
      '<button type="button" class="btn ghost" data-action="close-modal">סגירה</button>' +
      '<h2 id="wo-title">' + (isEdit ? 'עריכת אימון' : 'אימון חדש') + '</h2>' +
      '<button type="button" class="btn primary" data-action="save-workout">שמירה</button>' +
      '</div>' +
      '<label class="field"><span>תאריך</span>' +
      '<input type="date" data-draft="date" value="' + esc(draft.date) + '" /></label>' +
      '<div class="field"><span>סוג אימון / קבוצת שרירים</span><div class="chips">' + chips + '</div></div>' +
      (draft.type === 'custom' ? '<label class="field"><span>סוג מותאם אישית</span><input type="text" data-draft="customType" value="' + esc(draft.customType || '') + '" placeholder="למשל ליבה, פונקציונלי…" /></label>' : '') +
      '<div class="field"><span>תרגילים (סטים / חזרות / משקל)</span>' + exercises +
      '<button type="button" class="btn" data-action="add-ex">+ תרגיל</button></div>' +
      '<label class="field"><span>משך (דקות)</span>' +
      '<input type="number" min="0" step="1" inputmode="numeric" data-draft="duration" value="' + esc(draft.duration || '') + '" /></label>' +
      '<label class="field"><span>הערות</span>' +
      '<textarea data-draft="notes" placeholder="איך היה האימון…">' + esc(draft.notes || '') + '</textarea></label>' +
      (isEdit ? '<button type="button" class="btn danger wide" data-action="confirm-delete-workout">מחיקת אימון</button>' : '') +
      '</div>';
  }

  function renderWeightSheet() {
    const p = ui.modal.props;
    return '<div class="sheet" role="dialog" aria-labelledby="wt-title">' +
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-head">' +
      '<button type="button" class="btn ghost" data-action="close-modal">סגירה</button>' +
      '<h2 id="wt-title">תיעוד משקל</h2>' +
      '<button type="button" class="btn primary" data-action="save-weight">שמירה</button>' +
      '</div>' +
      '<label class="field"><span>תאריך</span><input type="date" id="weight-date" value="' + esc(p.date || E.todayISO()) + '" /></label>' +
      '<label class="field"><span>משקל (ק״ג)</span><input type="number" id="weight-kg" min="20" max="300" step="0.1" inputmode="decimal" value="' + esc(p.weight || '') + '" autofocus /></label>' +
      '</div>';
  }

  function renderMetricsSheet() {
    const p = ui.modal.props;
    const date = p.date || E.todayISO();
    const row = Store.getMetrics(date, 'manual') || {};
    const fields = C.METRIC_FIELDS.map(function (f) {
      const val = row[f.key] == null ? '' : row[f.key];
      return '<label class="field"><span>' + esc(f.label) + (f.unit ? ' (' + esc(f.unit) + ')' : '') + '</span>' +
        '<input type="number" data-metric="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" inputmode="decimal" value="' + esc(val) + '" /></label>';
    }).join('');
    return '<div class="sheet" role="dialog" aria-labelledby="mt-title">' +
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-head">' +
      '<button type="button" class="btn ghost" data-action="close-modal">סגירה</button>' +
      '<h2 id="mt-title">מדדי גוף</h2>' +
      '<button type="button" class="btn primary" data-action="save-metrics">שמירה</button>' +
      '</div>' +
      '<label class="field"><span>תאריך</span><input type="date" id="metrics-date" value="' + esc(date) + '" /></label>' +
      '<p class="hp-legend" style="margin-bottom:12px">מקור: הזנה ידנית. אם Whoop מחובר, המדדים מתמלאים אוטומטית.</p>' +
      '<div class="metrics-grid">' + fields + '</div>' +
      '<label class="field"><span>הערות</span><textarea id="metrics-notes" placeholder="הרגשה, איכות שינה…">' + esc(row.notes || '') + '</textarea></label>' +
      '</div>';
  }

  function renderConfirm() {
    const p = ui.modal.props;
    return '<div class="dialog" role="dialog">' +
      '<h2>' + esc(p.title || 'אישור') + '</h2>' +
      '<p>' + esc(p.message || '') + '</p>' +
      '<div class="btn-row">' +
      '<button type="button" class="btn" data-action="confirm-cancel">' + esc(p.cancelLabel || 'ביטול') + '</button>' +
      '<button type="button" class="btn ' + (p.danger ? 'danger' : 'primary') + '" data-action="confirm-ok">' + esc(p.okLabel || 'אישור') + '</button>' +
      '</div></div>';
  }

  function renderBadgeDialog() {
    const id = ui.modal.props.id;
    const s = state();
    const xp = E.computeXP(s);
    const badge = E.computeAchievements(s, xp).find(function (b) { return b.id === id; });
    if (!badge) return '';
    return '<div class="dialog" role="dialog">' +
      '<h2>' + badge.icon + ' ' + esc(badge.title) + '</h2>' +
      '<p>' + esc(badge.desc) + '</p>' +
      '<p>' + (badge.unlocked ? 'ההישג הזה כבר פתוח.' : 'עדיין לא נפתח — המשיכו לתעד כדי להשיג אותו.') + '</p>' +
      '<button type="button" class="btn primary wide" data-action="close-modal">סגור</button>' +
      '</div>';
  }

  function formatElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function renderMiniBodyMap(s) {
    const load = E.weekMuscleLoad(s);
    if (!load.maxSets) return '';
    const neglected = (load.neglected || []).slice(0, 4).map(function (m) { return m.label; });
    return '<section class="card body-card">' +
      '<div class="section-title" style="margin-top:0"><h2>מפת גוף השבוע</h2>' +
      '<button type="button" class="linkish" data-action="tab" data-tab="progress">פירוט</button></div>' +
      root.FitBodyMap.render(load, { mini: true }) +
      (neglected.length ? '<p class="hp-legend">הוזנחו: ' + esc(neglected.join(' · ')) + '</p>' : '<p class="hp-legend">כיסוי טוב השבוע.</p>') +
      '</section>';
  }

  function renderBodyMapCard(s, mini) {
    const load = E.weekMuscleLoad(s);
    const neglected = load.neglected || [];
    const range = esc(E.formatDay(load.weekStart)) + ' – ' + esc(E.formatDay(load.weekEnd));
    const list = neglected.length
      ? '<ul class="neglected-list">' + neglected.map(function (m) {
          return '<li>' + esc(m.label) + (m.sets ? ' · ' + (Math.round(m.sets * 10) / 10) + ' סטים' : ' · אין סטים') + '</li>';
        }).join('') + '</ul>'
      : (load.maxSets ? '<p class="hp-legend">אין שרירים מוזנחים במיוחד השבוע.</p>' : '<p class="hp-legend">עדיין אין אימונים השבוע — המפה תתמלא אחרי האימון הבא.</p>');
    return '<section class="card body-card"><h2>מפת גוף שבועית</h2>' +
      '<p class="hp-legend">' + range + ' · צבע חזק = יותר נפח. משני מקבלים חצי משקל.</p>' +
      root.FitBodyMap.render(load, { mini: !!mini }) +
      '<h3 class="subhead">שרירים שהוזנחו</h3>' + list +
      '</section>';
  }

  function renderFoodsStrip(date) {
    const foods = Store.listFoods().slice(0, 4);
    if (!foods.length) return '';
    return '<section class="card"><div class="section-title" style="margin-top:0"><h2>מאכלים קבועים</h2>' +
      '<button type="button" class="linkish" data-action="tab" data-tab="nutrition">הכל</button></div>' +
      '<div class="food-chips">' + foods.map(function (f) {
        return '<button type="button" class="chip food-chip" data-action="use-food" data-id="' + esc(f.id) + '" data-date="' + date + '">' +
          esc(f.name) + ' <span>' + f.protein + 'ג׳</span></button>';
      }).join('') + '</div></section>';
  }

  function renderFoodsLibrary(date) {
    const foods = Store.listFoods();
    const q = String(ui.foodQuery || '').trim();
    const filtered = q
      ? foods.filter(function (f) { return String(f.name || '').indexOf(q) >= 0; })
      : foods;
    const rows = filtered.map(function (f) {
      const bits = [f.protein + 'ג׳ חלבון', f.calories + ' קק״ל'];
      if (f.carbs !== '' && f.carbs != null) bits.push(f.carbs + ' פחמ׳');
      if (f.fat !== '' && f.fat != null) bits.push(f.fat + ' שומן');
      return '<div class="food-row">' +
        '<button type="button" class="btn primary food-add" data-action="use-food" data-id="' + esc(f.id) + '" data-date="' + date + '">+ ' + esc(f.name) + '</button>' +
        '<div class="food-meta"><span>' + esc(bits.join(' · ')) + '</span>' +
        (f.uses ? '<span class="kicker">' + f.uses + ' פעמים</span>' : '') + '</div>' +
        '<div class="food-actions">' +
        '<button type="button" class="linkish" data-action="edit-food" data-id="' + esc(f.id) + '">עריכה</button>' +
        '<button type="button" class="linkish" data-action="delete-food" data-id="' + esc(f.id) + '">מחיקה</button>' +
        '</div></div>';
    }).join('');
    return '<section class="card"><div class="section-title" style="margin-top:0"><h2>ספריית מאכלים</h2>' +
      '<button type="button" class="linkish" data-action="edit-food" data-id="">+ מאכל</button></div>' +
      '<p class="hp-legend">לחיצה מוסיפה את הערכים ליום הנבחר. הפריטים השכיחים מופיעים ראשונים.</p>' +
      (foods.length ? '<label class="field"><span>חיפוש</span><input type="search" id="food-query" value="' + esc(ui.foodQuery || '') + '" placeholder="שם המאכל" autocomplete="off" /></label>' : '') +
      (rows || (foods.length ? '<p class="kicker">אין מאכלים שמתאימים לחיפוש.</p>' : '<p class="kicker">הספרייה ריקה.</p>')) +
      '</section>';
  }

  function renderFoodSheet() {
    const p = ui.modal.props || {};
    const f = p.food || { name: '', protein: '', calories: '', carbs: '', fat: '' };
    return '<div class="sheet" role="dialog"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><button type="button" class="btn ghost" data-action="close-modal">סגירה</button>' +
      '<h2>' + (f.id ? 'עריכת מאכל' : 'מאכל חדש') + '</h2>' +
      '<button type="button" class="btn primary" data-action="save-food">שמירה</button></div>' +
      '<label class="field"><span>שם</span><input type="text" id="food-name" value="' + esc(f.name || '') + '" /></label>' +
      '<label class="field"><span>חלבון (גרם)</span><input type="number" id="food-protein" min="0" step="0.5" value="' + esc(f.protein == null ? '' : f.protein) + '" /></label>' +
      '<label class="field"><span>קלוריות</span><input type="number" id="food-calories" min="0" step="1" value="' + esc(f.calories == null ? '' : f.calories) + '" /></label>' +
      '<label class="field"><span>פחמימות (אופציונלי)</span><input type="number" id="food-carbs" min="0" step="0.5" value="' + esc(f.carbs == null || f.carbs === '' ? '' : f.carbs) + '" /></label>' +
      '<label class="field"><span>שומן (אופציונלי)</span><input type="number" id="food-fat" min="0" step="0.5" value="' + esc(f.fat == null || f.fat === '' ? '' : f.fat) + '" /></label>' +
      '</div>';
  }

  function renderLive() {
    const L = root.FitLive;
    const sess = L.getSession();
    if (!sess) return '';
    const ex = L.currentExercise();
    const restOn = !!(L.isRestRunning && L.isRestRunning());
    const restElapsed = restOn && L.restElapsedSec ? L.restElapsedSec() : 0;
    const restTarget = restOn && L.restTargetSec ? L.restTargetSec() : 0;
    const pr = L.prForDraft();
    const prog = L.progress ? L.progress() : { current: sess.currentEx + 1, total: sess.exercises.length };
    const nxt = L.nextExercise ? L.nextExercise() : sess.exercises[sess.currentEx + 1];
    const lastSets = ex ? E.lastSessionSets(state(), ex.name, null) : [];
    const lastHtml = lastSets.length
      ? '<div class="last-sets"><div class="label">פעם קודמת</div><div class="set-pills">' +
        lastSets.map(function (s, i) {
          return '<span class="set-pill">סט ' + (i + 1) + ': ' + setShort(s, ex) + '</span>';
        }).join('') + '</div></div>'
      : '<p class="hp-legend">אין היסטוריה לתרגיל הזה עדיין.</p>';
    const restClock = L.formatHoldClock ? L.formatHoldClock(restElapsed) : formatSecs(restElapsed);
    const restBar = restOn
      ? '<div class="rest-banner rest-up' + (restTarget && restElapsed >= restTarget ? ' over-target' : '') + '" id="rest-banner">' +
        '<div class="rest-meta"><div class="rest-label">מנוחה</div>' +
        '<div class="rest-sub" id="rest-sub">' + (restTarget ? ('יעד ' + formatSecs(restTarget)) : 'נספר עד הסט הבא') + '</div></div>' +
        '<div class="rest-count" id="rest-count">' + restClock + '</div>' +
        '<button type="button" class="btn" data-action="skip-rest">עצירה</button></div>'
      : '';
    const chips = C.WORKOUT_TYPES.map(function (tp) {
      return '<button type="button" class="chip' + (sess.type === tp.id ? ' active' : '') + '" data-action="live-type" data-type="' + tp.id + '">' + esc(tp.label) + '</button>';
    }).join('');
    let exList = '';
    sess.exercises.forEach(function (item, i) {
      const done = item.sets.length;
      const target = Number(item.targetSets) || 0;
      const sets = item.sets.map(function (s, si) {
        return 'סט ' + (si + 1) + ' ' + setShort(s, item) + (s.pr ? ' ⭐' : '');
      }).join(' · ') || 'אין סטים עדיין';
      const sid = item.supersetId;
      const ssPrev = !!(sid && i > 0 && sess.exercises[i - 1].supersetId === sid);
      const ssNext = !!(sid && i + 1 < sess.exercises.length && sess.exercises[i + 1].supersetId === sid);
      const ssHead = !!(sid && !ssPrev && ssNext);
      if (ssHead) exList += '<div class="ss-group"><div class="ss-label">סופרסט</div>';
      exList += '<button type="button" class="list-item' + (i === sess.currentEx ? ' on' : '') + (ssHead || ssPrev ? ' ss' : '') + '" data-action="live-select-ex" data-index="' + i + '">' +
        '<div class="title">' + (i + 1) + '. ' + esc(item.name) + ' ' + staticBadge(item, item.name) + ' ' + maxBadge(item) + ' ' + bwBadge(item, item.name) + (target ? ' · ' + done + '/' + target : '') + '</div>' +
        '<div class="sub">' + esc(sets) + '</div></button>';
      if ((ssHead || ssPrev) && !ssNext) exList += '</div>';
    });
    const suggest = ex ? (ex.suggestReason || '') : '';
    const isSt = ex && isStaticEx(ex, ex.name);
    const hold = L.holdState ? L.holdState() : null;
    const planned = ex && ex.targetSets
      ? '<p class="planned">מתוכנן: ' + ex.targetSets + ' סטים × ' + repsTargetLabel(ex) +
        ' · ' + loadLabel(ex.targetWeight, isBwEx(ex, ex.name)) + '</p>'
      : '';
    const liveRec = (ex && root.FitLive && root.FitLive.loadRecommendation)
      ? root.FitLive.loadRecommendation(ex.name, root.FitLive.recOptsFromExercise(ex))
      : null;
    const recHtml = liveRec ? renderLoadRecLine(liveRec, 'apply-load-rec') : '';
    const maxHint = ex && isSt
      ? '<p class="max-hint">' + (isMaxReps(ex) ? 'הפעילו את הטיימר והחזיקו עד כשל' : 'הפעילו את הטיימר או הזינו שניות ידנית') +
        (ex.bestHold ? ' · שיא קודם: <strong>' + formatSecs(ex.bestHold) + '</strong>' : '') +
        '</p>'
      : (ex && isMaxReps(ex)
      ? '<p class="max-hint">הזינו כמה חזרות יצאו בפועל' +
        (ex.bestMaxReps ? ' · שיא MAX קודם: <strong>' + ex.bestMaxReps + '</strong> חזרות' : '') +
        '</p>'
      : '');
    const holdBanner = (ex && isSt && hold)
      ? '<div class="rest-banner hold-banner' + (hold.overtime ? ' overtime' : '') + (hold.phase === 'ready' ? ' ready' : '') + '" id="hold-banner">' +
        '<div class="rest-label">' + (hold.phase === 'ready' ? 'התכוננו' : (hold.overtime ? 'מעבר ליעד' : (hold.isMax ? 'החזקה' : 'נשארו'))) + '</div>' +
        '<div class="rest-ring-wrap"><div class="rest-count hold-count" id="hold-count">' + esc(hold.display) + '</div></div>' +
        '<div class="kicker" id="hold-sub">' + (hold.phase === 'ready' ? 'מתחילים בעוד רגע' : (hold.isMax ? 'ספירה קדימה עד שתעצרו' : (hold.overtime ? 'המשיכו או עצרו כדי לרשום' : 'יעד ' + formatSecs(hold.target)))) + '</div>' +
        '<button type="button" class="btn primary wide" data-action="live-hold-stop">' + (hold.phase === 'ready' ? 'ביטול' : 'עצור ושמור') + '</button></div>'
      : '';
    const setList = ex ? '<ul class="set-list">' +
      (ex.sets.map(function (s, i) {
        const restVal = (s.restAfter != null && s.restAfter !== '') ? String(s.restAfter) : '';
        const restEdit = restVal === '' ? '' : (
          '<label class="set-rest">מנוחה <input type="number" min="0" step="5" inputmode="numeric" data-set-rest="1" data-ex="' +
          sess.currentEx + '" data-set="' + i + '" value="' + esc(restVal) + '" /> שנ׳</label>'
        );
        return '<li class="done"><span>סט ' + (i + 1) + '</span><span>' + setShort(s, ex) + (s.pr ? ' ⭐' : '') + restEdit + '</span></li>';
      }).join('')) +
      '<li class="current"><span>סט ' + (ex.sets.length + 1) + '</span><span>עכשיו</span></li>' +
      (ex.targetSets ? Array.from({ length: Math.max(0, ex.targetSets - ex.sets.length - 1) }).map(function (_, i) {
        return '<li class="todo"><span>סט ' + (ex.sets.length + 2 + i) + '</span><span>מתוכנן</span></li>';
      }).join('') : '') +
      '</ul>' : '';

    return '<header class="live-head">' +
      '<button type="button" class="btn ghost" data-action="cancel-live">יציאה</button>' +
      '<div class="live-clock"><div class="kicker">' + (sess.templateName ? esc(sess.templateName) : 'זמן אימון') + '</div>' +
      '<div id="elapsed-clock" class="clock">' + formatElapsed(L.elapsedMs()) + '</div></div>' +
      '<button type="button" class="btn primary" data-action="finish-live">סיום</button>' +
      '</header>' +
      (prog.total ? '<div class="live-progress"><span>תרגיל ' + ltr(prog.current + ' / ' + prog.total) + '</span>' +
        '<div class="bar"><i style="width:' + Math.round((prog.current / prog.total) * 100) + '%"></i></div></div>' : '') +
      (nxt ? '<div class="next-up">הבא בתור: <strong>' + esc(nxt.name) + '</strong></div>' : '') +
      '<details class="live-type"' + (sess.templateId ? '' : ' open') + '><summary>סוג אימון</summary><div class="chips">' + chips + '</div></details>' +
      restBar +
      (ex
        ? ('<section class="card live-ex"><h1>' + esc(ex.name) + ' ' + staticBadge(ex, ex.name) + ' ' + maxBadge(ex) + ' ' + bwBadge(ex, ex.name) + '</h1>' +
          (function () {
            const group = L.supersetGroup ? L.supersetGroup(sess.currentEx) : [];
            if (group.length < 2) return '';
            const names = group.map(function (idx) { return esc(sess.exercises[idx].name); }).join(' + ');
            return '<p class="ss-now">סופרסט · ' + names + '</p>';
          }()) + planned + recHtml + maxHint + holdBanner +
          lastHtml +
          (ex.notes ? '<p class="hp-legend">' + esc(ex.notes) + '</p>' : '') +
          (suggest && !(isMaxReps(ex) && /שיא MAX/.test(suggest)) ? '<p class="suggest-reason">' + esc(suggest) + '</p>' : '') +
          (pr.isPR ? '<div class="live-pr">⭐ שיא חדש בסט הזה! ' + prTags(pr.types) + '</div>' : '') +
          setList +
          '<div class="step-grid">' +
          '<div class="step-col"><div class="label">' + (isBwEx(ex, ex.name) ? 'תוספת (ק״ג)' : 'משקל (ק״ג)') + '</div>' +
          '<div class="big-stepper">' +
          '<button type="button" class="step-btn" data-action="live-step" data-field="weight" data-delta="-2.5">−2.5</button>' +
          '<button type="button" class="step-btn sm" data-action="live-step" data-field="weight" data-delta="-1.25">−1.25</button>' +
          '<div class="step-val" id="live-weight">' + sess.draft.weight + '</div>' +
          '<button type="button" class="step-btn sm" data-action="live-step" data-field="weight" data-delta="1.25">+1.25</button>' +
          '<button type="button" class="step-btn" data-action="live-step" data-field="weight" data-delta="2.5">+2.5</button>' +
          '</div>' + (isBwEx(ex, ex.name) ? '<p class="hp-legend" style="text-align:center;margin-top:6px">0 = בלי תוספת, רק משקל גוף</p>' : '') + '</div>' +
          (isSt
            ? ('<div class="step-col"><div class="label">' + (isMaxReps(ex) ? 'שניות שהוחזקו' : 'זמן (שנ׳)') + '</div>' +
              '<div class="big-stepper">' +
              '<button type="button" class="step-btn" data-action="live-step" data-field="secs" data-delta="-5">−5</button>' +
              '<div class="step-val" id="live-secs">' + (sess.draft.secs || 0) + '</div>' +
              '<button type="button" class="step-btn" data-action="live-step" data-field="secs" data-delta="5">+5</button>' +
              '</div></div>')
            : ('<div class="step-col"><div class="label">' + (isMaxReps(ex) ? 'חזרות שהושלמו' : 'חזרות') + '</div>' +
              '<div class="big-stepper">' +
              '<button type="button" class="step-btn" data-action="live-step" data-field="reps" data-delta="-1">−</button>' +
              '<div class="step-val" id="live-reps">' + sess.draft.reps + '</div>' +
              '<button type="button" class="step-btn" data-action="live-step" data-field="reps" data-delta="1">+</button>' +
              '</div></div>')) +
          '</div>' +
          (isSt && !hold ? '<button type="button" class="btn primary wide live-log live-hold-start" data-action="live-hold-start">התחל טיימר</button>' : '') +
          (hold ? '' : '<button type="button" class="btn' + (isSt ? '' : ' primary') + ' wide live-log" data-action="live-log">' + (isSt ? 'רשום בלי טיימר · סט ' : 'רשום סט ') + (ex.sets.length + 1) + '</button>') +
          '<div class="live-actions">' +
          (ex.sets.length ? '<button type="button" class="btn" data-action="live-undo">בטל סט</button>' : '') +
          (nxt ? '<button type="button" class="btn" data-action="live-skip">דלג לתרגיל הבא</button>' : '') +
          '</div></section>')
        : '<section class="card"><p>הוסיפו תרגיל כדי להתחיל לתעד סטים.</p></section>') +
      '<section class="card"><h2>הוסף תרגיל</h2>' +
      '<div class="live-add"><input type="text" id="live-ex-name" placeholder="שם התרגיל" autocomplete="off" />' +
      '<button type="button" class="btn primary" data-action="live-add-ex">הוספה</button></div>' +
      '<div id="live-ex-suggest" class="ex-suggest" hidden></div></section>' +
      (exList ? '<div class="section-title"><h2>האימון הזה</h2></div><div class="list">' + exList + '</div>' : '');
  }

  function renderLiveSummary() {
    const sum = ui.liveSummary;
    if (!sum) return '';
    const prs = (sum.prs || []).map(function (p) {
      return '<li>' + esc(p.name) + ' · ' + (p.secs ? formatSecs(p.secs) : (p.weight + '×' + p.reps)) + ' ' + prTags(p.types) + '</li>';
    }).join('');
    return '<header class="page-head"><h1>אימון הושלם 💪</h1></header>' +
      '<section class="card">' +
      '<div class="stats-grid">' +
      '<div class="metric-pill"><div class="label">זמן</div><div class="value">' + sum.durationMin + ' <span class="unit">דק׳</span></div></div>' +
      '<div class="metric-pill"><div class="label">נפח</div><div class="value">' + ltr(String(Math.round(sum.volume))) + '</div></div>' +
      '<div class="metric-pill"><div class="label">שיאים</div><div class="value">' + (sum.prs || []).length + '</div></div>' +
      '<div class="metric-pill"><div class="label">תרגילים</div><div class="value">' + ((sum.exercises || []).length) + '</div></div>' +
      '</div>' +
      (prs ? '<h2>שיאים שנשברו</h2><ul class="neglected-list">' + prs + '</ul>' : '<p class="hp-legend">אין שיאים חדשים הפעם, אבל כל אימון נספר.</p>') +
      (sum.templateChanged && sum.templateId ? '<button type="button" class="btn primary wide" data-action="update-template-from-live">עדכון התבנית ' + esc(sum.templateName || '') + '</button>' : '') +'<button type="button" class="btn' + (sum.templateChanged && sum.templateId ? '' : ' primary') + ' wide" data-action="close-summary">למסך הבית</button>' +
      '</section>';
  }

  function liveBanner() {
    const L = root.FitLive;
    if (!L.getSession() || ui.tab === 'live' || ui.liveSummary) return '';
    return '<div class="banner demo-banner"><p>יש אימון חי פתוח.</p>' +
      '<button type="button" class="btn tiny primary" data-action="resume-live">חזרה לאימון</button></div>';
  }

  /* ---------- top-level render ---------- */

  function render() {
    const main = document.getElementById('main');
    if (!main) return;
    const liveOn = !!(root.FitLive && root.FitLive.getSession()) && ui.tab === 'live' && !ui.liveSummary;
    let html = demoBanner() + liveBanner();
    if (ui.liveSummary) html += renderLiveSummary();
    else if (liveOn) html += renderLive();
    else if (ui.editingTemplate) html += renderTemplateEditor();
    else if (ui.editingMenu) html += renderMenuEditor();
    else if (ui.view === 'summary') html += renderSummary();
    else if (ui.view === 'body') html += renderBody();
    else if (ui.exerciseName) html += renderExerciseDetail();
    else if (ui.tab === 'home') html += renderHome();
    else if (ui.tab === 'workouts') html += renderWorkouts();
    else if (ui.tab === 'nutrition') html += renderNutrition();
    else if (ui.tab === 'progress') html += renderProgress();
    else if (ui.tab === 'settings') html += renderSettings();
    main.innerHTML = html;
    document.body.classList.toggle('is-demo', Store.isDemoMode());
    document.body.classList.toggle('is-live', liveOn);
    document.body.classList.toggle('is-builder', !!(ui.editingTemplate || ui.editingMenu));
    paintSummaryPreview();

    document.querySelectorAll('.tab').forEach(function (btn) {
      const activeTab = liveOn ? 'workouts' : (ui.exerciseName ? 'progress' : ui.tab);
      btn.classList.toggle('active', btn.getAttribute('data-tab') === activeTab);
    });
    renderOverlay();
  }

  function setTab(tab) {
    if (C && ['home', 'workouts', 'nutrition', 'progress', 'settings'].indexOf(tab) === -1) tab = 'home';
    ui.tab = tab;
    ui.modal = null;
    ui.exerciseName = null;
    ui.editingTemplate = null;
    ui.editingMenu = null;
    if (tab !== 'live') { /* keep session */ }
    if (tab === 'nutrition' && !ui.nutritionDate) ui.nutritionDate = E.todayISO();
    try { location.hash = '#/' + tab; } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }

  function openLive() {
    const L = root.FitLive;
    if (!L.getSession()) L.start();
    L.startClocks();
    L.requestWakeLock();
    ui.tab = 'live';
    ui.exerciseName = null;
    ui.liveSummary = null;
    try { location.hash = '#/live'; } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }

  function openExercise(name, back) {
    const n = E.normName(name);
    if (!n) return;
    ui.exerciseName = n;
    ui.exerciseBack = back || ui.tab || 'progress';
    ui.modal = null;
    try { location.hash = '#/exercise/' + encodeURIComponent(n); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }

  function closeExercise() {
    const back = ui.exerciseBack || 'progress';
    ui.exerciseName = null;
    setTab(back);
  }

  function fillLastHints() {
    const draft = workoutDraft();
    if (!draft) return;
    (draft.exercises || []).forEach(function (ex, i) {
      if (!ex.name) return;
      renderLastHint(i, ex.name);
    });
  }

  function renderLastHint(i, name) {
    const lastEl = document.querySelector('[data-ex-last="' + i + '"]');
    if (!lastEl) return;
    const draft = workoutDraft();
    const last = E.lastPerformance(state(), name, draft && draft.date, draft && draft.id);
    if (!last) { lastEl.innerHTML = ''; return; }
    const e = last.last;
    const bits = [];
    if (e.sets || e.reps) bits.push((e.sets || '?') + '×' + (e.reps || '?'));
    if (e.weight) bits.push(e.weight + ' ק״ג');
    lastEl.innerHTML = '<span>פעם קודמת (' + esc(E.formatDay(last.date)) + '): ' + esc(bits.join(' · ')) + '</span>' +
      '<button type="button" class="linkish" data-action="copy-last" data-index="' + i + '" data-name="' + esc(name) + '">העתק</button>';
  }

  function updateExAutocomplete(input) {
    const i = Number(input.dataset.ex);
    const q = String(input.value || '').trim();
    const box = document.querySelector('[data-ex-suggest="' + i + '"]');
    if (box) {
      const names = E.exerciseNames(state());
      const matches = (q ? names.filter(function (n) { return n !== q && n.indexOf(q) !== -1; }) : names).slice(0, 6);
      if (!matches.length) {
        box.hidden = true;
        box.innerHTML = '';
      } else {
        box.hidden = false;
        box.innerHTML = matches.map(function (n) {
          return '<button type="button" class="suggest-item" data-action="pick-ex" data-index="' + i + '" data-name="' + esc(n) + '">' + esc(n) + '</button>';
        }).join('');
      }
    }
    renderLastHint(i, q);
  }

  function updateLiveExSuggest(input) {
    const box = document.getElementById('live-ex-suggest');
    if (!box) return;
    const q = String(input.value || '').trim();
    const names = E.exerciseNames(state());
    const matches = (q ? names.filter(function (n) { return n.indexOf(q) !== -1; }) : names).slice(0, 8);
    if (!matches.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = matches.map(function (n) {
      return '<button type="button" class="suggest-item" data-action="live-pick-ex" data-name="' + esc(n) + '">' + esc(n) + '</button>';
    }).join('');
  }

  function applyLast(i, name, force) {
    const draft = workoutDraft();
    if (!draft) return;
    collectWorkoutDraftFromDom();
    const last = E.lastPerformance(state(), name, draft.date, draft.id);
    if (!draft.exercises[i]) draft.exercises[i] = { name: '', sets: '', reps: '', weight: '' };
    draft.exercises[i].name = name;
    if (draft.exercises[i].bodyweight == null) {
      draft.exercises[i].bodyweight = !!(last && last.last && last.last.bodyweight) || !!(E.isBodyweightName && E.isBodyweightName(name));
    }
    if (last) {
      const e = last.last;
      if (force || !draft.exercises[i].sets) draft.exercises[i].sets = e.sets;
      if (force || !draft.exercises[i].reps) draft.exercises[i].reps = e.reps;
      if (force || !draft.exercises[i].weight) draft.exercises[i].weight = e.weight;
      if (e.bodyweight != null && draft.exercises[i].bodyweight == null) draft.exercises[i].bodyweight = !!e.bodyweight;
    }
    renderOverlay();
  }

  function syncDraftFromInput(input) {
    const draft = workoutDraft();
    if (!draft) return;
    if (input.dataset.draft) {
      draft[input.dataset.draft] = input.value;
    }
    if (input.dataset.ex != null) {
      const i = Number(input.dataset.ex);
      if (!draft.exercises[i]) draft.exercises[i] = { name: '', sets: '', reps: '', weight: '' };
      draft.exercises[i][input.dataset.exk] = input.value;
    }
  }

  function collectWorkoutDraftFromDom() {
    const draft = workoutDraft();
    if (!draft) return;
    document.querySelectorAll('#overlay [data-draft]').forEach(function (el) {
      draft[el.dataset.draft] = el.value;
    });
    document.querySelectorAll('#overlay [data-ex]').forEach(function (el) {
      const i = Number(el.dataset.ex);
      if (!draft.exercises[i]) draft.exercises[i] = { name: '', sets: '', reps: '', weight: '' };
      draft.exercises[i][el.dataset.exk] = el.value;
    });
  }

  function saveWorkout() {
    collectWorkoutDraftFromDom();
    const d = workoutDraft();
    if (!d || !d.date) { toast('יש לבחור תאריך'); return; }
    const exercises = (d.exercises || []).filter(function (e) {
      return e && (e.name || e.sets || e.reps || e.weight || e.secs);
    });
    const payload = {
      date: d.date,
      type: d.type || 'full',
      customType: d.customType || '',
      exercises: exercises,
      duration: d.duration === '' ? '' : Number(d.duration),
      notes: d.notes || ''
    };
    if (d.id) Store.updateWorkout(d.id, payload);
    else Store.addWorkout(payload);
    closeModal();
    toast('האימון נשמר');
  }

  function saveWeight() {
    const dateEl = document.getElementById('weight-date');
    const kgEl = document.getElementById('weight-kg');
    const date = dateEl ? dateEl.value : E.todayISO();
    const kg = kgEl ? kgEl.value : '';
    if (!Store.upsertWeight(date, kg)) {
      toast('יש להזין משקל תקין');
      return;
    }
    closeModal();
    toast('המשקל נשמר');
  }

  function saveMetrics() {
    const dateEl = document.getElementById('metrics-date');
    const date = dateEl ? dateEl.value : (ui.modal.props.date || E.todayISO());
    const patch = { notes: (document.getElementById('metrics-notes') || {}).value || '' };
    document.querySelectorAll('#overlay [data-metric]').forEach(function (el) {
      const raw = el.value;
      patch[el.dataset.metric] = raw === '' ? null : Number(raw);
    });
    Store.upsertMetrics(date, patch, 'manual');
    closeModal();
    toast('המדדים נשמרו');
  }

  function bump(date, field, delta) {
    const row = Store.getNutrition(date) || { protein: 0, calories: 0, water: 0 };
    const next = Math.max(0, (Number(row[field]) || 0) + Number(delta));
    const patch = {};
    patch[field] = next;
    Store.upsertNutrition(date, patch);
  }

  function downloadPayload(payload, suffix) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (Store.isDemoMode() ? 'fit-tracker-demo-' : 'fit-tracker-backup-') + E.todayISO() + (suffix || '') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    toast('הקובץ ירד');
  }

  function exportData() {
    const payload = Store.exportJSON();
    if (!window.FitPhotos) { downloadPayload(payload); return; }
    FitPhotos.listPhotos().then(function (rows) {
      if (!rows || !rows.length) { downloadPayload(payload); return; }
      openModal('confirm', {
        title: 'ייצוא גיבוי',
        message: 'כלול גם תמונות התקדמות? הקובץ יהיה גדול יותר. אפשר גם לייצא בלי תמונות.',
        okLabel: 'כולל תמונות',
        cancelLabel: 'בלי תמונות',
        onOk: function () {
          toast('מכין גיבוי עם תמונות…');
          FitPhotos.exportPhotos().then(function (photos) {
            payload.photos = photos;
            closeModal();
            downloadPayload(payload, '-photos');
          }).catch(function () { closeModal(); toast('ייצוא התמונות נכשל'); });
        },
        onCancel: function () { closeModal(); downloadPayload(payload); }
      });
    }).catch(function () { downloadPayload(payload); });
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const payload = JSON.parse(String(reader.result));
        Store.importJSON(payload);
        const photos = payload.photos;
        const finish = function (extra) {
          closeModal();
          if (window.FitPhotos) FitPhotos.close();
          loadPhotos(true);
          toast(extra || 'הנתונים יובאו');
        };
        if (photos && photos.length && window.FitPhotos) {
          FitPhotos.importPhotos(photos).then(function (n) {
            finish(n ? ('הנתונים יובאו, כולל ' + n + ' תמונות') : 'הנתונים יובאו');
          }).catch(function () { finish('הנתונים יובאו, אבל ייבוא התמונות נכשל'); });
        } else {
          finish();
        }
      } catch (err) {
        toast('קובץ לא תקין');
      }
    };
    reader.readAsText(file);
  }


  function syncTex(el) {
    if (!ui.editingTemplate) return;
    const i = Number(el.dataset.tex);
    const ex = ui.editingTemplate.exercises[i];
    if (!ex) return;
    const k = el.dataset.texk;
    if (k === 'quick' || k === 'repsRange' || k === 'secsRange') return;
    const num = ['sets', 'weight', 'restSec'].indexOf(k) >= 0;
    ex[k] = num ? (el.value === '' ? '' : Number(el.value)) : el.value;
  }

  function setQuickHint(i, error) {
    const hint = document.querySelector('[data-quick-hint="' + i + '"]');
    if (!hint) return;
    hint.classList.toggle('err', !!error);
    const ex = ui.editingTemplate && ui.editingTemplate.exercises[i];
    const st = ex && isStaticEx(ex, ex.name);
    hint.textContent = error
      ? (st ? 'לא הצלחתי לקרוא. נסו 3x45s, 3*45 או 3x1:00' : 'לא הצלחתי לקרוא. נסו 3*8-12*50 או 3x8-12x50')
      : (st ? 'סטים × זמן × תוספת, למשל 3x45s, 3*45 או 3x1:00x10' : 'סטים × טווח חזרות × משקל, למשל 3*8-12*50 או 3x8-12');
  }

  function refreshTexFields(i, except) {
    const ex = ui.editingTemplate && ui.editingTemplate.exercises[i];
    const card = document.querySelector('.builder-ex[data-ex-index="' + i + '"]');
    if (!ex || !card) return;
    const sets = card.querySelector('[data-texk="sets"]');
    const reps = card.querySelector('[data-texk="repsRange"]');
    const secs = card.querySelector('[data-texk="secsRange"]');
    const weight = card.querySelector('[data-texk="weight"]');
    const quick = card.querySelector('[data-texk="quick"]');
    const maxChip = card.querySelector('[data-action="toggle-tex-max"]');
    if (sets && except !== 'sets') sets.value = ex.sets == null || ex.sets === '' ? '' : ex.sets;
    if (reps && except !== 'repsRange') reps.value = P.formatRepsRange(ex);
    if (secs && except !== 'secsRange') secs.value = P.formatDurationRange ? P.formatDurationRange(ex) : '';
    if (weight && except !== 'weight') weight.value = ex.weight === 0 ? 0 : (ex.weight || '');
    if (quick && except !== 'quick') quick.value = P.formatQuick(ex);
    if (maxChip) maxChip.classList.toggle('active', isMaxReps(ex));
    if (except !== 'quick') setQuickHint(i, false);
    ex._quickError = false;
  }

  function onTexInput(el) {
    if (!ui.editingTemplate) return;
    const i = Number(el.dataset.tex);
    const ex = ui.editingTemplate.exercises[i];
    if (!ex) return;
    const k = el.dataset.texk;
    if (k === 'quick') {
      const parsed = P.parseQuick(el.value, { static: isStaticEx(ex, ex.name) });
      if (parsed.empty) {
        ex._quickError = false;
        setQuickHint(i, false);
        return;
      }
      if (!parsed.ok) {
        ex._quickError = true;
        setQuickHint(i, true);
        return;
      }
      ex._quickError = false;
      P.applyParsed(ex, parsed);
      if (parsed.static) ex.static = true;
      if (parsed.static === false) { /* keep existing unless user typped a reps shorthand */ if (parsed.repsMin) ex.static = false; }
      if (parsed.static) {
        /* field layout changes when becoming static — full re-render is clearer */
        render();
        return;
      }
      refreshTexFields(i, 'quick');
      return;
    }
    if (k === 'repsRange') {
      const parsed = P.parseRepsRange(el.value);
      if (parsed.empty) return;
      if (!parsed.ok) return;
      P.applyParsed(ex, parsed);
      refreshTexFields(i, 'repsRange');
      return;
    }
    if (k === 'secsRange') {
      const parsed = P.parseDuration(el.value, true);
      if (parsed.empty) return;
      if (!parsed.ok) return;
      if (parsed.max) ex.repsMode = 'max';
      else {
        if (ex.repsMode === 'max') ex.repsMode = 'range';
        ex.secsMin = parsed.secsMin;
        ex.secsMax = parsed.secsMax;
        ex.secs = parsed.secs;
      }
      refreshTexFields(i, 'secsRange');
      return;
    }
    syncTex(el);
    if (k === 'name' && E.isStaticName && E.isStaticName(ex.name) && !ex.static) {
      ex.static = true;
      ex.bodyweight = true;
      if (!ex.secsMin) ex.secsMin = 45;
      if (!ex.secsMax) ex.secsMax = ex.secsMin || 45;
      render();
      return;
    }
    if (k === 'sets' || k === 'weight') refreshTexFields(i, k);
  }

  function collectTemplateDraft() {
    if (!ui.editingTemplate) return;
    const name = document.getElementById('tpl-name');
    if (name) ui.editingTemplate.name = name.value;
    document.querySelectorAll('[data-tex]').forEach(function (el) {
      const i = Number(el.dataset.tex);
      const ex = ui.editingTemplate.exercises[i];
      if (!ex) return;
      const k = el.dataset.texk;
      if (k === 'quick') {
        const parsed = P.parseQuick(el.value);
        if (parsed.ok) {
          P.applyParsed(ex, parsed);
          ex._quickError = false;
        }
        return;
      }
      if (k === 'repsRange') {
        const parsed = P.parseRepsRange(el.value);
        if (parsed.ok) P.applyParsed(ex, parsed);
        return;
      }
      syncTex(el);
    });
  }
  function syncMeal(el) {
    if (!ui.editingMenu) return;
    const i = Number(el.dataset.meal);
    if (!ui.editingMenu.meals[i]) return;
    ui.editingMenu.meals[i][el.dataset.mealk] = el.value;
  }
  function collectMenuDraft() {
    if (!ui.editingMenu) return;
    const name = document.getElementById('menu-name');
    if (name) ui.editingMenu.name = name.value;
    document.querySelectorAll('[data-meal]').forEach(syncMeal);
  }

  function authFieldValues() {
    const emailEl = document.getElementById('sync-email');
    const passEl = document.getElementById('sync-password');
    return {
      email: ((emailEl && emailEl.value) || '').trim().toLowerCase(),
      password: ((passEl && passEl.value) || '').trim()
    };
  }

  function runPasswordAuth(mode) {
    function go() {
      const v = authFieldValues();
      if (!v.email || !v.password) { toast('יש להזין אימייל וסיסמה'); return; }
      if (!window.FitSync) { toast('ההתחברות נכשלה'); return; }
      const fn = mode === 'signup' ? FitSync.signUpWithPassword : FitSync.signInWithPassword;
      toast(mode === 'signup' ? 'נרשמים…' : 'מתחברים…');
      fn(v.email, v.password).then(function () {
        toast('התחברתם');
        return FitSync.onForeground ? FitSync.onForeground() : null;
      }).then(function () { render(); }).catch(function (e) { toast((e && e.message) || 'ההתחברות נכשלה'); });
    }
    const first = authFieldValues();
    if (!first.email || !first.password) {
      requestAnimationFrame(function () { requestAnimationFrame(go); });
      return;
    }
    go();
  }

  function onClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) {
      if (ev.target.id === 'overlay') closeModal();
      return;
    }
    if (btn.disabled) return;
    const action = btn.dataset.action;
    const s = state();

    if (action === 'tab') {
      if (btn.dataset.tab === 'nutrition' && ui.homeDate) ui.nutritionDate = ui.homeDate;
      setTab(btn.dataset.tab);
      return;
    }
    if (action === 'close') { closeModal(); return; }
    if (action === 'set-theme') { applyTheme(btn.dataset.theme); render(); haptic(8); return; }
    if (action === 'open-summary') {
      ui.view = 'summary';
      ui.summaryStart = btn.dataset.start || null;
      try { location.hash = '#/summary' + (ui.summaryStart ? '/' + ui.summaryStart : ''); } catch (e) {}
      render();
      return;
    }
    if (action === 'summary-week') {
      ui.view = 'summary';
      ui.summaryStart = btn.dataset.start || null;
      try { location.hash = '#/summary' + (ui.summaryStart ? '/' + ui.summaryStart : ''); } catch (e) {}
      render();
      return;
    }
    if (action === 'share-summary') { shareSummary(); return; }
    if (action === 'sync-signin' || action === 'sync-signup') {
      ev.preventDefault();
      runPasswordAuth(action === 'sync-signup' ? 'signup' : 'signin');
      return;
    }
    if (action === 'sync-send-otp') {
      const email = ((document.getElementById('sync-email') || {}).value || '').trim().toLowerCase();
      if (!email) { toast('יש להזין אימייל'); return; }
      FitSync.sendOtp(email).then(function () { toast('נשלח קוד למייל. הזינו אותו כאן, בלי ללחוץ על קישור'); }).catch(function (e) { toast(e.message || 'שליחת הקוד נכשלה'); });
      return;
    }
    if (action === 'sync-verify-otp') {
      const email = ((document.getElementById('sync-email') || {}).value || '').trim().toLowerCase();
      const token = ((document.getElementById('sync-otp') || {}).value || '').trim();
      if (!email || !token) { toast('יש להזין אימייל וקוד'); return; }
      FitSync.verifyOtp(email, token).then(function () {
        toast('התחברתם');
        return FitSync.onForeground ? FitSync.onForeground() : null;
      }).then(function () { render(); }).catch(function (e) { toast(e.message || 'אימות הקוד נכשל'); });
      return;
    }
    if (action === 'sync-magic') {
      const email = ((document.getElementById('sync-email') || {}).value || '').trim().toLowerCase();
      if (!email) { toast('יש להזין אימייל'); return; }
      FitSync.sendMagicLink(email).then(function () { toast('נשלח קישור למייל. עדיף להזין את הקוד בתוך האפליקציה'); }).catch(function (e) { toast(e.message || 'שליחה נכשלה'); });
      return;
    }
    if (action === 'sync-set-password') {
      const password = ((document.getElementById('sync-new-password') || {}).value || '').trim();
      if (!password) { toast('יש להזין סיסמה חדשה'); return; }
      FitSync.updatePassword(password).then(function () { toast('הסיסמה נשמרה'); render(); }).catch(function (e) { toast(e.message || 'שמירת הסיסמה נכשלה'); });
      return;
    }
    if (action === 'sync-now') {
      toast('מסנכרן…');
      FitSync.syncNow().then(function () { toast('הסנכרון הושלם'); render(); }).catch(function (e) { toast((e && e.message) || 'הסנכרון נכשל'); render(); });
      return;
    }
    if (action === 'sync-signout') { FitSync.signOut(); toast('התנתקתם'); render(); return; }
    if (action === 'whoop-connect') {
      ev.preventDefault();
      if (!FitSync.status().signedIn) { toast('קודם צריך להתחבר לחשבון'); return; }
      FitSync.whoopAuthorizeUrl().then(function (url) {
        const opened = window.open(url, '_blank', 'noopener');
        if (!opened) location.href = url;
        toast('אשר ב-Whoop וחזור לאפליקציה');
      }).catch(function (e) { toast(e.message || 'שגיאה בהתחברות ל-Whoop'); });
      return;
    }
    if (action === 'home-prev-day') {
      const today = E.todayISO();
      const cur = ui.homeDate || today;
      const min = E.addDays(today, -60);
      const prev = E.addDays(cur, -1);
      ui.homeDate = prev < min ? min : prev;
      if (ui.homeDate === today) ui.homeDate = null;
      render();
      return;
    }
    if (action === 'home-next-day') {
      const today = E.todayISO();
      const cur = ui.homeDate || today;
      const next = E.addDays(cur, 1);
      ui.homeDate = next >= today ? null : next;
      render();
      return;
    }
    if (action === 'home-today') {
      ui.homeDate = null;
      render();
      return;
    }
    if (action === 'open-whoop-ring') {
      openModal('whoop-detail', { kind: btn.dataset.kind || 'recovery', date: (homeDay().day) });
      return;
    }
    if (action === 'open-fit-ring') {
      openModal('fit-detail', { kind: btn.dataset.kind || 'consistency', date: (homeDay().day) });
      return;
    }
    if (action === 'whoop-refresh') {
      FitSync.whoopRefresh().then(function () { return FitSync.syncNow(); }).then(function () { toast('נתוני Whoop עודכנו'); render(); }).catch(function (e) { toast((e && e.message) || 'המשיכה נכשלה'); render(); });
      return;
    }

    if (action === 'open-body') {
      ui.view = 'body';
      try { location.hash = '#/body'; } catch (e) {}
      loadPhotos();
      render();
      return;
    }
    if (action === 'measure-chart') { ui.measureKey = btn.dataset.key || 'waist'; render(); return; }
    if (action === 'save-measure') { saveMeasureForm(); return; }
    if (action === 'del-measure') {
      openModal('confirm', { title: 'מחיקת מדידה', message: 'למחוק את המדידה הזו?', danger: true, okLabel: 'מחיקה', onOk: function () { Store.deleteMeasure(btn.dataset.id); closeModal(); render(); toast('המדידה נמחקה'); } });
      return;
    }
    if (action === 'add-photo') {
      const input = document.getElementById('photo-file');
      if (input) input.click();
      return;
    }
    if (action === 'del-photo') {
      openModal('confirm', { title: 'מחיקת תמונה', message: 'התמונה תימחק מהמכשיר.', danger: true, okLabel: 'מחיקה', onOk: function () {
        if (!window.FitPhotos) return;
        FitPhotos.deletePhoto(btn.dataset.id).then(function () { closeModal(); loadPhotos(true); toast('התמונה נמחקה'); });
      } });
      return;
    }
    if (action === 'compare-mode') { ui.compareMode = btn.dataset.mode || 'side'; render(); return; }
    if (action === 'compare-pick') {
      if (btn.dataset.slot === 'a') ui.compareA = btn.dataset.id;
      else ui.compareB = btn.dataset.id;
      render();
      return;
    }


    if (action === 'notify-request') {
      if (!window.FitNotify) return;
      FitNotify.requestPermission().then(function (perm) {
        if (perm === 'granted') toast('ההרשאה ניתנה. אפשר להפעיל תזכורות.');
        else if (perm === 'denied') toast('ההרשאה נחסמה. אפשר לשנות בהגדרות המכשיר.');
        render();
      });
      return;
    }
    if (action === 'notify-toggle') {
      if (!window.FitNotify) return;
      const key = btn.dataset.key;
      const on = btn.checked;
      const apply = function () { FitNotify.patchNotifications({ [key]: on }); render(); haptic(8); };
      if (on && FitNotify.permission() !== 'granted') {
        FitNotify.requestPermission().then(function (perm) {
          if (perm !== 'granted') { toast(perm === 'denied' ? 'ההרשאה נחסמה בהגדרות המכשיר' : 'צריך לאשר התראות כדי להפעיל תזכורות'); render(); return; }
          apply();
          FitNotify.tick();
        });
        return;
      }
      apply();
      if (on) FitNotify.tick();
      return;
    }

    if (action === 'open-start') {
      const list = Store.listTemplates();
      if (!list.length) { openLive(); return; }
      openModal('start');
      return;
    }
    if (action === 'start-live' || action === 'resume-live') { closeModal(); openLive(); return; }
    if (action === 'start-template') {
      const tpl = Store.getTemplate(btn.dataset.id);
      if (!tpl) { toast('התבנית לא נמצאה'); return; }
      openModal('start-preview', { templateId: tpl.id });
      return;
    }
    if (action === 'apply-load-rec') {
      const rec = root.FitLive && root.FitLive.applyLoadRecommendation && root.FitLive.applyLoadRecommendation();
      if (rec) toast('הוחלה: ' + rec.label);
      else toast('אין המלצה לתרגיל הזה');
      render();
      return;
    }
    if (action === 'load-rec-info') {
      toast(btn.dataset.reason || 'אין הסבר');
      return;
    }
    if (action === 'trend-range') {
      ui.trendRange = Number(btn.dataset.days) || 90;
      render();
      return;
    }
    if (action === 'start-template-go') {
      closeModal();
      const tpl = Store.getTemplate(btn.dataset.id);
      if (!tpl) { toast('התבנית לא נמצאה'); return; }
      const L = root.FitLive;
      if (L.getSession()) L.discard();
      L.startFromTemplate(tpl);
      L.startClocks();
      L.requestWakeLock();
      ui.tab = 'live';
      ui.editingTemplate = null;
      ui.liveSummary = null;
      try { location.hash = '#/live'; } catch (e) { /* ignore */ }
      render();
      window.scrollTo(0, 0);
      haptic(16);
      return;
    }
    if (action === 'live-skip') { root.FitLive.skipExercise(); render(); return; }
    if (action === 'update-template-from-live') {
      const sum = ui.liveSummary;
      if (sum && sum.templateId && sum.templatePayload) {
        Store.updateTemplate(sum.templateId, sum.templatePayload);
        toast('התבנית עודכנה');
      }
      ui.liveSummary = null;
      setTab('workouts');
      return;
    }
    if (action === 'chart-tip') { showChartTip(btn, btn.dataset.tip); return; }
    if (action === 'new-template') {
      closeModal();
      ui.editingTemplate = { id: 'tmp_' + Date.now(), name: '', days: [], type: 'full', exercises: [] };
      ui.tab = 'workouts';
      try { location.hash = '#/template/new'; } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (action === 'edit-template') {
      const tpl = Store.getTemplate(btn.dataset.id);
      if (!tpl) return;
      ui.editingTemplate = JSON.parse(JSON.stringify(tpl));
      ui.tab = 'workouts';
      try { location.hash = '#/template/' + encodeURIComponent(tpl.id); } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (action === 'dup-template') {
      const copy = Store.duplicateTemplate(btn.dataset.id);
      if (copy) toast('התבנית שוכפלה');
      return;
    }
    if (action === 'del-template') {
      openModal('confirm', {
        title: 'למחוק את התבנית?',
        message: 'הפעולה לא ניתנת לביטול.',
        danger: true,
        okLabel: 'מחיקה',
        onOk: function () { Store.deleteTemplate(btn.dataset.id); closeModal(); toast('התבנית נמחקה'); }
      });
      return;
    }
    if (action === 'close-template') { ui.editingTemplate = null; setTab('workouts'); return; }
    if (action === 'tpl-type') { if (ui.editingTemplate) { collectTemplateDraft(); ui.editingTemplate.type = btn.dataset.type; render(); } return; }
    if (action === 'toggle-tpl-day') {
      if (!ui.editingTemplate) return;
      collectTemplateDraft();
      const d = Number(btn.dataset.day);
      const days = (ui.editingTemplate.days || []).map(Number);
      const i = days.indexOf(d);
      if (i >= 0) days.splice(i, 1); else days.push(d);
      ui.editingTemplate.days = days.sort(function (a, b) { return a - b; });
      render();
      return;
    }
    if (action === 'add-tex' || action === 'add-tex-name') {
      const name = action === 'add-tex-name' ? btn.dataset.name : ((document.getElementById('tpl-ex-name') || {}).value || '');
      if (!String(name).trim()) { toast('יש להזין שם תרגיל'); return; }
      if (!ui.editingTemplate.exercises) ui.editingTemplate.exercises = [];
      const sug = root.FitLive && root.FitLive.planSuggestion ? root.FitLive.planSuggestion(name, '', 8, 12) : { weight: '', reps: 8 };
      const n = String(name).trim();
      const bw = !!(E.isBodyweightName && E.isBodyweightName(n));
      const st = !!(E.isStaticName && E.isStaticName(n));
      ui.editingTemplate.exercises.push({
        id: 'tex_' + Date.now(), name: n, sets: 3,
        repsMode: 'range',
        repsMin: st ? 0 : (sug.reps || 8), repsMax: st ? 0 : (sug.reps || 12),
        secsMin: st ? (sug.secs || 45) : '',
        secsMax: st ? (sug.secs || 45) : '',
        weight: bw || st ? (sug.weight || '') : (sug.weight || ''),
        restSec: '', notes: '', supersetId: '',
        bodyweight: bw || st,
        static: st
      });
      render();
      return;
    }
    if (action === 'toggle-tex-max') {
      collectTemplateDraft();
      const ex = ui.editingTemplate.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.repsMode = isMaxReps(ex) ? 'range' : 'max';
      render();
      return;
    }
    if (action === 'toggle-tex-bw') {
      collectTemplateDraft();
      const ex = ui.editingTemplate.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.bodyweight = !isBwEx(ex, ex.name);
      if (ex.bodyweight && (ex.weight === 20 || ex.weight === 20.0)) ex.weight = '';
      render();
      return;
    }
    if (action === 'toggle-tex-static') {
      collectTemplateDraft();
      const ex = ui.editingTemplate.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.static = !isStaticEx(ex, ex.name);
      if (ex.static) {
        if (!ex.secsMin) ex.secsMin = 45;
        if (!ex.secsMax) ex.secsMax = ex.secsMin || 45;
        if (ex.bodyweight == null || (E.isStaticName && E.isStaticName(ex.name))) ex.bodyweight = true;
      } else if (!ex.repsMin) {
        ex.repsMin = 8;
        ex.repsMax = ex.repsMax || 12;
      }
      render();
      return;
    }
    if (action === 'show-tex-rest') {
      collectTemplateDraft();
      const ex = ui.editingTemplate.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.restSec = C.REST_DEFAULT_SEC || 90;
      render();
      const input = document.querySelector('.builder-ex[data-ex-index="' + btn.dataset.index + '"] [data-texk="restSec"]');
      if (input) input.focus();
      return;
    }
    if (action === 'hide-tex-rest') {
      collectTemplateDraft();
      const ex = ui.editingTemplate.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.restSec = '';
      render();
      return;
    }
    if (action === 'toggle-sheet-bw') {
      const draft = workoutDraft();
      if (!draft) return;
      collectWorkoutDraftFromDom();
      const ex = draft.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.bodyweight = !isBwEx(ex, ex.name);
      renderOverlay();
      fillLastHints();
      return;
    }
    if (action === 'toggle-sheet-static') {
      const draft = workoutDraft();
      if (!draft) return;
      collectWorkoutDraftFromDom();
      const ex = draft.exercises[Number(btn.dataset.index)];
      if (!ex) return;
      ex.static = !isStaticEx(ex, ex.name);
      if (ex.static && ex.reps && !ex.secs) { ex.secs = ex.reps; ex.reps = 0; }
      renderOverlay();
      fillLastHints();
      return;
    }
    if (action === 'del-tex') {
      collectTemplateDraft();
      ui.editingTemplate.exercises.splice(Number(btn.dataset.index), 1);
      render();
      return;
    }
    if (action === 'move-tex') {
      collectTemplateDraft();
      const i = Number(btn.dataset.index);
      const to = i + Number(btn.dataset.dir);
      const arr = ui.editingTemplate.exercises;
      if (to < 0 || to >= arr.length) return;
      const tmp = arr[i]; arr[i] = arr[to]; arr[to] = tmp;
      render();
      return;
    }
    if (action === 'superset-tex') {
      collectTemplateDraft();
      const i = Number(btn.dataset.index);
      const arr = ui.editingTemplate.exercises;
      if (!arr[i + 1]) { toast('צריך תרגיל הבא לסופרסט'); return; }
      const sid = arr[i].supersetId || arr[i + 1].supersetId || ('ss_' + Date.now());
      arr[i].supersetId = sid;
      arr[i + 1].supersetId = sid;
      render();
      return;
    }
    if (action === 'save-template') {
      collectTemplateDraft();
      const nameEl = document.getElementById('tpl-name');
      const name = nameEl ? nameEl.value.trim() : (ui.editingTemplate.name || '');
      if (!name) { toast('יש לתת שם לתבנית'); return; }
      ui.editingTemplate.name = name;
      if (!ui.editingTemplate.exercises.length) { toast('הוסיפו לפחות תרגיל אחד'); return; }
      const isNew = !ui.editingTemplate.id || String(ui.editingTemplate.id).indexOf('tmp_') === 0;
      if (isNew) Store.addTemplate(Object.assign({}, ui.editingTemplate, { id: undefined }));
      else Store.updateTemplate(ui.editingTemplate.id, ui.editingTemplate);
      toast('התבנית נשמרה');
      ui.editingTemplate = null;
      setTab('workouts');
      haptic(16);
      return;
    }
    if (action === 'new-menu') {
      closeModal();
      ui.editingMenu = { id: 'tmp_' + Date.now(), name: '', days: [], applyOn: '', meals: [] };
      ui.tab = 'nutrition';
      try { location.hash = '#/menu/new'; } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (action === 'edit-menu') {
      const menu = Store.getMenu(btn.dataset.id);
      if (!menu) return;
      ui.editingMenu = JSON.parse(JSON.stringify(menu));
      ui.tab = 'nutrition';
      try { location.hash = '#/menu/' + encodeURIComponent(menu.id); } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (action === 'dup-menu') {
      const copy = Store.duplicateMenu(btn.dataset.id);
      if (copy) toast('התפריט שוכפל');
      return;
    }
    if (action === 'del-menu') {
      openModal('confirm', {
        title: 'למחוק את התפריט?',
        message: 'הפעולה לא ניתנת לביטול.',
        danger: true,
        okLabel: 'מחיקה',
        onOk: function () { Store.deleteMenu(btn.dataset.id); closeModal(); toast('התפריט נמחק'); }
      });
      return;
    }
    if (action === 'close-menu') { ui.editingMenu = null; setTab('nutrition'); return; }
    if (action === 'menu-apply') { if (ui.editingMenu) { collectMenuDraft(); ui.editingMenu.applyOn = btn.dataset.val; render(); } return; }
    if (action === 'toggle-menu-day') {
      if (!ui.editingMenu) return;
      collectMenuDraft();
      const d = Number(btn.dataset.day);
      const days = (ui.editingMenu.days || []).map(Number);
      const i = days.indexOf(d);
      if (i >= 0) days.splice(i, 1); else days.push(d);
      ui.editingMenu.days = days.sort(function (a, b) { return a - b; });
      render();
      return;
    }
    if (action === 'add-meal-slot') {
      collectMenuDraft();
      if (!ui.editingMenu.meals) ui.editingMenu.meals = [];
      ui.editingMenu.meals.push({ id: 'meal_' + Date.now(), name: btn.dataset.name || 'ארוחה', time: '', foods: [] });
      render();
      return;
    }
    if (action === 'del-meal-row') {
      collectMenuDraft();
      ui.editingMenu.meals.splice(Number(btn.dataset.index), 1);
      render();
      return;
    }
    if (action === 'move-meal') {
      collectMenuDraft();
      const i = Number(btn.dataset.index);
      const to = i + Number(btn.dataset.dir);
      const arr = ui.editingMenu.meals;
      if (to < 0 || to >= arr.length) return;
      const tmp = arr[i]; arr[i] = arr[to]; arr[to] = tmp;
      render();
      return;
    }
    if (action === 'add-meal-food') {
      collectMenuDraft();
      const food = Store.getFood(btn.dataset.id);
      const meal = ui.editingMenu.meals[Number(btn.dataset.mi)];
      if (!food || !meal) return;
      meal.foods = meal.foods || [];
      meal.foods.push({
        id: 'mf_' + Date.now(), foodId: food.id, name: food.name, qty: 1,
        protein: food.protein, calories: food.calories, carbs: food.carbs, fat: food.fat
      });
      render();
      return;
    }
    if (action === 'del-menu-food') {
      collectMenuDraft();
      const meal = ui.editingMenu.meals[Number(btn.dataset.mi)];
      if (meal) meal.foods.splice(Number(btn.dataset.fi), 1);
      render();
      return;
    }
    if (action === 'save-menu') {
      collectMenuDraft();
      const nameEl = document.getElementById('menu-name');
      const name = nameEl ? nameEl.value.trim() : (ui.editingMenu.name || '');
      if (!name) { toast('יש לתת שם לתפריט'); return; }
      ui.editingMenu.name = name;
      if (!ui.editingMenu.meals.length) { toast('הוסיפו לפחות ארוחה אחת'); return; }
      const isNew = !ui.editingMenu.id || String(ui.editingMenu.id).indexOf('tmp_') === 0;
      if (isNew) Store.addMenu(Object.assign({}, ui.editingMenu, { id: undefined }));
      else Store.updateMenu(ui.editingMenu.id, ui.editingMenu);
      toast('התפריט נשמר');
      ui.editingMenu = null;
      setTab('nutrition');
      haptic(16);
      return;
    }
    if (action === 'apply-menu') {
      const date = ui.nutritionDate || E.todayISO();
      Store.applyMenuToDate(btn.dataset.id, date);
      toast('התפריט הוחל על היום');
      ui.editingMenu = null;
      setTab('nutrition');
      return;
    }
    if (action === 'eat-meal') {
      Store.setMealStatus(btn.dataset.date, btn.dataset.mid, 'eaten');
      haptic(14);
      toast('נרשמה ארוחה');
      return;
    }
    if (action === 'skip-meal') {
      Store.setMealStatus(btn.dataset.date, btn.dataset.mid, 'skipped');
      toast('הארוחה דולגה');
      return;
    }
    if (action === 'undo-meal') {
      Store.setMealStatus(btn.dataset.date, btn.dataset.mid, 'pending');
      toast('הסימון בוטל');
      return;
    }
    if (action === 'swap-food') {
      ui.swapMeal = { date: btn.dataset.date, mealId: btn.dataset.mid, foodId: btn.dataset.fid };
      openModal('swap-food');
      return;
    }
    if (action === 'pick-swap-food') {
      const food = Store.getFood(btn.dataset.id);
      if (food && ui.swapMeal) {
        Store.replaceDayMealFood(ui.swapMeal.date, ui.swapMeal.mealId, ui.swapMeal.foodId, {
          foodId: food.id, name: food.name, qty: 1,
          protein: food.protein, calories: food.calories, carbs: food.carbs, fat: food.fat
        });
        toast('המאכל הוחלף להיום בלבד');
      }
      ui.swapMeal = null;
      closeModal();
      return;
    }

    if (action === 'cancel-live') {
      openModal('confirm', {
        title: 'יציאה מהאימון?',
        message: 'הסטים שטרם נשמרו יימחקו.',
        danger: true,
        okLabel: 'יציאה',
        onOk: function () {
          root.FitLive.discard();
          closeModal();
          setTab('workouts');
        }
      });
      return;
    }
    if (action === 'finish-live') {
      const sum = root.FitLive.finish();
      if (!sum) { toast('רשמו לפחות סט אחד'); return; }
      ui.liveSummary = sum;
      ui.tab = 'home';
      try { location.hash = '#/home'; } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (action === 'close-summary') { ui.liveSummary = null; setTab('home'); return; }
    if (action === 'live-type') { root.FitLive.setType(btn.dataset.type); render(); return; }
    if (action === 'live-rest') { root.FitLive.setRestSec(Number(btn.dataset.sec)); render(); return; }
    if (action === 'live-add-ex') {
      const input = document.getElementById('live-ex-name');
      const name = input ? input.value : '';
      if (!root.FitLive.addExercise(name)) { toast('יש להזין שם תרגיל'); return; }
      render();
      return;
    }
    if (action === 'live-pick-ex') {
      if (!root.FitLive.addExercise(btn.dataset.name)) { toast('יש להזין שם תרגיל'); return; }
      render();
      return;
    }
    if (action === 'live-select-ex') { root.FitLive.selectExercise(Number(btn.dataset.index)); render(); return; }
    if (action === 'live-step') {
      root.FitLive.stepDraft(btn.dataset.field, Number(btn.dataset.delta));
      render();
      return;
    }
    if (action === 'live-hold-start') {
      if (!root.FitLive.startHold) return;
      root.FitLive.startHold();
      render();
      return;
    }
    if (action === 'live-hold-stop') {
      const row = root.FitLive.stopHold && root.FitLive.stopHold();
      if (row && row.pr) toast('שיא חדש! ⭐');
      render();
      return;
    }
    if (action === 'live-log') {
      const row = root.FitLive.logSet();
      if (!row) { toast('יש להזין משקל, חזרות או זמן'); return; }
      if (row.pr) toast('שיא חדש! ⭐');
      render();
      return;
    }
    if (action === 'live-undo') { root.FitLive.undoLastSet(); render(); return; }
    if (action === 'skip-rest') {
      if (root.FitLive.commitRest) root.FitLive.commitRest();
      else root.FitLive.cancelRest();
      render();
      return;
    }
    if (action === 'use-food') {
      const food = Store.useFood(btn.dataset.id, btn.dataset.date || ui.nutritionDate || E.todayISO());
      if (food) toast('נוסף: ' + food.name);
      return;
    }
    if (action === 'edit-food') {
      const existing = btn.dataset.id ? Store.getFood(btn.dataset.id) : null;
      openModal('food', { food: existing || { name: '', protein: '', calories: '', carbs: '', fat: '' } });
      return;
    }
    if (action === 'save-food') {
      const name = (document.getElementById('food-name') || {}).value || '';
      if (!String(name).trim()) { toast('יש להזין שם'); return; }
      const payload = {
        name: String(name).trim(),
        protein: Number((document.getElementById('food-protein') || {}).value || 0),
        calories: Number((document.getElementById('food-calories') || {}).value || 0),
        carbs: (document.getElementById('food-carbs') || {}).value,
        fat: (document.getElementById('food-fat') || {}).value
      };
      const existing = ui.modal && ui.modal.props && ui.modal.props.food && ui.modal.props.food.id;
      if (existing) Store.updateFood(existing, payload);
      else Store.addFood(payload);
      closeModal();
      toast('המאכל נשמר');
      return;
    }
    if (action === 'delete-food') {
      const id = btn.dataset.id;
      openModal('confirm', {
        title: 'מחיקת מאכל',
        message: 'למחוק את המאכל מהספרייה?',
        danger: true,
        okLabel: 'מחיקה',
        onOk: function () { Store.deleteFood(id); closeModal(); toast('נמחק'); }
      });
      return;
    }
    if (action === 'muscle-info') {
      const load = E.weekMuscleLoad(state());
      const m = (load.muscles || []).find(function (x) { return x.id === btn.dataset.muscle; });
      if (m) toast(m.label + ' · ' + (Math.round(m.sets * 10) / 10) + ' סטים השבוע');
      return;
    }
    if (action === 'enter-demo') {
      ui.suppressCeleb = true;
      Store.enterDemoMode();
      snapshotXP();
      ui.suppressCeleb = false;
      ui.exerciseName = null;
      if (window.FitPhotos) FitPhotos.close();
      revokePhotoUrls();
      ui.photoList = null;
      toast('נטענו נתוני דמו');
      setTab('home');
      return;
    }
    if (action === 'exit-demo') {
      ui.suppressCeleb = true;
      Store.exitDemoMode();
      snapshotXP();
      ui.suppressCeleb = false;
      ui.exerciseName = null;
      if (window.FitPhotos) FitPhotos.close();
      revokePhotoUrls();
      ui.photoList = null;
      toast('חזרתם לנתונים האמיתיים');
      setTab('home');
      return;
    }
    if (action === 'open-exercise') {
      openExercise(btn.dataset.name, ui.tab);
      return;
    }
    if (action === 'close-exercise') { closeExercise(); return; }
    if (action === 'ex-sort') {
      ui.exerciseSort = btn.dataset.sort || 'recent';
      render();
      return;
    }
    if (action === 'pick-ex') {
      applyLast(Number(btn.dataset.index), btn.dataset.name, false);
      return;
    }
    if (action === 'copy-last') {
      applyLast(Number(btn.dataset.index), btn.dataset.name, true);
      return;
    }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'dismiss-install') {
      try { localStorage.setItem(C.INSTALL_DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
      render();
      return;
    }
    if (action === 'open-workout') {
      openModal('workout', {
        draft: {
          id: '',
          date: E.todayISO(),
          type: 'chest',
          customType: '',
          exercises: [{ name: '', sets: '', reps: '', weight: '' }],
          duration: '',
          notes: ''
        }
      });
      return;
    }
    if (action === 'edit-workout') {
      const w = Store.getWorkout(btn.dataset.id);
      if (!w) return;
      openModal('workout', {
        draft: {
          id: w.id,
          date: w.date,
          type: w.type,
          customType: w.customType || '',
          exercises: (w.exercises && w.exercises.length) ? w.exercises.map(function (e) { return Object.assign({}, e); }) : [{ name: '', sets: '', reps: '', weight: '' }],
          duration: w.duration || '',
          notes: w.notes || ''
        }
      });
      return;
    }
    if (action === 'draft-type') {
      collectWorkoutDraftFromDom();
      workoutDraft().type = btn.dataset.type;
      renderOverlay();
      return;
    }
    if (action === 'add-ex') {
      collectWorkoutDraftFromDom();
      workoutDraft().exercises.push({ name: '', sets: '', reps: '', weight: '' });
      renderOverlay();
      return;
    }
    if (action === 'remove-ex') {
      collectWorkoutDraftFromDom();
      workoutDraft().exercises.splice(Number(btn.dataset.index), 1);
      if (!workoutDraft().exercises.length) workoutDraft().exercises.push({ name: '', sets: '', reps: '', weight: '' });
      renderOverlay();
      return;
    }
    if (action === 'save-workout') { saveWorkout(); return; }
    if (action === 'confirm-delete-workout') {
      const id = workoutDraft() && workoutDraft().id;
      ui.modal = {
        type: 'confirm',
        props: {
          title: 'מחיקת אימון',
          message: 'למחוק את האימון הזה? הפעולה לא ניתנת לביטול.',
          danger: true,
          okLabel: 'מחיקה',
          onOk: function () {
            if (id) Store.deleteWorkout(id);
            closeModal();
            toast('האימון נמחק');
          }
        }
      };
      renderOverlay();
      return;
    }
    if (action === 'open-weight') {
      const today = E.todayISO();
      const existing = s.weights.find(function (w) { return w.date === today; });
      openModal('weight', { date: today, weight: existing ? existing.weight : (Store.latestWeight() ? Store.latestWeight().weight : '') });
      return;
    }
    if (action === 'save-weight') { saveWeight(); return; }
    if (action === 'open-metrics') {
      openModal('metrics', { date: btn.dataset.date || ui.nutritionDate || E.todayISO() });
      return;
    }
    if (action === 'save-metrics') { saveMetrics(); return; }
    if (action === 'bump-protein') { bump(btn.dataset.date, 'protein', Number(btn.dataset.delta)); return; }
    if (action === 'bump-calories') { bump(btn.dataset.date, 'calories', Number(btn.dataset.delta)); return; }
    if (action === 'bump-water') {
      const v = vesselOf(s);
      const sign = Number(btn.dataset.delta) >= 0 ? 1 : -1;
      bump(btn.dataset.date, 'water', sign * v.ml);
      return;
    }
    if (action === 'add-water-ml') {
      const input = document.getElementById('water-partial-ml');
      const ml = Number(input && input.value);
      if (!(ml > 0)) { toast('הזינו כמות במ״ל'); return; }
      bump(btn.dataset.date, 'water', ml);
      if (input) input.value = '';
      toast('נוספו ' + ml + ' מ״ל');
      return;
    }
    if (action === 'set-water') {
      const cur = Store.getNutrition(btn.dataset.date);
      const v = vesselOf(s);
      const units = Number(btn.dataset.value);
      const asMl = Math.round(units * v.ml);
      const current = cur ? (Number(cur.water) || 0) : 0;
      const filled = Math.floor((current + 0.001) / v.ml);
      const next = filled === units ? Math.round((units - 1) * v.ml) : asMl;
      Store.upsertNutrition(btn.dataset.date, { water: Math.max(0, next) });
      return;
    }
    if (action === 'set-water-vessel') {
      const kind = btn.dataset.kind === 'bottle' ? 'bottle' : 'cup';
      const presets = (C.WATER_VESSEL_PRESETS || {})[kind] || [];
      const curMl = Number(s.settings.waterVesselMl) || 0;
      const ml = presets.indexOf(curMl) >= 0 ? curMl : (presets[kind === 'bottle' ? 0 : 1] || (kind === 'bottle' ? 500 : 250));
      Store.updateSettings({ waterVessel: kind, waterVesselMl: ml, waterInMl: true });
      return;
    }
    if (action === 'set-vessel-ml') {
      const ml = Math.max(50, Number(btn.dataset.ml) || 0);
      Store.updateSettings({ waterVesselMl: ml, waterInMl: true });
      return;
    }
    if (action === 'vessel-custom') {
      const input = document.querySelector('[data-action="setting-vessel-ml"]');
      if (input) { input.focus(); input.select(); }
      return;
    }
    if (action === 'step-water-goal') {
      const cur = E.waterTarget(s);
      const next = Math.max(250, Math.min(8000, cur + Number(btn.dataset.delta)));
      Store.updateSettings({ dailyWaterTarget: next, waterInMl: true });
      return;
    }
    if (action === 'shift-day') {
      const next = E.addDays(ui.nutritionDate || E.todayISO(), Number(btn.dataset.delta));
      if (next > E.todayISO()) return;
      ui.nutritionDate = next;
      render();
      return;
    }
    if (action === 'goto-nutrition') {
      ui.nutritionDate = btn.dataset.date;
      setTab('nutrition');
      return;
    }
    if (action === 'step-setting') {
      const key = btn.dataset.key;
      const cur = Number(s.settings[key]) || 0;
      const min = key === 'weeklyWorkoutTarget' ? 1 : 1;
      const max = key === 'weeklyWorkoutTarget' ? 14 : 20;
      const next = Math.min(max, Math.max(min, cur + Number(btn.dataset.delta)));
      const patch = {};
      patch[key] = next;
      Store.updateSettings(patch);
      return;
    }
    if (action === 'export') { exportData(); return; }
    if (action === 'import') {
      const input = document.getElementById('import-file');
      if (input) input.click();
      return;
    }
    if (action === 'confirm-clear') {
      openModal('confirm', {
        title: Store.isDemoMode() ? 'מחיקת נתוני הדמו' : 'מחיקת כל הנתונים',
        message: Store.isDemoMode()
          ? 'יימחקו רק נתוני הדמו מהמכשיר. הנתונים האמיתיים יישארו כמו שהם.'
          : 'כל האימונים, התזונה, המשקל והמדדים יימחקו מהמכשיר הזה. היעדים יחזרו לברירת המחדל.',
        danger: true,
        okLabel: 'מחיקה',
        onOk: function () {
          Store.clearAll();
          if (window.FitPhotos) FitPhotos.clearAll();
          revokePhotoUrls();
          ui.photoList = [];
          closeModal();
          toast('הנתונים נמחקו');
        }
      });
      return;
    }

    if (action === 'confirm-cancel') {
      const fn = ui.modal && ui.modal.props && ui.modal.props.onCancel;
      if (fn) fn();
      else closeModal();
      return;
    }
    if (action === 'confirm-ok') {
      const fn = ui.modal && ui.modal.props && ui.modal.props.onOk;
      if (fn) fn();
      return;
    }
    if (action === 'badge-info') {
      openModal('badge', { id: btn.dataset.id });
      return;
    }
    if (action === 'hm-day') {
      const iso = btn.dataset.date;
      if (!iso || iso > E.todayISO()) return;
      const w = E.workoutsOn(s, iso);
      const n = E.nutritionOn(s, iso);
      const bits = [E.formatDayLong(iso)];
      if (w.length) bits.push(w.length + ' אימונים');
      if (n) bits.push((Number(n.protein) || 0) + ' גרם חלבון');
      toast(bits.join(' · '));
      return;
    }
  }

  function onChange(ev) {
    const el = ev.target;
    if (!el) return;
    if (el.dataset.setRest != null) {
      if (root.FitLive && root.FitLive.setSetRest) {
        root.FitLive.setSetRest(Number(el.dataset.ex), Number(el.dataset.set), el.value);
      }
      render();
      return;
    }
    if (el.id === 'import-file' && el.files && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      openModal('confirm', {
        title: 'ייבוא נתונים',
        message: 'הייבוא יחליף את כל הנתונים השמורים במכשיר. להמשיך?',
        danger: true,
        okLabel: 'ייבוא',
        onOk: function () { importFile(file); }
      });
      return;
    }
    if (el.id === 'photo-file' && el.files && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      if (!window.FitPhotos) return;
      const poseEl = document.getElementById('photo-pose');
      const dateEl = document.getElementById('photo-date');
      toast('מכווץ ושומר…');
      FitPhotos.addPhoto({ pose: poseEl ? poseEl.value : 'front', date: dateEl ? dateEl.value : E.todayISO() }, file)
        .then(function () { toast('התמונה נשמרה'); loadPhotos(true); })
        .catch(function () { toast('שמירת התמונה נכשלה'); });
      return;
    }
    if (el.dataset.action === 'compare-slider') {
      ui.comparePos = Number(el.value) || 0;
      const wrap = document.getElementById('compare-slider');
      if (wrap) wrap.style.setProperty('--pos', ui.comparePos + '%');
      return;
    }
    if (el.dataset.action === 'notify-setting') {
      const key = el.dataset.key;
      const val = el.value;
      if (!window.FitNotify || !key) return;
      const patch = {};
      if (key === 'lowHpThreshold') patch[key] = Math.max(10, Math.min(90, Number(val) || 50));
      else patch[key] = val;
      FitNotify.patchNotifications(patch);
      return;
    }
    if (el.dataset.action === 'setting-vessel-ml') {
      const ml = Math.max(50, Math.round(Number(el.value) || 0));
      if (!(ml >= 50)) return;
      Store.updateSettings({ waterVesselMl: ml, waterInMl: true });
      return;
    }
    if (el.dataset.action === 'setting') {
      const key = el.dataset.key;
      let val = el.value;
      if (key === 'dailyCalorieTarget' && val === '') {
        Store.updateSettings({ dailyCalorieTarget: '' });
        return;
      }
      if (key === 'displayName') {
        Store.updateSettings({ displayName: val });
        return;
      }
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) return;
      const patch = {};
      patch[key] = num;
      Store.updateSettings(patch);
      return;
    }
    if (el.dataset.action === 'nutrition-field') {
      const field = el.dataset.field;
      const date = el.dataset.date;
      const patch = {};
      patch[field] = field === 'notes' ? el.value : Number(el.value || 0);
      Store.upsertNutrition(date, patch);
      return;
    }
    if (el.dataset.draft || el.dataset.ex != null) syncDraftFromInput(el);
  }

  function parseHash() {
    const h = (location.hash || '#/home').replace(/^#\/?/, '');
    const parts = h.split('/');
    const tab = parts[0] || 'home';
    if (tab === 'exercise') {
      ui.exerciseName = decodeURIComponent(parts.slice(1).join('/') || '');
      if (!ui.tab || ui.tab === 'home') ui.tab = 'progress';
      return;
    }
    ui.exerciseName = null;
    ui.view = null;
    if (tab === 'summary') {
      ui.tab = 'progress';
      ui.view = 'summary';
      ui.summaryStart = parts[1] || null;
      return;
    }
    if (tab === 'body') {
      ui.tab = 'progress';
      ui.view = 'body';
      loadPhotos();
      return;
    }
    ui.summaryStart = null;
    if (tab === 'live') {
      ui.tab = 'live';
      return;
    }
    if (tab === 'template') {
      ui.tab = 'workouts';
      const id = decodeURIComponent(parts.slice(1).join('/') || '');
      if (id === 'new') {
        ui.editingTemplate = { id: 'tmp_' + Date.now(), name: '', days: [], type: 'full', exercises: [] };
      } else if (id) {
        const tpl = Store.getTemplate(id);
        ui.editingTemplate = tpl ? JSON.parse(JSON.stringify(tpl)) : null;
      }
      return;
    }
    if (tab === 'menu') {
      ui.tab = 'nutrition';
      const id = decodeURIComponent(parts.slice(1).join('/') || '');
      if (id === 'new') {
        ui.editingMenu = { id: 'tmp_' + Date.now(), name: '', days: [], applyOn: '', meals: [] };
      } else if (id) {
        const menu = Store.getMenu(id);
        ui.editingMenu = menu ? JSON.parse(JSON.stringify(menu)) : null;
      }
      return;
    }
    ui.editingTemplate = null;
    ui.editingMenu = null;
    if (['home', 'workouts', 'nutrition', 'progress', 'settings'].indexOf(tab) >= 0) ui.tab = tab;
  }

  function onHash() {
    if (ui.modal) return;
    parseHash();
    render();
  }

  function init() {
    applyTheme();
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if (getThemePref() === 'system') applyTheme('system');
      });
    } catch (err) { /* ignore */ }
    Store.load();
    try {
      if (new URLSearchParams(location.search).get('demo') === '1' && !Store.isDemoMode()) {
        ui.suppressCeleb = true;
        Store.enterDemoMode();
        ui.suppressCeleb = false;
      }
    } catch (err) { /* ignore */ }
    ui.nutritionDate = E.todayISO();
    parseHash();
    snapshotXP();

    if (root.FitLive) {
      if (root.FitLive.restore() && ui.tab === 'live') {
        root.FitLive.startClocks();
        root.FitLive.requestWakeLock();
      }
      root.FitLive.onTick(function (ev) {
        if (ev.type === 'elapsed') {
          const el = document.getElementById('elapsed-clock');
          if (el) el.textContent = formatElapsed(ev.ms);
        } else if (ev.type === 'rest') {
          const el = document.getElementById('rest-count');
          if (el) el.textContent = root.FitLive.formatHoldClock ? root.FitLive.formatHoldClock(ev.elapsed || 0) : ev.elapsed;
          const banner = document.getElementById('rest-banner');
          if (banner) banner.classList.toggle('over-target', !!(ev.target && ev.elapsed >= ev.target));
        } else if (ev.type === 'rest-target') {
          toast('הגיע יעד המנוחה');
          const banner = document.getElementById('rest-banner');
          if (banner) banner.classList.add('over-target');
        } else if (ev.type === 'hold' || ev.type === 'hold-phase') {
          const el = document.getElementById('hold-count');
          if (ev.type === 'hold-phase' || !el) {
            render();
            return;
          }
          if (el && ev.state) el.textContent = ev.state.display;
          const banner = document.getElementById('hold-banner');
          if (banner && ev.state) {
            banner.classList.toggle('overtime', !!ev.state.overtime);
            banner.classList.toggle('ready', ev.state.phase === 'ready');
          }
          const sub = document.getElementById('hold-sub');
          if (sub && ev.state) {
            sub.textContent = ev.state.phase === 'ready' ? 'מתחילים בעוד רגע'
              : (ev.state.isMax ? 'ספירה קדימה עד שתעצרו'
              : (ev.state.overtime ? 'המשיכו או עצרו כדי לרשום' : ('יעד ' + formatSecs(ev.state.target))));
          }
        }
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && root.FitLive.getSession()) {
          root.FitLive.requestWakeLock();
          if (root.FitLive.pulseRest) root.FitLive.pulseRest();
          render();
        }
      });
    }
    Store.subscribe(function () { maybeCelebrate(); render(); });
    document.addEventListener('click', onClick);
    document.addEventListener('submit', function (ev) {
      const form = ev.target && ev.target.id === 'sync-auth-form' ? ev.target : (ev.target && ev.target.closest ? ev.target.closest('#sync-auth-form') : null);
      if (!form) return;
      ev.preventDefault();
      ev.stopPropagation();
      runPasswordAuth('signin');
    });
    document.addEventListener('change', onChange);
    document.addEventListener('input', function (ev) {
      const el = ev.target;
      if (el && (el.dataset.draft || el.dataset.ex != null)) syncDraftFromInput(el);
      if (el && el.dataset.exk === 'name') updateExAutocomplete(el);
      if (el && el.id === 'live-ex-name') updateLiveExSuggest(el);
      if (el && el.dataset.tex != null) onTexInput(el);
      if (el && el.dataset.meal != null) syncMeal(el);
      if (el && el.id === 'food-query') {
        ui.foodQuery = el.value;
        const pos = el.selectionStart;
        render();
        const q = document.getElementById('food-query');
        if (q) {
          q.focus();
          try { q.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
        }
      }
    });
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', function () {
      if (ui.modal) {
        ui.modal = null;
        render();
      }
    });
    render();
  }

  root.FitUI = {
    init: init,
    render: render,
    setTab: setTab,
    toast: toast,
    ui: ui
  };
})(typeof window !== 'undefined' ? window : globalThis);
