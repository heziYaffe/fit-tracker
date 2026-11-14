/* פיט — weekly body map SVG (front + back), shaded by muscle load. */
(function (root) {
  'use strict';

  function lvlClass(level) {
    return 'muscle lv' + (level || 0);
  }

  function region(id, d, load) {
    const lv = load && load[id] ? load[id].level : 0;
    const label = load && load[id] ? load[id].label + ' · ' + (Math.round((load[id].sets || 0) * 10) / 10) + ' סטים' : id;
    return '<path data-action="muscle-info" data-muscle="' + id + '" class="' + lvlClass(lv) + '" d="' + d + '"><title>' + label + '</title></path>';
  }

  function ellipse(id, cx, cy, rx, ry, load) {
    const lv = load && load[id] ? load[id].level : 0;
    const label = load && load[id] ? load[id].label + ' · ' + (Math.round((load[id].sets || 0) * 10) / 10) + ' סטים' : id;
    return '<ellipse data-action="muscle-info" data-muscle="' + id + '" class="' + lvlClass(lv) + '" cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '"><title>' + label + '</title></ellipse>';
  }

  function front(load, ox) {
    const x = ox || 0;
    let s = '<g class="body-front" transform="translate(' + x + ',0)">';
    s += '<circle class="body-skin" cx="80" cy="22" r="16"/>';
    s += '<path class="body-skin" d="M73 38 h14 v10 h-14z"/>';
    /* shoulders */
    s += ellipse('shoulders', 42, 62, 18, 14, load);
    s += ellipse('shoulders', 118, 62, 18, 14, load);
    /* chest */
    s += ellipse('chest', 64, 80, 18, 16, load);
    s += ellipse('chest', 96, 80, 18, 16, load);
    /* biceps */
    s += ellipse('biceps', 30, 96, 10, 16, load);
    s += ellipse('biceps', 130, 96, 10, 16, load);
    /* forearms */
    s += ellipse('forearms', 24, 128, 8, 16, load);
    s += ellipse('forearms', 136, 128, 8, 16, load);
    /* abs */
    s += region('abs', 'M64 98 h32 v36 h-32z', load);
    /* quads */
    s += ellipse('quads', 66, 186, 16, 36, load);
    s += ellipse('quads', 94, 186, 16, 36, load);
    /* calves */
    s += ellipse('calves', 66, 244, 11, 24, load);
    s += ellipse('calves', 94, 244, 11, 24, load);
    /* outline hints */
    s += '<circle class="body-outline" cx="80" cy="22" r="16"/>';
    s += '</g>';
    return s;
  }

  function back(load, ox) {
    const x = ox || 0;
    let s = '<g class="body-back" transform="translate(' + x + ',0)">';
    s += '<circle class="body-skin" cx="80" cy="22" r="16"/>';
    s += '<path class="body-skin" d="M73 38 h14 v10 h-14z"/>';
    /* traps / upper back */
    s += ellipse('upperback', 80, 64, 28, 16, load);
    /* shoulders rear */
    s += ellipse('shoulders', 42, 62, 16, 13, load);
    s += ellipse('shoulders', 118, 62, 16, 13, load);
    /* lats */
    s += region('lats', 'M46 78 C48 120 60 132 80 134 C60 132 50 110 46 78z', load);
    s += region('lats', 'M114 78 C112 120 100 132 80 134 C100 132 110 110 114 78z', load);
    /* triceps */
    s += ellipse('triceps', 30, 96, 10, 16, load);
    s += ellipse('triceps', 130, 96, 10, 16, load);
    /* forearms */
    s += ellipse('forearms', 24, 128, 8, 16, load);
    s += ellipse('forearms', 136, 128, 8, 16, load);
    /* lower back */
    s += region('lowerback', 'M64 126 h32 v28 h-32z', load);
    /* glutes */
    s += ellipse('glutes', 66, 162, 16, 14, load);
    s += ellipse('glutes', 94, 162, 16, 14, load);
    /* hamstrings */
    s += ellipse('hamstrings', 66, 200, 14, 28, load);
    s += ellipse('hamstrings', 94, 200, 14, 28, load);
    /* calves */
    s += ellipse('calves', 66, 244, 11, 24, load);
    s += ellipse('calves', 94, 244, 11, 24, load);
    s += '<circle class="body-outline" cx="80" cy="22" r="16"/>';
    s += '</g>';
    return s;
  }

  function render(loadResult, opts) {
    opts = opts || {};
    const mini = !!opts.mini;
    const load = {};
    (loadResult.muscles || []).forEach(function (m) { load[m.id] = m; });
    const w = 340;
    const h = 300;
    const title = mini ? '' : '<text x="80" y="14" text-anchor="middle" class="body-caption">קדמי</text>' +
      '<text x="250" y="14" text-anchor="middle" class="body-caption">אחורי</text>';
    const svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="body-map' + (mini ? ' mini' : '') + '" role="img" aria-label="מפת גוף שבועית">' +
      title +
      front(load, 0) +
      back(load, 170) +
      '</svg>';
    return svg;
  }

  function neglectedList(loadResult) {
    return (loadResult.neglected || []).map(function (m) { return m.label; });
  }

  const FitBodyMap = { render: render, neglectedList: neglectedList };
  root.FitBodyMap = FitBodyMap;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitBodyMap;
})(typeof window !== 'undefined' ? window : globalThis);
