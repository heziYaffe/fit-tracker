/* פיט — deterministic demo dataset. Written only to the demo storage key. */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round2(n) {
    return Math.round(n * 2) / 2;
  }

  function pickPlan(name, index) {
    const plans = {
      'לחיצת חזה': [
        [4, 8, 70], [4, 8, 70], [4, 8, 72.5], [4, 8, 72.5],
        [4, 9, 72.5], [4, 8, 75], [4, 8, 75], [4, 8, 75],
        [4, 6, 77.5], [4, 7, 77.5], [4, 8, 77.5], [4, 8, 77.5],
        [4, 6, 80], [4, 7, 80], [4, 8, 80], [4, 8, 80]
      ],
      'לחיצה בשיפוע': [
        [3, 10, 50], [3, 10, 50], [3, 10, 52.5], [3, 10, 52.5],
        [3, 11, 52.5], [3, 10, 55], [3, 10, 55], [3, 10, 55],
        [3, 10, 57.5], [3, 10, 57.5], [3, 11, 57.5], [3, 10, 60],
        [3, 8, 62.5], [3, 9, 62.5], [3, 10, 62.5], [3, 10, 62.5]
      ],
      'לחיצת כתפיים': [
        [4, 8, 40], [4, 8, 40], [4, 8, 42.5], [4, 8, 42.5],
        [4, 9, 42.5], [4, 8, 45], [4, 8, 45], [4, 8, 45],
        [4, 6, 47.5], [4, 8, 47.5], [4, 8, 47.5], [4, 8, 47.5],
        [4, 6, 50], [4, 7, 50], [4, 8, 50], [4, 8, 50]
      ],
      'פשיטת מרפקים': [
        [3, 12, 25], [3, 12, 25], [3, 12, 27.5], [3, 12, 27.5],
        [3, 12, 27.5], [3, 12, 30], [3, 12, 30], [3, 12, 30],
        [3, 10, 32.5], [3, 12, 32.5], [3, 12, 32.5], [3, 12, 32.5],
        [3, 10, 35], [3, 11, 35], [3, 12, 35], [3, 12, 35]
      ],
      'פרפר': [
        [3, 12, 14], [3, 12, 14], [3, 12, 16], [3, 12, 16],
        [3, 15, 16], [3, 12, 18], [3, 12, 18], [3, 12, 18],
        [3, 12, 18], [3, 12, 20], [3, 12, 20], [3, 12, 20],
        [3, 12, 20], [3, 14, 20], [3, 12, 22], [3, 12, 22]
      ],
      'דדליפט': [
        [4, 5, 120], [4, 5, 122.5], [4, 5, 125], [4, 5, 125],
        [3, 5, 130], [3, 5, 130], [3, 5, 132.5], [3, 5, 135]
      ],
      'מתח': [
        [4, 6, 80], [4, 6, 80], [4, 7, 80], [4, 7, 80],
        [4, 8, 80], [4, 6, 82.5], [4, 7, 82.5], [4, 8, 82.5],
        [4, 8, 82.5], [4, 6, 85], [4, 7, 85], [4, 8, 85],
        [4, 8, 85], [4, 9, 85], [4, 8, 87.5], [4, 8, 87.5]
      ],
      'חתירה': [
        [4, 8, 50], [4, 8, 50], [4, 8, 52.5], [4, 8, 52.5],
        [4, 9, 52.5], [4, 8, 55], [4, 8, 55], [4, 8, 55],
        [4, 8, 57.5], [4, 8, 57.5], [4, 9, 57.5], [4, 8, 60],
        [4, 6, 62.5], [4, 8, 62.5], [4, 8, 62.5], [4, 8, 62.5]
      ],
      'פולדאון': [
        [3, 10, 45], [3, 10, 45], [3, 10, 47.5], [3, 10, 47.5],
        [3, 12, 47.5], [3, 10, 50], [3, 10, 50], [3, 10, 50],
        [3, 10, 52.5], [3, 10, 52.5], [3, 12, 52.5], [3, 10, 55],
        [3, 10, 55], [3, 10, 57.5], [3, 10, 57.5], [3, 10, 57.5]
      ],
      'כפיפת מרפקים': [
        [3, 10, 16], [3, 10, 16], [3, 10, 18], [3, 10, 18],
        [3, 12, 18], [3, 10, 20], [3, 10, 20], [3, 10, 20],
        [3, 10, 22], [3, 10, 22], [3, 12, 22], [3, 10, 24],
        [3, 8, 26], [3, 10, 26], [3, 10, 26], [3, 10, 26]
      ],
      'סקוואט': [
        [5, 5, 100], [5, 5, 102.5], [5, 5, 105], [5, 5, 105],
        [5, 5, 107.5], [5, 5, 110], [5, 5, 110], [5, 5, 112.5],
        [5, 5, 115], [5, 3, 117.5], [5, 5, 117.5], [5, 5, 120]
      ],
      'לחיצת רגליים': [
        [3, 10, 140], [3, 10, 145], [3, 10, 150], [3, 10, 150],
        [3, 12, 150], [3, 10, 160], [3, 10, 160], [3, 10, 165],
        [3, 10, 170], [3, 10, 170], [3, 12, 170], [3, 10, 180]
      ],
      'מתנייחים': [
        [3, 8, 70], [3, 8, 72.5], [3, 8, 75], [3, 8, 75],
        [3, 8, 77.5], [3, 8, 80], [3, 8, 80], [3, 8, 82.5],
        [3, 8, 85], [3, 8, 85], [3, 9, 85], [3, 8, 87.5]
      ],
      'כפיפת רגליים': [
        [3, 12, 30], [3, 12, 32], [3, 12, 32], [3, 12, 35],
        [3, 12, 35], [3, 12, 37.5], [3, 12, 37.5], [3, 12, 40],
        [3, 12, 40], [3, 12, 42.5], [3, 12, 42.5], [3, 12, 45]
      ],
      'עליות שוקיים': [
        [3, 15, 40], [3, 15, 40], [3, 15, 45], [3, 15, 45],
        [3, 15, 50], [3, 15, 50], [3, 15, 55], [3, 15, 55],
        [3, 15, 60], [3, 15, 60], [3, 15, 60], [3, 15, 65]
      ]
    };
    const plan = plans[name];
    if (!plan || !plan.length) return { sets: 3, reps: 10, weight: 20 };
    const row = plan[Math.min(index, plan.length - 1)];
    return { sets: row[0], reps: row[1], weight: row[2] };
  }

  function generate(now) {
    const E = root.FitEngine;
    const C = root.FitConfig;
    const end = now ? new Date(now) : new Date();
    const today = E.todayISO(end);
    const rng = mulberry32(20261114);
    const start = E.addDays(today, -56);

    const workouts = [];
    const counters = {};
    function addEx(name) {
      if (!counters[name]) counters[name] = 0;
      const rec = pickPlan(name, counters[name]);
      counters[name] += 1;
      return { name: name, sets: rec.sets, reps: rec.reps, weight: rec.weight };
    }

    let wIndex = 0;
    for (let iso = start; iso <= today; iso = E.addDays(iso, 1)) {
      const d = E.parseISO(iso);
      const dow = d.getDay();
      const weekNum = Math.floor((E.parseISO(iso) - E.parseISO(start)) / (7 * 86400000));
      const skipFriday = weekNum === 2 || weekNum === 5;
      let kind = null;
      if (dow === 0) kind = 'push';
      else if (dow === 1) kind = 'pull';
      else if (dow === 2) kind = 'legs';
      else if (dow === 4) kind = 'push';
      else if (dow === 5 && !skipFriday) kind = 'pull';
      else if (dow === 6 && iso === today) kind = 'legs';
      if (!kind) continue;

      let type = 'full';
      let exercises = [];
      let duration = 55;
      let notes = '';
      if (kind === 'push') {
        type = 'chest';
        duration = 60;
        exercises = [addEx('לחיצת חזה'), addEx('לחיצה בשיפוע'), addEx('לחיצת כתפיים'), addEx('פשיטת מרפקים')];
        if (weekNum % 2 === 0) exercises.push(addEx('פרפר'));
        if (counters['לחיצת חזה'] && (counters['לחיצת חזה'] === 6 || counters['לחיצת חזה'] === 15)) {
          notes = 'שיא חדש בלחיצת חזה';
        }
      } else if (kind === 'pull') {
        type = 'back';
        duration = 55;
        const isDeadliftDay = dow === 1;
        if (isDeadliftDay) exercises.push(addEx('דדליפט'));
        exercises.push(addEx('מתח'), addEx('חתירה'), addEx('פולדאון'), addEx('כפיפת מרפקים'));
        if (isDeadliftDay && counters['דדליפט'] === 8) notes = 'דדליפט 135 ק״ג — שיא';
      } else {
        type = 'legs';
        duration = 70;
        exercises = [addEx('סקוואט'), addEx('לחיצת רגליים'), addEx('מתנייחים'), addEx('כפיפת רגליים'), addEx('עליות שוקיים')];
        if (counters['סקוואט'] === 12) notes = 'סקוואט 120 ק״ג, 5×5';
      }
      wIndex += 1;
      workouts.push({
        id: 'demo_w_' + wIndex,
        date: iso,
        type: type,
        customType: '',
        exercises: exercises,
        duration: duration,
        notes: notes
      });
    }

    const nutrition = [];
    for (let iso = start; iso <= today; iso = E.addDays(iso, 1)) {
      const d = E.parseISO(iso);
      const dow = d.getDay();
      const missProtein = dow === 6 || (dow === 5 && rng() < 0.45) || rng() < 0.08;
      const protein = missProtein ? 110 + Math.round(rng() * 30) : 150 + Math.round(rng() * 35);
      const calories = missProtein ? 1900 + Math.round(rng() * 300) : 2200 + Math.round(rng() * 350);
      const water = (dow === 6 && rng() < 0.5) ? 5 + Math.round(rng() * 2) : 7 + Math.round(rng() * 3);
      nutrition.push({
        id: 'demo_n_' + iso,
        date: iso,
        protein: protein,
        calories: calories,
        water: water,
        notes: missProtein ? 'יום קצת פחות מדויק' : ''
      });
    }

    const weights = [];
    let kg = 84.2;
    for (let iso = start; iso <= today; iso = E.addDays(iso, 1)) {
      const d = E.parseISO(iso);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 3 && iso !== today) continue;
      kg -= 0.08 + rng() * 0.06;
      kg += (rng() - 0.45) * 0.25;
      weights.push({
        id: 'demo_wt_' + iso,
        date: iso,
        weight: Math.round(kg * 10) / 10
      });
    }

    const metrics = [];
    let prevStrain = 10;
    for (let iso = start; iso <= today; iso = E.addDays(iso, 1)) {
      const trained = workouts.some(function (w) { return w.date === iso; });
      const sleep = Math.round((6.25 + rng() * 2.3) * 4) / 4;
      const recoveryBase = 55 + (sleep - 6.5) * 12 - (prevStrain - 10) * 1.4;
      const recoveryPct = Math.max(42, Math.min(92, Math.round(recoveryBase + (rng() - 0.5) * 8)));
      const strain = trained ? 10 + rng() * 7 : 5 + rng() * 5;
      const hrv = Math.round(48 + recoveryPct * 0.25 + (rng() - 0.5) * 8);
      prevStrain = strain;
      metrics.push({
        id: 'demo_m_' + iso,
        date: iso,
        source: 'manual',
        sleepHours: sleep,
        recoveryPct: recoveryPct,
        strain: Math.round(strain * 10) / 10,
        hrv: hrv,
        notes: ''
      });
    }


    function tex(id, name, sets, rmin, rmax, weight, rest, ss) {
      return {
        id: 'dtex_' + id,
        name: name,
        sets: sets,
        repsMin: rmin,
        repsMax: rmax,
        weight: weight,
        restSec: rest,
        notes: '',
        supersetId: ss || ''
      };
    }

    const templates = [
      {
        id: 'dtpl_push',
        name: 'Push A',
        days: [0, 4],
        type: 'chest',
        exercises: [
          tex('p1', 'לחיצת חזה', 4, 8, 8, 80, 120),
          tex('p2', 'לחיצה בשיפוע', 3, 8, 10, 62.5, 90),
          tex('p3', 'לחיצת כתפיים', 4, 8, 8, 50, 90),
          tex('p4', 'פשיטת מרפקים', 3, 10, 12, 35, 75, 'ss_push_arms'),
          tex('p5', 'פרפר', 3, 10, 12, 22, 75, 'ss_push_arms')
        ]
      },
      {
        id: 'dtpl_pull',
        name: 'Pull A',
        days: [1, 5],
        type: 'back',
        exercises: [
          tex('u1', 'דדליפט', 4, 5, 5, 135, 150),
          tex('u2', 'מתח', 4, 6, 8, 87.5, 120),
          tex('u3', 'חתירה', 4, 8, 8, 62.5, 90),
          tex('u4', 'פולדאון', 3, 10, 12, 57.5, 75),
          tex('u5', 'כפיפת מרפקים', 3, 8, 10, 26, 75)
        ]
      },
      {
        id: 'dtpl_legs',
        name: 'Legs A',
        days: [2, 6],
        type: 'legs',
        exercises: [
          tex('l1', 'סקוואט', 5, 5, 5, 120, 150),
          tex('l2', 'לחיצת רגליים', 3, 10, 12, 180, 120),
          tex('l3', 'מתנייחים', 3, 8, 8, 87.5, 90),
          tex('l4', 'כפיפת רגליים', 3, 10, 12, 45, 75),
          tex('l5', 'עליות שוקיים', 3, 12, 15, 65, 60)
        ]
      }
    ];

    function mfood(id, foodId, name, qty, protein, calories, carbs, fat) {
      return { id: 'dmf_' + id, foodId: foodId, name: name, qty: qty, protein: protein, calories: calories, carbs: carbs, fat: fat };
    }
    const menus = [
      {
        id: 'dmenu_train',
        name: 'יום אימון',
        days: [],
        applyOn: 'workout',
        meals: [
          { id: 'dml_t1', name: 'בוקר', time: '08:00', foods: [
            mfood('t1a', 'food_yogurt', 'יוגורט חלבון', 1, 20, 120, 6, 0.5),
            mfood('t1b', 'food_eggs', '3 ביצים', 1, 18, 210, 1, 15)
          ]},
          { id: 'dml_t2', name: 'לפני אימון', time: '11:30', foods: [
            mfood('t2a', 'food_shake', 'שייק חלבון', 1, 25, 130, 5, 2)
          ]},
          { id: 'dml_t3', name: 'צהריים', time: '13:30', foods: [
            mfood('t3a', 'food_chicken', 'חזה עוף 200 גרם', 1, 62, 330, 0, 7),
            mfood('t3b', 'food_rice', 'אורז 200 גרם', 1, 5, 260, 56, 0.5)
          ]},
          { id: 'dml_t4', name: 'אחרי אימון', time: '17:00', foods: [
            mfood('t4a', 'food_shake', 'שייק חלבון', 1, 25, 130, 5, 2)
          ]},
          { id: 'dml_t5', name: 'ערב', time: '20:00', foods: [
            mfood('t5a', 'food_yogurt', 'יוגורט חלבון', 1, 20, 120, 6, 0.5)
          ]}
        ]
      },
      {
        id: 'dmenu_rest',
        name: 'יום מנוחה',
        days: [],
        applyOn: 'rest',
        meals: [
          { id: 'dml_r1', name: 'בוקר', time: '09:00', foods: [
            mfood('r1a', 'food_yogurt', 'יוגורט חלבון', 1, 20, 120, 6, 0.5),
            mfood('r1b', 'food_eggs', '3 ביצים', 1, 18, 210, 1, 15)
          ]},
          { id: 'dml_r2', name: 'צהריים', time: '13:00', foods: [
            mfood('r2a', 'food_chicken', 'חזה עוף 200 גרם', 1, 62, 330, 0, 7),
            mfood('r2b', 'food_rice', 'אורז 200 גרם', 1, 5, 260, 56, 0.5)
          ]},
          { id: 'dml_r3', name: 'ערב', time: '19:30', foods: [
            mfood('r3a', 'food_yogurt', 'יוגורט חלבון', 1, 20, 120, 6, 0.5)
          ]}
        ]
      }
    ];

    /* Today is a training day in the demo (legs if Saturday). Prefill a plan with 3 meals eaten
       so the checklist and protein totals tell one consistent story. */
    const todayMeals = JSON.parse(JSON.stringify(menus[0].meals));
    todayMeals.forEach(function (m, i) {
      m.status = i < 3 ? 'eaten' : 'pending';
      m.foods.forEach(function (f) { f.id = f.id + '_today'; });
    });
    const eatenTot = { protein: 0, calories: 0 };
    todayMeals.forEach(function (m) {
      if (m.status !== 'eaten') return;
      m.foods.forEach(function (f) {
        const q = Number(f.qty) || 1;
        eatenTot.protein += (Number(f.protein) || 0) * q;
        eatenTot.calories += (Number(f.calories) || 0) * q;
      });
    });
    nutrition.forEach(function (n) {
      if (n.date === today) {
        n.protein = eatenTot.protein;
        n.calories = eatenTot.calories;
        n.notes = 'לפי תפריט יום אימון';
      }
    });
    const dayMenus = [{
      date: today,
      menuId: 'dmenu_train',
      menuName: 'יום אימון',
      meals: todayMeals
    }];

    return {
      version: 1,
      settings: Object.assign({}, C.DEFAULT_SETTINGS, {
        weeklyWorkoutTarget: 4,
        dailyProteinTarget: 150,
        dailyCalorieTarget: 2400,
        dailyWaterTarget: 8,
        displayName: 'Hazi'
      }),
      workouts: workouts,
      nutrition: nutrition,
      weights: weights,
      metrics: metrics,
      foods: [
        { id: 'food_shake', name: 'שייק חלבון', protein: 25, calories: 130, carbs: 5, fat: 2, uses: 18, starter: true },
        { id: 'food_chicken', name: 'חזה עוף 200 גרם', protein: 62, calories: 330, carbs: 0, fat: 7, uses: 14, starter: true },
        { id: 'food_yogurt', name: 'יוגורט חלבון', protein: 20, calories: 120, carbs: 6, fat: 0.5, uses: 11, starter: true },
        { id: 'food_eggs', name: '3 ביצים', protein: 18, calories: 210, carbs: 1, fat: 15, uses: 9, starter: true },
        { id: 'food_rice', name: 'אורז 200 גרם', protein: 5, calories: 260, carbs: 56, fat: 0.5, uses: 8, starter: false }
      ],
      templates: templates,
      menus: menus,
      dayMenus: dayMenus
    };
  }

  const FitDemo = { generate: generate };
  root.FitDemo = FitDemo;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitDemo;
})(typeof window !== 'undefined' ? window : globalThis);
