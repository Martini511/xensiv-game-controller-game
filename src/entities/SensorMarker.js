import * as THREE from "three";

const UNFOUND_COLOR = 0xffffff;
const FOUND_COLOR = 0x5ee08a;
/** Farbe, wenn die zugehoerige Taste gedrueckt wird. */
const ACTIVE_COLOR = 0xffee00;
/** Blinkfrequenz in Hertz. */
const BLINK_HZ = 3.5;

/** Ab dem Wievielfachen der Markier-Reichweite der Rahmen sichtbar wird. */
const REVEAL_RATIO = 3.5;

/**
 * Markierung fuer einen Magnetsensor: ein quadratischer Rahmen, der das weisse
 * Siebdruck-Kaestchen auf der Platine nachzeichnet.
 *
 * Ungefunden blendet er erst auf, wenn man nah genug dran ist - sonst waere
 * das Suchen hinfaellig. Wird die zugehoerige Taste gedrueckt, blinkt er gelb
 * und ist dabei unabhaengig von der Entfernung sichtbar; so laesst sich ein
 * Sensor gezielt aufspueren. Ein bereits markierter Sensor reagiert nicht mehr
 * auf seine Taste und bleibt einfach gruen.
 */
export class SensorMarker {
  constructor({ size, color = UNFOUND_COLOR } = {}) {
    this.object3D = new THREE.Group();
    this.object3D.name = "SensorMarker";
    this.marked = false;
    this.inRange = false;
    /** true, solange die Taste dieses Sensors gehalten wird. */
    this.highlighted = false;
    /** Abstand des Charakters, normiert auf die Markier-Reichweite. */
    this.proximity = Infinity;

    const outer = size / 2;
    const inner = outer * 0.72;
    const shape = new THREE.Shape();
    addSquare(shape, outer);
    const hole = new THREE.Path();
    addSquare(hole, inner);
    shape.holes.push(hole);

    this._frame = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._frame.rotation.x = -Math.PI / 2;

    this._fill = new THREE.Mesh(
      new THREE.PlaneGeometry(inner * 2, inner * 2),
      new THREE.MeshBasicMaterial({
        color: FOUND_COLOR,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._fill.rotation.x = -Math.PI / 2;

    this.object3D.add(this._frame, this._fill);
  }

  update(elapsedTime) {
    if (this.marked) {
      this._setColor(FOUND_COLOR);
      this._frame.material.opacity = 0.9;
      this._fill.material.opacity = 0.35;
      this.object3D.scale.setScalar(1);
      return;
    }

    if (this.highlighted) {
      // Hartes An/Aus statt weichem Puls - das liest sich als Blinken.
      const on = Math.sin(elapsedTime * BLINK_HZ * Math.PI * 2) > 0;
      this._setColor(ACTIVE_COLOR);
      this._frame.material.opacity = on ? 1 : 0.12;
      this._fill.material.opacity = on ? 0.45 : 0.04;
      this.object3D.scale.setScalar(on ? 1.45 : 1);
      return;
    }

    this._setColor(UNFOUND_COLOR);
    this._fill.material.opacity = 0;
    this.object3D.scale.setScalar(1);

    // 1 bei Reichweite, 0 ab dem REVEAL_RATIO-fachen Abstand
    const reveal = THREE.MathUtils.clamp(
      (REVEAL_RATIO - this.proximity) / (REVEAL_RATIO - 1),
      0,
      1
    );
    const pulse = this.inRange ? 0.5 + 0.5 * Math.sin(elapsedTime * 3) : 0;
    this._frame.material.opacity = reveal * (0.35 + pulse * 0.55);
  }

  _setColor(hex) {
    this._frame.material.color.setHex(hex);
    this._fill.material.color.setHex(hex);
  }

  reset() {
    this.marked = false;
    this.inRange = false;
    this.highlighted = false;
    this.proximity = Infinity;
    this.object3D.scale.setScalar(1);
    this._setColor(UNFOUND_COLOR);
  }

  dispose() {
    for (const mesh of [this._frame, this._fill]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}

function addSquare(path, half) {
  path.moveTo(-half, -half);
  path.lineTo(half, -half);
  path.lineTo(half, half);
  path.lineTo(-half, half);
  path.closePath();
}
