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

  function metricsOn(state, iso) {
    return (state.metrics || []).filter(function (m) { return m.date === iso; });
  }

  function proteinTarget(state) {
    return Number(state.settings.dailyProteinTarget) || 150;
  }

  function waterTarget(state) {
    return Number(state.settings.dailyWaterTarget) || 8;
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
    metricsOn: metricsOn,
    hitsProtein: hitsProtein,
    hitsWater: hitsWater,
    dayQualifies: dayQualifies,
    currentStreak: currentStreak,
    bestStreak: bestStreak,
    computeConsistency: computeConsistency,
    bestMetricsByDate: bestMetricsByDate,
    levelFromTotalXP: levelFromTotalXP,
    computeXP: computeXP,
    computeAchievements: computeAchievements,
    proteinTarget: proteinTarget,
    waterTarget: waterTarget
  };

  root.FitEngine = FitEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitEngine;
})(typeof window !== 'undefined' ? window : globalThis);
