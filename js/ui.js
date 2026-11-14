/* פיט — UI layer. Reads from FitStore / FitEngine; does not own persistence. */
(function (root) {
  'use strict';

  const C = root.FitConfig;
  const E = root.FitEngine;
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
    const map = { weight: 'שיא משקל', e1rm: 'שיא 1RM', volume: 'שיא נפח', reps: 'שיא חזרות' };
    return (types || []).map(function (tp) {
      return '<span class="pr-tag">' + (map[tp] || tp) + '</span>';
    }).join('');
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
    if (ui.suppressCeleb || !ui.seenXP) { snapshotXP(); return; }
    const s = state();
    const xp = E.computeXP(s);
    const badges = E.computeAchievements(s, xp);
    const gain = xp.level.total - ui.seenXP.total;
    const newBadges = badges.filter(function (b) { return b.unlocked && ui.seenXP.badges.indexOf(b.id) < 0; });
    const leveled = xp.level.level > ui.seenXP.level;
    snapshotXP();
    if (leveled) queueCeleb('levelup', { level: xp.level.level });
    newBadges.forEach(function (b) { queueCeleb('unlock', { badge: b }); });
    if (gain > 0 && !leveled) floatXP(gain);
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

  function renderHome() {
    const s = state();
    const now = new Date();
    const today = E.todayISO(now);
    const cons = E.computeConsistency(s, now);
    const xp = E.computeXP(s, now);
    const badges = E.computeAchievements(s, xp);
    const name = s.settings.displayName || 'Hazi';
    const dateLabel = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
    const pTarget = E.proteinTarget(s);
    const wTarget = E.waterTarget(s);
    const cTarget = Number(s.settings.dailyCalorieTarget) || 0;
    const nut = E.nutritionOn(s, today);
    const protein = nut ? Number(nut.protein) || 0 : 0;
    const calories = nut ? Number(nut.calories) || 0 : 0;
    const water = nut ? Number(nut.water) || 0 : 0;
    const workouts = E.workoutsOn(s, today);
    const lastW = Store.latestWeight();
    const weightToday = (s.weights || []).find(function (w) { return w.date === today; });
    const level = xp.level;
    const unlocked = badges.filter(function (b) { return b.unlocked; });
    const todayBits = xp.todayEvents.map(function (e) { return ltr('+' + e.xp) + ' ' + esc(e.label); });
    const metrics = E.bestMetricsByDate(s)[today];
    const hpCls = hpClass(cons.combined, cons.hasData);

    let install = '';
    if (!isStandalone() && !installDismissed()) {
      install = '<div class="banner" id="install-banner">' +
        '<p>להוספה למסך הבית: באייפון לחצו על שיתוף ואז «הוסף למסך הבית». באנדרואיד — תפריט ואז «התקן אפליקציה».</p>' +
        '<button type="button" class="close" data-action="dismiss-install" aria-label="סגירה">×</button>' +
        '</div>';
    }

    const workoutLine = workouts.length
      ? workouts.map(function (w) { return typeLabel(w); }).join(' · ')
      : 'עדיין לא תועד אימון היום';

    const dayMenu = Store.getDayMenu(today) || (Store.autoApplyMenu ? Store.autoApplyMenu(today) : null);
    let mealBit = '';
    if (dayMenu && dayMenu.meals && dayMenu.meals.length) {
      const eaten = dayMenu.meals.filter(function (m) { return m.status === 'eaten'; }).length;
      mealBit = '<div class="today-row"><div class="today-ico">🍽️</div><div>' +
        '<div class="label">תפריט · ' + esc(dayMenu.menuName || '') + '</div>' +
        '<div class="value">' + ltr(eaten + ' / ' + dayMenu.meals.length) + ' ארוחות</div></div>' +
        '<button type="button" class="btn tiny" data-action="tab" data-tab="nutrition">פתיחה</button></div>';
    }

    return install + emptyDemoCta() +
      pageHead('<div><p class="kicker">' + esc(dateLabel) + '</p><h1>שלום, ' + esc(name) + '</h1></div>') +

      '<section class="card level-card">' +
      '<div class="level-badge" aria-label="רמה ' + level.level + '">' + level.level + '</div>' +
      '<div class="level-meta">' +
      '<p class="kicker">רמה ' + level.level + '</p>' +
      '<div class="xp-track" role="progressbar" aria-valuenow="' + Math.round(level.progress * 100) + '" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="xp-fill" style="width:' + Math.round(level.progress * 100) + '%"></div></div>' +
      '<p class="xp-sub">' + ltr(level.xpInLevel + ' / ' + level.xpNeeded + ' XP') + ' לרמה הבאה · סה״כ ' + ltr(level.total + ' XP') + '</p>' +
      (todayBits.length ? '<p class="xp-today">היום: ' + todayBits.join(' · ') + '</p>' : '<p class="xp-today">תעדו אימון, תזונה או מדדים כדי לצבור XP</p>') +
      '</div></section>' +

      '<section class="card hp-card">' +
      '<div class="hp-card-top"><div>' +
      '<p class="kicker">מד עקביות</p>' +
      '<p class="hp-legend">14 הימים האחרונים</p>' +
      '</div><div class="hp-pct ' + hpCls + '">' +
      (cons.hasData ? Math.round(cons.combined * 100) + '<span>%</span>' : '—') +
      '</div></div>' +
      hpBar(cons.combined, 'lg', cons.hasData) +
      '<div class="mini-bars">' +
      '<div class="mini-bar"><div class="mini-bar-label"><span>אימונים</span><span>' +
      ltr(cons.workoutsDone + '/' + fmtExpected(cons.expectedWorkouts)) +
      '</span></div>' + hpBar(cons.trainingScore, 'sm', cons.hasData) + '</div>' +
      '<div class="mini-bar"><div class="mini-bar-label"><span>תזונה</span><span>' +
      ltr(cons.proteinHits + '/' + cons.days) +
      '</span></div>' + hpBar(cons.nutritionScore, 'sm', cons.hasData) + '</div>' +
      '</div>' +
      '<div class="streak"><span class="streak-flame" aria-hidden="true">🔥</span><div>' +
      '<strong>' + cons.streak + '</strong> <span>' + (cons.streak === 1 ? 'יום רצף' : 'ימי רצף') + '</span>' +
      '</div></div>' +
      '<p class="hp-formula">' + (cons.hasData ? 'המד משקלל אימונים מול היעד השבועי (יחסית ל־14 יום) ואת מספר הימים שבהם עמדתם ביעד החלבון.' : 'המד יתחיל להתמלא אחרי שתעדו אימון או תזונה. הוא משקלל אימונים מול היעד השבועי (יחסית ל־14 יום) ואת מספר הימים ביעד החלבון.') + '</p>' +
      '</section>' +

      '<div class="rings" aria-label="טבעות היום">' +
      activityRing(workouts.length ? 1 : 0, 'var(--accent)', 'אימון', workouts.length ? '✓' : '—') +
      activityRing(pTarget ? protein / pTarget : 0, 'var(--protein)', 'חלבון', ltr(protein + '/' + pTarget)) +
      activityRing(wTarget ? water / wTarget : 0, 'var(--water)', 'מים', ltr(water + '/' + wTarget)) +
      '</div>' +

      '<section class="card"><h2>היום</h2>' +
      '<div class="today-row"><div class="today-ico">🏋️</div><div>' +
      '<div class="label">אימון</div>' +
      '<div class="value' + (workouts.length ? '' : ' muted') + '">' + esc(workoutLine) + '</div></div>' +
      (workouts.length ? '' : '<button type="button" class="btn tiny primary" data-action="open-start">התחלה</button>') +
      '</div>' +
      '<div class="today-row"><div class="today-ico">🥩</div><div>' +
      '<div class="label">חלבון</div>' +
      '<div class="value">' + ltr(protein + ' / ' + pTarget) + ' <span class="unit">גרם</span></div>' +
      '<div class="protein-mini"><i style="width:' + Math.min(100, pTarget ? protein / pTarget * 100 : 0) + '%"></i></div>' +
      '</div><div class="today-side">' +
      '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + today + '" data-delta="25">+25</button>' +
      '<button type="button" class="btn tiny" data-action="bump-protein" data-date="' + today + '" data-delta="50">+50</button>' +
      '</div></div>' +
      '<div class="today-row"><div class="today-ico">💧</div><div>' +
      '<div class="label">מים</div>' +
      '<div class="value">' + ltr(water + ' / ' + wTarget) + ' <span class="unit">כוסות</span></div></div>' +
      '<div class="today-side"><button type="button" class="btn tiny" data-action="bump-water" data-date="' + today + '" data-delta="1">+1</button></div>' +
      '</div>' +
      (cTarget ? '<div class="today-row"><div class="today-ico">🔥</div><div><div class="label">קלוריות</div><div class="value">' + ltr(calories + ' / ' + cTarget) + ' <span class="unit">קק״ל</span></div></div></div>' : '') +
      mealBit +
      '<div class="today-row"><div class="today-ico">⚖️</div><div>' +
      '<div class="label">משקל</div>' +
      '<div class="value' + (weightToday || lastW ? '' : ' muted') + '">' +
      (weightToday ? ltr(String(weightToday.weight)) + ' ק״ג' : (lastW ? 'אחרון: ' + ltr(String(lastW.weight)) + ' ק״ג (' + esc(E.formatDay(lastW.date)) + ')' : 'טרם תועד')) +
      '</div></div>' +
      '<button type="button" class="btn tiny" data-action="open-weight">+' + (weightToday ? 'עדכון' : 'משקל') + '</button>' +
      '</div>' +
      renderTodayMetrics(metrics) +
      '</section>' +

      '<div class="section-title"><h2>הוספה מהירה</h2></div>' +
      '<div class="quick-row cols-4">' +
      '<button type="button" class="btn" data-action="open-start">+ אימון</button>' +
      '<button type="button" class="btn" data-action="tab" data-tab="nutrition">+ תזונה</button>' +
      '<button type="button" class="btn" data-action="open-weight">+ משקל</button>' +
      '<button type="button" class="btn" data-action="open-metrics">+ מדדים</button>' +
      '</div>' +

      renderWeeklyCard(s) +
      renderMiniBodyMap(s) +
      renderRecentPRs(s) +
      renderFoodsStrip(E.todayISO()) +

      '<div class="section-title"><h2>הישגים</h2><span class="kicker">' + unlocked.length + '/' + badges.length + '</span></div>' +
      '<section class="card"><div class="badges">' + badges.map(renderBadge).join('') + '</div></section>';
  }

  function renderTodayMetrics(m) {
    if (!m) {
      return '<div class="today-row"><div class="today-ico">❤️</div><div>' +
        '<div class="label">מדדים</div>' +
        '<div class="value muted">שינה, התאוששות, HRV — עדיין לא תועדו היום</div></div>' +
        '<button type="button" class="btn tiny" data-action="open-metrics">תיעוד</button></div>';
    }
    const bits = [];
    if (m.sleepHours != null) bits.push(m.sleepHours + ' שע׳ שינה');
    if (m.recoveryPct != null) bits.push(m.recoveryPct + '% התאוששות');
    if (m.strain != null) bits.push('Strain ' + m.strain);
    if (m.hrv != null) bits.push('HRV ' + m.hrv);
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
      body = '<div class="empty card"><span class="emoji">🏋️</span><p>אין אימונים עדיין. תעדו את האימון הראשון שלכם — כך המד וה־XP יתחילו לזוז.</p>' +
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

    const cups = [];
    const maxCups = Math.max(wTarget, Number(nut.water) || 0, 8);
    for (let i = 1; i <= maxCups; i++) {
      cups.push('<button type="button" class="cup' + (i <= (Number(nut.water) || 0) ? ' on' : '') + '" data-action="set-water" data-date="' + date + '" data-value="' + i + '" aria-label="כוס ' + i + '"></button>');
    }

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
            (n.water ? ' · ' + n.water + ' כוסות' : '') + '</div></button>';
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
      '<div class="metric"><div><span class="label kicker">מים</span><div><span class="big">' + ltr(String(Number(nut.water) || 0)) + '</span><span class="unit"> / ' + ltr(String(wTarget)) + ' כוסות</span></div></div></div>' +
      '<div class="cups">' + cups.join('') + '</div>' +
      '<div class="adders"><button type="button" class="btn tiny" data-action="bump-water" data-date="' + date + '" data-delta="-1">−1</button>' +
      '<button type="button" class="btn tiny" data-action="bump-water" data-date="' + date + '" data-delta="1">+1</button></div>' +
      '</section>' +

      '<section class="card"><label class="field"><span>הערות</span>' +
      '<textarea data-field="notes" data-date="' + date + '" data-action="nutrition-field" placeholder="מה אכלתם, איך הרגשתם…">' + esc(nut.notes || '') + '</textarea>' +
      '</label></section>' +

      '<section class="card"><div class="section-title" style="margin-top:0"><h2>מדדי גוף</h2>' +
      '<button type="button" class="linkish" data-action="open-metrics" data-date="' + date + '">עריכה</button></div>' +
      renderMetricsPills(metrics) +
      '<p class="hp-legend">שינה של 7+ שעות והתאוששות של 67%+ מעניקות XP. מקור נוכחי: הזנה ידנית (Whoop יתווסף בהמשך).</p>' +
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
      recoveryChart +
      '<section class="card"><h2>לוח פעילות</h2>' +
      Charts.heatmap({ weeks: 16, getClass: hmClass }) +
      '<div class="legend">' +
      '<span><i class="hm-work" style="background:#3b7ad9"></i>אימון</span>' +
      '<span><i class="hm-protein" style="background:#2a9a6a"></i>יעד חלבון</span>' +
      '<span><i class="hm-both" style="background:#3ee0a0"></i>שניהם</span>' +
      '<span><i class="hm-partial" style="background:#3a4a3a"></i>חלבון חלקי</span>' +
      '</div></section>' +
      '<section class="card"><h2>הישגים</h2><div class="badges">' + badges.map(renderBadge).join('') + '</div></section>' +
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
      '<div class="card stat-tile"><div class="kicker">XP</div><div class="big">' + ltr(String(stats.xp || 0)) + '</div></div>' +
      '</div>' +
      '<section class="card"><h2>תזונה ושינה</h2>' +
      '<p>חלבון: ' + nutr.hits + ' מתוך ' + nutr.days + ' ימים (' + Math.round((nutr.rate || 0) * 100) + '%)</p>' +
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
    tile(560, 570, 'XP', stats.xp || 0);
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
      if (last.sets || last.reps) bits.push((last.sets || '?') + '×' + (last.reps || '?'));
      if (last.weight) bits.push(last.weight + ' ק״ג');
      return '<button type="button" class="list-item" data-action="open-exercise" data-name="' + esc(it.name) + '">' +
        '<div class="meta">' + esc(E.formatDay(it.lastDate)) + ' · ' + it.sessions + ' אימונים</div>' +
        '<div class="title">' + esc(it.name) + '</div>' +
        (bits.length ? '<div class="sub">אחרון: ' + esc(bits.join(' · ')) + '</div>' : '') +
        '</button>';
    }).join('');
    return '<div class="section-title"><h2>תרגילים</h2>' +
      '<span class="sort-tabs">' +
      '<button type="button" class="linkish' + (sort === 'recent' ? ' on' : '') + '" data-action="ex-sort" data-sort="recent">אחרונים</button>' +
      ' · ' +
      '<button type="button" class="linkish' + (sort === 'freq' ? ' on' : '') + '" data-action="ex-sort" data-sort="freq">לפי תדירות</button>' +
      '</span></div>' +
      '<p class="hp-legend" style="margin-top:-4px;margin-bottom:8px">לחצו על תרגיל כדי לראות נפח, משקל, 1RM ושיאים.</p>' +
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

    const table = stats.bestReps.length
      ? '<div class="reps-table">' + stats.bestReps.map(function (row) {
          return '<div class="reps-row"><span>' + ltr(row.weight + ' ק״ג') + '</span><strong>' + row.reps + ' חזרות</strong><span class="muted">' + esc(E.formatDay(row.date)) + '</span></div>';
        }).join('') + '</div>'
      : '<p class="kicker">אין עדיין נתוני חזרות-למשקל.</p>';

    const history = list.slice().reverse().map(function (sess) {
      const rowBits = (sess.rows || []).map(function (e) {
        return (e.sets || '?') + '×' + (e.reps || '?') + (e.weight ? ' · ' + e.weight + ' ק״ג' : '');
      }).join(' · ');
      return '<div class="list-item">' +
        '<div class="meta">' + esc(E.formatDayLong(sess.date)) + (sess.isPR ? ' ' + prTags(sess.prTypes) : (sess.isBaseline ? ' <span class="pr-tag dim">בסיס</span>' : '')) + '</div>' +
        '<div class="title">' + esc(rowBits) + '</div>' +
        '<div class="sub">נפח ' + ltr(String(Math.round(sess.volume))) + ' · 1RM משוער ' + ltr((Math.round(sess.e1rm * 10) / 10) + ' ק״ג') + '</div>' +
        '</div>';
    }).join('');

    return '<header class="page-head">' +
      '<button type="button" class="btn" data-action="close-exercise">חזרה</button>' +
      '<h1>' + esc(name) + '</h1></header>' +
      '<div class="stats-grid">' +
      '<div class="metric-pill"><div class="label">שיאים סה״כ</div><div class="value">' + stats.totalPRs + '</div></div>' +
      '<div class="metric-pill"><div class="label">שיאים ב־30 יום</div><div class="value">' + stats.prLast30 + '</div></div>' +
      '<div class="metric-pill"><div class="label">שיאים לשבוע</div><div class="value">' + ltr(rateTxt) + '</div></div>' +
      '<div class="metric-pill"><div class="label">% אימונים עם שיא</div><div class="value">' + pctTxt + '<span class="unit">%</span></div></div>' +
      '<div class="metric-pill"><div class="label">ימים מאז שיא</div><div class="value">' + esc(sinceText) + '</div></div>' +
      '<div class="metric-pill"><div class="label">אימונים</div><div class="value">' + stats.totalSessions + '</div></div>' +
      '</div>' +
      '<section class="card"><h2>נפח כולל לאימון</h2>' +
      Charts.barChart({ labels: labels, values: list.map(function (sess) { return sess.volume; }), marks: marks, color: '#8ab4ff', aria: 'נפח כולל', height: 170 }) +
      '<p class="hp-legend">נפח = סטים × חזרות × משקל. נקודה צהובה / עמודה צהובה = שיא.</p></section>' +
      '<section class="card"><h2>משקל בסט הכבד</h2>' +
      Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.topWeight; }), marks: marks, color: '#d36bff', tighten: true, aria: 'משקל בסט הכבד' }) +
      '</section>' +
      '<section class="card"><h2>1RM משוער (Epley)</h2>' +
      Charts.lineChart({ labels: labels, values: list.map(function (sess) { return Math.round(sess.e1rm * 10) / 10; }), marks: marks, color: '#ffb14a', tighten: true, aria: '1RM משוער' }) +
      '<p class="hp-legend">נוסחת Epley: משקל × (1 + חזרות/30). השיא הנוכחי: ' + ltr((Math.round(stats.currentMaxE1rm * 10) / 10) + ' ק״ג') + '.</p></section>' +
      '<section class="card"><h2>שיא חזרות לפי משקל</h2>' + table + '</section>' +
      '<div class="section-title"><h2>היסטוריית אימונים</h2></div>' +
      '<div class="list">' + history + '</div>';
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
          : ('<p class="hp-legend">שלחו קישור כניסה למייל. אין סיסמה.</p>' +
            '<label class="field"><span>אימייל</span><input type="email" id="sync-email" dir="ltr" inputmode="email" autocomplete="email" /></label>' +
            '<button type="button" class="btn primary wide" data-action="sync-magic">שלחו קישור כניסה</button>')) +
        '</section>');
    const whoopCard = !whoopOn
      ? ('<section class="card is-soon"><h2>חיבור Whoop ' + soon + '</h2>' +
        '<p class="hp-legend">אחרי הקמת השרת ומילוי מזהה הלקוח של Whoop ב-<code>js/cloud-config.js</code>, אפשר יהיה לחבר את החשבון. מדדי Recovery, Strain, שינה, HRV ואימונים ייכנסו עם מקור whoop.</p></section>')
      : ('<section class="card"><h2>חיבור Whoop</h2>' +
        (syncSt.signedIn
          ? ('<p class="hp-legend">חיבור מאובטח דרך השרת. הנתונים מסונכרנים למדדים עם מקור whoop.</p>' +
            '<div class="btn-row" style="grid-template-columns:1fr 1fr">' +
            '<a class="btn primary" data-action="whoop-connect" href="#">חבר Whoop</a>' +
            '<button type="button" class="btn" data-action="whoop-refresh">משיכת נתונים</button></div>')
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
      '<div class="setting"><div class="grow"><div>יעד מים יומי</div><div class="desc">כוסות ליום, גם ל־XP</div></div>' +
      '<div class="stepper">' +
      '<button type="button" data-action="step-setting" data-key="dailyWaterTarget" data-delta="-1" aria-label="הורדה">−</button>' +
      '<div class="num">' + (Number(set.dailyWaterTarget) || 8) + '</div>' +
      '<button type="button" data-action="step-setting" data-key="dailyWaterTarget" data-delta="1" aria-label="העלאה">+</button>' +
      '</div></div>' +
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



      '<section class="card"><button type="button" class="btn danger wide" data-action="confirm-clear">מחיקת כל הנתונים</button></section>';
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
        (ssPrev ? '<div class="ss-label">סופרסט</div>' : '') +
        '<div class="builder-head">' +
        '<span class="drag-handle" data-action="drag-tex" data-index="' + i + '" aria-label="גרירה">⠿</span>' +
        '<input type="text" data-tex="' + i + '" data-texk="name" placeholder="שם התרגיל" value="' + esc(ex.name || '') + '" />' +
        '<div class="reorder">' +
        '<button type="button" class="icon-btn" data-action="move-tex" data-index="' + i + '" data-dir="-1" aria-label="למעלה">↑</button>' +
        '<button type="button" class="icon-btn" data-action="move-tex" data-index="' + i + '" data-dir="1" aria-label="למטה">↓</button>' +
        '<button type="button" class="icon-btn" data-action="del-tex" data-index="' + i + '" aria-label="מחיקה">×</button>' +
        '</div></div>' +
        '<div class="builder-grid">' +
        '<label class="field"><span>סטים</span><input type="number" min="1" data-tex="' + i + '" data-texk="sets" value="' + esc(ex.sets || 3) + '" /></label>' +
        '<label class="field"><span>טווח חזרות</span><div class="live-add"><input type="number" min="1" data-tex="' + i + '" data-texk="repsMin" value="' + esc(ex.repsMin || 8) + '" /><input type="number" min="1" data-tex="' + i + '" data-texk="repsMax" value="' + esc(ex.repsMax || 12) + '" /></div></label>' +
        '<label class="field"><span>משקל יעד (אופציונלי)</span><input type="number" min="0" step="0.5" data-tex="' + i + '" data-texk="weight" value="' + esc(ex.weight === 0 ? 0 : (ex.weight || '')) + '" placeholder="ק״ג" /></label>' +
        '<label class="field"><span>מנוחה (שנ׳)</span><input type="number" min="15" step="15" data-tex="' + i + '" data-texk="restSec" value="' + esc(ex.restSec || 90) + '" /></label>' +
        '</div>' +
        '<label class="field"><span>הערות</span><input type="text" data-tex="' + i + '" data-texk="notes" value="' + esc(ex.notes || '') + '" placeholder="אופציונלי" /></label>' +
        (ss ? '' : '<button type="button" class="linkish" data-action="superset-tex" data-index="' + i + '">סופרסט עם הבא</button>') +
        '</div>';
    }).join('') || '<p class="hp-legend">הוסיפו תרגיל מהספרייה או הקלידו שם.</p>';

    const groups = exercisesByMuscle().map(function (g) {
      return '<div class="lib-group"><h3>' + esc(g.label) + '</h3><div class="chips">' +
        g.items.map(function (n) {
          return '<button type="button" class="chip" data-action="add-tex-name" data-name="' + esc(n) + '">' + esc(n) + '</button>';
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
          : '<p class="kicker">' + (st === 'eaten' ? 'נאכלה ✓' : 'דולגה') + '</p>') +
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
    else if (type === 'levelup') overlay.innerHTML = renderLevelUp();
    else if (type === 'unlock') overlay.innerHTML = renderUnlock();
    else if (type === 'swap-food') overlay.innerHTML = renderSwapFoodSheet();
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
      return '<div class="ex-block">' +
        '<div class="ex-row">' +
        '<input type="text" data-ex="' + i + '" data-exk="name" placeholder="תרגיל" autocomplete="off" value="' + esc(ex.name || '') + '" />' +
        '<input type="number" data-ex="' + i + '" data-exk="sets" min="0" placeholder="סטים" value="' + esc(ex.sets || '') + '" />' +
        '<input type="number" data-ex="' + i + '" data-exk="reps" min="0" placeholder="חזרות" value="' + esc(ex.reps || '') + '" />' +
        '<input type="number" data-ex="' + i + '" data-exk="weight" min="0" step="0.5" placeholder="ק״ג" value="' + esc(ex.weight || '') + '" />' +
        '<button type="button" class="icon-btn" data-action="remove-ex" data-index="' + i + '" aria-label="מחיקה">×</button>' +
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
      '<p class="hp-legend" style="margin-bottom:12px">מקור: הזנה ידנית. אינטגרציית Whoop תמלא את אותם שדות אוטומטית בהמשך. יעדי XP: שינה ' +
      C.XP_RULES.metrics.sleepHours.min + '+ שעות, התאוששות ' + C.XP_RULES.metrics.recoveryPct.min + '%+.</p>' +
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
    const chips = foods.map(function (f) {
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
      (chips || '<p class="kicker">הספרייה ריקה.</p>') +
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
    const left = L.restRemaining();
    const total = (L.restTotal && L.restTotal()) || sess.restSec || 90;
    const pr = L.prForDraft();
    const prog = L.progress ? L.progress() : { current: sess.currentEx + 1, total: sess.exercises.length };
    const nxt = L.nextExercise ? L.nextExercise() : sess.exercises[sess.currentEx + 1];
    const lastSets = ex ? E.lastSessionSets(state(), ex.name, null) : [];
    const lastHtml = lastSets.length
      ? '<div class="last-sets"><div class="label">פעם קודמת</div><div class="set-pills">' +
        lastSets.map(function (s, i) {
          return '<span class="set-pill">סט ' + (i + 1) + ': ' + s.weight + '×' + s.reps + '</span>';
        }).join('') + '</div></div>'
      : '<p class="hp-legend">אין היסטוריה לתרגיל הזה עדיין.</p>';
    const C_R = 2 * Math.PI * 52;
    const frac = total ? left / total : 0;
    const restBar = left > 0
      ? '<div class="rest-banner" id="rest-banner"><div class="rest-label">מנוחה</div>' +
        '<div class="rest-ring-wrap">' +
        '<svg class="rest-ring" viewBox="0 0 120 120" aria-hidden="true">' +
        '<circle class="rest-track" cx="60" cy="60" r="52"/>' +
        '<circle class="rest-prog" id="rest-prog" cx="60" cy="60" r="52" stroke-dasharray="' + C_R.toFixed(2) + '" stroke-dashoffset="' + (C_R * (1 - frac)).toFixed(2) + '"/>' +
        '</svg><div class="rest-count" id="rest-count">' + left + '</div></div>' +
        '<div class="kicker">שניות · ' + (nxt ? 'הבא: ' + esc(nxt.name) : '') + '</div>' +
        '<button type="button" class="btn" data-action="skip-rest">דלג</button></div>'
      : '';
    const chips = C.WORKOUT_TYPES.map(function (tp) {
      return '<button type="button" class="chip' + (sess.type === tp.id ? ' active' : '') + '" data-action="live-type" data-type="' + tp.id + '">' + esc(tp.label) + '</button>';
    }).join('');
    const exList = sess.exercises.map(function (item, i) {
      const done = item.sets.length;
      const target = Number(item.targetSets) || 0;
      const sets = item.sets.map(function (s, si) {
        return 'סט ' + (si + 1) + ' ' + s.weight + '×' + s.reps + (s.pr ? ' ⭐' : '');
      }).join(' · ') || 'אין סטים עדיין';
      return '<button type="button" class="list-item' + (i === sess.currentEx ? ' on' : '') + '" data-action="live-select-ex" data-index="' + i + '">' +
        '<div class="title">' + (i + 1) + '. ' + esc(item.name) + (target ? ' · ' + done + '/' + target : '') + '</div>' +
        '<div class="sub">' + esc(sets) + '</div></button>';
    }).join('');
    const suggest = ex ? (ex.suggestReason || '') : '';
    const planned = ex && ex.targetSets
      ? '<p class="planned">מתוכנן: ' + ex.targetSets + ' סטים × ' + (ex.repsMin === ex.repsMax ? ex.repsMin : (ex.repsMin + '–' + ex.repsMax)) + ' · יעד ' + (ex.targetWeight || '—') + ' ק״ג</p>'
      : '';
    const setList = ex ? '<ul class="set-list">' +
      (ex.sets.map(function (s, i) {
        return '<li class="done"><span>סט ' + (i + 1) + '</span><span>' + s.weight + ' × ' + s.reps + (s.pr ? ' ⭐' : '') + '</span></li>';
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
        ? ('<section class="card live-ex"><h1>' + esc(ex.name) + '</h1>' + planned +
          lastHtml +
          (ex.notes ? '<p class="hp-legend">' + esc(ex.notes) + '</p>' : '') +
          (suggest ? '<p class="suggest-reason">' + esc(suggest) + '</p>' : '') +
          (pr.isPR ? '<div class="live-pr">⭐ שיא חדש בסט הזה! ' + prTags(pr.types) + '</div>' : '') +
          setList +
          '<div class="step-grid">' +
          '<div class="step-col"><div class="label">משקל (ק״ג)</div>' +
          '<div class="big-stepper">' +
          '<button type="button" class="step-btn" data-action="live-step" data-field="weight" data-delta="-2.5">−2.5</button>' +
          '<button type="button" class="step-btn sm" data-action="live-step" data-field="weight" data-delta="-1.25">−1.25</button>' +
          '<div class="step-val" id="live-weight">' + sess.draft.weight + '</div>' +
          '<button type="button" class="step-btn sm" data-action="live-step" data-field="weight" data-delta="1.25">+1.25</button>' +
          '<button type="button" class="step-btn" data-action="live-step" data-field="weight" data-delta="2.5">+2.5</button>' +
          '</div></div>' +
          '<div class="step-col"><div class="label">חזרות</div>' +
          '<div class="big-stepper">' +
          '<button type="button" class="step-btn" data-action="live-step" data-field="reps" data-delta="-1">−</button>' +
          '<div class="step-val" id="live-reps">' + sess.draft.reps + '</div>' +
          '<button type="button" class="step-btn" data-action="live-step" data-field="reps" data-delta="1">+</button>' +
          '</div></div></div>' +
          '<button type="button" class="btn primary wide live-log" data-action="live-log">רשום סט ' + (ex.sets.length + 1) + '</button>' +
          '<div class="live-actions">' +
          (ex.sets.length ? '<button type="button" class="btn" data-action="live-undo">בטל סט</button>' : '') +
          (nxt ? '<button type="button" class="btn" data-action="live-skip">דלג לתרגיל הבא</button>' : '') +
          '</div></section>')
        : '<section class="card"><p>הוסיפו תרגיל כדי להתחיל לתעד סטים.</p></section>') +
      '<section class="card"><h2>הוסף תרגיל</h2>' +
      '<div class="live-add"><input type="text" id="live-ex-name" placeholder="שם התרגיל" autocomplete="off" />' +
      '<button type="button" class="btn primary" data-action="live-add-ex">הוספה</button></div>' +
      '<div id="live-ex-suggest" class="ex-suggest" hidden></div></section>' +
      '<div class="rest-pref"><span>מנוחה אחרי סט</span>' +
      '<button type="button" class="chip' + (sess.restSec === 60 ? ' active' : '') + '" data-action="live-rest" data-sec="60">60 שנ׳</button>' +
      '<button type="button" class="chip' + (sess.restSec === 90 ? ' active' : '') + '" data-action="live-rest" data-sec="90">90 שנ׳</button>' +
      '<button type="button" class="chip' + (sess.restSec === 120 ? ' active' : '') + '" data-action="live-rest" data-sec="120">120 שנ׳</button>' +
      '</div>' +
      (exList ? '<div class="section-title"><h2>האימון הזה</h2></div><div class="list">' + exList + '</div>' : '');
  }

  function renderLiveSummary() {
    const sum = ui.liveSummary;
    if (!sum) return '';
    const prs = (sum.prs || []).map(function (p) {
      return '<li>' + esc(p.name) + ' · ' + p.weight + '×' + p.reps + ' ' + prTags(p.types) + '</li>';
    }).join('');
    return '<header class="page-head"><h1>אימון הושלם 💪</h1></header>' +
      '<section class="card">' +
      '<div class="stats-grid">' +
      '<div class="metric-pill"><div class="label">זמן</div><div class="value">' + sum.durationMin + ' <span class="unit">דק׳</span></div></div>' +
      '<div class="metric-pill"><div class="label">נפח</div><div class="value">' + ltr(String(Math.round(sum.volume))) + '</div></div>' +
      '<div class="metric-pill"><div class="label">שיאים</div><div class="value">' + (sum.prs || []).length + '</div></div>' +
      '<div class="metric-pill"><div class="label">XP</div><div class="value">+' + sum.xp + '</div></div>' +
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
    if (last) {
      const e = last.last;
      if (force || !draft.exercises[i].sets) draft.exercises[i].sets = e.sets;
      if (force || !draft.exercises[i].reps) draft.exercises[i].reps = e.reps;
      if (force || !draft.exercises[i].weight) draft.exercises[i].weight = e.weight;
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
      return e && (e.name || e.sets || e.reps || e.weight);
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
    toast('האימון נשמר · +' + C.XP_RULES.workoutLogged.xp + ' XP');
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
    if (!ui.editingTemplate.exercises[i]) return;
    const k = el.dataset.texk;
    const num = ['sets', 'repsMin', 'repsMax', 'weight', 'restSec'].indexOf(k) >= 0;
    ui.editingTemplate.exercises[i][k] = num ? (el.value === '' ? '' : Number(el.value)) : el.value;
  }
  function collectTemplateDraft() {
    if (!ui.editingTemplate) return;
    const name = document.getElementById('tpl-name');
    if (name) ui.editingTemplate.name = name.value;
    document.querySelectorAll('[data-tex]').forEach(syncTex);
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

  function onClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn) {
      if (ev.target.id === 'overlay') closeModal();
      return;
    }
    if (btn.disabled) return;
    const action = btn.dataset.action;
    const s = state();

    if (action === 'tab') { setTab(btn.dataset.tab); return; }
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
    if (action === 'sync-magic') {
      const emailEl = document.getElementById('sync-email');
      const email = emailEl && emailEl.value.trim();
      if (!email) { toast('יש להזין אימייל'); return; }
      FitSync.sendMagicLink(email).then(function () { toast('נשלח קישור למייל'); }).catch(function (e) { toast('שליחה נכשלה'); });
      return;
    }
    if (action === 'sync-now') {
      toast('מסנכרן…');
      FitSync.syncNow().then(function () { toast('הסנכרון הושלם'); render(); }).catch(function () { toast('הסנכרון נכשל'); render(); });
      return;
    }
    if (action === 'sync-signout') { FitSync.signOut(); toast('התנתקתם'); render(); return; }
    if (action === 'whoop-connect') {
      ev.preventDefault();
      const url = FitSync.whoopStartUrl();
      if (url) location.href = url;
      else toast('חיבור Whoop לא מוכן');
      return;
    }
    if (action === 'whoop-refresh') {
      FitSync.whoopRefresh().then(function () { return FitSync.syncNow(); }).then(function () { toast('נתוני Whoop עודכנו'); render(); }).catch(function () { toast('המשיכה נכשלה'); });
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
      ui.editingTemplate.exercises.push({
        id: 'tex_' + Date.now(), name: String(name).trim(), sets: 3,
        repsMin: sug.reps || 8, repsMax: sug.reps || 12, weight: sug.weight || '', restSec: 90, notes: '', supersetId: ''
      });
      render();
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
      const sid = 'ss_' + Date.now();
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
    if (action === 'live-log') {
      const row = root.FitLive.logSet();
      if (!row) { toast('יש להזין משקל או חזרות'); return; }
      if (row.pr) toast('שיא חדש! ⭐');
      render();
      return;
    }
    if (action === 'live-undo') { root.FitLive.undoLastSet(); render(); return; }
    if (action === 'skip-rest') { root.FitLive.cancelRest(); render(); return; }
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
    if (action === 'bump-water') { bump(btn.dataset.date, 'water', Number(btn.dataset.delta)); return; }
    if (action === 'set-water') {
      const cur = Store.getNutrition(btn.dataset.date);
      const val = Number(btn.dataset.value);
      const next = cur && Number(cur.water) === val ? val - 1 : val;
      Store.upsertNutrition(btn.dataset.date, { water: Math.max(0, next) });
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
          if (el) el.textContent = ev.left;
          const ring = document.getElementById('rest-prog');
          if (ring && root.FitLive.restTotal) {
            const total = root.FitLive.restTotal() || 90;
            const C_R = 2 * Math.PI * 52;
            ring.setAttribute('stroke-dashoffset', (C_R * (1 - ev.left / total)).toFixed(2));
          }
        } else if (ev.type === 'rest-done') {
          toast('המנוחה נגמרה');
          render();
        }
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && root.FitLive.getSession()) {
          root.FitLive.requestWakeLock();
        }
      });
    }
    Store.subscribe(function () { maybeCelebrate(); render(); });
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', function (ev) {
      const el = ev.target;
      if (el && (el.dataset.draft || el.dataset.ex != null)) syncDraftFromInput(el);
      if (el && el.dataset.exk === 'name') updateExAutocomplete(el);
      if (el && el.id === 'live-ex-name') updateLiveExSuggest(el);
      if (el && el.dataset.tex != null) syncTex(el);
      if (el && el.dataset.meal != null) syncMeal(el);
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
