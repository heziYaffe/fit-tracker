/* פיט — optional AI (Gemini via our Supabase `llm` function, budget-capped on
   the server). The API key never reaches the device. Everything here degrades
   to the rule-based behaviour: if the user is signed out, the cap or the free
   quota is reached, or Gemini is busy, callers get an error and keep going.
   Uses: (1) FitFood text provider (only for food the rules did not match),
   (2) FitFood menu provider (menu wizard), (3) the workout plan builder sheet.
   The model never produces numbers we store: nutrition comes from the food
   table, weights from FitEngine.recommendNextLoad. */
(function (root) {
  'use strict';

  const USAGE_KEY = 'hazi-fit-ai-usage';
  const OFF_KEY = 'hazi-fit-ai-off';

  function cfg() { return root.FitCloudConfig || {}; }
  function sync() { return root.FitSync; }
  function fnUrl() {
    const c = cfg();
    if (c.LLM_FN_URL) return c.LLM_FN_URL.replace(/\/+$/, '');
    return c.SUPABASE_URL ? c.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/llm' : '';
  }
  function disabled() { try { return localStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; } }
  function setDisabled(off) { try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch (e) { /* ignore */ } }
  function available() {
    const S = sync();
    if (disabled() || !fnUrl() || !S || !S.authedFetch || !S.status) return false;
    const st = S.status();
    return !!(st.configured && st.signedIn);
  }

  function aiError(code, message) {
    const e = new Error(message || 'ה-AI לא זמין כרגע. ממשיכים בלי AI.');
    e.code = code || 'busy';
    return e;
  }

  function saveUsage(u) {
    if (!u || u.month_usd == null) return;
    const prev = lastUsage() || {};
    const next = Object.assign({}, prev, { month_usd: Number(u.month_usd) || 0, cap_usd: Number(u.cap_usd) || prev.cap_usd || 10, at: new Date().toISOString() });
    if (u.today_calls != null) { next.today_calls = u.today_calls; next.daily_limit = u.daily_limit; }
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  }
  function lastUsage() {
    try { return JSON.parse(localStorage.getItem(USAGE_KEY) || 'null'); } catch (e) { return null; }
  }

  function call(task, body, opts) {
    opts = opts || {};
    if (!available()) return Promise.reject(aiError('off', 'ה-AI זמין אחרי התחברות לחשבון.'));
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const ms = opts.timeoutMs || 45000;
    const timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return sync().authedFetch(fnUrl() + '/' + task, {
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (data && (data.month_usd != null)) saveUsage(data);
        if (!res.ok || (data && data.error)) throw aiError((data && data.error) || ('http' + res.status), data && data.message);
        return data;
      });
    }, function () {
      throw aiError('busy', 'אין חיבור ל-AI כרגע. ממשיכים בלי AI.');
    }).finally(function () { clearTimeout(timer); });
  }

  function refreshUsage() {
    if (!available()) return Promise.resolve(lastUsage());
    return call('usage', null, { timeoutMs: 10000 }).then(function (u) { saveUsage(u); return lastUsage(); }, function () { return lastUsage(); });
  }

  function usageLine() {
    const u = lastUsage();
    const spent = u ? Number(u.month_usd) || 0 : 0;
    const cap = u ? Number(u.cap_usd) || 10 : 10;
    return 'שימוש AI החודש: $' + (spent < 0.01 && spent > 0 ? spent.toFixed(3) : spent.toFixed(2)) + ' מתוך $' + cap;
  }

  function notice(err) {
    const msg = err && err.message;
    if (!msg) return;
    if (root.FitUI && root.FitUI.toast) root.FitUI.toast(msg);
  }

  // ---------- (1) free-text food ----------
  function foodProvider(ctx) {
    if (!available()) return Promise.resolve([]);
    const F = root.FitFood;
    const names = F && F.DB ? F.DB.map(function (f) { return f.name; }) : [];
    // Only the parts the rules could not match go to the model, so nothing is
    // counted twice (the hook keeps the rule-matched items as they are).
    const parts = (ctx.unmatched || []).map(function (u) { return u.text || u.query || ''; }).filter(Boolean);
    const text = (parts.length ? parts.join(', ') : String(ctx.text || '')).slice(0, 600);
    return call('food', { text: text, names: names }, { timeoutMs: 12000 })
      .then(function (r) { return (r && r.items) || []; }, function (e) { notice(e); return []; });
  }

  // ---------- (2) menu wizard ----------
  let lastMenuReply = '';
  function menuProvider(prefs, ctx) {
    lastMenuReply = '';
    if (!available()) return Promise.reject(aiError('off'));
    const F = root.FitFood;
    // Disliked/excluded foods are already removed from the catalog (and are
    // re-checked on the reply), so the model never sees them. `blocked` lets
    // the server drop them too, without putting them in the prompt.
    const blocked = F && F.blockedIds ? Object.keys(F.blockedIds(prefs)) : (prefs.dislikes || []);
    const body = {
      prefs: {
        protein: prefs.protein, calories: prefs.calories, meals: prefs.meals, goal: prefs.goal,
        excludes: excludeLabels(prefs.excludes), note: prefs.note || '', change: prefs.change || ''
      },
      slots: (ctx && ctx.slots) || [],
      blocked: blocked,
      catalog: (ctx && ctx.catalog) || [],
      current: prefs.current ? compactMenu(prefs.current) : null
    };
    return call('menu', body, { timeoutMs: 28000 }).then(function (r) {
      lastMenuReply = (r && r.reply) || '';
      return r;
    }, function (e) { throw e; }); // the menu screen shows its own failure card
  }
  // (2b) the menu chat (v48): one message → reply, action, menu, memory ops
  function menuChat(body) {
    if (!available()) return Promise.reject(aiError('off', 'הצ׳אט עם ה-AI זמין אחרי התחברות לחשבון.'));
    return call('menuchat', body, { timeoutMs: 28000 });
  }
  function excludeLabels(ids) {
    const opts = (root.FitFood && root.FitFood.EXCLUDE_OPTIONS) || [];
    return (ids || []).map(function (id) { const o = opts.find(function (x) { return x.id === id; }); return o ? o.label : id; });
  }
  function compactMenu(menu) {
    return ((menu && menu.meals) || []).map(function (m) {
      return { name: m.name, foods: (m.foods || []).map(function (f) { return { dbId: f.dbId, grams: f.grams, name: f.name }; }) };
    });
  }

  // ---------- (3) workout plan builder ----------
  const GOALS = [['strength', 'כוח'], ['hypertrophy', 'מסה'], ['cut', 'חיטוב'], ['general', 'כושר כללי']];
  const EQUIP = [['gym', 'חדר כושר מלא'], ['home', 'משקולות בבית'], ['bodyweight', 'משקל גוף']];
  let plan = null;

  function newPlanState() {
    return { goal: 'hypertrophy', days: 3, minutes: 60, equipment: 'gym', note: '', messages: [], result: null, reply: '', busy: false, error: '' };
  }
  function planState() { if (!plan) plan = newPlanState(); return plan; }
  function resetPlan() { plan = newPlanState(); }

  function knownExercises(state) {
    const seen = {};
    const out = [];
    function add(n) { n = String(n || '').trim(); if (n && !seen[n]) { seen[n] = 1; out.push(n); } }
    ((state && state.workouts) || []).slice(-80).forEach(function (w) { (w.exercises || []).forEach(function (e) { add(e.name); }); });
    ((state && state.templates) || []).forEach(function (t) { (t.exercises || []).forEach(function (e) { add(e.name); }); });
    const C = root.FitConfig || {};
    Object.keys(C.EXERCISE_MUSCLES || {}).forEach(add);
    return out.slice(0, 150);
  }

  function recoveryToday(state) {
    const E = root.FitEngine;
    try {
      const snap = E && E.metricSnapshot ? E.metricSnapshot(state, E.todayISO()) : null;
      return snap && snap.recoveryPct != null ? Math.round(Number(snap.recoveryPct)) : null;
    } catch (e) { return null; }
  }

  function label(list, id) { const f = list.find(function (x) { return x[0] === id; }); return f ? f[1] : id; }

  function planRequest(state, userText) {
    const p = planState();
    const body = {
      prefs: { goal: label(GOALS, p.goal), days: p.days, minutes: p.minutes, equipment: label(EQUIP, p.equipment), note: p.note },
      known: knownExercises(state),
      recovery: recoveryToday(state),
      messages: p.messages.slice(-8),
      current: p.result || null
    };
    if (userText) body.messages = body.messages.concat([{ role: 'user', text: userText }]);
    return body;
  }

  function askPlan(state, userText) {
    const p = planState();
    p.busy = true;
    p.error = '';
    const body = planRequest(state, userText);
    return call('plan', body, { timeoutMs: 62000 }).then(function (r) {
      if (userText) p.messages.push({ role: 'user', text: userText });
      if (r.reply) p.messages.push({ role: 'model', text: r.reply });
      p.reply = r.reply || '';
      if (r.plan) p.result = r.plan;
      p.busy = false;
      return p;
    }, function (e) {
      p.busy = false;
      p.error = e.message;
      throw e;
    });
  }

  // Template rows in the store's format, with loads from the engine.
  function planToTemplates(state, result) {
    const E = root.FitEngine;
    const C = root.FitConfig || {};
    let ss = 0;
    return ((result && result.days) || []).map(function (d) {
      let open = '';
      const exercises = (d.exercises || []).map(function (ex) {
        const isStatic = !!(C.isStaticName && C.isStaticName(ex.name)) || (!ex.repsMin && !ex.repsMax);
        const row = { name: ex.name, sets: ex.sets, restSec: ex.restSec || '', notes: ex.notes || '' };
        if (isStatic) {
          row.static = true;
          const m = String(ex.notes || '').match(/(\d{2,3})/);
          row.secsMin = row.secsMax = m ? Number(m[1]) : 45;
        } else {
          row.repsMin = ex.repsMin; row.repsMax = ex.repsMax;
        }
        let rec = null;
        try { rec = E && E.recommendNextLoad ? E.recommendNextLoad(state, ex.name, { sets: ex.sets, repsMin: ex.repsMin, repsMax: ex.repsMax }) : null; } catch (e) { rec = null; }
        if (rec && rec.kind === 'weight' && rec.weight > 0) row.weight = rec.weight;
        if (ex.supersetWithNext) { if (!open) { ss += 1; open = 'ai_ss_' + Date.now().toString(36) + '_' + ss; } row.supersetId = open; }
        else if (open) { row.supersetId = open; open = ''; }
        return row;
      });
      return { name: d.name, days: [Number(d.weekday) || 0], type: d.type || 'custom', exercises: exercises };
    });
  }

  function savePlan(state) {
    const p = planState();
    if (!p.result) return 0;
    const Store = root.FitStore;
    const rows = planToTemplates(state, p.result);
    rows.forEach(function (t) { Store.addTemplate(t); });
    return rows.length;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function chips(list, cur, action) {
    return '<div class="chips">' + list.map(function (o) {
      return '<button type="button" class="chip' + (String(cur) === String(o[0]) ? ' active' : '') + '" data-action="' + action + '" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function renderPlanSheet(state) {
    const p = planState();
    const C = root.FitConfig || {};
    const E = root.FitEngine;
    const dayName = function (n) { const d = (C.DAY_NAMES || []).find(function (x) { return x.id === Number(n); }); return d ? d.label : ''; };
    let body = '';
    if (!available()) {
      body = '<p class="hp-legend">בניית תוכנית עם AI זמינה אחרי התחברות לחשבון (הגדרות ← חשבון וסנכרון).</p>';
    } else if (!p.result) {
      body = '<section class="card"><h2>מה המטרה?</h2>' + chips(GOALS, p.goal, 'aip-goal') + '</section>' +
        '<section class="card"><h2>כמה ימים בשבוע?</h2>' + chips([[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], p.days, 'aip-days') +
        '<h2 style="margin-top:12px">כמה זמן לאימון?</h2>' + chips([[30, '30 דק׳'], [45, '45'], [60, '60'], [75, '75'], [90, '90']], p.minutes, 'aip-min') +
        '<h2 style="margin-top:12px">ציוד</h2>' + chips(EQUIP, p.equipment, 'aip-eq') + '</section>' +
        '<label class="field"><span>עוד משהו? (לא חובה)</span><textarea id="aip-note" rows="2" placeholder="למשל: כאב בכתף, אוהב סקוואט, רק א׳ ג׳ ה׳">' + esc(p.note) + '</textarea></label>' +
        (p.error ? '<p class="hp-legend">' + esc(p.error) + '</p>' : '') +
        '<button type="button" class="btn primary wide" data-action="aip-build"' + (p.busy ? ' disabled' : '') + '>' + (p.busy ? 'בונה תוכנית… (עד דקה)' : 'בנה לי תוכנית') + '</button>';
    } else {
      body = (p.reply ? '<section class="card"><p>' + esc(p.reply) + '</p></section>' : '') +
        p.result.days.map(function (d) {
          return '<section class="card"><h2>' + esc(d.name) + ' <span class="kicker">· ' + esc(dayName(d.weekday)) + '</span></h2>' +
            '<div class="list">' + d.exercises.map(function (ex) {
              let rec = null;
              try { rec = E.recommendNextLoad(state, ex.name, { sets: ex.sets, repsMin: ex.repsMin, repsMax: ex.repsMax }); } catch (e) { rec = null; }
              const reps = (ex.repsMin || ex.repsMax) ? (ex.repsMin === ex.repsMax ? ex.repsMin : ex.repsMin + '–' + ex.repsMax) : 'החזקה';
              return '<div class="list-item"><div class="title">' + esc(ex.name) + (ex.supersetWithNext ? ' <span class="kicker">· סופרסט עם הבא</span>' : '') + '</div>' +
                '<div class="sub"><span dir="ltr">' + ex.sets + '×' + esc(reps) + '</span>' + (ex.restSec ? ' · מנוחה ' + ex.restSec + ' שנ׳' : '') +
                (rec && rec.label ? ' · המלצה: ' + esc(rec.label) : '') + (ex.notes ? ' · ' + esc(ex.notes) : '') + '</div></div>';
            }).join('') + '</div></section>';
        }).join('') +
        '<label class="field"><span>מה לשנות?</span><textarea id="aip-ask" rows="2" placeholder="למשל: בלי דדליפט, יותר כתפיים, רק 45 דקות"></textarea></label>' +
        (p.error ? '<p class="hp-legend">' + esc(p.error) + '</p>' : '') +
        '<div class="btn-row" style="grid-template-columns:1fr 1fr">' +
        '<button type="button" class="btn" data-action="aip-ask"' + (p.busy ? ' disabled' : '') + '>' + (p.busy ? 'מעדכן…' : 'עדכן') + '</button>' +
        '<button type="button" class="btn primary" data-action="aip-save"' + (p.busy ? ' disabled' : '') + '>שמירה כתבניות</button></div>' +
        '<p class="hp-legend" style="text-align:center"><button type="button" class="linkish" data-action="aip-reset">להתחיל מחדש</button></p>';
    }
    return '<div class="sheet" role="dialog" aria-label="תוכנית אימונים עם AI"><div class="sheet-handle"></div>' +
      '<div class="sheet-head"><h2>תוכנית אימונים עם AI</h2>' +
      '<button type="button" class="btn ghost" data-action="close">סגירה</button></div>' + body +
      '<p class="hp-legend" style="text-align:center">המשקלים מגיעים ממנוע ההמלצות לפי ההיסטוריה שלך · ' + esc(usageLine()) + '</p></div>';
  }

  // Returns true when the action was handled. h = { state, render, toast, closeModal, setTab }.
  function handlePlanAction(action, btn, h) {
    if (action.indexOf('aip-') !== 0) return false;
    const p = planState();
    const note = document.getElementById('aip-note');
    if (note) p.note = note.value;
    if (action === 'aip-goal') p.goal = btn.dataset.val;
    else if (action === 'aip-days') p.days = Number(btn.dataset.val);
    else if (action === 'aip-min') p.minutes = Number(btn.dataset.val);
    else if (action === 'aip-eq') p.equipment = btn.dataset.val;
    else if (action === 'aip-reset') resetPlan();
    else if (action === 'aip-build' || action === 'aip-ask') {
      if (p.busy) return true;
      let text = '';
      if (action === 'aip-ask') {
        const ta = document.getElementById('aip-ask');
        text = ta ? String(ta.value || '').trim() : '';
        if (!text) { h.toast('כתוב מה לשנות'); return true; }
      }
      askPlan(h.state(), text).then(function () { h.render(); }, function () { h.render(); });
    } else if (action === 'aip-save') {
      const n = savePlan(h.state());
      if (n) { h.toast('נשמרו ' + n + ' תבניות אימון'); resetPlan(); h.closeModal(); return true; }
    }
    h.render();
    return true;
  }

  function install() {
    const F = root.FitFood;
    if (!F) return;
    if (F.setTextProvider) F.setTextProvider(function (ctx) { return foodProvider(ctx); });
    if (F.setMenuProvider) F.setMenuProvider(function (prefs, ctx) { return menuProvider(prefs, ctx); });
  }
  install();

  root.FitAI = {
    available: available, call: call, usageLine: usageLine, lastUsage: lastUsage, refreshUsage: refreshUsage,
    disabled: disabled, setDisabled: setDisabled,
    foodProvider: foodProvider, menuProvider: menuProvider, menuChat: menuChat, lastMenuReply: function () { return lastMenuReply; },
    planState: planState, resetPlan: resetPlan, askPlan: askPlan, planToTemplates: planToTemplates, savePlan: savePlan,
    knownExercises: knownExercises, renderPlanSheet: renderPlanSheet, handlePlanAction: handlePlanAction
  };
})(typeof window !== 'undefined' ? window : globalThis);
