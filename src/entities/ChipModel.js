import * as THREE from "three";

/**
 * Der Spieler-Charakter: ein DSO-16-Chip, der auf seinen Pins laeuft.
 *
 * Das GLB bringt keine Animation mit - es besteht aus 34 unbewegten Meshes.
 * Die 16 Pins werden hier deshalb zur Laufzeit "gerigged": jeder bekommt eine
 * Drehachse am Uebergang zum Gehaeuse, und die Beine schwingen als
 * wandernde Welle wie bei einem Tausendfuessler.
 */

/**
 * Zielbreite des Chips in Weltunits. Das GLB bringt eine eigene
 * Einheitenskalierung mit, deshalb wird nicht mit einem festen Faktor
 * gerechnet, sondern auf diese Breite normiert - etwa die Groesse, die ein
 * SO-8 auf dieser Platine haette.
 */
const TARGET_WIDTH = 2.0;

/** Das Modell ist wie die Platine Z-up (CAD-Export). */
const MODEL_ROTATION_X = -Math.PI / 2;

/**
 * Anteil der Modellhoehe, den ein Mesh ueber dem tiefsten Punkt liegen darf,
 * um noch als Pin zu gelten. Relativ, weil das GLB seine eigene
 * Einheitenskalierung mitbringt.
 */
const FOOT_TOLERANCE = 0.05;

/** Maximaler Ausschlag eines Beins in Radiant. */
const SWING_ANGLE = 0.42;

/** Weltunits Strecke pro Schrittzyklus, und die Obergrenze der Schrittfrequenz. */
const STRIDE_UNITS = 1.0;
const MAX_STEP_HZ = 7;

/** Phasenversatz von Bein zu Bein - ergibt die wandernde Welle. */
const WAVE_PER_LEG = (Math.PI * 2) / 3;

/** Wie schnell die Beine beim Anhalten in die Ruhelage zurueckgehen. */
const AMPLITUDE_DAMPING = 9;

/**
 * Das GLB liefert alle Materialien mit schwarzem baseColorFactor - der Chip
 * waere auf der dunklen Platine unsichtbar. Deshalb werden sie nach Bauteil
 * neu vergeben.
 */
const MATERIALS = {
  body: new THREE.MeshStandardMaterial({ color: 0x4a515a, roughness: 0.52, metalness: 0.15 }),
  print: new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.75, metalness: 0 }),
  pin: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 0.85 }),
};

/** Oberhalb dieser relativen Dicke ist ein Mesh Gehaeuse, darunter Bedruckung. */
const PRINT_THICKNESS = 0.03;

export class ChipModel {
  constructor(gltfScene, { targetWidth = TARGET_WIDTH } = {}) {
    this.object3D = new THREE.Group();
    this.object3D.name = "ChipCharacter";

    // Das GLB bringt eine eigene Einheitenskalierung mit - deshalb messen
    // statt annehmen.
    const bounds = new THREE.Box3().setFromObject(gltfScene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = targetWidth / Math.max(size.x, size.y);

    const root = new THREE.Group();
    root.rotation.x = MODEL_ROTATION_X;
    root.scale.setScalar(scale);

    // Chip waagerecht zentrieren und die Fuesse auf Hoehe 0 legen.
    const offset = new THREE.Group();
    offset.position.set(-center.x, -center.y, -bounds.min.z);
    offset.add(gltfScene);

    root.add(offset);
    this.object3D.add(root);

    this.legs = rigLegs(gltfScene);
    this._phase = 0;
    this._amplitude = 0;

    const legMeshes = new Set(this.legs.map((leg) => leg.mesh));
    for (const mesh of meshesOf(gltfScene)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material = pickMaterial(mesh, legMeshes, size.z);
    }

    console.log(
      `[Spieler] ${this.legs.length} Pins als Beine gerigged, ` +
        `Modell ${size.toArray().map((v) => v.toFixed(3)).join(" x ")} -> Faktor ${scale.toFixed(1)}.`
    );
  }

  /**
   * @param {number} deltaTime
   * @param {number} speed Horizontalgeschwindigkeit in Weltunits/s
   */
  update(deltaTime, speed) {
    const moving = speed > 0.05;

    // Schrittfrequenz folgt der Geschwindigkeit, ist aber gedeckelt - die Pins
    // sind so kurz, dass echtes Abrollen absurd schnell waere.
    if (moving) {
      const hertz = Math.min(speed / STRIDE_UNITS, MAX_STEP_HZ);
      this._phase += hertz * Math.PI * 2 * deltaTime;
    }

    const target = moving ? SWING_ANGLE : 0;
    this._amplitude +=
      (target - this._amplitude) * (1 - Math.exp(-AMPLITUDE_DAMPING * deltaTime));

    for (const leg of this.legs) {
      leg.pivot.rotation.x = Math.sin(this._phase + leg.phase) * this._amplitude;
    }
  }
}

/**
 * Haengt jeden bodenberuehrenden Mesh unter eine eigene Drehgruppe, deren
 * Ursprung am Gehaeuse sitzt (innere Kante in X, Oberkante in Z). Dadurch
 * schwingt der Pin um seinen Fusspunkt am Koerper statt um den Modellursprung.
 */
function rigLegs(gltfScene) {
  const legs = [];
  const pivotPosition = new THREE.Vector3();
  const meshes = meshesOf(gltfScene);

  for (const mesh of meshes) bakeOwnTransform(mesh);
  const boxes = meshes.map((mesh) => mesh.geometry.boundingBox);
  const groundZ = Math.min(...boxes.map((box) => box.min.z));
  const topZ = Math.max(...boxes.map((box) => box.max.z));
  const footLimit = groundZ + (topZ - groundZ) * FOOT_TOLERANCE;

  for (const mesh of meshes) {
    const box = mesh.geometry.boundingBox;
    if (box.min.z > footLimit) continue;

    const innerX = Math.abs(box.min.x) < Math.abs(box.max.x) ? box.min.x : box.max.x;
    pivotPosition.set(innerX, (box.min.y + box.max.y) / 2, box.max.z);

    const pivot = new THREE.Group();
    pivot.position.copy(pivotPosition);
    mesh.geometry.translate(-pivotPosition.x, -pivotPosition.y, -pivotPosition.z);

    // Wichtig: in denselben Elternknoten haengen. Die GLTF-Szene hat eigene
    // Zwischenknoten mit Skalierung - ein Umhaengen nach oben wuerde den Pin
    // in einen anderen Massstab versetzen.
    mesh.parent.add(pivot);
    pivot.add(mesh);

    legs.push({ pivot, mesh, side: Math.sign(innerX) || 1, y: pivotPosition.y });
  }

  // Von hinten nach vorne durchnummerieren, linke Seite um eine halbe Periode
  // versetzt - so laeuft die Welle diagonal statt im Gleichschritt.
  legs.sort((a, b) => a.y - b.y);
  const indexPerSide = new Map();
  for (const leg of legs) {
    const index = indexPerSide.get(leg.side) ?? 0;
    indexPerSide.set(leg.side, index + 1);
    leg.phase = -index * WAVE_PER_LEG + (leg.side < 0 ? Math.PI : 0);
  }

  return legs;
}

function meshesOf(root) {
  const meshes = [];
  root.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  return meshes;
}

/**
 * Backt eine evtl. vorhandene Eigen-Transformation des Meshes in die Geometrie,
 * damit Pivot-Berechnung und Geometrie im selben Koordinatensystem liegen.
 */
function bakeOwnTransform(mesh) {
  mesh.updateMatrix();
  if (!mesh.matrix.equals(IDENTITY)) {
    mesh.geometry.applyMatrix4(mesh.matrix);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
  }
  mesh.geometry.computeBoundingBox();
}

const IDENTITY = new THREE.Matrix4();

function pickMaterial(mesh, legMeshes, modelHeight) {
  if (legMeshes.has(mesh)) return MATERIALS.pin;

  const box = mesh.geometry.boundingBox;
  const thin = box && box.max.z - box.min.z < modelHeight * PRINT_THICKNESS;
  return thin ? MATERIALS.print : MATERIALS.body;
}
