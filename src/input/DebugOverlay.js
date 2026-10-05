import { BUTTON_LABELS } from "./GamepadManager.js";

/**
 * Einfaches HTML-Overlay zur Live-Kontrolle der Gamepad-Werte.
 * Ist bewusst unabhaengig von Three.js, damit es auch ohne laufende Szene
 * nutzbar bleibt.
 */
export class DebugOverlay {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "debug-overlay";
    parent.appendChild(this.element);
    this._lastMarkup = "";
  }

  /**
   * @param {object} gamepadState State-Objekt des GamepadManager
   * @param {object} extra Zusaetzliche Werte (FPS, Seite, ...)
   * @param {string|null} hint Hervorgehobener Hinweis, z.B. Portal-Prompt
   */
  update(gamepadState, extra = {}, hint = null) {
    const lines = [];

    if (gamepadState.connected) {
      lines.push(`<span class="status-connected">● Controller verbunden</span>`);
      lines.push(`  ${escapeHtml(truncate(gamepadState.id ?? "", 34))}`);
      lines.push(`  mapping: ${escapeHtml(String(gamepadState.mapping))}`);
    } else {
      lines.push(`<span class="status-disconnected">● Kein Controller verbunden</span>`);
      lines.push(`  Taste am Controller druecken,`);
      lines.push(`  damit der Browser ihn erkennt.`);
      lines.push(`  Notfall: Tastatur + Maus aktiv.`);
    }

    lines.push("");
    lines.push(
      `L-Stick  x ${fmt(gamepadState.leftStick.x)}  y ${fmt(gamepadState.leftStick.y)}`
    );
    lines.push(
      `R-Stick  x ${fmt(gamepadState.rightStick.x)}  y ${fmt(gamepadState.rightStick.y)}`
    );
    const namedPressed = Object.entries(gamepadState.buttons)
      .filter(([, state]) => state.pressed)
      .map(([name]) => `${name}${BUTTON_LABELS[name] !== name ? `/${BUTTON_LABELS[name]}` : ""}`);
    lines.push(`Tasten   ${escapeHtml(namedPressed.join(", ") || "-")}`);
    lines.push(
      `Trigger  L2 ${fmt(gamepadState.buttons.L2.value)}  R2 ${fmt(gamepadState.buttons.R2.value)}`
    );

    const pressedButtons = gamepadState.raw.buttons
      .map((button, index) => (button.pressed ? index : null))
      .filter((index) => index !== null);
    lines.push(`Indizes  ${pressedButtons.length ? pressedButtons.join(", ") : "-"}`);

    for (const [key, value] of Object.entries(extra)) {
      lines.push(`${key.padEnd(8)} ${value}`);
    }

    if (hint) {
      lines.push("");
      lines.push(`<span class="portal-active">${escapeHtml(hint)}</span>`);
    }

    const markup = lines.join("\n");
    if (markup !== this._lastMarkup) {
      this.element.innerHTML = markup;
      this._lastMarkup = markup;
    }
  }

  dispose() {
    this.element.remove();
  }
}

function fmt(value) {
  const fixed = value.toFixed(2);
  return (value >= 0 ? " " : "") + fixed;
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// Der Geraetename kommt vom angeschlossenen Geraet und landet in innerHTML.
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}
