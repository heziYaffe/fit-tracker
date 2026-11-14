const P = require('../js/planparse.js');
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || '') + ' expected ' + sb + ' got ' + sa);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// existing reps shorthand still works
['*', 'x', 'X', '×'].forEach(function (sep) {
  const r = P.parseQuick('3' + sep + '8-12' + sep + '50');
  eq({ ok: true, sets: 3, static: false, repsMode: 'range', repsMin: 8, repsMax: 12, weight: 50 }, r, 'reps ' + sep);
});
eq(P.parseQuick('3*8-12').static, false);
eq(P.parseQuick('3*MAX').repsMode, 'max');

// time forms
function time(s, extra) {
  const r = P.parseQuick(s);
  ok(r.ok && r.static, 'should be static: ' + s + ' ' + JSON.stringify(r));
  if (extra) Object.keys(extra).forEach(function (k) { eq(r[k], extra[k], s + ' ' + k); });
  return r;
}
time('3x45s', { sets: 3, secs: 45, secsMin: 45, secsMax: 45 });
time('3*45s', { sets: 3, secs: 45 });
time('3×45s', { sets: 3, secs: 45 });
time('3*45s*10', { sets: 3, secs: 45, weight: 10 });
time('3x45s x10', { sets: 3, secs: 45, weight: 10 });
time('3x1:00', { sets: 3, secs: 60 });
time('3x1:30', { sets: 3, secs: 90 });
time('3x60ש', { sets: 3, secs: 60 });
time('3x45שנ', { sets: 3, secs: 45 });
time('3x1m', { sets: 3, secs: 60 });
time('3x1ד', { sets: 3, secs: 60 });
time('3x30-45s', { sets: 3, secsMin: 30, secsMax: 45 });

// bare 3*45 is reps unless context is static
eq(P.parseQuick('3*45').static, false);
eq(P.parseQuick('3*45').repsMin, 45);
eq(P.parseQuick('3*45', { static: true }).static, true);
eq(P.parseQuick('3*45', { static: true }).secs, 45);

// MAX time
eq(P.parseQuick('3xMAX', { static: true }).repsMode, 'max');
eq(P.parseQuick('3xMAX', { static: true }).static, true);
eq(P.parseQuick('3*מקס', { static: true }).repsMode, 'max');

// parseDuration
eq(P.parseDuration('45s').secs, 45);
eq(P.parseDuration('1:05').secs, 65);
eq(P.parseDuration('1m').secs, 60);
eq(P.parseDuration('60ש').secs, 60);
eq(P.parseDuration('MAX').max, true);
ok(P.parseDuration('45').ok === false, 'bare number without assumeTime');
eq(P.parseDuration('45', true).secs, 45);
ok(P.parseDuration('1:75').ok === false, 'invalid mm:ss');

// format
eq(P.formatDuration(45), '45s');
eq(P.formatDuration(60), '1:00');
eq(P.formatDuration(75), '1:15');
eq(P.formatDurationHe(45), '45 שנ׳');
eq(P.formatQuick({ sets: 3, static: true, secsMin: 45, secsMax: 45 }), '3×45s');
eq(P.formatQuick({ sets: 3, static: true, repsMode: 'max' }), '3×MAX');
eq(P.formatQuick({ sets: 3, static: true, secsMin: 45, secsMax: 45, weight: 10 }), '3×45s×10');

// invalid
['', 'abc', '3*', '45s', '3x1:75', '3x45s x x10'].forEach(function (s) {
  ok(!P.parseQuick(s).ok, 'invalid: ' + s);
});


// bare MAX is reps unless already in a static exercise
eq(P.parseQuick('3xMAX').static, false);
eq(P.parseQuick('3xMAX').repsMode, 'max');
eq(P.parseQuick('3*MAX').static, false);
eq(P.parseQuick('3*MAX').repsMode, 'max');
eq(P.parseQuick('3x8-12x50').static, false);
eq(P.parseQuick('  3 x 8-12 x 50  ').weight, 50);
eq(P.parseQuick('3×8').repsMin, 8);

console.log('planparse time tests passed');

