/**
 * Zwei kleine Vollbild-Overlays:
 *  - LoadingOverlay: "Laedt Modell..." waehrend das GLB geladen wird
 *  - FadeOverlay:    Fade-to-Black beim Seitenwechsel (Portal)
 *
 * Beide nutzen CSS-Transitions aus index.html; die Klassen steuern nur die
 * `visible`-Klasse bzw. die Transition-Dauer.
 */

export class LoadingOverlay {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.id = "loading-overlay";

    this.label = document.createElement("div");
    this.label.className = "loading-text";
    this.label.textContent = "Lädt Modell…";
    this.element.appendChild(this.label);

    parent.appendChild(this.element);
  }

  /** @param {number|null} progress 0..1, oder null wenn nicht ermittelbar */
  setProgress(progress) {
    this.label.textContent =
      progress === null || progress === undefined
        ? "Lädt Modell…"
        : `Lädt Modell… ${Math.round(progress * 100)} %`;
  }

  setError(message) {
    this.label.textContent = `Fehler: ${message}`;
    this.label.classList.add("is-error");
  }

  hide() {
    this.element.classList.add("is-hidden");
    // transitionend kann ausbleiben, wenn der Tab im Hintergrund war
    setTimeout(() => this.element.remove(), 600);
  }
}

export class FadeOverlay {
  constructor(parent = document.body, durationMs = 400) {
    this.durationMs = durationMs;
    this.element = document.createElement("div");
    this.element.id = "fade-overlay";
    this.element.style.transitionDuration = `${durationMs}ms`;
    parent.appendChild(this.element);
  }

  /** Blendet nach Schwarz und loest auf, wenn die Transition durch ist. */
  fadeOut() {
    return this._transition(true);
  }

  fadeIn() {
    return this._transition(false);
  }

  _transition(toBlack) {
    this.element.classList.toggle("is-opaque", toBlack);
    return new Promise((resolve) => setTimeout(resolve, this.durationMs));
  }

  dispose() {
    this.element.remove();
  }
}
