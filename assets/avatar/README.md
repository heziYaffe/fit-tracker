# Realistic avatar assets (experimental)

Used only when Settings › מראה › "דמות ריאליסטית (ניסיוני)" is on. Loaded lazily by `js/avatar-rig.js`
and cached by the service worker on first use.

| File | What | Size |
|---|---|---|
| `human_m.glb`, `human_f.glb` | Skinned body (skin, shorts / top, short hair, eyes with irises), 67-bone skeleton, 12 morph targets: `weightUp`, `weightDown`, `muscleUp`, `muscleDown`, `waist`, `belly`, `chest`, `hips`, `thighs`, `arms`, `shoulders`, `blink` | ~300 KB each |
| `human_anims.glb` | 11 skeleton clips: `Idle_Loop`, `Idle_FoldArms_Loop`, `Sitting_Enter`, `Sitting_Idle_Loop`, `Sitting_Exit`, `Consume`, `Yes`, `Dance_Loop`, `Punch_Cross`, `Jump_Start`, `Jump_Land` | ~190 KB |

All three are meshopt-compressed and quantized with `gltfpack -c -kn` (decoded by three's `MeshoptDecoder`).

## Sources and licenses (all redistributable)

- **Body mesh, shape targets, skin weights**: [MakeHuman](https://github.com/makehumancommunity/makehuman) system assets
  (`data/3dobjs/base.obj`, `data/targets/…`, `data/rigs/default.mhskel` / `default_weights.mhw`) — **CC0 1.0**.
- **Skeleton and animations**: Quaternius **Universal Animation Library** 1 and 2, Standard editions
  ([UAL1](https://opengameart.org/content/universal-animation-library), [UAL2](https://opengameart.org/content/universal-animation-library-2)) — **CC0 1.0** (License.txt in each pack).

No attribution is required by either license; credited here anyway.

## How they were built

`tools/avatar/` holds the scripts (headless Blender 4.2 + numpy):

1. `mhbuild.py m|f` — MakeHuman base + young male/female race targets, maps MakeHuman's 163 bones onto the
   UAL skeleton's 65, re-poses the A-pose mesh into the UAL T-pose with linear blend skinning (arms and legs),
   scales to 1.75 m and bakes the shape-key deltas into the new pose.
2. `mesh.py SEX OUT` — builds the skinned GLB in Blender on the UAL armature (bone heads moved to the
   MakeHuman joints, orientations kept so UAL rotations apply unchanged), clothing shells, hair cap, eyes,
   the `blink` key from MakeHuman's eyelid weights.
3. `anims.py OUT '[clip names]'` — merges UAL1 (renamed `DEF-` bones) and UAL2 clips onto one skeleton.
4. `gltfpack -i in.glb -o out.glb -c -kn` (clips also `-af 30`).
5. `calib.py` — measures how much each shape key changes each girth (`RIG_CAL` in `js/avatar-model.js`).

At runtime the clips are bound by bone name; only rotations and the pelvis travel (scaled to the leg length)
are used. Eat, drink, stretch-and-wipe and fist pump are authored in `js/avatar-rig.js` with two-bone IK on top
of the idle / sitting poses because the free library has no such clips.
