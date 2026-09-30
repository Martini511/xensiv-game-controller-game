import { Game } from "./core/Game.js";

const container = document.getElementById("app");
if (!container) {
  throw new Error('Container "#app" nicht gefunden.');
}

const game = new Game(container);

// Die Loop startet erst, wenn das Platinen-Modell komplett geladen ist.
game
  .load()
  .then(() => game.start())
  .catch((error) => console.error(error));

// Vite HMR: alte Loop und Overlay beenden, bevor das Modul neu geladen wird
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}

// Zugriff auf die Instanz in der Browser-Konsole (nur im Dev-Server)
if (import.meta.env.DEV) {
  window.game = game;
}
