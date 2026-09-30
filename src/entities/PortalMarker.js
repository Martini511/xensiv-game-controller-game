import * as THREE from "three";

/**
 * Flacher Ring, der die Kontrollflaeche markiert. Auf der Oberseite ist sie im
 * Siebdruck als "CONTROL"-Kreis zu sehen, auf der Unterseite gibt es keine
 * Markierung - dort uebernimmt dieser Marker.
 */
export class PortalMarker {
  constructor({ radius, color = 0xffd166 } = {}) {
    this.object3D = new THREE.Group();
    this.object3D.name = "PortalMarker";

    this._ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.94, radius, 72),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._ring.rotation.x = -Math.PI / 2;
    this.object3D.add(this._ring);
  }

  /** Sehr flaches Pulsieren - der Ring soll nur angedeutet sein. */
  update(elapsedTime) {
    this._ring.material.opacity = 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(elapsedTime * 1.6));
  }

  get visible() {
    return this.object3D.visible;
  }

  set visible(value) {
    this.object3D.visible = value;
  }

  dispose() {
    this._ring.geometry.dispose();
    this._ring.material.dispose();
  }
}
