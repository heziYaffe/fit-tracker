/* פיט — realistic rigged human for the 3D avatar (experimental, behind Settings › מראה).
   Loaded lazily by avatar3d.js only when the setting is on and the character is a human.
   Body: MakeHuman base mesh + targets (CC0) re-posed onto the Quaternius Universal Animation Library
   skeleton, so the CC0 UAL clips play on it directly. Body measurements drive shape keys (morph targets);
   reactions the library lacks (eat, drink, stretch, fist pump) are authored here at load time with
   two-bone IK on top of the library's idle / sitting poses. See assets/avatar/README.md. */
import {
  GLTFLoader, MeshoptDecoder, AnimationMixer, AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack,
  LoopOnce, LoopRepeat, Quaternion, Vector3, Group, Mesh, MeshStandardMaterial, Color, CylinderGeometry,
  SphereGeometry, BoxGeometry, MathUtils
} from './vendor/three-avatar.js';

const ASSET_V = '43';
const base = new URL('../assets/avatar/', import.meta.url);
const files = { m: 'human_m.glb', f: 'human_f.glb', anims: 'human_anims.glb' };
const gltfCache = {};
const rigCache = {};
let loader = null;

function loadGLB(name) {
  if (!gltfCache[name]) {
    if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
    gltfCache[name] = loader.loadAsync(new URL(name + '?v=' + ASSET_V, base).href);
    gltfCache[name].catch(() => { delete gltfCache[name]; });
  }
  return gltfCache[name];
}

/** One rig per sex for the app's lifetime (the single renderer moves between screens). */
export function loadRig(sex) {
  const s = sex === 'f' ? 'f' : 'm';
  if (!rigCache[s]) {
    rigCache[s] = Promise.all([loadGLB(files[s]), loadGLB(files.anims)]).then(([m, a]) => new RigHuman(m, a, s));
    rigCache[s].catch(() => { delete rigCache[s]; });
  }
  return rigCache[s];
}

// ---------- small helpers
const _v1 = new Vector3(), _v2 = new Vector3(), _q1 = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion(), _q4 = new Quaternion();
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
function K(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const k = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const e = k * k * (3 - 2 * k);
      return a[1] + (b[1] - a[1]) * e;
    }
  }
  return keys[keys.length - 1][1];
}
function hash1(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
function noise1(x) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
function rand(a, b) { return a + Math.random() * (b - a); }

/* Authored reactions. Each key: t (s), arms {r|l: {to:[anchor, dx, dy, dz], pole:[x,y,z], aim, fist}},
   lean (spine fwd rad), head [pitch, yaw]. Anchors are points of the base pose at that moment:
   'mouth', 'brow', 'shoulder', 'hip'. x is the character's outward side for that arm. */
const AUTHORED = {
  eat: { dur: 2.8, prop: 'fork', propWin: [0.05, 0.92], keys: [
    { t: 0 },
    { t: 0.55, r: { to: ['mouth', 0.06, -0.2, 0.16], pole: [0.2, -1, 0.1], aim: ['mouth', 0, 0, 0.02], fist: 1 }, head: [0.05, 0] },
    { t: 0.9, r: { to: ['mouth', 0.03, -0.1, 0.1], pole: [0.2, -1, 0.1], aim: ['mouth', 0, 0, 0.0], fist: 1 }, head: [0.12, 0] },
    { t: 1.25, r: { to: ['mouth', 0.07, -0.24, 0.18], pole: [0.2, -1, 0.1], aim: ['mouth', 0, 0, 0.04], fist: 1 }, head: [0.02, 0] },
    { t: 1.6, r: { to: ['mouth', 0.03, -0.1, 0.1], pole: [0.2, -1, 0.1], aim: ['mouth', 0, 0, 0.0], fist: 1 }, head: [0.12, 0] },
    { t: 2.0, r: { to: ['mouth', 0.08, -0.26, 0.18], pole: [0.2, -1, 0.1], aim: ['mouth', 0, 0, 0.05], fist: 1 }, head: [-0.03, 0] },
    { t: 2.8 }
  ] },
  drink: { dur: 2.8, prop: 'bottle', propWin: [0.05, 0.92], keys: [
    { t: 0 },
    { t: 0.6, r: { to: ['mouth', 0.07, -0.22, 0.17], pole: [0.3, -1, 0], aim: ['mouth', 0.05, -0.1, 0.4], fist: 1 }, head: [0.03, 0] },
    { t: 1.0, r: { to: ['mouth', 0.05, -0.08, 0.1], pole: [0.4, -1, 0], aim: ['mouth', 0.0, 0.25, 0.3], fist: 1 }, head: [-0.3, 0], lean: -0.05 },
    { t: 1.9, r: { to: ['mouth', 0.05, -0.06, 0.1], pole: [0.4, -1, 0], aim: ['mouth', 0.0, 0.3, 0.25], fist: 1 }, head: [-0.34, 0], lean: -0.06 },
    { t: 2.25, r: { to: ['mouth', 0.08, -0.25, 0.18], pole: [0.3, -1, 0], aim: ['mouth', 0.05, -0.1, 0.4], fist: 1 }, head: [0.02, 0] },
    { t: 2.8 }
  ] },
  workout: { dur: 3.4, keys: [
    { t: 0 },
    { t: 0.7, r: { to: ['shoulder', -0.06, 0.62, 0.04], pole: [0.6, 0, -0.3] }, l: { to: ['shoulder', -0.06, 0.62, 0.04], pole: [0.6, 0, -0.3] }, lean: -0.08, head: [-0.12, 0] },
    { t: 1.4, r: { to: ['shoulder', -0.1, 0.64, 0.0], pole: [0.6, 0, -0.3] }, l: { to: ['shoulder', -0.1, 0.64, 0.0], pole: [0.6, 0, -0.3] }, lean: -0.1, head: [-0.15, 0] },
    { t: 1.9, r: { to: ['brow', 0.09, 0.0, 0.11], pole: [0.6, -1, 0.0], aim: ['brow', -0.2, 0.0, 0.1] }, lean: 0.02, head: [0.08, 0.05] },
    { t: 2.3, r: { to: ['brow', -0.02, 0.0, 0.11], pole: [0.6, -1, 0.0], aim: ['brow', -0.25, 0.0, 0.1] }, lean: 0.02, head: [0.08, 0.05] },
    { t: 2.7, r: { to: ['brow', 0.1, -0.01, 0.11], pole: [0.6, -1, 0.0], aim: ['brow', -0.2, 0.0, 0.1] }, lean: 0.02, head: [0.05, 0.05] },
    { t: 3.4 }
  ] },
  goal: { dur: 2.4, keys: [
    { t: 0 },
    { t: 0.3, r: { to: ['shoulder', 0.1, -0.2, 0.25], pole: [0.3, -1, -0.1], fist: 1 }, lean: 0.06 },
    { t: 0.62, r: { to: ['shoulder', 0.14, 0.3, 0.12], pole: [0.8, -0.6, -0.1], aim: ['shoulder', 0.16, 0.6, 0.1], fist: 1 }, l: { to: ['hip', 0.08, 0.1, 0.12], pole: [0.4, 0, -0.5], fist: 1 }, lean: -0.08, head: [-0.2, 0] },
    { t: 0.95, r: { to: ['shoulder', 0.14, 0.0, 0.25], pole: [0.4, -1, -0.2], aim: ['shoulder', 0.16, 0.4, 0.3], fist: 1 }, l: { to: ['hip', 0.08, 0.1, 0.12], pole: [0.4, 0, -0.5], fist: 1 }, head: [-0.05, 0] },
    { t: 1.25, r: { to: ['shoulder', 0.14, 0.3, 0.12], pole: [0.8, -0.6, -0.1], aim: ['shoulder', 0.16, 0.6, 0.1], fist: 1 }, l: { to: ['hip', 0.08, 0.1, 0.12], pole: [0.4, 0, -0.5], fist: 1 }, lean: -0.08, head: [-0.22, 0] },
    { t: 1.55, r: { to: ['shoulder', 0.14, 0.0, 0.25], pole: [0.4, -1, -0.2], aim: ['shoulder', 0.16, 0.4, 0.3], fist: 1 }, head: [-0.05, 0] },
    { t: 1.9, r: { to: ['shoulder', 0.14, 0.3, 0.12], pole: [0.8, -0.6, -0.1], aim: ['shoulder', 0.16, 0.6, 0.1], fist: 1 }, lean: -0.06, head: [-0.18, 0] },
    { t: 2.4 }
  ] }
};
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

class RigHuman {
  constructor(model, anims, sex) {
    this.sex = sex;
    this.group = new Group();
    this.group.userData.rig = this;
    this.root = model.scene;
    this.group.add(this.root);
    this.bones = {};
    this.meshes = [];
    this.root.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh || o.isMesh) {
        o.frustumCulled = false; // skinned bounds are the bind pose
        this.meshes.push(o);
      }
    });
    this.rest = {};
    Object.keys(this.bones).forEach((n) => { this.rest[n] = { q: this.bones[n].quaternion.clone(), p: this.bones[n].position.clone() }; });
    this.mats = {};
    this.meshes.forEach((m) => {
      const mm = m.material;
      if (mm && mm.name) {
        const fresh = new MeshStandardMaterial({ color: mm.color ? mm.color.clone() : new Color('#ffffff'), roughness: mm.name === 'eye' || mm.name === 'iris' ? 0.25 : 0.62, metalness: 0 });
        fresh.name = mm.name;
        m.material = fresh;
        mm.dispose();
        this.mats[mm.name] = fresh;
      }
    });
    this.clips = {};
    this.retarget(anims);
    this.mixer = new AnimationMixer(this.root);
    this.actions = {};
    Object.keys(this.clips).forEach((n) => { this.actions[n] = this.mixer.clipAction(this.clips[n]); });
    this.authorAll();
    this.measureSeat();
    this.addProps();
    this.resetPose();
    this.t = 0;
    this.state = 'stand';
    this.cur = null;
    this.react = null; // {name, start, end}
    this.timer = null; // {at, fn}
    this.nextFidget = rand(5, 9);
    this.nextBlink = rand(1.5, 4); this.blinkT = -1; this.doubleBlink = false;
    this.breath = 0;
    this.look = { x: 0, y: 0, w: 0, until: 0 };
    this.headTurn = null;
    this.mood = { recovery: {}, day: {} };
    this.slump = 0;
    this.started = false;
  }

  // ---- clips from the library: rotations apply as-is (same bone frames); pelvis travel scaled to our legs
  retarget(anims) {
    const ualRest = {};
    anims.scene.traverse((o) => { if (o.isBone) ualRest[o.name] = o.position.clone(); });
    const ourPelvis = this.bones.pelvis.getWorldPosition(new Vector3()).y;
    const ualP = anims.scene.getObjectByName('pelvis');
    const ratio = ualP ? ourPelvis / ualP.getWorldPosition(new Vector3()).y : 1;
    anims.animations.forEach((src) => {
      const clip = src.clone();
      clip.tracks = clip.tracks.filter((t) => {
        const dot = t.name.lastIndexOf('.');
        const bn = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
        if (!this.bones[bn]) return false;
        if (prop === 'scale') return false;
        if (prop === 'position') {
          if (bn !== 'pelvis') return false;
          const ur = ualRest[bn] || new Vector3(), or = this.rest[bn].p, v = t.values;
          for (let i = 0; i < v.length; i += 3) {
            v[i] = or.x + (v[i] - ur.x) * ratio; v[i + 1] = or.y + (v[i + 1] - ur.y) * ratio; v[i + 2] = or.z + (v[i + 2] - ur.z) * ratio;
          }
        }
        return true;
      });
      this.clips[clip.name] = clip;
    });
  }

  resetPose() {
    Object.keys(this.bones).forEach((n) => { this.bones[n].quaternion.copy(this.rest[n].q); this.bones[n].position.copy(this.rest[n].p); });
    this.root.updateMatrixWorld(true);
  }
  /* pose the skeleton at time t of a library clip (no mixer) */
  sample(clip, t) {
    this.resetPose();
    const tt = clip.duration > 0 ? ((t % clip.duration) + clip.duration) % clip.duration : 0;
    clip.tracks.forEach((tr) => {
      const dot = tr.name.lastIndexOf('.');
      const b = this.bones[tr.name.slice(0, dot)], prop = tr.name.slice(dot + 1);
      if (!b) return;
      const out = tr.createInterpolant(new Float32Array(tr.getValueSize())).evaluate(tt);
      if (prop === 'quaternion') b.quaternion.fromArray(out);
      else if (prop === 'position') b.position.fromArray(out);
    });
    this.root.updateMatrixWorld(true);
  }
  wpos(name, out) { return this.bones[name].getWorldPosition(out || new Vector3()); }
  /* rotate a bone so the direction to its child points at a model-space target */
  aim(bone, child, target) {
    const bp = bone.getWorldPosition(new Vector3());
    const cur = child.getWorldPosition(new Vector3()).sub(bp).normalize();
    const des = target.clone().sub(bp).normalize();
    const dq = new Quaternion().setFromUnitVectors(cur, des);
    this.rotWorld(bone, dq);
  }
  /* apply a model-space rotation delta at the bone's pivot */
  rotWorld(bone, dq) {
    // parent orientation in the model's own frame (the turntable yaw / height scale don't count)
    const pq = bone.parent.getWorldQuaternion(_q1).premultiply(this.root.getWorldQuaternion(_q4).invert());
    const inv = _q2.copy(pq).invert();
    bone.quaternion.premultiply(_q3.copy(inv).multiply(dq).multiply(pq));
    bone.updateMatrixWorld(true);
  }
  twoBone(side, target, pole) {
    const up = this.bones['upperarm_' + side], lo = this.bones['lowerarm_' + side], ha = this.bones['hand_' + side];
    const S = up.getWorldPosition(new Vector3()), E = lo.getWorldPosition(new Vector3()), W = ha.getWorldPosition(new Vector3());
    const a = S.distanceTo(E), b = E.distanceTo(W);
    const toT = target.clone().sub(S);
    const d = MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.normalize();
    const pv = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const cosA = MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const elbow = S.clone().add(dir.clone().multiplyScalar(a * cosA)).add(pv.multiplyScalar(a * Math.sqrt(1 - cosA * cosA)));
    this.aim(up, lo, elbow);
    this.aim(lo, ha, S.clone().add(dir.multiplyScalar(d)));
  }
  anchors() {
    const head = this.wpos('Head');
    const eyeL = this.bones.eye_l ? this.wpos('eye_l') : head.clone().add(new Vector3(0.03, 0.04, 0.08));
    const eyeR = this.bones.eye_r ? this.wpos('eye_r') : head.clone().add(new Vector3(-0.03, 0.04, 0.08));
    const eyes = eyeL.clone().add(eyeR).multiplyScalar(0.5);
    return {
      mouth: eyes.clone().add(new Vector3(0, -0.075, 0.03)),
      brow: eyes.clone().add(new Vector3(0, 0.035, 0.035)),
      shoulder: { r: this.wpos('upperarm_r'), l: this.wpos('upperarm_l') },
      hip: { r: this.wpos('thigh_r'), l: this.wpos('thigh_l') }
    };
  }
  /* the authored reactions, once standing (idle) and once seated (sitting idle) */
  authorAll() {
    const fist = this.clips.Punch_Cross;
    this.fist = {};
    if (fist) {
      this.sample(fist, fist.duration * 0.5);
      ['r', 'l'].forEach((s) => FINGERS.forEach((f) => [1, 2, 3].forEach((k) => {
        const n = f + '_0' + k + '_' + s;
        if (this.bones[n]) this.fist[n] = this.bones[n].quaternion.clone();
      })));
    }
    const bases = { stand: this.clips.Idle_Loop, sit: this.clips.Sitting_Idle_Loop };
    Object.keys(AUTHORED).forEach((name) => {
      Object.keys(bases).forEach((pose) => {
        const baseClip = bases[pose];
        if (!baseClip) return;
        const def = AUTHORED[name];
        const times = [], frames = [];
        def.keys.forEach((k) => {
          this.sample(baseClip, k.t);
          this.applyKey(k);
          times.push(k.t);
          const f = {};
          Object.keys(this.bones).forEach((n) => { f[n] = this.bones[n].quaternion.clone(); });
          f.__pelvis = this.bones.pelvis.position.clone();
          frames.push(f);
        });
        const tracks = Object.keys(this.bones).map((n) => {
          const vals = [];
          let prev = null;
          frames.forEach((f) => { const q = f[n].clone(); if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); vals.push(q.x, q.y, q.z, q.w); prev = q; });
          return new QuaternionKeyframeTrack(n + '.quaternion', times, vals);
        });
        const pv = [];
        frames.forEach((f) => pv.push(f.__pelvis.x, f.__pelvis.y, f.__pelvis.z));
        tracks.push(new VectorKeyframeTrack('pelvis.position', times, pv));
        const clip = new AnimationClip(name + '_' + pose, def.dur, tracks);
        this.clips[clip.name] = clip;
        this.actions[clip.name] = this.mixer.clipAction(clip);
      });
    });
    this.resetPose();
  }
  applyKey(k) {
    if (k.lean) { this.rotWorld(this.bones.spine_02, new Quaternion().setFromAxisAngle(X, k.lean * 0.6)); this.rotWorld(this.bones.spine_03, new Quaternion().setFromAxisAngle(X, k.lean * 0.4)); }
    const A = this.anchors();
    ['r', 'l'].forEach((s) => {
      const arm = k[s];
      if (!arm) return;
      const sx = s === 'r' ? -1 : 1; // outward x for this side
      const an = arm.to[0];
      const p0 = an === 'shoulder' || an === 'hip' ? A[an][s] : A[an];
      const target = p0.clone().add(new Vector3(arm.to[1] * sx, arm.to[2], arm.to[3]));
      const pole = new Vector3(arm.pole[0] * sx, arm.pole[1], arm.pole[2]);
      this.twoBone(s, target, pole);
      if (arm.aim && this.bones['middle_01_' + s]) {
        const q0 = arm.aim[0] === 'shoulder' || arm.aim[0] === 'hip' ? A[arm.aim[0]][s] : A[arm.aim[0]];
        this.aim(this.bones['hand_' + s], this.bones['middle_01_' + s], q0.clone().add(new Vector3(arm.aim[1] * sx, arm.aim[2], arm.aim[3])));
      }
      if (arm.fist && Object.keys(this.fist).length) {
        Object.keys(this.fist).forEach((n) => { if (n.slice(-1) === s) this.bones[n].quaternion.slerp(this.fist[n], arm.fist); });
      }
      this.root.updateMatrixWorld(true);
    });
    if (k.head) {
      this.rotWorld(this.bones.neck_01, new Quaternion().setFromAxisAngle(X, k.head[0] * 0.4));
      this.rotWorld(this.bones.Head, new Quaternion().setFromAxisAngle(X, k.head[0] * 0.6).multiply(new Quaternion().setFromAxisAngle(Y, k.head[1])));
    }
    this.root.updateMatrixWorld(true);
  }
  measureSeat() {
    const sit = this.clips.Sitting_Idle_Loop;
    const H = 1.75;
    if (!sit) { this.seat = null; return; }
    this.sample(sit, 0);
    const pel = this.wpos('pelvis');
    const head = this.wpos('Head');
    this.seat = { top: pel.y - 0.09, z: pel.z - 0.06 };
    this.sitH = head.y + 0.2;
    this.seatDrop = (H - this.sitH) / 0.85;
    this.resetPose();
  }
  addProps() {
    const hand = this.bones.hand_r;
    this.props = {};
    if (!hand) return;
    // build at the bind pose in model space, then parent to the hand keeping the world transform
    this.resetPose();
    const hp = this.wpos('hand_r');
    const mid = this.bones.middle_01_r ? this.wpos('middle_01_r') : hp.clone().add(new Vector3(-0.08, 0, 0));
    const fwd = mid.clone().sub(hp).normalize(); // along the fingers (bind pose: palm down, fingers out)
    const grip = hp.clone().add(fwd.clone().multiplyScalar(0.05)).add(new Vector3(0, -0.035, 0.0));
    const bottle = new Group();
    const glass = new Mesh(new CylinderGeometry(0.032, 0.032, 0.2, 18), new MeshStandardMaterial({ color: new Color('#7cc4ff'), roughness: 0.15, metalness: 0, transparent: true, opacity: 0.8 }));
    const cap = new Mesh(new CylinderGeometry(0.018, 0.018, 0.03, 12), new MeshStandardMaterial({ color: new Color('#f3eaff'), roughness: 0.4 }));
    cap.position.y = 0.115;
    bottle.add(glass, cap);
    // bottle axis along the thumb side (forward in the bind pose), cap toward the thumb
    bottle.quaternion.setFromUnitVectors(Y, Z);
    bottle.position.copy(grip);
    const fork = new Group();
    const steel = new MeshStandardMaterial({ color: new Color('#d9dbe4'), roughness: 0.25, metalness: 0.8 });
    const handle = new Mesh(new BoxGeometry(0.012, 0.13, 0.005), steel);
    const head = new Mesh(new BoxGeometry(0.022, 0.05, 0.004), steel);
    head.position.y = 0.085;
    const food = new Mesh(new SphereGeometry(0.014, 10, 8), new MeshStandardMaterial({ color: new Color('#c98a4b'), roughness: 0.9 }));
    food.position.set(0, 0.1, 0.006);
    fork.add(handle, head, food);
    fork.position.copy(grip);
    [bottle, fork].forEach((p) => { p.visible = false; p.traverse((o) => { o.frustumCulled = false; }); this.root.add(p); this.root.updateMatrixWorld(true); hand.attach(p); });
    fork.quaternion.identity(); // along the hand bone: out of the top of the fist, toward the mouth
    this.props = { bottle, fork };
  }

  // ---- look and body
  setLook(look, colors) {
    const set = (n, hex) => { if (this.mats[n] && hex) this.mats[n].color.set(hex); };
    set('skin', look.skin || '#e8b996');
    set('hair', look.hairColor || '#3b2a20');
    set('cloth', colors && colors.cloth ? new Color(colors.cloth).lerp(new Color('#6f5fa8'), 0.35).getHex() : '#4a3a78');
    set('iris', '#3a2616');
    set('eye', '#f4f1ee');
    const bald = look.hair === 'none' || look.hair === 'bald' || look.hair === 'shaved';
    this.meshes.forEach((m) => { if (m.material && m.material.name === 'hair') m.visible = !bald; });
  }
  setMorphs(infl, height) {
    this.meshes.forEach((m) => {
      const d = m.morphTargetDictionary;
      if (!d) return;
      Object.keys(infl).forEach((k) => { if (k in d) m.morphTargetInfluences[d[k]] = infl[k]; });
    });
    const s = (height || 1.75) / 1.75;
    this.group.scale.setScalar(s);
    this.group.userData.anim = {
      seat: this.seat ? { r: 0.3 * s, y: (this.seat.top - 0.3 * 0.72) * s, z: this.seat.z * s } : null,
      seatDrop: this.seatDrop * s
    };
    this.group.userData.frame = { h: (height || 1.75) + 0.02, w: 0.62 * s };
  }
  setMood(recovery, day) { this.mood = { recovery: recovery || {}, day: day || {} }; }
  lookAt(x, y) { this.look.x = x; this.look.y = y; this.look.until = this.t + 1.6; }

  // ---- animation state
  baseName() { return this.state === 'sit' ? 'Sitting_Idle_Loop' : 'Idle_Loop'; }
  go(name, fade, once) {
    const act = this.actions[name];
    if (!act) return 0;
    act.reset();
    act.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
    act.clampWhenFinished = !!once;
    act.setEffectiveTimeScale(1);
    act.setEffectiveWeight(1);
    act.play();
    if (this.cur && this.cur !== act) act.crossFadeFrom(this.cur, fade, false);
    this.cur = act;
    return act.getClip().duration;
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.state = this.mood.day && this.mood.day.rest ? 'sit' : 'stand';
    this.go(this.baseName(), 0);
  }
  later(sec, fn) { this.timer = { at: this.t + sec, fn }; }
  toBase(fade) { this.react = null; this.go(this.baseName(), fade || 0.4); }
  setDay(day) {
    this.mood.day = day || {};
    if (!this.started) return;
    const want = this.mood.day.rest ? 'sit' : 'stand';
    if (want === this.state) return;
    this.state = want;
    if (this.react) return; // the reaction returns to the new base when it ends
    const tr = want === 'sit' ? 'Sitting_Enter' : 'Sitting_Exit';
    const d = this.go(tr, 0.3, true);
    if (d) this.later(Math.max(0.1, d - 0.35), () => this.toBase(0.35));
    else this.toBase(0.4);
  }
  /** play a reaction; returns its length in seconds */
  play(type) {
    this.start();
    const pose = this.state === 'sit' ? 'sit' : 'stand';
    const name = (type === 'meal' ? 'eat' : type === 'water' ? 'drink' : type) + '_' + pose; // = FitAvatarModel.rigClipFor
    if (!this.actions[name]) return 0;
    const d = this.go(name, 0.3, true);
    this.react = { name: name.slice(0, name.lastIndexOf('_')), start: this.t, end: this.t + d };
    this.later(d - 0.4, () => this.toBase(0.45));
    this.nextFidget = this.t + d + rand(6, 10);
    return d;
  }
  busy() { return !!this.react || !!this.timer; }
  fidget() {
    const R = this.mood.recovery || {}, D = this.mood.day || {};
    if (this.state === 'sit') { this.headTurn = { start: this.t, dur: 3.2 }; return; }
    const pool = ['look', 'look', 'fold'];
    if (R.zone === 'green' && !D.sleepy) pool.push('yes', 'stretch');
    if (!D.sore) pool.push('stretch');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick === 'look') { this.headTurn = { start: this.t, dur: 3.2 }; return; }
    if (pick === 'fold') { this.go('Idle_FoldArms_Loop', 0.5); this.later(rand(3.5, 5), () => this.toBase(0.6)); return; }
    if (pick === 'yes') { const d = this.go('Yes', 0.3, true); if (d) this.later(d - 0.35, () => this.toBase(0.4)); return; }
    if (pick === 'stretch') { const d = this.go('workout_stand', 0.35, true); if (d) this.later(1.6, () => this.toBase(0.6)); }
  }

  update(dt, turnYaw, still) {
    if (!this.started) this.start();
    this.t += dt;
    const t = this.t;
    const R = this.mood.recovery || {}, D = this.mood.day || {};
    if (this.timer && t >= this.timer.at) { const fn = this.timer.fn; this.timer = null; fn(); }
    if (!still && !this.react && !this.timer && t > this.nextFidget) { this.fidget(); this.nextFidget = t + rand(7, 12); }
    // energy: a red recovery or a sleepy day plays the idle slower
    const speed = (R.zone === 'green' ? 1.08 : R.zone === 'red' ? 0.72 : 1) * (D.sleepy ? 0.85 : 1) * (D.sore ? 0.85 : 1);
    if (this.cur && !this.react) this.cur.setEffectiveTimeScale(speed);
    this.mixer.update(still ? 0 : dt);

    // ---- procedural layers on top of the clips
    const tired = (D.sleepy ? 1 : 0) + (D.thirsty ? 0.6 : 0) + (R.zone === 'red' ? 0.6 : 0) + (D.sore ? 0.4 : 0);
    const slumpT = this.react ? 0 : Math.min(1, tired);
    this.slump += (slumpT - this.slump) * (1 - Math.exp(-dt * 2));
    const b = this.bones;
    if (this.slump > 0.01 && b.spine_02) {
      this.rotWorld(b.spine_02, _q1.setFromAxisAngle(X, 0.08 * this.slump).clone());
      this.rotWorld(b.Head, _q1.setFromAxisAngle(X, 0.16 * this.slump).clone());
    }
    let br = 0;
    if (!still) {
      this.breath = (this.breath + dt * (R.breathRate || 0.3) * (D.sleepy ? 0.85 : 1)) % 1;
      const ph = this.breath;
      br = ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI / 2) : Math.cos(((ph - 0.45) / 0.55) * Math.PI / 2);
      if (b.spine_03) this.rotWorld(b.spine_03, new Quaternion().setFromAxisAngle(X, -0.025 * br));
      if (b.clavicle_l) { this.rotWorld(b.clavicle_l, new Quaternion().setFromAxisAngle(Z, 0.015 * br)); this.rotWorld(b.clavicle_r, new Quaternion().setFromAxisAngle(Z, -0.015 * br)); }
    }
    // head: drift, a look-around fidget, and toward the finger in the full view
    let yaw = 0, pitch = 0;
    if (!still) {
      yaw += 0.1 * noise1(t * 0.23 + 3.1);
      pitch += 0.04 * noise1(t * 0.31 + 7.7);
      if (this.headTurn) {
        const u = (t - this.headTurn.start) / this.headTurn.dur;
        if (u >= 1) this.headTurn = null;
        else { yaw += K(u, [[0, 0], [0.25, 0.55], [0.45, 0.5], [0.7, -0.5], [0.85, -0.45], [1, 0]]); pitch += K(u, [[0, 0], [0.3, -0.06], [0.7, -0.04], [1, 0]]); }
      }
      const on = t < this.look.until ? 1 : 0;
      this.look.w += (on - this.look.w) * (1 - Math.exp(-dt * 4));
      if (this.look.w > 0.01) {
        let ly = this.look.x * 0.8 - (turnYaw || 0);
        ly = Math.atan2(Math.sin(ly), Math.cos(ly));
        if (Math.abs(ly) < 1.3) yaw += MathUtils.clamp(ly, -0.6, 0.6) * this.look.w;
        pitch += this.look.y * 0.25 * this.look.w;
      }
    }
    if (b.Head && (yaw || pitch)) {
      const k = this.react ? 0.3 : 1;
      this.rotWorld(b.neck_01, new Quaternion().setFromAxisAngle(Y, yaw * 0.35 * k));
      this.rotWorld(b.Head, new Quaternion().setFromAxisAngle(Y, yaw * 0.65 * k).multiply(new Quaternion().setFromAxisAngle(X, pitch * k)));
    }
    // eyes: small saccades, and leading the head
    ['eye_l', 'eye_r'].forEach((n) => {
      const e = b[n];
      if (!e) return;
      e.quaternion.copy(this.rest[n].q);
      if (!still) {
        const sy = 0.12 * Math.round(noise1(t * 0.5 + 11) * 3) / 3 + yaw * 0.3;
        const sp = 0.05 * Math.round(noise1(t * 0.43 + 5) * 2) / 2;
        this.rotWorld(e, new Quaternion().setFromAxisAngle(Y, sy).multiply(new Quaternion().setFromAxisAngle(X, sp)));
      }
    });
    // blink (morph), sleepy lids
    let close = D.sleepy ? 0.35 : (R.zone === 'red' ? 0.2 : 0);
    if (!still) {
      if (this.blinkT < 0 && t > this.nextBlink) { this.blinkT = 0; this.doubleBlink = Math.random() < 0.2; }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const bd = D.sleepy ? 0.28 : 0.16;
        const u = this.blinkT / bd;
        close = Math.max(close, u < 0.5 ? u * 2 : 1 - (u - 0.5) * 2);
        if (u >= 1) {
          if (this.doubleBlink) { this.doubleBlink = false; this.blinkT = -1; this.nextBlink = t + 0.08; }
          else { this.blinkT = -1; this.nextBlink = t + rand(2, 6) * (D.sleepy ? 0.7 : 1); }
        }
      }
    }
    if (this.react && this.react.name === 'drink') {
      const u = (t - this.react.start) / (this.react.end - this.react.start);
      close = Math.max(close, 0.6 * K(u, [[0.3, 0], [0.4, 1], [0.68, 1], [0.78, 0]]));
    }
    this.meshes.forEach((m) => { const d = m.morphTargetDictionary; if (d && 'blink' in d) m.morphTargetInfluences[d.blink] = MathUtils.clamp(close, 0, 1); });
    // props in the hand
    const P = this.props;
    let fork = 0, bottle = 0;
    if (this.react) {
      const def = AUTHORED[this.react.name];
      const u = (t - this.react.start) / (this.react.end - this.react.start);
      if (u >= 1.05) this.react = null;
      else if (def && def.prop) {
        const w = def.propWin;
        const s = Math.min(K(u, [[w[0], 0], [w[0] + 0.1, 1]]), K(u, [[w[1] - 0.1, 1], [w[1], 0]]));
        if (def.prop === 'fork') fork = s; else bottle = s;
      }
    }
    if (P.fork) { P.fork.visible = fork > 0.03; P.fork.scale.setScalar(Math.max(0.001, fork)); }
    if (P.bottle) { P.bottle.visible = bottle > 0.03; P.bottle.scale.setScalar(Math.max(0.001, bottle)); }
  }
}

export { AUTHORED };
