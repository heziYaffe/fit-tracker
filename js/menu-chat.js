/* פיט — the menu chat (v48, v49). One AI flow for the menu: every message goes
   to the model with the recent conversation, the current menu, the memory card
   (free text, like a system prompt) and the targets from Settings. The reply
   streams in, then can build a menu, edit it, ask a question or just answer,
   add/remove memory lines and suggest follow-ups. Changes go straight to
   «התפריט שלי» (all week) and can be undone one by one or all together.
   Nutrition always comes from the food table. */
(function (root) {
  'use strict';

  const CHAT_KEY = 'hazi-fit-menu-chat';
  const MENU_NAME = 'התפריט שלי';
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const GOAL_LABEL = { cut: 'חיטוב', bulk: 'מסה' };

  let provider = null;
  let busy = false;
  let streamText = '';
  let streamAction = '';
  const streamListeners = [];
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
  function notifyStream() { streamListeners.forEach(function (fn) { try { fn(streamText, streamAction); } catch (e) { /* ignore */ } }); }

  // The `reply` string from a JSON object that is still being written:
  // '{"reply":"שלום \"ע' → 'שלום "ע'. Stops before an incomplete escape.
  const ESC = { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' };
  function partialReply(raw) {
    raw = String(raw || '');
    const m = /"reply"\s*:\s*"/.exec(raw);
    if (!m) return '';
    let i = m.index + m[0].length, out = '';
    while (i < raw.length) {
      const c = raw[i];
      if (c === '"') break;
      if (c === '\\') {
        if (i + 1 >= raw.length) break;
        const n = raw[i + 1];
        if (n === 'u') {
          const hex = raw.substr(i + 2, 4);
          if (hex.length < 4) break;
          const code = parseInt(hex, 16);
          if (!isNaN(code)) out += String.fromCharCode(code);
          i += 6;
          continue;
        }
        out += Object.prototype.hasOwnProperty.call(ESC, n) ? ESC[n] : n;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  // ---------- memory card («מה אני יודע עליך») ----------
  // v49: free text, like a system prompt. Sent to the model as is with every
  // message; the model may add or remove whole lines. No code-level blocking:
  // the model is trusted with "לא אוכל ..." lines.
  const MEM_MAX = 3000;
  function lines(text) { return String(text || '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean); }

  // Built once from what older versions saved: the v48 memory items, or the
  // wizard's preferences (chips, dislikes, words).
  function migrateMemory(set) {
    set = set || {};
    const out = [];
    function push(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); if (t && !out.some(function (x) { return norm(x) === norm(t); })) out.push(t); }
    if (Array.isArray(set.menuMemory)) {
      set.menuMemory.forEach(function (m) {
        const t = String((m && m.text) || '').trim();
        if (!t) return;
        if (m.cat === 'avoid') push(/^(לא|בלי)\s/.test(t) ? t : 'לא אוכל ' + t);
        else if (m.cat === 'like') push(/^(אוהב|מעדיף)/.test(t) ? t : 'אוהב ' + t);
        else if (m.cat === 'goal') push(/^מטרה/.test(t) ? t : 'מטרה: ' + t);
        else push(t);
      });
      return out.join('\n');
    }
    const p = set.menuPrefs || {};
    const Fd = F();
    (p.excludes || []).forEach(function (id) {
      const o = ((Fd && Fd.EXCLUDE_OPTIONS) || []).find(function (x) { return x.id === id; });
      if (!o) return;
      push(id === 'veg' ? 'צמחוני' : 'לא אוכל ' + o.label.replace(/^בלי\s+/, ''));
    });
    (p.dislikes || []).forEach(function (id) { const f = Fd && Fd.byId ? Fd.byId[id] : null; if (f) push('לא אוכל ' + f.name); });
    (p.dislikeTerms || []).forEach(function (t) { if (t) push('לא אוכל ' + t); });
    if (Number(p.meals) && Number(p.meals) !== 4) push(p.meals + ' ארוחות ביום');
    if (GOAL_LABEL[p.goal]) push('מטרה: ' + GOAL_LABEL[p.goal]);
    return out.join('\n');
  }

  function memoryText(state) {
    state = state || S().getState();
    const set = (state && state.settings) || {};
    return typeof set.menuMemoryText === 'string' ? set.menuMemoryText : migrateMemory(set);
  }
  function setMemoryText(text) {
    const t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MEM_MAX);
    S().updateSettings({ menuMemoryText: t });
    notify();
    return t;
  }
  function memory(state) { return lines(memoryText(state)); }

  // The model's line edits. Returns the ops that really changed something.
  function findLine(list, t) {
    const n = norm(t);
    if (!n) return -1;
    let i = list.findIndex(function (l) { return norm(l) === n; });
    if (i < 0 && n.length >= 3) i = list.findIndex(function (l) { const m = norm(l); return m.indexOf(n) >= 0 || n.indexOf(m) >= 0; });
    return i;
  }
  function applyMemoryOps(add, remove) {
    const raw = memoryText().split('\n');
    const ops = [];
    (remove || []).forEach(function (t) {
      const live = raw.map(function (l) { return l.replace(/\s+/g, ' ').trim(); });
      const keyed = live.map(function (l, i) { return { l: l, i: i }; }).filter(function (x) { return x.l; });
      const k = findLine(keyed.map(function (x) { return x.l; }), t);
      if (k < 0) return;
      ops.push({ op: 'remove', text: keyed[k].l });
      raw.splice(keyed[k].i, 1);
    });
    (add || []).forEach(function (t) {
      t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!t) return;
      if (raw.some(function (l) { return norm(l) === norm(t); })) return;
      while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
      raw.push(t);
      ops.push({ op: 'add', text: t });
    });
    if (ops.length) setMemoryText(raw.join('\n'));
    return ops;
  }

  // FitFood prefs for the menu engine. v49: nothing blocked in code.
  function prefs(state, extraText) {
    return { excludes: [], dislikes: [], rules: [], note: String(extraText || '') };
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
  function callModel(body, hooks) {
    if (provider) return Promise.resolve().then(function () { return provider(body, hooks); });
    if (!root.FitAI || !root.FitAI.menuChat) return Promise.reject(new Error('ה-AI לא זמין כרגע.'));
    return root.FitAI.menuChat(body, hooks);
  }

  function requestBody(state, text, fresh) {
    const t = targets(state);
    const cur = fresh ? null : currentMeals();
    return {
      messages: chat.messages.filter(function (m) { return !m.error && m.text; }).slice(-10)
        .map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', text: String(m.text).slice(0, 600) }; }),
      memory: memoryText(state),
      targets: { protein: t.protein, calories: t.calories, carbs: t.carbs, fat: t.fat },
      current: cur ? compact(cur) : null,
      catalog: F().catalog(prefs(state, text))
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
    let raw = '';
    streamText = '';
    streamAction = '';
    const hooks = {
      onText: function (t) {
        raw += t;
        const rep = partialReply(raw);
        // `action` comes right after the reply: build/edit → the menu follows
        const am = streamAction ? null : /"action"\s*:\s*"(\w+)"/.exec(raw);
        const act = am ? am[1] : streamAction;
        if (rep !== streamText || act !== streamAction) { streamText = rep; streamAction = act; notifyStream(); }
      },
      onReset: function () { raw = ''; if (streamText || streamAction) { streamText = ''; streamAction = ''; notifyStream(); } }
    };
    const p = body ? callModel(body, hooks) : Promise.reject(new Error('לא הצלחתי להכין את הבקשה.'));
    return p.then(function (r) {
      busy = false;
      streamText = ''; streamAction = '';
      let msg;
      try { msg = apply(r, text, opts); } catch (e) { msg = failMsg(e, text, opts); }
      notify();
      return msg;
    }, function (err) {
      busy = false;
      streamText = ''; streamAction = '';
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
    // 1. memory line edits (shown under the reply with «בטל»)
    const mem = r.memory || {};
    const ops = applyMemoryOps((mem.add || []).map(function (a) { return a && typeof a === 'object' ? a.text : a; }), mem.remove || []);
    if (ops.length) msg.mem = ops;
    const sug = (Array.isArray(r.suggestions) ? r.suggestions : []).map(function (x) { return String(x || '').trim().slice(0, 40); }).filter(Boolean).slice(0, 3);
    if (sug.length) msg.suggestions = sug;
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
    const raw = memoryText().split('\n');
    let changed = false;
    m.mem.slice().reverse().forEach(function (op) {
      const t = op.text || (op.item && op.item.text) || '';
      if (!t) return;
      if (op.op === 'add') {
        const k = raw.findIndex(function (l) { return norm(l) === norm(t); });
        if (k >= 0) { raw.splice(k, 1); changed = true; }
      } else if (!raw.some(function (l) { return norm(l) === norm(t); })) {
        while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
        raw.push(t);
        changed = true;
      }
    });
    if (changed) setMemoryText(raw.join('\n'));
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

  // The model's follow-ups from its last reply; fixed ones before that.
  function chips() {
    const msgs = load().messages;
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'model' && !last.error && last.suggestions && last.suggestions.length) return last.suggestions.slice(0, 3);
    return currentMeals()
      ? ['ערב קל יותר', 'בלי בישול בבוקר', 'יותר חלבון בבוקר', 'תחליף את הצהריים']
      : ['תבנה לי תפריט', 'אין לי זמן לבשל בבוקר', '3 ארוחות ביום'];
  }

  function reset() { chat = freshChat(); busy = false; persist(); }

  root.FitMenuChat = {
    MENU_NAME: MENU_NAME, MEM_MAX: MEM_MAX,
    memory: memory, memoryText: memoryText, setMemoryText: setMemoryText, migrateMemory: migrateMemory, applyMemoryOps: applyMemoryOps,
    prefs: prefs, targets: targets, partialReply: partialReply,
    state: load, messages: function () { return load().messages; }, isBusy: function () { return busy; }, streamText: function () { return streamText; }, streamAction: function () { return streamAction; },
    available: available, setProvider: function (fn) { provider = typeof fn === 'function' ? fn : null; },
    send: send, retry: retry, applyBasic: applyBasic,
    undoChange: undoChange, undoAll: undoAll, canUndoAll: canUndoAll, undoMemory: undoMemory,
    highlights: highlights, change: change, changedNames: changedNames, chips: chips,
    currentMeals: currentMeals, savedMenu: savedMenu, sameMeal: sameMeal, requestBody: function (text, fresh) { load(); return requestBody(S().getState(), text, fresh); },
    onChange: function (fn) { listeners.push(fn); }, onStream: function (fn) { streamListeners.push(fn); }, reset: reset
  };
})(typeof window !== 'undefined' ? window : globalThis);
