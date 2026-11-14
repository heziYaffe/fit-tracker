/* פיט — weekly smart summary: stats + rule-based tips. Pure compute, no I/O. */
(function (root) {
  'use strict';

  function E() { return root.FitEngine; }
  function C() { return root.FitConfig; }

  function datesInRange(start, end) {
    const out = [];
    let d = start;
    while (d <= end) {
      out.push(d);
      d = E().addDays(d, 1);
    }
    return out;
  }

  function lastCompleteWeek(now) {
    const iso = E().todayISO(now);
    const thisStart = E().weekStartSunday(iso);
    const end = E().addDays(thisStart, -1);
    const start = E().addDays(end, -6);
    return { start: start, end: end, kind: 'complete' };
  }

  function currentWeek(now) {
    const iso = E().todayISO(now);
    const start = E().weekStartSunday(iso);
    const endSat = E().addDays(start, 6);
    const end = iso < endSat ? iso : endSat;
    return { start: start, end: end, kind: iso < endSat ? 'partial' : 'complete' };
  }

  function isSunday(now) {
    const d = now instanceof Date ? now : E().parseISO(E().todayISO(now));
    return d.getDay() === 0;
  }

  function defaultRange(now) {
    return isSunday(now) ? lastCompleteWeek(now) : currentWeek(now);
  }

  function weekVolume(state, start, end) {
    let volume = 0;
    let workouts = 0;
    (state.workouts || []).forEach(function (w) {
      if (!w || w.date < start || w.date > end) return;
      workouts += 1;
      (w.exercises || []).forEach(function (ex) { volume += E().setVolume(ex); });
    });
    return { volume: volume, workouts: workouts };
  }

  function prsInRange(state, start, end) {
    const names = E().exerciseNames(state);
    const out = [];
    names.forEach(function (name) {
      const sessions = E().attachPRs(E().sessionsForExercise(state, name));
      sessions.forEach(function (s) {
        if (s.isPR && s.date >= start && s.date <= end) {
          out.push({ name: name, date: s.date, types: s.prTypes || [] });
        }
      });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return out;
  }

  function stalledExercises(state, asOf) {
    const names = E().exerciseNames(state);
    const out = [];
    names.forEach(function (name) {
      const sessions = E().sessionsForExercise(state, name).filter(function (s) {
        return s.date <= asOf;
      });
      if (sessions.length < 3) return;
      let best = 0;
      let bestDate = null;
      sessions.forEach(function (s) {
        const rm = Number(s.e1rm) || 0;
        const top = Number(s.topWeight) || 0;
        const score = Math.max(rm, top);
        if (score > best + 0.25) {
          best = score;
          bestDate = s.date;
        }
      });
      if (!bestDate) return;
      const last = sessions[sessions.length - 1];
      const daysSince = Math.round((E().parseISO(asOf) - E().parseISO(bestDate)) / 86400000);
      const daysSinceLast = Math.round((E().parseISO(asOf) - E().parseISO(last.date)) / 86400000);
      if (daysSince >= 21 && daysSinceLast <= 21) {
        out.push({ name: name, days: daysSince, lastDate: last.date });
      }
    });
    out.sort(function (a, b) { return b.days - a.days; });
    return out;
  }

  function neglectedMuscles(state, end) {
    const load = E().weekMuscleLoad(state, E().parseISO(end));
    return (load.neglected || []).filter(function (m) { return (m.sets || 0) <= 0; });
  }

  function nutritionAdherence(state, start, end) {
    const days = datesInRange(start, end);
    let hits = 0;
    days.forEach(function (iso) {
      if (E().hitsProtein(state, iso)) hits += 1;
    });
    return { hits: hits, days: days.length, rate: days.length ? hits / days.length : 0 };
  }

  function avgMetric(state, start, end, field) {
    const best = E().bestMetricsByDate(state);
    let sum = 0;
    let n = 0;
    datesInRange(start, end).forEach(function (iso) {
      const row = best[iso];
      if (!row) return;
      const val = row[field];
      if (val === null || val === undefined || val === '') return;
      const num = Number(val);
      if (!isFinite(num)) return;
      sum += num;
      n += 1;
    });
    return n ? sum / n : null;
  }

  function xpInRange(state, start, end) {
    const xp = E().computeXP(state);
    let total = 0;
    const events = (xp.events || []).filter(function (ev) {
      return ev.date >= start && ev.date <= end;
    });
    events.forEach(function (ev) { total += Number(ev.xp) || 0; });
    return { total: total, events: events };
  }

  function recommendations(stats) {
    const tips = [];
    if (stats.stalled && stats.stalled.length) {
      const first = stats.stalled[0];
      tips.push({
        id: 'stalled',
        priority: 10,
        text: 'אין התקדמות ב' + first.name + ' כבר ' + first.days + ' ימים. כדאי לשנות טווח חזרות, מנוחה או תרגיל חלופי.'
      });
    }
    if (stats.neglected && stats.neglected.length) {
      const labels = stats.neglected.slice(0, 3).map(function (m) { return m.label; }).join(', ');
      tips.push({
        id: 'neglected',
        priority: 9,
        text: 'השרירים שהוזנחו השבוע: ' + labels + '. כדאי להוסיף אותם לתבנית הקרובה.'
      });
    }
    if (stats.nutrition && stats.nutrition.rate < 0.7) {
      const miss = stats.nutrition.days - stats.nutrition.hits;
      tips.push({
        id: 'protein',
        priority: 8,
        text: 'עמדת ביעד החלבון ב-' + stats.nutrition.hits + ' מתוך ' + stats.nutrition.days +
          ' ימים. עוד ' + miss + ' ימים כאלה ישפרו את מד העקביות.'
      });
    }
    if (stats.volumeChange != null && stats.volumeChange <= -10 && stats.prev.volume > 0) {
      tips.push({
        id: 'volume-down',
        priority: 7,
        text: 'הנפח ירד ב-' + Math.abs(Math.round(stats.volumeChange)) + '% מול השבוע הקודם. בדקו התאוששות או הוסיפו סט אחד.'
      });
    }
    if (stats.sleepAvg != null && stats.sleepAvg < 7) {
      tips.push({
        id: 'sleep',
        priority: 7,
        text: 'שינה ממוצעת ' + stats.sleepAvg.toFixed(1) + ' שעות. כוונו ל-7 ומעלה בשביל XP והתאוששות.'
      });
    }
    if (stats.recoveryAvg != null && stats.recoveryAvg < 50) {
      tips.push({
        id: 'recovery',
        priority: 6,
        text: 'התאוששות ממוצעת ' + Math.round(stats.recoveryAvg) + '%. שווה יום קל או מנוחה חכמה.'
      });
    }
    if (stats.prs && stats.prs.length && stats.volumeChange != null && stats.volumeChange >= 0) {
      tips.push({
        id: 'strong',
        priority: 4,
        text: 'שבוע חזק: ' + stats.prs.length + ' שיאים ונפח יציב או עולה. שמרו על אותו כיוון.'
      });
    }
    if (stats.streak >= 7) {
      tips.push({
        id: 'streak',
        priority: 3,
        text: 'רצף של ' + stats.streak + ' ימים. שמירה עליו שווה יותר מאימון חד-פעמי קשה.'
      });
    }
    if (!tips.length) {
      tips.push({
        id: 'keep',
        priority: 1,
        text: 'המשיכו לתעד אימונים ותזונה. העקביות בונה את המד יותר מכל שיא בודד.'
      });
    }
    tips.sort(function (a, b) { return b.priority - a.priority; });
    const unique = [];
    const seen = {};
    tips.forEach(function (t) {
      if (seen[t.id]) return;
      seen[t.id] = true;
      unique.push(t);
    });
    return unique.slice(0, 3);
  }

  function compute(state, now, range) {
    now = now || new Date();
    range = range || defaultRange(now);
    const start = range.start;
    const end = range.end;
    const cur = weekVolume(state, start, end);
    const prevEnd = E().addDays(start, -1);
    const prevStart = E().addDays(prevEnd, -6);
    const prev = weekVolume(state, prevStart, prevEnd);
    let volumeChange = null;
    if (prev.volume > 0) volumeChange = ((cur.volume - prev.volume) / prev.volume) * 100;
    else if (cur.volume > 0) volumeChange = 100;
    const prs = prsInRange(state, start, end);
    const stalled = stalledExercises(state, end);
    const neglected = neglectedMuscles(state, end);
    const nutrition = nutritionAdherence(state, start, end);
    const sleepAvg = avgMetric(state, start, end, 'sleepHours');
    const recoveryAvg = avgMetric(state, start, end, 'recoveryPct');
    const streak = E().currentStreak(state, E().parseISO(end));
    const xp = xpInRange(state, start, end);
    const stats = {
      start: start,
      end: end,
      kind: range.kind || 'complete',
      volume: cur.volume,
      workouts: cur.workouts,
      prev: prev,
      volumeChange: volumeChange,
      prs: prs,
      stalled: stalled,
      neglected: neglected,
      nutrition: nutrition,
      sleepAvg: sleepAvg,
      recoveryAvg: recoveryAvg,
      streak: streak,
      xp: xp.total
    };
    stats.tips = recommendations(stats);
    return stats;
  }

  function formatRange(stats) {
    if (!stats) return '';
    return E().formatDay(stats.start) + ' – ' + E().formatDay(stats.end);
  }

  function shareText(stats) {
    const lines = ['סיכום שבועי · פיט', formatRange(stats)];
    lines.push((stats.workouts || 0) + ' אימונים · ' + (stats.prs || []).length + ' שיאים');
    if (stats.volumeChange != null) {
      const sign = stats.volumeChange > 0 ? '+' : '';
      lines.push('נפח: ' + sign + Math.round(stats.volumeChange) + '% מול השבוע הקודם');
    }
    lines.push('חלבון: ' + stats.nutrition.hits + '/' + stats.nutrition.days + ' ימים');
    lines.push('XP: ' + stats.xp + ' · רצף: ' + stats.streak);
    (stats.tips || []).forEach(function (t) { lines.push('• ' + t.text); });
    lines.push('https://heziyaffe.github.io/fit-tracker/');
    return lines.join('\n');
  }

  var FitSummary = {
    lastCompleteWeek: lastCompleteWeek,
    currentWeek: currentWeek,
    defaultRange: defaultRange,
    isSunday: isSunday,
    compute: compute,
    formatRange: formatRange,
    shareText: shareText,
    datesInRange: datesInRange
  };

  root.FitSummary = FitSummary;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitSummary;
})(typeof window !== 'undefined' ? window : globalThis);
