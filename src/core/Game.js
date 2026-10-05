import * as THREE from "three";
import { createRenderer } from "./createRenderer.js";
import { createScene } from "./createScene.js";
import { ThirdPersonCamera } from "./ThirdPersonCamera.js";
import { Board } from "./Board.js";
import { IntroSequence } from "./IntroSequence.js";
import {
  PLATINE_BYTES,
  PLATINE_URL,
  PLAYER_URL,
  analyzeHierarchy,
  loadGLTF,
  normalizeMaterials,
} from "./model-loader.js";
import {
  ACTION_BUTTON,
  EXPLORE_BUTTON,
  FALL_COMMIT_MM,
  FALL_DEATH_Y,
  INFO_BUTTON,
  JUMP_BUTTON,
  OBSTACLE_HEIGHT_MM,
  OPPOSITE_SIDE,
  PORTAL,
  SENSOR_MARKER_MM,
  WORLD_PER_MM,
  buildComponents,
  buildLevel,
  buildPortals,
  buildSensors,
  buildSpawn,
} from "./level-config.js";
import { clampDistanceToBoxes, resolveBoxVsBoxes } from "./collision.js";
import { Character } from "../entities/Character.js";
import { ChipModel } from "../entities/ChipModel.js";
import { PortalMarker } from "../entities/PortalMarker.js";
import { SensorMarker } from "../entities/SensorMarker.js";
import { BUTTON_LABELS, GamepadManager } from "../input/GamepadManager.js";
import { KEY_LABELS, KeyboardMouseInput } from "../input/KeyboardMouseInput.js";
import { DebugOverlay } from "../input/DebugOverlay.js";
import { FadeOverlay, LoadingOverlay } from "../ui/overlays.js";
import {
  InfoBox,
  KeyboardHint,
  MessageOverlay,
  MissionHud,
  Prompt,
  TitleScreen,
} from "../ui/hud.js";
import { addScore, formatTime, loadScores } from "./leaderboard.js";
import {
  BRIEFING,
  BRIEFING_START_FOOTER,
  COMPONENT_INFO,
  EXPLORE,
  EXPLORE_MENU,
  FAILURE,
  RESET_CONFIRM,
  TITLE,
  VICTORY,
} from "./mission-texts.js";

const MAX_DELTA = 0.1; // Sekunden - verhindert Riesenspruenge nach Tab-Wechsel

/** Wie schnell der Charakter auf eine neue Bodenhoehe nachzieht (1/Sekunde). */
const GROUND_DAMPING = 16;

/**
 * Fallbeschleunigung und Absprunggeschwindigkeit in Weltunits/s(^2).
 * Sprunghoehe = JUMP_SPEED^2 / (2 * |GRAVITY|) = 2.4 Units = 6 mm - genug fuer
 * Display und Steckverbinder, zu wenig fuer die Joysticks.
 */
const GRAVITY = -30;
const JUMP_SPEED = 12;

/** Rasterpunkte je Achse, mit denen der Boden unter dem Grundriss abgetastet wird. */
const GROUND_SAMPLES = 5;

/**
 * Anteil der Rasterpunkte, die Boden brauchen, damit die Figur stehen bleibt.
 * Darunter kippt sie ins Loch - bei 0.5 faellt sie genau dann, wenn mehr als
 * die Haelfte des Grundrisses ueber Leere haengt.
 */
const MIN_SUPPORT_RATIO = 0.5;

/**
 * Maximale Stufe, die im Gehen genommen wird. Hoehere Flaechen tragen zwar
 * (man faellt davor nicht ins Leere), sind aber nur per Sprung erreichbar.
 * Identisch mit der Hindernis-Grenze, damit beides zusammenpasst.
 */
const STEP_UP_LIMIT = OBSTACLE_HEIGHT_MM * WORLD_PER_MM;

/** Fallhoehe unter der Laufebene, ab der der Sturz nicht mehr zu retten ist. */
const FALL_COMMIT_DEPTH = FALL_COMMIT_MM * WORLD_PER_MM;

/**
 * Zentrale Klasse: haelt Szene, Kamera, Input und Entities zusammen und
 * betreibt die Game-Loop (Input -> Update -> Render).
 *
 * Ablauf: `new Game(container)` -> `await game.load()` -> `game.start()`.
 * Die Loop startet erst, wenn das Platinen-Modell vollstaendig geladen ist.
 */
export class Game {
  constructor(container) {
    const { renderer, camera, dispose } = createRenderer(container);
    this.renderer = renderer;
    this.camera = camera;
    this._disposeRenderer = dispose;

    const { scene, fitToBounds, focusShadow } = createScene({ worldSize: 20 });
    this.scene = scene;
    this._fitToBounds = fitToBounds;
    this._focusShadow = focusShadow;

    /** Begehbare Ebenen und Portalpositionen in Weltkoordinaten. */
    this.levels = { top: buildLevel("top"), bottom: buildLevel("bottom") };
    this.portals = buildPortals();
    /** "top" | "bottom" - fuer spaetere Logik (Interaktionspunkte etc.). */
    this.currentSide = "top";

    this.character = new Character({ moveSpeed: 6 });
    this.character.position.copy(buildSpawn("top"));
    this.scene.add(this.character.object3D);

    this.cameraRig = new ThirdPersonCamera(this.camera, this.character, {
      distance: 6,
      height: 1.5,
      lookAtHeight: 0.5,
      collider: (origin, direction, distance) =>
        this.board
          ? clampDistanceToBoxes(
              origin,
              direction,
              distance,
              this.board.cameraBlockers[this.currentSide]
            )
          : distance,
    });

    // Notfall-Steuerung: Tastatur + Maus laufen immer parallel zum Controller.
    this.gamepad = new GamepadManager({
      deadzone: 0.18,
      keyboard: new KeyboardMouseInput(this.renderer.domElement),
    });
    this.debugOverlay = new DebugOverlay(document.body);
    this.loadingOverlay = new LoadingOverlay(document.body);
    this.fadeOverlay = new FadeOverlay(document.body, PORTAL.fadeDurationMs);
    this.missionHud = new MissionHud(document.body);
    this.prompt = new Prompt(document.body);
    this.infoBox = new InfoBox(document.body);
    this.message = new MessageOverlay(document.body);
    this.keyboardHint = new KeyboardHint(document.body);
    this.titleScreen = null;

    /** "intro" | "briefing" | "playing" | "falling" | "failed" | "won" */
    this.state = "intro";
    this.sensors = buildSensors().map((sensor) => ({
      ...sensor,
      label: COMPONENT_INFO[sensor.info].used.name.replace(/^XENSIV\u2122\s*/, ""),
      marked: false,
      marker: null,
    }));
    /** Weitere Bauteile; `marked` heisst hier "im Erkundungsmodus entdeckt". */
    this.components = buildComponents().map((part) => ({ ...part, marked: false, marker: null }));
    /** "mission" bis zum Sieg, danach optional "explore". */
    this.mode = "mission";
    this._results = null;
    /** Nur auf dem Start-Briefing kann man die Jagd ueberspringen. */
    this._atStart = false;
    /** Laufzeit in Sekunden; laeuft nur waehrend des aktiven Spiels. */
    this.runTime = 0;

    this.board = null;
    this.portalMarker = null;
    this.intro = null;
    this._inPortalZone = false;
    this._nearSensor = null;
    this._isTransitioning = false;
    this._verticalVelocity = 0;
    this._isGrounded = true;

    this._clock = new THREE.Clock();
    this._frameId = null;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._moveDirection = new THREE.Vector3();
    this._fps = 0;

    this._tick = this._tick.bind(this);
  }

  /** Laedt Platine und Spielermodell und baut beide in die Szene ein. */
  async load() {
    try {
      const [gltf, player] = await Promise.all([
        loadGLTF(
          PLATINE_URL,
          (progress) => this.loadingOverlay.setProgress(progress),
          PLATINE_BYTES
        ),
        loadGLTF(PLAYER_URL),
      ]);

      // Analyse VOR der Transformation: die Werte stehen damit in
      // CAD-Koordinaten (mm, Z-up) - genau so, wie level-config.js sie erwartet.
      analyzeHierarchy(gltf.scene, {
        label: "Platine",
        unitScale: 1000,
        unitLabel: "mm (CAD, Z-up)",
      });

      normalizeMaterials(gltf.scene);
      normalizeMaterials(player.scene);

      const chip = new ChipModel(player.scene);
      this.character.setModel(chip.object3D, chip);
      // Hitbox folgt dem Modell, damit beide beim Skalieren nicht auseinanderlaufen.
      this.character.halfExtents.copy(chip.halfExtents);

      this.board = new Board(gltf.scene);
      this.scene.add(this.board.object3D);
      this._fitToBounds(this.board.boundingBox);

      this._createPortalMarker();
      this._createSensorMarkers();
      this._createComponentMarkers();
      this._setSide("top");
      this.cameraRig.snapToTarget();
      this.missionHud.update(this.sensors);
      this.loadingOverlay.hide();
    } catch (error) {
      this.loadingOverlay.setError(error.message);
      throw error;
    }
  }

  start() {
    this.gamepad.start();
    // Ausgangslage der Kamera - die Intro-Fahrt endet dort, auch nach einem Reset.
    this._cameraHome = {
      pitch: this.cameraRig.pitch,
      yaw: this.cameraRig.yaw,
      distance: this.cameraRig.distance,
    };
    this.intro = new IntroSequence(this.cameraRig);
    this.titleScreen = new TitleScreen(TITLE, document.body);
    this._clock.start();
    this._frameId = requestAnimationFrame(this._tick);
  }

  stop() {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
    this.gamepad.stop();
  }

  dispose() {
    this.stop();
    this.debugOverlay.dispose();
    this.fadeOverlay.dispose();
    this.keyboardHint.dispose();
    this._disposeRenderer();
  }

  _tick() {
    this._frameId = requestAnimationFrame(this._tick);

    const deltaTime = Math.min(this._clock.getDelta(), MAX_DELTA);
    if (deltaTime > 0) {
      this._fps = this._fps * 0.9 + (1 / deltaTime) * 0.1;
    }

    // 1. Input pollen (Gamepad API liefert keine Events fuer Achsen/Buttons)
    const input = this.gamepad.update();

    const introRunning = this.state === "intro";
    const buttons = input.buttons;
    // Beide gehalten, einer davon gerade neu - sonst feuert es jeden Frame.
    const resetCombo =
      buttons.DPAD_LEFT.pressed &&
      buttons.DPAD_RIGHT.pressed &&
      (buttons.DPAD_LEFT.justPressed || buttons.DPAD_RIGHT.justPressed);

    if (this.state === "confirm") {
      if (buttons[ACTION_BUTTON].justPressed) this._backToIntro();
      else if (buttons[JUMP_BUTTON].justPressed) this._cancelReset();
    } else if (resetCombo && !introRunning && !this._isTransitioning) {
      this._askReset();
    } else if (introRunning) {
      // Jede der beiden Aktionstasten ueberspringt die Kamerafahrt
      if (input.buttons[ACTION_BUTTON].justPressed || input.buttons[JUMP_BUTTON].justPressed) {
        this.intro.finish();
      }
    } else if (this.state === "playing") {
      if (input.buttons[INFO_BUTTON].justPressed) {
        if (this.mode === "explore") this._showResults();
        else this._openInfo();
      }
    } else if (this.state !== "falling") {
      // D-Pad hoch/runter wechselt zwischen den Reitern des Infobildschirms
      if (buttons.DPAD_UP.justPressed) this.message.openTab("info");
      else if (buttons.DPAD_DOWN.justPressed) this.message.openTab("controls");

      // Briefing, Sieg und Absturz warten alle auf die Aktionstaste
      if (input.buttons[ACTION_BUTTON].justPressed) this._confirmMessage();
      else if (
        input.buttons[EXPLORE_BUTTON].justPressed &&
        (this.state === "won" || this._atStart)
      ) {
        this._startExplore();
      }
    }

    // Waehrend Intro, Ueberblendung, Infobildschirm und Endbildschirm ist die
    // Steuerung gesperrt.
    const locked =
      this._isTransitioning ||
      introRunning ||
      this.state === "briefing" ||
      this.state === "confirm" ||
      this.isGameOver;

    // Die Uhr laeuft nur im aktiven Spiel - Infobildschirm pausiert sie.
    if (this.mode === "mission" && (this.state === "playing" || this.state === "falling")) {
      this.runTime += deltaTime;
    }

    // 2. Kamera-Rotation aus dem rechten Stick bzw. der Maus
    if (!locked) {
      this.cameraRig.rotate(input.rightStick.x, input.rightStick.y, deltaTime);
      this.cameraRig.rotateBy(input.look.x, input.look.y);
    }

    // 3. Bewegung aus dem linken Stick - relativ zur Kamera-Ausrichtung.
    // Wer stuerzt, hat die Kontrolle verloren - der Fall ist nicht zu retten.
    const steerable = !locked && this.state !== "falling";
    this._applyMovementInput(steerable ? input.leftStick : { x: 0, y: 0 });

    if (steerable && input.buttons[JUMP_BUTTON].justPressed) this._jump();

    // 4. Entities updaten, danach auf die aktuelle Ebene zwingen
    this.character.update(deltaTime);
    this._resolveCollisions();
    this._updateGrounding(deltaTime);

    // 5. Interaktionen auswerten
    this._updatePortal(input, locked);
    this._updateSensors(input, locked);
    this._updateInfo(locked);
    this.portalMarker?.update(this._clock.elapsedTime);

    if (introRunning) {
      this.intro.update(deltaTime);
      if (this.intro.done) this._endIntro();
    } else {
      this.cameraRig.update(deltaTime);
    }
    this._focusShadow(this.character.position);

    // 6. Anzeigen + Rendern
    this.prompt.set(this._promptText());
    this.keyboardHint.update(
      input.lastDevice === "keyboard",
      this.gamepad.keyboard.state.pointerLocked
    );
    if (this.mode === "explore") {
      const points = [...this.sensors, ...this.components];
      const found = points.filter((point) => point.marked).length;
      this.missionHud.showExplore(found, points.length);
    } else {
      this.missionHud.update(this.sensors, formatTime(this.runTime));
    }
    this.debugOverlay.update(input, {
      fps: this._fps.toFixed(0),
      seite: this.currentSide,
      pos: formatPosition(this.character.position),
      eingabe: input.lastDevice === "keyboard" ? "Tastatur/Maus" : "Controller",
    });
    this.renderer.render(this.scene, this.camera);
  }

  get isGameOver() {
    return this.state === "failed" || this.state === "won";
  }

  /** Text der Kontextanzeige am unteren Bildrand. */
  _promptText() {
    if (this.state === "intro") return `Press ${this._label(JUMP_BUTTON)} to skip the intro`;
    if (this.state === "briefing" || this.state === "falling" || this.isGameOver) return null;
    if (this._isTransitioning) return null;
    if (this._nearSensor) {
      return `Sensor ${this._nearSensor.id} - press ${this._label(this._nearSensor.button)} to mark it`;
    }
    if (this._inPortalZone) {
      return `Press ${this._label(ACTION_BUTTON)} to use the control pad`;
    }
    return null;
  }

  /** Tastenname fuer Prompts - an der Tastatur mit der passenden Taste dazu. */
  _label(button) {
    const pad = BUTTON_LABELS[button];
    const key = KEY_LABELS[button];
    if (this.gamepad.state.lastDevice !== "keyboard" || !key || key === pad) return pad;
    return `${key} (${pad})`;
  }

  /** Kamerafahrt vorbei: Titel ausblenden, Briefing zeigen. */
  _endIntro() {
    this.state = "briefing";
    this.titleScreen?.hide();
    this.titleScreen = null;
    this.runTime = 0;
    this._atStart = true;
    this.message.show({ ...BRIEFING, footer: BRIEFING_START_FOOTER, scores: loadScores() });
  }

  /** Infobildschirm im laufenden Spiel erneut oeffnen - die Uhr pausiert dabei. */
  _openInfo() {
    this.state = "briefing";
    this.message.show({ ...BRIEFING, scores: loadScores() });
  }

  /** Aktionstaste auf Briefing / Endbildschirm. */
  _confirmMessage() {
    this.message.hide();
    this._atStart = false;
    if (this.state === "briefing") {
      this.state = "playing";
      return;
    }
    this._restart();
  }

  /**
   * Rechnet den Stick-Ausschlag in eine kamerarelative Weltrichtung um:
   * Stick nach oben = weg von der Kamera, Stick nach rechts = rechts im Bild.
   */
  _applyMovementInput(leftStick) {
    const yaw = this.cameraRig.yaw;

    // Blickrichtung der Kamera auf die XZ-Ebene projiziert
    this._forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    this._moveDirection
      .copy(this._forward)
      .multiplyScalar(-leftStick.y) // Stick-Y ist invertiert: oben = -1
      .addScaledVector(this._right, leftStick.x);

    const intensity = Math.min(Math.hypot(leftStick.x, leftStick.y), 1);
    this.character.setMoveDirection(this._moveDirection.x, this._moveDirection.z, intensity);
  }

  /** Haelt den Charakter aus hohen Bauteilen heraus. */
  _resolveCollisions() {
    if (!this.board || this.state === "falling") return;

    const position = this.character.position;
    resolveBoxVsBoxes(
      position,
      this.character.halfExtents,
      this.character.object3D.rotation.y,
      this.board.obstacles[this.currentSide],
      position.y
    );
  }

  /**
   * Haelt den Charakter auf der Oberflaeche. Gibt es unter ihm keine Platine
   * mehr (Hoehenraster liefert NaN), faellt er - und die Runde ist vorbei.
   */
  _updateGrounding(deltaTime) {
    const position = this.character.position;
    // Ein begonnener Sturz kennt keinen Boden mehr.
    const groundY = this.state === "falling" ? NaN : this._groundHeight();
    const overVoid = Number.isNaN(groundY);

    if (this._isGrounded && !overVoid) {
      position.y += (groundY - position.y) * (1 - Math.exp(-GROUND_DAMPING * deltaTime));
      return;
    }

    if (this._isGrounded) {
      this._isGrounded = false;
      this._verticalVelocity = 0;
    }

    this._verticalVelocity += GRAVITY * deltaTime;
    position.y += this._verticalVelocity * deltaTime;

    if (!overVoid && position.y <= groundY) {
      position.y = groundY;
      this._verticalVelocity = 0;
      this._isGrounded = true;
      return;
    }

    // Sackt die Figur merklich unter ihre Laufebene, war es kein Sprung ueber
    // ein Loch mehr, sondern einer hindurch.
    if (
      this.state === "playing" &&
      position.y < this.levels[this.currentSide].y - FALL_COMMIT_DEPTH
    ) {
      this.state = "falling";
    }

    if (position.y < FALL_DEATH_Y && this.state === "falling") {
      if (this.mode === "explore") this._respawn();
      else this._fail();
    }
  }

  _jump() {
    if (!this._isGrounded) return;
    this._verticalVelocity = JUMP_SPEED;
    this._isGrounded = false;
  }

  _groundHeight() {
    if (!this.board) return this.levels[this.currentSide].y;

    const { height, support } = this._sampleGround(this.character.position.y + STEP_UP_LIMIT);
    if (support < MIN_SUPPORT_RATIO) return NaN;
    // Zu hohe Flaechen tragen nur, wer schon steht. In der Luft waere das eine
    // unsichtbare Plattform mitten im Bohrloch.
    if (Number.isNaN(height)) return this._isGrounded ? this.character.position.y : NaN;
    return height;
  }

  /**
   * Setzt die Figur beim Spawn oder Teleport auf die Oberflaeche unter ihr.
   * Hier gilt die Stufengrenze *nicht* - sonst wuerde sie z.B. auf dem Display
   * nicht oben landen, sondern darin stecken und herausgeschoben werden.
   */
  _snapToGround() {
    if (!this.board) return;

    const { height } = this._sampleGround(Infinity);
    if (!Number.isNaN(height)) this.character.position.y = height;
  }

  /**
   * Tastet den Boden ueber den gesamten - mitgedrehten - Grundriss ab.
   * Massgeblich ist der *hoechste* Treffer unterhalb von `stepLimit`: der Chip
   * ist ein starrer Koerper und sinkt nicht in Bauteile ein, klettert aber
   * auch nicht von selbst auf hohe hinauf.
   */
  _sampleGround(stepLimit) {
    const position = this.character.position;
    const angle = this.character.object3D.rotation.y;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { x: halfX, y: halfZ } = this.character.halfExtents;

    let height = NaN;
    let supported = 0;
    let total = 0;

    for (let i = 0; i < GROUND_SAMPLES; i++) {
      const localX = ((i / (GROUND_SAMPLES - 1)) * 2 - 1) * halfX;

      for (let j = 0; j < GROUND_SAMPLES; j++) {
        const localZ = ((j / (GROUND_SAMPLES - 1)) * 2 - 1) * halfZ;
        const sampleX = position.x + localX * cos + localZ * sin;
        const sampleZ = position.z - localX * sin + localZ * cos;

        total++;
        if (!this.board.hasGround(this.currentSide, sampleX, sampleZ)) continue;

        // Traegt die Figur, auch wenn zu hoch zum Hochsteigen - sonst wuerde
        // sie direkt neben einem Bauteil ins Leere kippen.
        supported++;

        // Die Stufengrenze waehlt die Schicht: unter dem Display die Platine,
        // oben darauf die Display-Oberseite.
        const sample = this.board.sampleHeight(this.currentSide, sampleX, sampleZ, stepLimit);
        if (Number.isNaN(sample)) continue;
        if (Number.isNaN(height) || sample > height) height = sample;
      }
    }

    return { height, support: supported / total };
  }

  /** Prueft die Triggerzone der Kontrollflaeche und startet ggf. den Wechsel. */
  _updatePortal(input, locked) {
    if (locked || this.state !== "playing") {
      this._inPortalZone = false;
      return;
    }

    const portal = this.portals[this.currentSide];
    const dx = this.character.position.x - portal.position.x;
    const dz = this.character.position.z - portal.position.z;
    this._inPortalZone = Math.hypot(dx, dz) <= portal.radius;

    if (this._inPortalZone && input.buttons[ACTION_BUTTON].justPressed) {
      this._switchSide();
    }
  }

  /**
   * Sensoren aktualisieren: naechstgelegenen in Reichweite merken, und jeden
   * Sensor aufleuchten lassen, dessen Taste gerade gehalten wird.
   */
  _updateSensors(input, locked) {
    this._nearSensor = null;
    // Im Erkundungsmodus wird nicht markiert - die Rahmen pflegt _updateInfo().
    if (this.mode === "explore") return;
    const active = this.state === "playing" && !locked;

    for (const sensor of this.sensors) {
      const reachable = active && sensor.side === this.currentSide && !sensor.marked;

      const distance = Math.hypot(
        this.character.position.x - sensor.position.x,
        this.character.position.z - sensor.position.z
      );
      const inRange = reachable && distance <= sensor.radius;

      sensor.marker.inRange = inRange;
      sensor.marker.proximity = distance / sensor.radius;
      // Ein markierter Sensor reagiert nicht mehr auf seine Taste.
      sensor.marker.highlighted =
        active && !sensor.marked && input.buttons[sensor.button].pressed;
      sensor.marker.update(this._clock.elapsedTime);

      if (inRange && (this._nearSensor === null || distance < this._nearSensorDistance)) {
        this._nearSensor = sensor;
        this._nearSensorDistance = distance;
      }
    }

    // Markiert wird mit der Taste, die der Sensor im echten Controller abtastet.
    if (this._nearSensor && input.buttons[this._nearSensor.button].justPressed) {
      this._markSensor(this._nearSensor);
    }
  }

  /**
   * Info-Box zum naechstgelegenen Bauteil. Im Auftrag nur die Sensoren, im
   * Erkundungsmodus alle Bauteile - die dabei als entdeckt gelten.
   */
  _updateInfo(locked) {
    const active = this.state === "playing" && !locked;
    const exploring = this.mode === "explore";
    const points = exploring ? [...this.sensors, ...this.components] : this.sensors;

    let nearest = null;
    let nearestDistance = Infinity;

    for (const point of points) {
      if (point.side !== this.currentSide) continue;

      const distance = Math.hypot(
        this.character.position.x - point.position.x,
        this.character.position.z - point.position.z
      );
      const inRange = active && distance <= point.radius;
      if (inRange && distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    if (exploring) {
      if (nearest && !nearest.marked) {
        nearest.marked = true;
        nearest.marker.marked = true;
      }
      for (const point of points) {
        point.marker.inRange = point === nearest;
        point.marker.update(this._clock.elapsedTime);
      }
    }

    this.infoBox.setProminent(exploring);
    this.infoBox.show(nearest, nearest && COMPONENT_INFO[nearest.info]);
  }

  _markSensor(sensor) {
    sensor.marked = true;
    sensor.marker.marked = true;
    this._nearSensor = null;
    this.missionHud.update(this.sensors);
    console.log(`[Mission] Sensor ${sensor.id} markiert`);

    if (this.sensors.every((entry) => entry.marked)) this._win();
  }

  _win() {
    this.state = "won";
    const { scores, rank } = addScore(this.runTime);
    this._results = {
      ...VICTORY,
      body: [...VICTORY.body, `Your time: ${formatTime(this.runTime)}`],
      scores,
      highlight: rank,
    };
    this.message.show(this._results);
  }

  /** Frei herumlaufen und alle Infineon-Bauteile entdecken - nach dem Sieg oder direkt. */
  _startExplore() {
    this._atStart = false;
    if (this.mode === "explore") {
      this.message.hide();
      this.state = "playing";
      return;
    }

    this.mode = "explore";
    for (const point of [...this.sensors, ...this.components]) {
      // Immer voll sichtbar - hier wird entdeckt, nicht gesucht.
      point.marker.proximity = 1;
      point.marker.highlighted = false;
    }
    this._updateMarkerVisibility();
    this.state = "briefing";
    this.message.show(EXPLORE);
  }

  /**
   * Menue im Erkundungsmodus: nach einem Sieg das Ergebnis, sonst eine kurze
   * Auswahl. Beide nutzen die Endbildschirm-Logik: T = neue Jagd, I = weiter.
   */
  _showResults() {
    this.state = "won";
    this.message.show(this._results ?? EXPLORE_MENU);
  }

  /** D-Pad links + rechts: Rueckfrage, ob es zurueck zum Intro gehen soll. */
  _askReset() {
    this._beforeReset = {
      state: this.state,
      message: this.message.visible ? this.message.content : null,
    };
    this.state = "confirm";
    this.message.show(RESET_CONFIRM);
  }

  _cancelReset() {
    const { state, message } = this._beforeReset;
    this.state = state;
    if (message) this.message.show(message);
    else this.message.hide();
  }

  /** Alles zuruecksetzen und die Kamerafahrt samt Titel erneut abspielen. */
  _backToIntro() {
    this.message.hide();
    this._restart();
    Object.assign(this.cameraRig, this._cameraHome);
    this.cameraRig.snapToTarget();

    this.state = "intro";
    this._atStart = false;
    this.intro = new IntroSequence(this.cameraRig);
    this.titleScreen = new TitleScreen(TITLE, document.body);
  }

  /** Absturz im Erkundungsmodus: zurueck auf die Kontrollflaeche dieser Seite. */
  _respawn() {
    const portal = this.portals[this.currentSide];
    this.character.position.set(portal.position.x, this.levels[this.currentSide].y, portal.position.z);
    this.character.setMoveDirection(0, 0, 0);
    this._setSide(this.currentSide);
    this.cameraRig.snapToTarget();
    this.state = "playing";
  }

  _fail() {
    this.state = "failed";
    this.message.show(FAILURE);
  }

  /** Zuruecksetzen nach Absturz oder Sieg. */
  _restart() {
    for (const point of [...this.sensors, ...this.components]) {
      point.marked = false;
      point.marker.reset();
    }
    this.mode = "mission";
    this._results = null;
    this.missionHud.update(this.sensors);

    this.character.position.copy(buildSpawn("top"));
    this.character.setMoveDirection(0, 0, 0);
    this._verticalVelocity = 0;
    this._isGrounded = true;
    this.runTime = 0;
    this._setSide("top");
    this.cameraRig.snapToTarget();
    this.state = "playing";
  }

  /**
   * Markiert die Kontrollflaeche auf der Unterseite. Auf der Oberseite ist sie
   * bereits im Siebdruck als "CONTROL"-Kreis vorhanden.
   */
  _createPortalMarker() {
    const portal = this.portals.bottom;
    this.portalMarker = new PortalMarker({ radius: portal.radius });
    this.portalMarker.object3D.position.set(
      portal.position.x,
      this.board.sampleHeight("bottom", portal.position.x, portal.position.z) + 0.02,
      portal.position.z
    );
    this.scene.add(this.portalMarker.object3D);
  }

  /** Ein Rahmen pro Sensor, direkt auf dem Siebdruck-Kaestchen. */
  _createSensorMarkers() {
    for (const sensor of this.sensors) {
      const marker = new SensorMarker({ size: SENSOR_MARKER_MM * WORLD_PER_MM });
      const ground = this.board.sampleHeight(sensor.side, sensor.position.x, sensor.position.z);
      marker.object3D.position.set(
        sensor.position.x,
        (Number.isNaN(ground) ? sensor.position.y : ground) + 0.03,
        sensor.position.z
      );
      marker.object3D.visible = sensor.side === this.currentSide;
      this.scene.add(marker.object3D);
      sensor.marker = marker;
    }
  }

  /** Rahmen fuer die Bauteile des Erkundungsmodus - bis dahin ausgeblendet. */
  _createComponentMarkers() {
    for (const part of this.components) {
      const marker = new SensorMarker({ size: part.sizeMm * WORLD_PER_MM });
      // Auf Platinenhoehe: der Rahmen umschliesst das Bauteil, statt darauf zu liegen.
      marker.object3D.position.set(part.position.x, this.levels[part.side].y + 0.03, part.position.z);
      marker.object3D.visible = false;
      this.scene.add(marker.object3D);
      part.marker = marker;
    }
  }

  _updateMarkerVisibility() {
    for (const sensor of this.sensors) {
      if (sensor.marker) sensor.marker.object3D.visible = sensor.side === this.currentSide;
    }
    for (const part of this.components) {
      if (part.marker) {
        part.marker.object3D.visible = this.mode === "explore" && part.side === this.currentSide;
      }
    }
  }

  /** Fade-to-Black, Teleport auf die andere Seite, Fade zurueck. */
  async _switchSide() {
    const target = OPPOSITE_SIDE[this.currentSide];
    this._isTransitioning = true;

    await this.fadeOverlay.fadeOut();

    const portal = this.portals[target];
    this.character.position.set(portal.position.x, this.levels[target].y, portal.position.z);
    this._setSide(target);
    this.cameraRig.snapToTarget();

    await this.fadeOverlay.fadeIn();
    this._isTransitioning = false;
  }

  _setSide(side) {
    this.currentSide = side;
    this.board?.setVisibleSide(side);

    this._snapToGround();
    this._verticalVelocity = 0;
    this._isGrounded = true;

    if (this.portalMarker) this.portalMarker.visible = side === "bottom";
    this._updateMarkerVisibility();
  }
}

const formatPosition = (v) => `${v.x.toFixed(1)} / ${v.z.toFixed(1)}`;
