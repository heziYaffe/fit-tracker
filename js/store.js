/* פיט — data layer. Local storage now; swap this module later for cloud sync
   or a Whoop adapter that upserts metrics with source: 'whoop'. No UI here. */
(function (root) {
  'use strict';

  const C = root.FitConfig;
  const listeners = [];
  let state = defaultState();
  let demoMode = false;

  function touch(row) {
    if (row && typeof row === 'object') row.updatedAt = new Date().toISOString();
    return row;
  }

  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function starterFoods() {
    return (C.STARTER_FOODS || []).map(function (f) {
      return {
        id: 'food_' + f.key,
        name: f.name,
        protein: f.protein,
        calories: f.calories,
        carbs: f.carbs == null ? '' : f.carbs,
        fat: f.fat == null ? '' : f.fat,
        uses: 0,
        starter: true
      };
    });
  }


  function parseRepsMode(ex) {
    if (ex.repsMode === 'max') return 'max';
    if (ex.repsMode === 'range') return 'range';
    const a = String(ex.repsMin == null ? '' : ex.repsMin).toUpperCase();
    const b = String(ex.repsMax == null ? '' : ex.repsMax).toUpperCase();
    if (a === 'MAX' || b === 'MAX') return 'max';
    return 'range';
  }

  function numReps(val, fallback) {
    if (val == null || val === '') return fallback;
    if (String(val).toUpperCase() === 'MAX') return fallback;
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeTex(ex) {
    ex = ex || {};
    const name = ex.name || '';
    const bodyweight = ex.bodyweight == null
      ? !!(C.isBodyweightName && C.isBodyweightName(name))
      : !!ex.bodyweight;
    const rawWeight = (ex.weight != null && ex.weight !== '') ? ex.weight
      : ((ex.targetWeight != null && ex.targetWeight !== '') ? ex.targetWeight : '');
    const rest = (ex.restSec === '' || ex.restSec == null) ? '' : Number(ex.restSec);
    const isStatic = ex.static == null
      ? !!(C.isStaticName && C.isStaticName(name))
      : !!ex.static;
    const secsDefault = 45;
    const secsMinRaw = ex.secsMin != null && ex.secsMin !== '' ? ex.secsMin : ex.secs;
    const secsMaxRaw = ex.secsMax != null && ex.secsMax !== '' ? ex.secsMax : secsMinRaw;
    return {
      id: ex.id || uid(),
      name: name,
      sets: Number(ex.sets) || 3,
      repsMode: parseRepsMode(ex),
      repsMin: isStatic ? numReps(ex.repsMin, 0) : numReps(ex.repsMin, 8),
      repsMax: isStatic ? numReps(ex.repsMax, 0) : numReps(ex.repsMax, 12),
      secsMin: isStatic ? numReps(secsMinRaw, secsDefault) : (secsMinRaw === '' || secsMinRaw == null ? '' : numReps(secsMinRaw, '')),
      secsMax: isStatic ? numReps(secsMaxRaw, secsDefault) : (secsMaxRaw === '' || secsMaxRaw == null ? '' : numReps(secsMaxRaw, '')),
      weight: rawWeight === '' ? '' : (Number.isFinite(Number(rawWeight)) ? Number(rawWeight) : ''),
      restSec: rest === '' || !Number.isFinite(rest) ? '' : rest,
      notes: ex.notes || '',
      supersetId: ex.supersetId || '',
      bodyweight: bodyweight,
      static: isStatic
    };
  }

  function normalizeTemplate(t) {
    t = t || {};
    return {
      id: t.id || uid(),
      name: t.name || '',
      days: Array.isArray(t.days) ? t.days.map(Number) : [],
      type: t.type || '',
      exercises: (t.exercises || []).map(normalizeTex)
    };
  }

  function normalizeMenuFood(f) {
    f = f || {};
    return {
      id: f.id || uid(),
      foodId: f.foodId || '',
      name: f.name || '',
      qty: Number(f.qty) || 1,
      protein: Number(f.protein) || 0,
      calories: Number(f.calories) || 0,
      carbs: f.carbs === '' || f.carbs == null ? '' : Number(f.carbs),
      fat: f.fat === '' || f.fat == null ? '' : Number(f.fat),
      dbId: f.dbId || '',
      role: f.role || '',
      grams: Number(f.grams) || 0
    };
  }

  function normalizeMeal(m) {
    m = m || {};
    return {
      id: m.id || uid(),
      name: m.name || '',
      time: m.time || '',
      foods: (m.foods || []).map(normalizeMenuFood),
      status: m.status || 'pending'
    };
  }

  function normalizeMenu(menu) {
    menu = menu || {};
    return {
      id: menu.id || uid(),
      name: menu.name || '',
      days: Array.isArray(menu.days) ? menu.days.map(Number) : [],
      applyOn: menu.applyOn || '',
      meals: (menu.meals || []).map(normalizeMeal)
    };
  }

  function mealTotals(meal) {
    const out = { protein: 0, calories: 0, carbs: 0, fat: 0, hasCarbs: false, hasFat: false };
    (meal && meal.foods || []).forEach(function (f) {
      const q = Number(f.qty) || 1;
      out.protein += (Number(f.protein) || 0) * q;
      out.calories += (Number(f.calories) || 0) * q;
      if (f.carbs !== '' && f.carbs != null) { out.carbs += (Number(f.carbs) || 0) * q; out.hasCarbs = true; }
      if (f.fat !== '' && f.fat != null) { out.fat += (Number(f.fat) || 0) * q; out.hasFat = true; }
    });
    return out;
  }

  function menuTotals(menu) {
    const out = { protein: 0, calories: 0, carbs: 0, fat: 0, hasCarbs: false, hasFat: false };
    (menu && menu.meals || []).forEach(function (m) {
      const t = mealTotals(m);
      out.protein += t.protein;
      out.calories += t.calories;
      if (t.hasCarbs) { out.carbs += t.carbs; out.hasCarbs = true; }
      if (t.hasFat) { out.fat += t.fat; out.hasFat = true; }
    });
    return out;
  }

  function defaultState() {
    return {
      version: 1,
      settings: Object.assign({}, C.DEFAULT_SETTINGS),
      workouts: [],
      nutrition: [],
      weights: [],
      metrics: [],
      foods: starterFoods(),
      templates: [],
      menus: [],
      dayMenus: [],
      measures: [],
      exercises: [],
      substitutions: {},
      foodLog: []
    };
  }



  function normalizeMeasureRow(m) {
    m = m || {};
    const P = root.FitPhotos;
    if (P && P.normalizeMeasure) return P.normalizeMeasure(m);
    return {
      id: m.id || uid(),
      date: m.date || '',
      waist: m.waist === '' || m.waist == null ? '' : Number(m.waist),
      chest: m.chest === '' || m.chest == null ? '' : Number(m.chest),
      arm: m.arm === '' || m.arm == null ? '' : Number(m.arm),
      thigh: m.thigh === '' || m.thigh == null ? '' : Number(m.thigh),
      hips: m.hips === '' || m.hips == null ? '' : Number(m.hips),
      notes: m.notes || ''
    };
  }

  function migrateWater(settings, nutrition, rawSettings) {
    const cupMl = (C.WATER_CUP_ML) || 250;
    if (rawSettings && rawSettings.waterInMl) {
      if (settings.waterVessel !== 'bottle') settings.waterVessel = settings.waterVessel || 'cup';
      const fallback = settings.waterVessel === 'bottle' ? 500 : cupMl;
      settings.waterVesselMl = Math.max(50, Number(settings.waterVesselMl) || fallback);
      settings.waterInMl = true;
      const t = Number(settings.dailyWaterTarget);
      if (!(t > 0)) settings.dailyWaterTarget = C.WATER_DEFAULT_GOAL_ML || 2000;
      return settings;
    }
    const t = Number(settings.dailyWaterTarget);
    if (t > 0 && t <= 30) settings.dailyWaterTarget = Math.round(t * cupMl);
    else if (!(t > 0)) settings.dailyWaterTarget = C.WATER_DEFAULT_GOAL_ML || 2000;
    (nutrition || []).forEach(function (n) {
      if (!n) return;
      const w = Number(n.water) || 0;
      if (w > 0 && w <= 30) n.water = Math.round(w * cupMl);
    });
    settings.waterInMl = true;
    settings.waterVessel = settings.waterVessel === 'bottle' ? 'bottle' : 'cup';
    settings.waterVesselMl = Math.max(50, Number(settings.waterVesselMl) || cupMl);
    return settings;
  }

  function normalizeSettings(set) {
    set = set || {};
    const baseN = (C.DEFAULT_NOTIFICATIONS && Object.assign({}, C.DEFAULT_NOTIFICATIONS)) || {
      workoutEnabled: false,
      workoutTime: '18:00',
      mealEnabled: false,
      lowHpEnabled: false,
      lowHpThreshold: 50,
      lastFired: { workoutDate: '', meals: {}, lowHpDate: '' }
    };
    const n = set.notifications || {};
    const last = n.lastFired || {};
    set.notifications = {
      workoutEnabled: !!n.workoutEnabled,
      workoutTime: n.workoutTime || baseN.workoutTime,
      mealEnabled: !!n.mealEnabled,
      lowHpEnabled: !!n.lowHpEnabled,
      lowHpThreshold: n.lowHpThreshold == null || n.lowHpThreshold === '' ? 50 : Number(n.lowHpThreshold),
      lastFired: {
        workoutDate: last.workoutDate || '',
        meals: last.meals && typeof last.meals === 'object' ? last.meals : {},
        lowHpDate: last.lowHpDate || ''
      }
    };
    const restT = Number(set.restTargetSec);
    set.restTargetSec = restT > 0
      ? Math.max(15, Math.min(600, Math.round(restT)))
      : ((C.REST_DEFAULT_SEC) || 90);
    return set;
  }

  function normalizeExerciseList(list) {
    const E = root.FitEngine;
    const out = [];
    const seen = {};
    (Array.isArray(list) ? list : []).forEach(function (e) {
      const rawName = e && typeof e === 'object' ? (e.name || e.id) : e;
      const name = E && E.normName ? E.normName(rawName) : String(rawName || '').trim();
      if (!name) return;
      const key = E && E.foldName ? E.foldName(name) : name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        id: (e && e.id) || name,
        name: name,
        createdAt: (e && e.createdAt) || ''
      });
    });
    return out;
  }

  function normalizeSubstitutions(map) {
    const E = root.FitEngine;
    const out = {};
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(function (key) {
      const from = E && E.normName ? E.normName(key) : String(key || '').trim();
      if (!from) return;
      const rows = [];
      (Array.isArray(map[key]) ? map[key] : []).forEach(function (row) {
        const name = E && E.normName ? E.normName(row && row.name) : String((row && row.name) || '').trim();
        if (!name) return;
        rows.push({
          name: name,
          count: Math.max(1, Number(row.count) || 1),
          lastAt: row.lastAt || ''
        });
      });
      if (rows.length) out[from] = rows;
    });
    return out;
  }

  function exerciseCatalog() {
    const E = root.FitEngine;
    if (E && E.exerciseCatalog) return E.exerciseCatalog(state);
    return [];
  }

  function addExerciseName(raw) {
    const E = root.FitEngine;
    if (!E || !E.canonicalName) return (E && E.normName ? E.normName(raw) : String(raw || '').trim());
    const name = E.canonicalName(raw, E.exerciseCatalog(state));
    if (!name) return '';
    const key = E.foldName(name);
    const exists = E.exerciseCatalog(state).some(function (n) { return E.foldName(n) === key; });
    if (!exists) {
      state.exercises = state.exercises || [];
      state.exercises.push({ id: name, name: name, createdAt: new Date().toISOString() });
      commit();
    }
    return name;
  }

  function substitutionKey(name) {
    const E = root.FitEngine;
    const want = E && E.foldName ? E.foldName(name) : String(name || '').toLowerCase();
    const keys = Object.keys(state.substitutions || {});
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const fold = E && E.foldName ? E.foldName(k) : String(k || '').toLowerCase();
      if (fold === want) return k;
    }
    return E && E.normName ? E.normName(name) : String(name || '').trim();
  }

  function recordSubstitution(fromRaw, toRaw) {
    const E = root.FitEngine;
    const catalog = E && E.exerciseCatalog ? E.exerciseCatalog(state) : [];
    const from = E && E.canonicalName ? E.canonicalName(fromRaw, catalog) : String(fromRaw || '').trim();
    const to = E && E.canonicalName ? E.canonicalName(toRaw, catalog) : String(toRaw || '').trim();
    if (!from || !to || (E && E.foldName ? E.foldName(from) === E.foldName(to) : from === to)) return null;
    if (!state.substitutions) state.substitutions = {};
    const key = substitutionKey(from) || from;
    const list = (state.substitutions[key] || []).slice();
    const toFold = E && E.foldName ? E.foldName(to) : to.toLowerCase();
    let found = -1;
    for (let i = 0; i < list.length; i++) {
      const fold = E && E.foldName ? E.foldName(list[i].name) : String(list[i].name || '').toLowerCase();
      if (fold === toFold) { found = i; break; }
    }
    const now = new Date().toISOString();
    if (found >= 0) {
      list[found].name = to;
      list[found].count = Math.max(1, Number(list[found].count) || 1) + 1;
      list[found].lastAt = now;
    } else {
      list.push({ name: to, count: 1, lastAt: now });
    }
    state.substitutions[key] = list;
    commit();
    return list;
  }

  function substitutesFor(name) {
    const E = root.FitEngine;
    const key = substitutionKey(name);
    const list = ((state.substitutions || {})[key] || []).slice();
    list.sort(function (a, b) {
      if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
      return (Number(b.count) || 0) - (Number(a.count) || 0);
    });
    return list;
  }

  function normalize(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const foods = Array.isArray(raw.foods) && raw.foods.length ? raw.foods : starterFoods();
    const nutrition = Array.isArray(raw.nutrition) ? raw.nutrition : [];
    const settings = migrateWater(
      normalizeSettings(Object.assign({}, base.settings, raw.settings || {})),
      nutrition,
      raw.settings || {}
    );
    return {
      version: 1,
      settings: settings,
      workouts: Array.isArray(raw.workouts) ? raw.workouts : [],
      nutrition: nutrition,
      weights: Array.isArray(raw.weights) ? raw.weights : [],
      metrics: Array.isArray(raw.metrics) ? raw.metrics : [],
      foods: foods,
      templates: Array.isArray(raw.templates) ? raw.templates.map(normalizeTemplate) : [],
      menus: Array.isArray(raw.menus) ? raw.menus.map(normalizeMenu) : [],
      dayMenus: Array.isArray(raw.dayMenus) ? raw.dayMenus : [],
      measures: Array.isArray(raw.measures) ? raw.measures.map(normalizeMeasureRow) : [],
      exercises: normalizeExerciseList(raw.exercises),
      substitutions: normalizeSubstitutions(raw.substitutions),
      foodLog: Array.isArray(raw.foodLog) ? raw.foodLog.filter(function (r) { return r && r.id; }) : []
    };
  }

  function storageAvailable() {
    return typeof localStorage !== 'undefined';
  }

  function dataKey() {
    return demoMode ? C.DEMO_STORAGE_KEY : C.STORAGE_KEY;
  }

  function persist() {
    if (!storageAvailable()) return;
    localStorage.setItem(dataKey(), JSON.stringify(state));
  }

  function isDemoMode() {
    return demoMode;
  }

  function readDemoFlag() {
    try {
      return storageAvailable() && localStorage.getItem(C.DEMO_MODE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function readKey(key) {
    if (!storageAvailable()) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (err) {
      return null;
    }
  }

  function enterDemoMode(now) {
    demoMode = true;
    if (storageAvailable()) localStorage.setItem(C.DEMO_MODE_KEY, '1');
    const generated = root.FitDemo && root.FitDemo.generate
      ? root.FitDemo.generate(now)
      : defaultState();
    state = normalize(generated);
    persist();
    notify();
    return state;
  }

  function exitDemoMode() {
    demoMode = false;
    if (storageAvailable()) localStorage.removeItem(C.DEMO_MODE_KEY);
    const real = readKey(C.STORAGE_KEY);
    state = real || defaultState();
    notify();
    return state;
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }

  function commit() {
    persist();
    notify();
  }

  function load() {
    demoMode = readDemoFlag();
    if (!storageAvailable()) {
      if (demoMode && root.FitDemo) {
        state = normalize(root.FitDemo.generate());
      } else {
        state = defaultState();
      }
      return state;
    }
    try {
      const raw = localStorage.getItem(dataKey());
      if (demoMode && !raw && root.FitDemo) {
        state = normalize(root.FitDemo.generate());
        persist();
      } else {
        state = raw ? normalize(JSON.parse(raw)) : defaultState();
      }
    } catch (err) {
      console.warn('fit-tracker: could not read storage', err);
      state = defaultState();
    }
    return state;
  }

  function getState() {
    return state;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function updateSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    touch(state.settings);
    commit();
  }

  function addWorkout(workout) {
    const row = Object.assign({
      id: uid(),
      date: root.FitEngine.todayISO(),
      type: 'full',
      customType: '',
      exercises: [],
      duration: '',
      notes: ''
    }, workout);
    if (!row.id) row.id = uid();
    touch(row);
    state.workouts.push(row);
    commit();
    return row;
  }

  function updateWorkout(id, patch) {
    const row = state.workouts.find(function (w) { return w.id === id; });
    if (!row) return null;
    Object.assign(row, patch, { id: row.id });
    touch(row);
    commit();
    return row;
  }

  function deleteWorkout(id) {
    const before = state.workouts.length;
    state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
    if (state.workouts.length !== before) commit();
  }

  function getWorkout(id) {
    return state.workouts.find(function (w) { return w.id === id; }) || null;
  }

  function upsertNutrition(date, patch) {
    let row = state.nutrition.find(function (n) { return n.date === date; });
    if (!row) {
      row = { id: uid(), date: date, protein: 0, calories: 0, water: 0, notes: '' };
      state.nutrition.push(row);
    }
    Object.assign(row, patch, { id: row.id, date: date });
    row.protein = Math.max(0, Number(row.protein) || 0);
    row.calories = Math.max(0, Number(row.calories) || 0);
    row.water = Math.max(0, Number(row.water) || 0);
    if (row.carbs !== undefined && row.carbs !== '') row.carbs = Math.max(0, Number(row.carbs) || 0);
    if (row.fat !== undefined && row.fat !== '') row.fat = Math.max(0, Number(row.fat) || 0);
    touch(row);
    commit();
    return row;
  }

  function getNutrition(date) {
    return state.nutrition.find(function (n) { return n.date === date; }) || null;
  }

  function upsertWeight(date, kg) {
    const value = Number(kg);
    if (!Number.isFinite(value) || value <= 0) return null;
    let row = state.weights.find(function (w) { return w.date === date; });
    if (!row) {
      row = { id: uid(), date: date, weight: value };
      state.weights.push(row);
    } else {
      row.weight = value;
    }
    commit();
    return row;
  }

  function deleteWeight(id) {
    state.weights = state.weights.filter(function (w) { return w.id !== id; });
    commit();
  }

  function latestWeight() {
    if (!state.weights.length) return null;
    return state.weights.slice().sort(function (a, b) {
      return b.date.localeCompare(a.date);
    })[0];
  }

  /**
   * One metrics row per (date, source). A Whoop sync should call this with
   * source: 'whoop' and will not overwrite a manual row for the same day.
   */
  function upsertMetrics(date, patch, source) {
    const src = source || (patch && patch.source) || 'manual';
    let row = state.metrics.find(function (m) {
      return m.date === date && (m.source || 'manual') === src;
    });
    if (!row) {
      row = {
        id: uid(),
        date: date,
        source: src,
        sleepHours: null,
        recoveryPct: null,
        strain: null,
        hrv: null,
        notes: ''
      };
      state.metrics.push(row);
    }
    const fields = ['sleepHours', 'recoveryPct', 'strain', 'hrv', 'notes'];
    fields.forEach(function (key) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
        row[key] = patch[key];
      }
    });
    row.source = src;
    touch(row);
    commit();
    return row;
  }

  function getMetrics(date, source) {
    if (source) {
      return state.metrics.find(function (m) {
        return m.date === date && (m.source || 'manual') === source;
      }) || null;
    }
    const rows = state.metrics.filter(function (m) { return m.date === date; });
    if (!rows.length) return null;
    const manual = rows.find(function (m) { return (m.source || 'manual') === 'manual'; });
    return manual || rows[0];
  }

  function listFoods() {
    return (state.foods || []).slice().sort(function (a, b) {
      const ua = Number(a.uses) || 0;
      const ub = Number(b.uses) || 0;
      if (ub !== ua) return ub - ua;
      return String(a.name || '').localeCompare(String(b.name || ''), 'he');
    });
  }

  function addFood(food) {
    const row = {
      id: (food && food.id) || uid(),
      name: (food && food.name) || '',
      protein: Number(food && food.protein) || 0,
      calories: Number(food && food.calories) || 0,
      carbs: food && food.carbs !== '' && food.carbs != null ? Number(food.carbs) : '',
      fat: food && food.fat !== '' && food.fat != null ? Number(food.fat) : '',
      uses: Number(food && food.uses) || 0,
      starter: !!(food && food.starter)
    };
    state.foods = state.foods || [];
    state.foods.push(row);
    commit();
    return row;
  }

  function updateFood(id, patch) {
    const row = (state.foods || []).find(function (f) { return f.id === id; });
    if (!row) return null;
    Object.assign(row, patch, { id: row.id });
    commit();
    return row;
  }

  function deleteFood(id) {
    state.foods = (state.foods || []).filter(function (f) { return f.id !== id; });
    commit();
  }

  function getFood(id) {
    return (state.foods || []).find(function (f) { return f.id === id; }) || null;
  }

  function useFood(id, date) {
    const food = getFood(id);
    if (!food) return null;
    food.uses = (Number(food.uses) || 0) + 1;
    const day = date || root.FitEngine.todayISO();
    const cur = getNutrition(day) || { protein: 0, calories: 0, water: 0, carbs: 0, fat: 0 };
    const patch = {
      protein: (Number(cur.protein) || 0) + (Number(food.protein) || 0),
      calories: (Number(cur.calories) || 0) + (Number(food.calories) || 0)
    };
    if (food.carbs !== '' && food.carbs != null) {
      patch.carbs = (Number(cur.carbs) || 0) + (Number(food.carbs) || 0);
    }
    if (food.fat !== '' && food.fat != null) {
      patch.fat = (Number(cur.fat) || 0) + (Number(food.fat) || 0);
    }
    upsertNutrition(day, patch);
    return food;
  }


  // ---- per-item food log (quick logging). Each entry adds to the day's
  // nutrition totals; removing subtracts. Deletes are tombstones so cloud
  // sync does not bring them back.
  function nutritionDelta(date, item, sign) {
    const cur = getNutrition(date) || { protein: 0, calories: 0, carbs: 0, fat: 0 };
    upsertNutrition(date, {
      protein: Math.max(0, Math.round(((Number(cur.protein) || 0) + sign * (Number(item.protein) || 0)) * 10) / 10),
      calories: Math.max(0, Math.round((Number(cur.calories) || 0) + sign * (Number(item.calories) || 0))),
      carbs: Math.max(0, Math.round(((Number(cur.carbs) || 0) + sign * (Number(item.carbs) || 0)) * 10) / 10),
      fat: Math.max(0, Math.round(((Number(cur.fat) || 0) + sign * (Number(item.fat) || 0)) * 10) / 10)
    });
  }

  function addFoodLog(date, items) {
    const day = date || root.FitEngine.todayISO();
    state.foodLog = state.foodLog || [];
    const rows = [];
    (items || []).forEach(function (it) {
      if (!it || it.unmatched) return;
      const row = touch({
        id: uid(), date: day, at: new Date().toISOString(),
        name: it.name || it.label || '', label: it.label || it.name || '',
        grams: Number(it.grams) || 0,
        calories: Math.round(Number(it.calories) || 0),
        protein: Math.round((Number(it.protein) || 0) * 10) / 10,
        carbs: Math.round((Number(it.carbs) || 0) * 10) / 10,
        fat: Math.round((Number(it.fat) || 0) * 10) / 10,
        dbId: it.dbId || '', code: it.code || '', per100: it.per100 || null,
        source: it.source || ''
      });
      state.foodLog.push(row);
      rows.push(row);
      nutritionDelta(day, row, 1);
    });
    commit();
    return rows;
  }

  function listFoodLog(date) {
    return (state.foodLog || []).filter(function (r) { return r.date === date && !r.deletedAt; })
      .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
  }

  function removeFoodLog(id) {
    const row = (state.foodLog || []).find(function (r) { return r.id === id && !r.deletedAt; });
    if (!row) return null;
    nutritionDelta(row.date, row, -1);
    row.deletedAt = new Date().toISOString();
    touch(row);
    commit();
    return row;
  }

  // Distinct recent items (by label), newest first — for one-tap repeat.
  function recentFoodLog(limit) {
    const seen = {};
    const out = [];
    (state.foodLog || []).filter(function (r) { return !r.deletedAt; })
      .slice().sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); })
      .forEach(function (r) {
        const k = r.label || r.name;
        if (!k || seen[k]) return;
        seen[k] = 1;
        out.push(r);
      });
    return out.slice(0, limit || 8);
  }

  function listTemplates() {
    return (state.templates || []).slice();
  }
  function getTemplate(id) {
    return (state.templates || []).find(function (t) { return t.id === id; }) || null;
  }
  function addTemplate(data) {
    const row = normalizeTemplate(Object.assign({}, data, { id: (data && data.id) || uid() }));
    state.templates = state.templates || [];
    state.templates.push(row);
    commit();
    return row;
  }
  function updateTemplate(id, patch) {
    const row = getTemplate(id);
    if (!row) return null;
    const next = normalizeTemplate(Object.assign({}, row, patch, { id: row.id }));
    state.templates = state.templates.map(function (t) { return t.id === id ? next : t; });
    commit();
    return next;
  }
  function deleteTemplate(id) {
    state.templates = (state.templates || []).filter(function (t) { return t.id !== id; });
    commit();
  }
  function duplicateTemplate(id) {
    const src = getTemplate(id);
    if (!src) return null;
    const copy = normalizeTemplate(JSON.parse(JSON.stringify(src)));
    copy.id = uid();
    copy.name = (src.name || 'תבנית') + ' (עותק)';
    copy.exercises = (copy.exercises || []).map(function (ex) { ex.id = uid(); return ex; });
    state.templates.push(copy);
    commit();
    return copy;
  }

  function listMenus() {
    return (state.menus || []).slice();
  }
  function getMenu(id) {
    return (state.menus || []).find(function (m) { return m.id === id; }) || null;
  }
  function addMenu(data) {
    const row = normalizeMenu(Object.assign({}, data, { id: (data && data.id) || uid() }));
    state.menus = state.menus || [];
    state.menus.push(row);
    commit();
    return row;
  }
  function updateMenu(id, patch) {
    const row = getMenu(id);
    if (!row) return null;
    const next = normalizeMenu(Object.assign({}, row, patch, { id: row.id }));
    state.menus = state.menus.map(function (m) { return m.id === id ? next : m; });
    commit();
    return next;
  }
  function deleteMenu(id) {
    state.menus = (state.menus || []).filter(function (m) { return m.id !== id; });
    commit();
  }
  function duplicateMenu(id) {
    const src = getMenu(id);
    if (!src) return null;
    const copy = normalizeMenu(JSON.parse(JSON.stringify(src)));
    copy.id = uid();
    copy.name = (src.name || 'תפריט') + ' (עותק)';
    copy.meals = (copy.meals || []).map(function (m) {
      m.id = uid();
      m.foods = (m.foods || []).map(function (f) { f.id = uid(); return f; });
      return m;
    });
    state.menus.push(copy);
    commit();
    return copy;
  }

  function getDayMenu(date) {
    return (state.dayMenus || []).find(function (d) { return d.date === date; }) || null;
  }

  function applyMenuToDate(menuId, date) {
    const menu = getMenu(menuId);
    if (!menu) return null;
    const clone = {
      date: date,
      menuId: menu.id,
      menuName: menu.name,
      meals: (menu.meals || []).map(function (m) {
        const meal = normalizeMeal(JSON.parse(JSON.stringify(m)));
        meal.id = meal.id || uid();
        meal.status = 'pending';
        meal.foods = (meal.foods || []).map(function (f) { f.id = uid(); return f; });
        return meal;
      })
    };
    state.dayMenus = (state.dayMenus || []).filter(function (d) { return d.date !== date; });
    state.dayMenus.push(clone);
    commit();
    return clone;
  }

  function updateDayMenu(date, patch) {
    const row = getDayMenu(date);
    if (!row) return null;
    Object.assign(row, patch, { date: row.date });
    commit();
    return row;
  }

  function setMealStatus(date, mealId, status) {
    const day = getDayMenu(date);
    if (!day) return null;
    const meal = (day.meals || []).find(function (m) { return m.id === mealId; });
    if (!meal) return null;
    const prev = meal.status || 'pending';
    function applyMealMacros(sign) {
      const tot = mealTotals(meal);
      const cur = getNutrition(date) || { protein: 0, calories: 0, carbs: 0, fat: 0 };
      const r1 = function (v) { return Math.round(v * 10) / 10; };
      const patch = {
        protein: r1(Math.max(0, (Number(cur.protein) || 0) + sign * tot.protein)),
        calories: Math.round(Math.max(0, (Number(cur.calories) || 0) + sign * tot.calories))
      };
      if (tot.hasCarbs) patch.carbs = r1(Math.max(0, (Number(cur.carbs) || 0) + sign * tot.carbs));
      if (tot.hasFat) patch.fat = r1(Math.max(0, (Number(cur.fat) || 0) + sign * tot.fat));
      upsertNutrition(date, patch);
    }
    if (status === 'eaten' && prev !== 'eaten') {
      applyMealMacros(1);
      meal.status = 'eaten';
      commit();
      return meal;
    }
    if (status === 'skipped') {
      if (prev === 'eaten') applyMealMacros(-1);
      meal.status = 'skipped';
      commit();
      return meal;
    }
    if (status === 'pending') {
      if (prev === 'eaten') applyMealMacros(-1);
      meal.status = 'pending';
      commit();
      return meal;
    }
    return meal;
  }

  function patchDayMeal(date, mealId, patch) {
    const day = getDayMenu(date);
    if (!day) return null;
    const meal = (day.meals || []).find(function (m) { return m.id === mealId; });
    if (!meal) return null;
    Object.assign(meal, patch, { id: meal.id });
    commit();
    return meal;
  }

  function replaceDayMealFood(date, mealId, foodId, nextFood) {
    const day = getDayMenu(date);
    if (!day) return null;
    const meal = (day.meals || []).find(function (m) { return m.id === mealId; });
    if (!meal) return null;
    meal.foods = (meal.foods || []).map(function (f) {
      return f.id === foodId ? normalizeMenuFood(Object.assign({}, f, nextFood, { id: f.id })) : f;
    });
    commit();
    return meal;
  }

  function pickAutoMenu(date) {
    const menus = state.menus || [];
    if (!menus.length) return null;
    const dow = root.FitEngine.parseISO(date).getDay();
    const trained = (state.workouts || []).some(function (w) { return w.date === date; });
    let found = menus.find(function (m) { return (m.days || []).map(Number).indexOf(dow) >= 0; });
    if (found) return found;
    if (trained) found = menus.find(function (m) { return m.applyOn === 'workout'; });
    else found = menus.find(function (m) { return m.applyOn === 'rest'; });
    return found || null;
  }

  function autoApplyMenu(date) {
    if (getDayMenu(date)) return getDayMenu(date);
    const menu = pickAutoMenu(date);
    if (!menu) return null;
    return applyMenuToDate(menu.id, date);
  }


  function listMeasures() {
    return (state.measures || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  function upsertMeasure(row) {
    row = normalizeMeasureRow(Object.assign({ id: uid(), date: root.FitEngine.todayISO() }, row || {}));
    const i = state.measures.findIndex(function (m) { return m.id === row.id || (m.date === row.date && !row._forceNew); });
    if (i >= 0) state.measures[i] = touch(Object.assign({}, state.measures[i], row, { id: state.measures[i].id }));
    else state.measures.push(touch(row));
    commit();
    return row;
  }

  function deleteMeasure(id) {
    state.measures = (state.measures || []).filter(function (m) { return m.id !== id; });
    commit();
  }

  function exportJSON() {
    return {
      app: 'fit-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        settings: state.settings,
        workouts: state.workouts,
        nutrition: state.nutrition,
        weights: state.weights,
        metrics: state.metrics,
        foods: state.foods,
        templates: state.templates,
        menus: state.menus,
        dayMenus: state.dayMenus,
        measures: state.measures,
        exercises: state.exercises,
        substitutions: state.substitutions,
        foodLog: state.foodLog
      }
    };
  }

  function importJSON(payload) {
    const raw = payload && payload.data ? payload.data : payload;
    if (!raw || typeof raw !== 'object') throw new Error('invalid');
    const hasAny = raw.settings || raw.workouts || raw.nutrition || raw.weights || raw.metrics || raw.foods || raw.templates || raw.menus || raw.measures || raw.exercises || raw.substitutions || raw.foodLog;
    if (!hasAny) throw new Error('invalid');
    state = normalize(raw);
    commit();
    return state;
  }

  function clearAll() {
    state = defaultState();
    commit();
  }

  const FitStore = {
    uid: uid,
    defaultState: defaultState,
    load: load,
    getState: getState,
    subscribe: subscribe,
    updateSettings: updateSettings,
    addWorkout: addWorkout,
    updateWorkout: updateWorkout,
    deleteWorkout: deleteWorkout,
    getWorkout: getWorkout,
    upsertNutrition: upsertNutrition,
    getNutrition: getNutrition,
    upsertWeight: upsertWeight,
    deleteWeight: deleteWeight,
    latestWeight: latestWeight,
    upsertMetrics: upsertMetrics,
    getMetrics: getMetrics,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
    listFoods: listFoods,
    addFood: addFood,
    updateFood: updateFood,
    deleteFood: deleteFood,
    getFood: getFood,
    useFood: useFood,
    addFoodLog: addFoodLog,
    listFoodLog: listFoodLog,
    removeFoodLog: removeFoodLog,
    recentFoodLog: recentFoodLog,
    isDemoMode: isDemoMode,
    enterDemoMode: enterDemoMode,
    exitDemoMode: exitDemoMode,
    listTemplates: listTemplates,
    getTemplate: getTemplate,
    addTemplate: addTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    duplicateTemplate: duplicateTemplate,
    listMenus: listMenus,
    getMenu: getMenu,
    addMenu: addMenu,
    updateMenu: updateMenu,
    deleteMenu: deleteMenu,
    duplicateMenu: duplicateMenu,
    getDayMenu: getDayMenu,
    applyMenuToDate: applyMenuToDate,
    updateDayMenu: updateDayMenu,
    setMealStatus: setMealStatus,
    patchDayMeal: patchDayMeal,
    replaceDayMealFood: replaceDayMealFood,
    pickAutoMenu: pickAutoMenu,
    autoApplyMenu: autoApplyMenu,
    mealTotals: mealTotals,
    menuTotals: menuTotals,
    listMeasures: listMeasures,
    upsertMeasure: upsertMeasure,
    deleteMeasure: deleteMeasure,
    normalizeTemplate: normalizeTemplate,
    normalizeMenu: normalizeMenu,
    addExerciseName: addExerciseName,
    recordSubstitution: recordSubstitution,
    substitutesFor: substitutesFor,
    exerciseCatalog: exerciseCatalog
  };

  root.FitStore = FitStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitStore;
})(typeof window !== 'undefined' ? window : globalThis);
