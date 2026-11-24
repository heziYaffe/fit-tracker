`three-avatar.js` is three.js r187 (MIT), tree-shaken to only what `js/avatar3d.js` and `js/avatar-rig.js` use
(plus `GLTFLoader` and `MeshoptDecoder` from three's examples for the experimental realistic avatar), so it is
~655 KB (~167 KB gzip) instead of ~2 MB.
Rebuild:

    npm i three@0.187.0 esbuild@0.24.0
    # entry.js re-exports the names imported at the top of js/avatar3d.js and js/avatar-rig.js (plus REVISION):
    #   export { …, AnimationMixer, AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, LoopOnce, LoopRepeat, Quaternion } from 'three';
    #   export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
    #   export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
    npx esbuild entry.js --bundle --format=esm --minify --legal-comments=inline --target=es2018,safari14 --outfile=three-avatar.js
