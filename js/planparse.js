/* פיט — parse sets×reps×weight shorthand for the workout builder. */
(function (root) {
  'use strict';

  const MUL_CLASS = '[xX×*⋅]';
  const MAX_RE = /^(max|מקס)$/i;

  function isMaxToken(s) {
    return MAX_RE.test(String(s || '').trim());
  }

  function parseRepsRange(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return { ok: false, empty: true };
    if (isMaxToken(s)) return { ok: true, repsMode: 'max' };
    let m = s.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!(a >= 1) || !(b >= 1)) return { ok: false };
      return { ok: true, repsMode: 'range', repsMin: Math.min(a, b), repsMax: Math.max(a, b) };
    }
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!(n >= 1)) return { ok: false };
      return { ok: true, repsMode: 'range', repsMin: n, repsMax: n };
    }
    return { ok: false };
  }

  function formatRepsRange(ex) {
    if (!ex) return '';
    if (ex.repsMode === 'max') return 'MAX';
    const a = ex.repsMin;
    const b = ex.repsMax;
    if (a == null && b == null) return '';
    if (b == null || a === b) return String(a == null ? '' : a);
    return a + '-' + b;
  }

  function parseWeight(str) {
    if (str == null || str === '') return '';
    const n = Number(String(str).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : '';
  }

  function parseQuick(str) {
    const raw = String(str == null ? '' : str).trim();
    if (!raw) return { ok: false, empty: true };
    const reps = '(?:max|מקס|\\d+(?:\\s*[-–—]\\s*\\d+)?)';
    const re = new RegExp(
      '^\\s*(\\d+)\\s*' + MUL_CLASS + '\\s*(' + reps + ')(?:\\s*' + MUL_CLASS + '\\s*(\\d+(?:[.,]\\d+)?))?\\s*$',
      'i'
    );
    const m = raw.match(re);
    if (!m) return { ok: false };
    const sets = Number(m[1]);
    if (!(sets >= 1)) return { ok: false };
    const range = parseRepsRange(m[2]);
    if (!range.ok) return { ok: false };
    const out = { ok: true, sets: sets, repsMode: range.repsMode };
    if (range.repsMode === 'range') {
      out.repsMin = range.repsMin;
      out.repsMax = range.repsMax;
    }
    if (m[3] != null && m[3] !== '') {
      const w = parseWeight(m[3]);
      if (w === '') return { ok: false };
      out.weight = w;
    }
    return out;
  }

  function formatQuick(ex) {
    if (!ex) return '';
    const sets = ex.sets == null || ex.sets === '' ? '' : String(ex.sets);
    const reps = formatRepsRange(ex);
    const w = ex.weight === 0 ? '0' : (ex.weight == null || ex.weight === '' ? '' : String(ex.weight));
    if (!sets && !reps && !w) return '';
    let s = (sets || '') + '×' + (reps || '');
    if (w !== '') s += '×' + w;
    return s;
  }

  function applyParsed(ex, parsed) {
    if (!ex || !parsed || !parsed.ok) return ex;
    if (parsed.sets != null) ex.sets = parsed.sets;
    if (parsed.repsMode === 'max') {
      ex.repsMode = 'max';
    } else if (parsed.repsMode === 'range') {
      ex.repsMode = 'range';
      if (parsed.repsMin != null) ex.repsMin = parsed.repsMin;
      if (parsed.repsMax != null) ex.repsMax = parsed.repsMax;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'weight')) ex.weight = parsed.weight;
    return ex;
  }

  const FitPlanParse = {
    isMaxToken: isMaxToken,
    parseRepsRange: parseRepsRange,
    formatRepsRange: formatRepsRange,
    parseQuick: parseQuick,
    formatQuick: formatQuick,
    applyParsed: applyParsed,
    parseWeight: parseWeight
  };

  root.FitPlanParse = FitPlanParse;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitPlanParse;
})(typeof window !== 'undefined' ? window : globalThis);
