/* פיט — pure domain logic: consistency, XP, levels, achievements. No I/O, no DOM. */
(function (root) {
  'use strict';

  const C = root.FitConfig;

  function todayISO(d) {
    const date = d ? new Date(d) : new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseISO(iso) {
    const parts = String(iso).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return todayISO(d);
  }

  function lastNDates(n, end) {
    const endDate = end ? new Date(end) : new Date();
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - i);
      out.push(todayISO(d));
    }
    return out;
  }

  function weekStartSunday(iso) {
    const d = parseISO(iso);
    d.setDate(d.getDate() - d.getDay());
    return todayISO(d);
  }

  function formatDay(iso, opts) {
    return parseISO(iso).toLocaleDateString('he-IL', opts || {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
  }

  function formatDayLong(iso) {
    return parseISO(iso).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  function nutritionOn(state, iso) {
    return (state.nutrition || []).find(function (n) { return n.date === iso; }) || null;
  }

  function workoutsOn(state, iso) {
    return (state.workouts || []).filter(function (w) { return w.date === iso; });
  }

  function workoutsInWeek(state, iso) {
    const start = weekStartSunday(iso);
    const end = addDays(start, 6);
    return (state.workouts || []).filter(function (w) {
      return w.date >= start && w.date <= end;
    });
  }

  function metricsOn(state, iso) {
    return (state.metrics || []).filter(function (m) { return m.date === iso; });
  }

  function proteinTarget(state) {
    return Number(state.settings.dailyProteinTarget) || 150;
  }

  function waterVessel(state) {
    const set = (state && state.settings) || {};
    const kind = set.waterVessel === 'bottle' ? 'bottle' : 'cup';
    const fallback = kind === 'bottle' ? 500 : (C.WATER_CUP_ML || 250);
    const ml = Math.max(50, Math.round(Number(set.waterVesselMl) || fallback));
    return {
      kind: kind,
      ml: ml,
      label: kind === 'bottle' ? 'בקבוק' : 'כוס',
      labelPlural: kind === 'bottle' ? 'בקבוקים' : 'כוסות',
      labelOne: kind === 'bottle' ? 'בקבוק' : 'כוס'
    };
  }

  function waterTarget(state) {
    const t = Number(state && state.settings && state.settings.dailyWaterTarget);
    if (t > 0 && t <= 30 && !(state.settings && state.settings.waterInMl)) {
      return Math.round(t * (C.WATER_CUP_ML || 250));
    }
    return t > 0 ? t : (C.WATER_DEFAULT_GOAL_ML || 2000);
  }

  function formatLiters(ml) {
    const L = (Number(ml) || 0) / 1000;
    const rounded = Math.round(L * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
    const one = Math.round(L * 10) / 10;
    return String(one);
  }

  function formatWaterProgress(current, target) {
    return formatLiters(current) + ' / ' + formatLiters(target) + ' ל׳';
  }

  function waterUnitCount(ml, vesselMl) {
    const v = Number(vesselMl) || (C.WATER_CUP_ML || 250);
    return (Number(ml) || 0) / v;
  }

  function formatWaterUnits(ml, vessel) {
    vessel = vessel || { ml: C.WATER_CUP_ML || 250, label: 'כוס', labelPlural: 'כוסות', labelOne: 'כוס' };
    const n = waterUnitCount(ml, vessel.ml);
    const shown = Math.round(n * 10) / 10;
    const isOne = Math.abs(shown - 1) < 0.05;
    const num = (Math.abs(shown - Math.round(shown)) < 0.05) ? String(Math.round(shown)) : String(shown);
    const word = isOne ? (vessel.labelOne || vessel.label) : vessel.labelPlural;
    return num + ' ' + word;
  }

  function hitsProtein(state, iso) {
    const n = nutritionOn(state, iso);
    return !!(n && Number(n.protein) >= proteinTarget(state));
  }

  function hitsWater(state, iso) {
    const n = nutritionOn(state, iso);
    return !!(n && Number(n.water) >= waterTarget(state));
  }

  /** A consistency-day counts if a workout was logged or protein target was hit. */
  function dayQualifies(state, iso) {
    if (workoutsOn(state, iso).length > 0) return true;
    return hitsProtein(state, iso);
  }

  function currentStreak(state, now) {
    const lookback = lastNDates(400, now);
    let start = 0;
    if (lookback.length && !dayQualifies(state, lookback[0])) start = 1;
    let streak = 0;
    for (let i = start; i < lookback.length; i++) {
      if (dayQualifies(state, lookback[i])) streak += 1;
      else break;
    }
    return streak;
  }

  /** Longest qualifying streak in recorded history (and current). */
  function bestStreak(state, now) {
    const dates = new Set();
    (state.workouts || []).forEach(function (w) { dates.add(w.date); });
    (state.nutrition || []).forEach(function (n) { dates.add(n.date); });
    if (!dates.size) return currentStreak(state, now);
    const sorted = Array.from(dates).sort();
    const from = addDays(sorted[0], -1);
    const endISO = todayISO(now);
    const all = [];
    for (let iso = from; iso <= endISO; iso = addDays(iso, 1)) all.push(iso);
    let best = 0;
    let run = 0;
    for (let i = 0; i < all.length; i++) {
      if (dayQualifies(state, all[i])) {
        run += 1;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    return Math.max(best, currentStreak(state, now));
  }

  function computeConsistency(state, now) {
    const days = C.CONSISTENCY_DAYS;
    const dates = lastNDates(days, now);
    const dateSet = new Set(dates);
    const weeklyTarget = Number(state.settings.weeklyWorkoutTarget) || 4;
    const expectedWorkouts = weeklyTarget * (days / 7);
    const workoutsDone = (state.workouts || []).filter(function (w) {
      return dateSet.has(w.date);
    }).length;
    const trainingScore = expectedWorkouts <= 0 ? 1 : Math.min(1, workoutsDone / expectedWorkouts);

    let proteinHits = 0;
    for (let i = 0; i < dates.length; i++) {
      if (hitsProtein(state, dates[i])) proteinHits += 1;
    }
    const nutritionScore = proteinHits / days;
    const combined = (trainingScore + nutritionScore) / 2;
    const hasData = (state.workouts || []).some(function (w) { return dateSet.has(w.date); })
      || (state.nutrition || []).some(function (n) { return dateSet.has(n.date); });

    return {
      days: days,
      expectedWorkouts: expectedWorkouts,
      workoutsDone: workoutsDone,
      proteinHits: proteinHits,
      trainingScore: trainingScore,
      nutritionScore: nutritionScore,
      combined: combined,
      streak: currentStreak(state, now),
      bestStreak: bestStreak(state, now),
      hasData: hasData,
      todayQualifies: dayQualifies(state, dates[0])
    };
  }

  /**
   * Best numeric value per field per day, across sources (manual + future Whoop).
   */
  function bestMetricsByDate(state) {
    const map = {};
    (state.metrics || []).forEach(function (m) {
      const cur = map[m.date] || { date: m.date, sources: [] };
      cur.sources.push(m.source || 'manual');
      C.METRIC_FIELDS.forEach(function (f) {
        const val = m[f.key];
        if (val === null || val === undefined || val === '') return;
        const num = Number(val);
        if (Number.isNaN(num)) return;
        if (cur[f.key] === undefined || num > Number(cur[f.key])) cur[f.key] = num;
      });
      map[m.date] = cur;
    });
    return map;
  }

  const METRIC_SNAPSHOT_KEYS = [
    'sleepHours', 'sleepInBedHours', 'sleepPerformance', 'sleepEfficiency', 'sleepConsistency',
    'sleepLightHours', 'sleepDeepHours', 'sleepRemHours', 'sleepAwakeHours',
    'sleepCycles', 'sleepDisturbances', 'respiratoryRate',
    'recoveryPct', 'hrv', 'rhr', 'spo2', 'skinTempC',
    'strain', 'kilojoule', 'avgHr', 'maxHr'
  ];

  function isPresent(val) {
    return val !== null && val !== undefined && val !== '';
  }

  function asNum(val) {
    if (!isPresent(val)) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function metricSnapshot(state, iso) {
    const rows = (metricsOn(state, iso) || []).slice();
    const out = { date: iso, sources: [], records: rows, hasWhoop: false, hasAny: false };
    function apply(row) {
      if (!row) return;
      if (row.source) {
        out.sources.push(row.source);
        if (row.source === 'whoop') out.hasWhoop = true;
      }
      METRIC_SNAPSHOT_KEYS.forEach(function (key) {
        const n = asNum(row[key]);
        if (n === null) return;
        out[key] = n;
      });
      if (row.notes) out.notes = row.notes;
      if (row.source) out.source = row.source;
    }
    rows.filter(function (r) { return (r.source || 'manual') !== 'whoop'; }).forEach(apply);
    rows.filter(function (r) { return r.source === 'whoop'; }).forEach(apply);
    out.hasAny = METRIC_SNAPSHOT_KEYS.some(function (k) { return isPresent(out[k]); });
    if (out.hasAny && out.sources.indexOf('whoop') >= 0) out.hasWhoop = true;
    return out;
  }

  function formatHoursClock(hours) {
    const n = asNum(hours);
    if (n === null) return '';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    var h = Math.floor(abs);
    var m = Math.round((abs - h) * 60);
    if (m === 60) { h += 1; m = 0; }
    return sign + h + ':' + String(m).padStart(2, '0');
  }

  function recoveryZone(pct) {
    const n = asNum(pct);
    if (n === null) return null;
    if (n >= 67) return 'green';
    if (n >= 34) return 'yellow';
    return 'red';
  }

  function homeInsight(state, iso) {
    const m = metricSnapshot(state, iso);
    const workouts = workoutsOn(state, iso) || [];
    const rec = asNum(m.recoveryPct);
    const sleepP = asNum(m.sleepPerformance);
    const sleepH = asNum(m.sleepHours);
    const strain = asNum(m.strain);
    const zone = recoveryZone(rec);
    const hasCore = rec !== null || sleepP !== null || strain !== null;
    if (!hasCore) {
      return {
        title: 'אין עדיין נתוני Whoop',
        body: 'אחרי חיבור ומשיכת נתונים יופיעו כאן שינה, התאוששות ומאמץ ליום שנבחר.',
        tone: 'empty'
      };
    }
    var title = 'סיכום היום';
    var body = '';
    var tone = zone || 'neutral';
    if (zone === 'red') {
      title = 'הגוף בשיקום';
      body = 'ההתאוששות ' + Math.round(rec) + '% — יום אדום. כדאי אימון קל יותר, או מנוחה, שינה והידרציה.';
    } else if (zone === 'yellow') {
      title = 'הגוף מתאושש';
      body = 'ההתאוששות ' + Math.round(rec) + '% — יום מתון. אפשר להתאמן, בלי להגזים במאמץ.';
    } else if (zone === 'green') {
      title = 'מוכנים ליום חזק';
      body = 'ההתאוששות ' + Math.round(rec) + '% — יום טוב לאימון איכותי.';
    } else if (sleepP !== null) {
      title = sleepP < 60 ? 'שינה חלקית' : 'שינה טובה';
      body = 'ביצועי השינה ' + Math.round(sleepP) + '%.';
    } else if (strain !== null) {
      title = 'מאמץ היום';
      body = 'המאמץ עומד על ' + (Math.round(strain * 10) / 10) + ' מתוך 21.';
    }
    if (sleepP !== null && sleepP < 50) {
      body += (body ? ' ' : '') + 'ביצועי השינה היו ' + Math.round(sleepP) + '% בלבד.';
    } else if (sleepH !== null && sleepH < 6 && !(sleepP !== null && sleepP < 50)) {
      body += (body ? ' ' : '') + 'זמן השינה היה קצר (' + formatHoursClock(sleepH) + ').';
    }
    if (strain !== null && strain >= 14) {
      body += (body ? ' ' : '') + 'המאמץ כבר גבוה היום — תנו לגוף מנוחה.';
    }
    if (workouts.length && zone === 'red') {
      body += (body ? ' ' : '') + 'כבר תועד אימון — עדיף עכשיו יום התאוששות.';
    } else if (!workouts.length && zone === 'green') {
      body += (body ? ' ' : '') + 'עדיין לא תועד אימון, וזה יום טוב לצאת אליו.';
    }
    return { title: title, body: body.trim(), tone: tone };
  }

  function metricHitsRule(value, rule) {
    if (rule.min === null || rule.min === undefined) return false;
    if (value === null || value === undefined || value === '') return false;
    const num = Number(value);
    if (Number.isNaN(num)) return false;
    if (rule.compare === 'lte') return num <= rule.min;
    return num >= rule.min;
  }

  function levelFromTotalXP(total) {
    const xp = Math.max(0, Number(total) || 0);
    let level = 1;
    let remaining = xp;
    let guard = 0;
    while (remaining >= C.LEVELS.xpToNext(level) && guard < 200) {
      remaining -= C.LEVELS.xpToNext(level);
      level += 1;
      guard += 1;
    }
    const needed = C.LEVELS.xpToNext(level);
    return {
      level: level,
      total: xp,
      xpInLevel: remaining,
      xpNeeded: needed,
      progress: needed ? remaining / needed : 1
    };
  }

  function computeXP(state, now) {
    const events = [];
    const rules = C.XP_RULES;

    (state.workouts || []).forEach(function (w) {
      events.push({
        date: w.date,
        type: rules.workoutLogged.id,
        xp: rules.workoutLogged.xp,
        label: rules.workoutLogged.label,
        ref: w.id
      });
    });

    (state.nutrition || []).forEach(function (n) {
      if (Number(n.protein) >= proteinTarget(state)) {
        events.push({
          date: n.date,
          type: rules.proteinTarget.id,
          xp: rules.proteinTarget.xp,
          label: rules.proteinTarget.label
        });
      }
      if (Number(n.water) >= waterTarget(state)) {
        events.push({
          date: n.date,
          type: rules.waterTarget.id,
          xp: rules.waterTarget.xp,
          label: rules.waterTarget.label
        });
      }
    });

    const byDate = bestMetricsByDate(state);
    Object.keys(byDate).forEach(function (date) {
      const row = byDate[date];
      Object.keys(rules.metrics).forEach(function (key) {
        const rule = rules.metrics[key];
        if (!rule.xp) return;
        if (metricHitsRule(row[rule.field], rule)) {
          events.push({
            date: date,
            type: rule.id,
            xp: rule.xp,
            label: rule.label,
            source: row.sources.join(',')
          });
        }
      });
    });

    const longest = bestStreak(state, now);
    rules.streakMilestones.forEach(function (ms) {
      if (longest >= ms.days) {
        events.push({
          date: null,
          type: 'streak',
          xp: ms.xp,
          label: ms.label,
          id: ms.id,
          days: ms.days
        });
      }
    });

    const total = events.reduce(function (sum, e) { return sum + (Number(e.xp) || 0); }, 0);
    const level = levelFromTotalXP(total);

    const today = todayISO(now);
    const todayEvents = events.filter(function (e) { return e.date === today; });
    const todayXP = todayEvents.reduce(function (sum, e) { return sum + (Number(e.xp) || 0); }, 0);

    return {
      total: total,
      events: events,
      level: level,
      todayXP: todayXP,
      todayEvents: todayEvents,
      bestStreak: longest
    };
  }

  function proteinHitCount(state) {
    return (state.nutrition || []).filter(function (n) {
      return Number(n.protein) >= proteinTarget(state);
    }).length;
  }

  function computeAchievements(state, xpInfo) {
    const workoutCount = (state.workouts || []).length;
    const metricsCount = (state.metrics || []).length;
    const longest = xpInfo ? xpInfo.bestStreak : bestStreak(state);
    const level = xpInfo ? xpInfo.level.level : 1;
    const proteinDays = proteinHitCount(state);
    const ctx = {
      firstWorkout: workoutCount >= 1,
      workouts10: workoutCount >= 10,
      workouts30: workoutCount >= 30,
      streak7: longest >= 7,
      streak14: longest >= 14,
      protein7: proteinDays >= 7,
      firstMetrics: metricsCount >= 1,
      level5: level >= 5
    };
    return C.ACHIEVEMENTS.map(function (a) {
      return {
        id: a.id,
        title: a.title,
        desc: a.desc,
        icon: a.icon,
        unlocked: !!ctx[a.check]
      };
    });
  }


  function normName(name) {
    return String(name || '').replace(/[\u200E\u200F\u202A-\u202E]/g, '').replace(/\s+/g, ' ').trim();
  }

  function foldName(name) {
    return normName(name)
      .replace(/[\u05F3\u05F4''״"’‘]/g, '')
      .replace(/[־–—−-]+/g, ' ')
      .replace(/[()[\]{}.,/\\:+]/g, ' ')
      .replace(/ך/g, 'כ')
      .replace(/ם/g, 'מ')
      .replace(/ן/g, 'נ')
      .replace(/ף/g, 'פ')
      .replace(/ץ/g, 'צ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function levenshtein(a, b) {
    a = String(a || '');
    b = String(b || '');
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = [];
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const cur = dp[j];
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
        prev = cur;
      }
    }
    return dp[n];
  }

  function nearNameAllowed(len) {
    if (len <= 10) return 1;
    return 2;
  }

  function exerciseCatalog(state) {
    const out = [];
    const seen = {};
    function add(n) {
      const name = normName(n);
      if (!name) return;
      const key = foldName(name);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(name);
    }
    Object.keys((C && C.EXERCISE_MUSCLES) || {}).forEach(add);
    ((state && state.exercises) || []).forEach(function (e) {
      add(e && (e.name || e.id) ? (e.name || e.id) : e);
    });
    exerciseNames(state).forEach(add);
    ((state && state.templates) || []).forEach(function (t) {
      ((t && t.exercises) || []).forEach(function (e) { add(e && e.name); });
    });
    Object.keys((state && state.substitutions) || {}).forEach(function (k) {
      add(k);
      ((state.substitutions[k] || [])).forEach(function (s) { add(s && s.name); });
    });
    return out;
  }

  function canonicalName(name, catalog) {
    const cleaned = normName(name);
    if (!cleaned) return '';
    const folded = foldName(cleaned);
    if (!folded) return cleaned;
    const list = catalog || [];
    let i;
    for (i = 0; i < list.length; i++) {
      if (foldName(list[i]) === folded) return list[i];
    }
    let best = '';
    let bestD = 99;
    for (i = 0; i < list.length; i++) {
      const other = foldName(list[i]);
      if (!other) continue;
      const d = levenshtein(other, folded);
      if (!d) return list[i];
      const allowed = nearNameAllowed(Math.max(other.length, folded.length));
      if (d <= allowed && d < bestD) {
        best = list[i];
        bestD = d;
      }
    }
    return best || cleaned;
  }

  function isUnworkedSkip(ex) {
    if (!ex || !ex.skipped) return false;
    if (ex.setLogs && ex.setLogs.length) return false;
    if ((Number(ex.sets) || 0) > 0 && (Number(ex.weight) || Number(ex.reps) || Number(ex.secs))) return false;
    return true;
  }

  function expandSets(ex) {
    if (ex && Array.isArray(ex.setLogs) && ex.setLogs.length) {
      return ex.setLogs.map(function (s) {
        const row = { weight: Number(s.weight) || 0, reps: Number(s.reps) || 0, secs: Number(s.secs) || 0 };
        if (s.restAfter != null && s.restAfter !== '') row.restAfter = Number(s.restAfter) || 0;
        return row;
      });
    }
    if (isUnworkedSkip(ex) || (ex && ex.skipped && !(Number(ex.sets) > 0))) return [];
    const sets = Math.max(1, Number(ex && ex.sets) || 0);
    const reps = Number(ex && ex.reps) || 0;
    const w = Number(ex && ex.weight) || 0;
    const secs = Number(ex && ex.secs) || 0;
    if (!reps && !w && !secs) return [];
    const out = [];
    for (let i = 0; i < sets; i++) out.push({ weight: w, reps: reps, secs: secs });
    return out;
  }

  function isStaticName(name) {
    return !!(C.isStaticName && C.isStaticName(name));
  }

  function isStaticEx(ex, name) {
    if (ex && ex.static === true) return true;
    if (ex && ex.static === false) return false;
    if (ex && (Number(ex.secs) > 0 || Number(ex.secsMax) > 0 || Number(ex.secsMin) > 0)) {
      const logs = ex.setLogs;
      if (logs && logs.length && logs.every(function (s) { return (Number(s.secs) || 0) > 0 && !(Number(s.reps) > 0); })) return true;
    }
    return isStaticName(name || (ex && ex.name));
  }

  function isBodyweightName(name) {
    return !!(C.isBodyweightName && C.isBodyweightName(name));
  }

  function isBodyweightEx(ex, name) {
    if (ex && ex.bodyweight === true) return true;
    if (ex && ex.bodyweight === false) return false;
    return isBodyweightName(name || (ex && ex.name));
  }

  function isMaxReps(ex) {
    if (!ex) return false;
    if (ex.repsMode === 'max') return true;
    const a = String(ex.repsMin == null ? '' : ex.repsMin).toUpperCase();
    const b = String(ex.repsMax == null ? '' : ex.repsMax).toUpperCase();
    return a === 'MAX' || b === 'MAX';
  }

  function bodyWeightOn(state, date) {
    if (!state || !state.weights || !state.weights.length) return 0;
    const d = date || todayISO();
    let best = null;
    state.weights.forEach(function (w) {
      if (!w || !w.date || w.date > d) return;
      if (!best || w.date > best.date) best = w;
    });
    return best ? (Number(best.weight) || 0) : 0;
  }

  function setVolume(ex, state, date) {
    if (isUnworkedSkip(ex)) return 0;
    if (isStaticEx(ex)) return 0;
    const logs = expandSets(ex);
    const bwMode = isBodyweightEx(ex);
    const bodyKg = bwMode && state ? bodyWeightOn(state, date) : 0;
    const repsFallback = bwMode && !bodyKg;
    if (logs.length) {
      return logs.reduce(function (sum, s) {
        const reps = Number(s.reps) || 0;
        if (repsFallback) return sum + reps;
        const w = (Number(s.weight) || 0) + (bwMode ? bodyKg : 0);
        return sum + w * reps;
      }, 0);
    }
    const sets = Number(ex && ex.sets) || 0;
    const reps = Number(ex && ex.reps) || 0;
    if (repsFallback) return sets * reps;
    const w = (Number(ex && ex.weight) || 0) + (bwMode ? bodyKg : 0);
    return sets * reps * w;
  }

  /** Epley estimated 1RM: weight * (1 + reps/30). 1-rep sets equal the weight. */
  function epley1RM(weight, reps) {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }

  function sessionsForExercise(state, name) {
    const target = normName(name);
    if (!target) return [];
    const sessions = [];
    (state.workouts || []).forEach(function (w) {
      const rows = (w.exercises || []).filter(function (e) {
        return normName(e.name) === target && !isUnworkedSkip(e);
      });
      if (!rows.length) return;
      let volume = 0;
      let topWeight = 0;
      let topRepsAtTop = 0;
      let maxReps = 0;
      let totalReps = 0;
      let maxHold = 0;
      let totalSecs = 0;
      let best1RM = 0;
      let bestRow = null;
      const bwMode = rows.some(function (e) { return isBodyweightEx(e, name); });
      const staticMode = rows.some(function (e) { return isStaticEx(e, name); });
      const bodyKg = bwMode ? bodyWeightOn(state, w.date) : 0;
      rows.forEach(function (e) {
        volume += setVolume(e, state, w.date);
        const logs = expandSets(e);
        if (!logs.length) {
          const wgt = Number(e.weight) || 0;
          const reps = Number(e.reps) || 0;
          const hold = Number(e.secs) || 0;
          totalReps += reps * (Math.max(1, Number(e.sets) || 1));
          totalSecs += hold * (Math.max(1, Number(e.sets) || 1));
          if (reps > maxReps) maxReps = reps;
          if (hold > maxHold) maxHold = hold;
          const est = epley1RM(wgt + bodyKg, reps);
          if (wgt > topWeight || (wgt === topWeight && reps > topRepsAtTop)) {
            topWeight = wgt;
            topRepsAtTop = reps;
          }
          if (est > best1RM) {
            best1RM = est;
            bestRow = e;
          }
          return;
        }
        logs.forEach(function (s) {
          totalReps += Number(s.reps) || 0;
          totalSecs += Number(s.secs) || 0;
          if (s.reps > maxReps) maxReps = s.reps;
          if ((Number(s.secs) || 0) > maxHold) maxHold = Number(s.secs) || 0;
          const est = epley1RM((Number(s.weight) || 0) + bodyKg, s.reps);
          if (s.weight > topWeight || (s.weight === topWeight && s.reps > topRepsAtTop)) {
            topWeight = s.weight;
            topRepsAtTop = s.reps;
          }
          if (est > best1RM) {
            best1RM = est;
            bestRow = { weight: s.weight, reps: s.reps, name: e.name };
          }
        });
      });
      sessions.push({
        workoutId: w.id,
        date: w.date,
        type: w.type,
        customType: w.customType,
        rows: rows,
        finishedEarly: rows.some(function (e) { return !!e.finishedEarly; }),
        volume: volume,
        topWeight: topWeight,
        topReps: topRepsAtTop,
        maxReps: maxReps,
        totalReps: totalReps,
        maxHold: maxHold,
        totalSecs: totalSecs,
        e1rm: best1RM,
        bestRow: bestRow,
        bodyweight: bwMode,
        bodyWeightUsed: bodyKg,
        static: staticMode
      });
    });
    sessions.sort(function (a, b) {
      return a.date.localeCompare(b.date) || String(a.workoutId).localeCompare(String(b.workoutId));
    });
    return sessions;
  }

  function attachPRs(sessions) {
    let maxW = 0;
    let maxE1 = 0;
    let maxVol = 0;
    let maxR = 0;
    let maxH = 0;
    const bestRepsAt = {};
    sessions.forEach(function (s, idx) {
      const types = [];
      if (s.topWeight > maxW && s.topWeight > 0) {
        if (idx > 0) types.push('weight');
        maxW = s.topWeight;
      }
      if (s.e1rm > maxE1 && s.e1rm > 0) {
        if (idx > 0) types.push('e1rm');
        maxE1 = s.e1rm;
      }
      if (s.volume > maxVol && s.volume > 0) {
        if (idx > 0) types.push('volume');
        maxVol = s.volume;
      }
      if (s.maxReps > maxR && s.maxReps > 0) {
        if (idx > 0) types.push('reps');
        maxR = s.maxReps;
      }
      if (s.maxHold > maxH && s.maxHold > 0) {
        if (idx > 0) types.push('time');
        maxH = s.maxHold;
      }
      (s.rows || []).forEach(function (e) {
        const logs = expandSets(e);
        const use = logs.length ? logs : [{ weight: Number(e.weight) || 0, reps: Number(e.reps) || 0 }];
        use.forEach(function (log) {
          const w = Number(log.weight) || 0;
          const r = Number(log.reps) || 0;
          if (r <= 0) return;
          if (w <= 0 && !s.bodyweight) return;
          const key = String(w);
          const prev = bestRepsAt[key] || 0;
          if (r > prev) {
            /* max-reps PR already counted via maxR; per-load only when weight is set */
            if (prev > 0 && w > 0 && types.indexOf('reps') === -1) types.push('reps');
            bestRepsAt[key] = r;
          }
        });
      });
      const unique = [];
      types.forEach(function (tp) {
        if (unique.indexOf(tp) === -1) unique.push(tp);
      });
      s.prTypes = unique;
      s.isPR = unique.length > 0;
      s.isBaseline = idx === 0;
    });
    return sessions;
  }

  function bestRepsTable(sessions) {
    const map = {};
    sessions.forEach(function (s) {
      (s.rows || []).forEach(function (e) {
        const logs = expandSets(e);
        const use = logs.length ? logs : [{ weight: Number(e.weight) || 0, reps: Number(e.reps) || 0 }];
        use.forEach(function (log) {
          const w = Number(log.weight) || 0;
          const r = Number(log.reps) || 0;
          if (r <= 0) return;
          if (w <= 0 && !s.bodyweight && !isBodyweightEx(e)) return;
          const key = String(w);
          if (!map[key] || r > map[key].reps) {
            map[key] = { weight: w, reps: r, date: s.date, bodyweight: !!(s.bodyweight || isBodyweightEx(e)) };
          }
        });
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return b.weight - a.weight;
    });
  }

  function exerciseStats(sessions, now) {
    const list = attachPRs(sessions.slice());
    const today = todayISO(now);
    const prSessions = list.filter(function (s) { return s.isPR; });
    const lastPR = prSessions.length ? prSessions[prSessions.length - 1] : null;
    let daysSince = null;
    if (lastPR) {
      const a = parseISO(lastPR.date);
      const b = parseISO(today);
      daysSince = Math.round((b - a) / 86400000);
    }
    const last30 = addDays(today, -30);
    const prLast30 = prSessions.filter(function (s) { return s.date >= last30; }).length;
    const first = list[0] ? list[0].date : today;
    const weeks = Math.max(1 / 7, (parseISO(today) - parseISO(first)) / (7 * 86400000));
    const ratePerWeek = prSessions.length / weeks;
    const denom = Math.max(1, list.length);
    const sessionPct = prSessions.length / denom;
    return {
      sessions: list,
      totalSessions: list.length,
      totalPRs: prSessions.length,
      prLast30: prLast30,
      prPerWeek: ratePerWeek,
      prSessionPct: sessionPct,
      daysSinceLastPR: daysSince,
      lastPR: lastPR,
      currentMaxWeight: list.reduce(function (m, s) { return Math.max(m, s.topWeight); }, 0),
      currentMaxE1rm: list.reduce(function (m, s) { return Math.max(m, s.e1rm); }, 0),
      currentMaxVolume: list.reduce(function (m, s) { return Math.max(m, s.volume); }, 0),
      currentMaxReps: list.reduce(function (m, s) { return Math.max(m, s.maxReps || 0); }, 0),
      currentMaxHold: list.reduce(function (m, s) { return Math.max(m, s.maxHold || 0); }, 0),
      bestReps: bestRepsTable(list),
      bodyweight: list.some(function (s) { return s.bodyweight; }),
      static: list.some(function (s) { return s.static; })
    };
  }

  function exerciseIndex(state) {
    const map = {};
    (state.workouts || []).forEach(function (w) {
      const names = {};
      (w.exercises || []).forEach(function (e) {
        const name = normName(e.name);
        if (!name) return;
        if (!map[name]) {
          map[name] = { name: name, sessions: 0, lastDate: w.date, last: e, volume: 0 };
        }
        map[name].volume += setVolume(e, state, w.date);
        if (w.date > map[name].lastDate || (w.date === map[name].lastDate && e === e)) {
          map[name].lastDate = w.date;
          map[name].last = e;
        }
        names[name] = true;
      });
      Object.keys(names).forEach(function (name) { map[name].sessions += 1; });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function lastPerformance(state, name, beforeDate, exceptWorkoutId) {
    const target = normName(name);
    if (!target) return null;
    const list = (state.workouts || []).slice().sort(function (a, b) {
      return b.date.localeCompare(a.date);
    });
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (exceptWorkoutId && w.id === exceptWorkoutId) continue;
      if (beforeDate && w.date > beforeDate) continue;
      const rows = (w.exercises || []).filter(function (e) { return normName(e.name) === target; });
      if (!rows.length) continue;
      return { date: w.date, workoutId: w.id, rows: rows, last: rows[rows.length - 1] };
    }
    return null;
  }

  function exerciseNames(state) {
    const set = {};
    (state.workouts || []).forEach(function (w) {
      (w.exercises || []).forEach(function (e) {
        const n = normName(e.name);
        if (n) set[n] = true;
      });
    });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'he'); });
  }


  function weightStep(name, weight) {
    const n = normName(name);
    const smallNames = C.SMALL_LIFTS || [];
    const isSmall = smallNames.indexOf(n) !== -1 || (Number(weight) > 0 && Number(weight) < 40);
    return isSmall ? 1.25 : 2.5;
  }

  function lastSessionSets(state, name, exceptWorkoutId) {
    const last = lastPerformance(state, name, null, exceptWorkoutId);
    if (!last) return [];
    let logs = [];
    (last.rows || []).forEach(function (row) {
      logs = logs.concat(expandSets(row));
    });
    return logs;
  }

  function suggestNextSet(state, name, currentSets, exceptWorkoutId) {
    const history = lastSessionSets(state, name, exceptWorkoutId);
    const planned = suggestFromHistory(history, name);
    if (currentSets && currentSets.length) {
      const last = currentSets[currentSets.length - 1];
      return {
        weight: Number(last.weight) || planned.weight,
        reps: planned.reps,
        step: planned.step,
        reason: 'סט המשך',
        fromHistory: planned
      };
    }
    return planned;
  }

  function suggestFromHistory(lastSets, name) {
    const stepDefault = 2.5;
    if (!lastSets || !lastSets.length) {
      const bw = isBodyweightName(name);
      const st = isStaticName(name);
      return { weight: (bw || st) ? 0 : 20, reps: st ? 0 : 8, secs: st ? 45 : 0, step: stepDefault, reason: 'אין היסטוריה — ברירת מחדל', allHit: false };
    }
    const hasHold = lastSets.some(function (s) { return (Number(s.secs) || 0) > 0; });
    const noReps = lastSets.every(function (s) { return !(Number(s.reps) > 0); });
    if (hasHold && (noReps || isStaticName(name))) {
      const maxS = lastSets.reduce(function (m, s) { return Math.max(m, Number(s.secs) || 0); }, 0);
      const lastW = lastSets[lastSets.length - 1] ? (Number(lastSets[lastSets.length - 1].weight) || 0) : 0;
      return { weight: lastW, reps: 0, secs: maxS, step: stepDefault, reason: 'לפי ההחזקה הקודמת', allHit: false, lastWeight: lastW, lastSecs: maxS };
    }
    const maxW = lastSets.reduce(function (m, s) { return Math.max(m, Number(s.weight) || 0); }, 0);
    const work = lastSets.filter(function (s) { return (Number(s.weight) || 0) >= maxW * 0.95; });
    const W = work.length ? work[0].weight : lastSets[0].weight;
    const R = work.length ? work[0].reps : lastSets[0].reps;
    const allHit = work.length > 0 && work.every(function (s) { return (Number(s.reps) || 0) >= R; });
    const step = weightStep(name, W);
    if (allHit) {
      const bw = isBodyweightName(name);
      if (bw && !(Number(W) > 0)) {
        return {
          weight: 0,
          reps: (Number(R) || 0) + 1,
          step: step,
          reason: 'כל הסטים הושלמו — חזרה נוספת',
          allHit: true,
          lastWeight: W,
          lastReps: R
        };
      }
      return {
        weight: Math.round((W + step) * 4) / 4,
        reps: R,
        step: step,
        reason: 'כל הסטים הושלמו ב־' + W + ' ק״ג — העלאת משקל',
        allHit: true,
        lastWeight: W,
        lastReps: R
      };
    }
    return {
      weight: W,
      reps: R + 1,
      step: step,
      reason: 'לא כל הסטים הושלמו — אותו משקל, חזרה נוספת',
      allHit: false,
      lastWeight: W,
      lastReps: R
    };
  }

  function setIsPR(state, name, weight, reps, exceptWorkoutId, secs) {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
    const hold = Number(secs) || 0;
    const est = epley1RM(w, r);
    const sessions = attachPRs(sessionsForExercise(state, name).filter(function (s) {
      return !exceptWorkoutId || s.workoutId !== exceptWorkoutId;
    }));
    let maxW = 0;
    let maxE1 = 0;
    let bestReps = 0;
    sessions.forEach(function (s) {
      if (s.topWeight > maxW) maxW = s.topWeight;
      if (s.e1rm > maxE1) maxE1 = s.e1rm;
      (s.rows || []).forEach(function (row) {
        expandSets(row).forEach(function (log) {
          if (log.weight === w && log.reps > bestReps) bestReps = log.reps;
        });
      });
    });
    let bestAnyReps = 0;
    sessions.forEach(function (s) {
      if ((s.maxReps || 0) > bestAnyReps) bestAnyReps = s.maxReps;
    });
    const bw = isBodyweightName(name) || sessions.some(function (s) { return s.bodyweight; });
    const bodyKg = bw ? bodyWeightOn(state, todayISO()) : 0;
    const estEff = epley1RM(w + bodyKg, r);
    let bestHold = 0;
    sessions.forEach(function (s) {
      if ((s.maxHold || 0) > bestHold) bestHold = s.maxHold;
    });
    const types = [];
    if (hold > 0 || isStaticName(name) || sessions.some(function (s) { return s.static; })) {
      if (hold > 0 && hold > bestHold && bestHold > 0) types.push('time');
      return { isPR: types.length > 0, types: types, e1rm: 0, prevMaxWeight: maxW, prevMaxE1rm: maxE1, prevMaxHold: bestHold };
    }
    if (w > 0 && w > maxW) types.push('weight');
    if ((bw ? estEff : est) > 0 && (bw ? estEff : est) > maxE1) types.push('e1rm');
    if (bw) {
      if (r > 0 && r > bestAnyReps && bestAnyReps > 0) types.push('reps');
    } else if (w > 0 && r > 0 && r > bestReps && bestReps > 0) {
      types.push('reps');
    }
    return { isPR: types.length > 0, types: types, e1rm: bw ? estEff : est, prevMaxWeight: maxW, prevMaxE1rm: maxE1, prevMaxHold: bestHold };
  }

  function lookupMuscles(name) {
    const n = normName(name);
    if (!n) return null;
    if (C.EXERCISE_MUSCLES && C.EXERCISE_MUSCLES[n]) return C.EXERCISE_MUSCLES[n];
    const rules = [
      { re: /לחיצת חזה|חזה|פרפר|שיפוע/, map: { primary: ['chest'], secondary: ['shoulders', 'triceps'] } },
      { re: /שכיבות סמיכה/, map: { primary: ['chest'], secondary: ['shoulders', 'triceps'] } },
      { re: /מקבילים/, map: { primary: ['triceps'], secondary: ['chest', 'shoulders'] } },
      { re: /כפיפות בטן|הרמות רגליים/, map: { primary: ['abs'], secondary: [] } },
      { re: /^פלאנק|^הולו|^hollow|^L-sit|^אל-?סיט/i, map: { primary: ['abs'], secondary: ['shoulders'] } },
      { re: /^וול סיט|^wall\s*sit/i, map: { primary: ['quads'], secondary: ['glutes'] } },
      { re: /^תלייה|^dead\s*hang/i, map: { primary: ['forearms'], secondary: ['lats'] } },
      { re: /מכרעים|סקוואט משקל גוף/, map: { primary: ['quads'], secondary: ['glutes'] } },
      { re: /כתפיים|כתף/, map: { primary: ['shoulders'], secondary: ['triceps'] } },
      { re: /פשיטת מרפק|טרייס/, map: { primary: ['triceps'], secondary: [] } },
      { re: /כפיפת מרפק|יד קדמית|바이/, map: { primary: ['biceps'], secondary: ['forearms'] } },
      { re: /דדליפט|מתנייח/, map: { primary: ['hamstrings', 'glutes', 'lowerback'], secondary: ['upperback'] } },
      { re: /מתח|פולדאון|משיכה/, map: { primary: ['lats'], secondary: ['biceps'] } },
      { re: /חתירה/, map: { primary: ['upperback'], secondary: ['lats', 'biceps'] } },
      { re: /סקוואט|לחיצת רגליים/, map: { primary: ['quads'], secondary: ['glutes', 'hamstrings'] } },
      { re: /כפיפת רגליים|המסטרינג/, map: { primary: ['hamstrings'], secondary: [] } },
      { re: /שוק/, map: { primary: ['calves'], secondary: [] } }
    ];
    for (let i = 0; i < rules.length; i++) {
      if (rules[i].re.test(n)) return rules[i].map;
    }
    return null;
  }

  function weekMuscleLoad(state, now) {
    const muscles = (C.MUSCLES || []).map(function (m) {
      return { id: m.id, label: m.label, view: m.view, sets: 0, volume: 0 };
    });
    const byId = {};
    muscles.forEach(function (m) { byId[m.id] = m; });
    const today = todayISO(now);
    const ws = weekStartSunday(today);
    const we = addDays(ws, 6);
    (state.workouts || []).forEach(function (w) {
      if (w.date < ws || w.date > we) return;
      (w.exercises || []).forEach(function (ex) {
        const map = lookupMuscles(ex.name);
        if (!map) return;
        const logs = expandSets(ex);
        const sets = logs.length || (Number(ex.sets) || 0);
        const vol = setVolume(ex, state, w.date);
        function add(ids, factor) {
          (ids || []).forEach(function (id) {
            if (!byId[id]) return;
            byId[id].sets += sets * factor;
            byId[id].volume += vol * factor;
          });
        }
        add(map.primary, 1);
        add(map.secondary, 0.5);
      });
    });
    const maxSets = muscles.reduce(function (m, x) { return Math.max(m, x.sets); }, 0);
    muscles.forEach(function (m) {
      m.intensity = maxSets > 0 ? Math.min(1, m.sets / maxSets) : 0;
      m.level = m.sets <= 0 ? 0 : m.intensity < 0.25 ? 1 : m.intensity < 0.5 ? 2 : m.intensity < 0.75 ? 3 : 4;
    });
    const neglected = muscles.filter(function (m) {
      if (maxSets <= 0) return false;
      return m.sets <= 0 || m.intensity < 0.2;
    }).sort(function (a, b) { return a.sets - b.sets; });
    return { muscles: muscles, neglected: neglected, maxSets: maxSets, weekStart: ws, weekEnd: we };
  }

  function bestRepsForExercise(state, name) {
    let best = 0;
    sessionsForExercise(state, name).forEach(function (s) {
      if ((s.maxReps || 0) > best) best = s.maxReps;
    });
    return best;
  }

  function bestHoldForExercise(state, name) {
    let best = 0;
    sessionsForExercise(state, name).forEach(function (s) {
      if ((s.maxHold || 0) > best) best = s.maxHold;
    });
    return best;
  }

  function brzycki1RM(weight, reps) {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
    if (w <= 0 || r <= 0 || r > 10) return 0;
    if (r === 1) return w;
    return w * (36 / (37 - r));
  }

  function roundToStep(weight, step) {
    const s = Number(step) > 0 ? Number(step) : 2.5;
    const w = Number(weight) || 0;
    if (w <= 0) return 0;
    return Math.round(Math.round(w / s) * s * 100) / 100;
  }

  function formatLoadKg(w) {
    const n = Number(w) || 0;
    if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
    return String(Math.round(n * 4) / 4);
  }

  function sessionSetCount(session) {
    if (!session) return 0;
    let n = 0;
    (session.rows || []).forEach(function (e) {
      const logs = expandSets(e);
      n += logs.length ? logs.length : (Number(e.sets) || 0);
    });
    return n;
  }

  function lastSetOf(session) {
    if (!session) return null;
    const rows = session.rows || [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const logs = expandSets(rows[i]);
      if (logs.length) return logs[logs.length - 1];
      if (Number(rows[i].reps) || Number(rows[i].secs) || Number(rows[i].weight)) {
        return { weight: Number(rows[i].weight) || 0, reps: Number(rows[i].reps) || 0, secs: Number(rows[i].secs) || 0 };
      }
    }
    return null;
  }

  function hitsTwoForTwo(session, repsMax, extra) {
    if (!session || !(repsMax > 0)) return false;
    const last = lastSetOf(session);
    return !!(last && (Number(last.reps) || 0) >= repsMax + extra);
  }

  function recommendNextLoad(state, name, opts) {
    opts = opts || {};
    const rules = (C && C.LOAD_RULES) || { volumeRate: 0.025, deloadRate: -0.10, staticPlusSec: 5, maxPlusReps: 1, twoForTwoExtra: 2 };
    const target = normName(name);
    if (!target) return null;
    const sessions = sessionsForExercise(state, target).filter(function (s) {
      if (opts.exceptWorkoutId && s.workoutId === opts.exceptWorkoutId) return false;
      if (s.finishedEarly) return false;
      return true;
    });
    if (!sessions.length) return null;
    const last = sessions[sessions.length - 1];
    const prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;
    const prev2 = sessions.length > 2 ? sessions[sessions.length - 3] : null;
    const isMax = !!(opts.repsMode === 'max' || isMaxReps(opts) || isMaxReps(last.rows && last.rows[0]));
    const isBw = !!(opts.bodyweight || last.bodyweight || isBodyweightName(target));
    const isSt = !!(opts.static || last.static || isStaticName(target));
    const plannedSets = Math.max(1, Number(opts.sets) || sessionSetCount(last) || 3);
    let repsMin = Number(opts.repsMin);
    let repsMax = Number(opts.repsMax);
    if (!(repsMin > 0)) repsMin = Math.max(1, Number(last.topReps) || Number(last.maxReps) || 8);
    if (!(repsMax > 0) || repsMax < repsMin) repsMax = repsMin;
    const day = opts.date || todayISO();
    const snap = metricSnapshot ? metricSnapshot(state, day) : {};
    const recPct = snap && snap.recoveryPct != null ? Number(snap.recoveryPct) : null;
    const zone = recoveryZone ? recoveryZone(recPct) : null;
    const dropped2 = !!(last && prev && prev2 && last.e1rm > 0 && prev.e1rm > 0 && prev2.e1rm > 0 &&
      last.e1rm < prev.e1rm && prev.e1rm < prev2.e1rm);
    const droppedHold2 = !!(isSt && last && prev && prev2 && last.maxHold > 0 && prev.maxHold > 0 && prev2.maxHold > 0 &&
      last.maxHold < prev.maxHold && prev.maxHold < prev2.maxHold);
    const droppedReps2 = !!(isBw && !isSt && last && prev && prev2 && last.maxReps > 0 && prev.maxReps > 0 && prev2.maxReps > 0 &&
      last.maxReps < prev.maxReps && prev.maxReps < prev2.maxReps);

    let r = rules.volumeRate;
    let reason = 'נפח +' + (Math.round(r * 1000) / 10) + '% מהאימון הקודם';
    if (dropped2 || droppedHold2 || droppedReps2) {
      r = rules.deloadRate;
      reason = 'ירידה בביצועים בשני אימונים — הפחתה 10%';
    } else if (zone === 'red') {
      r = rules.deloadRate;
      reason = 'התאוששות נמוכה — הפחתה 10%';
    } else if (zone === 'yellow') {
      r = 0;
      reason = 'התאוששות בינונית — שמירה על הנפח';
    } else if (zone === 'green') {
      reason = 'התאוששות טובה · נפח +' + (Math.round(r * 1000) / 10) + '% מהאימון הקודם';
    }

    const twoForTwo = !isSt && !isMax && r >= 0 &&
      hitsTwoForTwo(last, repsMax, rules.twoForTwoExtra) &&
      hitsTwoForTwo(prev, repsMax, rules.twoForTwoExtra);

    const increment = Number(opts.increment) > 0
      ? Number(opts.increment)
      : weightStep(target, last.topWeight || (last.bestRow && last.bestRow.weight) || 0);

    /* Static / timed */
    if (isSt) {
      const lastHold = Number(last.maxHold) || Number(lastSetOf(last) && lastSetOf(last).secs) || 0;
      if (!(lastHold > 0)) return null;
      let secs = lastHold;
      if (r < 0) secs = Math.max(1, Math.round(lastHold * (1 + r)));
      else if (r === 0) secs = lastHold;
      else secs = lastHold + (rules.staticPlusSec || 5);
      const label = plannedSets + '×' + secs + ' שנ׳';
      return {
        kind: 'static',
        sets: plannedSets,
        reps: 0,
        weight: Number(last.topWeight) || 0,
        secs: secs,
        label: label,
        reason: r < 0 ? reason : (r === 0 ? reason : '+5 שנ׳ להחזקה'),
        r: r,
        e1rm: last.e1rm,
        volumeLast: last.volume,
        twoForTwo: false
      };
    }

    /* MAX reps */
    if (isMax) {
      const lastMax = Number(last.maxReps) || Number(lastSetOf(last) && lastSetOf(last).reps) || 0;
      if (!(lastMax > 0)) return null;
      let reps = lastMax;
      if (r < 0) reps = Math.max(1, lastMax - 1);
      else if (r === 0) reps = lastMax;
      else reps = lastMax + (rules.maxPlusReps || 1);
      const w = isBw && !(Number(last.topWeight) > 0) ? 0 : (Number(last.topWeight) || 0);
      const label = w
        ? ('MAX · ' + reps + ' חזרות · ' + formatLoadKg(w) + ' ק״ג')
        : ('MAX · ' + reps + ' חזרות');
      return {
        kind: 'max',
        sets: plannedSets,
        reps: reps,
        weight: w,
        secs: 0,
        label: label,
        reason: r < 0 ? reason : (r === 0 ? reason : 'שיא MAX קודם +1'),
        r: r,
        e1rm: last.e1rm,
        volumeLast: last.volume,
        twoForTwo: false
      };
    }

    /* Bodyweight (no added load): progress reps */
    if (isBw && !(Number(last.topWeight) > 0)) {
      const lastRepsTotal = Number(last.totalReps) || 0;
      const lastAvg = lastRepsTotal && plannedSets ? lastRepsTotal / plannedSets : (Number(last.maxReps) || repsMin);
      let nextTotal = lastRepsTotal * (1 + r);
      if (!(lastRepsTotal > 0)) nextTotal = plannedSets * repsMin * (1 + r);
      let reps = Math.max(1, Math.round(nextTotal / plannedSets));
      if (r > 0 && reps <= lastAvg) reps = Math.ceil(lastAvg) + 1;
      if (reps < repsMin) reps = repsMin;
      if (reps > repsMax && r <= 0) reps = repsMax;
      const label = plannedSets + '×' + reps + ' חזרות';
      return {
        kind: 'bodyweight',
        sets: plannedSets,
        reps: reps,
        weight: 0,
        secs: 0,
        label: label,
        reason: reason,
        r: r,
        e1rm: last.e1rm,
        volumeLast: last.volume,
        volumeNext: plannedSets * reps,
        twoForTwo: false
      };
    }

    /* Weighted: Epley volume target */
    const e1rm = Number(last.e1rm) || 0;
    if (!(e1rm > 0)) return null;
    const vLast = Number(last.volume) || 0;
    const vNext = vLast > 0 ? vLast * (1 + r) : 0;
    let best = null;
    for (let reps = repsMin; reps <= repsMax; reps++) {
      let w = e1rm / (1 + reps / 30);
      w = roundToStep(w, increment);
      if (!(w > 0)) continue;
      const vol = plannedSets * reps * w;
      const err = vNext > 0 ? Math.abs(vol - vNext) : 0;
      const mid = (repsMin + repsMax) / 2;
      const midDist = Math.abs(reps - mid);
      if (!best || err < best.err - 0.01 || (Math.abs(err - best.err) < 0.01 && midDist < best.midDist)) {
        best = { reps: reps, weight: w, volume: vol, err: err, midDist: midDist };
      }
    }
    if (!best) return null;
    if (twoForTwo) {
      best.weight = roundToStep(best.weight + increment, increment);
      best.volume = plannedSets * best.reps * best.weight;
      reason = 'כלל 2-for-2 — העלאת משקל';
    }
    const label = plannedSets + '×' + best.reps + ' · ' + formatLoadKg(best.weight) + ' ק״ג';
    return {
      kind: 'weight',
      sets: plannedSets,
      reps: best.reps,
      weight: best.weight,
      secs: 0,
      label: label,
      reason: reason,
      r: r,
      e1rm: e1rm,
      brzycki: (function () {
        const set = last.bestRow;
        if (!set) return 0;
        return brzycki1RM((Number(set.weight) || 0), Number(set.reps) || 0);
      })(),
      volumeLast: vLast,
      volumeNext: best.volume,
      twoForTwo: twoForTwo,
      increment: increment,
      zone: zone
    };
  }

  function rollingAverage(values, window) {
    const w = window || 7;
    const out = [];
    for (let i = 0; i < values.length; i++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, i - w + 1); j <= i; j++) {
        const v = values[j];
        if (v == null || v === '' || Number.isNaN(Number(v))) continue;
        sum += Number(v);
        n += 1;
      }
      out.push(n ? sum / n : null);
    }
    return out;
  }

  function firstLastPresent(values) {
    let first = null;
    let last = null;
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null && !Number.isNaN(Number(values[i]))) {
        if (first == null) first = Number(values[i]);
        last = Number(values[i]);
      }
    }
    return { first: first, last: last };
  }

  function trendChange(first, last) {
    if (first == null || last == null) return null;
    if (first === 0) return last === 0 ? 0 : null;
    return (last - first) / Math.abs(first);
  }

  function downsampleTrend(labels, values, maxPts) {
    const n = values.length;
    if (n <= maxPts) return { labels: labels, values: values };
    const outL = [];
    const outV = [];
    const step = n / maxPts;
    for (let i = 0; i < maxPts; i++) {
      const a = Math.round(i * step);
      const b = Math.min(n, Math.round((i + 1) * step));
      let sum = 0;
      let c = 0;
      for (let j = a; j < b; j++) {
        if (values[j] == null || Number.isNaN(Number(values[j]))) continue;
        sum += Number(values[j]);
        c += 1;
      }
      outL.push(labels[Math.min(n - 1, Math.floor((a + b - 1) / 2))]);
      outV.push(c ? sum / c : null);
    }
    return { labels: outL, values: outV };
  }

  function computeTrends(state, days, now) {
    const range = Number(days) || 90;
    const dates = lastNDates(range, now).slice().reverse();
    const metrics = bestMetricsByDate(state);
    function metricSeries(key) {
      return dates.map(function (d) {
        const snap = metricSnapshot(state, d);
        if (!snap || snap[key] == null || snap[key] === '') return null;
        const n = Number(snap[key]);
        return Number.isFinite(n) ? n : null;
      });
    }
    const weightByDate = {};
    (state.weights || []).forEach(function (w) {
      if (!w || !w.date) return;
      const n = Number(w.weight);
      if (Number.isFinite(n)) weightByDate[w.date] = n;
    });
    const calByDate = {};
    (state.nutrition || []).forEach(function (n) {
      if (!n || !n.date) return;
      const c = Number(n.calories);
      if (Number.isFinite(c) && c > 0) calByDate[n.date] = c;
    });
    const volumeByDate = {};
    (state.workouts || []).forEach(function (w) {
      if (!w || !w.date) return;
      let v = 0;
      (w.exercises || []).forEach(function (e) { v += setVolume(e, state, w.date); });
      volumeByDate[w.date] = (volumeByDate[w.date] || 0) + v;
    });

    function pack(id, title, unit, raw, upIsGood) {
      const rolled = rollingAverage(raw, 7);
      const ends = firstLastPresent(rolled);
      const change = trendChange(ends.first, ends.last);
      const present = raw.filter(function (v) { return v != null; }).length;
      const plot = downsampleTrend(dates.map(function (d) {
        return parseISO(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
      }), rolled, range > 90 ? 52 : 90);
      return {
        id: id,
        title: title,
        unit: unit || '',
        raw: raw,
        rolled: rolled,
        labels: plot.labels,
        values: plot.values,
        current: ends.last,
        start: ends.first,
        change: change,
        changeAbs: (ends.first != null && ends.last != null) ? (ends.last - ends.first) : null,
        upIsGood: upIsGood,
        points: present
      };
    }

    /* Weekly training volume — one point per week in range */
    const weekStart = weekStartSunday(dates[0]);
    const weekLabels = [];
    const weekVals = [];
    let ws = weekStart;
    const lastDate = dates[dates.length - 1];
    while (ws <= lastDate) {
      const we = addDays(ws, 6);
      let sum = 0;
      let has = false;
      for (let d = ws; d <= we; d = addDays(d, 1)) {
        if (volumeByDate[d] != null) { sum += volumeByDate[d]; has = true; }
      }
      weekLabels.push(parseISO(ws).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }));
      weekVals.push(has ? sum : null);
      ws = addDays(ws, 7);
    }
    const weekEnds = firstLastPresent(weekVals);
    const weekly = {
      id: 'weeklyVolume',
      title: 'נפח אימון שבועי',
      unit: 'ק״ג',
      raw: weekVals,
      rolled: weekVals,
      labels: weekLabels,
      values: weekVals,
      current: weekEnds.last,
      start: weekEnds.first,
      change: trendChange(weekEnds.first, weekEnds.last),
      changeAbs: (weekEnds.first != null && weekEnds.last != null) ? (weekEnds.last - weekEnds.first) : null,
      upIsGood: true,
      points: weekVals.filter(function (v) { return v != null; }).length
    };

    const series = [
      pack('hrv', 'HRV', 'ms', metricSeries('hrv'), true),
      pack('rhr', 'דופק מנוחה', 'bpm', metricSeries('rhr'), false),
      pack('recovery', 'התאוששות', '%', metricSeries('recoveryPct'), true),
      pack('sleepPerf', 'ביצועי שינה', '%', metricSeries('sleepPerformance'), true),
      pack('sleepHours', 'שעות שינה', 'שע׳', metricSeries('sleepHours'), true),
      pack('weight', 'משקל גוף', 'ק״ג', dates.map(function (d) { return weightByDate[d] != null ? weightByDate[d] : null; }), null),
      pack('calories', 'קלוריות יומיות', 'קק״ל', dates.map(function (d) { return calByDate[d] != null ? calByDate[d] : null; }), null),
      weekly
    ];

    const index = exerciseIndex(state) || [];
    index.sort(function (a, b) { return (b.sessions || 0) - (a.sessions || 0); });
    const top = index.slice(0, 4);
    const e1rmSeries = top.map(function (it) {
      const sessions = sessionsForExercise(state, it.name).filter(function (s) {
        return s.date >= dates[0] && s.date <= lastDate && s.e1rm > 0;
      });
      const byDate = {};
      sessions.forEach(function (s) { byDate[s.date] = s.e1rm; });
      let lastSeen = null;
      const raw = dates.map(function (d) {
        if (byDate[d] != null) lastSeen = byDate[d];
        return lastSeen;
      });
      /* only start filling after first session in range */
      const firstIdx = dates.findIndex(function (d) { return byDate[d] != null; });
      const clipped = raw.map(function (v, i) { return i < firstIdx || firstIdx < 0 ? null : v; });
      const packed = pack('e1rm-' + it.name, '1RM משוער · ' + it.name, 'ק״ג', clipped, true);
      packed.exercise = it.name;
      return packed;
    }).filter(function (s) { return s.points > 0; });

    return { days: range, dates: dates, series: series, e1rm: e1rmSeries };
  }



  const WHOOP_CARDIO_SPORTS = {
    running: 'run',
    walking: 'walk',
    cycling: 'bike',
    indoor_cycling: 'bike-indoor',
    cycling_indoor: 'bike-indoor',
    swimming: 'swim',
    rowing: 'row',
    rower: 'row',
    elliptical: 'elliptical',
    hiit: 'hiit',
    high_intensity_interval_training: 'hiit',
    jump_rope: 'jump-rope',
    jumprope: 'jump-rope',
    stairmaster: 'stairs',
    stair_climber: 'stairs',
    stairs: 'stairs'
  };

  function cardioCatalog() {
    return (C.CARDIO_ACTIVITIES || []).slice();
  }

  function cardioActivityById(id) {
    const key = String(id || '');
    return cardioCatalog().find(function (a) { return a.id === key; }) || null;
  }

  function daysBetween(fromISO, toISO) {
    if (!fromISO || !toISO) return null;
    const a = parseISO(fromISO);
    const b = parseISO(toISO);
    if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function inferCardioActivityId(workout) {
    if (!workout) return '';
    if (workout.activityId && cardioActivityById(workout.activityId)) return workout.activityId;
    const catalog = cardioCatalog();
    const raw = normName(workout.customType || '');
    if (raw) {
      const folded = foldName(raw);
      const byLabel = catalog.find(function (a) { return foldName(a.label) === folded || a.id === folded; });
      if (byLabel) return byLabel.id;
    }
    const sport = String(workout.customType || workout.type || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (WHOOP_CARDIO_SPORTS[sport]) return WHOOP_CARDIO_SPORTS[sport];
    if (workout.type === 'cardio') return 'other';
    return '';
  }

  function cardioUsageMap(workouts) {
    const map = {};
    (workouts || []).forEach(function (w) {
      const id = inferCardioActivityId(w);
      if (!id) return;
      if (!map[id]) map[id] = { id: id, count: 0, lastDate: '' };
      map[id].count += 1;
      if (!map[id].lastDate || (w.date && w.date > map[id].lastDate)) map[id].lastDate = w.date || '';
    });
    return map;
  }

  /** Recent use gives a small boost; frequency is the main signal. Unused items keep catalog order. */
  function cardioRecencyBoost(lastDate, today) {
    const days = daysBetween(lastDate, today);
    if (days == null || days < 0) return 0;
    if (days === 0) return 3;
    if (days <= 7) return 2;
    if (days <= 30) return 1;
    return 0;
  }

  function cardioScore(usage, today) {
    const count = usage && usage.count ? usage.count : 0;
    const last = usage && usage.lastDate ? usage.lastDate : '';
    return count * 3 + cardioRecencyBoost(last, today);
  }

  function sortCardioActivities(workouts, now) {
    const today = todayISO(now);
    const usage = cardioUsageMap(workouts);
    const list = cardioCatalog();
    return list.map(function (act, index) {
      const u = usage[act.id] || { id: act.id, count: 0, lastDate: '' };
      return {
        id: act.id,
        label: act.label,
        index: index,
        count: u.count,
        lastDate: u.lastDate,
        score: cardioScore(u, today)
      };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
  }

  function cardioElapsedMs(session, now) {
    if (!session) return 0;
    const base = Number(session.elapsedMs) || 0;
    if (!session.running || !session.startedAt) return Math.max(0, base);
    const t = now == null ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
    return Math.max(0, base + Math.max(0, t - Number(session.startedAt)));
  }

  function formatCardioClock(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(r).padStart(2, '0');
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  function cardioDurationMin(session, now) {
    if (!session) return 0;
    if (session.durationMin != null && session.durationMin !== '') {
      const n = Number(session.durationMin);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
    const ms = cardioElapsedMs(session, now);
    if (ms <= 0) return 0;
    return Math.max(1, Math.round(ms / 60000));
  }

  function buildCardioWorkout(session, now) {
    session = session || {};
    const act = cardioActivityById(session.activityId) || { id: 'other', label: 'אחר' };
    let label = normName(session.label || '');
    if (act.id === 'other') label = label || act.label;
    else label = act.label;
    const minutes = cardioDurationMin(session, now);
    if (!(minutes > 0)) return { ok: false, error: 'no-duration' };
    const row = {
      date: session.date || todayISO(now),
      type: 'cardio',
      customType: label,
      activityId: act.id,
      duration: minutes,
      notes: session.notes || '',
      exercises: [],
      source: 'manual'
    };
    const dist = Number(session.distanceKm);
    if (Number.isFinite(dist) && dist > 0) row.distanceKm = Math.round(dist * 100) / 100;
    const hr = Number(session.avgHr);
    if (Number.isFinite(hr) && hr > 0) row.avgHr = Math.round(hr);
    const rpe = Number(session.rpe);
    if (Number.isFinite(rpe) && rpe > 0) row.rpe = Math.round(rpe);
    return { ok: true, workout: row };
  }

  const FitEngine = {
    todayISO: todayISO,
    parseISO: parseISO,
    addDays: addDays,
    lastNDates: lastNDates,
    weekStartSunday: weekStartSunday,
    formatDay: formatDay,
    formatDayLong: formatDayLong,
    nutritionOn: nutritionOn,
    workoutsOn: workoutsOn,
    workoutsInWeek: workoutsInWeek,
    metricsOn: metricsOn,
    hitsProtein: hitsProtein,
    hitsWater: hitsWater,
    dayQualifies: dayQualifies,
    currentStreak: currentStreak,
    bestStreak: bestStreak,
    computeConsistency: computeConsistency,
    bestMetricsByDate: bestMetricsByDate,
    metricSnapshot: metricSnapshot,
    formatHoursClock: formatHoursClock,
    recoveryZone: recoveryZone,
    homeInsight: homeInsight,
    levelFromTotalXP: levelFromTotalXP,
    computeXP: computeXP,
    computeAchievements: computeAchievements,
    proteinTarget: proteinTarget,
    waterTarget: waterTarget,
    waterVessel: waterVessel,
    formatLiters: formatLiters,
    formatWaterProgress: formatWaterProgress,
    waterUnitCount: waterUnitCount,
    formatWaterUnits: formatWaterUnits,
    normName: normName,
    foldName: foldName,
    levenshtein: levenshtein,
    exerciseCatalog: exerciseCatalog,
    canonicalName: canonicalName,
    isUnworkedSkip: isUnworkedSkip,
    setVolume: setVolume,
    isBodyweightName: isBodyweightName,
    isBodyweightEx: isBodyweightEx,
    isMaxReps: isMaxReps,
    bodyWeightOn: bodyWeightOn,
    bestRepsForExercise: bestRepsForExercise,
    bestHoldForExercise: bestHoldForExercise,
    isStaticName: isStaticName,
    isStaticEx: isStaticEx,
    epley1RM: epley1RM,
    brzycki1RM: brzycki1RM,
    roundToStep: roundToStep,
    recommendNextLoad: recommendNextLoad,
    rollingAverage: rollingAverage,
    computeTrends: computeTrends,
    sessionsForExercise: sessionsForExercise,
    attachPRs: attachPRs,
    exerciseStats: exerciseStats,
    exerciseIndex: exerciseIndex,
    lastPerformance: lastPerformance,
    exerciseNames: exerciseNames,
    expandSets: expandSets,
    weightStep: weightStep,
    lastSessionSets: lastSessionSets,
    suggestNextSet: suggestNextSet,
    suggestFromHistory: suggestFromHistory,
    setIsPR: setIsPR,
    lookupMuscles: lookupMuscles,
    weekMuscleLoad: weekMuscleLoad,
    cardioCatalog: cardioCatalog,
    cardioActivityById: cardioActivityById,
    inferCardioActivityId: inferCardioActivityId,
    cardioUsageMap: cardioUsageMap,
    cardioRecencyBoost: cardioRecencyBoost,
    cardioScore: cardioScore,
    sortCardioActivities: sortCardioActivities,
    cardioElapsedMs: cardioElapsedMs,
    formatCardioClock: formatCardioClock,
    cardioDurationMin: cardioDurationMin,
    buildCardioWorkout: buildCardioWorkout
  };

  root.FitEngine = FitEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitEngine;
})(typeof window !== 'undefined' ? window : globalThis);
