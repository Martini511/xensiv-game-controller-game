import { statSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  // Unkomprimierte Groesse des Platinen-Modells fuer die Ladeanzeige: GitHub
  // Pages liefert das GLB gzip-komprimiert aus, Content-Length nennt dann nur
  // die komprimierte Groesse - der Fortschritt schoss so ueber 100 % hinaus.
  define: {
    __PLATINE_BYTES__: JSON.stringify(
      statSync(new URL("./src/assets/platine.glb", import.meta.url)).size
    ),
  },

  // Relative Asset-Pfade: damit laeuft derselbe Build sowohl unter
  // https://<user>.github.io/<repo>/ als auch unter jeder anderen URL,
  // ohne dass der Repository-Name fest im Code steht.
  base: "./",

  // Verhindert, dass der Kern von Three.js und die Addons (GLTFLoader) je eine
  // eigene Kopie von "three" bekommen - sonst warnt Three beim Start.
  resolve: {
    dedupe: ["three"],
  },
  optimizeDeps: {
    include: [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/utils/BufferGeometryUtils.js",
    ],
  },
  // Das GLB ist mehrere MB gross - nicht inlinen.
  build: {
    assetsInlineLimit: 0,
  },
});
