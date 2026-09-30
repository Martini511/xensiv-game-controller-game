/**
 * ============================================================================
 *  Gamepad-Handling (Gamepad API)
 * ============================================================================
 *
 * Wichtige Eigenheiten der Gamepad API, die das Design hier bestimmen:
 *
 * 1. KEIN EVENT-BASIERTES UPDATE
 *    Die API liefert nur Events fuer Verbinden/Trennen ("gamepadconnected" /
 *    "gamepaddisconnected"). Achsen- und Button-Werte muessen aktiv abgefragt
 *    (gepollt) werden - hier einmal pro Frame aus der Game-Loop heraus.
 *
 * 2. SNAPSHOT-SEMANTIK
 *    `navigator.getGamepads()` liefert in Chromium einen *Schnappschuss*. Ein
 *    einmal gespeichertes Gamepad-Objekt aktualisiert sich NICHT von selbst.
 *    Deshalb wird in jedem update()-Aufruf neu `navigator.getGamepads()`
 *    aufgerufen und nur der Index (`gamepad.index`) persistent gehalten.
 *
 * 3. AKTIVIERUNG DURCH USER-GESTE
 *    Aus Datenschutzgruenden taucht ein Controller in vielen Browsern erst
 *    auf, nachdem der Nutzer einmal eine Taste am Controller gedrueckt hat.
 *    "Kein Controller verbunden" ist also ein normaler Startzustand.
 *
 * 4. STANDARD MAPPING
 *    Ist `gamepad.mapping === "standard"`, gilt eine definierte Belegung:
 *      Achsen : 0 = linker Stick X,  1 = linker Stick Y
 *               2 = rechter Stick X, 3 = rechter Stick Y
 *      Buttons: 0 = A / Cross, 1 = B / Circle, 2 = X / Square, 3 = Y / Triangle
 *    Y-Achsen sind invertiert: -1 = oben, +1 = unten.
 *    Bei abweichendem Mapping ("" oder "vr") koennen Indizes variieren -
 *    das wird im Debug-Overlay angezeigt, damit man es sofort sieht.
 *
 * 5. DEADZONE
 *    Analog-Sticks liefern in Ruhelage selten exakt 0. Die Deadzone wird
 *    radial (ueber den Betrag des Vektors) angewandt, nicht pro Achse -
 *    sonst entstehen kantige Diagonalen. Ausserhalb der Deadzone wird der
 *    Wert neu auf 0..1 skaliert, damit es keinen Sprung am Deadzone-Rand gibt.
 */

const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
const AXIS_RIGHT_X = 2;
const AXIS_RIGHT_Y = 3;

/**
 * Button-Indizes des Standard-Mappings. Jede Taste wird benannt abgefragt,
 * damit die Spiellogik nicht mit Zahlen hantieren muss.
 */
export const BUTTON_INDEX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

/** Beschriftung auf diesem Controller weicht bei A und Y ab. */
export const BUTTON_LABELS = {
  A: "F",
  B: "B",
  X: "X",
  Y: "T",
  L1: "L1",
  R1: "R1",
  L2: "L2",
  R2: "R2",
  L3: "L3",
  R3: "R3",
  DPAD_UP: "D-Pad \u2191",
  DPAD_DOWN: "D-Pad \u2193",
  DPAD_LEFT: "D-Pad \u2190",
  DPAD_RIGHT: "D-Pad \u2192",
};

/** L2 und R2 sind analoge Trigger und gelten ab diesem Wert als gedrueckt. */
const ANALOG_BUTTONS = new Set(["L2", "R2"]);
const TRIGGER_THRESHOLD = 0.5;

const BUTTON_NAMES = Object.keys(BUTTON_INDEX);

export class GamepadManager {
  constructor(options = {}) {
    this.deadzone = options.deadzone ?? 0.18;
    /** Index des aktuell genutzten Gamepads, null = keins. */
    this.activeIndex = null;

    this.state = {
      connected: false,
      id: null,
      mapping: null,
      /** Linker Stick: Bewegung. x: rechts positiv, y: unten positiv. */
      leftStick: { x: 0, y: 0 },
      /** Rechter Stick: Kamera. */
      rightStick: { x: 0, y: 0 },
      /** Alle Tasten nach Namen, jeweils mit pressed / justPressed / value. */
      buttons: Object.fromEntries(BUTTON_NAMES.map((name) => [name, createButtonState()])),
      /** Rohwerte fuer die Debug-Anzeige. */
      raw: { axes: [], buttons: [] },
    };

    this._onConnected = this._onConnected.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  start() {
    window.addEventListener("gamepadconnected", this._onConnected);
    window.addEventListener("gamepaddisconnected", this._onDisconnected);

    // Falls beim Laden bereits ein Controller aktiv war (z.B. nach Reload),
    // wird kein Event mehr gefeuert -> einmalig selbst nachsehen.
    this._pickFirstAvailableGamepad();
  }

  stop() {
    window.removeEventListener("gamepadconnected", this._onConnected);
    window.removeEventListener("gamepaddisconnected", this._onDisconnected);
  }

  /** Muss einmal pro Frame aufgerufen werden (Polling). */
  update() {
    const gamepad = this._getActiveGamepad();

    if (!gamepad) {
      this._resetState();
      return this.state;
    }

    this.state.connected = true;
    this.state.id = gamepad.id;
    this.state.mapping = gamepad.mapping || "unbekannt";
    this.state.raw.axes = Array.from(gamepad.axes);
    this.state.raw.buttons = gamepad.buttons.map((button) => ({
      pressed: button.pressed,
      value: button.value,
    }));

    applyRadialDeadzone(
      this.state.leftStick,
      gamepad.axes[AXIS_LEFT_X] ?? 0,
      gamepad.axes[AXIS_LEFT_Y] ?? 0,
      this.deadzone
    );
    applyRadialDeadzone(
      this.state.rightStick,
      gamepad.axes[AXIS_RIGHT_X] ?? 0,
      gamepad.axes[AXIS_RIGHT_Y] ?? 0,
      this.deadzone
    );

    for (const name of BUTTON_NAMES) {
      updateButtonState(
        this.state.buttons[name],
        gamepad.buttons[BUTTON_INDEX[name]],
        ANALOG_BUTTONS.has(name) ? TRIGGER_THRESHOLD : 0
      );
    }

    return this.state;
  }

  _onConnected(event) {
    const { index, id, mapping, axes, buttons } = event.gamepad;
    console.log(
      `[Gamepad] verbunden - Index ${index}: "${id}" ` +
        `(mapping: ${mapping || "unbekannt"}, ${axes.length} Achsen, ${buttons.length} Buttons)`
    );
    if (this.activeIndex === null) {
      this.activeIndex = index;
    }
  }

  _onDisconnected(event) {
    const { index, id } = event.gamepad;
    console.log(`[Gamepad] getrennt - Index ${index}: "${id}"`);
    if (this.activeIndex === index) {
      this.activeIndex = null;
      this._resetState();
      // Evtl. haengt noch ein zweiter Controller am System.
      this._pickFirstAvailableGamepad();
    }
  }

  _pickFirstAvailableGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (pad && pad.connected) {
        this.activeIndex = pad.index;
        return;
      }
    }
  }

  /**
   * Immer frisch abfragen - gespeicherte Gamepad-Objekte sind in Chromium
   * eingefrorene Snapshots und wuerden veraltete Werte liefern.
   */
  _getActiveGamepad() {
    if (!navigator.getGamepads) return null;

    const pads = navigator.getGamepads();
    if (this.activeIndex === null) {
      this._pickFirstAvailableGamepad();
    }
    if (this.activeIndex === null) return null;

    const pad = pads[this.activeIndex];
    return pad && pad.connected ? pad : null;
  }

  _resetState() {
    const s = this.state;
    s.connected = false;
    s.id = null;
    s.mapping = null;
    s.leftStick.x = 0;
    s.leftStick.y = 0;
    s.rightStick.x = 0;
    s.rightStick.y = 0;
    for (const name of BUTTON_NAMES) updateButtonState(s.buttons[name], null, 0);
    s.raw.axes = [];
    s.raw.buttons = [];  }
}

const createButtonState = () => ({
  /** true, solange der Button gehalten wird. */
  pressed: false,
  /** true nur in dem Frame, in dem der Button gedrueckt wurde. */
  justPressed: false,
  /** Analogwert 0..1 (relevant bei den Triggern). */
  value: 0,
});

/**
 * Digitale Buttons melden `pressed` selbst, Trigger liefern zusaetzlich einen
 * Analogwert - deshalb wird beides ausgewertet.
 */
function updateButtonState(target, button, threshold) {
  const value = button?.value ?? 0;
  const pressed = Boolean(button?.pressed) || value > threshold;

  target.justPressed = pressed && !target.pressed;
  target.pressed = pressed;
  target.value = value;
  return target;
}

/**
 * Radiale Deadzone: unterhalb des Schwellwerts wird der komplette Vektor auf 0
 * gesetzt, darueber linear auf 0..1 zurueckskaliert.
 */
function applyRadialDeadzone(out, x, y, deadzone) {
  const magnitude = Math.hypot(x, y);

  if (magnitude < deadzone) {
    out.x = 0;
    out.y = 0;
    return out;
  }

  const scaled = (magnitude - deadzone) / (1 - deadzone);
  const normalized = Math.min(scaled, 1) / magnitude;
  out.x = x * normalized;
  out.y = y * normalized;
  return out;
}
