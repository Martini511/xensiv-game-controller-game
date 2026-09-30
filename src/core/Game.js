import * as THREE from "three";
import { createRenderer } from "./createRenderer.js";
import { createScene } from "./createScene.js";
import { ThirdPersonCamera } from "./ThirdPersonCamera.js";
import { Board } from "./Board.js";
import { IntroSequence } from "./IntroSequence.js";
import {
  PLATINE_URL,
  PLAYER_URL,
  analyzeHierarchy,
  loadGLTF,
  normalizeMaterials,
} from "./model-loader.js";
import {
  ACTION_BUTTON,
  FALL_DEATH_Y,
  INFO_BUTTON,
  JUMP_BUTTON,
  OPPOSITE_SIDE,
  PORTAL,
  SENSOR_MARKER_MM,
  WORLD_PER_MM,
  buildLevel,
  buildPortals,
  buildSensors,
  buildSpawn,
} from "./level-config.js";
import { clampDistanceToBoxes, resolveCircleVsBoxes } from "./collision.js";
import { Character } from "../entities/Character.js";
import { ChipModel } from "../entities/ChipModel.js";
import { PortalMarker } from "../entities/PortalMarker.js";
import { SensorMarker } from "../entities/SensorMarker.js";
import { BUTTON_LABELS, GamepadManager } from "../input/GamepadManager.js";
import { DebugOverlay } from "../input/DebugOverlay.js";
import { FadeOverlay, LoadingOverlay } from "../ui/overlays.js";
import { MessageOverlay, MissionHud, Prompt, TitleScreen } from "../ui/hud.js";
import { BRIEFING, FAILURE, TITLE, VICTORY } from "./mission-texts.js";

const MAX_DELTA = 0.1; // Sekunden - verhindert Riesenspruenge nach Tab-Wechsel

/** Wie schnell der Charakter auf eine neue Bodenhoehe nachzieht (1/Sekunde). */
const GROUND_DAMPING = 16;

/** Fallbeschleunigung und Absprunggeschwindigkeit in Weltunits/s(^2). */
const GRAVITY = -30;
const JUMP_SPEED = 9;

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

    this.gamepad = new GamepadManager({ deadzone: 0.18 });
    this.debugOverlay = new DebugOverlay(document.body);
    this.loadingOverlay = new LoadingOverlay(document.body);
    this.fadeOverlay = new FadeOverlay(document.body, PORTAL.fadeDurationMs);
    this.missionHud = new MissionHud(document.body);
    this.prompt = new Prompt(document.body);
    this.message = new MessageOverlay(document.body);
    this.titleScreen = null;

    /** "intro" | "briefing" | "playing" | "falling" | "failed" | "won" */
    this.state = "intro";
    this.sensors = buildSensors().map((sensor) => ({ ...sensor, marked: false, marker: null }));

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
        loadGLTF(PLATINE_URL, (progress) => this.loadingOverlay.setProgress(progress)),
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

      this.board = new Board(gltf.scene);
      this.scene.add(this.board.object3D);
      this._fitToBounds(this.board.boundingBox);

      this._createPortalMarker();
      this._createSensorMarkers();
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

    if (introRunning) {
      // Jede der beiden Aktionstasten ueberspringt die Kamerafahrt
      if (input.buttons[ACTION_BUTTON].justPressed || input.buttons[JUMP_BUTTON].justPressed) {
        this.intro.finish();
      }
    } else if (this.state === "playing") {
      if (input.buttons[INFO_BUTTON].justPressed) this._openInfo();
    } else if (this.state !== "falling") {
      // Briefing, Sieg und Absturz warten alle auf die Aktionstaste
      if (input.buttons[ACTION_BUTTON].justPressed) this._confirmMessage();
    }

    // Waehrend Intro, Ueberblendung, Infobildschirm und Endbildschirm ist die
    // Steuerung gesperrt.
    const locked =
      this._isTransitioning || introRunning || this.state === "briefing" || this.isGameOver;

    // 2. Kamera-Rotation aus dem rechten Stick
    if (!locked) {
      this.cameraRig.rotate(input.rightStick.x, input.rightStick.y, deltaTime);
    }

    // 3. Bewegung aus dem linken Stick - relativ zur Kamera-Ausrichtung.
    // Auch im Fall steuerbar: wer schnell genug zurueck ueber die Platine
    // kommt, landet wieder darauf.
    this._applyMovementInput(locked ? { x: 0, y: 0 } : input.leftStick);

    if (!locked && input.buttons[JUMP_BUTTON].justPressed) this._jump();

    // 4. Entities updaten, danach auf die aktuelle Ebene zwingen
    this.character.update(deltaTime);
    this._resolveCollisions();
    this._updateGrounding(deltaTime);

    // 5. Interaktionen auswerten
    this._updatePortal(input, locked);
    this._updateSensors(input, locked);
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
    this.debugOverlay.update(input, {
      fps: this._fps.toFixed(0),
      seite: this.currentSide,
      pos: formatPosition(this.character.position),
    });
    this.renderer.render(this.scene, this.camera);
  }

  get isGameOver() {
    return this.state === "failed" || this.state === "won";
  }

  /** Text der Kontextanzeige am unteren Bildrand. */
  _promptText() {
    if (this.state === "intro") return `Press ${BUTTON_LABELS[JUMP_BUTTON]} to skip the intro`;
    if (this.state === "briefing" || this.state === "falling" || this.isGameOver) return null;
    if (this._isTransitioning) return null;
    if (this._nearSensor) {
      return `Sensor ${this._nearSensor.id} - press ${BUTTON_LABELS[this._nearSensor.button]} to mark it`;
    }
    if (this._inPortalZone) {
      return `Press ${BUTTON_LABELS[ACTION_BUTTON]} to use the control pad`;
    }
    return null;
  }

  /** Kamerafahrt vorbei: Titel ausblenden, Briefing zeigen. */
  _endIntro() {
    this.state = "briefing";
    this.titleScreen?.hide();
    this.titleScreen = null;
    this.message.show(BRIEFING);
  }

  /** Infobildschirm im laufenden Spiel erneut oeffnen. */
  _openInfo() {
    this.state = "briefing";
    this.message.show(BRIEFING);
  }

  /** Aktionstaste auf Briefing / Endbildschirm. */
  _confirmMessage() {
    this.message.hide();
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
    resolveCircleVsBoxes(
      position,
      this.character.radius,
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
    const groundY = this._groundHeight();
    const overVoid = Number.isNaN(groundY);

    if (this._isGrounded && !overVoid) {
      position.y += (groundY - position.y) * (1 - Math.exp(-GROUND_DAMPING * deltaTime));
      return;
    }

    if (this._isGrounded && overVoid) {
      this._isGrounded = false;
      this._verticalVelocity = 0;
      if (this.state === "playing") this.state = "falling";
    }

    this._verticalVelocity += GRAVITY * deltaTime;
    position.y += this._verticalVelocity * deltaTime;

    if (!overVoid && position.y <= groundY) {
      position.y = groundY;
      this._verticalVelocity = 0;
      this._isGrounded = true;
      if (this.state === "falling") this.state = "playing";
      return;
    }

    if (position.y < FALL_DEATH_Y && this.state === "falling") this._fail();
  }

  _jump() {
    if (!this._isGrounded) return;
    this._verticalVelocity = JUMP_SPEED;
    this._isGrounded = false;
  }

  _groundHeight() {
    const position = this.character.position;
    return this.board
      ? this.board.sampleHeight(this.currentSide, position.x, position.z)
      : this.levels[this.currentSide].y;
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
    this.message.show(VICTORY);
  }

  _fail() {
    this.state = "failed";
    this.message.show(FAILURE);
  }

  /** Zuruecksetzen nach Absturz oder Sieg. */
  _restart() {
    for (const sensor of this.sensors) {
      sensor.marked = false;
      sensor.marker.reset();
    }
    this.missionHud.update(this.sensors);

    this.character.position.copy(buildSpawn("top"));
    this.character.setMoveDirection(0, 0, 0);
    this._verticalVelocity = 0;
    this._isGrounded = true;
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

    const ground = this._groundHeight();
    if (!Number.isNaN(ground)) this.character.position.y = ground;
    this._verticalVelocity = 0;
    this._isGrounded = true;

    if (this.portalMarker) this.portalMarker.visible = side === "bottom";
    for (const sensor of this.sensors) {
      if (sensor.marker) sensor.marker.object3D.visible = sensor.side === side;
    }
  }
}

const formatPosition = (v) => `${v.x.toFixed(1)} / ${v.z.toFixed(1)}`;
