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
  const anim = { eyes: [], breath: [], head: null, upper: null, baseEye: 1 };
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
  });

  // legs
  [-1, 1].forEach((sd) => {
    const hx = sd * T.hipsW * 0.48;
    const r = L.thighR, c = L.calfR;
    const leg = loft([
      { y: 0.035 * H, x: hx * 0.92, w: c * 0.48, d: c * 0.5 },
      { y: 0.09 * H, x: hx * 0.92, w: c * 0.62, d: c * 0.68 },
      { y: 0.19 * H, x: hx * 0.94, w: c * 0.96, d: c * 1.02, z: -c * 0.12 },
      { y: 0.26 * H, x: hx * 0.95, w: c * 0.78, d: c * 0.82 },
      { y: 0.29 * H, x: hx * 0.96, w: r * 0.6, d: r * 0.6 },
      { y: 0.37 * H, x: hx, w: r * 0.86, d: r * 0.88, z: r * 0.06 },
      { y: 0.44 * H, x: hx, w: r * 1.0, d: r * 1.0 },
      { y: 0.5 * H, x: hx * 0.95, w: r * 1.05, d: r * 1.0 }
    ], { seg: 18 });
    add(fig, leg, skin);
    // shorts legs
    add(fig, loft([
      { y: 0.405 * H, x: hx, w: r * 0.98, d: r * 0.98 },
      { y: 0.45 * H, x: hx, w: r * 1.06, d: r * 1.06 },
      { y: 0.5 * H, x: hx * 0.95, w: r * 1.1, d: r * 1.06 }
    ], { seg: 18 }), cloth);
    const foot = add(fig, new CapsuleGeometry(c * 0.42, 0.11 * s, 4, 10), mat(colors.shoe, { roughness: 0.7 }), hx * 0.92, 0.02 * s, 0.035 * s);
    foot.rotation.x = Math.PI / 2;
  });
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
  const anim = { eyes: [], breath: [], ears: [], head: null, upper: null, baseEye: R.eyeOpen, creature: true };

  const S = C.scale;
  const slump = R.slouch || 0;
  const legH = C.legLen;
  const legX = C.bellyR * 0.5;
  // legs + feet
  [-1, 1].forEach((sd) => {
    const leg = add(fig, new CapsuleGeometry(C.legR, legH * 0.6, 6, 14), body, sd * legX, legH * 0.55, 0);
    leg.scale.set(1, 1, 1);
    const foot = add(fig, new SphereGeometry(C.legR * 1.15, 16, 10), kind === 'robot' ? dark : light, sd * legX, C.legR * 0.55, C.legR * 0.45);
    foot.scale.set(1, 0.6, 1.35);
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
    const bulb = add(ant, new SphereGeometry(hr * 0.12, 14, 10), glow, 0, hr * 0.52, 0);
    void bulb;
    ant.userData.base = { z: 0, x: 0.9 * (1 - perk) };
    ant.rotation.x = ant.userData.base.x;
    ant.userData.side = 1;
    anim.ears.push(ant);
    [-1, 1].forEach((sd) => {
      const earC = add(head, new CylinderGeometry(hr * 0.2, hr * 0.2, hr * 0.14, 16), dark, sd * hr * 1.05, 0, 0);
      earC.rotation.z = Math.PI / 2;
    });
  }
  fig.userData.mats = mats;
  fig.userData.anim = anim;
  return fig;
}

function buildFigure(p, look, colors) {
  return look.kind && look.kind !== 'human' ? buildCreature(p, look, colors) : buildHuman(p, look, colors);
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
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

  scene.add(new HemisphereLight(0xfff4ff, 0x2a1840, 1.15));
  scene.add(new AmbientLight(0xffffff, 0.25));
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
  let mode = init.mode || 'full';
  let host = null;
  let shown = init.params;      // what is on screen now (lerped)
  let target = init.params;
  let look = init.look;
  let tween = null;             // {from, start, dur}
  let frameH = 1.75, frameW = 0.6;

  function makeFigure(params) {
    if (figure) { turntable.remove(figure); disposeTree(figure); }
    const zc = zoneColor(params.recovery.zone);
    figure = buildFigure(params, look, { cloth: cssVar('--bg-soft', '#2a1840'), shoe: '#f3eaff', glow: zc });
    figure.traverse((o) => { o.userData.s0 = o.scale.clone(); o.userData.r0 = o.rotation.clone(); o.userData.p0 = o.position.clone(); });
    turntable.add(figure);
    if (haloZone !== params.recovery.zone) {
      haloZone = params.recovery.zone;
      rim.color.set(zc); rim2.color.set(zc);
      rim.intensity = params.recovery.zone ? 2.0 : 1.4;
      if (halo) { scene.remove(halo); disposeTree(halo); }
      halo = new Mesh(new CircleGeometry(0.55, 40), new MeshBasicMaterial({ map: haloTexture(zc), transparent: true, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.002;
      scene.add(halo);
    }
    figure.updateMatrixWorld(true);
    const box = new Box3().setFromObject(figure);
    frameH = Math.max(0.5, box.max.y) * (look.kind && look.kind !== "human" ? 1.08 : 1);
    frameW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), 0.7 * Math.abs(box.min.z), 0.7 * Math.abs(box.max.z)) * 2;
    halo.scale.setScalar(Math.max(frameH / 1.75, 0.55) * (look.kind && look.kind !== 'human' ? 1.6 : 1));
  }

  function frameCamera() {
    const H = frameH;
    const half = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const margin = mode === 'hero' ? 1.08 : 1.14;
    const distH = (H * margin / 2) / half;
    const distW = (frameW * margin / 2) / (half * Math.max(0.3, camera.aspect));
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

  // idle life: breathing, bobbing/bounce, blinking, ear wiggle — driven by the recovery mood
  function animate(t) {
    if (!figure) return;
    const a = figure.userData.anim || {};
    const R = shown.recovery;
    const rate = R.breathRate || 0.3;
    const br = Math.sin(t * Math.PI * 2 * rate);
    const S = frameH / 1.75;
    (a.breath || []).forEach((m) => {
      const s0 = m.userData.s0;
      const k = a.creature ? 0.03 : 0.012;
      m.scale.set(s0.x * (1 + k * br), s0.y * (1 + k * 0.6 * br), s0.z * (1 + k * br));
    });
    if (a.upper) a.upper.rotation.x = a.upperBase + (a.creature ? 0.02 : 0.008) * br;
    const bounce = R.bounce || 0;
    const hop = bounce > 0 ? Math.abs(Math.sin(t * Math.PI * 1.3)) * bounce * 0.035 * S * (a.creature ? 1.5 : 0.6) : 0;
    figure.position.y = hop + (1 - bounce) * 0.004 * S * br;
    if (a.head) a.head.rotation.x = a.headBase + (R.slouch || 0) * 0.07 * Math.sin(t * 0.7) + 0.01 * br;
    if (a.head && bounce > 0) a.head.rotation.z = 0.06 * bounce * Math.sin(t * Math.PI * 0.65);
    (a.ears || []).forEach((e, i) => {
      const b = e.userData.base || { z: 0, x: 0 };
      const perky = 1 - (R.earDroop || 0);
      if (e.userData.wing) e.rotation.z = b.z + e.userData.side * 0.18 * perky * Math.sin(t * 5 + i);
      else e.rotation.z = b.z + e.userData.side * 0.07 * perky * Math.sin(t * 2.2 + i);
      e.rotation.x = b.x + 0.04 * Math.sin(t * 0.9 + i);
    });
    // blink about every 3.5 s (skipped when the eyes are already sleepy)
    const ph = (t % 3.7);
    const blink = R.eyeOpen > 0.7 && ph < 0.12 ? 0.15 : 1;
    (a.eyes || []).forEach((e) => { e.scale.y = e.userData.s0.y * blink; });
  }

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
  function needsLoop() { return !reduced || !!tween || dragging || Math.abs(vel) > 0.0005 || dirty; }
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
      yaw = 0.3 + 0.35 * Math.sin((now - t0) / 1000 * 0.35);
      dirty = true;
    } else yaw = 0.3;
    if (!reduced) { animate((now - t0) / 1000); dirty = true; }
    if (dirty && figure) {
      turntable.rotation.y = yaw;
      turntable.rotation.x = pitch;
      renderer.render(scene, camera);
      dirty = false;
    }
  }

  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); kick(); }) : null;
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((ents) => { visible = ents.some((x) => x.isIntersecting); if (visible) kick(); })
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
    update(params, look2, opts) {
      const kindChanged = look2 && (look2.kind !== look.kind);
      if (look2) look = look2;
      target = params;
      if (reduced || (opts && opts.instant) || kindChanged) {
        shown = params; tween = null; makeFigure(shown); frameCamera();
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
      if (figure) disposeTree(figure);
      if (halo) disposeTree(halo);
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
