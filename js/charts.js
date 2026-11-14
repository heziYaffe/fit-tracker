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
    const color = opts.color || '#3ee0a0';
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

    let bars = '';
    values.forEach(function (v, i) {
      const num = Number(v) || 0;
      const h = nice ? (num / nice) * innerH : 0;
      const x = padL + i * (barW + gap);
      const y = padT + innerH - h;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="4" fill="' + (num > 0 ? color : 'transparent') + '" />';
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="chart-label">' + esc(labels[i] || '') + '</text>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" aria-label="' + esc(opts.aria || 'גרף') + '">' + grid + targetLine + bars + '</svg>';
  }

  function lineChart(opts) {
    const labels = opts.labels || [];
    const values = opts.values || [];
    const target = opts.target;
    const color = opts.color || '#ffb14a';
    const W = opts.width || 320;
    const H = opts.height || 180;
    const padL = 6;
    const padR = 32;
    const padT = 14;
    const padB = 26;
    const nums = values.map(function (v) { return v == null || v === '' ? null : Number(v); });
    const present = nums.filter(function (v) { return v != null && !Number.isNaN(v); });
    const peak = present.reduce(function (m, v) { return Math.max(m, v); }, Number(target) || 0);
    const nice = niceMax(peak);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = Math.max(nums.length, 1);
    const step = n === 1 ? 0 : innerW / (n - 1);

    function xy(i, v) {
      const x = padL + i * step;
      const y = padT + innerH - (v / nice) * innerH;
      return { x: x, y: y };
    }

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
      dots += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.6" fill="' + color + '" />';
    });
    const line = pts.length ? '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' : '';

    let xlabels = '';
    const showEvery = Math.max(1, Math.ceil(n / 7));
    labels.forEach(function (lab, i) {
      if (i % showEvery !== 0 && i !== n - 1) return;
      const x = padL + i * step;
      xlabels += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="chart-label">' + esc(lab) + '</text>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" role="img" aria-label="' + esc(opts.aria || 'גרף') + '">' + grid + targetLine + line + dots + xlabels + '</svg>';
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
