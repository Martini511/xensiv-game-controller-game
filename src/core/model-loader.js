import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Laden und Aufbereiten des Platinen-Modells.
 *
 * Die eigentliche URL wird ueber Vites Asset-Handling aufgeloest, damit die
 * Datei im Build mit Hash im dist-Ordner landet.
 */
import platineUrl from "../assets/platine.glb?url";
import playerUrl from "../assets/player.glb?url";

export const PLATINE_URL = platineUrl;
export const PLAYER_URL = playerUrl;
/** Unkomprimierte Dateigroesse, beim Build von vite.config.js eingesetzt. */
export const PLATINE_BYTES = __PLATINE_BYTES__;

/**
 * Promise-basiertes Laden. `onProgress` bekommt einen Wert 0..1 bzw. null,
 * wenn kein Fortschritt berechenbar ist.
 *
 * Mit `expectedBytes` (unkomprimierte Dateigroesse) wird der Fortschritt
 * daran gemessen: Liefert der Server die Datei komprimiert aus (gzip), nennt
 * Content-Length nur die komprimierte Groesse, gezaehlt werden aber die
 * entpackten Bytes - ohne diese Angabe stiege der Wert weit ueber 100 %.
 */
export function loadGLTF(url = platineUrl, onProgress, expectedBytes = 0) {
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      (event) => {
        if (!onProgress) return;
        const total = expectedBytes || (event.lengthComputable ? event.total : 0);
        // Mehr Bytes als angekuendigt: Gesamtgroesse ist unbrauchbar (Kompression).
        if (!total || (!expectedBytes && event.loaded > total)) {
          onProgress(null);
          return;
        }
        onProgress(Math.min(event.loaded / total, 1));
      },
      (error) => reject(new Error(`Modell konnte nicht geladen werden: ${url}`, { cause: error }))
    );
  });
}

/**
 * Laeuft die komplette Hierarchie durch und loggt Name, Weltposition und
 * Bounding-Box-Groesse jedes Objekts. Die Vollliste steckt in einer
 * zugeklappten Konsolen-Gruppe, damit die Konsole nutzbar bleibt.
 *
 * Gibt die Gesamt-Bounding-Box (Weltkoordinaten) zurueck.
 */
export function analyzeHierarchy(
  root,
  { label = "Modell-Analyse", topCount = 25, unitScale = 1, unitLabel = "Units" } = {}
) {
  root.updateWorldMatrix(true, true);

  const rows = [];
  const worldPosition = new THREE.Vector3();
  const size = new THREE.Vector3();
  const box = new THREE.Box3();
  const overall = new THREE.Box3();
  let meshCount = 0;

  root.traverse((object) => {
    if (object === root) return;
    if (object.isMesh) meshCount++;

    object.getWorldPosition(worldPosition);
    box.setFromObject(object);

    const empty = box.isEmpty();
    if (!empty) {
      box.getSize(size);
      overall.union(box);
    }

    rows.push({
      name: object.name || "(ohne Namen)",
      typ: object.type,
      "pos.x": round(worldPosition.x * unitScale),
      "pos.y": round(worldPosition.y * unitScale),
      "pos.z": round(worldPosition.z * unitScale),
      "size.x": empty ? null : round(size.x * unitScale),
      "size.y": empty ? null : round(size.y * unitScale),
      "size.z": empty ? null : round(size.z * unitScale),
      flaeche: empty ? 0 : round(size.x * size.y * unitScale * unitScale),
    });
  });

  const overallSize = overall.isEmpty()
    ? new THREE.Vector3()
    : overall.getSize(new THREE.Vector3());
  const overallCenter = overall.isEmpty()
    ? new THREE.Vector3()
    : overall.getCenter(new THREE.Vector3());

  console.group(`[${label}] ${rows.length} Objekte, davon ${meshCount} Meshes`);
  console.log(
    `Gesamt-BoundingBox (${unitLabel}):`,
    `\n  min    : ${vec(overall.min, unitScale)}`,
    `\n  max    : ${vec(overall.max, unitScale)}`,
    `\n  groesse: ${vec(overallSize, unitScale)}`,
    `\n  mitte  : ${vec(overallCenter, unitScale)}`
  );

  // Benannte Objekte zuerst - dort stecken meist die sinnvollen CAD-Namen.
  const named = rows.filter((row) => row.name !== "(ohne Namen)" && !/^(Solid|Srf|Object|mesh)\d*$/i.test(row.name));
  console.log(`Objekte mit aussagekraeftigem Namen: ${named.length}`);
  if (named.length) console.table(named.slice(0, topCount));

  console.log(`Groesste ${topCount} Objekte nach Grundflaeche - Kandidaten fuer die Kontrollflaeche:`);
  console.table([...rows].sort((a, b) => b.flaeche - a.flaeche).slice(0, topCount));

  console.groupCollapsed(`Vollstaendige Hierarchie (${rows.length} Eintraege)`);
  console.table(rows);
  console.groupEnd();
  console.groupEnd();

  return overall;
}

/**
 * glTF liefert normalerweise bereits PBR-Materialien (MeshStandardMaterial
 * bzw. MeshPhysicalMaterial). Hier werden zwei Faelle aufgeraeumt:
 *
 * 1. Legacy-/Unlit-Materialien aus CAD-Exporten reagieren nicht auf Ambient-
 *    und Directional-Light -> auf MeshStandardMaterial heben.
 * 2. Materialien mit KHR_materials_transmission (Glas, LED-Linsen) zwingen
 *    Three.js dazu, die komplette Szene pro Frame ein zweites Mal in ein
 *    Transmission-Render-Target zu zeichnen. Das kostet bei diesem Modell mehr
 *    als es optisch bringt -> auf einfache Transparenz umstellen.
 */
export function normalizeMaterials(root) {
  const cache = new Map();
  let converted = 0;
  let detransmitted = 0;

  const replace = (material) => {
    if (material.isMeshPhysicalMaterial && material.transmission > 0) {
      detransmitted++;
      return new THREE.MeshStandardMaterial({
        color: material.color,
        roughness: material.roughness,
        metalness: material.metalness,
        transparent: true,
        opacity: Math.min(material.opacity, 0.55),
        side: material.side,
        name: material.name,
      });
    }

    converted++;
    return new THREE.MeshStandardMaterial({
      color: material.color ?? new THREE.Color(0xcccccc),
      map: material.map ?? null,
      transparent: material.transparent,
      opacity: material.opacity,
      side: material.side,
      roughness: 0.7,
      metalness: 0.1,
      name: material.name,
    });
  };

  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const result = materials.map((material) => {
      const needsReplacement =
        (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) ||
        (material.isMeshPhysicalMaterial && material.transmission > 0);
      if (!needsReplacement) return material;

      if (!cache.has(material.uuid)) cache.set(material.uuid, replace(material));
      return cache.get(material.uuid);
    });

    object.material = Array.isArray(object.material) ? result : result[0];
  });

  if (converted > 0) {
    console.log(`[Modell] ${converted} nicht-PBR-Materialien auf MeshStandardMaterial konvertiert.`);
  }
  if (detransmitted > 0) {
    console.log(
      `[Modell] ${detransmitted} Transmission-Materialien auf einfache Transparenz umgestellt ` +
        `(spart einen kompletten Render-Pass pro Frame).`
    );
  }
  return converted + detransmitted;
}

const round = (value) => Math.round(value * 1000) / 1000;
const vec = (v, scale = 1) =>
  `(${round(v.x * scale)}, ${round(v.y * scale)}, ${round(v.z * scale)})`;
