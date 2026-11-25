/* פיט — the menu chat (v48). One AI flow for the menu: every message goes to
   the model with the recent conversation, the current menu, the memory card
   and the targets from Settings. The reply can build a menu, edit it, ask a
   question or just answer, and can add/remove memory items. Changes go
   straight to «התפריט שלי» (all week) and can be undone one by one or all
   together. Hard "לא אוכל" items are enforced in code (blocked ids), not only
   in the prompt. Nutrition always comes from the food table. */
(function (root) {
  'use strict';

  const CHAT_KEY = 'hazi-fit-menu-chat';
  const MENU_NAME = 'התפריט שלי';
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const CATS = [['avoid', 'לא אוכל'], ['like', 'מועדף'], ['habit', 'הרגלים'], ['logistics', 'לוגיסטיקה'], ['goal', 'מטרות']];
  const CAT_LABEL = {};
  CATS.forEach(function (c) { CAT_LABEL[c[0]] = c[1]; });
  const GOAL_LABEL = { cut: 'חיטוב', bulk: 'מסה' };

  let provider = null;
  let busy = false;
  let chat = null;
  const listeners = [];

  function S() { return root.FitStore; }
  function F() { return root.FitFood; }
  function E() { return root.FitEngine; }
  function uid() { return S() && S().uid ? S().uid() : 'm' + Math.random().toString(36).slice(2, 10); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function now() { return new Date().toISOString(); }
  function norm(t) { return String(t || '').replace(/["'`.,!?״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); }

  // ---------- memory card ----------
  // Built once from the wizard's saved preferences (chips, dislikes, words).
  function migrateMemory(set) {
    const p = (set && set.menuPrefs) || {};
    const Fd = F();
    const out = [];
    function has(t) { return out.some(function (m) { return norm(m.text) === norm(t); }); }
    (p.excludes || []).forEach(function (id) {
      const o = ((Fd && Fd.EXCLUDE_OPTIONS) || []).find(function (x) { return x.id === id; });
      if (!o) return;
      const veg = id === 'veg';
      out.push({ id: uid(), cat: veg ? 'habit' : 'avoid', text: veg ? 'צמחוני' : o.label.replace(/^בלי\s+/, ''), excl: id, src: 'prefs' });
    });
    (p.dislikes || []).forEach(function (id) {
      const f = Fd && Fd.byId ? Fd.byId[id] : null;
      if (f && !has(f.name)) out.push({ id: uid(), cat: 'avoid', text: f.name, dbId: id, src: 'prefs' });
    });
    (p.dislikeTerms || []).forEach(function (t) { if (t && !has(t)) out.push({ id: uid(), cat: 'avoid', text: String(t), src: 'prefs' }); });
    if (Number(p.meals) && Number(p.meals) !== 4) out.push({ id: uid(), cat: 'habit', text: p.meals + ' ארוחות ביום', src: 'prefs' });
    if (GOAL_LABEL[p.goal]) out.push({ id: uid(), cat: 'goal', text: GOAL_LABEL[p.goal], src: 'prefs' });
    return out;
  }

  function memory(state) {
    state = state || S().getState();
    const set = (state && state.settings) || {};
    return Array.isArray(set.menuMemory) ? set.menuMemory : migrateMemory(set);
  }
  function saveMemory(list) {
    S().updateSettings({ menuMemory: list.map(function (m) {
      const o = { id: m.id || uid(), cat: CAT_LABEL[m.cat] ? m.cat : 'habit', text: String(m.text || '').slice(0, 60), src: m.src || 'manual' };
      if (m.excl) o.excl = m.excl;
      if (m.dbId) o.dbId = m.dbId;
      if (m.at) o.at = m.at;
      return o;
    }) });
  }
  function addMemory(cat, text, src) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!text) return null;
    cat = CAT_LABEL[cat] ? cat : 'habit';
    const list = memory().slice();
    if (list.some(function (m) { return m.cat === cat && norm(m.text) === norm(text); })) return null;
    const item = { id: uid(), cat: cat, text: text, src: src || 'manual', at: now() };
    list.push(item);
    saveMemory(list);
    return item;
  }
  function updateMemory(id, patch) {
    const list = memory().map(function (m) {
      if (m.id !== id) return m;
      const next = Object.assign({}, m, patch);
      // edited text is read again from the words; the old chip link goes
      if (patch.text != null && norm(patch.text) !== norm(m.text)) { delete next.excl; delete next.dbId; }
      return next;
    }).filter(function (m) { return String(m.text || '').trim(); });
    saveMemory(list);
  }
  function removeMemory(id) {
    const list = memory();
    const item = list.find(function (m) { return m.id === id; }) || null;
    if (item) saveMemory(list.filter(function (m) { return m.id !== id; }));
    return item;
  }
  function restoreMemory(item) {
    if (!item) return;
    const list = memory().slice();
    if (list.some(function (m) { return m.id === item.id || (m.cat === item.cat && norm(m.text) === norm(item.text)); })) return;
    list.push(item);
    saveMemory(list);
  }

  // FitFood prefs from the memory card (+ the words of this message): every
  // "לא אוכל" item blocks its foods everywhere (catalog, reply, swaps).
  function prefs(state, extraText) {
    const p = { excludes: [], dislikes: [], rules: [], note: String(extraText || '') };
    memory(state).forEach(function (m) {
      if (m.excl) { if (p.excludes.indexOf(m.excl) < 0) p.excludes.push(m.excl); return; }
      if (m.cat === 'avoid') {
        if (m.dbId) p.dislikes.push(m.dbId);
        p.rules.push('בלי ' + m.text);
      } else if (/טבעוני|צמחוני/.test(m.text) && F() && F().textExcludes) {
        F().textExcludes(m.text).forEach(function (x) { if (p.excludes.indexOf(x) < 0) p.excludes.push(x); });
      }
    });
    return p;
  }

  function targets(state) {
    state = state || S().getState();
    return E().nutritionTargets(state);
  }

  // ---------- chat state (this device) ----------
  function freshChat(base, hasBase) { return { messages: [], changes: [], base: base || null, hasBase: !!hasBase }; }
  function load() {
    if (chat) return chat;
    try { chat = JSON.parse(localStorage.getItem(CHAT_KEY) || 'null'); } catch (e) { chat = null; }
    if (!chat || !Array.isArray(chat.messages)) chat = freshChat();
    if (!Array.isArray(chat.changes)) chat.changes = [];
    return chat;
  }
  function persist() { try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat)); } catch (e) { /* ignore */ } }

  // ---------- the saved menu ----------
  function savedMenu() { return (S().listMenus() || []).find(function (m) { return m.name === MENU_NAME; }) || null; }
  function currentMeals() { const m = savedMenu(); return m && m.meals && m.meals.length ? m.meals : null; }
  function eatenAny(day) { return !!(day && (day.meals || []).some(function (m) { return m.status === 'eaten'; })); }

  // One menu for the whole week; today follows unless a meal is already eaten.
  function writeMeals(meals) {
    const St = S();
    const ex = savedMenu();
    const today = E().todayISO();
    const day = St.getDayMenu(today);
    if (!meals || !meals.length) {
      if (ex) {
        if (day && day.menuId === ex.id && !eatenAny(day)) St.clearDayMenu(today);
        St.deleteMenu(ex.id);
      }
      return { meals: null, today: true };
    }
    const data = { name: MENU_NAME, days: ALL_DAYS.slice(), applyOn: '', meals: clone(meals) };
    const menu = ex ? St.updateMenu(ex.id, data) : St.addMenu(data);
    let applied = false;
    if (menu && !eatenAny(St.getDayMenu(today))) { St.applyMenuToDate(menu.id, today); applied = true; }
    return { meals: menu ? menu.meals : null, today: applied };
  }

  function foodKey(list) {
    return (list || []).map(function (f) { return (f.dbId || f.name || '') + ':' + Math.round(Number(f.grams) || 0); }).sort();
  }
  function sameFoods(a, b) {
    const x = foodKey(a), y = foodKey(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      const p = x[i].split(':'), q = y[i].split(':');
      if (p[0] !== q[0] || Math.abs(Number(p[1]) - Number(q[1])) > 1) return false;
    }
    return true;
  }
  function sameMeal(a, b) {
    return !!(a && b && a.name === b.name && (a.time || '') === (b.time || '') && (a.dish || '') === (b.dish || '') && sameFoods(a.foods, b.foods));
  }
  function sameList(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every(function (m, i) { return sameMeal(m, b[i]); });
  }

  function compact(meals) {
    return (meals || []).map(function (m) {
      return {
        name: m.name, time: m.time || '', dish: m.dish || '', prep: m.prep || '',
        foods: (m.foods || []).filter(function (f) { return f.dbId; }).map(function (f) { return { dbId: f.dbId, grams: Math.round(Number(f.grams) || 0), role: f.role || '' }; })
      };
    });
  }

  // ---------- talking to the model ----------
  function available() { return !!provider || !!(root.FitAI && root.FitAI.available && root.FitAI.available()); }
  function callModel(body) {
    if (provider) return Promise.resolve().then(function () { return provider(body); });
    if (!root.FitAI || !root.FitAI.menuChat) return Promise.reject(new Error('ה-AI לא זמין כרגע.'));
    return root.FitAI.menuChat(body);
  }

  function requestBody(state, text, fresh) {
    const pre = prefs(state, text);
    const t = targets(state);
    const cur = fresh ? null : currentMeals();
    return {
      messages: chat.messages.filter(function (m) { return !m.error && m.text; }).slice(-10)
        .map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', text: String(m.text).slice(0, 600) }; }),
      memory: memory(state).map(function (m) { return { cat: m.cat, text: m.text }; }),
      targets: { protein: t.protein, calories: t.calories, carbs: t.carbs, fat: t.fat },
      current: cur ? compact(cur) : null,
      catalog: F().catalog(pre),
      blocked: Object.keys(F().blockedIds(pre))
    };
  }

  // opts.fresh: a new menu from scratch → the conversation starts over (the
  // memory stays) and «ביטול כל השינויים» goes back to the menu before it.
  function send(text, opts) {
    opts = opts || {};
    text = String(text || '').trim().slice(0, 500);
    if (!text || busy) return Promise.resolve(null);
    load();
    if (opts.fresh) {
      const cur = currentMeals();
      chat = freshChat(cur ? clone(cur) : null, true);
    }
    chat.messages.push({ id: uid(), role: 'user', text: text, at: now() });
    chat.messages = chat.messages.slice(-60);
    persist();
    return run(text, opts);
  }

  function run(text, opts) {
    busy = true;
    notify();
    let body;
    try { body = requestBody(S().getState(), text, !!opts.fresh); } catch (e) { body = null; }
    const p = body ? callModel(body) : Promise.reject(new Error('לא הצלחתי להכין את הבקשה.'));
    return p.then(function (r) {
      busy = false;
      let msg;
      try { msg = apply(r, text, opts); } catch (e) { msg = failMsg(e, text, opts); }
      notify();
      return msg;
    }, function (err) {
      busy = false;
      const msg = failMsg(err, text, opts);
      notify();
      return msg;
    });
  }

  function failMsg(err, text, opts) {
    const msg = { id: uid(), role: 'model', error: true, text: (err && err.message) || 'ה-AI לא זמין כרגע.', retry: text, fresh: !!(opts && opts.fresh), at: now() };
    chat.messages.push(msg);
    persist();
    return msg;
  }

  function apply(r, text, opts) {
    r = r || {};
    const action = String(r.action || '');
    const msg = { id: uid(), role: 'model', text: String(r.reply || '').slice(0, 600), action: action, at: now() };
    // 1. memory first, so a new "לא אוכל" already binds this menu
    const ops = [];
    const mem = r.memory || {};
    (mem.remove || []).forEach(function (t) {
      const n = norm(t);
      if (!n) return;
      const it = memory().find(function (m) { return norm(m.text) === n || (n.length >= 3 && (norm(m.text).indexOf(n) >= 0 || n.indexOf(norm(m.text)) >= 0)); });
      if (it && removeMemory(it.id)) ops.push({ op: 'remove', item: it });
    });
    (mem.add || []).forEach(function (a) {
      const it = addMemory(a && a.cat, a && a.text, 'chat');
      if (it) ops.push({ op: 'add', item: it });
    });
    if (ops.length) msg.mem = ops;
    // 2. the menu
    if ((action === 'build' || action === 'edit') && Array.isArray(r.meals) && r.meals.length) {
      const state = S().getState();
      const pre = prefs(state, text);
      const t = targets(state);
      const actual = currentMeals();
      const cur = opts && opts.fresh ? null : actual;
      const locked = {};
      if (cur && action === 'edit') {
        r.meals.forEach(function (m, i) { const c = cur[i]; if (c && m && m.name === c.name && sameFoods(m.foods, c.foods)) locked[i] = true; });
      }
      const fit = Object.assign({}, pre, { protein: t.protein, calories: t.calories, carbs: t.carbs, fat: t.fat });
      const menu = F().menuFromSpec({ meals: r.meals }, fit, { locked: locked });
      if (!menu) throw new Error('ה-AI החזיר תפריט שלא הצלחתי לקרוא.');
      const next = menu.meals.map(function (m) {
        if (m.locked && cur && cur[m.src]) return clone(cur[m.src]);
        return { name: m.name, time: m.time, dish: m.dish, prep: m.prep || '', foods: m.foods };
      });
      const before = actual ? clone(actual) : null;
      const idx = [];
      next.forEach(function (m, i) { if (!before || !sameMeal(m, before[i])) idx.push(i); });
      if (before) for (let i = next.length; i < before.length; i++) idx.push(i);
      if (idx.length) {
        if (!chat.hasBase) { chat.base = before; chat.hasBase = true; }
        const saved = writeMeals(next);
        const ch = { id: uid(), msg: msg.id, before: before, after: clone(saved.meals), idx: idx, undone: false };
        chat.changes.push(ch);
        msg.change = ch.id;
        msg.today = saved.today;
        if (menu.replaced && menu.replaced.length) msg.replaced = menu.replaced.length;
        if (!msg.text) msg.text = 'עדכנתי את התפריט.';
      }
    } else if (action === 'ask') {
      msg.ask = true;
    }
    if (!msg.text) msg.text = ops.length ? 'עדכנתי את הזיכרון.' : 'לא שיניתי כלום.';
    chat.messages.push(msg);
    chat.messages = chat.messages.slice(-60);
    persist();
    return msg;
  }

  function retry(msgId) {
    load();
    const i = chat.messages.findIndex(function (m) { return m.id === msgId && m.error; });
    if (i < 0 || busy) return Promise.resolve(null);
    const m = chat.messages[i];
    chat.messages.splice(i, 1);
    persist();
    return run(m.retry || '', { fresh: !!m.fresh });
  }

  // A rule-based menu, only when asked for (AI down / signed out).
  function applyBasic() {
    load();
    const state = S().getState();
    const t = targets(state);
    const cur = currentMeals();
    const menu = F().buildMenu(Object.assign({}, prefs(state, ''), { protein: t.protein, calories: t.calories, carbs: t.carbs, fat: t.fat, meals: cur ? cur.length : 4 }));
    const before = cur ? clone(cur) : null;
    if (!chat.hasBase) { chat.base = before; chat.hasBase = true; }
    const saved = writeMeals(menu.meals);
    const msg = { id: uid(), role: 'model', text: 'בניתי תפריט בסיסי לפי הכללים, בלי AI.', action: 'build', at: now() };
    const ch = { id: uid(), msg: msg.id, before: before, after: clone(saved.meals), idx: saved.meals.map(function (m, i) { return i; }), undone: false };
    chat.changes.push(ch);
    msg.change = ch.id;
    msg.today = saved.today;
    chat.messages.push(msg);
    persist();
    notify();
    return msg;
  }

  // ---------- undo ----------
  function undoChange(id) {
    load();
    const ch = chat.changes.find(function (c) { return c.id === id; });
    if (!ch || ch.undone) return { ok: false };
    const cur = currentMeals();
    const whole = !ch.before || !cur || ch.before.length !== ch.after.length || cur.length !== ch.after.length;
    if (whole) {
      if (!sameList(cur, ch.after)) return { ok: false, conflict: true };
      writeMeals(ch.before);
      ch.undone = true;
      persist();
      notify();
      return { ok: true };
    }
    const next = clone(cur);
    let done = 0, skipped = 0;
    ch.idx.forEach(function (i) {
      if (sameMeal(cur[i], ch.after[i])) { next[i] = clone(ch.before[i]); done++; } else skipped++;
    });
    if (!done) return { ok: false, conflict: true };
    writeMeals(next);
    ch.undone = true;
    ch.partial = skipped > 0;
    persist();
    notify();
    return { ok: true, partial: skipped > 0 };
  }
  function canUndoAll() {
    load();
    if (!chat.hasBase || !chat.changes.some(function (c) { return !c.undone; })) return false;
    const cur = currentMeals();
    return !(chat.base ? sameList(cur, chat.base) : !cur);
  }
  function undoAll() {
    load();
    if (!chat.hasBase) return false;
    writeMeals(chat.base);
    chat.changes.forEach(function (c) { c.undone = true; });
    persist();
    notify();
    return true;
  }
  function undoMemory(msgId) {
    load();
    const m = chat.messages.find(function (x) { return x.id === msgId; });
    if (!m || !m.mem || m.memUndone) return false;
    m.mem.slice().reverse().forEach(function (op) {
      if (op.op === 'add') removeMemory(op.item.id);
      else restoreMemory(op.item);
    });
    m.memUndone = true;
    persist();
    notify();
    return true;
  }

  // meal index → 'fresh' (the last change) | 'touched' (changed in this chat)
  function highlights() {
    load();
    const cur = currentMeals();
    const out = {};
    if (!cur) return out;
    if (chat.hasBase) cur.forEach(function (m, i) { if (!chat.base || !sameMeal(m, chat.base[i])) out[i] = 'touched'; });
    const live = chat.changes.filter(function (c) { return !c.undone; });
    const last = live[live.length - 1];
    if (last) last.idx.forEach(function (i) { if (cur[i] && last.after && last.after[i] && sameMeal(cur[i], last.after[i])) out[i] = 'fresh'; });
    return out;
  }
  function change(id) { load(); return chat.changes.find(function (c) { return c.id === id; }) || null; }
  function changedNames(ch) {
    if (!ch) return [];
    const src = ch.after || [];
    return ch.idx.map(function (i) { return (src[i] && src[i].name) || (ch.before && ch.before[i] && ch.before[i].name) || ''; }).filter(Boolean);
  }

  function chips() {
    return currentMeals()
      ? ['ערב קל יותר', 'בלי בישול בבוקר', 'יותר חלבון בבוקר', 'תחליף את הצהריים']
      : ['תבנה לי תפריט', 'אין לי זמן לבשל בבוקר', '3 ארוחות ביום'];
  }

  function reset() { chat = freshChat(); busy = false; persist(); }

  root.FitMenuChat = {
    CATS: CATS, CAT_LABEL: CAT_LABEL, MENU_NAME: MENU_NAME,
    memory: memory, migrateMemory: migrateMemory, addMemory: addMemory, updateMemory: updateMemory, removeMemory: removeMemory, restoreMemory: restoreMemory,
    prefs: prefs, targets: targets,
    state: load, messages: function () { return load().messages; }, isBusy: function () { return busy; },
    available: available, setProvider: function (fn) { provider = typeof fn === 'function' ? fn : null; },
    send: send, retry: retry, applyBasic: applyBasic,
    undoChange: undoChange, undoAll: undoAll, canUndoAll: canUndoAll, undoMemory: undoMemory,
    highlights: highlights, change: change, changedNames: changedNames, chips: chips,
    currentMeals: currentMeals, savedMenu: savedMenu, sameMeal: sameMeal, requestBody: function (text, fresh) { load(); return requestBody(S().getState(), text, fresh); },
    onChange: function (fn) { listeners.push(fn); }, reset: reset
  };
})(typeof window !== 'undefined' ? window : globalThis);
