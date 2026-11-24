/* פיט — 3D avatar renderer (ES module, lazy-loaded only when the avatar view opens).
   A stylized parametric body: every part is a "loft" — elliptical rings stacked along an axis and
   smoothed with Catmull-Rom — so chest/waist/hips/arm/thigh numbers map straight onto ring sizes.
   No external models, no paid assets. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, Float32BufferAttribute,
  SphereGeometry, CylinderGeometry, TorusGeometry, CircleGeometry, IcosahedronGeometry, CapsuleGeometry,
  MeshStandardMaterial, MeshBasicMaterial, HemisphereLight, DirectionalLight, AmbientLight,
  Color, CanvasTexture, SRGBColorSpace, Vector3, MathUtils
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
function buildFigure(p, look, colors) {
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
  add(fig, loft(torsoRings, { pivotY: waistY, seg: 26 }), skin);
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
  return fig;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

/* mount(container, {params, look}) → { update(params, look), snapshot(), dispose() } */
export function mount(container, init) {
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'pan-y';

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 30);
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
  let halo = null;
  let figure = null;
  let current = null;

  function build(params, look) {
    if (figure) { turntable.remove(figure); disposeTree(figure); }
    if (halo) { scene.remove(halo); disposeTree(halo); }
    current = { params, look };
    const zc = zoneColor(params.recovery.zone);
    rim.color.set(zc); rim2.color.set(zc);
    rim.intensity = params.recovery.zone ? 2.0 : 1.4;
    figure = buildFigure(params, look, { cloth: cssVar('--bg-soft', '#2a1840'), shoe: '#f3eaff' });
    turntable.add(figure);
    halo = new Mesh(new CircleGeometry(0.55 * params.height / 1.75, 40), new MeshBasicMaterial({ map: haloTexture(zc), transparent: true, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.002;
    scene.add(halo);
    const H = params.height;
    const dbg = init.debug || {};
    if (dbg.zoom === 'head') { camera.position.set(0, H * 0.9, H * 0.6); camera.lookAt(new Vector3(0, H * 0.89, 0)); }
    else if (dbg.zoom === 'torso') { camera.position.set(0, H * 0.7, H * 1.2); camera.lookAt(new Vector3(0, H * 0.66, 0)); }
    else { camera.position.set(0, H * 0.56, H * 2.3); camera.lookAt(new Vector3(0, H * 0.5, 0)); }
    camera.near = 0.05; camera.far = H * 10;
    camera.updateProjectionMatrix();
    pop = reduced ? 1 : 0;
    dirty = true;
  }

  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // drag to rotate (touch + mouse), idle spin when untouched
  let yaw = init.debug ? init.debug.yaw : 0.35, pitch = 0, vel = 0, dragging = false, lastX = 0, lastY = 0, lastTouch = 0, dirty = true, pop = 1;
  const el = renderer.domElement;
  function down(e) { dragging = true; lastX = e.clientX; lastY = e.clientY; vel = 0; lastTouch = performance.now(); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
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

  let raf = 0, prev = performance.now(), alive = true;
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (!dragging) {
      if (Math.abs(vel) > 0.0005) { yaw += vel; vel *= 0.92; dirty = true; }
      else if (!reduced && !init.debug && now - lastTouch > 2500) { yaw += dt * 0.35; dirty = true; }
    }
    if (pop < 1) { pop = Math.min(1, pop + dt * 3.5); dirty = true; }
    if (dirty && figure) {
      turntable.rotation.y = yaw;
      turntable.rotation.x = pitch;
      const k = 0.94 + 0.06 * (1 - Math.pow(1 - pop, 3));
      figure.scale.setScalar(k);
      renderer.render(scene, camera);
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf && alive) { prev = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container); else window.addEventListener('resize', resize);

  resize();
  build(init.params, init.look);
  raf = requestAnimationFrame(frame);

  return {
    update(params, look) { build(params, look || current.look); },
    snapshot(size) {
      // render a still, front-ish frame into a small PNG for the home card
      try {
        const keep = turntable.rotation.y;
        turntable.rotation.y = 0.35; turntable.rotation.x = 0;
        if (figure) figure.scale.setScalar(1);
        renderer.render(scene, camera);
        const src = renderer.domElement;
        const c = document.createElement('canvas');
        const w = size || 160, h = Math.round(w * (src.height / Math.max(1, src.width)));
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(src, 0, 0, w, h);
        turntable.rotation.y = keep;
        dirty = true;
        return c.toDataURL('image/png');
      } catch (e) { return ''; }
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
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
