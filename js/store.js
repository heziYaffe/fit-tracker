/* פיט — data layer. Local storage now; swap this module later for cloud sync
   or a Whoop adapter that upserts metrics with source: 'whoop'. No UI here. */
(function (root) {
  'use strict';

  const C = root.FitConfig;
  const listeners = [];
  let state = defaultState();
  let demoMode = false;

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

  function defaultState() {
    return {
      version: 1,
      settings: Object.assign({}, C.DEFAULT_SETTINGS),
      workouts: [],
      nutrition: [],
      weights: [],
      metrics: [],
      foods: starterFoods()
    };
  }

  function normalize(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const foods = Array.isArray(raw.foods) && raw.foods.length ? raw.foods : starterFoods();
    return {
      version: 1,
      settings: Object.assign({}, base.settings, raw.settings || {}),
      workouts: Array.isArray(raw.workouts) ? raw.workouts : [],
      nutrition: Array.isArray(raw.nutrition) ? raw.nutrition : [],
      weights: Array.isArray(raw.weights) ? raw.weights : [],
      metrics: Array.isArray(raw.metrics) ? raw.metrics : [],
      foods: foods
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
    state.workouts.push(row);
    commit();
    return row;
  }

  function updateWorkout(id, patch) {
    const row = state.workouts.find(function (w) { return w.id === id; });
    if (!row) return null;
    Object.assign(row, patch, { id: row.id });
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
        foods: state.foods
      }
    };
  }

  function importJSON(payload) {
    const raw = payload && payload.data ? payload.data : payload;
    if (!raw || typeof raw !== 'object') throw new Error('invalid');
    const hasAny = raw.settings || raw.workouts || raw.nutrition || raw.weights || raw.metrics;
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
    isDemoMode: isDemoMode,
    enterDemoMode: enterDemoMode,
    exitDemoMode: exitDemoMode
  };

  root.FitStore = FitStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitStore;
})(typeof window !== 'undefined' ? window : globalThis);
