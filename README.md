# Controller Game

Grundgeruest fuer ein 3D-Third-Person-Adventure im Browser: **Three.js** + **Vite**,
gesteuert ueber einen Gamepad-Controller (Gamepad API).

Aktueller Stand: die reale Platine (`src/assets/platine.glb`) wird als Level
geladen, der Charakter laeuft ueber Ober- und Unterseite, der Wechsel
passiert ueber die Kontrollflaeche in der Boardmitte. Beim Wechsel auf die
Unterseite wird die Platine um 180 Grad gedreht, sodass der Charakter auch
dort auf einer nach oben zeigenden Flaeche laeuft.

## Spielziel

Alle sechs 3D-Magnetsensoren des Controllers finden und markieren. Markiert
wird jeder Sensor mit **genau der Taste, die er im echten Controller abtastet**:

| Bauteil | Seite       | Taste | Lage |
| ------- | ----------- | ----- | ---- |
| `U$8`   | Vorderseite | L1    | linke Schulter, neben dem N/S-Symbol |
| `U$9`   | Vorderseite | R1    | rechte Schulter, neben dem N/S-Symbol |
| `U$2`   | Rueckseite  | L2    | obere Platinenecke (linker Trigger) |
| `U$4`   | Rueckseite  | R2    | obere Platinenecke (rechter Trigger) |
| `U$18`  | Rueckseite  | L3    | unter dem linken Stick |
| `U$19`  | Rueckseite  | R3    | unter dem rechten Stick |

Der Rahmen eines Sensors wird erst sichtbar, wenn man nah genug dran ist –
suchen muss man selbst. **Haelt man eine Taste gedrueckt, leuchtet der
zugehoerige Sensor auf** (unabhaengig von der Entfernung, solange man auf
derselben Platinenseite steht) – so laesst er sich gezielt aufspueren.
Wer ueber die Platinenkante laeuft, faellt herunter und die Runde ist vorbei
(T startet neu).

## Setup

Voraussetzung: Node.js 18+ und npm.

```bash
npm install
npm run dev
```

Der Dev-Server laeuft danach unter der in der Konsole angezeigten URL
(standardmaessig <http://localhost:5173>).

### Scripts

| Script            | Beschreibung                          |
| ----------------- | ------------------------------------- |
| `npm run dev`     | Dev-Server mit Hot Module Replacement |
| `npm run build`   | Produktions-Build nach `dist/`        |
| `npm run preview` | Build lokal testen                    |

## Steuerung

| Eingabe                | Aktion                                        |
| ---------------------- | --------------------------------------------- |
| Linker Stick           | Charakter bewegen                             |
| Rechter Stick          | Kamera um Charakter drehen                    |
| T (Y, Button 3)        | Kontrollflaeche benutzen / Meldung bestaetigen |
| F (A, Button 0)        | Springen / Intro ueberspringen                |
| L1 R1 L2 R2 L3 R3      | Sensor markieren (jeweils die passende Taste)  |
| D-Pad runter (13)      | Infobildschirm mit der Steuerung oeffnen       |

Die Bewegung ist kamerarelativ: Stick nach oben bewegt den Charakter immer
von der Kamera weg.

> **Hinweis zur Gamepad API:** Browser geben einen Controller aus
> Datenschutzgruenden erst frei, nachdem einmal eine Taste am Controller
> gedrueckt wurde. Bis dahin zeigt das Debug-Overlay
> "Kein Controller verbunden".

## Debug-Overlay

Oben links werden in Echtzeit angezeigt:

- Verbindungsstatus, Geraetename und Mapping
- Werte des linken und rechten Sticks (nach Deadzone)
- Status von Aktion (R2) und Sprung (A) sowie alle gedrueckten Button-Indizes
- FPS, aktuelle Seite (`top` / `bottom`) und Position
- Hinweis "Kontrollflaeche aktiv", sobald der Charakter in der Triggerzone steht

## Projektstruktur

```
index.html
vite.config.js
src/
  main.js                    Einstiegspunkt (laedt Modell, startet dann die Loop)
  core/
    Game.js                  Game-Loop, Portal-Logik, Ebenen-Zustand
    createRenderer.js        WebGLRenderer + PerspectiveCamera + Resize
    createScene.js           Licht, Fog, Dev-Grid (= Boden der Unterseite)
    ThirdPersonCamera.js     Gedaempfte Verfolger-Kamera
    model-loader.js          GLTFLoader, Hierarchie-Analyse, Material-Check
    Board.js                 Transform des Modells, Ober-/Unterseiten-Trennung
    level-config.js          Alle anpassbaren Level-Werte (CAD-Koordinaten)
  entities/
    Character.js             Bewegung, Drehung, Bodenhaftung
    ChipModel.js             Spielermodell (SO-8) inkl. Bein-Rigging
    PortalMarker.js          Ring auf der Kontrollflaeche
    SensorMarker.js          Rahmen auf den Sensoren
  input/
    GamepadManager.js        Gamepad-API-Polling, Deadzone, Button-States
    DebugOverlay.js          HTML-Overlay fuer Live-Werte
  ui/
    overlays.js              Ladeanzeige und Fade-to-Black
  assets/
    platine.glb              Das Platinenmodell
```

## Level-Werte anpassen

Alle Stellschrauben stecken in [src/core/level-config.js](src/core/level-config.js)
und stehen in **CAD-Koordinaten (Millimeter, Z-up)** – also exakt in den
Einheiten, die die Konsolen-Analyse beim Start ausgibt:

| Konstante              | Bedeutung                                              |
| ---------------------- | ------------------------------------------------------ |
| `SCALE_FACTOR`         | Weltunits pro Modell-Unit (Groesse des Charakters)      |
| `OBSTACLE_HEIGHT_MM`   | Ab welcher Bauteilhoehe blockiert wird statt drueber zu steigen |
| `CHARACTER_HEIGHT`     | Kopfhoehe \u2013 was komplett darueber schwebt, blockiert nicht |
| `LEVELS.*.walkZ`       | Hoehe, auf der der Charakter laeuft                     |
| `LEVELS.*.bounds`      | Bewegungsgrenzen in der Platinen-Ebene                  |
| `PORTAL.top/bottom`    | Mittelpunkt der Kontrollflaeche bzw. Zielposition       |
| `PORTAL.radiusMm`      | Groesse der Triggerzone                                 |
| `SPAWN_MM`             | Startposition des Charakters (aktuell das OLED-Display)  |
| `SENSORS`              | Position der vier Magnetsensoren (CAD-XY)               |
| `SENSOR_RADIUS_MM`     | Wie nah man ran muss, um markieren zu koennen           |
| `MAX_GROUND_HEIGHT_MM` | Bis zu welcher Hoehe etwas als Untergrund zaehlt        |
| `FALL_DEATH_Y`         | Tiefe, ab der der Sturz als verloren gilt               |

Die Spieltexte (Banner, Sieg, Absturz) stehen in
[src/core/mission-texts.js](src/core/mission-texts.js).

## Performance

Das CAD-Modell besteht aus ueber 1300 Einzel-Meshes. Damit das fluessig laeuft:

- **Batching:** Alle Meshes werden je Seite und Material zu wenigen Batches
  zusammengefasst (`Board.js`) – aus ~520 Draw-Calls werden ~60.
- **Nur eine Seite sichtbar:** Die abgewandte Platinenseite wird komplett
  ausgeblendet.
- **Kein Transmission-Pass:** Glas-/Linsenmaterialien werden auf einfache
  Transparenz umgestellt, sonst zeichnet Three.js die Szene pro Frame ein
  zweites Mal.
- **Schatten nur vom Charakter:** Die Platine faengt Schatten nur auf, wirft
  selbst keinen; das Shadow-Frustum folgt dem Charakter.
- Reicht die Framerate trotzdem nicht, `ENABLE_SHADOWS` in
  [src/core/createRenderer.js](src/core/createRenderer.js) auf `false` setzen.

## Naechste Schritte

- **Charakter-Modell:** `character.setModel(gltf.scene)` aufrufen – das
  Platzhalter-Mesh haengt bereits in einer eigenen Gruppe, Bewegung und
  Kamera bleiben unveraendert.
- **Kollision:** In `Game._clampToLevel()` statt der Box-Grenzen einen
  Raycast gegen die Bauteile setzen.
- **Interaktionspunkte:** `game.currentSide` sagt, auf welcher Ebene der
  Charakter gerade unterwegs ist.
