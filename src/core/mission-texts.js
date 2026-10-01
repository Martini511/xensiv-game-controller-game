import { BUTTON_LABELS } from "../input/GamepadManager.js";
import { ACTION_BUTTON, EXPLORE_BUTTON, INFO_BUTTON, JUMP_BUTTON } from "./level-config.js";

/** Alle Spieltexte an einer Stelle - bewusst auf Englisch. */

const T = BUTTON_LABELS[ACTION_BUTTON];
const F = BUTTON_LABELS[JUMP_BUTTON];
const INFO = BUTTON_LABELS[INFO_BUTTON];
const I = BUTTON_LABELS[EXPLORE_BUTTON];

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
  { key: "D-Pad \u2190 + \u2192", action: "Back to the intro" },
];

export const BRIEFING = {
  title: "Sensor Hunt",
  body: [
    "This is the PCB of the XENSIV game controller. You have been shrunk down to the size of a component.",
    "Six magnetic sensors are mounted on this board. Find all six and mark them.",
    "Every sensor reads exactly one control - and that is the button you have to press to mark it.",
    "Hold a button down and its sensor blinks yellow - anywhere on the side you are currently standing on. That is how you track the right one down. Once marked, a sensor stops reacting.",
    "Two sensors sit on the front, near the shoulder cut-outs at the top left and top right.",
    `Hint: the other four are on the BACK of the PCB. Walk to the round CONTROL pad in the middle of the board and press ${T} to switch sides.`,
    "Every sensor is marked on the board - look for the small white box and the N/S sensor symbol in the silkscreen.",
    "Stand next to a sensor to learn which XENSIV\u2122 part it is.",
    "Watch your step - if you walk over the edge or into one of the drill holes, you fall off the board and the run is over.",
    "The clock runs while you play. Your five fastest runs are kept.",
  ],
  controls: CONTROLS,
  footer: `Press ${T} to close this screen \u00b7 press ${INFO} to open it again`,
  tone: "neutral",
};

/** Fusszeile des allerersten Briefings - nur dort laesst sich die Jagd ueberspringen. */
export const BRIEFING_START_FOOTER = `Press ${T} to start the hunt \u00b7 press ${I} to just explore the board`;

export const VICTORY = {
  title: "All sensors found",
  body: [
    "You located and marked all six magnetic sensors of the controller.",
    "These are the sensors that turn stick, trigger and shoulder movement into measurable magnetic field changes.",
  ],
  footer: `Press ${T} to play again \u00b7 press ${I} to explore the board`,
  tone: "win",
};

export const EXPLORE = {
  title: "Explore mode",
  body: [
    "Take your time - there is no clock in this mode.",
    "Every Infineon part on the board is framed. Walk onto a frame to learn which part it is.",
    "Most of them sit on the BACK of the PCB - use the CONTROL pad to switch sides.",
    "Falling off is harmless here: you are simply put back on the board.",
  ],
  footer: `Press ${T} to start exploring \u00b7 press ${INFO} for the menu`,
  tone: "win",
};

/** Menue im Erkundungsmodus, wenn vorher keine Jagd gewonnen wurde. */
export const EXPLORE_MENU = {
  title: "Explore mode",
  body: ["Ready for the real thing? Start the sensor hunt - or keep looking around."],
  footer: `Press ${T} to start the hunt \u00b7 press ${I} to keep exploring`,
  tone: "neutral",
};

export const FAILURE = {
  title: "You fell off the board",
  body: ["There is nothing to stand on beyond the PCB edge. The run is over."],
  footer: `Press ${T} to restart`,
  tone: "fail",
};

export const RESET_CONFIRM = {
  title: "Back to the intro?",
  body: ["Your current run and everything you have discovered will be reset."],
  footer: `Press ${T} to go back to the intro \u00b7 press ${F} to cancel`,
  tone: "fail",
};

/** Produktinfos je Sensorgruppe - Schluessel wie `info` in SENSORS. */
export const COMPONENT_INFO = {
  shoulder: {
    title: "Shoulder buttons L1 / R1",
    used: { name: "XENSIV\u2122 TLV4964-2M", type: "Hall magnetic switch" },
    alternatives: [],
  },
  trigger: {
    title: "Triggers L2 / R2",
    used: { name: "XENSIV\u2122 TLV493D-W2BW", type: "Magnetic 3D Hall sensor" },
    alternatives: [
      { name: "XENSIV\u2122 TLI55910", type: "Linear x-TMR sensor" },
      { name: "XENSIV\u2122 TLV493D-x4D7", type: "Next Generation Magnetic 3D Hall sensor" },
      { name: "XENSIV\u2122 TLI49901", type: "Linear z Hall sensor" },
      { name: "Linear z-TMR sensor", type: "Coming soon", soon: true },
    ],
  },
  stick: {
    title: "Joysticks left / right",
    used: { name: "XENSIV\u2122 TLV493D-W2BW", type: "Magnetic 3D Hall sensor" },
    alternatives: [
      { name: "XENSIV\u2122 TLV493D-x4D7", type: "Next Generation Magnetic 3D Hall sensor" },
      { name: "XENSIV\u2122 TLV552D", type: "2D x/y TMR sensor" },
    ],
  },
  esd: {
    title: "ESD protection",
    used: { name: "ESD241", type: "TVS Diode" },
    alternatives: [],
  },
  capsense: {
    title: "Touch buttons",
    used: { name: "CY8CMBR3116", type: "CAPSENSE\u2122 Mechanical Button Replacement" },
    alternatives: [],
  },
  usb: {
    title: "USB interface",
    used: { name: "CY7C65211", type: "USB C controller" },
    alternatives: [],
  },
  ldo: {
    title: "Power supply",
    used: { name: "TLE42744GS", type: "3.3V LDO Voltage Regulator" },
    alternatives: [],
  },
  psoc: {
    title: "Main controller",
    used: { name: "CYBLE416045-02", type: "PSoC\u2122 6 BLE/WiFi Module" },
    alternatives: [],
  },
};
