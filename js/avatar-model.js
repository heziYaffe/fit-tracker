/* פיט — personal avatar: config + pure metrics → body-parameter mapping.
   No DOM, no three.js here, so it is cheap to load on every page and easy to test.
   Rule: never invent data. A value is "measured" (from weights/measures),
   "base" (what the user typed when building the avatar) or "default" (neutral sex default). */
(function (root) {
  'use strict';

  const SKIN_TONES = [
    { id: 's1', label: 'בהיר מאוד', hex: '#f6d7c3' },
    { id: 's2', label: 'בהיר', hex: '#eac0a0' },
    { id: 's3', label: 'שזוף', hex: '#d29f7a' },
    { id: 's4', label: 'חום', hex: '#a8714c' },
    { id: 's5', label: 'כהה', hex: '#7a4b30' },
    { id: 's6', label: 'כהה מאוד', hex: '#4e2f1f' }
  ];
  const HAIR_STYLES = [
    { id: 'short', label: 'קצר' },
    { id: 'buzz', label: 'קצוץ' },
    { id: 'curly', label: 'מתולתל' },
    { id: 'long', label: 'ארוך' },
    { id: 'bun', label: 'קוקו' },
    { id: 'bald', label: 'קרחת' }
  ];
  const HAIR_COLORS = [
    { id: 'black', label: 'שחור', hex: '#1f1a1c' },
    { id: 'brown', label: 'חום', hex: '#5a3a26' },
    { id: 'light', label: 'חום בהיר', hex: '#8f6a45' },
    { id: 'blond', label: 'בלונד', hex: '#d7b57a' },
    { id: 'red', label: 'ג׳ינג׳י', hex: '#a9502c' },
    { id: 'gray', label: 'אפור', hex: '#a7a3a8' }
  ];
  const BEARDS = [
    { id: 'none', label: 'בלי' },
    { id: 'stubble', label: 'זיפים' },
    { id: 'short', label: 'קצר' },
    { id: 'full', label: 'מלא' }
  ];
  /* Character types. Non-human ones are chibi creatures built from the same body parameters. */
  const KINDS = [
    { id: 'human', label: 'בן אדם', emoji: '🧍' },
    { id: 'dragon', label: 'דרקון', emoji: '🐉' },
    { id: 'bunny', label: 'ארנב', emoji: '🐰' },
    { id: 'bear', label: 'דובי', emoji: '🐻' },
    { id: 'robot', label: 'רובוט', emoji: '🤖' }
  ];
  const CREATURE_COLORS = {
    dragon: [{ id: 'mint', label: 'מנטה', hex: '#7fd8a6' }, { id: 'lilac', label: 'לילך', hex: '#b79cff' }, { id: 'coral', label: 'אלמוג', hex: '#ff8f7a' }, { id: 'sky', label: 'תכלת', hex: '#7cc4ff' }],
    bunny: [{ id: 'snow', label: 'לבן', hex: '#f4f0f2' }, { id: 'cream', label: 'שמנת', hex: '#ecd9bd' }, { id: 'gray', label: 'אפור', hex: '#a9a6b2' }, { id: 'pink', label: 'ורוד', hex: '#f5bfd3' }],
    bear: [{ id: 'brown', label: 'חום', hex: '#9a6a46' }, { id: 'honey', label: 'דבש', hex: '#d9a35b' }, { id: 'polar', label: 'קוטב', hex: '#eeeae4' }, { id: 'cocoa', label: 'קקאו', hex: '#5e4033' }],
    robot: [{ id: 'silver', label: 'כסף', hex: '#c3c8d4' }, { id: 'teal', label: 'טורקיז', hex: '#4cc3c0' }, { id: 'orange', label: 'כתום', hex: '#ff9f4a' }, { id: 'violet', label: 'סגול', hex: '#a57bff' }]
  };
  /* How strongly each circumference follows a weight change when it was measured at another weight.
     Roughly girth ∝ mass^e; the waist carries most of the change. */
  const WEIGHT_EXP = { chest: 0.45, waist: 0.8, hips: 0.55, arm: 0.5, thigh: 0.5 };
  /* Stylized look: girth differences from the neutral body are exaggerated so changes are visible. */
  const STYLE_GAIN = 1.4;
  const FIELDS = ['chest', 'waist', 'hips', 'arm', 'thigh'];
  const FIELD_LABELS = { weight: 'משקל', height: 'גובה', chest: 'חזה', waist: 'מותן', hips: 'ירכיים', arm: 'יד', thigh: 'ירך' };

  /* Neutral starting values, used only when neither stored data nor the build step has a value. */
  const SEX_DEFAULTS = {
    m: { height: 176, weight: 78, chest: 100, waist: 86, hips: 98, arm: 33, thigh: 56 },
    f: { height: 164, weight: 62, chest: 90, waist: 72, hips: 100, arm: 28, thigh: 56 }
  };
  const RANGES = {
    height: [130, 215], weight: [35, 220], chest: [60, 170], waist: [50, 170],
    hips: [60, 170], arm: [18, 60], thigh: [35, 95]
  };

  /* Muscle ids from FitConfig.MUSCLES grouped into the avatar's body regions. */
  const REGIONS = {
    chest: ['chest'],
    shoulders: ['shoulders'],
    arms: ['biceps', 'triceps', 'forearms'],
    back: ['lats', 'upperback', 'lowerback'],
    core: ['abs'],
    legs: ['quads', 'hamstrings', 'glutes', 'calves']
  };
  const REGION_LABELS = { chest: 'חזה', shoulders: 'כתפיים', arms: 'ידיים', back: 'גב', core: 'בטן', legs: 'רגליים' };
  const MAX_GAIN = 0.5; // +50% e1RM since the start = full effect
  const MAX_VOLUME = 0.14; // at most +14% girth for a region

  function num(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm01(v, lo, hi) { return clamp((v - lo) / (hi - lo), 0, 1); }
  function round(v, d) { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; }
  function pick(list, id, fallback) {
    return list.some(function (x) { return x.id === id; }) ? id : fallback;
  }

  function normalizeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    const sex = cfg.sex === 'f' ? 'f' : 'm';
    const base = {};
    ['height', 'weight'].concat(FIELDS).forEach(function (k) {
      const n = num(cfg.base && cfg.base[k]);
      base[k] = n === null ? '' : clamp(n, RANGES[k][0], RANGES[k][1]);
    });
    const kind = pick(KINDS, cfg.kind, 'human');
    const palette = CREATURE_COLORS[kind] || [];
    return {
      v: 2,
      kind: kind,
      color: palette.length ? pick(palette, cfg.color, palette[0].id) : '',
      sex: sex,
      skin: pick(SKIN_TONES, cfg.skin, 's2'),
      hair: pick(HAIR_STYLES, cfg.hair, sex === 'f' ? 'long' : 'short'),
      hairColor: pick(HAIR_COLORS, cfg.hairColor, 'brown'),
      beard: sex === 'f' ? 'none' : pick(BEARDS, cfg.beard, 'none'),
      base: base,
      baseDate: typeof cfg.baseDate === 'string' ? cfg.baseDate : ''
    };
  }

  function sorted(rows) {
    return (rows || []).filter(function (r) { return r && r.date; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /** Latest non-empty value of `field` on or before `date` ({value, date} or null). */
  function latestOnOrBefore(rows, field, date) {
    const list = sorted(rows);
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (date && r.date > date) continue;
      const n = num(r[field]);
      if (n !== null) return { value: n, date: r.date };
    }
    return null;
  }

  /** Build-step prefill from what the app already stores (latest weight + latest measures). */
  function prefillConfig(state, existing) {
    const cfg = normalizeConfig(existing || {}) || normalizeConfig({});
    const out = JSON.parse(JSON.stringify(cfg));
    const w = latestOnOrBefore(state && state.weights, 'weight', null);
    if (w && out.base.weight === '') out.base.weight = round(w.value, 1);
    FIELDS.forEach(function (k) {
      const m = latestOnOrBefore(state && state.measures, k, null);
      if (m && out.base[k] === '') out.base[k] = round(m.value, 1);
    });
    return out;
  }

  /** Strength progress per avatar region from e1RM history up to `date` (0 = none, up to MAX_GAIN). */
  function strengthGains(state, date) {
    const E = root.FitEngine;
    const out = { chest: 0, shoulders: 0, arms: 0, back: 0, core: 0, legs: 0 };
    const detail = {};
    if (!E || !E.sessionsForExercise || !E.lookupMuscles || !state) return { gains: out, detail: detail };
    const names = {};
    (E.activeWorkouts ? E.activeWorkouts(state) : (state.workouts || [])).forEach(function (w) {
      if (date && w.date > date) return;
      (w.exercises || []).forEach(function (e) {
        const n = E.normName ? E.normName(e && e.name) : String((e && e.name) || '').trim();
        if (n) names[n] = true;
      });
    });
    const regionOf = {};
    Object.keys(REGIONS).forEach(function (r) { REGIONS[r].forEach(function (m) { regionOf[m] = r; }); });
    const cutoff = date && E.addDays ? E.addDays(date, -42) : '';
    Object.keys(names).forEach(function (name) {
      const map = E.lookupMuscles(name);
      if (!map) return;
      const ss = E.sessionsForExercise(state, name).filter(function (s) {
        return s.e1rm > 0 && (!date || s.date <= date);
      });
      if (ss.length < 2) return;
      const baseline = Math.max(ss[0].e1rm, ss.length > 2 ? ss[1].e1rm : 0);
      const recent = ss.filter(function (s) { return !cutoff || s.date >= cutoff; });
      const pool = recent.length ? recent : ss.slice(-2);
      const current = pool.reduce(function (m, s) { return Math.max(m, s.e1rm); }, 0);
      if (!(baseline > 0)) return;
      const gain = clamp(current / baseline - 1, 0, MAX_GAIN);
      if (!(gain > 0)) return;
      (map.primary || []).forEach(function (m) { bump(regionOf[m], gain, name); });
      (map.secondary || []).forEach(function (m) { bump(regionOf[m], gain * 0.4, name); });
    });
    function bump(region, g, name) {
      if (!region) return;
      if (g > out[region]) { out[region] = g; detail[region] = name; }
    }
    return { gains: out, detail: detail };
  }

  /** Everything the body is built from, for one day, with the source of each number. */
  function gatherInputs(state, cfgIn, date) {
    const cfg = normalizeConfig(cfgIn) || normalizeConfig({});
    const def = SEX_DEFAULTS[cfg.sex];
    const values = {};
    const sources = {};
    const dates = {};
    function choose(key, measured) {
      const baseVal = num(cfg.base[key]);
      const baseUsable = baseVal !== null && (!date || !cfg.baseDate || cfg.baseDate <= date);
      if (measured && (!baseUsable || !cfg.baseDate || measured.date >= cfg.baseDate)) {
        values[key] = measured.value; sources[key] = 'measured'; dates[key] = measured.date;
      } else if (baseVal !== null) {
        values[key] = baseVal; sources[key] = 'base'; dates[key] = cfg.baseDate || '';
      } else {
        values[key] = def[key]; sources[key] = 'default'; dates[key] = '';
      }
    }
    choose('height', null);
    choose('weight', latestOnOrBefore(state && state.weights, 'weight', date));
    FIELDS.forEach(function (k) { choose(k, latestOnOrBefore(state && state.measures, k, date)); });
    // A circumference measured at another weight follows the newer weight (marked "scaled", never "measured").
    if (sources.weight !== 'default') {
      FIELDS.forEach(function (k) {
        if (sources[k] === 'default' || !dates[k] || !dates.weight || dates[k] >= dates.weight) return;
        let ref = latestOnOrBefore(state && state.weights, 'weight', dates[k]);
        if (!ref && sources[k] === 'base' && num(cfg.base.weight) !== null) ref = { value: num(cfg.base.weight) };
        if (!ref || !(ref.value > 0) || ref.value === values.weight) return;
        values[k] = round(values[k] * Math.pow(values.weight / ref.value, WEIGHT_EXP[k]), 1);
        sources[k] = 'scaled';
      });
    }
    let recoveryPct = null;
    const E = root.FitEngine;
    if (E && E.metricSnapshot && state && date) {
      const snap = E.metricSnapshot(state, date);
      if (snap && snap.recoveryPct != null && isFinite(Number(snap.recoveryPct))) recoveryPct = Number(snap.recoveryPct);
    }
    const st = strengthGains(state, date);
    return {
      date: date || '',
      kind: cfg.kind,
      sex: cfg.sex,
      values: values,
      sources: sources,
      dates: dates,
      strength: st.gains,
      strengthFrom: st.detail,
      recoveryPct: recoveryPct
    };
  }

  /** Torso ellipse semi-axes (meters) from a circumference in cm and a depth/width ratio k.
      Uses Ramanujan's first approximation C ≈ π(a+b) solved for a with b = k·a. */
  function ellipseAxes(circCm, k) {
    const c = circCm / 100;
    const a = c / (Math.PI * (1 + k));
    return { w: a, d: a * k };
  }

  /** Builder: moving the weight slider moves the circumferences with it (from the values at drag start). */
  function scaleWithWeight(base, fromWeight, toWeight) {
    const out = Object.assign({}, base);
    const a = num(fromWeight), b = num(toWeight);
    if (a === null || b === null) return out;
    FIELDS.forEach(function (k) {
      const v = num(base[k]);
      if (v === null) return;
      out[k] = round(clamp(v * Math.pow(b / a, WEIGHT_EXP[k]), RANGES[k][0], RANGES[k][1]), 1);
    });
    return out;
  }

  /** Recovery → mood/animation. null recovery = calm neutral (never pretend to know). */
  function moodFor(pct) {
    const rec = pct == null || !isFinite(Number(pct)) ? null : clamp(Number(pct), 0, 100);
    const zone = rec === null ? null : rec >= 67 ? 'green' : rec >= 34 ? 'yellow' : 'red';
    const tired = rec === null ? 0 : clamp((70 - rec) / 60, 0, 1);
    const fresh = rec === null ? 0 : clamp((rec - 60) / 35, 0, 1);
    return {
      pct: rec,
      zone: zone,
      mood: zone === 'green' ? 'happy' : zone === 'red' ? 'tired' : 'neutral',
      slouch: round(tired, 3),
      eyeOpen: round(1 - 0.6 * tired, 3),
      earDroop: round(tired, 3),
      bounce: round(fresh, 3),
      breathRate: round(0.22 + 0.13 * fresh - 0.08 * tired + 0.08, 3), // breaths per second
      zzz: zone === 'red'
    };
  }

  /** Chibi creature proportions from the same body parameters (meters, before the creature's own style). */
  function creatureShape(p) {
    const ref = bodyParams({ sex: p.sex, values: {} });
    const sc = p.height / 1.75;
    const width = clamp(p.torso.waistW / ref.torso.waistW, 0.6, 1.8);
    const chestW = clamp(p.torso.chestW / ref.torso.chestW, 0.7, 1.6);
    return {
      scale: round(sc, 3),
      bodyR: round(0.2 * sc * (0.75 + 0.25 * chestW) * (1 + 0.12 * p.softness), 4),
      bellyR: round(0.17 * sc * width * (1 + 0.35 * p.softness), 4),
      headR: round(0.19 * sc, 4),
      armR: round(p.limbs.upperArmR * 1.25 * (1 + 0.15 * p.softness), 4),
      legR: round(p.limbs.thighR * 0.95 * (1 + 0.1 * p.softness), 4),
      armLen: round(0.2 * sc, 4),
      legLen: round(0.14 * sc, 4)
    };
  }

  /** Pure mapping: inputs → body parameters for the renderer (all lengths in meters). */
  function bodyParams(inp) {
    const sex = inp && inp.sex === 'f' ? 'f' : 'm';
    const def = SEX_DEFAULTS[sex];
    const v = (inp && inp.values) || {};
    function val(k) { const n = num(v[k]); return clamp(n === null ? def[k] : n, RANGES[k][0], RANGES[k][1]); }
    const heightCm = val('height');
    const weightKg = val('weight');
    function styled(k) {
      const raw = val(k);
      return clamp(def[k] + (raw - def[k]) * STYLE_GAIN, RANGES[k][0] * 0.85, RANGES[k][1] * 1.1);
    }
    const waistRaw = val('waist');
    const chest = styled('chest');
    const waist = styled('waist');
    const hips = styled('hips');
    const arm = styled('arm');
    const thigh = styled('thigh');
    const h = heightCm / 100;
    const bmi = weightKg / (h * h);
    const whtr = waistRaw / heightCm;
    // softness: 0 lean/defined … 1 soft. BMI alone can't tell muscle from fat, so waist-to-height carries
    // almost half the weight (WHtR 0.43 lean → 0.60 high).
    const softness = clamp(0.55 * norm01(bmi, 21, 32) + 0.45 * norm01(whtr, 0.43, 0.6), 0, 1);
    const g = (inp && inp.strength) || {};
    function gain(r) { return clamp(Number(g[r]) || 0, 0, MAX_GAIN) / MAX_GAIN; }
    function vol(r) { return 1 + MAX_VOLUME * gain(r); }
    const gainsAvg = Object.keys(REGIONS).reduce(function (s, r) { return s + gain(r); }, 0) / Object.keys(REGIONS).length;
    const definition = clamp(0.3 + 0.45 * (1 - softness) + 0.35 * gainsAvg, 0, 1);

    const chestK = sex === 'f' ? 0.74 : 0.7;
    const waistK = 0.74 + 0.16 * softness;
    const hipsK = sex === 'f' ? 0.78 : 0.72;
    const ch = ellipseAxes(chest, chestK);
    const wa = ellipseAxes(waist, waistK);
    const hi = ellipseAxes(hips, hipsK);
    const backVol = vol('back');
    const chestVol = vol('chest');
    const shoulderVol = vol('shoulders');

    const mood = moodFor(inp && inp.recoveryPct);

    return {
      kind: inp && inp.kind ? inp.kind : 'human',
      sex: sex,
      height: round(h, 3),
      bmi: round(bmi, 1),
      whtr: round(whtr, 3),
      softness: round(softness, 3),
      definition: round(definition, 3),
      torso: {
        chestW: round(ch.w * backVol, 4), chestD: round(ch.d * chestVol, 4),
        waistW: round(wa.w, 4), waistD: round(wa.d, 4),
        hipsW: round(hi.w, 4), hipsD: round(hi.d, 4),
        belly: round(softness * 0.07 * (h / 1.75), 4),
        shoulderW: round((ch.w * (sex === 'f' ? 1.12 : 1.22)) * shoulderVol, 4)
      },
      limbs: {
        upperArmR: round((arm / 100) / (2 * Math.PI) * vol('arms'), 4),
        forearmR: round((arm / 100) / (2 * Math.PI) * 0.8 * (1 + 0.5 * (vol('arms') - 1)), 4),
        thighR: round((thigh / 100) / (2 * Math.PI) * vol('legs'), 4),
        calfR: round((thigh / 100) / (2 * Math.PI) * 0.62 * (1 + 0.6 * (vol('legs') - 1)), 4),
        deltR: round(Math.max(0.035, (arm / 100) / (2 * Math.PI) * 1.05) * shoulderVol, 4)
      },
      muscle: {
        chest: round(gain('chest'), 3), shoulders: round(gain('shoulders'), 3), arms: round(gain('arms'), 3),
        back: round(gain('back'), 3), core: round(gain('core'), 3), legs: round(gain('legs'), 3)
      },
      recovery: mood
    };
  }

  /** Short Hebrew lines for the "what shapes your avatar" list. */
  function explain(inp) {
    const lines = [];
    const src = { measured: 'מדוד', base: 'בסיס', scaled: 'לפי משקל', default: 'ברירת מחדל' };
    ['weight', 'height'].concat(FIELDS).forEach(function (k) {
      const unit = k === 'weight' ? 'ק״ג' : 'ס״מ';
      lines.push({ key: k, label: FIELD_LABELS[k], value: round(inp.values[k], 1) + ' ' + unit, source: inp.sources[k], sourceLabel: src[inp.sources[k]] });
    });
    return lines;
  }

  function diff(thenInp, nowInp) {
    const out = [];
    ['weight'].concat(FIELDS).forEach(function (k) {
      if (thenInp.sources[k] === 'default' || nowInp.sources[k] === 'default') return;
      const d = round(nowInp.values[k] - thenInp.values[k], 1);
      if (d !== 0) out.push({ key: k, label: FIELD_LABELS[k], delta: d, unit: k === 'weight' ? 'ק״ג' : 'ס״מ' });
    });
    return out;
  }

  const FitAvatarModel = {
    KINDS, CREATURE_COLORS, WEIGHT_EXP, STYLE_GAIN, scaleWithWeight, moodFor, creatureShape,
    SKIN_TONES, HAIR_STYLES, HAIR_COLORS, BEARDS, FIELDS, FIELD_LABELS, SEX_DEFAULTS, RANGES,
    REGIONS, REGION_LABELS, MAX_GAIN, MAX_VOLUME,
    normalizeConfig, prefillConfig, latestOnOrBefore, strengthGains, gatherInputs,
    ellipseAxes, bodyParams, explain, diff
  };
  root.FitAvatarModel = FitAvatarModel;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitAvatarModel;
})(typeof window !== 'undefined' ? window : globalThis);
