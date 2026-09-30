import * as THREE from "three";

/** Richtung, aus der das Hauptlicht kommt (normalisiert in fitToBounds). */
const LIGHT_DIRECTION = new THREE.Vector3(0.6, 1, 0.4).normalize();

/**
 * Kantenlaenge des Schattenbereichs um den Charakter. Klein halten: Schatten
 * wirft nur der Charakter, ein Frustum ueber die ganze Platine wuerde die
 * Aufloesung verschenken und kostet Renderzeit.
 */
const SHADOW_RADIUS = 4;

/**
 * Baut die Grundszene: Licht und Fog. Der begehbare Untergrund kommt aus dem
 * geladenen Platinen-Modell (siehe Board.js), eine Platzhalter-Bodenebene
 * gibt es deshalb nicht mehr.
 *
 * `worldSize` ist nur ein Startwert fuer Fog und Shadow-Kamera; beides wird
 * nach dem Laden ueber `fitToBounds()` auf die echten Modellmasse gezogen.
 */
export function createScene({ worldSize = 20 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);
  scene.fog = new THREE.Fog(0x0b0e14, worldSize * 0.9, worldSize * 2.6);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024);
  directionalLight.shadow.bias = -0.0008;
  scene.add(directionalLight);
  scene.add(directionalLight.target);

  // Schwaches Gegenlicht, damit senkrechte Bauteilflanken nicht absaufen.
  const fillLight = new THREE.DirectionalLight(0x9fc4ff, 0.7);
  fillLight.position.set(-0.4, 0.5, -0.9).multiplyScalar(worldSize);
  scene.add(fillLight);

  let lightDistance = worldSize;

  /** Zieht Fog, Lichter und Shadow-Frustum auf die echte Modellgroesse. */
  function fitToBounds(box) {
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.6;

    scene.fog.near = radius * 1.3;
    scene.fog.far = radius * 4.5;

    lightDistance = radius * 2;
    fillLight.position.set(-0.4, 0.5, -0.9).normalize().multiplyScalar(radius * 3);

    const shadow = directionalLight.shadow.camera;
    shadow.left = -SHADOW_RADIUS;
    shadow.right = SHADOW_RADIUS;
    shadow.top = SHADOW_RADIUS;
    shadow.bottom = -SHADOW_RADIUS;
    shadow.near = 0.5;
    shadow.far = lightDistance * 2;
    shadow.updateProjectionMatrix();
  }

  /** Fuehrt Licht und Schattenbereich dem Charakter nach. */
  function focusShadow(position) {
    directionalLight.target.position.copy(position);
    directionalLight.target.updateMatrixWorld();
    directionalLight.position
      .copy(LIGHT_DIRECTION)
      .multiplyScalar(lightDistance)
      .add(position);
  }

  return { scene, ambientLight, directionalLight, fillLight, fitToBounds, focusShadow };
}
