/* פיט — configuration: XP rules, achievements, metric types.
   Keep all game-rule numbers here so Whoop/social layers can reuse them. */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'hazi-fit-v1';
  const DEMO_STORAGE_KEY = 'hazi-fit-demo-v1';
  const DEMO_MODE_KEY = 'hazi-fit-demo-mode';
  const CONSISTENCY_DAYS = 14;
  const INSTALL_DISMISS_KEY = 'hazi-fit-install-dismissed';
  const THEME_KEY = 'hazi-fit-theme';
  const APP_VERSION = '18';

  const WORKOUT_TYPES = [
    { id: 'chest', label: 'חזה' },
    { id: 'back', label: 'גב' },
    { id: 'legs', label: 'רגליים' },
    { id: 'shoulders', label: 'כתפיים' },
    { id: 'arms', label: 'ידיים' },
    { id: 'cardio', label: 'קרדיו' },
    { id: 'full', label: 'כל הגוף' },
    { id: 'custom', label: 'אחר' }
  ];

  /**
   * Single source of truth for XP.
   * Metric bonuses are evaluated once per day (best value across sources),
   * so a future Whoop sync will not double-count a manual entry.
   */
  const XP_RULES = {
    workoutLogged: { id: 'workout', xp: 40, label: 'אימון' },
    proteinTarget: { id: 'protein', xp: 25, label: 'יעד חלבון' },
    waterTarget: { id: 'water', xp: 10, label: 'יעד מים' },
    streakMilestones: [
      { id: 'streak-3', days: 3, xp: 20, label: 'רצף 3 ימים' },
      { id: 'streak-7', days: 7, xp: 50, label: 'רצף 7 ימים' },
      { id: 'streak-14', days: 14, xp: 80, label: 'רצף 14 ימים' },
      { id: 'streak-30', days: 30, xp: 150, label: 'רצף 30 ימים' }
    ],
    metrics: {
      sleepHours: {
        id: 'sleep',
        field: 'sleepHours',
        min: 7,
        xp: 15,
        label: 'שינה',
        compare: 'gte'
      },
      recoveryPct: {
        id: 'recovery',
        field: 'recoveryPct',
        min: 67,
        xp: 15,
        label: 'התאוששות',
        compare: 'gte'
      },
      strain: {
        id: 'strain',
        field: 'strain',
        min: null,
        xp: 0,
        label: 'Strain',
        compare: 'gte'
      },
      hrv: {
        id: 'hrv',
        field: 'hrv',
        min: null,
        xp: 0,
        label: 'HRV',
        compare: 'gte'
      }
    }
  };

  /** XP needed to go from `level` to `level + 1`. */
  const LEVELS = {
    base: 100,
    step: 50,
    xpToNext: function (level) {
      return this.base + (level - 1) * this.step;
    }
  };

  const METRIC_SOURCES = {
    manual: { id: 'manual', label: 'הזנה ידנית', enabled: true },
    whoop: { id: 'whoop', label: 'Whoop', enabled: false }
  };

  const METRIC_FIELDS = [
    { key: 'sleepHours', label: 'שינה', unit: 'שעות', min: 0, max: 16, step: 0.25 },
    { key: 'recoveryPct', label: 'התאוששות', unit: '%', min: 0, max: 100, step: 1 },
    { key: 'strain', label: 'Strain', unit: '', min: 0, max: 21, step: 0.1 },
    { key: 'hrv', label: 'HRV', unit: 'ms', min: 0, max: 200, step: 1 }
  ];

  const ACHIEVEMENTS = [
    { id: 'first-workout', title: 'האימון הראשון', desc: 'תיעדת את האימון הראשון שלך', icon: '🏋️', check: 'firstWorkout' },
    { id: 'workouts-10', title: '10 אימונים', desc: 'השלמת 10 אימונים', icon: '💪', check: 'workouts10' },
    { id: 'workouts-30', title: '30 אימונים', desc: 'השלמת 30 אימונים', icon: '🔥', check: 'workouts30' },
    { id: 'streak-7', title: 'שבוע ברצף', desc: 'רצף של 7 ימים', icon: '⚡', check: 'streak7' },
    { id: 'streak-14', title: 'שבועיים ברצף', desc: 'רצף של 14 ימים', icon: '🏆', check: 'streak14' },
    { id: 'protein-7', title: 'שבוע חלבון', desc: '7 ימים ביעד החלבון', icon: '🥩', check: 'protein7' },
    { id: 'first-metrics', title: 'מדדים', desc: 'תיעדת מדדי התאוששות או שינה', icon: '❤️', check: 'firstMetrics' },
    { id: 'level-5', title: 'רמה 5', desc: 'הגעת לרמה 5', icon: '⭐', check: 'level5' }
  ];


  const REST_DEFAULT_SEC = 90;

  const SMALL_LIFTS = [
    'פשיטת מרפקים', 'פרפר', 'כפיפת מרפקים', 'כפיפת רגליים', 'עליות שוקיים',
    'כתפיים צידיות', 'הרחקה', 'פנים-חוץ'
  ];

  const MUSCLES = [
    { id: 'chest', label: 'חזה', view: 'front' },
    { id: 'shoulders', label: 'כתפיים', view: 'both' },
    { id: 'biceps', label: 'ידיים קדמיות', view: 'front' },
    { id: 'triceps', label: 'ידיים אחוריות', view: 'back' },
    { id: 'forearms', label: 'אמות', view: 'both' },
    { id: 'abs', label: 'בטן', view: 'front' },
    { id: 'lats', label: 'גב רחב', view: 'back' },
    { id: 'upperback', label: 'גב עליון', view: 'back' },
    { id: 'lowerback', label: 'גב תחתון', view: 'back' },
    { id: 'quads', label: 'ארבע ראשי', view: 'front' },
    { id: 'hamstrings', label: 'המסטרינגס', view: 'back' },
    { id: 'glutes', label: 'עכוז', view: 'back' },
    { id: 'calves', label: 'שוקיים', view: 'both' }
  ];

  const EXERCISE_MUSCLES = {
    'לחיצת חזה': { primary: ['chest'], secondary: ['shoulders', 'triceps'] },
    'לחיצה בשיפוע': { primary: ['chest'], secondary: ['shoulders', 'triceps'] },
    'לחיצת כתפיים': { primary: ['shoulders'], secondary: ['triceps'] },
    'פשיטת מרפקים': { primary: ['triceps'], secondary: [] },
    'פרפר': { primary: ['chest'], secondary: [] },
    'דדליפט': { primary: ['hamstrings', 'glutes', 'lowerback'], secondary: ['upperback', 'forearms'] },
    'מתח': { primary: ['lats'], secondary: ['biceps', 'upperback'] },
    'חתירה': { primary: ['upperback'], secondary: ['lats', 'biceps'] },
    'פולדאון': { primary: ['lats'], secondary: ['biceps'] },
    'כפיפת מרפקים': { primary: ['biceps'], secondary: ['forearms'] },
    'סקוואט': { primary: ['quads'], secondary: ['glutes', 'hamstrings'] },
    'לחיצת רגליים': { primary: ['quads'], secondary: ['glutes'] },
    'מתנייחים': { primary: ['hamstrings', 'glutes'], secondary: ['lowerback'] },
    'כפיפת רגליים': { primary: ['hamstrings'], secondary: [] },
    'עליות שוקיים': { primary: ['calves'], secondary: [] },
    'מתח צר': { primary: ['biceps'], secondary: ['lats', 'upperback'] },
    'מתח אוסטרלי': { primary: ['upperback'], secondary: ['biceps', 'lats'] },
    'מקבילים': { primary: ['triceps'], secondary: ['chest', 'shoulders'] },
    'שכיבות סמיכה': { primary: ['chest'], secondary: ['shoulders', 'triceps'] },
    'שכיבות סמיכה יהלום': { primary: ['triceps'], secondary: ['chest'] },
    'שכיבות סמיכה בעמידת ידיים': { primary: ['shoulders'], secondary: ['triceps'] },
    'הרמות רגליים בתלייה': { primary: ['abs'], secondary: [] },
    'כפיפות בטן': { primary: ['abs'], secondary: [] },
    'סקוואט משקל גוף': { primary: ['quads'], secondary: ['glutes'] },
    'מכרעים': { primary: ['quads'], secondary: ['glutes', 'hamstrings'] },
    'פלאנק': { primary: ['abs'], secondary: ['shoulders'] },
    'פלאנק צד': { primary: ['abs'], secondary: ['shoulders'] },
    'תלייה': { primary: ['forearms'], secondary: ['lats', 'shoulders'] },
    'וול סיט': { primary: ['quads'], secondary: ['glutes'] },
    'L-sit': { primary: ['abs'], secondary: ['quads', 'shoulders'] },
    'אל-סיט': { primary: ['abs'], secondary: ['quads', 'shoulders'] },
    'הולו הולד': { primary: ['abs'], secondary: [] },
    'הולוו הולד': { primary: ['abs'], secondary: [] }
  };

  const BODYWEIGHT_EXERCISES = [
    'מתח', 'מתח צר', 'מתח אוסטרלי', 'מקבילים', 'שכיבות סמיכה',
    'שכיבות סמיכה יהלום', 'שכיבות סמיכה בעמידת ידיים',
    'הרמות רגליים בתלייה', 'כפיפות בטן', 'סקוואט משקל גוף', 'מכרעים',
    'פלאנק', 'פלאנק צד', 'תלייה', 'וול סיט', 'L-sit', 'אל-סיט', 'הולו הולד', 'הולוו הולד'
  ];

  const STATIC_EXERCISES = [
    'פלאנק', 'פלאנק צד', 'תלייה', 'וול סיט', 'L-sit', 'אל-סיט', 'הולו הולד', 'הולוו הולד'
  ];

  function isStaticName(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    if (STATIC_EXERCISES.indexOf(n) >= 0) return true;
    if (/^פלאנק/.test(n)) return true;
    if (/^וול סיט|^wall\s*sit/i.test(n)) return true;
    if (/^(l-sit|אל-סיט|אל סיט)/i.test(n)) return true;
    if (/^הולוו?\s*הולד|^hollow/i.test(n)) return true;
    if (/^תלייה/.test(n)) return true;
    if (/dead\s*hang/i.test(n)) return true;
    return false;
  }

  const BODYWEIGHT_NAME_RE = /מתח|מקבילים|שכיבות סמיכה|כפיפות בטן|מכרעים|הרמות רגליים|סקוואט משקל גוף/;

  function isBodyweightName(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    if (BODYWEIGHT_EXERCISES.indexOf(n) >= 0) return true;
    return BODYWEIGHT_NAME_RE.test(n);
  }

  const STARTER_FOODS = [
    { key: 'shake', name: 'שייק חלבון', protein: 25, calories: 130, carbs: 5, fat: 2 },
    { key: 'chicken', name: 'חזה עוף 200 גרם', protein: 62, calories: 330, carbs: 0, fat: 7 },
    { key: 'yogurt', name: 'יוגורט חלבון', protein: 20, calories: 120, carbs: 6, fat: 0.5 },
    { key: 'eggs', name: '3 ביצים', protein: 18, calories: 210, carbs: 1, fat: 15 }
  ];

  const DAY_NAMES = [
    { id: 0, short: 'א׳', label: 'ראשון' },
    { id: 1, short: 'ב׳', label: 'שני' },
    { id: 2, short: 'ג׳', label: 'שלישי' },
    { id: 3, short: 'ד׳', label: 'רביעי' },
    { id: 4, short: 'ה׳', label: 'חמישי' },
    { id: 5, short: 'ו׳', label: 'שישי' },
    { id: 6, short: 'ש׳', label: 'שבת' }
  ];

  const MEAL_SLOTS = ['בוקר', 'צהריים', 'לפני אימון', 'אחרי אימון', 'ערב', 'ביניים'];

  const DEFAULT_NOTIFICATIONS = {
    workoutEnabled: false,
    workoutTime: '18:00',
    mealEnabled: false,
    lowHpEnabled: false,
    lowHpThreshold: 50,
    lastFired: { workoutDate: '', meals: {}, lowHpDate: '' }
  };

  const WATER_CUP_ML = 250;
  const WATER_DEFAULT_GOAL_ML = 2000;
  const WATER_VESSEL_PRESETS = {
    cup: [200, 250, 300],
    bottle: [500, 750, 1000, 1500]
  };

  const DEFAULT_SETTINGS = {
    weeklyWorkoutTarget: 4,
    dailyProteinTarget: 150,
    dailyCalorieTarget: '',
    dailyWaterTarget: WATER_DEFAULT_GOAL_ML,
    waterInMl: true,
    waterVessel: 'cup',
    waterVesselMl: WATER_CUP_ML,
    displayName: 'Hazi',
    notifications: Object.assign({}, DEFAULT_NOTIFICATIONS)
  };

  const FitConfig = {
    STORAGE_KEY,
    DEMO_STORAGE_KEY,
    DEMO_MODE_KEY,
    CONSISTENCY_DAYS,
    INSTALL_DISMISS_KEY,
    THEME_KEY,
    APP_VERSION,
    WORKOUT_TYPES,
    XP_RULES,
    LEVELS,
    METRIC_SOURCES,
    METRIC_FIELDS,
    ACHIEVEMENTS,
    DEFAULT_SETTINGS,
    DEFAULT_NOTIFICATIONS,
    WATER_CUP_ML,
    WATER_DEFAULT_GOAL_ML,
    WATER_VESSEL_PRESETS,
    REST_DEFAULT_SEC,
    SMALL_LIFTS,
    MUSCLES,
    EXERCISE_MUSCLES,
    BODYWEIGHT_EXERCISES,
    isBodyweightName,
    STATIC_EXERCISES,
    isStaticName,
    STARTER_FOODS,
    DAY_NAMES,
    MEAL_SLOTS
  };

  root.FitConfig = FitConfig;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitConfig;
})(typeof window !== 'undefined' ? window : globalThis);
