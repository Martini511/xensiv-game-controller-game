import { BUTTON_LABELS } from "../input/GamepadManager.js";
import { ACTION_BUTTON, INFO_BUTTON, JUMP_BUTTON } from "./level-config.js";

/** Alle Spieltexte an einer Stelle - bewusst auf Englisch. */

const T = BUTTON_LABELS[ACTION_BUTTON];
const F = BUTTON_LABELS[JUMP_BUTTON];
const INFO = BUTTON_LABELS[INFO_BUTTON];

export const TITLE = {
  name: "Sensor Hunt",
  subtitle: "XENSIV\u2122 Game Controller",
};

/** Steuerung zeilenweise - wird als Tabelle im Banner gerendert. */
export const CONTROLS = [
  { key: "Left stick", action: "Move" },
  { key: "Right stick", action: "Rotate camera" },
  { key: F, action: "Jump" },
  { key: T, action: "Use the CONTROL pad / confirm" },
  { key: "L1 \u00b7 R1", action: "Mark a shoulder sensor" },
  { key: "L2 \u00b7 R2", action: "Mark a trigger sensor" },
  { key: "L3 \u00b7 R3", action: "Mark a stick sensor (click the stick)" },
  { key: INFO, action: "Open this info screen again" },
];

export const BRIEFING = {
  title: "Sensor Hunt",
  body: [
    "This is the PCB of the XENSIV game controller. You have been shrunk down to the size of a component.",
    "Six 3D magnetic sensors are mounted on this board. Find all six and mark them.",
    "Every sensor reads exactly one control - and that is the button you have to press to mark it.",
    "Hold a button down and its sensor blinks yellow - anywhere on the side you are currently standing on. That is how you track the right one down. Once marked, a sensor stops reacting.",
    "Two sensors sit on the front, near the shoulder cut-outs at the top left and top right.",
    `Hint: the other four are on the BACK of the PCB. Walk to the round CONTROL pad in the middle of the board and press ${T} to switch sides.`,
    "Every sensor is marked on the board - look for the small white box and the N/S sensor symbol in the silkscreen.",
    "Watch your step - if you walk over the edge, you fall off the board and the run is over.",
  ],
  controls: CONTROLS,
  footer: `Press ${T} to close this screen \u00b7 press ${INFO} to open it again`,
  tone: "neutral",
};

export const VICTORY = {
  title: "All sensors found",
  body: [
    "You located and marked all six 3D magnetic sensors of the controller.",
    "These are the sensors that turn stick, trigger and shoulder movement into measurable magnetic field changes.",
  ],
  footer: `Press ${T} to play again`,
  tone: "win",
};

export const FAILURE = {
  title: "You fell off the board",
  body: ["There is nothing to stand on beyond the PCB edge. The run is over."],
  footer: `Press ${T} to restart`,
  tone: "fail",
};
