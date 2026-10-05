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
 * Alles Flachere wird im Vorbeigehen ueberstiegen, alles Hoehere muss
 * angesprungen werden.
 *
 * 2.2 mm ist eine Untergrenze aus der Geometrie: Die Joystick-Schaefte ragen
 * auf der Unterseite 1.97 mm heraus, und ihre Bounding-Box ueberdeckt die
 * Sensormulde von U$19/U$18 mit. Blockieren sie, sind die beiden Sensoren
 * nicht mehr erreichbar - auch nicht per Sprung, weil man darin wieder auf
 * 0.62 mm zurueckfaellt.
 * >>> ANPASSEN, aber nicht unter 2.0. <<<
 */
export const OBSTACLE_HEIGHT_MM = 2.2;

/**
 * Lichte Hoehe des Charakters in Weltunits (0.6 = 1.5 mm). Bauteile, die
 * komplett darueber schweben, blockieren nicht - man laeuft darunter durch.
 * Der Chip ist nur rund 0.6 mm hoch; das Display haengt 2.25 mm ueber der
 * Platine und ist damit unterquerbar.
 */
export const CHARACTER_HEIGHT = 0.6;

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
 * Wie weit die Figur unter ihre Laufebene sacken darf, bevor der Sturz als
 * endgueltig gilt. Ein Sprung ueber ein Bohrloch bleibt damit rettbar.
 */
export const FALL_COMMIT_MM = 2;

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
  { id: "U$19", side: "bottom", button: "R3", info: "stick", x: 23.0, y: 4.5 },
  { id: "U$18", side: "bottom", button: "L3", info: "stick", x: -23.0, y: 4.5 },
  // ... und in den oberen Ecken, unter den Triggern
  { id: "U$4", side: "bottom", button: "R2", info: "trigger", x: 49.5, y: 42.5 },
  { id: "U$2", side: "bottom", button: "L2", info: "trigger", x: -49.5, y: 42.4 },
  // Oberseite: an den Schultern, jeweils neben dem N/S-Symbol
  { id: "U$9", side: "top", button: "R1", info: "shoulder", x: 55.6, y: 49.4 },
  { id: "U$8", side: "top", button: "L1", info: "shoulder", x: -55.9, y: 49.4 },
];

/** Globale Aktionen: Seitenwechsel und Sprung. */
export const ACTION_BUTTON = "Y";
export const JUMP_BUTTON = "A";

/** Oeffnet den Infobildschirm erneut - zum Nachschlagen der Steuerung. */
export const INFO_BUTTON = "DPAD_DOWN";

/** Startet nach dem Sieg den Erkundungsmodus (beschriftet "I"). */
export const EXPLORE_BUTTON = "X";

/** Wie nah man rankommen muss, um markieren zu koennen (mm). */
export const SENSOR_RADIUS_MM = 7;

/**
 * Die beiden Taster auf der Unterseite (Siebdruck "Prog" und "RESET").
 * Springt oder steht der Chip auf der weissen Kappe, wird sie eingedrueckt.
 * Koordinaten = Mitte des Tasters in CAD-XY (mm).
 */
export const PUSH_BUTTONS = [
  { id: "S1", label: "Prog", side: "bottom", x: 25.5, y: 14.8 },
  { id: "S2", label: "RESET", side: "bottom", x: 25.55, y: 21.1 },
];

/**
 * Hub der Tasterkappe (mm). Echte Taster haben ~0.25 mm - etwas mehr, damit
 * man es im Spiel sieht. Die Kappe steht 0.7 mm ueber dem Gehaeuse.
 */
export const PUSH_BUTTON_TRAVEL_MM = 0.6;

/**
 * Erkennung der Kappe im Modell: sie beginnt mindestens `gap` mm ueber der
 * Platine und ragt bis ueber `top` mm hinaus. Das Gehaeuse sitzt direkt auf
 * der Platine, seine duennen Deckbleche enden bei 1.55 mm.
 */
export const PUSH_BUTTON_CAP_MM = { gap: 1.2, top: 2.2 };

/**
 * Bauteile mit begehbarem Innenraum. Statt einer einzigen Hindernis-Box ueber
 * den ganzen Grundriss bekommen sie eine feine Kollision aus der echten
 * Geometrie - Waende, Boden, Kontakte und Dach einzeln. So kann der Chip in
 * den Steckverbinder J3 hineinlaufen (Oeffnung 4.75 mm breit, Boden bei
 * 0.85 mm, Kontakte ab 3.2 mm).
 *
 * Rechteck in CAD-XY (mm): alle Meshes, die komplett darin liegen, gehoeren
 * zum Bauteil.
 */
export const ENTERABLE_PARTS = [
  { id: "J3", side: "bottom", minX: 55.5, maxX: 65, minY: -7, maxY: 1.5 },
];

/** Rasterweite (mm), mit der die Geometrie begehbarer Bauteile abgetastet wird. */
export const ENTERABLE_CELL_MM = 0.25;

/**
 * Mindesthoehe ueber der Platine (mm), ab der ein Mesh zum begehbaren Bauteil
 * gehoert. Die Loetpads darunter (0.04 mm) bleiben normale Platinenteile.
 */
export const ENTERABLE_MIN_HEIGHT_MM = 0.3;

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

/**
 * Weitere Infineon-Bauteile fuer den Erkundungsmodus, alle auf der Unterseite.
 * Koordinaten aus Draufsichten des Modells abgemessen (CAD-XY in mm).
 * `sizeMm` ist die Rahmengroesse, `radiusMm` die Reichweite der Info-Box.
 */
export const COMPONENTS = [
  // ESD-Schutzdioden, je drei um die vier unteren Sensoren
  { id: "D1", info: "esd", x: -25.6, y: 6.5, sizeMm: 1.6, radiusMm: 2 },
  { id: "D2", info: "esd", x: 20.4, y: 6.9, sizeMm: 1.6, radiusMm: 2 },
  { id: "D3", info: "esd", x: -51.4, y: 43.2, sizeMm: 1.6, radiusMm: 2 },
  { id: "D4", info: "esd", x: 46.4, y: 43.8, sizeMm: 1.6, radiusMm: 2 },
  { id: "D5", info: "esd", x: -26.4, y: 3.6, sizeMm: 1.6, radiusMm: 2 },
  { id: "D6", info: "esd", x: 20.5, y: 4.1, sizeMm: 1.6, radiusMm: 2 },
  { id: "D7", info: "esd", x: -47.9, y: 41.4, sizeMm: 1.6, radiusMm: 2 },
  { id: "D8", info: "esd", x: 52.5, y: 42.1, sizeMm: 1.6, radiusMm: 2 },
  { id: "D9", info: "esd", x: -21.0, y: 8.1, sizeMm: 1.6, radiusMm: 2 },
  { id: "D10", info: "esd", x: 23.0, y: 0.4, sizeMm: 1.6, radiusMm: 2 },
  { id: "D11", info: "esd", x: -51.6, y: 41.1, sizeMm: 1.6, radiusMm: 2 },
  { id: "D12", info: "esd", x: 50.3, y: 40.8, sizeMm: 1.6, radiusMm: 2 },
  { id: "U1", info: "capsense", x: 25.0, y: 35.5, sizeMm: 5.5, radiusMm: 4.5 },
  { id: "IC4", info: "usb", x: -11.5, y: 4.2, sizeMm: 5.5, radiusMm: 4.5 },
  { id: "IC1", info: "ldo", x: -64.0, y: -28.5, sizeMm: 10, radiusMm: 6.5 },
  { id: "U2", info: "psoc", x: 0, y: 42.5, sizeMm: 24, radiusMm: 12 },
];

/** Bauteil-Daten in Weltkoordinaten. */
export function buildComponents() {
  return COMPONENTS.map((part) => ({
    ...part,
    side: "bottom",
    radius: part.radiusMm * MM,
    position: modelMmToWorld(part.x, part.y, LEVELS.bottom.walkZ, "bottom"),
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
