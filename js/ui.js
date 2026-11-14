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
    exerciseBack: 'progress',
    exerciseSort: 'recent'
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
    ui.modal = null;
    render();
  }

  /* ---------- screens ---------- */

  function demoBanner() {
    if (!Store.isDemoMode()) return '';
    return '<div class="banner demo-banner">' +
      '<p><strong>מצב דמו</strong> — הנתונים להדגמה בלבד. הנתונים האמיתיים שלך לא נמחקו ולא הוחלפו.</p>' +
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
    const pct = cons.hasData ? Math.round(cons.combined * 100) + '%' : '—';
    const unlocked = badges.filter(function (b) { return b.unlocked; });
    const todayBits = xp.todayEvents.map(function (e) { return ltr('+' + e.xp) + ' ' + esc(e.label); });
    const metrics = E.bestMetricsByDate(s)[today];

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

    return install + emptyDemoCta() +
      '<header class="page-head"><div>' +
      '<p class="kicker">' + esc(dateLabel) + '</p>' +
      '<h1>שלום, ' + esc(name) + '</h1>' +
      '</div><button type="button" class="btn primary" data-action="start-live">אימון חי</button></header>' +

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
      '</div><div class="hp-pct ' + hpClass(cons.combined, cons.hasData) + '">' +
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

      '<section class="card"><h2>היום</h2>' +
      '<div class="today-row"><div class="today-ico">🏋️</div><div>' +
      '<div class="label">אימון</div>' +
      '<div class="value' + (workouts.length ? '' : ' muted') + '">' + esc(workoutLine) + '</div></div>' +
      (workouts.length ? '' : '<button type="button" class="btn tiny primary" data-action="open-workout">תיעוד</button>') +
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
      '<div class="today-row"><div class="today-ico">⚖️</div><div>' +
      '<div class="label">משקל</div>' +
      '<div class="value' + (weightToday || lastW ? '' : ' muted') + '">' +
      (weightToday ? ltr(String(weightToday.weight)) + ' ק״ג' : (lastW ? 'אחרון: ' + ltr(String(lastW.weight)) + ' ק״ג (' + esc(E.formatDay(lastW.date)) + ')' : 'טרם תועד')) +
      '</div></div>' +
      '<button type="button" class="btn tiny" data-action="open-weight">+' + (weightToday ? 'עדכון' : 'משקל') + '</button>' +
      '</div>' +
      renderTodayMetrics(metrics) +
      '</section>' +

      '<button type="button" class="btn primary wide live-start-btn" data-action="start-live">▶  התחל אימון חי</button>' +

      '<div class="section-title"><h2>הוספה מהירה</h2></div>' +
      '<div class="quick-row" style="grid-template-columns:repeat(4,1fr)">' +
      '<button type="button" class="btn" data-action="open-workout">+ אימון</button>' +
      '<button type="button" class="btn" data-action="tab" data-tab="nutrition">+ תזונה</button>' +
      '<button type="button" class="btn" data-action="open-weight">+ משקל</button>' +
      '<button type="button" class="btn" data-action="open-metrics">+ מדדים</button>' +
      '</div>' +

      renderMiniBodyMap(s) +
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
    return '<header class="page-head"><h1>אימונים</h1>' +
      '<div class="actions">' +
      '<button type="button" class="btn primary" data-action="start-live">אימון חי</button>' +
      '<button type="button" class="btn" data-action="open-workout">תיעוד ידני</button>' +
      '</div></header>' + body;
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

    return '<header class="page-head"><h1>תזונה</h1></header>' +
      '<div class="day-nav">' +
      '<button type="button" class="btn" data-action="shift-day" data-delta="-1" aria-label="היום הקודם">→</button>' +
      '<h2>' + esc(title) + '</h2>' +
      '<button type="button" class="btn" data-action="shift-day" data-delta="1" aria-label="היום הבא" ' + (isToday ? 'disabled' : '') + '>←</button>' +
      '</div>' +
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

  function renderProgress() {
    const s = state();
    const today = E.todayISO();
    const hasAny = s.workouts.length || s.nutrition.length || s.weights.length || s.metrics.length;
    if (!hasAny) {
      return '<header class="page-head"><h1>התקדמות</h1></header>' +
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
        color: '#6aa8ff',
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
          color: '#3ee0a0',
          aria: 'התאוששות'
        }) +
        '<p class="hp-legend">קו מקווקו: יעד התאוששות (' + C.XP_RULES.metrics.recoveryPct.min + '%).</p>' +
        Charts.lineChart({
          labels: last.map(function (d) { return E.parseISO(d).toLocaleDateString('he-IL', { day: 'numeric' }); }),
          values: last.map(function (d) { return metricMap[d] ? metricMap[d].sleepHours : null; }),
          target: C.XP_RULES.metrics.sleepHours.min,
          color: '#6aa8ff',
          aria: 'שינה'
        }) +
        '</section>';
    }

    const xp = E.computeXP(s);
    const badges = E.computeAchievements(s, xp);

    return '<header class="page-head"><h1>התקדמות</h1></header>' +
      renderBodyMapCard(s, false) +
      '<section class="card"><h2>אימונים לפי שבוע</h2>' +
      Charts.barChart({
        labels: weekCounts.map(function (w) { return w.label; }),
        values: weekCounts.map(function (w) { return w.value; }),
        target: weeklyTarget,
        color: '#6aa8ff',
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
      Charts.barChart({ labels: labels, values: list.map(function (sess) { return sess.volume; }), marks: marks, color: '#6aa8ff', aria: 'נפח כולל', height: 170 }) +
      '<p class="hp-legend">נפח = סטים × חזרות × משקל. נקודה צהובה / עמודה צהובה = שיא.</p></section>' +
      '<section class="card"><h2>משקל בסט הכבד</h2>' +
      Charts.lineChart({ labels: labels, values: list.map(function (sess) { return sess.topWeight; }), marks: marks, color: '#3ee0a0', tighten: true, aria: 'משקל בסט הכבד' }) +
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
    return '<header class="page-head"><h1>הגדרות</h1></header>' + demoCard +
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
      '<p class="hp-legend" style="margin-bottom:12px">הנתונים נשמרים במכשיר הזה בלבד. ייצוא יוצר קובץ JSON שאפשר לייבא בגיבוי או במכשיר אחר.</p>' +
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

      '<section class="card"><h2>חיבורים בהמשך</h2>' +
      '<p class="hp-legend">אינטגרציית Whoop (התאוששות, Strain, שינה, HRV כמקור XP) ורשת חברתית מתוכננות לגרסאות הבאות. המודל כבר תומך במדדים עם שדה מקור (manual / whoop).</p>' +
      '</section>' +

      '<section class="card"><button type="button" class="btn danger wide" data-action="confirm-clear">מחיקת כל הנתונים</button></section>';
  }

  /* ---------- modals ---------- */

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
    else overlay.innerHTML = '';
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
      '<button type="button" class="btn" data-action="close-modal">ביטול</button>' +
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
    const pr = L.prForDraft();
    const lastSets = ex ? E.lastSessionSets(state(), ex.name, null) : [];
    const lastHtml = lastSets.length
      ? '<div class="last-sets"><div class="label">פעם קודמת</div><div class="set-pills">' +
        lastSets.map(function (s, i) {
          return '<span class="set-pill">סט ' + (i + 1) + ': ' + s.weight + '×' + s.reps + '</span>';
        }).join('') + '</div></div>'
      : '<p class="hp-legend">אין היסטוריה לתרגיל הזה עדיין.</p>';
    const restBar = left > 0
      ? '<div class="rest-banner" id="rest-banner"><div class="rest-label">מנוחה</div>' +
        '<div class="rest-count" id="rest-count">' + left + '</div><div class="kicker">שניות</div>' +
        '<button type="button" class="btn" data-action="skip-rest">דלג</button></div>'
      : '';
    const chips = C.WORKOUT_TYPES.map(function (tp) {
      return '<button type="button" class="chip' + (sess.type === tp.id ? ' active' : '') + '" data-action="live-type" data-type="' + tp.id + '">' + esc(tp.label) + '</button>';
    }).join('');
    const exList = sess.exercises.map(function (item, i) {
      const sets = item.sets.map(function (s, si) {
        return 'סט ' + (si + 1) + ' ' + s.weight + '×' + s.reps + (s.pr ? ' ⭐' : '');
      }).join(' · ') || 'אין סטים עדיין';
      return '<button type="button" class="list-item' + (i === sess.currentEx ? ' on' : '') + '" data-action="live-select-ex" data-index="' + i + '">' +
        '<div class="title">' + esc(item.name) + '</div><div class="sub">' + esc(sets) + '</div></button>';
    }).join('');
    const suggest = ex ? (ex.suggestReason || '') : '';
    return '<header class="live-head">' +
      '<button type="button" class="btn ghost" data-action="cancel-live">יציאה</button>' +
      '<div class="live-clock"><div class="kicker">זמן אימון</div><div id="elapsed-clock" class="clock">' + formatElapsed(L.elapsedMs()) + '</div></div>' +
      '<button type="button" class="btn primary" data-action="finish-live">סיום</button>' +
      '</header>' +
      '<div class="field"><span>סוג אימון</span><div class="chips">' + chips + '</div></div>' +
      restBar +
      (ex
        ? ('<section class="card live-ex"><h1>' + esc(ex.name) + '</h1>' +
          lastHtml +
          (suggest ? '<p class="suggest-reason">' + esc(suggest) + '</p>' : '') +
          (pr.isPR ? '<div class="live-pr">⭐ שיא חדש בסט הזה! ' + prTags(pr.types) + '</div>' : '') +
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
          (ex.sets.length ? '<button type="button" class="linkish wide-link" data-action="live-undo">בטל סט אחרון</button>' : '') +
          '</section>')
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
      '<button type="button" class="btn primary wide" data-action="close-summary">למסך הבית</button>' +
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
    else if (ui.exerciseName) html += renderExerciseDetail();
    else if (ui.tab === 'home') html += renderHome();
    else if (ui.tab === 'workouts') html += renderWorkouts();
    else if (ui.tab === 'nutrition') html += renderNutrition();
    else if (ui.tab === 'progress') html += renderProgress();
    else if (ui.tab === 'settings') html += renderSettings();
    main.innerHTML = html;
    document.body.classList.toggle('is-demo', Store.isDemoMode());
    document.body.classList.toggle('is-live', liveOn);

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

  function exportData() {
    const payload = Store.exportJSON();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (Store.isDemoMode() ? 'fit-tracker-demo-' : 'fit-tracker-backup-') + E.todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    toast('הקובץ ירד');
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const payload = JSON.parse(String(reader.result));
        Store.importJSON(payload);
        closeModal();
        toast('הנתונים יובאו');
      } catch (err) {
        toast('קובץ לא תקין');
      }
    };
    reader.readAsText(file);
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
    if (action === 'start-live' || action === 'resume-live') { openLive(); return; }
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
      Store.enterDemoMode();
      ui.exerciseName = null;
      toast('נטענו נתוני דמו');
      setTab('home');
      return;
    }
    if (action === 'exit-demo') {
      Store.exitDemoMode();
      ui.exerciseName = null;
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
          closeModal();
          toast('הנתונים נמחקו');
        }
      });
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
    if (tab === 'live') {
      ui.tab = 'live';
      return;
    }
    if (['home', 'workouts', 'nutrition', 'progress', 'settings'].indexOf(tab) >= 0) ui.tab = tab;
  }

  function onHash() {
    if (ui.modal) return;
    parseHash();
    render();
  }

  function init() {
    Store.load();
    try {
      if (new URLSearchParams(location.search).get('demo') === '1' && !Store.isDemoMode()) {
        Store.enterDemoMode();
      }
    } catch (err) { /* ignore */ }
    ui.nutritionDate = E.todayISO();
    parseHash();

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
    Store.subscribe(function () { render(); });
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', function (ev) {
      const el = ev.target;
      if (el && (el.dataset.draft || el.dataset.ex != null)) syncDraftFromInput(el);
      if (el && el.dataset.exk === 'name') updateExAutocomplete(el);
      if (el && el.id === 'live-ex-name') updateLiveExSuggest(el);
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
