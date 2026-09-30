import * as THREE from "three";

/**
 * Kollisionsaufloesung in der XZ-Ebene: der Charakter ist von oben betrachtet
 * ein Kreis, Bauteile sind achsenparallele Rechtecke. Aufgeloest wird ueber die
 * kleinste Eindringtiefe, damit man an Kanten entlanggleitet.
 *
 * Rechtecke, deren Oberkante nicht ueber den Fuessen liegt, werden ignoriert -
 * auf denen steht man bereits drauf.
 */
export function resolveCircleVsBoxes(position, radius, boxes, feetY, passes = 2) {
  let blocked = false;

  for (let pass = 0; pass < passes; pass++) {
    let corrected = false;

    for (const box of boxes) {
      if (box.top <= feetY + 0.001) continue;

      const minX = box.minX - radius;
      const maxX = box.maxX + radius;
      const minZ = box.minZ - radius;
      const maxZ = box.maxZ + radius;

      if (position.x <= minX || position.x >= maxX) continue;
      if (position.z <= minZ || position.z >= maxZ) continue;

      const toLeft = position.x - minX;
      const toRight = maxX - position.x;
      const toBack = position.z - minZ;
      const toFront = maxZ - position.z;
      const smallest = Math.min(toLeft, toRight, toBack, toFront);

      if (smallest === toLeft) position.x = minX;
      else if (smallest === toRight) position.x = maxX;
      else if (smallest === toBack) position.z = minZ;
      else position.z = maxZ;

      corrected = true;
      blocked = true;
    }

    if (!corrected) break;
  }

  return blocked;
}

/**
 * Kuerzt den Kameraabstand, wenn zwischen Blickziel und Wunschposition ein
 * Bauteil steht - sonst steckt die Kamera z.B. im Joystick und man sieht
 * nichts. Geprueft wird der Strahl vom Blickziel nach aussen gegen die
 * 3D-Boxen der hohen Bauteile.
 */
export function clampDistanceToBoxes(
  origin,
  direction,
  distance,
  boxes,
  { margin = 0.3, minDistance = 0.5 } = {}
) {
  let limit = distance;

  for (const box of boxes) {
    const entry = rayBoxEntry(origin, direction, box, distance);
    if (entry !== null && entry < limit) limit = entry;
  }

  if (limit >= distance) return distance;
  // Der Mindestabstand darf die Korrektur nicht ueberschreiben - sonst landet
  // die Kamera in engen Luecken doch wieder im Bauteil.
  return THREE.MathUtils.clamp(limit - margin, minDistance, distance);
}

/** Slab-Test Strahl gegen AABB. Gibt die Eintrittsdistanz zurueck oder null. */
function rayBoxEntry(origin, direction, box, maxDistance) {
  let tMin = 0;
  let tMax = maxDistance;

  const axes = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.y, direction.y, box.minY, box.maxY],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];

  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-6) {
      if (start < min || start > max) return null;
      continue;
    }

    const inverse = 1 / delta;
    let near = (min - start) * inverse;
    let far = (max - start) * inverse;
    if (near > far) [near, far] = [far, near];

    if (near > tMin) tMin = near;
    if (far < tMax) tMax = far;
    if (tMin > tMax) return null;
  }

  return tMin;
}
