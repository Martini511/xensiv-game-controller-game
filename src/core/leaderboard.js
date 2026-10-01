/**
 * Bestenliste der schnellsten Durchlaeufe, gespeichert im localStorage.
 *
 * Bewusst ohne Namenseingabe: Mit einem Gamepad ist Texteingabe umstaendlich,
 * deshalb wird nur Zeit und Datum festgehalten.
 */

const STORAGE_KEY = "sensor-hunt.leaderboard";
const MAX_ENTRIES = 5;

/** @returns {{seconds: number, date: string}[]} aufsteigend sortiert */
export function loadScores() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => Number.isFinite(entry?.seconds))
      .sort((a, b) => a.seconds - b.seconds)
      .slice(0, MAX_ENTRIES);
  } catch {
    // Privater Modus oder beschaedigter Eintrag - dann eben ohne Bestenliste.
    return [];
  }
}

/**
 * Traegt eine Zeit ein.
 * @returns {{scores: object[], rank: number}} rank ist 1-basiert, 0 = nicht platziert
 */
export function addScore(seconds) {
  const entry = { seconds, date: new Date().toISOString() };
  const scores = [...loadScores(), entry]
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, MAX_ENTRIES);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // Speichern fehlgeschlagen - die Liste gilt dann nur fuer diese Sitzung.
  }

  return { scores, rank: scores.indexOf(entry) + 1 };
}

/** Sekunden als M:SS.ms, z.B. 2:07.43 */
export function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** Kurzes Datum fuer die Bestenliste. */
export function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}
