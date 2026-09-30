import * as THREE from "three";

/**
 * ============================================================================
 *  Level-Konfiguration
 * ============================================================================
 *
 * ALLE Werte hier stehen in MODELL-KOORDINATEN, also exakt so, wie sie in der
 * Konsolen-Analyse (siehe model-loader.js -> analyzeHierarchy) ausgegeben
 * werden:
 *
 *   - Einheit: Millimeter
 *   - Achsen:  CAD-Konvention, Z = oben (das GLB ist Z-up)
 *              X = Platinen-Breite, Y = Platinen-Tiefe, Z = Hoehe
 *
 * Die Umrechnung in Three.js-Weltkoordinaten (Y-up) erledigen die Helfer
 * unten. Du musst also nur die CAD-Werte anpassen.
 *
 * Messwerte der aktuellen platine.glb:
 *   Platinensubstrat : x -80 .. +80 | y -52.5 .. +52.5 | z 0.00 .. 1.51
 *   Oberseiten-Kupfer: z = 1.56      Unterseiten-Kupfer: z = -0.05
 *   Bauteile Oberseite : z bis +26.1 (die beiden Joysticks bei x = +/-23, y = 4.5)
 *   Bauteile Unterseite: z bis  -9.7
 *   Kontrollflaeche "CONTROL" (Silkscreen mit Zahnrad): Mitte bei x = 0, y = 0,
 *                        Durchmesser ca. 9 mm, zwischen den beiden Joysticks
 *   OLED-Display       : x -13.3 .. +13.4 | y 22.1 .. 50.0 | z 3.8 .. 6.3
 */

/**
 * Weltunits pro Modell-Unit.
 * Das GLB liegt in Metern vor (Platine = 0.16 x 0.105 m). Bei 400 ist die
 * Platine 64 x 42 Units gross und der ~1.7 Units hohe Charakter entspricht
 * gut 4 mm - also etwa der Groesse eines groesseren SMD-Bauteils.
 * >>> ANPASSEN, wenn dir der Charakter zu gross/klein vorkommt. <<<
 */
export const SCALE_FACTOR = 400;

/** Millimeter -> Weltunits. */
const MM = SCALE_FACTOR / 1000;

/** Millimeter -> Weltunits, auch ausserhalb dieses Moduls nutzbar. */
export const WORLD_PER_MM = MM;

/**
 * Ab welcher Hoehe ueber der begehbaren Flaeche ein Bauteil blockiert (mm).
 * Alles Flachere wird ueberstiegen. Die Platine hat auf der Oberseite fast nur
 * Bauteile bis ca. 2.2 mm; darueber liegen nur das Display (4.8 mm) und die
 * beiden Joysticks (24.5 mm) - genau die sollen Hindernisse sein.
 * >>> ANPASSEN, wenn zu viel oder zu wenig blockiert. <<<
 */
export const OBSTACLE_HEIGHT_MM = 3;

/**
 * Lichte Hoehe des Charakters in Weltunits. Bauteile, die komplett darueber
 * schweben - etwa der ueberstehende Joystick-Kopf - blockieren nicht, man
 * laeuft darunter durch.
 */
export const CHARACTER_HEIGHT = 1.2;

/** CAD-Modell ist Z-up, Three.js ist Y-up: -90 Grad um X. */
export const MODEL_ROTATION_X = -Math.PI / 2;

/**
 * Rechnet CAD-Koordinaten (mm, Z-up) in Weltkoordinaten (Units, Y-up) um.
 *
 * Die Platine wird fuer die Unterseite komplett um 180 Grad um die Welt-Z-Achse
 * gekippt, damit der Charakter auch dort auf einer nach oben zeigenden Flaeche
 * laeuft. Um Z (und nicht um X) wird gekippt, weil die Beschriftung der
 * Unterseite dann richtig herum lesbar ist. Diese Funktion bildet genau die
 * beiden Zustaende ab:
 *
 *   side "top"    : world = ( x,  z, -y) * MM
 *   side "bottom" : world = (-x, -z, -y) * MM   (= top, zusaetzlich 180 Grad um Z)
 */
export function modelMmToWorld(xMm, yMm, zMm, side = "top", target = new THREE.Vector3()) {
  return side === "bottom"
    ? target.set(-xMm * MM, -zMm * MM, -yMm * MM)
    : target.set(xMm * MM, zMm * MM, -yMm * MM);
}

/** Rotation der Platine um die Welt-Z-Achse je Seite. */
export const SIDE_FLIP_Z = { top: 0, bottom: Math.PI };

/** Platinen-Referenzhoehen in mm (aus der Analyse uebernommen). */
export const BOARD = {
  topSurfaceZ: 1.56,
  bottomSurfaceZ: -0.05,
  /** Trennebene zwischen Ober- und Unterseite (Mitte des Substrats). */
  midZ: 0.75,
};

/**
 * Die beiden begehbaren Ebenen.
 *
 * `walkZ` : Hoehe (mm, CAD-Z), auf der die Fuesse des Charakters stehen.
 *
 * Die begehbare Flaeche ergibt sich nicht mehr aus einem Rechteck, sondern aus
 * der echten Platinenkontur (siehe Hoehenraster in Board.js) - deshalb gibt es
 * hier keine `bounds` mehr.
 */
export const LEVELS = {
  top: { walkZ: BOARD.topSurfaceZ },
  bottom: { walkZ: BOARD.bottomSurfaceZ },
};

/**
 * Maximale Hoehe ueber der Laufflaeche (mm), die noch als begehbarer Untergrund
 * gilt. Das Display (4.8 mm) zaehlt dazu, die Joysticks (24.5 mm) nicht - auf
 * denen steht man nicht, an denen laeuft man vorbei.
 */
export const MAX_GROUND_HEIGHT_MM = 8;

/** Faellt der Charakter unter diese Tiefe (Weltunits), ist die Runde verloren. */
export const FALL_DEATH_Y = -25;

/**
 * Kontrollflaeche = Portal zwischen den Ebenen.
 *
 * `top` / `bottom` : Mittelpunkt der Triggerzone bzw. Zielposition in CAD-XY.
 * `radiusMm`       : Radius der Triggerzone (XY-Abstand, Hoehe wird ignoriert).
 *
 * Standard ist das "CONTROL"-Feld in der Boardmitte (x=0, y=0). Der Radius ist
 * bewusst groesser als das Silkscreen-Symbol (ca. 4.5 mm), damit der Charakter
 * die Zone zuverlaessig trifft.
 * >>> ANPASSEN, wenn das Portal woanders sitzen soll. <<<
 */
export const PORTAL = {
  radiusMm: 10,
  top: { x: 0, y: 0 },
  bottom: { x: 0, y: 0 },
  /** Dauer des Fade-to-Black in Millisekunden (Hin- und Rueckblende). */
  fadeDurationMs: 400,
};

/**
 * Startposition des Charakters in CAD-XY (mm): auf dem OLED-Display
 * (x -13.3 .. +13.4, y 22.1 .. 50.0). Die Starthoehe kommt aus dem
 * Hoehenraster, man steht also automatisch auf der Oberkante des Displays.
 */
export const SPAWN_MM = { x: 0, y: 36 };

/**
 * Spielziel: die sechs 3D-Magnetsensoren. Vier sitzen auf der Unterseite,
 * zwei auf der Oberseite; alle sind im Siebdruck markiert. Die Koordinaten
 * sind aus dem Modell abgemessen (CAD-XY in mm).
 *
 * `button` ist die Taste, die der jeweilige Sensor im echten Controller
 * abtastet - und genau die muss zum Markieren gedrueckt werden.
 */
export const SENSORS = [
  // Unterseite: unter den beiden Sticks (Stickdruck L3/R3) ...
  { id: "U$19", side: "bottom", button: "R3", x: 23.0, y: 4.5 },
  { id: "U$18", side: "bottom", button: "L3", x: -23.0, y: 4.5 },
  // ... und in den oberen Ecken, unter den Triggern
  { id: "U$4", side: "bottom", button: "R2", x: 49.5, y: 42.5 },
  { id: "U$2", side: "bottom", button: "L2", x: -49.5, y: 42.4 },
  // Oberseite: an den Schultern, jeweils neben dem N/S-Symbol
  { id: "U$9", side: "top", button: "R1", x: 55.6, y: 49.4 },
  { id: "U$8", side: "top", button: "L1", x: -55.9, y: 49.4 },
];

/** Globale Aktionen: Seitenwechsel und Sprung. */
export const ACTION_BUTTON = "Y";
export const JUMP_BUTTON = "A";

/** Oeffnet den Infobildschirm erneut - zum Nachschlagen der Steuerung. */
export const INFO_BUTTON = "DPAD_DOWN";

/** Wie nah man rankommen muss, um markieren zu koennen (mm). */
export const SENSOR_RADIUS_MM = 7;

/** Kantenlaenge des Markierungsrahmens (mm) - etwa so gross wie das Kaestchen. */
export const SENSOR_MARKER_MM = 3.5;

/** Sensor-Daten in Weltkoordinaten, jeweils auf Hoehe ihrer Ebene. */
export function buildSensors() {
  return SENSORS.map((sensor) => ({
    ...sensor,
    radius: SENSOR_RADIUS_MM * MM,
    position: modelMmToWorld(sensor.x, sensor.y, LEVELS[sensor.side].walkZ, sensor.side),
  }));
}

/** Baut die Weltkoordinaten-Variante einer Ebene (beruecksichtigt die Kippung). */
export function buildLevel(side) {
  return {
    side,
    /** Y-Hoehe in Weltunits, auf der der Charakter steht. */
    y: modelMmToWorld(0, 0, LEVELS[side].walkZ, side).y,
  };
}

/** Portal-Daten in Weltkoordinaten, jeweils auf Hoehe der zugehoerigen Ebene. */
export function buildPortals() {
  const radius = PORTAL.radiusMm * MM;
  return {
    top: {
      position: modelMmToWorld(PORTAL.top.x, PORTAL.top.y, LEVELS.top.walkZ, "top"),
      radius,
    },
    bottom: {
      position: modelMmToWorld(PORTAL.bottom.x, PORTAL.bottom.y, LEVELS.bottom.walkZ, "bottom"),
      radius,
    },
  };
}

/** Trennhoehe zwischen Ober- und Unterseite in Weltkoordinaten (ungekippt). */
export const BOARD_MID_Y = BOARD.midZ * MM;

/** Startposition des Charakters auf der angegebenen Ebene, in Weltkoordinaten. */
export function buildSpawn(side) {
  return modelMmToWorld(SPAWN_MM.x, SPAWN_MM.y, LEVELS[side].walkZ, side);
}

export const OPPOSITE_SIDE = { top: "bottom", bottom: "top" };
