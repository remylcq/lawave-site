# Three.js (r170), servi avec le site

Fichiers pris tels quels dans le paquet npm officiel `three@0.170.0` (intégrité SHA-512 vérifiée), licence MIT (`LICENSE`) :

- `three.module.min.js` : `build/three.module.min.js`
- `GLTFLoader.js` : `examples/jsm/loaders/GLTFLoader.js`
- `BufferGeometryUtils.js` : `examples/jsm/utils/BufferGeometryUtils.js`
- `meshopt_decoder.module.js` : `examples/jsm/libs/meshopt_decoder.module.js` (lit les .glb compressés par meshopt)

Seul changement : les imports (`from 'three'` devient `from './three.module.min.js'`, et celui de `BufferGeometryUtils`), pour que les fichiers
se chargent sans table d'import dans la page. `waveurs.js` les charge par `import()` (voir `assurerThree`).
Pour changer de version : retélécharger ces quatre fichiers et refaire ces deux remplacements.
