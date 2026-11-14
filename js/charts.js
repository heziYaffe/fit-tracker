/* פיט — SVG charts drawn locally (no CDN), so they work offline. */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }


  function starPath(cx, cy, r) {
    let d = '';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
      const b = a + Math.PI / 5;
      const x1 = cx + Math.cos(a) * r;
      const y1 = cy + Math.sin(a) * r;
      const x2 = cx + Math.cos(b) * (r * 0.4);
      const y2 = cy + Math.sin(b) * (r * 0.4);
      d += (i === 0 ? 'M' : 'L') + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  let gid = 0;
  function uid(prefix) {
    gid += 1;
    return (prefix || 'c') + gid;
  }

  function niceMax(value) {
    const v = Math.max(Number(value) || 0, 1);
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return nice * pow;
  }

  function barChart(opts) {
    const labels = opts.labels || [];
    const values = opts.values || [];
    const target = opts.target;
    const color = opts.color || '#d36bff';
    const W = opts.width || 320;
    const H = opts.height || 180;
    const padL = 6;
    const padR = 32;
    const padT = 14;
    const padB = 26;
    const maxVal = Math.max(target || 0, 0);
    values.forEach(function (v) { if (v > maxVal) { /* noop */ } });
    const peak = values.reduce(function (m, v) { return Math.max(m, Number(v) || 0); }, target || 0);
    const nice = niceMax(peak);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = Math.max(values.length, 1);
    const gap = 6;
    const barW = Math.max(8, (innerW - gap * (n - 1)) / n);

    let grid = '';
    [0, 0.5, 1].forEach(function (t) {
      const y = padT + innerH - t * innerH;
      grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" class="chart-grid" />';
      grid += '<text x="' + (W - 4) + '" y="' + (y + 3) + '" text-anchor="end" class="chart-label">' + Math.round(nice * t) + '</text>';
    });

    let targetLine = '';
    if (target != null && target !== '') {
      const y = padT + innerH - (Number(target) / nice) * innerH;
      targetLine = '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="chart-target" />';
      targetLine += '<text x="' + (W - padR + 4) + '" y="' + (y + 3).toFixed(1) + '" class="chart-label">' + esc(String(target)) + '</text>';
    }

    const marks = opts.marks || [];
    const showEvery = Math.max(1, Math.ceil(n / 8));
    let bars = '';
    values.forEach(function (v, i) {
      const num = Number(v) || 0;
      const h = nice ? (num / nice) * innerH : 0;
      const x = padL + i * (barW + gap);
      const y = padT + innerH - h;
      const fill = marks[i] ? '#ffc46b' : (num > 0 ? color : 'transparent');
      const tip = esc((labels[i] || '') + ' · ' + num);
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="6" fill="' + fill + '" data-action="chart-tip" data-tip="' + tip + '" />';
      if (marks[i]) {
        const sx = x + barW / 2;
        const sy = Math.max(8, y - 7);
        bars += '<path d="' + starPath(sx, sy, 5) + '" fill="#ffc46b" stroke="#0c0714" stroke-width="0.8" />';
      }
      if (i % showEvery === 0 || i === n - 1) {
        bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="chart-label">' + esc(labels[i] || '') + '</text>';
      }
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" aria-label="' + esc(opts.aria || 'גרף') + '">' + grid + targetLine + bars + '</svg>';
  }

  function lineChart(opts) {
    const labels = opts.labels || [];
    const values = opts.values || [];
    const target = opts.target;
    const color = opts.color || '#ff3dce';
    const W = opts.width || 320;
    const H = opts.height || 180;
    const padL = 6;
    const padR = 32;
    const padT = 14;
    const padB = 26;
    const nums = values.map(function (v) { return v == null || v === '' ? null : Number(v); });
    const present = nums.filter(function (v) { return v != null && !Number.isNaN(v); });
    const peak = present.reduce(function (m, v) { return Math.max(m, v); }, Number(target) || 0);
    const floor = present.length ? present.reduce(function (m, v) { return Math.min(m, v); }, peak) : 0;
    const tighten = opts.tighten && present.length && floor > 0 && floor > peak * 0.5;
    const niceLo = tighten ? Math.max(0, Math.floor((floor * 0.92) / (peak > 50 ? 5 : 1)) * (peak > 50 ? 5 : 1)) : 0;
    const nice = niceMax(peak - niceLo) + niceLo;
    const span = Math.max(nice - niceLo, 1);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = Math.max(nums.length, 1);
    const step = n === 1 ? 0 : innerW / (n - 1);
    const marks = opts.marks || [];

    function xy(i, v) {
      const x = padL + i * step;
      const y = padT + innerH - ((v - niceLo) / span) * innerH;
      return { x: x, y: y };
    }

    function tickLabel(v) {
      if (Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
      return String(Math.round(v * 10) / 10);
    }

    let grid = '';
    [0, 0.5, 1].forEach(function (t) {
      const y = padT + innerH - t * innerH;
      const val = niceLo + span * t;
      grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" class="chart-grid" />';
      grid += '<text x="' + (W - 4) + '" y="' + (y + 3) + '" text-anchor="end" class="chart-label">' + tickLabel(val) + '</text>';
    });

    let targetLine = '';
    if (target != null && target !== '') {
      const y = padT + innerH - ((Number(target) - niceLo) / span) * innerH;
      targetLine = '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="chart-target" />';
    }

    const pts = [];
    nums.forEach(function (v, i) {
      if (v == null || Number.isNaN(v)) return;
      pts.push(Object.assign({ i: i }, xy(i, v)));
    });

    let path = '';
    let dots = '';
    pts.forEach(function (p, idx) {
      path += (idx === 0 ? 'M' : ' L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      const tip = esc((labels[p.i] || '') + ' · ' + nums[p.i]);
      if (marks[p.i]) {
        dots += '<path d="' + starPath(p.x, p.y, 6) + '" fill="#ffc46b" stroke="#0c0714" stroke-width="1" data-action="chart-tip" data-tip="' + tip + '" />';
      } else {
        dots += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.2" fill="' + color + '" stroke="#0c0714" stroke-width="1" data-action="chart-tip" data-tip="' + tip + '" />';
      }
    });
    const gidFill = uid('lg');
    let area = '';
    if (pts.length) {
      const last = pts[pts.length - 1];
      const first = pts[0];
      const baseY = padT + innerH;
      area = '<defs><linearGradient id="' + gidFill + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.32"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
      area += '<path d="' + path + ' L' + last.x.toFixed(1) + ' ' + baseY.toFixed(1) + ' L' + first.x.toFixed(1) + ' ' + baseY.toFixed(1) + ' Z" fill="url(#' + gidFill + ')" />';
    }
    const line = pts.length ? '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />' : '';

    let xlabels = '';
    const showEvery = Math.max(1, Math.ceil(n / 7));
    labels.forEach(function (lab, i) {
      if (i % showEvery !== 0 && i !== n - 1) return;
      const x = padL + i * step;
      xlabels += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="chart-label">' + esc(lab) + '</text>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" aria-label="' + esc(opts.aria || 'גרף') + '">' + area + grid + targetLine + line + dots + xlabels + '</svg>';
  }

  function heatmap(opts) {
    const weeks = opts.weeks || 16;
    const end = opts.end ? new Date(opts.end) : new Date();
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const start = new Date(endDay);
    start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
    const E = root.FitEngine;
    const startISO = E.todayISO(start);
    const cell = 11;
    const gap = 3;
    const labelW = 16;
    const W = labelW + weeks * (cell + gap);
    const H = 7 * (cell + gap) + 16;
    const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    const getClass = opts.getClass || function () { return 'hm-empty'; };

    let labels = '';
    dayNames.forEach(function (name, dow) {
      if (dow % 2 !== 0) return;
      const y = dow * (cell + gap) + cell - 1;
      labels += '<text x="0" y="' + y + '" class="chart-label">' + name + '</text>';
    });

    let cells = '';
    let lastMonth = -1;
    let monthLabels = '';
    for (let w = 0; w < weeks; w++) {
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(start);
        d.setDate(start.getDate() + w * 7 + dow);
        const iso = E.todayISO(d);
        const future = d > endDay;
        const cls = future ? 'hm-future' : getClass(iso);
        const x = labelW + w * (cell + gap);
        const y = dow * (cell + gap);
        cells += '<rect data-action="hm-day" data-date="' + iso + '" class="hm-cell ' + cls + '" x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2"><title>' + iso + '</title></rect>';
        if (dow === 0 && d.getMonth() !== lastMonth) {
          lastMonth = d.getMonth();
          monthLabels += '<text x="' + x + '" y="' + (H - 2) + '" class="chart-label">' + esc(d.toLocaleDateString('he-IL', { month: 'short' })) + '</text>';
        }
      }
    }

    return '<div class="hm-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" aria-label="לוח פעילות" width="' + (W + 4) + '">' + labels + cells + monthLabels + '</svg></div>';
  }

  const FitCharts = {
    barChart: barChart,
    lineChart: lineChart,
    heatmap: heatmap,
    niceMax: niceMax
  };

  root.FitCharts = FitCharts;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitCharts;
})(typeof window !== 'undefined' ? window : globalThis);
