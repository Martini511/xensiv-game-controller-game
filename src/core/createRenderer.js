import * as THREE from "three";

/** Hoehere Werte kosten quadratisch Fuellrate und bringen optisch kaum etwas. */
const MAX_PIXEL_RATIO = 1.5;

/** Auf false setzen, wenn die Framerate auf schwacher Hardware nicht reicht. */
const ENABLE_SHADOWS = true;

/**
 * Erstellt Renderer und Kamera und haelt beide auf Fenstergroesse synchron.
 * Gibt eine dispose()-Funktion zurueck, die den Resize-Listener wieder loest.
 */
export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = ENABLE_SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 5, 8);

  const handleResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
  };

  window.addEventListener("resize", handleResize);

  return {
    renderer,
    camera,
    dispose() {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
