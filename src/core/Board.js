import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BOARD,
  BOARD_MID_Y,
  CHARACTER_HEIGHT,
  ENTERABLE_CELL_MM,
  ENTERABLE_MIN_HEIGHT_MM,
  ENTERABLE_PARTS,
  MAX_GROUND_HEIGHT_MM,
  MODEL_ROTATION_X,
  OBSTACLE_HEIGHT_MM,
  PUSH_BUTTONS,
  PUSH_BUTTON_CAP_MM,
  PUSH_BUTTON_TRAVEL_MM,
  SCALE_FACTOR,
  SIDE_FLIP_Z,
  WORLD_PER_MM,
  buildLevel,
} from "./level-config.js";

/** Attribute, die fuer die Darstellung gebraucht werden - der Rest fliegt raus. */
const KEPT_ATTRIBUTES = ["position", "normal", "uv"];

/** Kantenlaenge einer Zelle des Hoehenrasters (0.5 mm in Weltunits). */
export const HEIGHT_CELL_SIZE = WORLD_PER_MM * 0.5;

/**
 * So viele uebereinanderliegende Flaechen merkt sich eine Rasterzelle. Ohne
 * diese Schichten waere unter dem Display dessen Oberseite der "Boden" - man
 * koennte nicht darunter hindurchlaufen.
 */
const MAX_LAYERS = 6;

/** Flaechen, die dichter beieinander liegen, zaehlen als eine Schicht. */
const LAYER_MERGE = WORLD_PER_MM * 0.6;

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
    const sideMatrix = new THREE.Matrix4();
    const obstacleHeight = OBSTACLE_HEIGHT_MM * WORLD_PER_MM;

    const worldBox = new THREE.Box3();
    const sideBox = new THREE.Box3();
    let sourceMeshes = 0;
    /** Kappen der Taster - beweglich, deshalb weder gebatcht noch im Hoehenraster. */
    const capParts = new Map();
    /** Meshes begehbarer Bauteile - bekommen statt der Box eine feine Kollision. */
    const enterableParts = new Map();

    source.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      sourceMeshes++;

      worldBox.setFromObject(object);

      const button = matchPushButtonCap(worldBox);
      if (button) {
        if (!capParts.has(button)) capParts.set(button, []);
        capParts.get(button).push({ object, box: worldBox.clone() });
        return;
      }

      const enterable = matchEnterablePart(worldBox);
      if (enterable) {
        // Eigene Meshes statt Batch: das Bauteil wird transparent, wenn der
        // Chip drin steht, und hat keine grobe Hindernis-Box.
        if (!enterableParts.has(enterable)) enterableParts.set(enterable, []);
        enterableParts.get(enterable).push(object);
        return;
      }

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
        if (sideBox.min.y >= bucket.walkY + CHARACTER_HEIGHT) continue;

        // Nur der Teil zaehlt, an dem der Chip wirklich anstoesst: hoeher als
        // die Stufengrenze (darunter steigt er hinauf) und nicht hoeher als
        // sein Kopf (darueber - etwa der Joystick-Kopf - laeuft er hindurch).
        sideMatrix.copy(object.matrixWorld);
        if (target === "bottom") sideMatrix.premultiply(flip);

        const blocking = bandFootprint(
          object,
          sideMatrix,
          bucket.walkY + obstacleHeight,
          bucket.walkY + obstacleHeight + CHARACTER_HEIGHT
        );
        if (blocking) {
          blocking.top = footprint.top;
          bucket.obstacles.push(blocking);
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

    /** Eigene Gruppen je Seite: das Hoehenraster liest nur die Batches oben. */
    this.buttonGroups = { top: new THREE.Group(), bottom: new THREE.Group() };
    this.buttonGroups.top.name = "Taster Oberseite";
    this.buttonGroups.bottom.name = "Taster Unterseite";
    this.object3D.add(this.buttonGroups.top, this.buttonGroups.bottom);
    this.pushButtons = buildPushButtons(capParts, this.buttonGroups, flip);

    /**
     * Feine Kollision der begehbaren Bauteile: Quader mit Unter- und
     * Oberkante. Ein Quader ist nur dann Wand, wenn er die Figur auf ihrer
     * aktuellen Hoehe trifft - darunter hindurch und darauf geht.
     */
    this.solids = buildSolids(enterableParts, flip, collision);
    for (const side of ["top", "bottom"]) {
      computeHeadroom(this.solids[side]);
      for (const box of this.solids[side]) {
        if (box.top > collision[side].walkY + obstacleHeight) {
          collision[side].blockers.push({ ...box, minY: box.bottom, maxY: box.top });
        }
      }
    }

    /** Begehbare Bauteile als eigene Meshes - gehen ins Hoehenraster mit ein. */
    this.enterableGroups = { top: new THREE.Group(), bottom: new THREE.Group() };
    this.enterableGroups.top.name = "Begehbar Oberseite";
    this.enterableGroups.bottom.name = "Begehbar Unterseite";
    this.object3D.add(this.enterableGroups.top, this.enterableGroups.bottom);
    /** id -> eigene Materialien, damit nur dieses Bauteil ausgeblendet wird. */
    this.enterableMaterials = new Map();
    for (const [part, meshes] of enterableParts) {
      const materials = new Map();
      for (const mesh of meshes) {
        const own = Array.isArray(mesh.material)
          ? mesh.material.map((m) => cloneOnce(materials, m))
          : cloneOnce(materials, mesh.material);
        this.enterableGroups[part.side].add(createBatch(bakeGeometry(mesh, false), own));
      }
      this.enterableMaterials.set(part.id, [...materials.values()]);
    }

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
        [this.groups.top, this.groups.shared, this.enterableGroups.top],
        new THREE.Matrix4(),
        this.boundingBox,
        collision.top.walkY
      ),
      bottom: buildHeightField(
        [this.groups.bottom, this.groups.shared, this.enterableGroups.bottom],
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
   * Hoechste begehbare Flaeche an dieser Stelle, die nicht ueber `maxY` liegt.
   * Die Grenze waehlt zwischen den Schichten: unter dem Display liefert sie
   * die Platine, oben darauf die Display-Oberseite. NaN, wenn nichts passt.
   */
  sampleHeight(side, x, z, maxY = Infinity) {
    const base = this._cellBase(side, x, z);
    if (base < 0) return NaN;

    const data = this.heightFields[side].data;
    let height = NaN;

    for (let k = 0; k < MAX_LAYERS; k++) {
      const value = data[base + k];
      if (Number.isNaN(value) || value > maxY) continue;
      if (Number.isNaN(height) || value > height) height = value;
    }

    // Tasterkappen stehen nicht im Raster - ihre Hoehe haengt vom Druck ab.
    const button = this.pushButtonAt(side, x, z);
    if (button) {
      const value = button.top - button.depth;
      if (value <= maxY && (Number.isNaN(height) || value > height)) height = value;
    }

    return height;
  }

  /** Tasterkappe, die an dieser Stelle liegt - oder null. */
  pushButtonAt(side, x, z) {
    for (const button of this.pushButtons) {
      if (
        button.side === side &&
        x >= button.minX &&
        x <= button.maxX &&
        z >= button.minZ &&
        z <= button.maxZ
      ) {
        return button;
      }
    }
    return null;
  }

  /** Drueckt eine Tasterkappe um `depth` Weltunits ein (0 = Ruhelage). */
  setPushButtonDepth(button, depth) {
    button.depth = depth;
    // Im ungekippten Modell zeigt die Unterseite nach -Y: Eindruecken heisst
    // dort +Y, also Richtung Platine.
    button.object3D.position.y = button.side === "bottom" ? depth : -depth;
  }

  /**
   * Ob hier ueberhaupt Platine liegt - unabhaengig von der Hoehe. Nur wo das
   * nicht gilt, faellt der Charakter herunter.
   */
  hasGround(side, x, z) {
    const base = this._cellBase(side, x, z);
    // Schichten werden luckenlos von unten aufgefuellt: Slot 0 leer = Zelle leer.
    return base >= 0 && !Number.isNaN(this.heightFields[side].data[base]);
  }

  /** Index der ersten Schicht einer Zelle, oder -1 ausserhalb des Rasters. */
  _cellBase(side, x, z) {
    const field = this.heightFields[side];
    const col = Math.floor((x - field.minX) / HEIGHT_CELL_SIZE);
    const row = Math.floor((z - field.minZ) / HEIGHT_CELL_SIZE);
    if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return -1;
    return (row * field.cols + col) * MAX_LAYERS;
  }

  /** Blendet die abgewandte Seite aus und kippt die Platine passend. */
  setVisibleSide(side) {
    this.groups.top.visible = side === "top";
    this.groups.bottom.visible = side === "bottom";
    this.buttonGroups.top.visible = side === "top";
    this.buttonGroups.bottom.visible = side === "bottom";
    this.enterableGroups.top.visible = side === "top";
    this.enterableGroups.bottom.visible = side === "bottom";
    this.object3D.rotation.z = SIDE_FLIP_Z[side];
  }

  /** Deckkraft eines begehbaren Bauteils (1 = normal). */
  setPartOpacity(id, opacity) {
    for (const material of this.enterableMaterials.get(id) ?? []) {
      const transparent = opacity < 0.999;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        // Durchscheinend darf es nichts dahinter aus dem Tiefenpuffer verdraengen.
        material.depthWrite = !transparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    }
  }
}

/** Klont ein Material nur einmal je Bauteil. */
function cloneOnce(cache, material) {
  if (!cache.has(material)) cache.set(material, material.clone());
  return cache.get(material);
}

/**
 * Ordnet ein Mesh einem Taster aus PUSH_BUTTONS zu, wenn es dessen Kappe ist:
 * Mitte ueber dem Taster, mit Abstand zur Platine und weit herausragend - das
 * Gehaeuse samt Deckblechen bleibt Teil des Batches.
 * Gerechnet wird im ungekippten Modell (Welt = CAD (x, z, -y) * Massstab).
 */
function matchPushButtonCap(box) {
  const tolerance = 0.8 * WORLD_PER_MM;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;

  for (const button of PUSH_BUTTONS) {
    if (Math.abs(centerX - button.x * WORLD_PER_MM) > tolerance) continue;
    if (Math.abs(centerZ + button.y * WORLD_PER_MM) > tolerance) continue;

    // Abstand der Innen- und Aussenseite des Teils zur Platinenoberflaeche
    const [inner, outer] =
      button.side === "bottom"
        ? [BOARD.bottomSurfaceZ * WORLD_PER_MM - box.max.y, BOARD.bottomSurfaceZ * WORLD_PER_MM - box.min.y]
        : [box.min.y - BOARD.topSurfaceZ * WORLD_PER_MM, box.max.y - BOARD.topSurfaceZ * WORLD_PER_MM];
    if (
      inner >= PUSH_BUTTON_CAP_MM.gap * WORLD_PER_MM &&
      outer >= PUSH_BUTTON_CAP_MM.top * WORLD_PER_MM
    ) {
      return button;
    }
  }
  return null;
}

/**
 * Ordnet ein Mesh einem begehbaren Bauteil zu, wenn es komplett in dessen
 * CAD-Rechteck liegt (ungekippt: Welt = CAD (x, z, -y) * Massstab) und
 * merklich ueber die Platine ragt. Flache Loetpads bleiben Teil der Platine -
 * durchscheinend wuerden sie mit der Platinenoberflaeche flackern.
 */
function matchEnterablePart(box) {
  for (const part of ENTERABLE_PARTS) {
    const onSide = part.side === "bottom" ? box.max.y <= BOARD_MID_Y : box.min.y >= BOARD_MID_Y;
    const height =
      part.side === "bottom"
        ? BOARD.bottomSurfaceZ * WORLD_PER_MM - box.min.y
        : box.max.y - BOARD.topSurfaceZ * WORLD_PER_MM;
    if (
      onSide &&
      height >= ENTERABLE_MIN_HEIGHT_MM * WORLD_PER_MM &&
      box.min.x >= part.minX * WORLD_PER_MM &&
      box.max.x <= part.maxX * WORLD_PER_MM &&
      box.min.z >= -part.maxY * WORLD_PER_MM &&
      box.max.z <= -part.minY * WORLD_PER_MM
    ) {
      return part;
    }
  }
  return null;
}

/**
 * Zerlegt begehbare Bauteile in Quader. Je Rasterzelle wird ein senkrechter
 * Strahl durch jedes Mesh geschickt; die Schnitthoehen paarweise ergeben die
 * Abschnitte, in denen Material ist (geschlossene CAD-Solids vorausgesetzt).
 * Benachbarte Zellen mit gleichen Abschnitten werden zu Rechtecken vereint.
 *
 * Ergebnis in der Orientierung der jeweiligen Seite (+Y = weg von der Platine).
 */
function buildSolids(enterableParts, flip, collision) {
  const solids = { top: [], bottom: [] };
  const cell = ENTERABLE_CELL_MM * WORLD_PER_MM;
  // Abschnitte duenner als das zaehlen nicht - Rundungsrauschen.
  const minThickness = WORLD_PER_MM * 0.05;
  const quantum = WORLD_PER_MM * 0.02;

  const matrix = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (const [part, meshes] of enterableParts) {
    const walkY = collision[part.side].walkY;
    /** Zellschluessel -> Liste [unten, oben] ueber alle Meshes. */
    const cells = new Map();

    for (const mesh of meshes) {
      matrix.copy(mesh.matrixWorld);
      if (part.side === "bottom") matrix.premultiply(flip);

      const position = mesh.geometry.attributes.position;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      const hits = new Map();

      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);

        const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
        if (Math.abs(area) < 1e-12) continue;

        const col0 = Math.floor(Math.min(a.x, b.x, c.x) / cell);
        const col1 = Math.floor(Math.max(a.x, b.x, c.x) / cell);
        const row0 = Math.floor(Math.min(a.z, b.z, c.z) / cell);
        const row1 = Math.floor(Math.max(a.z, b.z, c.z) / cell);

        for (let col = col0; col <= col1; col++) {
          // Kleiner Versatz, damit kein Strahl genau eine Dreieckskante trifft.
          const px = (col + 0.5) * cell + 1.3e-6;
          for (let row = row0; row <= row1; row++) {
            const pz = (row + 0.5) * cell + 0.7e-6;
            const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / area;
            if (w0 < 0 || w0 > 1) continue;
            const w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / area;
            if (w1 < 0 || w1 > 1) continue;
            const w2 = 1 - w0 - w1;
            if (w2 < 0) continue;

            const key = `${col},${row}`;
            if (!hits.has(key)) hits.set(key, []);
            hits.get(key).push(w0 * a.y + w1 * b.y + w2 * c.y);
          }
        }
      }

      for (const [key, heights] of hits) {
        heights.sort((u, v) => u - v);
        if (!cells.has(key)) cells.set(key, []);
        for (let k = 0; k + 1 < heights.length; k += 2) {
          const bottom = Math.max(heights[k], walkY);
          const top = heights[k + 1];
          if (top - bottom >= minThickness) cells.get(key).push([bottom, top]);
        }
      }
    }

    // Gleiche (gerundete) Abschnitte sammeln und je Abschnitt zu Rechtecken mergen.
    const byInterval = new Map();
    for (const [key, intervals] of cells) {
      const [col, row] = key.split(",").map(Number);
      for (const [bottom, top] of mergeIntervals(intervals)) {
        const id = `${Math.round(bottom / quantum)}|${Math.round(top / quantum)}`;
        if (!byInterval.has(id)) byInterval.set(id, { bottom, top, cells: [] });
        const entry = byInterval.get(id);
        entry.bottom = Math.min(entry.bottom, bottom);
        entry.top = Math.max(entry.top, top);
        entry.cells.push([col, row]);
      }
    }

    let boxCount = 0;
    for (const { bottom, top, cells: list } of byInterval.values()) {
      for (const rect of mergeCellRects(list)) {
        solids[part.side].push({
          id: part.id,
          minX: rect.col0 * cell,
          maxX: (rect.col1 + 1) * cell,
          minZ: rect.row0 * cell,
          maxZ: (rect.row1 + 1) * cell,
          bottom,
          top,
        });
        boxCount++;
      }
    }
    console.log(`[Platine] ${part.id} begehbar: ${meshes.length} Meshes, ${boxCount} Kollisionsquader.`);
  }

  return solids;
}

/**
 * Platz ueber der Oberseite jedes Quaders bis zum naechsten Quader darueber
 * (`headroom`, Infinity = frei). Passt der Chip dort nicht hin, ist die
 * Oberseite keine Stufe, sondern Wand - z.B. die Kante an der Oeffnung von J3
 * direkt unter dem Ueberhang.
 */
function computeHeadroom(boxes) {
  const epsilon = WORLD_PER_MM * 0.02;
  for (const box of boxes) {
    let headroom = Infinity;
    for (const other of boxes) {
      if (other === box || other.bottom < box.top - epsilon) continue;
      if (
        other.minX < box.maxX &&
        other.maxX > box.minX &&
        other.minZ < box.maxZ &&
        other.maxZ > box.minZ
      ) {
        headroom = Math.min(headroom, other.bottom - box.top);
      }
    }
    box.headroom = headroom;
  }
}

/** Vereint ueberlappende Abschnitte [unten, oben]. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((u, v) => u[0] - v[0]);
  const merged = [];
  for (const [bottom, top] of sorted) {
    const last = merged[merged.length - 1];
    if (last && bottom <= last[1]) last[1] = Math.max(last[1], top);
    else merged.push([bottom, top]);
  }
  return merged;
}

/**
 * Fasst Rasterzellen zu moeglichst wenigen Rechtecken zusammen: erst Laeufe
 * je Zeile, dann gleich breite Laeufe uebereinanderliegender Zeilen.
 */
function mergeCellRects(cells) {
  const rows = new Map();
  for (const [col, row] of cells) {
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(col);
  }

  const open = new Map();
  const rects = [];
  for (const row of [...rows.keys()].sort((u, v) => u - v)) {
    const cols = rows.get(row).sort((u, v) => u - v);
    const runs = [];
    let start = cols[0];
    for (let k = 1; k <= cols.length; k++) {
      if (k === cols.length || cols[k] !== cols[k - 1] + 1) {
        runs.push([start, cols[k - 1]]);
        start = cols[k];
      }
    }

    const next = new Map();
    for (const [col0, col1] of runs) {
      const key = `${col0},${col1}`;
      const rect = open.get(key);
      if (rect && rect.row1 === row - 1) {
        rect.row1 = row;
        next.set(key, rect);
        open.delete(key);
      } else {
        const created = { col0, col1, row0: row, row1: row };
        rects.push(created);
        next.set(key, created);
      }
    }
    open.clear();
    for (const [key, rect] of next) open.set(key, rect);
  }
  return rects;
}

/**
 * Baut aus den gefundenen Kappen je Taster ein eigenes, bewegliches Objekt.
 * Grundriss und Oberkante stehen - wie Hindernisse und Hoehenraster - in der
 * Orientierung der jeweiligen Seite.
 */
function buildPushButtons(capParts, groups, flip) {
  const buttons = [];
  const sideBox = new THREE.Box3();

  for (const config of PUSH_BUTTONS) {
    const parts = capParts.get(config);
    if (!parts) {
      console.warn(`[Platine] Kappe von Taster ${config.id} nicht gefunden.`);
      continue;
    }

    const object3D = new THREE.Group();
    object3D.name = `Taster ${config.id}`;
    const footprint = new THREE.Box3();

    for (const { object, box } of parts) {
      object3D.add(createBatch(bakeGeometry(object, false), object.material));
      sideBox.copy(box);
      if (config.side === "bottom") sideBox.applyMatrix4(flip);
      footprint.union(sideBox);
    }

    groups[config.side].add(object3D);
    buttons.push({
      id: config.id,
      label: config.label,
      side: config.side,
      minX: footprint.min.x,
      maxX: footprint.max.x,
      minZ: footprint.min.z,
      maxZ: footprint.max.z,
      /** Oberkante der Kappe in Ruhelage. */
      top: footprint.max.y,
      travel: PUSH_BUTTON_TRAVEL_MM * WORLD_PER_MM,
      depth: 0,
      object3D,
    });
  }

  return buttons;
}

/**
 * Rastert die Dreiecke der sichtbaren Geometrie in ein Hoehengitter.
 *
 * Bewusst dreiecksgenau statt ueber Bounding-Boxen: nur so folgt die begehbare
 * Flaeche der echten Platinenkontur (die Platine ist controller-foermig, nicht
 * rechteckig) und nur so entsteht ausserhalb ein echtes Loch, in das der
 * Charakter faellt. Zellen ohne Treffer bleiben NaN.
 *
 * Jede Zelle haelt mehrere Schichten, damit ueberdeckte Flaechen - die Platine
 * unter dem Display - nicht von der Flaeche darueber verdeckt werden.
 *
 * Zu hohe Flaechen werden uebersprungen, sonst waere die Oberkante des
 * Joystick-Kopfes der "Boden" unter ihm.
 */
function buildHeightField(groups, matrix, bounds, walkY) {
  const minX = bounds.min.x - HEIGHT_CELL_SIZE;
  const minZ = bounds.min.z - HEIGHT_CELL_SIZE;
  const cols = Math.ceil((bounds.max.x - minX) / HEIGHT_CELL_SIZE) + 1;
  const rows = Math.ceil((bounds.max.z - minZ) / HEIGHT_CELL_SIZE) + 1;
  const data = new Float32Array(cols * rows * MAX_LAYERS).fill(NaN);
  const field = { data, cols, rows, minX, minZ, baseY: walkY };
  const limitY = walkY + MAX_GROUND_HEIGHT_MM * WORLD_PER_MM;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const group of groups) {
    for (const mesh of group.children) {
      const position = mesh.geometry.attributes.position;
      const normals = mesh.geometry.attributes.normal;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;

      for (let i = 0; i < count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;

        a.fromBufferAttribute(position, i0).applyMatrix4(matrix);
        b.fromBufferAttribute(position, i1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, i2).applyMatrix4(matrix);

        // Komplette Dreiecke verwerfen, die ueber das Limit reichen - sonst
        // entstuenden an den Flanken hoher Bauteile Plateaus auf Limit-Hoehe.
        if (Math.max(a.y, b.y, c.y) > limitY) continue;

        // Nach unten zeigende Flaechen sind Decken, kein Boden. Ohne diesen
        // Filter waere die Unterseite des Displays eine begehbare Schicht.
        normal
          .set(
            normals.getX(i0) + normals.getX(i1) + normals.getX(i2),
            normals.getY(i0) + normals.getY(i1) + normals.getY(i2),
            normals.getZ(i0) + normals.getZ(i1) + normals.getZ(i2)
          )
          .transformDirection(matrix);
        if (normal.y <= 0) continue;

        rasterizeTriangle(a, b, c, field);
      }
    }
  }

  return field;
}

/**
 * Legt eine Flaechenhoehe in einer Zelle ab. Dicht beieinander liegende
 * Flaechen werden zu einer Schicht zusammengefasst.
 */
function insertLayer(data, base, height) {
  let free = -1;

  for (let k = 0; k < MAX_LAYERS; k++) {
    const value = data[base + k];

    if (Number.isNaN(value)) {
      if (free < 0) free = k;
      continue;
    }

    if (Math.abs(value - height) <= LAYER_MERGE) {
      if (height > value) data[base + k] = height;
      return;
    }
  }

  if (free >= 0) {
    data[base + free] = height;
    return;
  }

  collapseClosest(data, base, height);
}

/** Scratch fuer das Zusammenlegen - spart eine Allokation je Dreieck. */
const layerScratch = new Float64Array(MAX_LAYERS + 1);

/**
 * Zelle ist voll: die beiden dichtesten Schichten verschmelzen. Unterste und
 * oberste Flaeche bleiben dabei immer erhalten.
 */
function collapseClosest(data, base, height) {
  for (let k = 0; k < MAX_LAYERS; k++) layerScratch[k] = data[base + k];
  layerScratch[MAX_LAYERS] = height;
  layerScratch.sort();

  let drop = 0;
  let smallest = Infinity;

  for (let k = 1; k <= MAX_LAYERS; k++) {
    const gap = layerScratch[k] - layerScratch[k - 1];
    if (gap < smallest) {
      smallest = gap;
      drop = k - 1;
    }
  }

  let write = 0;
  for (let k = 0; k <= MAX_LAYERS; k++) {
    if (k !== drop) data[base + write++] = layerScratch[k];
  }
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
      insertLayer(data, (offset + col) * MAX_LAYERS, height);
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

/** Scratch fuer den Grundriss-Zuschnitt. */
const edgeA = new THREE.Vector3();
const edgeB = new THREE.Vector3();
const edgeC = new THREE.Vector3();

/**
 * Grundriss der Geometrie im Hoehenband [minY, maxY] - also genau dort, wo der
 * Chip anstoesst. Die Bounding-Box des ganzen Meshes waere viel zu grob: der
 * Joystick-Kopf steht ringsum ueber seinem Sockel, und die Loetpins liegen
 * flach auf der Platine.
 *
 * Dreiecke werden am Band beschnitten, damit auch senkrechte Waende zaehlen,
 * deren Eckpunkte alle ausserhalb liegen.
 */
function bandFootprint(mesh, matrix, minY, maxY) {
  const position = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const add = (x, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };

  for (let i = 0; i < count; i += 3) {
    edgeA.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
    edgeB.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
    edgeC.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);

    if (Math.min(edgeA.y, edgeB.y, edgeC.y) > maxY) continue;
    if (Math.max(edgeA.y, edgeB.y, edgeC.y) < minY) continue;

    clipEdge(edgeA, edgeB, minY, maxY, add);
    clipEdge(edgeB, edgeC, minY, maxY, add);
    clipEdge(edgeC, edgeA, minY, maxY, add);
  }

  return minX === Infinity ? null : { minX, maxX, minZ, maxZ };
}

/** Uebergibt den Teil der Kante, der im Band liegt. */
function clipEdge(p, q, minY, maxY, add) {
  let t0 = 0;
  let t1 = 1;
  const dy = q.y - p.y;

  if (Math.abs(dy) < 1e-9) {
    if (p.y < minY || p.y > maxY) return;
  } else {
    const ta = (minY - p.y) / dy;
    const tb = (maxY - p.y) / dy;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return;
  }

  add(p.x + (q.x - p.x) * t0, p.z + (q.z - p.z) * t0);
  add(p.x + (q.x - p.x) * t1, p.z + (q.z - p.z) * t1);
}

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
