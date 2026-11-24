/* פיט — cozy "villager" avatars (Animal Crossing–like): big round heads, stubby limbs, soft cel shading
   and a painted face that changes expression (happy, tired, sleepy, chewing, sipping, yawning…).
   Built in code from the body parameters, so weight, belly, limbs and height still morph live.
   No external models. Used by avatar3d.js; the older v42 figures stay as a fallback. */
import {
  Group, Mesh, SphereGeometry, CylinderGeometry, CapsuleGeometry, ConeGeometry, BoxGeometry, TorusGeometry,
  LatheGeometry, PlaneGeometry, MeshToonMaterial, MeshBasicMaterial, DataTexture, NearestFilter, CanvasTexture,
  SRGBColorSpace, Color, Vector2
} from './vendor/three-avatar.js';

const PI = Math.PI;
let gradient = null;
/* soft 4-step cel ramp: light side stays bright, the shadow is a gentle step, never black */
function toonRamp() {
  if (gradient) return gradient;
  const v = [60, 150, 220, 255]; // dark end 0: fill comes from the hemisphere light, rims stay rims
  const d = new Uint8Array(v.length * 4);
  v.forEach((x, i) => { d[i * 4] = x; d[i * 4 + 1] = x; d[i * 4 + 2] = x; d[i * 4 + 3] = 255; });
  gradient = new DataTexture(d, v.length, 1);
  gradient.minFilter = NearestFilter; gradient.magFilter = NearestFilter; gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}
export function pastel(hex, k) { return new Color(hex).lerp(new Color('#fff4fa'), k == null ? 0.18 : k).getHex(); }

/* ---------- painted face ----------
   A canvas texture on a spherical cap over the front of the head. Drawing is in "degrees on the head"
   (x right, y down from the eye line) so circles stay round on the sphere. */
const FACE = { phi: 160, th0: 50, th1: 150, eyeTh: 98 }; // degrees: cap width, theta range, eye line
const CW = 512, CH = 512;
const PX0 = CW / FACE.phi, PY0 = CH / (FACE.th1 - FACE.th0);
const PX = PX0 * 1.32, PY = PY0 * 1.32;
const F = 1.32; // feature scale
function fx(xd) { return CW / 2 + xd * F * PX0; }
function fy(yd) { return (FACE.eyeTh - FACE.th0 + yd * F) * PY0; }

export class FacePainter {
  /* o: {style:'human'|'bunny'|'bear'|'cat'|'dragon'|'robot', sex, skin, line, beard, beardColor, mouth:bool, glow} */
  constructor(o) {
    this.o = o;
    this.c = document.createElement('canvas');
    this.c.width = CW; this.c.height = CH;
    this.x = this.c.getContext('2d');
    this.tex = new CanvasTexture(this.c);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.key = '';
    this.update({ close: 0, open: 0, expr: 'neutral', lx: 0, ly: 0 });
  }
  /* returns true when it redrew */
  update(s) {
    const q = (v, n) => Math.round(Math.max(0, Math.min(1, v || 0)) * n);
    const key = [s.expr, q(s.close, 8), q(s.open, 6), Math.round((s.lx || 0) * 3), Math.round((s.ly || 0) * 2)].join('|');
    if (key === this.key) return false;
    this.key = key;
    this.draw(s);
    this.tex.needsUpdate = true;
    return true;
  }
  ell(xd, yd, rxd, ryd, rot) { const x = this.x; x.beginPath(); x.ellipse(fx(xd), fy(yd), Math.max(0.1, rxd * PX), Math.max(0.1, ryd * PY), rot || 0, 0, PI * 2); }
  arc(xd, yd, rxd, ryd, a0, a1, w, col) {
    const x = this.x;
    x.beginPath(); x.ellipse(fx(xd), fy(yd), rxd * PX, ryd * PY, 0, a0, a1);
    x.lineWidth = w; x.lineCap = 'round'; x.strokeStyle = col; x.stroke();
  }
  draw(s) {
    const x = this.x, o = this.o;
    x.clearRect(0, 0, CW, CH);
    const robot = o.style === 'robot';
    const line = robot ? o.glow : (o.line || '#3b2431');
    const expr = s.expr || 'neutral';
    const lx = s.lx || 0, ly = s.ly || 0;
    const eyeX = o.style === 'human' ? 12.5 : 14, eyeY = 0;
    // blush
    if (!robot) {
      [-1, 1].forEach((sd) => {
        const cx = fx(sd * (eyeX + 7)), cy = fy(10);
        const g = x.createRadialGradient(cx, cy, 2, cx, cy, 9 * PX);
        const a = expr === 'joy' || expr === 'happy' ? 0.62 : expr === 'tired' || expr === 'sleepy' ? 0.28 : 0.45;
        g.addColorStop(0, `rgba(255,128,150,${a})`); g.addColorStop(1, 'rgba(255,128,150,0)');
        x.fillStyle = g;
        this.ell(sd * (eyeX + 7), 10, 9, 5.5); x.fill();
      });
    }
    // beard / stubble (human)
    if (o.style === 'human' && o.beard && o.beard !== 'none') {
      x.save();
      x.globalAlpha = o.beard === 'stubble' ? 0.28 : 0.95;
      x.fillStyle = o.beardColor || '#3a2a22';
      x.beginPath();
      const top = o.beard === 'full' ? 12 : 16;
      x.moveTo(fx(-21), fy(top - 4));
      x.quadraticCurveTo(fx(-20), fy(34), fx(0), fy(o.beard === 'full' ? 40 : 34));
      x.quadraticCurveTo(fx(20), fy(34), fx(21), fy(top - 4));
      x.quadraticCurveTo(fx(10), fy(top + 6), fx(0), fy(top + 5));
      x.quadraticCurveTo(fx(-10), fy(top + 6), fx(-21), fy(top - 4));
      x.fill();
      x.restore();
    }
    // eyes
    const close = Math.max(0, Math.min(1, s.close || 0));
    const shut = close > 0.82 || expr === 'sleepy' || expr === 'sip' || expr === 'yawn';
    [-1, 1].forEach((sd) => {
      const ex = sd * eyeX + lx * 1.2, ey = eyeY + ly * 1.0;
      if (expr === 'joy' || expr === 'effort') {
        // ^ ^  (effort: > <)
        x.beginPath();
        const w = 5.2 * PX, h = 3.6 * PY;
        if (expr === 'joy') { x.moveTo(fx(ex) - w, fy(ey) + h * 0.5); x.quadraticCurveTo(fx(ex), fy(ey) - h * 1.6, fx(ex) + w, fy(ey) + h * 0.5); }
        else { x.moveTo(fx(ex) - sd * w, fy(ey) - h); x.lineTo(fx(ex) + sd * w * 0.6, fy(ey)); x.lineTo(fx(ex) - sd * w, fy(ey) + h); }
        x.lineWidth = robot ? 16 : 11; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = line; x.stroke();
        return;
      }
      if (shut) {
        // closed: a soft downward curve (sleepy / sipping) with lashes
        this.arc(ex, ey - 0.5, 5.2, 2.6, 0.15 * PI, 0.85 * PI, robot ? 14 : 10, line);
        if (o.sex === 'f' && !robot) this.arc(ex + sd * 4.6, ey + 0.4, 1.4, 1.4, sd > 0 ? -0.2 * PI : 0.7 * PI, sd > 0 ? 0.3 * PI : 1.2 * PI, 6, line);
        return;
      }
      const rx = robot ? 5.4 : o.style === 'human' ? 4.4 : 5.0;
      const ry = robot ? 5.4 : o.style === 'human' ? 6.0 : 6.6;
      // the lid comes down from the top for blinks and tired eyes
      const lid = Math.max(close, expr === 'tired' ? 0.42 : 0);
      x.save();
      this.ell(ex, ey, rx + 0.6, ry + 0.6); x.clip();
      if (robot) {
        x.shadowColor = o.glow; x.shadowBlur = 24;
        x.fillStyle = o.glow; this.ell(ex, ey, rx, ry); x.fill();
        x.shadowBlur = 0;
      } else {
        x.fillStyle = '#24161f'; this.ell(ex, ey, rx, ry); x.fill();
        // iris glow at the bottom and two highlights (the "sparkle")
        const g = x.createRadialGradient(fx(ex), fy(ey + ry * 0.55), 1, fx(ex), fy(ey + ry * 0.55), rx * PX * 1.1);
        g.addColorStop(0, o.iris || 'rgba(120,90,160,0.85)'); g.addColorStop(1, 'rgba(36,22,31,0)');
        x.fillStyle = g; this.ell(ex, ey, rx, ry); x.fill();
        x.fillStyle = '#ffffff';
        this.ell(ex + rx * 0.32, ey - ry * 0.38, rx * 0.36, ry * 0.26); x.fill();
        this.ell(ex - rx * 0.35, ey + ry * 0.42, rx * 0.16, ry * 0.12); x.fill();
      }
      if (lid > 0.02) {
        x.fillStyle = robot ? '#1d1322' : (o.lid || o.skin || '#f1c7a5');
        x.fillRect(fx(ex - rx - 1), fy(ey - ry - 1), (rx * 2 + 2) * PX, (ry * 2 + 2) * PY * lid);
        if (!robot) { x.fillStyle = line; x.fillRect(fx(ex - rx - 1), fy(ey - ry - 1) + (ry * 2 + 2) * PY * lid - 4, (rx * 2 + 2) * PX, 5); }
      }
      x.restore();
      if (o.sex === 'f' && !robot && lid < 0.6) {
        // two lashes at the outer corner
        x.lineWidth = 6; x.lineCap = 'round'; x.strokeStyle = line;
        [[0.7, -0.75, 1.9, -1.35], [0.92, -0.35, 2.4, -0.7]].forEach((l) => {
          x.beginPath(); x.moveTo(fx(ex + sd * rx * l[0]), fy(ey + ry * l[1])); x.lineTo(fx(ex + sd * (rx * l[0] + l[2])), fy(ey + ry * l[1] + l[3])); x.stroke();
        });
      }
    });
    // brows
    if (!robot) {
      const tilt = expr === 'tired' || expr === 'sleepy' ? 0.35 : expr === 'effort' ? -0.3 : expr === 'joy' ? 0.05 : 0;
      const lift = expr === 'joy' || expr === 'happy' ? -1.6 : expr === 'sleepy' ? 0.8 : 0;
      [-1, 1].forEach((sd) => {
        const bx = sd * eyeX + lx * 0.6, by = -10.5 + lift;
        x.save();
        x.translate(fx(bx), fy(by));
        x.rotate(sd * tilt);
        x.beginPath();
        x.ellipse(0, 0, 4.4 * PX, 1.25 * PY, 0, PI * 1.05, PI * 1.95);
        x.lineWidth = o.style === 'human' ? 9 : 7; x.lineCap = 'round';
        x.strokeStyle = o.brow || line; x.stroke();
        x.restore();
      });
    }
    // nose hint (human)
    if (o.style === 'human') {
      x.fillStyle = 'rgba(190,110,90,0.35)';
      this.ell(0, 9, 1.8, 1.3); x.fill();
    }
    if (o.style === 'cat') {
      x.fillStyle = '#ff8fab';
      x.beginPath(); x.moveTo(fx(-2.4), fy(8)); x.lineTo(fx(2.4), fy(8)); x.lineTo(fx(0), fy(10.6)); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(60,36,49,0.7)'; x.lineWidth = 4; x.lineCap = 'round';
      [-1, 1].forEach((sd) => [[-1.5, 0.6], [1.5, 0.4]].forEach((w) => {
        x.beginPath(); x.moveTo(fx(sd * 9), fy(12 + w[0])); x.lineTo(fx(sd * 21), fy(11 + w[0] * 2.4 + w[1])); x.stroke();
      }));
    }
    // mouth
    if (o.mouth === false) return;
    const my = o.style === 'human' ? 16 : o.style === 'robot' ? 13 : 14.5;
    const open = Math.max(0, Math.min(1, s.open || 0));
    x.lineCap = 'round'; x.lineJoin = 'round';
    const fillMouth = (w, h) => {
      x.beginPath();
      x.moveTo(fx(-w), fy(my));
      x.quadraticCurveTo(fx(0), fy(my - h * 0.25), fx(w), fy(my));
      x.quadraticCurveTo(fx(w * 0.9), fy(my + h * 1.25), fx(0), fy(my + h * 1.2));
      x.quadraticCurveTo(fx(-w * 0.9), fy(my + h * 1.25), fx(-w), fy(my));
      x.closePath();
      x.fillStyle = robot ? o.glow : '#7a2e3e'; x.fill();
      if (!robot) {
        x.save(); x.clip();
        x.fillStyle = '#ff8a9b'; this.ell(0, my + h * 1.15, w * 0.7, h * 0.55); x.fill();
        x.restore();
        x.lineWidth = 6; x.strokeStyle = line; x.stroke();
      }
    };
    if (expr === 'yawn' || (expr === 'chew' && open > 0.15) || (expr === 'effort' && open > 0.2)) {
      const h = expr === 'yawn' ? 3 + 6 * open : 1.5 + 3.2 * open;
      const w = expr === 'yawn' ? 3.4 + 0.8 * open : 3.6;
      // round "o"
      x.beginPath(); x.ellipse(fx(0), fy(my + h * 0.5), w * PX, h * PY * 0.62, 0, 0, PI * 2);
      x.fillStyle = robot ? o.glow : '#7a2e3e'; x.fill();
      if (!robot) { x.lineWidth = 6; x.strokeStyle = line; x.stroke(); }
    } else if (expr === 'sip') {
      x.beginPath(); x.ellipse(fx(0), fy(my + 1), 1.8 * PX, 1.6 * PY, 0, 0, PI * 2);
      x.lineWidth = 7; x.strokeStyle = line; x.stroke();
    } else if (expr === 'joy' || expr === 'happy') {
      fillMouth(expr === 'joy' ? 6 : 4.6, expr === 'joy' ? 4.4 : 3.0);
    } else if (expr === 'tired' || expr === 'sleepy') {
      // small wobbly frown
      this.arc(0, my + 3.4, 3.6, 2.2, 1.15 * PI, 1.85 * PI, robot ? 12 : 7, line);
    } else if (o.style === 'bunny' || o.style === 'cat') {
      // ω
      this.arc(-2.2, my - 1.2, 2.2, 2.2, 0.05 * PI, 0.95 * PI, 6, line);
      this.arc(2.2, my - 1.2, 2.2, 2.2, 0.05 * PI, 0.95 * PI, 6, line);
    } else {
      this.arc(0, my - 2.4, 4.2, 3.2, 0.18 * PI, 0.82 * PI, robot ? 12 : 7, line);
    }
  }
}

/* a cap over the front of a sphere of radius r (child of the head mesh) carrying the painted face */
function faceCap(r, painter) {
  const L = FACE.phi * PI / 180, t0 = FACE.th0 * PI / 180, t1 = FACE.th1 * PI / 180;
  // SphereGeometry: phi 0 at -x, front (+z) at 3π/2 … pick the slice centred on +z
  const g = new SphereGeometry(r, 48, 32, PI * 1.5 - L / 2 - PI, L, t0, t1 - t0);
  const m = new MeshBasicMaterial({ map: painter.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
  const mesh = new Mesh(g, m);
  mesh.renderOrder = 2;
  return mesh;
}

/* Catmull-Rom through the profile points so the cel bands follow smooth curves, not polygon edges */
function smooth(pts, n) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  // a lathe profile must climb monotonically or it folds over itself
  for (let i = 1; i < out.length; i++) if (out[i][1] < out[i - 1][1]) out[i][1] = out[i - 1][1];
  return out;
}
function lathe(profile, seg) { return new LatheGeometry(smooth(profile, 6).map((p) => new Vector2(Math.max(0.0005, p[0]), p[1])), seg || 48); }

/* ---------- the figure ---------- */
export function buildChibi(p, look, colors, addProps) {
  const M = window.FitAvatarModel;
  const C = M.creatureShape(p);
  const R = p.recovery || {};
  const kind = look.kind && look.kind !== 'human' ? look.kind : 'human';
  const human = kind === 'human';
  const fig = new Group();
  const mats = [];
  const ramp = toonRamp();
  const LIT = 0.66; // the shared scene lights are tuned for PBR; keep toon pastels from blowing out
  function mat(hex, extra) {
    const m = new MeshToonMaterial(Object.assign({ color: new Color(hex).multiplyScalar(LIT), gradientMap: ramp }, extra || {}));
    mats.push(m);
    return m;
  }
  function add(parent, geo, m, x, y, z) {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    parent.add(mesh);
    return mesh;
  }
  const S = C.scale;
  const slump = R.slouch || 0;
  // body numbers: width follows the waist/softness, limbs follow arm/thigh (+ strength), height = scale
  const ref = M.creatureShape(M.bodyParams({ sex: p.sex, values: {} }));
  const widthK = Math.max(0.7, Math.min(1.7, C.bellyR / ref.bellyR));
  const chestK = Math.max(0.8, Math.min(1.5, C.bodyR / ref.bodyR));
  const armK = Math.max(0.7, Math.min(1.7, C.armR / ref.armR));
  const legK = Math.max(0.7, Math.min(1.7, C.legR / ref.legR));
  const soft = p.softness || 0;

  const skinHex = human ? look.skin : look.color;
  const base = new Color(skinHex);
  const bodyM = mat(human ? '#' + new Color(skinHex).offsetHSL(-0.012, 0.12, 0.02).getHexString() : pastel(skinHex, 0.06));
  const lightM = mat(base.clone().lerp(new Color('#fff6ea'), kind === 'bunny' ? 0.65 : 0.55).getHex());
  const darkM = mat('#2a1b28');
  const whiteM = mat('#fffaf5');
  const pinkM = mat('#ffaec4');
  const shirtHex = human ? (p.sex === 'f' ? '#ffb5cf' : '#8ec9ff') : null;
  const shirtM = human ? mat(shirtHex) : null;
  const shortsM = human ? mat(p.sex === 'f' ? '#8b7fd6' : '#5f78c8') : null;
  const shoeM = human ? mat('#fff3e6') : null;
  const soleM = human ? mat('#e36f8e') : null;
  const glowHex = colors.glow;
  const glowM = mat(glowHex, { emissive: new Color(glowHex), emissiveIntensity: 0.9 });

  const anim = { eyes: [], breath: [], ears: [], arms: {}, hips: {}, knees: {}, head: null, upper: null, baseEye: R.eyeOpen, creature: true, chibi: true, S: S, unit: S, headR: 0 };

  // proportions (metres before the height scale): human villager ≈ 0.82 m at 1.75 m
  const hr = (human ? 0.175 : C.headR / S * 1.02) * S;
  const legH = (human ? 0.15 : C.legLen / S) * S;
  const legR = (human ? 0.042 : C.legR / S * 0.95) * S * (human ? legK : 1);
  const bw = (human ? 0.105 * widthK : Math.max(C.bellyR, C.bodyR * 0.85) / S) * S;
  const bodyH = (human ? 0.27 : C.bodyR / S * 1.25 * 1.6) * S;
  const armR = (human ? 0.034 * armK : C.armR / S) * S;
  const armLen = (human ? 0.17 : C.armLen / S) * S;
  anim.headR = hr;

  // ---- legs + feet
  const legX = human ? bw * 0.46 : C.bellyR * 0.5;
  [-1, 1].forEach((sd) => {
    const hip = new Group(); hip.position.set(sd * legX, legH, 0); fig.add(hip);
    add(hip, new CapsuleGeometry(legR, legH * 0.55, 6, 16), human ? bodyM : bodyM, 0, -legH * 0.48, 0);
    if (human) {
      // shorts cuff over the thigh
      add(hip, new CylinderGeometry(legR * 1.45, legR * 1.6, legH * 0.42, 22), shortsM, 0, -legH * 0.12, 0);
      const shoe = add(hip, new SphereGeometry(legR * 1.5, 22, 14), shoeM, 0, -legH + legR * 0.7, legR * 0.5);
      shoe.scale.set(1, 0.72, 1.45);
      const sole = add(hip, new CylinderGeometry(legR * 1.5, legR * 1.5, legR * 0.32, 22), soleM, 0, -legH + legR * 0.16, legR * 0.5);
      sole.scale.set(1, 1, 1.45);
    } else {
      const foot = add(hip, new SphereGeometry(legR * 1.2, 18, 12), kind === 'robot' ? darkM : lightM, 0, legR * 0.6 - legH, legR * 0.45);
      foot.scale.set(1, 0.62, 1.35);
    }
    anim.hips[sd] = hip;
  });

  // ---- body (pivots from the hips for leaning)
  const upper = new Group();
  upper.position.set(0, legH, 0);
  upper.rotation.x = 0.18 * slump;
  fig.add(upper);
  anim.upper = upper; anim.upperBase = upper.rotation.x;
  let shoulderY, shoulderX, neckY;
  if (human) {
    const belly = 1 + 0.35 * soft;
    const top = bw * 0.78 * chestK;
    // pear: rounded seat → belly → chest → narrow neck
    const prof = [[0, -0.02 * S], [bw * 0.7, -0.012 * S], [bw * 0.95, 0.02 * S], [bw * belly, bodyH * 0.32], [bw * (0.92 + 0.12 * soft), bodyH * 0.55], [top, bodyH * 0.8], [top * 0.72, bodyH * 0.96], [bw * 0.3, bodyH * 1.02], [0.0005, bodyH * 1.03]];
    // shorts: the rounded seat; the shirt hangs over it from h0 up
    const h0 = bodyH * 0.17, h1 = bodyH * 0.24;
    const rAt = (h) => { for (let i = 1; i < prof.length; i++) if (prof[i][1] >= h) { const a = prof[i - 1], b = prof[i]; return a[0] + (b[0] - a[0]) * (h - a[1]) / (b[1] - a[1]); } return prof[prof.length - 1][0]; };
    const torsoShorts = add(upper, lathe([prof[0], prof[1], prof[2], [rAt(h1), h1], [rAt(h1) * 0.8, h1 + 0.001], [0.0005, h1 + 0.002]]), shortsM, 0, 0, 0);
    torsoShorts.scale.set(1.0, 1, 0.92);
    const shirtProf = [[0.0005, h0], [rAt(h0) * 1.035, h0], [rAt(h0 + bodyH * 0.05) * 1.035, h0 + bodyH * 0.05]].concat(prof.slice(3).map((q) => [q[0] * 1.02, q[1]]));
    const shirt = add(upper, lathe(shirtProf), shirtM, 0, 0, 0);
    shirt.scale.set(1, 1, 0.92);
    anim.breath.push(shirt);
    // belly bulge for a softer body
    if (soft > 0.05) {
      const b = add(upper, new SphereGeometry(bw * 0.66, 32, 24), shirtM, 0, bodyH * 0.42, bw * 0.3 * (0.5 + soft));
      b.scale.set(1.0, 0.9 + 0.15 * soft, 0.5 + 0.35 * soft);
      anim.breath.push(b);
    }
    // collar
    const collar = add(upper, new TorusGeometry(bw * 0.34, bw * 0.07, 10, 28), whiteM, 0, bodyH * 0.985, 0);
    collar.rotation.x = PI / 2; collar.scale.set(1, 0.92, 1);
    shoulderY = bodyH * 0.84; shoulderX = top * 1.02; neckY = bodyH * 1.0;
  } else {
    const bwc = Math.max(C.bellyR, C.bodyR * 0.85);
    const bh = C.bodyR * 1.25;
    const torso = kind === 'robot'
      ? add(upper, new CylinderGeometry(bwc * 0.92, bwc, bh * 1.6, 32), bodyM, 0, bh * 0.8, 0)
      : add(upper, new SphereGeometry(1, 36, 24), bodyM, 0, bh * 0.85, 0);
    if (kind !== 'robot') torso.scale.set(bwc, bh, bwc * 0.92);
    anim.breath.push(torso);
    if (kind === 'robot') {
      add(upper, new BoxGeometry(bwc * 0.9, bh * 0.6, 0.01), darkM, 0, bh * 0.85, bwc * 0.99);
      const heart = add(upper, new SphereGeometry(bwc * 0.12, 16, 12), glowM, 0, bh * 0.85, bwc * 1.0);
      heart.scale.set(1, 1, 0.4);
      anim.glowMesh = heart;
    } else {
      const tummy = add(upper, new SphereGeometry(1, 28, 18), lightM, 0, bh * 0.78, bwc * 0.38);
      tummy.scale.set(bwc * 0.72, bh * 0.72, bwc * 0.62);
      anim.breath.push(tummy);
    }
    shoulderY = bh * 1.25; shoulderX = bwc * 0.9; neckY = bh * 1.55;
  }

  // ---- arms: stubby, a mitten hand
  [-1, 1].forEach((sd) => {
    const arm = new Group();
    arm.position.set(sd * shoulderX, shoulderY, 0);
    const girth = human ? Math.max(0, widthK * (1 + 0.35 * soft) / chestK - 1) : 0; // hands clear a round belly
    arm.rotation.z = sd * ((human ? 0.32 + 0.55 * girth : 0.55) - 0.3 * slump + 0.22 * (R.bounce || 0));
    arm.rotation.x = -0.12 * slump;
    upper.add(arm);
    if (human) {
      const sleeve = add(arm, new SphereGeometry(armR * 1.75, 20, 14), shirtM, 0, -armR * 0.4, 0);
      sleeve.scale.set(1, 1.15, 1);
      add(arm, new CapsuleGeometry(armR, armLen * 0.62, 6, 14), bodyM, 0, -armLen * 0.5, 0);
      const hand = add(arm, new SphereGeometry(armR * 1.42, 18, 14), bodyM, 0, -armLen * 0.95, 0);
      hand.scale.set(0.95, 1.05, 0.9);
    } else {
      add(arm, new CapsuleGeometry(armR, armLen * 0.7, 6, 14), bodyM, 0, -armLen * 0.5, 0);
      add(arm, new SphereGeometry(armR * 1.12, 14, 12), kind === 'robot' ? darkM : lightM, 0, -armLen * 0.95, 0);
    }
    anim.arms[sd] = { g: arm, handY: -armLen * 0.95, len: armLen };
  });

  // ---- head
  const head = new Group();
  head.position.set(0, neckY + hr * (human ? 0.86 : 0.75), 0);
  head.rotation.x = 0.22 * slump;
  upper.add(head);
  anim.head = head; anim.headBase = head.rotation.x;
  const sk = human ? [1.06, 0.96, 0.98] : [1.08, 0.95, 0.95];
  const skull = kind === 'robot'
    ? add(head, new BoxGeometry(hr * 2, hr * 1.7, hr * 1.7), bodyM)
    : add(head, new SphereGeometry(hr, 48, 32), bodyM);
  if (kind !== 'robot') skull.scale.set(sk[0], sk[1], sk[2]);
  const hairHex = look.hairColor || '#5a3a26';
  const painter = new FacePainter({
    style: kind, sex: p.sex, skin: human ? look.skin : pastel(skinHex, 0.06), lid: human ? new Color(look.skin).multiplyScalar(0.93).getStyle() : null,
    line: '#3b2431', brow: human ? new Color(hairHex).multiplyScalar(0.8).getStyle() : null,
    beard: human && p.sex !== 'f' ? look.beard : 'none', beardColor: hairHex,
    mouth: !(kind === 'bear' || kind === 'dragon'), glow: new Color(glowHex).getStyle(),
    iris: human ? 'rgba(130,95,70,0.9)' : 'rgba(120,90,170,0.85)'
  });
  anim.face = painter;
  if (kind === 'robot') {
    add(head, new BoxGeometry(hr * 1.6, hr * 1.0, hr * 0.04), darkM, 0, hr * 0.02, hr * 0.86);
    const screen = add(head, new PlaneGeometry(hr * 1.55, hr * 0.95), new MeshBasicMaterial({ map: painter.tex, transparent: true, toneMapped: false }), 0, hr * 0.02, hr * 0.9);
    // the painter's canvas is a sphere layout: on the flat screen show the eye/mouth band only
    painter.tex.repeat.set(0.5, 0.5); painter.tex.offset.set(0.25, 0.2);
    screen.renderOrder = 2;
  } else {
    const cap = faceCap(hr * 1.004, painter);
    skull.add(cap);
    cap.scale.set(1, 1, 1);
  }
  anim.faceZ = hr * 0.95; anim.eyeY = 0; anim.eyeX = hr * 0.34; anim.mouthY = -hr * 0.38; anim.mouthZ = hr * 0.98;

  if (human) {
    // ears
    [-1, 1].forEach((sd) => {
      const e = add(head, new SphereGeometry(hr * 0.17, 16, 12), bodyM, sd * hr * 1.03, -hr * 0.05, -hr * 0.02);
      e.scale.set(0.55, 1, 0.8);
    });
    buildHair(head, hr, look.hair || (p.sex === 'f' ? 'long' : 'short'), mat(hairHex), add, sk);
  }
  if (kind === 'bear' || kind === 'dragon') {
    const muzzle = add(head, new SphereGeometry(hr * 0.4, 24, 16), lightM, 0, -hr * 0.3, hr * 0.74);
    muzzle.scale.set(kind === 'dragon' ? 1.25 : 1.1, 0.78, 0.8);
    const nose = add(head, new SphereGeometry(hr * 0.1, 14, 10), darkM, 0, -hr * 0.17, hr * 1.06);
    nose.scale.set(1.3, 0.85, 0.8);
    // 3D mouth on the muzzle: a smile arc + an "o" for chewing
    const mouth = add(head, new TorusGeometry(hr * 0.12, hr * 0.022, 6, 18, 1.8), darkM, 0, -hr * 0.37, hr * 1.0);
    mouth.rotation.z = -PI / 2 - 0.9;
    anim.mouth = mouth;
    const mo = add(head, new SphereGeometry(hr * 0.1, 14, 10), mat('#7a2e3e'), 0, -hr * 0.4, hr * 0.98);
    mo.scale.set(1, 0.85, 0.5);
    anim.mouthO = mo;
  }
  if (kind === 'bunny') {
    const nose = add(head, new SphereGeometry(hr * 0.065, 12, 8), pinkM, 0, -hr * 0.17, hr * 0.96);
    nose.scale.set(1.35, 0.9, 0.8);
  }
  anim.seatDrop = legH * 0.75;
  anim.seat = { y: legH * 0.12, r: (human ? bw * 1.55 : Math.max(C.bellyR, C.bodyR * 0.85) * 1.25), z: -(human ? bw : C.bellyR) * 0.45 };

  // ---- kind extras (springy ears / horns / wings / antenna / tails)
  const perk = 1 - (R.earDroop || 0);
  const bwk = human ? bw : Math.max(C.bellyR, C.bodyR * 0.85);
  const bhk = human ? bodyH : C.bodyR * 1.25;
  if (kind === 'bunny') {
    [-1, 1].forEach((sd) => {
      const ear = new Group();
      ear.position.set(sd * hr * 0.36, hr * 0.8, -hr * 0.05);
      head.add(ear);
      const outer = add(ear, new CapsuleGeometry(hr * 0.19, hr * 1.0, 8, 16), bodyM, 0, hr * 0.62, 0);
      outer.scale.set(1, 1, 0.55);
      const inner = add(ear, new CapsuleGeometry(hr * 0.1, hr * 0.8, 6, 12), pinkM, 0, hr * 0.62, hr * 0.075);
      inner.scale.set(1, 1, 0.4);
      ear.userData.base = { z: sd * (0.14 + 0.9 * (1 - perk)), x: -0.1 + 0.55 * (1 - perk) };
      ear.rotation.z = ear.userData.base.z; ear.rotation.x = ear.userData.base.x;
      ear.userData.side = sd;
      anim.ears.push(ear);
    });
    add(upper, new SphereGeometry(bwk * 0.3, 16, 12), whiteM, 0, bhk * 0.5, -bwk * 0.95);
  } else if (kind === 'cat') {
    [-1, 1].forEach((sd) => {
      const ear = new Group();
      ear.position.set(sd * hr * 0.55, hr * 0.72, -hr * 0.02);
      head.add(ear);
      const o = add(ear, new ConeGeometry(hr * 0.3, hr * 0.5, 4, 1), bodyM, 0, hr * 0.18, 0);
      o.rotation.y = PI / 4; o.scale.set(1, 1, 0.55);
      const i = add(ear, new ConeGeometry(hr * 0.18, hr * 0.32, 4, 1), pinkM, 0, hr * 0.14, hr * 0.06);
      i.rotation.y = PI / 4; i.scale.set(1, 1, 0.35);
      ear.userData.base = { z: sd * (-0.28 - 0.5 * (1 - perk)), x: 0.25 * (1 - perk) };
      ear.rotation.z = ear.userData.base.z; ear.rotation.x = ear.userData.base.x;
      ear.userData.side = sd;
      anim.ears.push(ear);
    });
    const tail = new Group();
    tail.position.set(0, bhk * 0.3, -bwk * 0.85);
    upper.add(tail);
    anim.tail = tail;
    const t1 = add(tail, new CapsuleGeometry(bwk * 0.1, bwk * 0.9, 6, 12), bodyM, 0, bwk * 0.45, -bwk * 0.15);
    t1.rotation.x = -0.45;
    add(tail, new SphereGeometry(bwk * 0.13, 12, 10), lightM, 0, bwk * 0.95, -bwk * 0.38);
  } else if (kind === 'bear') {
    [-1, 1].forEach((sd) => {
      const ear = new Group();
      ear.position.set(sd * hr * 0.68, hr * 0.68, -hr * 0.05);
      head.add(ear);
      add(ear, new SphereGeometry(hr * 0.28, 18, 14), bodyM).scale.set(1, 1, 0.6);
      add(ear, new SphereGeometry(hr * 0.16, 14, 10), lightM, 0, 0, hr * 0.08).scale.set(1, 1, 0.4);
      ear.userData.base = { z: sd * -0.5 * (1 - perk), x: 0.4 * (1 - perk) };
      ear.rotation.z = ear.userData.base.z; ear.rotation.x = ear.userData.base.x;
      ear.userData.side = sd;
      anim.ears.push(ear);
    });
    add(upper, new SphereGeometry(bwk * 0.2, 14, 10), bodyM, 0, bhk * 0.35, -bwk * 0.92);
  } else if (kind === 'dragon') {
    [-1, 1].forEach((sd) => {
      const horn = new Group();
      horn.position.set(sd * hr * 0.42, hr * 0.78, -hr * 0.1);
      head.add(horn);
      add(horn, new ConeGeometry(hr * 0.12, hr * 0.42, 12), lightM, 0, hr * 0.18, 0);
      horn.userData.base = { z: sd * (-0.25 - 0.5 * (1 - perk)), x: -0.2 + 0.5 * (1 - perk) };
      horn.rotation.z = horn.userData.base.z; horn.rotation.x = horn.userData.base.x;
      horn.userData.side = sd;
      anim.ears.push(horn);
      const wing = new Group();
      wing.position.set(sd * bwk * 0.45, bhk * 1.2, -bwk * 0.75);
      upper.add(wing);
      const wm = add(wing, new SphereGeometry(bwk * 0.5, 18, 12), lightM, sd * bwk * 0.35, 0, 0);
      wm.scale.set(1, 0.7, 0.12);
      wing.rotation.z = sd * (0.35 - 0.5 * slump);
      wing.rotation.y = sd * 0.5;
      wing.userData.side = sd; wing.userData.base = { z: wing.rotation.z, x: 0 };
      wing.userData.wing = true;
      anim.ears.push(wing);
    });
    const tail = new Group();
    tail.position.set(0, bhk * 0.35, -bwk * 0.8);
    upper.add(tail);
    anim.tail = tail;
    const t1 = add(tail, new ConeGeometry(bwk * 0.32, bwk * 1.3, 16), bodyM, 0, 0, -bwk * 0.5);
    t1.rotation.x = -PI / 2 - 0.25 + 0.35 * slump;
    for (let i = 0; i < 4; i++) {
      const sp = add(upper, new ConeGeometry(hr * 0.09, hr * 0.2, 8), lightM, 0, bhk * (0.6 + i * 0.32), -bwk * (0.98 - i * 0.05));
      sp.rotation.x = -0.5;
    }
  } else if (kind === 'robot') {
    const ant = new Group();
    ant.position.set(0, hr * 0.85, 0);
    head.add(ant);
    add(ant, new CylinderGeometry(hr * 0.03, hr * 0.03, hr * 0.5, 8), darkM, 0, hr * 0.25, 0);
    const bulb = add(ant, new SphereGeometry(hr * 0.12, 16, 12), mat(glowHex, { emissive: new Color(glowHex), emissiveIntensity: 0.9 }), 0, hr * 0.52, 0);
    anim.bulb = bulb;
    ant.userData.base = { z: 0, x: 0.9 * (1 - perk) };
    ant.rotation.x = ant.userData.base.x;
    ant.userData.side = 1;
    anim.ears.push(ant);
    [-1, 1].forEach((sd) => {
      const earC = add(head, new CylinderGeometry(hr * 0.2, hr * 0.2, hr * 0.14, 18), darkM, sd * hr * 1.05, 0, 0);
      earC.rotation.z = PI / 2;
    });
  }
  if (addProps) addProps(anim, { head: head, headR: hr, kind: kind, skin: skinHex, mat: (h, e) => mat(h, e && { emissive: e.emissive, emissiveIntensity: e.emissiveIntensity, transparent: e.transparent, opacity: e.opacity }), add: add, upper: upper, fig: fig, glow: glowHex });
  fig.userData.mats = mats;
  fig.userData.anim = anim;
  return fig;
}

/* hairstyles: smooth caps with a swoopy fringe; curly = puffs, long = a back sheet, bun = a knot */
function buildHair(head, hr, style, hm, add, sk) {
  if (style === 'bald') return;
  const g = new Group();
  head.add(g);
  g.scale.set(sk[0], sk[1], sk[2]);
  const thick = style === 'buzz' ? 1.03 : 1.075;
  // cap: the upper part of a slightly bigger sphere, tipped back so the forehead shows
  const cap = add(g, new SphereGeometry(hr * thick, 48, 24, 0, PI * 2, 0, PI * (style === 'long' ? 0.56 : 0.5)), hm, 0, 0, 0);
  cap.rotation.x = -0.42;
  if (style === 'buzz') return;
  // fringe: a few overlapping flattened blobs sweeping to one side
  const fr = [[-0.42, 0.52, 0.2, 0.36], [-0.12, 0.6, 0.2, 0.38], [0.2, 0.56, 0.15, 0.33], [0.48, 0.42, 0.05, 0.28]];
  fr.forEach((f) => {
    const b = add(g, new SphereGeometry(hr * f[3], 20, 14), hm, hr * f[0], hr * f[1], hr * 0.72);
    b.scale.set(1.25, 0.62, 0.62);
    b.rotation.z = f[2];
  });
  // sideburn tufts
  [-1, 1].forEach((sd) => {
    const t = add(g, new SphereGeometry(hr * 0.2, 16, 12), hm, sd * hr * 0.9, hr * 0.2, hr * 0.2);
    t.scale.set(0.5, 1.05, 0.7);
  });
  if (style === 'curly') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      const b = add(g, new SphereGeometry(hr * 0.26, 16, 12), hm, Math.cos(a) * hr * 0.78, hr * (0.55 + 0.18 * Math.sin(a * 3)), Math.sin(a) * hr * 0.7 - hr * 0.1);
      b.scale.set(1, 0.85, 1);
    }
    add(g, new SphereGeometry(hr * 0.42, 20, 14), hm, 0, hr * 0.85, -hr * 0.1).scale.set(1.3, 0.7, 1.2);
  } else if (style === 'long') {
    const back = add(g, new SphereGeometry(hr * 0.98, 32, 20), hm, 0, -hr * 0.25, -hr * 0.28);
    back.scale.set(1.05, 1.15, 0.72);
    [-1, 1].forEach((sd) => {
      const lock = add(g, new CapsuleGeometry(hr * 0.2, hr * 0.7, 6, 12), hm, sd * hr * 0.88, -hr * 0.42, hr * 0.12);
      lock.scale.set(0.8, 1, 0.7);
      lock.rotation.z = sd * 0.08;
    });
  } else if (style === 'bun') {
    add(g, new SphereGeometry(hr * 0.36, 22, 16), hm, 0, hr * 0.98, -hr * 0.42);
    const band = add(g, new TorusGeometry(hr * 0.22, hr * 0.06, 8, 20), hm, 0, hr * 0.8, -hr * 0.32);
    band.rotation.x = 0.9;
  }
}
