/* פיט — parse sets×reps/time×weight shorthand for the workout builder. */
(function (root) {
  'use strict';

  const MUL_CLASS = '[xX×*⋅]';
  const MUL_SPLIT = /(?:\s*[xX×*⋅]\s*)/;
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

  function looksLikeTime(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return false;
    if (/^\d+:\d{1,2}$/.test(s)) return true;
    if (/^\d+(?:[.,]\d+)?\s*(?:s|sec|secs|ש|שנ|שנ׳|שניות|m|min|ד|דק|דק׳)$/i.test(s)) return true;
    if (/^\d+\s*[-–—]\s*\d+\s*(?:s|sec|secs|ש|שנ|שנ׳|שניות|m|min|ד|דק|דק׳)$/i.test(s)) return true;
    return false;
  }

  /* Parse a single duration token into seconds. 45s, 45ש, 1:00, 1m, 60, 30-45s. */
  function parseDuration(str, assumeTime) {
    const raw = String(str == null ? '' : str).trim();
    if (!raw) return { ok: false, empty: true };
    if (isMaxToken(raw)) return { ok: true, max: true };
    let m = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
    if (m) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      if (sec >= 60) return { ok: false };
      const total = min * 60 + sec;
      if (!(total >= 1)) return { ok: false };
      return { ok: true, secs: total, secsMin: total, secsMax: total };
    }
    m = raw.match(/^(\d+)\s*[-–—]\s*(\d+)\s*(?:s|sec|secs|ש|שנ|שנ׳|שניות|m|min|ד|דק|דק׳)?$/i);
    if (m && (assumeTime || looksLikeTime(raw))) {
      function toSec(n, unitSrc) {
        const v = Number(n);
        if (/m|min|ד/.test(unitSrc) && !/s|ש/.test(unitSrc)) return Math.round(v * 60);
        return v;
      }
      const unit = (raw.match(/(s|sec|ש|שנ|m|min|ד)/i) || [''])[0];
      const a = toSec(m[1], unit);
      const b = toSec(m[2], unit);
      if (!(a >= 1) || !(b >= 1)) return { ok: false };
      return { ok: true, secsMin: Math.min(a, b), secsMax: Math.max(a, b), secs: Math.max(a, b) };
    }
    m = raw.match(/^(\d+(?:[.,]\d+)?)\s*(s|sec|secs|ש|שנ|שנ׳|שניות|m|min|ד|דק|דק׳)$/i);
    if (m) {
      const v = Number(String(m[1]).replace(',', '.'));
      const unit = m[2].toLowerCase();
      const secs = (/^(m|min|ד|דק|דק׳)$/.test(unit)) ? Math.round(v * 60) : Math.round(v);
      if (!(secs >= 1)) return { ok: false };
      return { ok: true, secs: secs, secsMin: secs, secsMax: secs };
    }
    if (assumeTime && /^\d+$/.test(raw)) {
      const n = Number(raw);
      if (!(n >= 1)) return { ok: false };
      return { ok: true, secs: n, secsMin: n, secsMax: n };
    }
    return { ok: false };
  }

  function formatDuration(sec) {
    const n = Math.max(0, Math.round(Number(sec) || 0));
    if (n < 60) return n + 's';
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatDurationHe(sec) {
    const n = Math.max(0, Math.round(Number(sec) || 0));
    if (n < 60) return n + ' שנ׳';
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatDurationRange(ex) {
    if (!ex) return '';
    if (ex.repsMode === 'max') return 'MAX';
    const a = ex.secsMin != null && ex.secsMin !== '' ? Number(ex.secsMin) : (ex.secs != null ? Number(ex.secs) : '');
    const b = ex.secsMax != null && ex.secsMax !== '' ? Number(ex.secsMax) : a;
    if (a === '' || !Number.isFinite(a)) return '';
    if (!Number.isFinite(b) || a === b) return formatDuration(a);
    return formatDuration(a).replace(/s$/, '') + '-' + formatDuration(b);
  }

  function matchQuick(raw, midPat) {
    const mul = '\\s*' + MUL_CLASS + '\\s*';
    const re = new RegExp('^\\s*(\\d+)' + mul + '(' + midPat + ')(?:' + mul + '(\\d+(?:[.,]\\d+)?))?\\s*$', 'i');
    return raw.match(re);
  }

  function parseQuick(str, opts) {
    opts = opts || {};
    const raw = String(str == null ? '' : str).trim();
    if (!raw) return { ok: false, empty: true };
    const timeMid = '\\d+\\s*:\\s*\\d{1,2}|\\d+(?:[.,]\\d+)?\\s*(?:s|sec|secs|ש|שנ|שנ׳|שניות|m|min|ד|דק|דק׳)|\\d+\\s*[-–—]\\s*\\d+\\s*(?:s|sec|secs|ש|שנ|שנ׳|m|min|ד|דק)';
    const bareTimeMid = 'max|מקס|\\d+\\s*:\\s*\\d{1,2}|\\d+(?:[.,]\\d+)?\\s*(?:s|sec|secs|ש|שנ|שנ׳|שניות|m|min|ד|דק|דק׳)?|\\d+\\s*[-–—]\\s*\\d+\\s*(?:s|sec|secs|ש|שנ|שנ׳|m|min|ד|דק)?';
    const repsMid = 'max|מקס|\\d+(?:\\s*[-–—]\\s*\\d+)?';
    const preferTime = !!opts.static;
    const timeHit = matchQuick(raw, preferTime ? bareTimeMid : timeMid);
    const repsHit = matchQuick(raw, repsMid);
    let m = null;
    let asStatic = false;
    if (preferTime && timeHit) { m = timeHit; asStatic = true; }
    else if (timeHit) { m = timeHit; asStatic = true; }
    else if (repsHit) { m = repsHit; asStatic = false; }
    else return { ok: false };
    const sets = Number(m[1]);
    if (!(sets >= 1)) return { ok: false };
    const mid = m[2];
    const out = { ok: true, sets: sets };
    if (asStatic) {
      const asTime = parseDuration(mid, true);
      if (!asTime.ok) return { ok: false };
      out.static = true;
      if (asTime.max) out.repsMode = 'max';
      else {
        out.repsMode = 'range';
        out.secsMin = asTime.secsMin;
        out.secsMax = asTime.secsMax;
        out.secs = asTime.secs;
      }
    } else {
      const asReps = parseRepsRange(mid);
      if (!asReps.ok) return { ok: false };
      out.static = false;
      out.repsMode = asReps.repsMode;
      if (asReps.repsMode === 'range') {
        out.repsMin = asReps.repsMin;
        out.repsMax = asReps.repsMax;
      }
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
    const isStatic = !!ex.static;
    const mid = isStatic ? formatDurationRange(ex) : formatRepsRange(ex);
    const w = ex.weight === 0 ? '0' : (ex.weight == null || ex.weight === '' ? '' : String(ex.weight));
    if (!sets && !mid && !w) return '';
    let s = (sets || '') + '×' + (mid || '');
    if (w !== '') s += '×' + w;
    return s;
  }

  function applyParsed(ex, parsed) {
    if (!ex || !parsed || !parsed.ok) return ex;
    if (parsed.sets != null) ex.sets = parsed.sets;
    if (parsed.static === true) ex.static = true;
    if (parsed.static === false) ex.static = false;
    if (parsed.repsMode === 'max') {
      ex.repsMode = 'max';
    } else if (parsed.repsMode === 'range') {
      ex.repsMode = 'range';
      if (parsed.repsMin != null) ex.repsMin = parsed.repsMin;
      if (parsed.repsMax != null) ex.repsMax = parsed.repsMax;
      if (parsed.secsMin != null) ex.secsMin = parsed.secsMin;
      if (parsed.secsMax != null) ex.secsMax = parsed.secsMax;
      if (parsed.secs != null) ex.secs = parsed.secs;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'weight')) ex.weight = parsed.weight;
    return ex;
  }

  const FitPlanParse = {
    isMaxToken: isMaxToken,
    parseRepsRange: parseRepsRange,
    formatRepsRange: formatRepsRange,
    parseDuration: parseDuration,
    formatDuration: formatDuration,
    formatDurationHe: formatDurationHe,
    formatDurationRange: formatDurationRange,
    looksLikeTime: looksLikeTime,
    parseQuick: parseQuick,
    formatQuick: formatQuick,
    applyParsed: applyParsed,
    parseWeight: parseWeight
  };

  root.FitPlanParse = FitPlanParse;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitPlanParse;
})(typeof window !== 'undefined' ? window : globalThis);
