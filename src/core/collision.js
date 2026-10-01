import * as THREE from "three";

/**
 * Kollisionsaufloesung in der XZ-Ebene: der Charakter ist von oben betrachtet
 * ein *gedrehtes* Rechteck (der Chip ist deutlich breiter als lang), Bauteile
 * sind achsenparallele Rechtecke.
 *
 * Verfahren: Separating Axis Theorem ueber vier Achsen - die beiden Weltachsen
 * und die beiden Achsen des gedrehten Charakters. Geschoben wird entlang der
 * Achse mit der geringsten Ueberlappung (Minimum Translation Vector), dadurch
 * gleitet man an Kanten entlang statt haengenzubleiben.
 *
 * Rechtecke, deren Oberkante nicht ueber den Fuessen liegt, werden ignoriert -
 * auf denen steht man bereits drauf.
 *
 * @param {THREE.Vector3} position wird in-place korrigiert
 * @param {THREE.Vector2} halfExtents halbe Kantenlaengen in Charakter-Koordinaten
 * @param {number} angle Drehung des Charakters um die Y-Achse
 */
export function resolveBoxVsBoxes(position, halfExtents, angle, boxes, feetY, passes = 2) {
  // Lokale Achsen des Charakters in Weltkoordinaten (Drehung um Y)
  const ux = Math.cos(angle);
  const uz = -Math.sin(angle);
  const vx = Math.sin(angle);
  const vz = Math.cos(angle);
  const hx = halfExtents.x;
  const hz = halfExtents.y;

  let blocked = false;

  for (let pass = 0; pass < passes; pass++) {
    let corrected = false;

    for (const box of boxes) {
      if (box.top <= feetY + 0.001) continue;

      const ex = (box.maxX - box.minX) / 2;
      const ez = (box.maxZ - box.minZ) / 2;
      const dx = position.x - (box.minX + box.maxX) / 2;
      const dz = position.z - (box.minZ + box.maxZ) / 2;

      // Ueberlappung je Achse; ein negativer Wert trennt die Formen bereits.
      const overlapX = hx * Math.abs(ux) + hz * Math.abs(vx) + ex - Math.abs(dx);
      if (overlapX <= 0) continue;
      const overlapZ = hx * Math.abs(uz) + hz * Math.abs(vz) + ez - Math.abs(dz);
      if (overlapZ <= 0) continue;

      const du = dx * ux + dz * uz;
      const overlapU = hx + ex * Math.abs(ux) + ez * Math.abs(uz) - Math.abs(du);
      if (overlapU <= 0) continue;
      const dv = dx * vx + dz * vz;
      const overlapV = hz + ex * Math.abs(vx) + ez * Math.abs(vz) - Math.abs(dv);
      if (overlapV <= 0) continue;

      const smallest = Math.min(overlapX, overlapZ, overlapU, overlapV);
      if (smallest === overlapX) {
        position.x += dx >= 0 ? overlapX : -overlapX;
      } else if (smallest === overlapZ) {
        position.z += dz >= 0 ? overlapZ : -overlapZ;
      } else if (smallest === overlapU) {
        const push = du >= 0 ? overlapU : -overlapU;
        position.x += ux * push;
        position.z += uz * push;
      } else {
        const push = dv >= 0 ? overlapV : -overlapV;
        position.x += vx * push;
        position.z += vz * push;
      }

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
