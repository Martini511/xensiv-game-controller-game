/**
 * ============================================================================
 *  Notfall-Steuerung: Tastatur + Maus
 * ============================================================================
 *
 * Fallback, falls der Controller ausfaellt oder nicht erkannt wird. Die
 * Eingaben werden im GamepadManager mit dem Controller zusammengefuehrt -
 * die Spiellogik sieht weiterhin nur benannte Gamepad-Buttons und Sticks.
 *
 * Die Aktionstasten tragen bewusst dieselben Buchstaben wie die Beschriftung
 * des Controllers (F, T, I). So stimmen alle Spieltexte ("Press T ...") auch
 * an der Tastatur.
 *
 * Gelesen wird `event.code` (physische Taste), damit WASD auch auf
 * QWERTZ/AZERTY an derselben Stelle liegt.
 */

/** Tastencode -> Gamepad-Button. */
const KEY_TO_BUTTON = {
  KeyF: "A",
  Space: "A",
  KeyT: "Y",
  Enter: "Y",
  NumpadEnter: "Y",
  KeyI: "X",
  Digit1: "L1",
  Digit2: "R1",
  Digit3: "L2",
  Digit4: "R2",
  Digit5: "L3",
  Digit6: "R3",
  Numpad1: "L1",
  Numpad2: "R1",
  Numpad3: "L2",
  Numpad4: "R2",
  Numpad5: "L3",
  Numpad6: "R3",
  ArrowUp: "DPAD_UP",
  ArrowDown: "DPAD_DOWN",
  ArrowLeft: "DPAD_LEFT",
  ArrowRight: "DPAD_RIGHT",
};

const MOVE_KEYS = {
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

/** Kurzbeschriftung je Gamepad-Button fuer Prompts und Hilfetexte. */
export const KEY_LABELS = {
  A: "F",
  Y: "T",
  X: "I",
  L1: "1",
  R1: "2",
  L2: "3",
  R2: "4",
  L3: "5",
  R3: "6",
  DPAD_UP: "\u2191",
  DPAD_DOWN: "\u2193",
  DPAD_LEFT: "\u2190",
  DPAD_RIGHT: "\u2192",
};

/** Kamera-Drehung in Radiant pro Pixel Mausbewegung. */
const MOUSE_SENSITIVITY = 0.0035;

export class KeyboardMouseInput {
  /** @param {HTMLElement} lockTarget Element, das per Klick die Maus einfaengt (Canvas). */
  constructor(lockTarget) {
    this.lockTarget = lockTarget;

    this._down = new Set();
    /** Seit dem letzten update() gedrueckt - auch wenn schon wieder losgelassen. */
    this._tapped = new Set();
    this._lookX = 0;
    this._lookY = 0;
    /** Seit dem letzten update() gab es Tastatur-/Mauseingaben. */
    this._touched = false;

    this.state = {
      /** Wie linker Stick: x rechts positiv, y unten positiv, Betrag <= 1. */
      move: { x: 0, y: 0 },
      /** Kamera-Drehung dieses Frames in Radiant (yaw, pitch). */
      look: { x: 0, y: 0 },
      /** Gehaltene Gamepad-Buttons nach Namen. */
      buttons: {},
      active: false,
      pointerLocked: false,
    };

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  start() {
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    document.addEventListener("mousemove", this._onMouseMove);
    this.lockTarget.addEventListener("mousedown", this._onMouseDown);
  }

  stop() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    document.removeEventListener("mousemove", this._onMouseMove);
    this.lockTarget.removeEventListener("mousedown", this._onMouseDown);
    if (document.pointerLockElement === this.lockTarget) document.exitPointerLock();
    this._onBlur();
  }

  /** Einmal pro Frame: Tastenzustand und aufgelaufene Mausbewegung abholen. */
  update() {
    const s = this.state;

    let x = 0;
    let y = 0;
    for (const [code, dir] of Object.entries(MOVE_KEYS)) {
      if (this._down.has(code)) {
        x += dir.x;
        y += dir.y;
      }
    }
    // Diagonalen nicht schneller als gerade Richtungen
    const length = Math.hypot(x, y);
    s.move.x = length > 0 ? x / length : 0;
    s.move.y = length > 0 ? y / length : 0;

    s.look.x = this._lookX * MOUSE_SENSITIVITY;
    s.look.y = this._lookY * MOUSE_SENSITIVITY;
    this._lookX = 0;
    this._lookY = 0;

    for (const name of Object.keys(s.buttons)) s.buttons[name] = false;
    // Kurze Taps zwischen zwei Frames zaehlen fuer genau einen Frame.
    for (const code of [...this._down, ...this._tapped]) {
      const name = KEY_TO_BUTTON[code];
      if (name) s.buttons[name] = true;
    }
    this._tapped.clear();

    s.active = this._touched;
    this._touched = false;
    s.pointerLocked = document.pointerLockElement === this.lockTarget;
    return s;
  }

  _isHandled(code) {
    return code in KEY_TO_BUTTON || code in MOVE_KEYS;
  }

  _onKeyDown(event) {
    if (!this._isHandled(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    // Pfeiltasten und Leertaste wuerden sonst die Seite scrollen.
    event.preventDefault();
    this._down.add(event.code);
    this._tapped.add(event.code);
    this._touched = true;
  }

  _onKeyUp(event) {
    this._down.delete(event.code);
  }

  _onMouseMove(event) {
    // Mit eingefangener Maus frei umsehen, sonst nur bei gedrueckter Maustaste.
    const locked = document.pointerLockElement === this.lockTarget;
    if (!locked && !(event.buttons & 1)) return;
    this._lookX += event.movementX;
    this._lookY += event.movementY;
    this._touched = true;
  }

  _onMouseDown(event) {
    if (event.button !== 0) return;
    this._touched = true;
    if (document.pointerLockElement !== this.lockTarget && this.lockTarget.requestPointerLock) {
      // Kann scheitern (z.B. direkt nach ESC) - dann bleibt das Ziehen mit gedrueckter Maustaste.
      Promise.resolve(this.lockTarget.requestPointerLock()).catch(() => {});
    }
  }

  /** Fenster verliert den Fokus: keyup kommt dann nie an. */
  _onBlur() {
    this._down.clear();
    this._tapped.clear();
    this._lookX = 0;
    this._lookY = 0;
  }
}
