import * as THREE from "three";

const MIN_PITCH = THREE.MathUtils.degToRad(-10);
const MAX_PITCH = THREE.MathUtils.degToRad(65);

/**
 * Third-Person-Kamera: umkreist ein Ziel-Objekt in festem Abstand, leicht
 * erhoeht und hinter dem Ziel. Position und Blickpunkt werden pro Frame
 * gedaempft nachgezogen (framerate-unabhaengiges Damping), damit keine harten
 * Spruenge entstehen.
 */
export class ThirdPersonCamera {
  constructor(camera, target, options = {}) {
    this.camera = camera;
    this.target = target;

    this.distance = options.distance ?? 7;
    this.height = options.height ?? 2.6;
    this.lookAtHeight = options.lookAtHeight ?? 1.2;
    this.rotationSpeed = options.rotationSpeed ?? 2.6; // Radiant pro Sekunde bei vollem Stick-Ausschlag
    this.positionDamping = options.positionDamping ?? 6;
    this.lookDamping = options.lookDamping ?? 10;

    this.yaw = options.yaw ?? 0;
    this.pitch = options.pitch ?? THREE.MathUtils.degToRad(18);

    /**
     * Optional: (blickziel, richtung, wunschabstand) => erlaubter Abstand.
     * Damit rueckt die Kamera vor Bauteile, statt in ihnen zu stecken.
     */
    this.collider = options.collider ?? null;

    this._desiredPosition = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._currentLookAt = new THREE.Vector3();
    this._offset = new THREE.Vector3();

    this._syncLookTarget();
    this._currentLookAt.copy(this._lookTarget);
    this._updateDesiredPosition();
    this.camera.position.copy(this._desiredPosition);
    this.camera.lookAt(this._currentLookAt);
  }

  /**
   * @param {number} x Rechter Stick horizontal (-1..1)
   * @param {number} y Rechter Stick vertikal (-1..1)
   */
  rotate(x, y, deltaTime) {
    this.yaw -= x * this.rotationSpeed * deltaTime;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + y * this.rotationSpeed * deltaTime,
      MIN_PITCH,
      MAX_PITCH
    );
  }

  /** Setzt die Kamera ohne Interpolation ans Ziel - z.B. nach einem Teleport. */
  snapToTarget() {
    this._syncLookTarget();
    this._updateDesiredPosition();
    this._currentLookAt.copy(this._lookTarget);
    this.camera.position.copy(this._desiredPosition);
    this.camera.lookAt(this._currentLookAt);
  }

  update(deltaTime) {
    this._syncLookTarget();
    this._updateDesiredPosition();

    // 1 - exp(-k * dt): exponentielles Damping, unabhaengig von der Framerate
    const positionAlpha = 1 - Math.exp(-this.positionDamping * deltaTime);
    const lookAlpha = 1 - Math.exp(-this.lookDamping * deltaTime);

    this.camera.position.lerp(this._desiredPosition, positionAlpha);
    this._currentLookAt.lerp(this._lookTarget, lookAlpha);
    this.camera.lookAt(this._currentLookAt);
  }

  _syncLookTarget() {
    const { x, y, z } = this.target.position;
    this._lookTarget.set(x, y + this.lookAtHeight, z);
  }

  _updateDesiredPosition() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    const vertical = Math.sin(this.pitch) * this.distance + this.height;

    this._desiredPosition.set(
      this._lookTarget.x + Math.sin(this.yaw) * horizontal,
      this._lookTarget.y + vertical,
      this._lookTarget.z + Math.cos(this.yaw) * horizontal
    );

    if (!this.collider) return;

    this._offset.subVectors(this._desiredPosition, this._lookTarget);
    const length = this._offset.length();
    if (length < 1e-4) return;

    this._offset.divideScalar(length);
    const allowed = this.collider(this._lookTarget, this._offset, length);
    if (allowed < length) {
      this._desiredPosition.copy(this._lookTarget).addScaledVector(this._offset, allowed);
    }
  }
}
