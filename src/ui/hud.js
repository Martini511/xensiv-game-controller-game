import logoUrl from "../assets/lowres-Logo_Infineon_RGB.eps.png";
import { formatDate, formatTime } from "../core/leaderboard.js";

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
  /**
   * @param {{title: string, body?: string[], controls?: {key: string, action: string}[],
   *          scores?: {seconds: number, date: string}[], highlight?: number,
   *          footer?: string, tone?: string}} content
   */
  show({
    title,
    body = [],
    controls = [],
    scores = [],
    highlight = 0,
    footer = "",
    tone = "neutral",
  }) {
    this.card.className = `message-card tone-${tone}`;
    this.card.replaceChildren(
      heading(title),
      ...body.map((line) => paragraph(line)),
      ...(scores.length ? [scoreTable(scores, highlight)] : []),
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
    this._time = "0:00.00";
  }

  /**
   * @param {{id: string, button: string, marked: boolean}[]} sensors
   * @param {string} [time] formatierte Laufzeit; ohne Angabe bleibt die letzte stehen
   */
  update(sensors, time = this._time) {
    this._time = time;
    const found = sensors.filter((sensor) => sensor.marked).length;
    this._render(
      `<div class="mission-time">\u23f1 ${escapeHtml(time)}</div>` +
        `<div class="mission-title">SENSORS ${found} / ${sensors.length}</div>` +
        sensors
          .map((sensor) => {
            const text = sensor.marked ? `${sensor.id} (${sensor.button})` : "???";
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
