import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BOARD_MID_Y,
  CHARACTER_HEIGHT,
  MAX_GROUND_HEIGHT_MM,
  MODEL_ROTATION_X,
  OBSTACLE_HEIGHT_MM,
  SCALE_FACTOR,
  SIDE_FLIP_Z,
  WORLD_PER_MM,
  buildLevel,
} from "./level-config.js";

/** Attribute, die fuer die Darstellung gebraucht werden - der Rest fliegt raus. */
const KEPT_ATTRIBUTES = ["position", "normal", "uv"];

/** Kantenlaenge einer Zelle des Hoehenrasters (0.5 mm in Weltunits). */
const HEIGHT_CELL_SIZE = WORLD_PER_MM * 0.5;

/**
 * Kapselt das geladene Platinen-Modell:
 *  - bringt es in Weltkoordinaten (CAD Z-up, Meter -> Three.js Y-up, skaliert)
 *  - sortiert jedes Mesh nach Ober-/Unterseite
 *  - fasst alle Meshes je Seite und Material zu wenigen Batches zusammen
 *  - kippt die Platine um 180 Grad, wenn die Unterseite begangen wird
 *  - leitet aus der Geometrie Hindernisse und ein Hoehenraster ab
 *
 * Das Zusammenfassen (Merging) ist der entscheidende Performance-Hebel: das
 * CAD-Modell besteht aus ueber 1300 Einzel-Meshes, was pro Frame genauso viele
 * Draw-Calls bedeutet. Nach dem Merge bleibt pro Seite nur noch ein Batch je
 * Material uebrig. Die jeweils abgewandte Seite wird zusaetzlich komplett
 * ausgeblendet, damit sie weder gezeichnet noch fuer den Shadow-Pass
 * durchlaufen wird.
 */
export class Board {
  constructor(gltfScene) {
    this.object3D = new THREE.Group();
    this.object3D.name = "Platine";

    // Hilfs-Root, der die CAD->Welt-Transformation traegt. Sie wird beim Merge
    // in die Geometrien eingebacken, danach wird dieser Root verworfen.
    const source = new THREE.Group();
    source.rotation.x = MODEL_ROTATION_X;
    source.scale.setScalar(SCALE_FACTOR);
    source.add(gltfScene);
    source.updateMatrixWorld(true);

    const buckets = { top: new Map(), bottom: new Map(), shared: new Map() };
    const collision = {
      top: { obstacles: [], blockers: [], walkY: buildLevel("top").y },
      bottom: { obstacles: [], blockers: [], walkY: buildLevel("bottom").y },
    };
    // Die Unterseite wird beim Begehen um 180 Grad um Z gekippt - die
    // Kollisionsdaten muessen in derselben Orientierung vorliegen.
    const flip = new THREE.Matrix4().makeRotationZ(SIDE_FLIP_Z.bottom);
    const obstacleHeight = OBSTACLE_HEIGHT_MM * WORLD_PER_MM;

    const worldBox = new THREE.Box3();
    const sideBox = new THREE.Box3();
    let sourceMeshes = 0;

    source.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      sourceMeshes++;

      worldBox.setFromObject(object);
      const side =
        worldBox.min.y >= BOARD_MID_Y
          ? "top"
          : worldBox.max.y <= BOARD_MID_Y
            ? "bottom"
            : "shared";

      // Bauteile, die das Substrat durchstossen, sind auf beiden Seiten da.
      for (const target of side === "shared" ? ["top", "bottom"] : [side]) {
        sideBox.copy(worldBox);
        if (target === "bottom") sideBox.applyMatrix4(flip);

        const footprint = {
          minX: sideBox.min.x,
          maxX: sideBox.max.x,
          minZ: sideBox.min.z,
          maxZ: sideBox.max.z,
          top: sideBox.max.y,
        };
        const bucket = collision[target];

        if (footprint.top <= bucket.walkY + obstacleHeight) continue;

        // Hoch genug, um die Kamera zu verdecken - auch reine Ueberhaenge wie
        // der ueberstehende Joystick-Kopf.
        bucket.blockers.push({
          minX: footprint.minX,
          maxX: footprint.maxX,
          minZ: footprint.minZ,
          maxZ: footprint.maxZ,
          minY: sideBox.min.y,
          maxY: sideBox.max.y,
        });

        // Ragt in Kopfhoehe hinein -> blockiert. Sonst schwebt es ueber dem
        // Kopf (z.B. der Joystick-Kopf) und wird ignoriert.
        if (sideBox.min.y < bucket.walkY + CHARACTER_HEIGHT) {
          bucket.obstacles.push(footprint);
        }
      }

      // Mehrmaterial-Meshes haben Geometry-Groups und lassen sich nicht sinnvoll
      // batchen - die werden einzeln uebernommen.
      if (Array.isArray(object.material)) {
        buckets[side].set(`single_${sourceMeshes}`, {
          material: object.material,
          geometries: [bakeGeometry(object, false)],
        });
        return;
      }

      const geometry = bakeGeometry(object, true);
      const key = `${object.material.uuid}|${geometrySignature(geometry)}`;
      const existing = buckets[side].get(key);
      if (existing) {
        existing.geometries.push(geometry);
      } else {
        buckets[side].set(key, { material: object.material, geometries: [geometry] });
      }
    });

    this.groups = {
      top: mergeBucket(buckets.top, "Oberseite"),
      bottom: mergeBucket(buckets.bottom, "Unterseite"),
      shared: mergeBucket(buckets.shared, "Durchgehend"),
    };
    this.object3D.add(this.groups.top, this.groups.bottom, this.groups.shared);

    disposeSource(source);

    this.boundingBox = new THREE.Box3().setFromObject(this.object3D);
    this.size = this.boundingBox.getSize(new THREE.Vector3());

    this.obstacles = {
      top: dropContained(collision.top.obstacles),
      bottom: dropContained(collision.bottom.obstacles),
    };
    this.cameraBlockers = {
      top: dropContained3D(collision.top.blockers),
      bottom: dropContained3D(collision.bottom.blockers),
    };
    this.heightFields = {
      top: buildHeightField(
        [this.groups.top, this.groups.shared],
        new THREE.Matrix4(),
        this.boundingBox,
        collision.top.walkY
      ),
      bottom: buildHeightField(
        [this.groups.bottom, this.groups.shared],
        flip,
        this.boundingBox,
        collision.bottom.walkY
      ),
    };

    console.log(
      `[Platine] ${sourceMeshes} Meshes zu ${this.drawCallCount} Batches zusammengefasst ` +
        `(Oberseite ${this.groups.top.children.length}, Unterseite ${this.groups.bottom.children.length}, ` +
        `durchgehend ${this.groups.shared.children.length}).`
    );
    console.log(
      `[Platine] Hindernisse ab ${OBSTACLE_HEIGHT_MM} mm Hoehe - ` +
        `Oberseite ${this.obstacles.top.length}, Unterseite ${this.obstacles.bottom.length} Boxen; ` +
        `Kamera-Blocker ${this.cameraBlockers.top.length} / ${this.cameraBlockers.bottom.length}.`
    );
  }

  get drawCallCount() {
    return (
      this.groups.top.children.length +
      this.groups.bottom.children.length +
      this.groups.shared.children.length
    );
  }

  /**
   * Hoehe der begehbaren Oberflaeche an dieser Stelle. Gibt NaN zurueck, wo
   * keine Platine ist - dort faellt der Charakter herunter.
   */
  sampleHeight(side, x, z) {
    const field = this.heightFields[side];
    const col = Math.floor((x - field.minX) / HEIGHT_CELL_SIZE);
    const row = Math.floor((z - field.minZ) / HEIGHT_CELL_SIZE);
    if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return NaN;
    return field.data[row * field.cols + col];
  }

  /** Blendet die abgewandte Seite aus und kippt die Platine passend. */
  setVisibleSide(side) {
    this.groups.top.visible = side === "top";
    this.groups.bottom.visible = side === "bottom";
    this.object3D.rotation.z = SIDE_FLIP_Z[side];
  }
}

/**
 * Rastert die Dreiecke der sichtbaren Geometrie in ein Hoehengitter.
 *
 * Bewusst dreiecksgenau statt ueber Bounding-Boxen: nur so folgt die begehbare
 * Flaeche der echten Platinenkontur (die Platine ist controller-foermig, nicht
 * rechteckig) und nur so entsteht ausserhalb ein echtes Loch, in das der
 * Charakter faellt. Zellen ohne Treffer bleiben NaN.
 *
 * Zu hohe Flaechen werden uebersprungen, sonst waere die Oberkante des
 * Joystick-Kopfes der "Boden" unter ihm.
 */
function buildHeightField(groups, matrix, bounds, walkY) {
  const minX = bounds.min.x - HEIGHT_CELL_SIZE;
  const minZ = bounds.min.z - HEIGHT_CELL_SIZE;
  const cols = Math.ceil((bounds.max.x - minX) / HEIGHT_CELL_SIZE) + 1;
  const rows = Math.ceil((bounds.max.z - minZ) / HEIGHT_CELL_SIZE) + 1;
  const data = new Float32Array(cols * rows).fill(NaN);
  const field = { data, cols, rows, minX, minZ, baseY: walkY };
  const limitY = walkY + MAX_GROUND_HEIGHT_MM * WORLD_PER_MM;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (const group of groups) {
    for (const mesh of group.children) {
      const position = mesh.geometry.attributes.position;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;

      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);

        // Komplette Dreiecke verwerfen, die ueber das Limit reichen - sonst
        // entstuenden an den Flanken hoher Bauteile Plateaus auf Limit-Hoehe.
        if (Math.max(a.y, b.y, c.y) > limitY) continue;
        rasterizeTriangle(a, b, c, field);
      }
    }
  }

  return field;
}

/** Scanline-freie Variante: Zellmittelpunkte im Dreiecks-Bounding-Rechteck testen. */
function rasterizeTriangle(a, b, c, field) {
  const { data, cols, rows, minX, minZ } = field;

  const colStart = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / HEIGHT_CELL_SIZE));
  const colEnd = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / HEIGHT_CELL_SIZE));
  const rowStart = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - minZ) / HEIGHT_CELL_SIZE));
  const rowEnd = Math.min(rows - 1, Math.floor((Math.max(a.z, b.z, c.z) - minZ) / HEIGHT_CELL_SIZE));
  if (colStart > colEnd || rowStart > rowEnd) return;

  // Flaeche in der XZ-Projektion. Nahezu senkrechte Dreiecke (Bauteilflanken)
  // haben hier fast keine Flaeche und treffen deshalb keine Zellmitte.
  const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(area) < 1e-9) return;
  const inverseArea = 1 / area;

  for (let row = rowStart; row <= rowEnd; row++) {
    const pz = minZ + (row + 0.5) * HEIGHT_CELL_SIZE;
    const offset = row * cols;

    for (let col = colStart; col <= colEnd; col++) {
      const px = minX + (col + 0.5) * HEIGHT_CELL_SIZE;

      const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) * inverseArea;
      if (w0 < 0 || w0 > 1) continue;
      const w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) * inverseArea;
      if (w1 < 0 || w1 > 1) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < 0 || w2 > 1) continue;

      const height = w0 * a.y + w1 * b.y + w2 * c.y;
      const cell = offset + col;
      if (!(data[cell] >= height)) data[cell] = height;
    }
  }
}

/**
 * Wirft Hindernis-Rechtecke weg, die vollstaendig in einem anderen liegen. Ein
 * Bauteil besteht im CAD-Modell aus vielen Einzel-Solids, die sich gegenseitig
 * umschliessen - das duennt die Liste deutlich aus, ohne die blockierte
 * Flaeche zu veraendern.
 */
function dropContained(boxes) {
  const sorted = [...boxes].sort((a, b) => area(b) - area(a));
  const kept = [];

  for (const box of sorted) {
    if (!kept.some((other) => contains(other, box))) kept.push(box);
  }

  return kept;
}

const area = (b) => (b.maxX - b.minX) * (b.maxZ - b.minZ);

const contains = (outer, inner) =>
  outer.minX <= inner.minX &&
  outer.maxX >= inner.maxX &&
  outer.minZ <= inner.minZ &&
  outer.maxZ >= inner.maxZ &&
  outer.top >= inner.top;

/** Dieselbe Ausduennung fuer die 3D-Boxen der Kamera-Kollision. */
function dropContained3D(boxes) {
  const sorted = [...boxes].sort((a, b) => volume(b) - volume(a));
  const kept = [];

  for (const box of sorted) {
    if (!kept.some((other) => contains3D(other, box))) kept.push(box);
  }

  return kept;
}

const volume = (b) => (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ);

const contains3D = (outer, inner) =>
  outer.minX <= inner.minX &&
  outer.maxX >= inner.maxX &&
  outer.minY <= inner.minY &&
  outer.maxY >= inner.maxY &&
  outer.minZ <= inner.minZ &&
  outer.maxZ >= inner.maxZ;

/** Klont die Geometrie und backt die Welt-Transformation des Meshes ein. */
function bakeGeometry(mesh, stripAttributes) {
  const geometry = mesh.geometry.clone();

  if (stripAttributes) {
    for (const name of Object.keys(geometry.attributes)) {
      if (!KEPT_ATTRIBUTES.includes(name)) geometry.deleteAttribute(name);
    }
    geometry.morphAttributes = {};
    geometry.clearGroups();
  }

  geometry.applyMatrix4(mesh.matrixWorld);
  return geometry;
}

/** mergeGeometries verlangt identische Attribute und gleiche Index-Variante. */
function geometrySignature(geometry) {
  return `${Object.keys(geometry.attributes).sort().join(",")}|${geometry.index ? "i" : "n"}`;
}

function mergeBucket(bucket, name) {
  const group = new THREE.Group();
  group.name = name;

  for (const { material, geometries } of bucket.values()) {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);

    if (merged) {
      if (merged !== geometries[0]) geometries.forEach((geometry) => geometry.dispose());
      group.add(createBatch(merged, material));
      continue;
    }

    // Sollte nicht vorkommen; falls doch, lieber einzeln rendern als verlieren.
    console.warn(`[Platine] Merge fehlgeschlagen fuer Material "${material.name}"`);
    for (const geometry of geometries) group.add(createBatch(geometry, material));
  }

  return group;
}

function createBatch(geometry, material) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  // Die Platine wirft bewusst keinen Schatten: der Shadow-Pass muesste sonst
  // das komplette Modell ein zweites Mal zeichnen. Schatten wirft nur der
  // Charakter, die Platine faengt ihn auf.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function disposeSource(source) {
  source.traverse((object) => {
    if (object.isMesh) object.geometry.dispose();
  });
  source.clear();
}
