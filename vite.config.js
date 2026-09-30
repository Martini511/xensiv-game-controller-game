import { defineConfig } from "vite";

export default defineConfig({
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
