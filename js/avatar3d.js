/* פיט — 3D avatar renderer (ES module, lazy-loaded only when the avatar view opens).
   A stylized parametric body: every part is a "loft" — elliptical rings stacked along an axis and
   smoothed with Catmull-Rom — so chest/waist/hips/arm/thigh numbers map straight onto ring sizes.
   No external models, no paid assets. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, Float32BufferAttribute,
  SphereGeometry, CylinderGeometry, TorusGeometry, CircleGeometry, IcosahedronGeometry, CapsuleGeometry, BoxGeometry, ConeGeometry,
  MeshStandardMaterial, MeshBasicMaterial, HemisphereLight, DirectionalLight, AmbientLight,
  Color, CanvasTexture, SRGBColorSpace, Vector3, MathUtils, Box3
} from './vendor/three-avatar.js';
import { buildChibi } from './avatar-chibi.js';

const TAU = Math.PI * 2;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/* rings: [{y, w, d, x?, z?, bend?}] along +y. Returns a closed, smooth BufferGeometry. */
function loft(rings, opts) {
  const seg = (opts && opts.seg) || 22;
  const sub = (opts && opts.sub) || 4;
  const pivotY = opts && opts.pivotY != null ? opts.pivotY : 0;
  const keys = ['y', 'w', 'd', 'x', 'z', 'bend'];
  const dense = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const p0 = rings[Math.max(0, i - 1)], p1 = rings[i], p2 = rings[i + 1], p3 = rings[Math.min(rings.length - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const r = {};
      keys.forEach((k) => { r[k] = catmull(p0[k] || 0, p1[k] || 0, p2[k] || 0, p3[k] || 0, t); });
      dense.push(r);
    }
  }
  const last = rings[rings.length - 1];
  dense.push({ y: last.y, w: last.w, d: last.d, x: last.x || 0, z: last.z || 0, bend: last.bend || 0 });
  const pos = [];
  const idx = [];
  dense.forEach((r) => {
    const cb = Math.cos(r.bend), sb = Math.sin(r.bend);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      const px = r.x + Math.sin(a) * Math.max(0.001, r.w);
      let py = r.y;
      let pz = r.z + Math.cos(a) * Math.max(0.001, r.d);
      // forward bend around the pivot (slouch): rotate about x
      if (r.bend) {
        const dy = py - pivotY;
        const ny = dy * cb - pz * sb;
        const nz = dy * sb + pz * cb;
        py = pivotY + ny; pz = nz;
      }
      pos.push(px, py, pz);
    }
  });
  const n = dense.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  // caps
  function cap(ringIndex, up) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < seg; j++) { const k = (ringIndex * seg + j) * 3; cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2]; }
    const center = pos.length / 3;
    pos.push(cx / seg, cy / seg + (up ? 0.002 : -0.002), cz / seg);
    for (let j = 0; j < seg; j++) {
      const a = ringIndex * seg + j, b = ringIndex * seg + ((j + 1) % seg);
      if (up) idx.push(b, a, center); else idx.push(a, b, center);
    }
  }
  cap(0, false);
  cap(n - 1, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) { return fallback; }
}

function haloTexture(hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const col = new Color(hex);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, `rgba(${rgb},0.55)`);
  g.addColorStop(0.55, `rgba(${rgb},0.18)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/* Builds the whole figure. p = FitAvatarModel.bodyParams(), look = {skin, hair, hairColor, beard} hex/ids. */
function buildHuman(p, look, colors) {
  const H = p.height;
  const s = H / 1.75;
  const T = p.torso, L = p.limbs, R = p.recovery;
  const fig = new Group();
  const mats = [];
  function mat(hex, extra) {
    const m = new MeshStandardMaterial(Object.assign({ color: new Color(hex), roughness: 0.62, metalness: 0.02 }, extra || {}));
    mats.push(m);
    return m;
  }
  const skin = mat(look.skin, { roughness: 0.55 + 0.15 * p.softness });
  const skinShade = mat(new Color(look.skin).multiplyScalar(0.95).getHex(), { roughness: 0.5 });
  const cloth = mat(colors.cloth, { roughness: 0.8 });
  const hairM = mat(look.hairColor, { roughness: 0.85 });
  const dark = mat('#1a1020', { roughness: 0.4 });
  function add(parent, geo, m, x, y, z) {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    parent.add(mesh);
    return mesh;
  }

  const waistY = 0.6 * H;
  const slouch = R.slouch || 0;
  const bendMax = 0.2 * slouch; // radians at the shoulders
  const upperT = (y) => MathUtils.clamp((y - waistY) / (0.84 * H - waistY), 0, 1);
  const f = p.sex === 'f';
  // ---- torso (crotch → neck base)
  const ring = (y, w, d, z) => ({ y, w, d, z: z || 0, bend: bendMax * upperT(y) });
  const neckW = 0.055 * s * (f ? 0.9 : 1.05);
  const torsoRings = [
    ring(0.47 * H, T.hipsW * 0.86, T.hipsD * 0.86),
    ring(0.52 * H, T.hipsW, T.hipsD),
    ring(0.565 * H, (T.hipsW + T.waistW) / 2, (T.hipsD + T.waistD) / 2, T.belly * 0.5),
    ring(waistY, T.waistW, T.waistD, T.belly),
    ring(0.66 * H, (T.waistW * 0.45 + T.chestW * 0.55), (T.waistD * 0.5 + T.chestD * 0.5), T.belly * 0.45),
    ring(0.72 * H, T.chestW, T.chestD, 0.005),
    ring(0.77 * H, T.chestW * 0.99, T.chestD * 0.92),
    ring(0.805 * H, T.shoulderW * 0.86, T.chestD * 0.74),
    ring(0.83 * H, T.shoulderW * 0.5, T.chestD * 0.5),
    ring(0.845 * H, neckW * 1.4, neckW * 1.2)
  ];
  const anim = { eyes: [], breath: [], ears: [], arms: {}, hips: {}, knees: {}, head: null, upper: null, baseEye: 1, S: s, unit: H, headR: 0.066 * H };
  anim.breath.push(add(fig, loft(torsoRings, { pivotY: waistY, seg: 26 }), skin));
  // shorts (lower torso + thigh tops, slightly bigger)
  add(fig, loft(torsoRings.slice(0, 3).map((r) => Object.assign({}, r, { w: r.w * 1.035, d: r.d * 1.035 })).concat([
    Object.assign({}, torsoRings[3], { w: torsoRings[3].w * 1.03, d: torsoRings[3].d * 1.03 })
  ]), { pivotY: waistY, seg: 26 }), cloth).position.y = -0.0005;
  if (f) {
    add(fig, loft(torsoRings.slice(5, 8).map((r) => Object.assign({}, r, { w: r.w * 1.03, d: r.d * 1.05 })), { pivotY: waistY, seg: 26 }), cloth);
  }

  // upper-body pivot so head and arms follow the slouch
  const upper = new Group();
  upper.position.set(0, waistY, 0);
  upper.rotation.x = bendMax;
  anim.upper = upper; anim.upperBase = bendMax;
  fig.add(upper);
  const U = (y) => y - waistY; // y in upper-local space

  // muscle definition: pecs, abs, delts
  const def = p.definition;
  const pecR = T.chestW * (0.5 + 0.06 * p.muscle.chest);
  if (!f) {
    [-1, 1].forEach((sd) => {
      const pec = add(upper, new SphereGeometry(pecR, 20, 14), skin, sd * T.chestW * 0.4, U(0.748 * H), T.chestD * 0.66);
      pec.scale.set(1.0, 0.4, 0.34 + 0.1 * def + 0.14 * p.muscle.chest);
      pec.rotation.z = sd * 0.12;
    });
  }
  if (def > 0.62 && T.belly < 0.012) {
    const absA = MathUtils.clamp((def - 0.62) / 0.3, 0, 1);
    for (let row = 0; row < 3; row++) {
      [-1, 1].forEach((sd) => {
        const a = add(fig, new SphereGeometry(0.02 * s, 12, 8), skinShade, sd * 0.023 * s, (0.635 - row * 0.032) * H, T.waistD * 0.93 + T.belly);
        a.scale.set(1, 0.75, 0.25 + 0.35 * absA + 0.15 * p.muscle.core);
      });
    }
  }

  // neck + head
  const neck = add(upper, new CylinderGeometry(neckW, neckW * 1.12, 0.07 * H, 16), skin, 0, U(0.86 * H), -0.005);
  const head = new Group();
  const headR = 0.066 * H;
  head.position.set(0, U(0.912 * H), 0.004);
  head.rotation.x = 0.12 * slouch; // chin drops when tired
  anim.head = head; anim.headBase = head.rotation.x;
  upper.add(head);
  const skull = add(head, new SphereGeometry(headR, 28, 20), skin);
  skull.scale.set(0.88, 1.06, 0.95);
  const jaw = add(head, new SphereGeometry(headR * 0.78, 20, 14), skin, 0, -headR * 0.42, headR * 0.06);
  jaw.scale.set(f ? 0.86 : 0.98, 0.8, 0.92);
  [-1, 1].forEach((sd) => add(head, new SphereGeometry(headR * 0.2, 10, 8), skin, sd * headR * 0.86, -headR * 0.05, 0).scale.set(0.5, 1, 0.8));
  const nose = add(head, new SphereGeometry(headR * 0.14, 10, 8), skin, 0, -headR * 0.12, headR * 0.93);
  nose.scale.set(0.8, 1.1, 0.9);
  // eyes + lids (mood)
  const lid = R.mood === 'tired' ? 0.45 : R.mood === 'happy' ? 0.85 : 0.7;
  [-1, 1].forEach((sd) => {
    const e = add(head, new SphereGeometry(headR * 0.1, 12, 10), dark, sd * headR * 0.33, headR * 0.12, headR * 0.86);
    e.scale.set(1, lid, 0.6);
    anim.eyes.push(e); anim.baseEye = lid;
    const brow = add(head, new CapsuleGeometry(headR * 0.03, headR * 0.2, 4, 8), hairM, sd * headR * 0.34, headR * (0.3 + (R.mood === 'happy' ? 0.03 : 0)), headR * 0.88);
    brow.rotation.z = Math.PI / 2 + sd * (R.mood === 'tired' ? -0.25 : 0.08);
  });
  // mouth: smile / flat / slight frown
  const mouthArc = R.mood === 'happy' ? 1.6 : R.mood === 'tired' ? 0.9 : 0.6;
  const mouth = add(head, new TorusGeometry(headR * 0.22, headR * 0.028, 6, 16, mouthArc), mat('#8a3b4a', { roughness: 0.5 }), 0, -headR * (R.mood === 'tired' ? 0.5 : 0.36), headR * 0.86);
  mouth.rotation.z = R.mood === 'tired' ? Math.PI / 2 - mouthArc / 2 : -Math.PI / 2 - mouthArc / 2;
  if (R.mood === 'tired') mouth.position.y -= headR * 0.1;
  anim.mouth = mouth;
  const mo = add(head, new SphereGeometry(headR * 0.13, 12, 10), mat('#4a1a26', { roughness: 0.5 }), 0, -headR * 0.42, headR * 0.84);
  mo.scale.set(1, 0.8, 0.5);
  anim.mouthO = mo;
  anim.faceZ = headR * 0.86; anim.mouthY = -headR * 0.42; anim.eyeY = headR * 0.12; anim.eyeX = headR * 0.33;

  // hair
  const hr = headR * 1.04;
  const cap = (r, theta) => {
    const g = new SphereGeometry(r, 28, 14, 0, TAU, 0, theta);
    const m = add(head, g, hairM, 0, headR * 0.06, -headR * 0.04);
    m.scale.set(0.9, 1.04, 0.98);
    m.rotation.x = -0.42;
    return m;
  };
  if (look.hair === 'short') cap(hr * 1.04, Math.PI * 0.52);
  else if (look.hair === 'buzz') cap(hr * 1.0, Math.PI * 0.5);
  else if (look.hair === 'curly') {
    cap(hr * 1.05, Math.PI * 0.55);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, up = 0.55 + 0.35 * ((i * 7) % 5) / 5;
      const c = add(head, new IcosahedronGeometry(headR * 0.24, 0), hairM, Math.sin(a) * headR * 0.75 * (1 - up * 0.4), headR * (0.35 + up * 0.55), Math.cos(a) * headR * 0.7 * (1 - up * 0.4) - headR * 0.1);
      c.rotation.set(i, i * 2, 0);
    }
  } else if (look.hair === 'long' || look.hair === 'bun') {
    cap(hr * 1.06, Math.PI * 0.56);
    if (look.hair === 'long') {
      const back = add(head, new CylinderGeometry(headR * 0.92, headR * 1.0, headR * 1.9, 24, 1, true, Math.PI * 0.55, Math.PI * 0.9), hairM, 0, -headR * 0.55, -headR * 0.08);
      hairM.side = 2; // DoubleSide so the inside of the hair shell is visible
    } else {
      add(head, new SphereGeometry(headR * 0.36, 16, 12), hairM, 0, headR * 0.72, -headR * 0.75);
    }
  }
  // beard
  if (!f && look.beard !== 'none') {
    const full = look.beard === 'full', stub = look.beard === 'stubble';
    const br = full ? 1.07 : look.beard === 'short' ? 1.035 : 1.012;
    const bm = stub ? mat(new Color(look.skin).lerp(new Color(look.hairColor), 0.4).getHex(), { roughness: 0.95 }) : hairM;
    // jaw wrap from the sideburns down under the chin, leaving the mouth free
    const g = new SphereGeometry(headR * 0.78 * br, 24, 12, Math.PI * 0.02, Math.PI * 0.96, Math.PI * (full ? 0.5 : 0.56), Math.PI * 0.44);
    const b = add(head, g, bm, 0, -headR * 0.42, headR * 0.06);
    b.scale.set(0.99, full ? 1.0 : 0.88, 0.94);
    if (!stub) {
      const mo = add(head, new CapsuleGeometry(headR * 0.045, headR * 0.3, 4, 8), bm, 0, -headR * 0.27, headR * 0.86);
      mo.rotation.z = Math.PI / 2;
    }
  }

  // arms
  const shoulderY = 0.805 * H;
  [-1, 1].forEach((sd) => {
    const arm = new Group();
    arm.position.set(sd * T.shoulderW * 0.9, U(shoulderY), -0.005);
    arm.rotation.z = sd * (0.2 + 0.04 * p.softness);
    arm.rotation.x = -0.06 - 0.12 * slouch; // shoulders roll forward when tired
    upper.add(arm);
    const delt = add(arm, new SphereGeometry(L.deltR * 1.1, 18, 14), skin, 0, -0.005, 0);
    delt.scale.set(1, 1.05 + 0.1 * p.muscle.shoulders, 1);
    const ua = 0.185 * H, fa = 0.16 * H;
    const rU = L.upperArmR, rF = L.forearmR;
    const bic = 1 + 0.1 * p.muscle.arms + 0.05 * def;
    add(arm, loft([
      { y: -0.0, w: rU * 1.0, d: rU * 1.0 },
      { y: -ua * 0.35, w: rU * 1.0, d: rU * bic },
      { y: -ua * 0.75, w: rU * 0.88, d: rU * 0.92 },
      { y: -ua, w: rF * 0.9, d: rF * 0.9 },
      { y: -ua - fa * 0.3, w: rF * 1.05, d: rF },
      { y: -ua - fa, w: rF * 0.6, d: rF * 0.5 }
    ].reverse(), { seg: 16 }), skin);
    const hand = add(arm, new SphereGeometry(rF * 0.95, 14, 10), skin, 0, -ua - fa - rF * 0.7, 0);
    hand.scale.set(0.7, 1.25, 0.9);
    anim.arms[sd] = { g: arm, handY: -ua - fa - rF * 0.7, len: ua + fa };
  });

  // legs: hip and knee pivots so the figure can shift weight and sit
  [-1, 1].forEach((sd) => {
    const hx = sd * T.hipsW * 0.48;
    const r = L.thighR, c = L.calfR;
    const hipX = hx * 0.97, hipY = 0.5 * H, kneeX = hx * 0.96, kneeY = 0.29 * H;
    const hip = new Group(); hip.position.set(hipX, hipY, 0); fig.add(hip);
    const knee = new Group(); knee.position.set(kneeX - hipX, kneeY - hipY, 0); hip.add(knee);
    const thigh = add(hip, loft([
      { y: 0.28 * H, x: hx * 0.96, w: r * 0.58, d: r * 0.58 },
      { y: 0.3 * H, x: hx * 0.96, w: r * 0.62, d: r * 0.62 },
      { y: 0.37 * H, x: hx, w: r * 0.86, d: r * 0.88, z: r * 0.06 },
      { y: 0.44 * H, x: hx, w: r * 1.0, d: r * 1.0 },
      { y: 0.5 * H, x: hx * 0.95, w: r * 1.05, d: r * 1.0 }
    ], { seg: 18 }), skin, -hipX, -hipY, 0);
    void thigh;
    add(hip, loft([
      { y: 0.405 * H, x: hx, w: r * 0.98, d: r * 0.98 },
      { y: 0.45 * H, x: hx, w: r * 1.06, d: r * 1.06 },
      { y: 0.5 * H, x: hx * 0.95, w: r * 1.1, d: r * 1.06 }
    ], { seg: 18 }), cloth, -hipX, -hipY, 0);
    add(knee, loft([
      { y: 0.035 * H, x: hx * 0.92, w: c * 0.48, d: c * 0.5 },
      { y: 0.09 * H, x: hx * 0.92, w: c * 0.62, d: c * 0.68 },
      { y: 0.19 * H, x: hx * 0.94, w: c * 0.96, d: c * 1.02, z: -c * 0.12 },
      { y: 0.26 * H, x: hx * 0.95, w: c * 0.78, d: c * 0.82 },
      { y: 0.3 * H, x: hx * 0.96, w: r * 0.6, d: r * 0.6 }
    ], { seg: 18 }), skin, -kneeX, -kneeY, 0);
    add(knee, new SphereGeometry(r * 0.6, 14, 10), skin, 0, 0, 0);
    const foot = add(knee, new CapsuleGeometry(c * 0.42, 0.11 * s, 4, 10), mat(colors.shoe, { roughness: 0.7 }), hx * 0.92 - kneeX, 0.02 * s - kneeY, 0.035 * s);
    foot.rotation.x = Math.PI / 2;
    anim.hips[sd] = hip; anim.knees[sd] = knee;
  });
  anim.seatDrop = 0.205 * H;
  anim.seat = { y: 0.13 * H, r: 0.2 * H, z: -0.06 * H };
  addProps(anim, { head: head, headR: headR, kind: 'human', skin: look.skin, mat: mat, add: add, upper: upper, fig: fig, glow: colors.glow });
  fig.userData.mats = mats;
  fig.userData.anim = anim;
  return fig;
}

/* Cute chibi creatures. Same body parameters: belly from softness/waist, limbs from arm/thigh (+strength),
   size from height, mood from recovery (eyes, ears, slump, bounce). */
function buildCreature(p, look, colors) {
  const C = window.FitAvatarModel.creatureShape(p);
  const R = p.recovery;
  const kind = look.kind;
  const fig = new Group();
  const mats = [];
  function mat(hex, extra) {
    const m = new MeshStandardMaterial(Object.assign({ color: new Color(hex), roughness: kind === 'robot' ? 0.35 : 0.7, metalness: kind === 'robot' ? 0.35 : 0 }, extra || {}));
    mats.push(m);
    return m;
  }
  function add(parent, geo, m, x, y, z) {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    parent.add(mesh);
    return mesh;
  }
  const base = new Color(look.color);
  const body = mat(look.color);
  const light = mat(base.clone().lerp(new Color('#fff6e8'), kind === 'bunny' ? 0.6 : 0.5).getHex());
  const dark = mat('#1d1322', { roughness: 0.3, metalness: 0 });
  const white = mat('#ffffff', { roughness: 0.3, metalness: 0 });
  const pink = mat('#ff9fb8', { roughness: 0.6, metalness: 0 });
  const glowHex = colors.glow;
  const glow = mat(glowHex, { emissive: new Color(glowHex), emissiveIntensity: 0.9, metalness: 0 });
  const anim = { eyes: [], breath: [], ears: [], arms: {}, hips: {}, knees: {}, head: null, upper: null, baseEye: R.eyeOpen, creature: true, S: C.scale, unit: C.scale * 1.0, headR: C.headR };

  const S = C.scale;
  const slump = R.slouch || 0;
  const legH = C.legLen;
  const legX = C.bellyR * 0.5;
  // legs + feet
  [-1, 1].forEach((sd) => {
    const hip = new Group(); hip.position.set(sd * legX, legH, 0); fig.add(hip);
    add(hip, new CapsuleGeometry(C.legR, legH * 0.6, 6, 14), body, 0, legH * 0.55 - legH, 0);
    const foot = add(hip, new SphereGeometry(C.legR * 1.15, 16, 10), kind === 'robot' ? dark : light, 0, C.legR * 0.55 - legH, C.legR * 0.45);
    foot.scale.set(1, 0.6, 1.35);
    anim.hips[sd] = hip;
  });
  // body pivot (slump forward from the hips)
  const upper = new Group();
  upper.position.set(0, legH, 0);
  upper.rotation.x = 0.22 * slump;
  fig.add(upper);
  anim.upper = upper; anim.upperBase = upper.rotation.x;
  const bodyH = C.bodyR * 1.25;
  const bw = Math.max(C.bellyR, C.bodyR * 0.85);
  const torso = kind === 'robot'
    ? add(upper, new CylinderGeometry(bw * 0.92, bw, bodyH * 1.6, 28), body, 0, bodyH * 0.8, 0)
    : add(upper, new SphereGeometry(1, 32, 22), body, 0, bodyH * 0.85, 0);
  if (kind !== 'robot') torso.scale.set(bw, bodyH, bw * 0.92);
  anim.breath.push(torso);
  // tummy patch / robot screen
  if (kind === 'robot') {
    const panel = add(upper, new BoxGeometry(bw * 0.9, bodyH * 0.6, 0.01), dark, 0, bodyH * 0.85, bw * 0.99);
    const heart = add(upper, new SphereGeometry(bw * 0.12, 14, 10), glow, 0, bodyH * 0.85, bw * 1.0);
    heart.scale.set(1, 1, 0.4);
    anim.glowMesh = heart;
    void panel;
  } else {
    const tummy = add(upper, new SphereGeometry(1, 26, 16), light, 0, bodyH * 0.78, bw * 0.38);
    tummy.scale.set(bw * 0.72, bodyH * 0.72, bw * 0.62);
    anim.breath.push(tummy);
  }
  // arms
  [-1, 1].forEach((sd) => {
    const arm = new Group();
    arm.position.set(sd * bw * 0.9, bodyH * 1.25, 0);
    arm.rotation.z = sd * (0.55 - 0.35 * slump + 0.25 * R.bounce);
    arm.rotation.x = -0.15 * slump;
    upper.add(arm);
    add(arm, new CapsuleGeometry(C.armR, C.armLen * 0.7, 6, 12), body, 0, -C.armLen * 0.5, 0);
    add(arm, new SphereGeometry(C.armR * 1.1, 12, 10), kind === 'robot' ? dark : light, 0, -C.armLen * 0.95, 0);
    anim.arms[sd] = { g: arm, handY: -C.armLen * 0.95, len: C.armLen };
  });
  // head
  const head = new Group();
  const hr = C.headR;
  head.position.set(0, bodyH * 1.55 + hr * 0.75, 0);
  head.rotation.x = 0.25 * slump;
  upper.add(head);
  anim.head = head; anim.headBase = head.rotation.x;
  const skull = kind === 'robot'
    ? add(head, new BoxGeometry(hr * 2, hr * 1.7, hr * 1.7), body)
    : add(head, new SphereGeometry(hr, 32, 22), body);
  if (kind !== 'robot') skull.scale.set(1.08, 0.95, 0.95);
  // face
  const faceZ = kind === 'robot' ? hr * 0.86 : hr * 0.86;
  if (kind === 'robot') {
    add(head, new BoxGeometry(hr * 1.6, hr * 0.9, 0.02), dark, 0, hr * 0.02, hr * 0.86);
  }
  if (kind === 'bear' || kind === 'dragon') {
    const muzzle = add(head, new SphereGeometry(hr * 0.42, 20, 14), light, 0, -hr * 0.28, hr * 0.72);
    muzzle.scale.set(kind === 'dragon' ? 1.25 : 1.1, 0.78, 0.8);
  }
  [-1, 1].forEach((sd) => {
    const eyeMat = kind === 'robot' ? glow : dark;
    const e = add(head, new SphereGeometry(hr * (kind === 'robot' ? 0.14 : 0.16), 16, 12), eyeMat, sd * hr * 0.38, hr * 0.08, faceZ + 0.005);
    e.scale.set(1, R.eyeOpen, 0.55);
    anim.eyes.push(e);
    if (kind !== 'robot') {
      const hl = add(head, new SphereGeometry(hr * 0.05, 8, 6), white, sd * hr * 0.38 + hr * 0.05, hr * 0.14, faceZ + hr * 0.09);
      hl.visible = R.eyeOpen > 0.6;
      const cheek = add(head, new SphereGeometry(hr * 0.12, 12, 8), pink, sd * hr * 0.6, -hr * 0.2, hr * 0.74);
      cheek.scale.set(1, 0.6, 0.4);
    }
  });
  if (kind === 'bear' || kind === 'bunny' || kind === 'dragon') {
    const nose = add(head, new SphereGeometry(hr * (kind === 'bunny' ? 0.07 : 0.1), 12, 8), kind === 'bunny' ? pink : dark, 0, -hr * (kind === 'bunny' ? 0.1 : 0.16), hr * (kind === 'bunny' ? 0.95 : 1.06));
    nose.scale.set(1.3, 0.9, 0.8);
  }
  const mouthArc = R.mood === 'happy' ? 1.9 : R.mood === 'tired' ? 1.0 : 0.9;
  const mouth = add(head, new TorusGeometry(hr * 0.16, hr * 0.03, 6, 16, mouthArc), kind === 'robot' ? glow : dark, 0, -hr * (kind === 'robot' ? 0.22 : 0.36), kind === 'robot' ? hr * 0.88 : hr * (kind === 'bunny' ? 0.9 : 1.0));
  mouth.rotation.z = R.mood === 'tired' ? Math.PI / 2 - mouthArc / 2 : -Math.PI / 2 - mouthArc / 2;
  if (R.mood === 'tired') mouth.position.y -= hr * 0.12;
  anim.mouth = mouth;
  const mz = kind === 'robot' ? hr * 0.88 : hr * (kind === 'bunny' ? 0.9 : 1.0);
  const mo = add(head, new SphereGeometry(hr * 0.12, 12, 10), kind === 'robot' ? glow : mat('#4a1a26', { roughness: 0.5, metalness: 0 }), 0, -hr * 0.36, mz - hr * 0.02);
  mo.scale.set(1, 0.85, 0.5);
  anim.mouthO = mo;
  anim.faceZ = faceZ; anim.mouthY = -hr * 0.36; anim.eyeY = hr * 0.08; anim.eyeX = hr * 0.38; anim.mouthZ = mz;
  anim.seatDrop = legH * 0.75;
  anim.seat = { y: legH * 0.12, r: bw * 1.25, z: -bw * 0.4 };

  // kind extras
  const perk = 1 - (R.earDroop || 0);
  if (kind === 'bunny') {
    [-1, 1].forEach((sd) => {
      const ear = new Group();
      ear.position.set(sd * hr * 0.38, hr * 0.78, -hr * 0.05);
      head.add(ear);
      const outer = add(ear, new CapsuleGeometry(hr * 0.18, hr * 1.0, 6, 12), body, 0, hr * 0.62, 0);
      outer.scale.set(1, 1, 0.55);
      const inner = add(ear, new CapsuleGeometry(hr * 0.1, hr * 0.8, 4, 10), pink, 0, hr * 0.62, hr * 0.07);
      inner.scale.set(1, 1, 0.4);
      ear.userData.base = { z: sd * (0.12 + 0.9 * (1 - perk)), x: -0.1 + 0.9 * (1 - perk) * 0.6 };
      ear.rotation.z = ear.userData.base.z;
      ear.rotation.x = ear.userData.base.x;
      ear.userData.side = sd;
      anim.ears.push(ear);
    });
    const teeth = add(head, new BoxGeometry(hr * 0.14, hr * 0.12, hr * 0.03), white, 0, -hr * 0.42, hr * 0.92);
    void teeth;
    add(upper, new SphereGeometry(bw * 0.3, 14, 10), white, 0, bodyH * 0.5, -bw * 0.95);
  } else if (kind === 'bear') {
    [-1, 1].forEach((sd) => {
      const ear = new Group();
      ear.position.set(sd * hr * 0.68, hr * 0.68, -hr * 0.05);
      head.add(ear);
      add(ear, new SphereGeometry(hr * 0.28, 16, 12), body).scale.set(1, 1, 0.6);
      add(ear, new SphereGeometry(hr * 0.16, 12, 10), light, 0, 0, hr * 0.08).scale.set(1, 1, 0.4);
      ear.userData.base = { z: sd * -0.5 * (1 - perk), x: 0.4 * (1 - perk) };
      ear.rotation.z = ear.userData.base.z; ear.rotation.x = ear.userData.base.x;
      ear.userData.side = sd;
      anim.ears.push(ear);
    });
    add(upper, new SphereGeometry(bw * 0.2, 12, 10), body, 0, bodyH * 0.35, -bw * 0.92);
  } else if (kind === 'dragon') {
    [-1, 1].forEach((sd) => {
      const horn = new Group();
      horn.position.set(sd * hr * 0.42, hr * 0.78, -hr * 0.1);
      head.add(horn);
      add(horn, new ConeGeometry(hr * 0.12, hr * 0.42, 10), light, 0, hr * 0.18, 0);
      horn.userData.base = { z: sd * (-0.25 - 0.5 * (1 - perk)), x: -0.2 + 0.5 * (1 - perk) };
      horn.rotation.z = horn.userData.base.z; horn.rotation.x = horn.userData.base.x;
      horn.userData.side = sd;
      anim.ears.push(horn);
      // little wings
      const wing = new Group();
      wing.position.set(sd * bw * 0.45, bodyH * 1.2, -bw * 0.75);
      upper.add(wing);
      const wm = add(wing, new SphereGeometry(bw * 0.5, 16, 10), light, sd * bw * 0.35, 0, 0);
      wm.scale.set(1, 0.7, 0.12);
      wing.rotation.z = sd * (0.35 - 0.5 * slump);
      wing.rotation.y = sd * 0.5;
      wing.userData.side = sd; wing.userData.base = { z: wing.rotation.z, x: 0 };
      wing.userData.wing = true;
      anim.ears.push(wing);
    });
    // tail with spikes
    const tail = new Group();
    tail.position.set(0, bodyH * 0.35, -bw * 0.8);
    upper.add(tail);
    anim.tail = tail;
    const t1 = add(tail, new ConeGeometry(bw * 0.32, bw * 1.3, 14), body, 0, 0, -bw * 0.5);
    t1.rotation.x = -Math.PI / 2 - 0.25 + 0.35 * slump;
    for (let i = 0; i < 4; i++) {
      const sp = add(upper, new ConeGeometry(hr * 0.09, hr * 0.2, 6), light, 0, bodyH * (0.6 + i * 0.32), -bw * (0.98 - i * 0.05));
      sp.rotation.x = -0.5;
    }
  } else if (kind === 'robot') {
    const ant = new Group();
    ant.position.set(0, hr * 0.85, 0);
    head.add(ant);
    add(ant, new CylinderGeometry(hr * 0.03, hr * 0.03, hr * 0.5, 8), dark, 0, hr * 0.25, 0);
    const bulb = add(ant, new SphereGeometry(hr * 0.12, 14, 10), mat(glowHex, { emissive: new Color(glowHex), emissiveIntensity: 0.9, metalness: 0 }), 0, hr * 0.52, 0);
    anim.bulb = bulb;
    ant.userData.base = { z: 0, x: 0.9 * (1 - perk) };
    ant.rotation.x = ant.userData.base.x;
    ant.userData.side = 1;
    anim.ears.push(ant);
    [-1, 1].forEach((sd) => {
      const earC = add(head, new CylinderGeometry(hr * 0.2, hr * 0.2, hr * 0.14, 16), dark, sd * hr * 1.05, 0, 0);
      earC.rotation.z = Math.PI / 2;
    });
  }
  addProps(anim, { head: head, headR: hr, kind: kind, skin: look.color, mat: mat, add: add, upper: upper, fig: fig, glow: glowHex });
  fig.userData.mats = mats;
  fig.userData.anim = anim;
  return fig;
}

/* Small props the reactions and day states use. Built once per figure, hidden until needed. */
function addProps(anim, o) {
  const hr = o.headR, head = o.head, add = o.add, mat = o.mat;
  const props = {};
  // sweat drops on the forehead
  const sweatM = mat('#8fd3ff', { roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85 });
  props.sweat = [[-0.5, 0.45], [0.55, 0.3], [0.15, 0.62]].map(function (q, i) {
    const d = add(head, new SphereGeometry(hr * 0.07, 10, 8), sweatM, q[0] * hr, q[1] * hr, hr * 0.8);
    d.scale.set(0.75, 1.2, 0.75);
    d.visible = false;
    d.userData.i = i;
    return d;
  });
  // eye bags (poor sleep)
  const bagM = mat(new Color(o.skin).multiplyScalar(0.72).getHex(), { roughness: 0.8, metalness: 0 });
  props.bags = [-1, 1].map(function (sd) {
    const b = add(head, new SphereGeometry(hr * 0.09, 10, 8), bagM, sd * anim.eyeX, anim.eyeY - hr * 0.13, anim.faceZ - hr * 0.02);
    b.scale.set(1.3, 0.45, 0.5);
    b.visible = false;
    return b;
  });
  // things in the right hand
  const R = anim.arms[1];
  if (R) {
    const hold = new Group();
    hold.position.set(0, R.handY, hr * 0.12);
    R.g.add(hold);
    const bottle = new Group();
    add(bottle, new CylinderGeometry(hr * 0.1, hr * 0.1, hr * 0.42, 14), mat('#7cc4ff', { roughness: 0.2, metalness: 0, transparent: true, opacity: 0.85 }), 0, 0, 0);
    add(bottle, new CylinderGeometry(hr * 0.06, hr * 0.06, hr * 0.08, 10), mat('#f3eaff', { metalness: 0 }), 0, hr * 0.24, 0);
    bottle.visible = false;
    hold.add(bottle);
    const snack = add(hold, new CylinderGeometry(hr * 0.16, hr * 0.16, hr * 0.06, 16), mat('#c98a4b', { roughness: 0.9, metalness: 0 }), 0, 0, 0);
    snack.rotation.x = Math.PI / 2;
    snack.visible = false;
    props.bottle = bottle; props.snack = snack;
  }
  // sparkles for the cheer
  const spM = mat('#ffe27a', { emissive: new Color('#ffd23f'), emissiveIntensity: 1.2, metalness: 0 });
  props.sparkles = [0, 1, 2, 3, 4].map(function (i) {
    const a = (i / 5) * Math.PI * 2;
    const sp = add(head, new IcosahedronGeometry(hr * 0.09, 0), spM, Math.cos(a) * hr * 1.5, hr * (0.9 + 0.3 * Math.sin(a * 2)), Math.sin(a) * hr * 0.6);
    sp.visible = false;
    sp.userData.a = a;
    return sp;
  });
  // dragon flame
  if (o.kind === 'dragon') {
    const fl = add(head, new ConeGeometry(hr * 0.16, hr * 0.7, 12), mat('#ff8a3d', { emissive: new Color('#ff6a1a'), emissiveIntensity: 1.3, metalness: 0, transparent: true, opacity: 0.9 }), 0, anim.mouthY - hr * 0.02, (anim.mouthZ || anim.faceZ) + hr * 0.38);
    fl.rotation.x = -Math.PI / 2;
    fl.visible = false;
    props.flame = fl;
  }
  anim.props = props;
}

function buildFigure(p, look, colors) {
  // the cozy villager look (v44); the older v42 figures only if it fails to build
  try { return buildChibi(p, look, colors, addProps); } catch (e) {
    try { console.warn('chibi avatar failed, using the classic figure', e && e.message); } catch (x) { /* ignore */ }
  }
  return look.kind && look.kind !== 'human' && look.kind !== 'cat' ? buildCreature(p, look, colors) : buildHuman(p, look, colors);
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

/* ---------- procedural animation ----------
   A small state machine: a mood base pose (crossfaded when the mood/day changes), an idle layer
   (eased breathing, weight shifts, natural blinks, smooth-noise head drift), one-shot clips
   (fidgets every 6–12 s, reactions on demand) with fade-in/out envelopes, and spring-damper
   secondary motion for ears/horns/wings/antenna/tail. Only transforms change per frame. */
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
};
/* keys: [[t, v, easeName?], ...] sorted by t in 0..1; value eased from the previous key. */
function K(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (u <= k[0]) {
      const p = keys[i - 1];
      const f = (u - p[0]) / Math.max(1e-6, k[0] - p[0]);
      return p[1] + (k[1] - p[1]) * (ease[k[2] || 'inOut'])(f);
    }
  }
  return keys[keys.length - 1][1];
}
function hash1(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
function noise1(x) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
function rand(a, b) { return a + Math.random() * (b - a); }
function osc(u, n) { return Math.sin(u * Math.PI * 2 * n); }

/* One-shot clips. Each returns channel offsets for normalized time u. Arms: raise = outward/up,
   fwd = forward, for side R (1) / L (-1). Props: 0..1. */
const CLIPS = {
  lookAround: { dur: 3.2, f: (u) => ({ headY: K(u, [[0, 0], [0.25, 0.55], [0.45, 0.5], [0.7, -0.5], [0.85, -0.45], [1, 0]]), headX: K(u, [[0, 0], [0.3, -0.06], [0.7, -0.04], [1, 0]]) }) },
  scratch: { dur: 2.4, f: (u) => { const w = K(u, [[0, 0], [0.25, 1, 'out'], [0.75, 1], [1, 0]]); return { rFwd: 2.5 * w, rRaise: -0.5 * w + 0.06 * w * osc(u, 7), headZ: -0.12 * w, headX: 0.06 * w, eyeClose: 0.25 * w }; } },
  stretch: { dur: 2.6, f: (u) => { const w = K(u, [[0, 0], [0.35, 1, 'out'], [0.65, 1], [1, 0]]); return { rRaise: 2.6 * w, lRaise: 2.6 * w, leanX: -0.12 * w, rootY: 0.012 * w, squash: 0.04 * w, eyeClose: 0.5 * w, mouthOpen: 0.4 * K(u, [[0.3, 0], [0.5, 1], [0.7, 0]]) }; } },
  yawn: { dur: 3.0, f: (u) => { const w = K(u, [[0, 0], [0.3, 1, 'out'], [0.7, 1], [1, 0]]); return { mouthOpen: K(u, [[0, 0], [0.35, 1], [0.7, 0.9], [0.9, 0]]), eyeClose: 0.85 * w, headX: -0.22 * w, rFwd: 1.8 * K(u, [[0.15, 0], [0.4, 1], [0.7, 1], [0.9, 0]]), rRaise: -0.3 * w, leanX: -0.05 * w }; } },
  nod: { dur: 3.2, f: (u) => ({ headX: K(u, [[0, 0], [0.55, 0.45, 'in'], [0.62, -0.08, 'out'], [1, 0]]), eyeClose: K(u, [[0, 0], [0.5, 1], [0.6, 0], [1, 0]]), leanX: K(u, [[0, 0], [0.55, 0.08], [0.65, 0], [1, 0]]) }) },
  rubBack: { dur: 2.8, f: (u) => { const w = K(u, [[0, 0], [0.25, 1, 'out'], [0.75, 1], [1, 0]]); return { rFwd: -0.9 * w, rRaise: 0.25 * w + 0.08 * w * osc(u, 5), leanX: 0.12 * w, leanZ: -0.06 * w, headX: -0.1 * w, eyeClose: 0.3 * w }; } },
  sigh: { dur: 2.6, f: (u) => ({ headX: K(u, [[0, 0], [0.4, 0.3], [0.7, 0.3], [1, 0]]), leanX: K(u, [[0, 0], [0.4, 0.08], [1, 0]]), squash: K(u, [[0, 0], [0.4, -0.03], [1, 0]]), eyeClose: K(u, [[0, 0], [0.4, 0.5], [1, 0]]) }) },
  /* hop with anticipation, stretch on launch, squash on landing */
  hop: { dur: 1.3, f: (u) => ({ rootY: K(u, [[0, 0], [0.2, -0.02], [0.45, 0.075, 'out'], [0.65, 0, 'in'], [0.78, -0.012, 'out'], [1, 0]]), squash: K(u, [[0, 0], [0.2, -0.1], [0.3, 0.09, 'out'], [0.6, 0.02], [0.68, -0.12, 'out'], [0.85, 0.02], [1, 0]]), lRaise: K(u, [[0, 0], [0.35, 0.5], [0.7, 0.1], [1, 0]]), rRaise: K(u, [[0, 0], [0.35, 0.5], [0.7, 0.1], [1, 0]]) }) },
  /* walk in place: little alternating hops with arm swing */
  march: { dur: 2.6, f: (u) => {
    const w = K(u, [[0, 0], [0.12, 1], [0.88, 1], [1, 0]]);
    const ph = u * 6 * Math.PI;
    const s = Math.sin(ph);
    return { rootY: 0.018 * Math.abs(s) * w, squash: -0.05 * Math.abs(Math.cos(ph)) * w + 0.03 * Math.abs(s) * w, legR: 0.55 * Math.max(0, s) * w, legL: 0.55 * Math.max(0, -s) * w, rFwd: 0.6 * s * w, lFwd: -0.6 * s * w, headZ: 0.06 * s * w, leanZ: 0.04 * s * w, mouthOpen: 0 };
  } },
  // ---- reactions
  workout: { dur: 3.0, react: true, f: (u) => {
    const st = K(u, [[0, 0], [0.2, 1, 'out'], [0.38, 1], [0.48, 0]]);
    const wipe = K(u, [[0.42, 0], [0.55, 1, 'out'], [0.85, 1], [1, 0]]);
    return { rRaise: 2.5 * st - 0.45 * wipe + 0.35 * wipe * osc(u, 4.5), lRaise: 2.5 * st, rFwd: 2.4 * wipe, leanX: -0.12 * st + 0.04 * wipe, rootY: 0.01 * st, squash: 0.05 * st, headX: -0.1 * st + 0.05 * wipe, headZ: -0.1 * wipe, eyeClose: 0.6 * st + 0.3 * wipe, mouthOpen: 0.5 * K(u, [[0.6, 0], [0.75, 0.8], [0.95, 0]]), sweat: K(u, [[0, 0], [0.1, 1], [0.85, 1], [1, 0]]) };
  } },
  meal: { dur: 2.4, react: true, f: (u) => {
    const arm = K(u, [[0, 0], [0.2, 1, 'out'], [0.6, 1], [0.75, 0]]);
    const chew = u > 0.2 && u < 0.7 ? Math.max(0, osc(u, 6)) : 0;
    const lick = K(u, [[0.7, 0], [0.8, 1], [0.95, 1], [1, 0]]);
    return { rFwd: 2.1 * arm, rRaise: -0.6 * arm, headX: 0.08 * arm, mouthOpen: 0.7 * chew + 0.35 * lick, headZ: 0.12 * lick * osc(u, 6), eyeClose: 0.45 * lick + 0.2 * arm, snack: arm, squash: 0.02 * chew };
  } },
  goal: { dur: 2.2, react: true, f: (u) => ({
    rootY: K(u, [[0, 0], [0.15, -0.025], [0.38, 0.09, 'out'], [0.6, 0, 'in'], [0.7, -0.015, 'out'], [0.85, 0]]),
    squash: K(u, [[0, 0], [0.15, -0.12], [0.25, 0.1, 'out'], [0.55, 0.02], [0.62, -0.13, 'out'], [0.8, 0.02], [1, 0]]),
    rRaise: K(u, [[0, 0], [0.15, -0.2], [0.35, 2.9, 'back'], [0.85, 2.9], [1, 0]]) + 0.25 * K(u, [[0.4, 0], [0.5, 1], [0.6, 0], [0.7, 1], [0.8, 0]]),
    lRaise: K(u, [[0, 0], [0.35, 0.7], [0.85, 0.6], [1, 0]]),
    headX: K(u, [[0, 0], [0.35, -0.18], [0.85, -0.12], [1, 0]]),
    mouthOpen: K(u, [[0.3, 0], [0.42, 1], [0.8, 0.8], [1, 0]]), eyeClose: K(u, [[0.3, 0], [0.42, 0.55], [0.85, 0.55], [1, 0]]),
    sparkle: K(u, [[0.3, 0], [0.42, 1], [0.85, 1], [1, 0]]), flame: K(u, [[0.4, 0], [0.48, 1], [0.7, 1], [0.8, 0]]), glow: K(u, [[0.2, 0], [0.4, 1], [0.85, 1], [1, 0]]), wingFlap: K(u, [[0.2, 0], [0.4, 1], [0.8, 1], [1, 0]])
  }) },
  water: { dur: 2.4, react: true, f: (u) => {
    const arm = K(u, [[0, 0], [0.22, 1, 'out'], [0.72, 1], [0.88, 0]]);
    const sip = K(u, [[0.25, 0], [0.4, 1], [0.7, 1], [0.8, 0]]);
    return { rFwd: 2.2 * arm, rRaise: -0.55 * arm, headX: -0.28 * sip, mouthOpen: 0.25 * sip, eyeClose: 0.5 * sip + 0.3 * K(u, [[0.8, 0], [0.9, 0.5], [1, 0]]), bottle: arm, squash: 0.03 * K(u, [[0.8, 0], [0.9, 1], [1, 0]]) };
  } }
};

class Spring {
  constructor(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  step(dt, force) {
    const n = Math.max(1, Math.ceil(dt / 0.016));
    const h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-this.k * this.x - this.c * this.v + force) * h; this.x += this.v * h; }
    this.x = MathUtils.clamp(this.x, -0.7, 0.7);
    return this.x;
  }
}

class Animator {
  constructor(still) {
    this.still = still;
    this.t = 0;
    this.clips = [];
    this.nextFidget = rand(4, 8);
    this.nextBlink = rand(1.5, 4);
    this.blinkT = -1; this.doubleBlink = false;
    this.breath = 0;
    this.shift = 0; this.shiftV = 0; this.shiftTarget = 0; this.nextShift = rand(2, 4);
    this.base = { leanX: 0, headX: 0, headZ: 0, eye: 0, armDrop: 0, seat: 0, speed: 1 };
    this.mood = { recovery: {}, day: {} };
    this.springs = [];
    this.tailSpring = new Spring(40, 5);
    this.prevHead = { x: 0, z: 0 }; this.prevRootY = 0; this.prevRootV = 0;
    this.look = { x: 0, y: 0, w: 0, until: 0 };
  }
  bind(anim, fig) {
    this.a = anim; this.fig = fig;
    while (this.springs.length < (anim.ears || []).length) this.springs.push({ x: new Spring(70, 6.5), z: new Spring(70, 6.5) });
  }
  setMood(recovery, day) { this.mood = { recovery: recovery || {}, day: day || {} }; }
  play(name) {
    const c = CLIPS[name];
    if (!c) return 0;
    // a reaction preempts whatever is playing: fade the others out quickly
    this.clips.forEach((x) => { x.out = Math.min(x.out, this.t + 0.2); });
    this.clips.push({ name, c, start: this.t, end: this.t + c.dur, out: this.t + c.dur });
    if (c.react) this.nextFidget = this.t + c.dur + rand(6, 10);
    return c.dur;
  }
  busy() { return this.clips.some((x) => this.t < x.out); }
  pickFidget() {
    const R = this.mood.recovery || {}, D = this.mood.day || {};
    const pool = ['lookAround', 'lookAround', 'scratch', 'stretch'];
    if (this.a && this.a.chibi && !this.base.seatTarget && !D.sore) pool.push('march', 'march');
    if (R.zone === 'green' && !this.base.seatTarget) pool.push('hop', 'hop', 'hop');
    if (D.sleepy || R.zone === 'red') pool.push('yawn', 'yawn', 'nod');
    if (D.sore) pool.push('rubBack', 'rubBack');
    if (D.thirsty) pool.push('sigh', 'sigh');
    if (this.base.seatTarget) { const i = pool.indexOf('stretch'); if (i >= 0) pool.splice(i, 1); }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  lookAt(x, y, nowS) { this.look.x = x; this.look.y = y; this.look.until = nowS + 1.6; }
  update(dtRaw, turnYaw) {
    const a = this.a, fig = this.fig;
    if (!a || !fig) return;
    const R = this.mood.recovery || {}, D = this.mood.day || {};
    const still = this.still;
    // mood base pose, crossfaded (exponential approach)
    const tgt = {
      leanX: 0.05 * (D.sleepy ? 1 : 0) + 0.07 * (D.sore ? 1 : 0) + 0.04 * (D.thirsty ? 1 : 0),
      headX: 0.08 * (D.sleepy ? 1 : 0) + 0.22 * (D.thirsty ? 1 : 0),
      headZ: 0.08 * (D.thirsty ? 1 : 0),
      eye: Math.max(D.sleepy ? 0.3 : 0, D.thirsty ? 0.15 : 0),
      speed: R.zone === 'green' ? 1.12 : R.zone === 'red' ? 0.7 : 1,
      seat: D.rest ? 1 : 0
    };
    tgt.speed *= D.sore ? 0.8 : 1;
    tgt.speed *= D.sleepy ? 0.88 : 1;
    this.base.seatTarget = tgt.seat;
    const kf = still ? 1 : 1 - Math.exp(-dtRaw * 2.5);
    Object.keys(tgt).forEach((k) => { this.base[k] += (tgt[k] - this.base[k]) * kf; });
    const B = this.base;
    const dt = dtRaw * B.speed;
    this.t += dtRaw;
    const t = this.t;

    // channels
    const ch = { rootY: 0, shiftX: 0, squash: 0, leanX: B.leanX, leanZ: 0, headX: B.headX, headY: 0, headZ: B.headZ, rRaise: 0, lRaise: 0, rFwd: 0, lFwd: 0, legR: 0, legL: 0, eyeClose: B.eye, mouthOpen: 0, sweat: 0, snack: 0, bottle: 0, sparkle: 0, flame: 0, glow: 0, wingFlap: 0 };

    if (!still) {
      // breathing: slower inhale ease-in-out, quicker exhale
      const rate = (R.breathRate || 0.3) * (D.sleepy ? 0.85 : 1);
      this.breath = (this.breath + dt * rate) % 1;
      const ph = this.breath;
      const br = ph < 0.45 ? ease.inOut(ph / 0.45) : 1 - ease.inOut((ph - 0.45) / 0.55);
      ch.breath = br;
      ch.leanX += -0.012 * br;
      ch.headX += -0.01 * br;
      ch.rRaise += 0.03 * br; ch.lRaise += 0.03 * br;
      if (a.chibi) { ch.squash += 0.018 * br - 0.006; ch.rootY += 0.0035 * br * (R.zone === 'green' ? 1.4 : 1); }
      // weight shift between feet (critically damped toward a side picked every 2.5–5 s); sore = limp
      if (t > this.nextShift) {
        this.shiftTarget = this.shiftTarget > 0 ? -1 : 1;
        if (D.sore) this.shiftTarget = this.shiftTarget > 0 ? 1 : -0.3;
        this.nextShift = t + rand(2.5, 5) / B.speed;
      }
      const w0 = 3.2;
      this.shiftV += (-2 * w0 * this.shiftV - w0 * w0 * (this.shift - this.shiftTarget)) * dt;
      this.shift += this.shiftV * dt;
      const sh = this.shift * (1 - B.seat);
      ch.shiftX += 0.006 * sh;
      ch.leanZ += -0.03 * sh;
      ch.headZ += 0.025 * sh;
      ch.rootY += -0.004 * Math.abs(sh) * (D.sore ? 2 : 1);
      // smooth-noise head drift (not a sine)
      ch.headY += 0.12 * noise1(t * 0.23 + 3.1);
      ch.headX += 0.04 * noise1(t * 0.31 + 7.7);
      // blinks: random 2–6 s, sometimes double
      if (this.blinkT < 0 && t > this.nextBlink) { this.blinkT = 0; this.doubleBlink = Math.random() < 0.2; }
      if (this.blinkT >= 0) {
        this.blinkT += dtRaw;
        const bd = D.sleepy ? 0.28 : 0.16;
        const u = this.blinkT / bd;
        ch.eyeClose = Math.max(ch.eyeClose, u < 0.5 ? ease.out(u * 2) : 1 - ease.inOut((u - 0.5) * 2));
        if (u >= 1) {
          if (this.doubleBlink) { this.doubleBlink = false; this.blinkT = -0.12; this.nextBlink = t + 0.08; }
          else { this.blinkT = -1; this.nextBlink = t + rand(2, 6) * (D.sleepy ? 0.7 : 1); }
        }
      }
      // fidgets every 6–12 s when nothing else plays
      if (t > this.nextFidget && !this.busy()) { this.play(this.pickFidget()); this.nextFidget = t + rand(6, 12); }
    }
    // clips with envelopes (crossfade in 0.18 s, out 0.25 s)
    this.clips = this.clips.filter((x) => t < x.out + 0.3);
    this.clips.forEach((x) => {
      const u = MathUtils.clamp((t - x.start) / x.c.dur, 0, 1);
      const wIn = ease.out(MathUtils.clamp((t - x.start) / 0.18, 0, 1));
      const wOut = t > x.out ? 1 - ease.inOut(MathUtils.clamp((t - x.out) / 0.25, 0, 1)) : 1;
      const w = wIn * wOut * (still ? 0 : 1);
      const o = x.c.f(u);
      Object.keys(o).forEach((k) => {
        const isProp = k === 'sweat' || k === 'snack' || k === 'bottle' || k === 'sparkle' || k === 'flame' || k === 'glow';
        if (isProp) ch[k] = Math.max(ch[k], o[k] * (still ? wIn * wOut : w));
        else ch[k] = (ch[k] || 0) + o[k] * w;
      });
    });
    // look-at (full view: follows the finger), relative to the turntable yaw
    if (!still) {
      const on = t < this.look.until ? 1 : 0;
      this.look.w += (on - this.look.w) * (1 - Math.exp(-dtRaw * 4));
      if (this.look.w > 0.01) {
        let yaw = this.look.x * 0.8 - (turnYaw || 0);
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        if (Math.abs(yaw) < 1.3) ch.headY += MathUtils.clamp(yaw, -0.6, 0.6) * this.look.w;
        ch.headX += -this.look.y * 0.25 * this.look.w;
      }
    }
    // seated on a rest day: no hop, legs folded
    const seat = B.seat;
    if (seat > 0.01) { ch.rootY = ch.rootY * (1 - seat) ; ch.squash *= (1 - seat * 0.7); }

    // ---- apply to the rig (from rest transforms r0/p0/s0)
    const S = a.S || 1;
    const unit = a.creature ? S : (a.unit || 1.75) / 1.75;
    fig.position.y = fig.userData.p0.y + ch.rootY * unit * (a.creature ? 1.4 : 1) - seat * (a.seatDrop || 0);
    fig.position.x = fig.userData.p0.x + ch.shiftX * unit;
    const sq = ch.squash * (a.creature ? 1 : 0.5);
    fig.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    if (a.upper) {
      a.upper.rotation.x = a.upper.userData.r0.x + ch.leanX;
      a.upper.rotation.z = a.upper.userData.r0.z + ch.leanZ;
    }
    (a.breath || []).forEach((m) => {
      const s0 = m.userData.s0, k = (a.creature ? 0.028 : 0.012) * (ch.breath || 0);
      m.scale.set(s0.x * (1 + k), s0.y * (1 + k * 0.5), s0.z * (1 + k));
    });
    if (a.head) {
      const r0 = a.head.userData.r0;
      a.head.rotation.set(r0.x + ch.headX, r0.y + ch.headY, r0.z + ch.headZ);
    }
    [1, -1].forEach((sd) => {
      const arm = a.arms && a.arms[sd];
      if (!arm) return;
      const raise = sd > 0 ? ch.rRaise : ch.lRaise;
      let fwd = sd > 0 ? ch.rFwd : ch.lFwd;
      // a human arm is long and has no elbow: bring "hand to face" down to face height instead of overhead
      if (!a.creature && fwd > 1.5) fwd = 1.5 + (fwd - 1.5) * 0.45;
      // villager: the snack stops under the chin so the chewing mouth stays visible
      if (a.chibi && fwd > 1.3) fwd = 1.3 + (fwd - 1.3) * 0.25;
      const r0 = arm.g.userData.r0;
      arm.g.rotation.set(r0.x - fwd - seat * 0.25, r0.y, r0.z + sd * raise);
    });
    [1, -1].forEach((sd) => {
      const hip = a.hips && a.hips[sd], knee = a.knees && a.knees[sd];
      if (hip) hip.rotation.x = hip.userData.r0.x - seat * (a.creature ? 1.25 : 1.5) + (a.creature ? 0 : 0.04 * sd * this.shift * (1 - seat)) - (sd > 0 ? ch.legR : ch.legL) * (1 - seat);
      if (knee) knee.rotation.x = knee.userData.r0.x + seat * 1.5;
    });
    (a.eyes || []).forEach((e) => {
      const open = Math.max(0.08, 1 - ch.eyeClose);
      e.scale.y = e.userData.s0.y * open;
    });
    if (a.face) {
      // expression: the strongest playing clip wins, else the day / recovery mood (pure rule in avatar-model)
      const AM = window.FitAvatarModel;
      let best = 0, bc = null, bu = 0;
      this.clips.forEach((x) => {
        if (t < x.start || t > x.out + 0.1 || !(AM && AM.CLIP_EXPR[x.name])) return;
        const u = (t - x.start) / x.c.dur;
        const w = Math.min(u * 6, (1 - u) * 6, 1);
        if (w > best) { best = w; bc = x.name; bu = u; }
      });
      const expr = AM && AM.faceExpr ? AM.faceExpr(bc, bu, R, D) : 'neutral';
      const lookX = this.look.w * this.look.x + 0.6 * noise1(t * 0.4 + 2);
      a.face.update({ close: ch.eyeClose, open: ch.mouthOpen, expr: expr, lx: lookX, ly: this.look.w * this.look.y });
    }
    if (a.mouthO) {
      const m = MathUtils.clamp(ch.mouthOpen, 0, 1);
      a.mouthO.visible = m > 0.04;
      const s0 = a.mouthO.userData.s0;
      a.mouthO.scale.set(s0.x * (0.6 + 0.4 * m), s0.y * m * 1.2, s0.z);
      if (a.mouth) a.mouth.visible = m < 0.5;
    }
    const P = a.props || {};
    (P.sweat || []).forEach((d, i) => {
      d.visible = ch.sweat > 0.02;
      if (d.visible) {
        const fall = ((t * 0.6 + i * 0.33) % 1);
        d.position.y = d.userData.p0.y - fall * (a.headR || 0.1) * 0.5;
        d.scale.copy(d.userData.s0).multiplyScalar(ch.sweat * (1 - fall * 0.5));
      }
    });
    (P.bags || []).forEach((b) => { b.visible = !!D.sleepy; });
    if (P.bottle) { P.bottle.visible = ch.bottle > 0.05; P.bottle.scale.setScalar(Math.max(0.001, ease.out(Math.min(1, ch.bottle * 1.4)))); }
    if (P.snack) { P.snack.visible = ch.snack > 0.05; P.snack.scale.setScalar(Math.max(0.001, ease.out(Math.min(1, ch.snack * 1.4)))); }
    (P.sparkles || []).forEach((sp, i) => {
      sp.visible = ch.sparkle > 0.02;
      if (sp.visible) {
        const k = ch.sparkle * (0.7 + 0.3 * Math.sin(t * 9 + i * 2));
        sp.scale.setScalar(k);
        sp.rotation.set(t * 3 + i, t * 2, 0);
        sp.position.y = sp.userData.p0.y + 0.03 * Math.sin(t * 4 + i) * (a.headR || 0.1) * 4;
      }
    });
    if (P.flame) { P.flame.visible = ch.flame > 0.03; P.flame.scale.set(ch.flame, ch.flame * (0.8 + 0.3 * Math.sin(t * 30)), ch.flame); }
    if (a.bulb) a.bulb.material.emissiveIntensity = 0.9 + 2.2 * ch.glow + (still ? 0 : 0.25 * Math.sin(t * 2));
    if (a.glowMesh) a.glowMesh.material.emissiveIntensity = 0.9 + 1.5 * ch.glow;

    // secondary motion: springs driven by head rotation velocity and root acceleration
    const hv = { x: (ch.headX - this.prevHead.x) / Math.max(dtRaw, 1e-3), z: (ch.headZ + ch.leanZ - this.prevHead.z) / Math.max(dtRaw, 1e-3) };
    this.prevHead = { x: ch.headX, z: ch.headZ + ch.leanZ };
    const rv = (ch.rootY - this.prevRootY) / Math.max(dtRaw, 1e-3);
    const ra = (rv - this.prevRootV) / Math.max(dtRaw, 1e-3);
    this.prevRootY = ch.rootY; this.prevRootV = rv;
    (a.ears || []).forEach((e, i) => {
      const b = e.userData.base || { z: 0, x: 0 };
      const sp = this.springs[i];
      if (!sp) return;
      const side = e.userData.side || 1;
      const fx = still ? 0 : MathUtils.clamp(-hv.x * 6 + ra * 0.9, -40, 40);
      const fz = still ? 0 : MathUtils.clamp(-hv.z * 6 * side + side * Math.abs(ra) * 0.15, -40, 40);
      const ox = sp.x.step(dtRaw, fx), oz = sp.z.step(dtRaw, fz);
      const flap = e.userData.wing ? side * 0.5 * ch.wingFlap * Math.sin(t * 22) : 0;
      e.rotation.x = b.x + ox;
      e.rotation.z = b.z + oz * (e.userData.wing ? 0.6 : 1) + flap;
    });
    if (a.tail) {
      const off = this.tailSpring.step(dtRaw, still ? 0 : MathUtils.clamp(-ch.shiftX * 900 - ch.leanZ * 40, -30, 30));
      a.tail.rotation.y = a.tail.userData.r0.y + off;
      a.tail.rotation.x = a.tail.userData.r0.x + 0.3 * ch.squash;
    }
  }
}

function lerpParams(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const o = Array.isArray(b) ? [] : {};
    Object.keys(b).forEach((k) => { o[k] = lerpParams(a[k], b[k], t); });
    return o;
  }
  return b;
}

/* mount(container, {params, look, mode:'hero'|'full'}) →
   { update(params, look, {instant}), attach(container, mode), setPaused(bool), snapshot(), dispose() }
   One renderer for the whole app: the home hero and the full view move the same canvas around. */
export function mount(container, init) {
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const el = renderer.domElement;
  el.className = 'av-canvas';

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.05, 30);
  const accent = cssVar('--accent', '#d36bff');
  const zoneColor = (z) => z === 'green' ? cssVar('--hp-green', '#5ee08a') : z === 'yellow' ? cssVar('--hp-yellow', '#ffc46b') : z === 'red' ? cssVar('--hp-red', '#ff4d7a') : accent;

  const hemi = new HemisphereLight(0xfff4ff, 0x2a1840, 1.15);
  scene.add(hemi);
  const amb = new AmbientLight(0xffffff, 0.25);
  scene.add(amb);
  const key = new DirectionalLight(0xffffff, 1.7);
  key.position.set(1.6, 3, 2.6);
  scene.add(key);
  const rim = new DirectionalLight(accent, 1.6);
  rim.position.set(-1.8, 2.2, -2.4);
  scene.add(rim);
  const rim2 = new DirectionalLight(accent, 0.9);
  rim2.position.set(2, 1.2, -2);
  scene.add(rim2);

  const turntable = new Group();
  scene.add(turntable);
  let halo = null, figure = null, haloZone = 'x';
  // before/after: a second, read-only figure beside today's (setCompare)
  const pivot = new Group(), ghostPivot = new Group();
  turntable.add(pivot); turntable.add(ghostPivot);
  let ghost = null, ghostAnim = null, ghostParams = null, soloH = 1.75, soloW = 0.6;
  let mode = init.mode || 'full';
  let host = null;
  let shown = init.params;      // what is on screen now (lerped)
  let target = init.params;
  let look = init.look;
  let tween = null;             // {from, start, dur}
  let frameH = 1.75, frameW = 0.6;

  function makeFigure(params) {
    if (figure) { pivot.remove(figure); disposeTree(figure); }
    const zc = zoneColor(params.recovery.zone);
    figure = buildFigure(params, look, { cloth: cssVar('--bg-soft', '#2a1840'), shoe: '#f3eaff', glow: zc });
    figure.traverse((o) => { o.userData.s0 = o.scale.clone(); o.userData.r0 = o.rotation.clone(); o.userData.p0 = o.position.clone(); });
    pivot.add(figure);
    animator.bind(figure.userData.anim, figure); animator.setMood(params.recovery, day);
    if (haloZone !== params.recovery.zone) {
      haloZone = params.recovery.zone;
      rim.color.set(zc); rim2.color.set(zc);
      rim.intensity = (params.recovery.zone ? 2.0 : 1.4) * (figure.userData.anim && figure.userData.anim.chibi ? 0.6 : 1);
      rim2.intensity = figure.userData.anim && figure.userData.anim.chibi ? 0.55 : 0.9;
      if (halo) { scene.remove(halo); disposeTree(halo); }
      halo = new Mesh(new CircleGeometry(0.55, 40), new MeshBasicMaterial({ map: haloTexture(zc), transparent: true, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.002;
      scene.add(halo);
    }
    figure.updateMatrixWorld(true);
    const box = new Box3().setFromObject(figure);
    const chibi = !!(figure.userData.anim && figure.userData.anim.chibi);
    // villagers hop: leave headroom so a cheer jump stays in the frame
    frameH = Math.max(0.5, box.max.y) * (chibi ? 1.14 : look.kind && look.kind !== "human" ? 1.08 : 1);
    frameW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), 0.7 * Math.abs(box.min.z), 0.7 * Math.abs(box.max.z)) * 2;
    soloH = frameH; soloW = frameW;
    layoutCompare();
    halo.scale.setScalar(Math.max(frameH / 1.75, 0.55) * (look.kind && look.kind !== 'human' ? 1.6 : 1));
    if (day && day.rest && seatKind !== null && seatKind !== look.kind) applyDay(); // beanbag sized for the new character
  }

  function makeGhost() {
    if (ghost) { ghostPivot.remove(ghost); disposeTree(ghost); ghost = null; ghostAnim = null; }
    if (!ghostParams) return;
    ghost = buildFigure(ghostParams, look, { cloth: cssVar('--bg-soft', '#2a1840'), shoe: '#f3eaff', glow: zoneColor(ghostParams.recovery.zone) });
    ghost.traverse((o) => { o.userData.s0 = o.scale.clone(); o.userData.r0 = o.rotation.clone(); o.userData.p0 = o.position.clone(); });
    ghostPivot.add(ghost);
    ghostAnim = new Animator(reduced);
    ghostAnim.nextFidget = 1e9; // the "before" figure only breathes and blinks
    ghostAnim.bind(ghost.userData.anim, ghost); ghostAnim.setMood(ghostParams.recovery, { tod: day.tod });
  }
  /* bounds of what is drawn (hidden props such as the snack or bottle don't count) */
  function visWidth(obj) {
    const b = new Box3(), bb = new Box3();
    obj.updateMatrixWorld(true);
    obj.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      b.union(bb);
    });
    return { w: b.isEmpty() ? 0.4 : b.max.x - b.min.x, top: b.isEmpty() ? 1 : b.max.y };
  }
  function layoutCompare() {
    if (!ghost) { pivot.position.x = 0; ghostPivot.position.x = 0; frameH = soloH; frameW = soloW; return; }
    const a = visWidth(figure), g = visWidth(ghost);
    const wMax = Math.max(a.w, g.w);
    const gap = wMax * 0.62;
    frameH = Math.max(a.top, g.top) * 1.1;
    frameW = gap * 2 + wMax * 1.05;
    // RTL: "before" on the right, today on the left
    pivot.position.x = -gap; ghostPivot.position.x = gap;
    if (halo) halo.visible = false;
  }
  function frameCamera() {
    // seated on a rest day the figure is lower: frame the shorter silhouette
    const sa = seatW && figure && figure.userData.anim;
    const H = sa ? Math.max(0.4, frameH - (sa.seatDrop || 0) * 0.85) : frameH;
    const half = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const margin = mode === 'hero' ? 1.12 : 1.14;
    const distH = (H * margin / 2) / half;
    const distW = (Math.max(frameW, seatW) * margin / 2) / (half * Math.max(0.3, camera.aspect));
    const dist = Math.max(distH, distW);
    camera.position.set(0, H * 0.56, dist);
    camera.lookAt(new Vector3(0, H * 0.5, 0));
    camera.near = 0.05; camera.far = dist * 6;
    camera.updateProjectionMatrix();
  }

  function resize() {
    if (!host) return;
    const w = host.clientWidth || 160, h = host.clientHeight || 200;
    renderer.setSize(w, h, false);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    camera.aspect = w / h;
    frameCamera();
    dirty = true;
  }

  // drag to rotate in the full view (touch + mouse)
  let yaw = 0.35, pitch = 0, vel = 0, dragging = false, lastX = 0, lastY = 0, lastTouch = 0, dirty = true;
  function down(e) { if (mode !== 'full') return; dragging = true; lastX = e.clientX; lastY = e.clientY; vel = 0; lastTouch = performance.now(); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
  function move(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    vel = dx * 0.012;
    yaw += vel;
    pitch = MathUtils.clamp(pitch + dy * 0.004, -0.25, 0.35);
    lastTouch = performance.now();
    dirty = true;
    if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
  }
  function up() { dragging = false; lastTouch = performance.now(); }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  const animator = new Animator(reduced);
  let day = {};
  let seatMesh = null, seatW = 0, seatKind = null;
  const TOD = {
    morning: { sky: 0xfff0e0, ground: 0x3a2440, hemi: 1.0, key: 0xffd6ad, keyI: 1.5, amb: 0.25 },
    midday: { sky: 0xffffff, ground: 0x2a1840, hemi: 1.25, key: 0xffffff, keyI: 1.8, amb: 0.3 },
    sunset: { sky: 0xffc2a8, ground: 0x4a1e3a, hemi: 0.95, key: 0xff9a6a, keyI: 1.55, amb: 0.22 },
    night: { sky: 0x9fb0ff, ground: 0x0c0a24, hemi: 0.6, key: 0xb6c6ff, keyI: 0.85, amb: 0.14 }
  };
  function applyDay() {
    const L = TOD[day.tod] || TOD.midday;
    hemi.color.set(L.sky); hemi.groundColor.set(L.ground); hemi.intensity = L.hemi;
    key.color.set(L.key); key.intensity = L.keyI;
    amb.intensity = L.amb;
    if (day.tod === 'sunset') rim2.color.set('#ff7fb0');
    animator.setMood(shown.recovery, day);
    // rest day: a cozy beanbag to sit on
    if (seatMesh) { turntable.remove(seatMesh); disposeTree(seatMesh); seatMesh = null; }
    seatW = 0;
    const a = figure && figure.userData.anim;
    if (day.rest && a && a.seat && !ghost) {
      seatMesh = new Mesh(new SphereGeometry(a.seat.r, 28, 18), new MeshStandardMaterial({ color: new Color(cssVar('--accent', '#d36bff')).lerp(new Color('#3a2450'), 0.55), roughness: 0.95 }));
      seatMesh.scale.set(1.25, 0.72, 1.15);
      seatMesh.position.set(0, a.seat.y, a.seat.z);
      turntable.add(seatMesh);
      seatW = a.seat.r * 2.6;
    }
    seatKind = look.kind;
    frameCamera();
    dirty = true;
  }
  function onLook(e) {
    if (mode !== 'full') return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    animator.lookAt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, animator.t);
    kick();
  }
  el.addEventListener('pointermove', onLook);
  el.addEventListener('pointerdown', onLook);

  let raf = 0, prev = 0, alive = true, paused = false, visible = true;
  const t0 = performance.now();
  function wants() { return alive && !paused && visible && !document.hidden && !!host; }
  function loop(now) {
    raf = 0;
    if (!wants()) return;
    const minDt = mode === 'hero' ? 1000 / 30 : 1000 / 60;
    if (now - prev >= minDt - 1) {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      step(now, dt);
    }
    if (needsLoop()) raf = requestAnimationFrame(loop);
  }
  function needsLoop() { return !reduced || !!tween || dragging || Math.abs(vel) > 0.0005 || dirty || animator.busy(); }
  function kick() { if (!raf && wants()) { prev = performance.now() - 100; raf = requestAnimationFrame(loop); } }
  function step(now, dt) {
    if (tween) {
      const k = Math.min(1, (now - tween.start) / tween.dur);
      const e = 1 - Math.pow(1 - k, 3);
      shown = k >= 1 ? target : lerpParams(tween.from, target, e);
      makeFigure(shown);
      frameCamera();
      if (k >= 1) tween = null;
      dirty = true;
    }
    if (mode === 'full') {
      if (!dragging) {
        if (Math.abs(vel) > 0.0005) { yaw += vel; vel *= 0.92; dirty = true; }
        else if (!reduced && now - lastTouch > 2500) { yaw += dt * 0.35; dirty = true; }
      }
    } else if (!reduced) {
      yaw = 0.3 + 0.38 * noise1((now - t0) / 1000 * 0.12 + 1.7);
      dirty = true;
    } else yaw = 0.3;
    if (!reduced || animator.busy() || dirty) { animator.update(dt || 0.016, turntable.rotation.y); if (ghostAnim) ghostAnim.update(dt || 0.016, yaw); dirty = true; }
    if (dirty && figure) {
      if (ghost) {
        // side by side: each figure turns in place
        turntable.rotation.y = 0; turntable.rotation.x = pitch;
        pivot.rotation.y = yaw; ghostPivot.rotation.y = yaw;
      } else {
        turntable.rotation.y = yaw; turntable.rotation.x = pitch;
        pivot.rotation.y = 0; ghostPivot.rotation.y = 0;
      }
      renderer.render(scene, camera);
      dirty = false;
    }
  }

  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); kick(); }) : null;
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((ents) => {
      // only the current host counts: a stale entry for a removed slot must not pause the new one
      const e = ents.filter((x) => x.target === host).pop();
      if (!e) return;
      visible = e.isIntersecting;
      if (visible) kick();
    })
    : null;

  function attach(container2, mode2) {
    if (ro && host) ro.unobserve(host);
    if (io && host) io.unobserve(host);
    host = container2;
    mode = mode2 || mode;
    if (mode === 'hero') { pitch = 0; vel = 0; }
    el.style.touchAction = mode === 'full' ? 'pan-y' : 'auto';
    el.style.pointerEvents = mode === 'full' ? 'auto' : 'none';
    host.appendChild(el);
    visible = true;
    if (ro) ro.observe(host); else window.addEventListener('resize', resize);
    if (io) io.observe(host);
    frameCamera();
    resize();
    dirty = true;
    kick();
  }

  look = init.look;
  makeFigure(shown);
  attach(container, mode);

  return {
    get host() { return host; },
    get mode() { return mode; },
    attach: attach,
    setPaused(p) { paused = !!p; if (!paused) kick(); },
    setDay(d) { day = d || {}; applyDay(); kick(); },
    /* before/after: show `params` (e.g. a month ago) beside today's figure; null = back to one figure */
    setCompare(params) {
      ghostParams = params || null;
      makeGhost();
      if (!ghost && halo) halo.visible = true;
      layoutCompare();
      if (ghost && seatMesh) { turntable.remove(seatMesh); disposeTree(seatMesh); seatMesh = null; seatW = 0; }
      frameCamera();
      dirty = true; kick();
    },
    /* play a reaction now if the canvas is on screen; returns its length in seconds (0 = not shown) */
    react(type) {
      if (!wants()) return 0;
      const d = animator.play(type);
      dirty = true; kick();
      return d;
    },
    update(params, look2, opts) {
      const kindChanged = look2 && (look2.kind !== look.kind);
      if (look2) look = look2;
      target = params;
      if (reduced || (opts && opts.instant) || kindChanged) {
        shown = params; tween = null; makeFigure(shown);
        if (kindChanged && ghostParams) { makeGhost(); layoutCompare(); }
        frameCamera();
      } else {
        tween = { from: shown, start: performance.now(), dur: (opts && opts.dur) || 320 };
      }
      dirty = true;
      kick();
    },
    snapshot(size) {
      try {
        const keep = turntable.rotation.y, keepY = figure ? figure.position.y : 0;
        turntable.rotation.y = 0.35; turntable.rotation.x = 0;
        if (figure) figure.position.y = 0;
        renderer.render(scene, camera);
        const src = el;
        const c = document.createElement('canvas');
        const w = size || 160, h = Math.round(w * (src.height / Math.max(1, src.width)));
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(src, 0, 0, w, h);
        turntable.rotation.y = keep;
        if (figure) figure.position.y = keepY;
        dirty = true;
        return c.toDataURL('image/png');
      } catch (e) { return ''; }
    },
    dispose() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      if (io) io.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointermove', onLook);
      el.removeEventListener('pointerdown', onLook);
      if (seatMesh) disposeTree(seatMesh);
      if (figure) disposeTree(figure);
      if (ghost) disposeTree(ghost);
      if (halo) disposeTree(halo);
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
