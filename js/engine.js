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


  function normName(name) {
    return String(name || '').trim();
  }

  function expandSets(ex) {
    if (ex && Array.isArray(ex.setLogs) && ex.setLogs.length) {
      return ex.setLogs.map(function (s) {
        return { weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 };
      });
    }
    const sets = Math.max(1, Number(ex && ex.sets) || 0);
    const reps = Number(ex && ex.reps) || 0;
    const w = Number(ex && ex.weight) || 0;
    if (!reps && !w) return [];
    const out = [];
    for (let i = 0; i < sets; i++) out.push({ weight: w, reps: reps });
    return out;
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
        return normName(e.name) === target;
      });
      if (!rows.length) return;
      let volume = 0;
      let topWeight = 0;
      let topRepsAtTop = 0;
      let maxReps = 0;
      let totalReps = 0;
      let best1RM = 0;
      let bestRow = null;
      const bwMode = rows.some(function (e) { return isBodyweightEx(e, name); });
      const bodyKg = bwMode ? bodyWeightOn(state, w.date) : 0;
      rows.forEach(function (e) {
        volume += setVolume(e, state, w.date);
        const logs = expandSets(e);
        if (!logs.length) {
          const wgt = Number(e.weight) || 0;
          const reps = Number(e.reps) || 0;
          totalReps += reps * (Math.max(1, Number(e.sets) || 1));
          if (reps > maxReps) maxReps = reps;
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
          if (s.reps > maxReps) maxReps = s.reps;
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
        volume: volume,
        topWeight: topWeight,
        topReps: topRepsAtTop,
        maxReps: maxReps,
        totalReps: totalReps,
        e1rm: best1RM,
        bestRow: bestRow,
        bodyweight: bwMode,
        bodyWeightUsed: bodyKg
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
      bestReps: bestRepsTable(list),
      bodyweight: list.some(function (s) { return s.bodyweight; })
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
      return { weight: bw ? 0 : 20, reps: 8, step: stepDefault, reason: 'אין היסטוריה — ברירת מחדל', allHit: false };
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

  function setIsPR(state, name, weight, reps, exceptWorkoutId) {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
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
    const types = [];
    if (w > 0 && w > maxW) types.push('weight');
    if ((bw ? estEff : est) > 0 && (bw ? estEff : est) > maxE1) types.push('e1rm');
    if (bw) {
      if (r > 0 && r > bestAnyReps && bestAnyReps > 0) types.push('reps');
    } else if (w > 0 && r > 0 && r > bestReps && bestReps > 0) {
      types.push('reps');
    }
    return { isPR: types.length > 0, types: types, e1rm: bw ? estEff : est, prevMaxWeight: maxW, prevMaxE1rm: maxE1 };
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
    waterTarget: waterTarget,
    normName: normName,
    setVolume: setVolume,
    isBodyweightName: isBodyweightName,
    isBodyweightEx: isBodyweightEx,
    isMaxReps: isMaxReps,
    bodyWeightOn: bodyWeightOn,
    bestRepsForExercise: bestRepsForExercise,
    epley1RM: epley1RM,
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
    weekMuscleLoad: weekMuscleLoad
  };

  root.FitEngine = FitEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitEngine;
})(typeof window !== 'undefined' ? window : globalThis);
