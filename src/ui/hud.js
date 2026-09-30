import logoUrl from "../assets/lowres-Logo_Infineon_RGB.eps.png";

/**
 * Spiel-UI: Titelbildschirm, Start-Banner, Missions-Anzeige, Kontext-Prompt
 * und die Meldungen fuer Sieg und Absturz. Bewusst reines DOM - Text bleibt so
 * scharf und ist billiger als Sprites in der Szene.
 */

/** Liegt waehrend der Kamerafahrt ueber der Szene. */
export class TitleScreen {
  constructor({ name, subtitle }, parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "title-screen";

    const logo = document.createElement("img");
    logo.className = "title-logo";
    logo.src = logoUrl;
    logo.alt = "Infineon";

    const heading = document.createElement("h1");
    heading.className = "title-name";
    heading.textContent = name;

    const sub = document.createElement("div");
    sub.className = "title-subtitle";
    sub.textContent = subtitle;

    this.element.append(logo, heading, sub);
    parent.appendChild(this.element);
  }

  hide() {
    if (this.element.classList.contains("is-hidden")) return;
    this.element.classList.add("is-hidden");
    this.element.addEventListener("transitionend", () => this.element.remove(), { once: true });
  }
}

export class MessageOverlay {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "message-overlay";
    this.element.hidden = true;

    this.card = document.createElement("div");
    this.card.className = "message-card";
    this.element.appendChild(this.card);

    parent.appendChild(this.element);
  }

  /**
   * @param {{title: string, body?: string[], controls?: {key: string, action: string}[],
   *          footer?: string, tone?: string}} content
   */
  show({ title, body = [], controls = [], footer = "", tone = "neutral" }) {
    this.card.className = `message-card tone-${tone}`;
    this.card.replaceChildren(
      heading(title),
      ...body.map((line) => paragraph(line)),
      ...(controls.length ? [controlTable(controls)] : []),
      footerLine(footer)
    );
    this.element.hidden = false;
  }

  hide() {
    this.element.hidden = true;
  }

  get visible() {
    return !this.element.hidden;
  }
}

export class MissionHud {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "mission-hud";
    parent.appendChild(this.element);
    this._last = "";
  }

  /** @param {{id: string, button: string, marked: boolean}[]} sensors */
  update(sensors) {
    const found = sensors.filter((sensor) => sensor.marked).length;
    const markup =
      `<div class="mission-title">SENSORS ${found} / ${sensors.length}</div>` +
      sensors
        .map((sensor) => {
          const text = sensor.marked ? `${sensor.id} (${sensor.button})` : "???";
          return `<div class="sensor-row ${sensor.marked ? "is-found" : ""}">${
            sensor.marked ? "\u25a0" : "\u25a1"
          } ${escapeHtml(text)}</div>`;
        })
        .join("");

    if (markup !== this._last) {
      this.element.innerHTML = markup;
      this._last = markup;
    }
  }
}

export class Prompt {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "prompt";
    this.element.hidden = true;
    parent.appendChild(this.element);
    this._last = null;
  }

  set(text) {
    if (text === this._last) return;
    this._last = text;

    if (!text) {
      this.element.hidden = true;
      return;
    }
    this.element.textContent = text;
    this.element.hidden = false;
  }
}

function heading(text) {
  const node = document.createElement("h1");
  node.textContent = text;
  return node;
}

function paragraph(text) {
  const node = document.createElement("p");
  node.textContent = text;
  return node;
}

/** Eine Zeile je Taste - gerendert als zweispaltiges Grid. */
function controlTable(controls) {
  const table = document.createElement("div");
  table.className = "control-table";

  for (const { key, action } of controls) {
    const keyNode = document.createElement("span");
    keyNode.className = "control-key";
    keyNode.textContent = key;

    const actionNode = document.createElement("span");
    actionNode.className = "control-action";
    actionNode.textContent = action;

    table.append(keyNode, actionNode);
  }

  return table;
}

function footerLine(text) {
  const node = document.createElement("div");
  node.className = "message-footer";
  node.textContent = text;
  return node;
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}
