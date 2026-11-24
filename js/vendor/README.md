`three-avatar.js` is three.js r187 (MIT), tree-shaken to only the classes `js/avatar3d.js` uses, so it is ~535 KB (~137 KB gzip) instead of ~2 MB.
Rebuild:

    npm i three@0.187.0 esbuild@0.24.0
    # entry.js re-exports the names imported at the top of js/avatar3d.js and js/avatar-chibi.js (plus REVISION)
    npx esbuild entry.js --bundle --format=esm --minify --legal-comments=inline --target=es2018,safari14 --outfile=three-avatar.js
