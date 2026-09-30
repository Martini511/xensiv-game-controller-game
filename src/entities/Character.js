import * as THREE from "three";

/**
 * Platzhalter-Charakter.
 *
 * Nach aussen ist nur `object3D` (ein Group-Container), `position`, `rotation`
 * und `update(deltaTime)` relevant. Das eigentliche Mesh haengt in einer
 * separaten Gruppe `model`, damit es spaeter 1:1 gegen ein geladenes
 * GLTF-Modell getauscht werden kann, ohne dass Bewegung oder Kamera
 * angepasst werden muessen.
 */
export class Character {
  constructor(options = {}) {
    this.moveSpeed = options.moveSpeed ?? 6;
    this.turnDamping = options.turnDamping ?? 12;
    /** Radius fuer die Kollision in der XZ-Ebene (etwas ueber dem Mesh-Radius). */
    this.radius = options.radius ?? 0.8;

    this.object3D = new THREE.Group();
    this.object3D.name = "Character";

    this.model = new THREE.Group();
    this.model.name = "CharacterModel";
    this.object3D.add(this.model);
    this.model.add(createPlaceholderMesh());

    /** Gewuenschte Bewegungsrichtung in Weltkoordinaten (Laenge 0..1). */
    this.moveDirection = new THREE.Vector3();
    this.velocity = new THREE.Vector3();

    /** Optionales Modell mit eigener update(dt, speed)-Animation. */
    this._animator = null;

    // Start: Blickrichtung -Z, also von der Startposition der Kamera weg
    this._targetYaw = Math.PI;
    this.object3D.rotation.y = Math.PI;
    this._tmpVector = new THREE.Vector3();
  }

  get position() {
    return this.object3D.position;
  }

  get rotation() {
    return this.object3D.rotation;
  }

  /**
   * Setzt die Bewegungsrichtung (Weltkoordinaten, XZ-Ebene).
   * @param {number} x
   * @param {number} z
   * @param {number} intensity 0..1, z.B. der Betrag des Stick-Ausschlags
   */
  setMoveDirection(x, z, intensity = 1) {
    this.moveDirection.set(x, 0, z);
    if (this.moveDirection.lengthSq() > 0) {
      this.moveDirection.normalize().multiplyScalar(THREE.MathUtils.clamp(intensity, 0, 1));
    }
  }

  update(deltaTime) {
    this.velocity.copy(this.moveDirection).multiplyScalar(this.moveSpeed);

    this._tmpVector.copy(this.velocity).multiplyScalar(deltaTime);
    this.object3D.position.add(this._tmpVector);

    // Blickrichtung weich in Bewegungsrichtung drehen
    if (this.moveDirection.lengthSq() > 1e-6) {
      this._targetYaw = Math.atan2(this.moveDirection.x, this.moveDirection.z);
    }

    const alpha = 1 - Math.exp(-this.turnDamping * deltaTime);
    this.object3D.rotation.y = dampAngle(this.object3D.rotation.y, this._targetYaw, alpha);

    this._animator?.update(deltaTime, this.velocity.length());
  }

  /**
   * Ersetzt das Platzhalter-Mesh, z.B. durch ein geladenes GLTF-Modell.
   * `animator` bekommt pro Frame update(deltaTime, speed) - damit laeuft die
   * Beinanimation des Chips mit der tatsaechlichen Geschwindigkeit.
   */
  setModel(object3D, animator = null) {
    this.model.clear();
    this.model.add(object3D);
    this._animator = animator;
  }
}

function createPlaceholderMesh() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.9, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x4f9dde, roughness: 0.5, metalness: 0.1 })
  );
  body.position.y = 0.85;
  body.castShadow = true;
  group.add(body);

  // Kleiner Marker auf der Vorderseite (+Z), damit die Blickrichtung sichtbar ist
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.4 })
  );
  nose.position.set(0, 1.1, 0.42);
  nose.castShadow = true;
  group.add(nose);

  return group;
}

/** Interpoliert zwei Winkel ueber den kuerzesten Weg. */
function dampAngle(current, target, alpha) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * alpha;
}
