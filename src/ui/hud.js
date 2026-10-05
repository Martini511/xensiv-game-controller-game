import logoUrl from "../assets/lowres-Logo_Infineon_RGB.eps.png";
import { formatDate, formatTime } from "../core/leaderboard.js";
import { KEY_LABELS } from "../input/KeyboardMouseInput.js";

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
   * Mit `tabs` landen Text + Bestzeiten und die Steuerung in zwei Reitern,
   * von denen immer genau einer offen ist - anfangs der Info-Reiter.
   * @param {{title: string, body?: string[], controls?: {key: string, action: string}[],
   *          scores?: {seconds: number, date: string}[], highlight?: number,
   *          tabs?: {info: {label: string, key: string}, controls: {label: string, key: string}},
   *          footer?: string, tone?: string}} content
   */
  show({
    title,
    body = [],
    controls = [],
    scores = [],
    highlight = 0,
    tabs = null,
    footer = "",
    tone = "neutral",
  }) {
    this.content = { title, body, controls, scores, highlight, tabs, footer, tone };
    this.card.className = `message-card tone-${tone}`;

    const info = [
      ...body.map((line) => paragraph(line)),
      ...(scores.length ? [scoreTable(scores, highlight)] : []),
    ];
    const controlNodes = controls.length ? [controlTable(controls)] : [];

    this._tabs = null;
    if (tabs) {
      this._tabs = {
        info: tabSection(tabs.info, info),
        controls: tabSection(tabs.controls, controlNodes),
      };
      this.openTab("info");
      this.card.replaceChildren(
        heading(title),
        this._tabs.info,
        this._tabs.controls,
        footerLine(footer)
      );
    } else {
      this.card.replaceChildren(heading(title), ...info, ...controlNodes, footerLine(footer));
    }
    this.element.hidden = false;
  }

  /** @param {"info"|"controls"} name */
  openTab(name) {
    if (!this._tabs) return;
    for (const [key, section] of Object.entries(this._tabs)) {
      section.classList.toggle("is-open", key === name);
    }
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
    this._time = "0:00.00";
  }

  /**
   * @param {{label: string, button: string, marked: boolean}[]} sensors
   * @param {string} [time] formatierte Laufzeit; ohne Angabe bleibt die letzte stehen
   */
  update(sensors, time = this._time) {
    this._time = time;
    const found = sensors.filter((sensor) => sensor.marked).length;
    this._render(
      `<div class="mission-time">\u23f1 ${escapeHtml(time)}</div>` +
        `<div class="mission-title">XENSIV\u2122 SENSORS ${found} / ${sensors.length}</div>` +
        sensors
          .map((sensor) => {
            const text = sensor.marked ? `${sensor.label} (${sensor.button})` : "???";
            return `<div class="sensor-row ${sensor.marked ? "is-found" : ""}">${
              sensor.marked ? "\u25a0" : "\u25a1"
            } ${escapeHtml(text)}</div>`;
          })
          .join("")
    );
  }

  /** Anzeige im Erkundungsmodus: wie viele Bauteile schon entdeckt sind. */
  showExplore(found, total) {
    this._render(
      `<div class="mission-time">EXPLORE</div>` +
        `<div class="mission-title">PARTS ${found} / ${total}</div>`
    );
  }

  _render(markup) {
    if (markup !== this._last) {
      this.element.innerHTML = markup;
      this._last = markup;
    }
  }
}

/** Produktinfo zu dem Bauteil, neben dem der Charakter gerade steht. */
export class InfoBox {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "info-box";
    this.element.hidden = true;
    parent.appendChild(this.element);
    this._key = null;
  }

  /**
   * @param {{id: string, button?: string}|null} part
   * @param {{title: string, used: {name: string, type: string},
   *          alternatives: {name: string, type: string, soon?: boolean}[]}} [info]
   */
  show(part, info) {
    const key = part ? part.id : null;
    if (key === this._key) return;
    this._key = key;

    if (!part || !info) {
      this.element.hidden = true;
      return;
    }

    const title = document.createElement("div");
    title.className = "info-title";
    title.textContent = info.title;

    const tag = document.createElement("div");
    tag.className = "info-tag";
    tag.textContent = [part.id, part.button].filter(Boolean).join(" \u00b7 ");

    const children = [title, tag, sectionLabel("Used here"), productRow(info.used, "is-used")];
    if (info.alternatives.length) {
      children.push(
        sectionLabel("Other IFX solutions"),
        ...info.alternatives.map((part) => productRow(part, part.soon ? "is-soon" : ""))
      );
    }

    this.element.replaceChildren(...children);
    this.element.hidden = false;

    if (this.element.classList.contains("is-prominent")) {
      this.element.animate(
        [
          { opacity: 0, transform: "translateY(16px) scale(0.96)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    }
  }

  /** Grosse, auffaellige Variante fuer den Erkundungsmodus. */
  setProminent(on) {
    this.element.classList.toggle("is-prominent", on);
  }
}

function sectionLabel(text) {
  const node = document.createElement("div");
  node.className = "info-section";
  node.textContent = text;
  return node;
}

function productRow({ name, type }, modifier) {
  const row = document.createElement("div");
  row.className = `info-product ${modifier}`;

  const nameNode = document.createElement("div");
  nameNode.className = "info-name";
  nameNode.textContent = name;

  const typeNode = document.createElement("div");
  typeNode.className = "info-type";
  typeNode.textContent = type;

  row.append(nameNode, typeNode);
  return row;
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

/**
 * Kurzuebersicht der Notfall-Steuerung - erscheint, sobald mit Tastatur oder
 * Maus gespielt wird, und verschwindet wieder, wenn der Controller uebernimmt.
 */
export class KeyboardHint {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "keyboard-hint";
    this.element.hidden = true;

    const title = document.createElement("div");
    title.className = "keyboard-hint-title";
    title.textContent = "Keyboard & mouse";

    const keys = document.createElement("div");
    keys.textContent = `WASD move \u00b7 Mouse look \u00b7 ${KEY_LABELS.A}/Space jump \u00b7 ${KEY_LABELS.Y}/Enter use \u00b7 ${KEY_LABELS.L1}\u2013${KEY_LABELS.R3} sensors \u00b7 ${KEY_LABELS.DPAD_DOWN} info`;

    this._lockHint = document.createElement("div");
    this._lockHint.className = "keyboard-hint-lock";
    this._lockHint.textContent = "Click into the game to capture the mouse";

    this.element.append(title, keys, this._lockHint);
    parent.appendChild(this.element);
  }

  update(visible, pointerLocked) {
    if (this.element.hidden === !visible && this._lockHint.hidden === pointerLocked) return;
    this.element.hidden = !visible;
    this._lockHint.hidden = pointerLocked;
  }

  dispose() {
    this.element.remove();
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

function tabSection({ label, key }, children) {
  const section = document.createElement("div");
  section.className = "message-tab";

  const head = document.createElement("div");
  head.className = "message-tab-head";
  const labelNode = document.createElement("span");
  labelNode.className = "message-tab-label";
  labelNode.textContent = label;
  const keyNode = document.createElement("span");
  keyNode.className = "message-tab-key";
  keyNode.textContent = key;
  head.append(labelNode, keyNode);

  const content = document.createElement("div");
  content.className = "message-tab-body";
  content.append(...children);

  section.append(head, content);
  return section;
}

/**
 * Eine Zeile je Taste - gerendert als Grid. Hat eine Zeile eine
 * Tastatur-Belegung, kommt eine eigene Spalte samt Kopfzeile dazu.
 */
function controlTable(controls) {
  const table = document.createElement("div");
  table.className = "control-table";
  const withKeyboard = controls.some((row) => row.keyboard);

  const cell = (className, text) => {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  };

  if (withKeyboard) {
    table.classList.add("has-keyboard");
    table.append(
      cell("control-head", "Controller"),
      cell("control-head", "Keyboard"),
      cell("control-head", "")
    );
  }

  for (const { key, keyboard, action } of controls) {
    table.append(cell("control-key", key));
    if (withKeyboard) table.append(cell("control-key is-keyboard", keyboard ?? ""));
    table.append(cell("control-action", action));
  }

  return table;
}

/** Bestenliste als dreispaltiges Grid; `highlight` hebt den neuen Eintrag hervor. */
function scoreTable(scores, highlight) {
  const table = document.createElement("div");
  table.className = "score-table";

  const header = document.createElement("div");
  header.className = "score-head";
  header.textContent = "Best times";
  table.appendChild(header);

  scores.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = `score-row ${index + 1 === highlight ? "is-new" : ""}`;

    const rank = document.createElement("span");
    rank.textContent = `${index + 1}.`;
    const time = document.createElement("span");
    time.className = "score-time";
    time.textContent = formatTime(entry.seconds);
    const date = document.createElement("span");
    date.className = "score-date";
    date.textContent = formatDate(entry.date);

    row.append(rank, time, date);
    table.appendChild(row);
  });

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
