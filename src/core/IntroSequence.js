import * as THREE from "three";

/**
 * Kurze Kamerafahrt zum Spielstart: eine durchgehende Kranfahrt von senkrecht
 * ueber der Platine bis in die Verfolgerposition hinter dem Charakter.
 *
 * Statt eine eigene Kamera zu fahren, werden die Parameter der
 * Third-Person-Kamera animiert (Pitch, Yaw, Abstand) und pro Frame hart auf
 * das Ziel gesetzt. Dadurch endet die Fahrt exakt in der Spielkamera, ohne
 * dass am Ende ein Sprung entsteht.
 *
 * Bewusst ohne Zwischen-Keyframes - jede Zwischenstation wuerde die Kamera
 * dort abbremsen und wieder anfahren. Alle drei Parameter laufen ueber *eine*
 * Kurve (smootherstep: erste und zweite Ableitung an beiden Enden null).
 *
 * Der Yaw-Versatz ist so klein gewaehlt, dass die Fahrt im freien Korridor
 * zwischen den beiden Joysticks bleibt. Fuehrt sie durch ein Bauteil, muss die
 * Kamera-Kollision den Abstand kuerzen - und genau das ruckelt.
 */
const START_PITCH_DEG = 84;
const START_DISTANCE = 52;
const START_YAW_OFFSET_DEG = 34;

export class IntroSequence {
  constructor(cameraRig, duration = 6) {
    this.cameraRig = cameraRig;
    this.duration = duration;
    this.done = false;
    this._time = 0;

    // Zielzustand = die im Rig konfigurierte Spielkamera.
    this._final = {
      pitch: cameraRig.pitch,
      yaw: cameraRig.yaw,
      distance: cameraRig.distance,
    };
    this._startPitch = THREE.MathUtils.degToRad(START_PITCH_DEG);
    this._startYaw = this._final.yaw + THREE.MathUtils.degToRad(START_YAW_OFFSET_DEG);
  }

  update(deltaTime) {
    if (this.done) return true;

    this._time += deltaTime;
    const progress = smootherstep(this._time / this.duration);

    this.cameraRig.pitch = THREE.MathUtils.lerp(this._startPitch, this._final.pitch, progress);
    this.cameraRig.yaw = THREE.MathUtils.lerp(this._startYaw, this._final.yaw, progress);
    this.cameraRig.distance = THREE.MathUtils.lerp(START_DISTANCE, this._final.distance, progress);
    this.cameraRig.snapToTarget();

    if (this._time >= this.duration) this.finish();
    return this.done;
  }

  /** Bricht die Fahrt ab und setzt die Kamera sofort in die Spielposition. */
  finish() {
    this.cameraRig.pitch = this._final.pitch;
    this.cameraRig.yaw = this._final.yaw;
    this.cameraRig.distance = this._final.distance;
    this.cameraRig.snapToTarget();
    this.done = true;
  }
}

/** 6t^5 - 15t^4 + 10t^3: startet und endet ohne Beschleunigungssprung. */
function smootherstep(x) {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
