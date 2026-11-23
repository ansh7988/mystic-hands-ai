import * as THREE from 'three';
import { createMagicEffects } from './magicEffects.js';
import { createObjectFactory } from './objectFactory.js';
import { createThanosSnap } from './thanosSnap.js';

// ================================================
// MYSTIC HANDS AI - TELEKINESIS
//
// Interaction is driven by the gesture state machine (gestureEngine.js):
//   PINCH  (GRAB_START / GRAB_END)  -> grab, carry, throw
//   FIST   (CHARGING)               -> objects are pulled into orbit
//   OPEN   (RELEASE event)          -> radial explosion impulse
//   TWO FINGERS drawing a circle    -> glowing trail + sparks, then a portal
//   OPEN PALM + other hand's circle -> mandala shield with a fan of rays
//   SNAP (thumb + middle finger)    -> you and every object turn to dust
//
// Object visuals (rocks, crystals, cores) come from objectFactory.js.
// ================================================

const TUNING = {

  // Grab
  grabRadius: 260,          // world units around the pinch point (+ object radius)
  assistRadius: 520,        // pinching hand softly pulls objects from this far
  assistStrength: 1100,
  followStiffness: 30,      // higher = object sticks harder to the fingers
  offsetDecay: 11,          // how fast the object snaps into the pinch point
  throwGain: 1.25,
  throwMax: 1500,

  // Charge (fist)
  chargeRange: 560,
  chargePull: 1.0,

  // Release (open palm)
  releaseBase: 380,
  releaseEnergy: 1500,

  maxSpeed: 1600,

  // Sling-ring portal
  portalPull: 520,          // how strongly an open portal draws objects in
  portalSwirl: 260,
  portalEjectSpeed: 650,    // objects reaching the centre are flung back out
  portalMinRadius: 110,
  portalMaxRadius: 300,

  // Two-handed mandala shield
  mandalaAnchor: 'palm',    // 'palm' = follows the open palm, 'circle' = stays where drawn
  mandalaMinRadius: 150,
  mandalaMaxRadius: 290,
  mandalaLostMs: 500,       // palm may flicker this long before the mandala closes

  // Subtle fire around energy cores (0 = off)
  coreFlamePower: 0.28
};

export function createTelekinesisEngine(container, width, height, video = null) {

  container.style.position = 'relative';
  container.style.overflow = 'hidden';

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    42,
    width / height,
    1,
    3000
  );

  camera.position.set(0, 0, 900);

  // ==============================================
  // RENDERER
  // ==============================================

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, 1.75)
  );

  renderer.setSize(width, height, false);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  Object.assign(renderer.domElement.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    transform: 'scaleX(-1)',
    pointerEvents: 'none',
    zIndex: '2'
  });

  container.appendChild(renderer.domElement);

  // ==============================================
  // LIGHTING
  // ==============================================

  scene.add(new THREE.HemisphereLight(
    0xffd8a0,
    0x16101d,
    1.1
  ));

  const ambient = new THREE.AmbientLight(
    0xffffff,
    0.35
  );

  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(
    0xffc078,
    3.5
  );

  keyLight.position.set(-250, 350, 450);
  keyLight.castShadow = true;

  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -750;
  keyLight.shadow.camera.right = 750;
  keyLight.shadow.camera.top = 500;
  keyLight.shadow.camera.bottom = -500;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 1500;
  keyLight.shadow.bias = -0.0004;

  scene.add(keyLight);

  const orangeLight = new THREE.PointLight(
    0xff6b18,
    450,
    750
  );

  orangeLight.position.set(0, 0, 180);
  scene.add(orangeLight);

  const blueLight = new THREE.PointLight(
    0x477bff,
    220,
    650
  );

  blueLight.position.set(300, 200, 100);
  scene.add(blueLight);

  // Light that follows the flames / charge and lights nearby objects
  const handLight = new THREE.PointLight(
    0xff8a2a,
    0,
    650
  );

  handLight.position.set(0, 0, 140);
  scene.add(handLight);

  // ==============================================
  // SCREEN TO WORLD COORDINATES
  // ==============================================

  const cameraDistance = camera.position.z;

  const visibleHeight =
    2 * cameraDistance *
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  const visibleWidth =
    visibleHeight * camera.aspect;

  function screenToWorld(x, y) {

    return new THREE.Vector3(
      (x / width - 0.5) * visibleWidth,
      (0.5 - y / height) * visibleHeight,
      0
    );
  }

  // ==============================================
  // MAGIC EFFECTS (flames, sparks, shockwave rings)
  // ==============================================

  const effects = createMagicEffects(scene);

  {
    const buffer = new THREE.Vector2();
    renderer.getDrawingBufferSize(buffer);
    effects.setViewport(buffer.y, camera.fov);
  }

  // Thanos snap: person + objects crumble to dust (needs the camera video)
  const thanos = video
    ? createThanosSnap({ scene, video, width, height, visibleWidth, visibleHeight })
    : null;

  if (thanos) {
    const buffer = new THREE.Vector2();
    renderer.getDrawingBufferSize(buffer);
    thanos.setViewport(buffer.y, camera.fov);
  }

  // ==============================================
  // GLOW TEXTURE
  // ==============================================

  function makeGlowTexture() {

    const canvas = document.createElement('canvas');

    canvas.width = 128;
    canvas.height = 128;

    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(
      64, 64, 2,
      64, 64, 64
    );

    gradient.addColorStop(0, 'rgba(255,255,220,1)');
    gradient.addColorStop(0.2, 'rgba(255,190,70,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,100,20,0.3)');
    gradient.addColorStop(1, 'rgba(255,60,0,0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);

    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
  }

  const glowTexture = makeGlowTexture();

  // ==============================================
  // INVISIBLE SHADOW FLOOR
  // ==============================================

  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(
      visibleWidth * 2,
      visibleHeight * 2
    ),
    new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: 0.28
    })
  );

  shadowFloor.position.z = -65;
  shadowFloor.receiveShadow = true;

  scene.add(shadowFloor);

  // ==============================================
  // OBJECT FACTORY (Milestone 3 visuals)
  // ==============================================

  const factory = createObjectFactory(renderer, glowTexture);

  const objects = [];

  function createEnergyObject(type, x, y, radius) {

    const visual = type === 'rock'
      ? factory.createRock(radius)
      : type === 'crystal'
        ? factory.createCrystal(radius)
        : factory.createCore(radius);

    const group = visual.group;

    group.position.copy(screenToWorld(x, y));

    // Depth variation is kept (it used to be overwritten every frame)
    const baseZ = Math.random() * 90 - 30;

    group.position.z = baseZ;

    scene.add(group);

    // Cores spin slowly so their energy pattern stays readable
    const spin = type === 'core' ? 0.35 : type === 'crystal' ? 0.7 : 1;

    const object = {
      group,
      visual,
      type,
      radius,

      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 35,
        0
      ),

      rotationSpeed: new THREE.Vector3(
        Math.random() * 0.8 * spin,
        Math.random() * 1.2 * spin,
        Math.random() * 0.8 * spin
      ),

      spinBoost: 1,
      baseZ,
      orbitRadius: 95 + objects.length % 3 * 48,

      heat: 0,
      portalUntil: 0,
      dead: false,
      appear: 1,
      shieldUntil: 0,

      phase: Math.random() * Math.PI * 2,

      grabbed: false,
      heldBy: null,
      offset: new THREE.Vector3()
    };

    objects.push(object);

    return object;
  }

  // ==============================================
  // CREATE ALL THREE OBJECT TYPES
  // ==============================================

  const types = [
    'rock', 'rock', 'rock',
    'crystal', 'crystal', 'crystal',
    'core', 'core', 'core'
  ];

  types.forEach((type, i) => {

    const x = width * (
      0.13 + (i % 3) * 0.36
    );

    const y = height * (
      0.2 + Math.floor(i / 3) * 0.3
    );

    const radius = type === 'rock'
      ? 28 + Math.random() * 12
      : type === 'crystal'
        ? 23 + Math.random() * 12
        : 18 + Math.random() * 9;

    createEnergyObject(
      type,
      x,
      y,
      radius
    );
  });

  // ==============================================
  // HAND STATE (fed by the gesture tracker)
  // ==============================================

  const handStates = new Map();   // handId -> state
  const holds = new Map();        // handId -> held object
  const strokeStates = new Map(); // handId -> fingertip drawing state
  const mandalaMeta = new Map();  // anchor handId -> { follow, lostAt }

  let shake = 0;
  let releaseFlash = 0;
  const releaseFlashPosition = new THREE.Vector3();

  function nowMs() {
    return performance.now();
  }

  function handIsLive(state, now) {
    return now - state.lastSeen < 200;
  }

  // Throw velocity from the PALM path (stable while the fingers open),
  // ignoring the last ~90 ms (the fingers were already opening).
  function estimateVelocity(history, now) {

    const out = new THREE.Vector3();

    let samples = history.filter(
      (s) => s.t >= now - 340 && s.t <= now - 90
    );

    if (samples.length < 2) {
      samples = history.slice(-3);
    }

    if (samples.length < 2) return out;

    const first = samples[0];
    const last = samples[samples.length - 1];

    const dt = (last.t - first.t) / 1000;

    if (dt < 0.02) return out;

    out.set(
      (last.x - first.x) / dt,
      (last.y - first.y) / dt,
      0
    );

    return out;
  }

  function tryGrab(handId) {

    const state = handStates.get(handId);

    if (!state || holds.has(handId)) return false;

    let best = null;
    let bestScore = Infinity;

    for (const object of objects) {

      if (object.heldBy !== null || object.dead) continue;

      const dx = object.group.position.x - state.pinch.x;
      const dy = object.group.position.y - state.pinch.y;

      const distance = Math.hypot(dx, dy);
      const reach = TUNING.grabRadius + object.radius;

      if (distance > reach) continue;

      const score = distance - object.radius;

      if (score < bestScore) {
        bestScore = score;
        best = object;
      }
    }

    if (!best) return false;

    best.heldBy = handId;
    best.grabbed = true;

    best.offset.set(
      best.group.position.x - state.pinch.x,
      best.group.position.y - state.pinch.y,
      0
    );

    best.velocity.set(0, 0, 0);

    holds.set(handId, best);

    // Small ignition feedback
    effects.sparks(best.group.position, 26, 0.9);

    return true;
  }

  function releaseHold(handId, time) {

    const object = holds.get(handId);

    if (!object) return;

    const state = handStates.get(handId);

    const velocity = state
      ? estimateVelocity(state.history, time)
      : new THREE.Vector3();

    velocity.multiplyScalar(TUNING.throwGain);

    if (velocity.length() > TUNING.throwMax) {
      velocity.setLength(TUNING.throwMax);
    }

    object.velocity.copy(velocity);
    object.heldBy = null;
    object.grabbed = false;

    holds.delete(handId);

    if (velocity.length() > 250) {
      effects.sparks(object.group.position, 24, 1.3);
    }
  }

  function explode(event) {

    const centre = screenToWorld(
      event.position.x * width,
      event.position.y * height
    );

    const energy = Math.min(Math.max(event.energy, 0), 1);

    for (const object of objects) {

      if (object.heldBy !== null || object.dead) continue;

      const position = object.group.position;

      const dir = new THREE.Vector3(
        position.x - centre.x,
        position.y - centre.y,
        0
      );

      const distance = dir.length();

      if (distance < 1) {
        dir.set(Math.random() - 0.5, Math.random() - 0.5, 0);
      }

      dir.normalize();

      const falloff = 1 / (1 + Math.pow(distance / 380, 2));

      const impulse =
        (TUNING.releaseBase + TUNING.releaseEnergy * energy) * falloff;

      object.velocity.addScaledVector(dir, impulse);
      object.velocity.z += (Math.random() - 0.5) * impulse * 0.15;

      object.spinBoost = 1 + energy * 5;
      object.heat = 1;
    }

    effects.burst(centre, energy);
    effects.ring(centre, 320 + 620 * energy, 0.55);

    if (energy > 0.45) {
      effects.ring(centre, 220 + 420 * energy, 0.8);
    }

    shake = Math.max(shake, 5 + 22 * energy);

    releaseFlash = 0.4 + 0.6 * energy;
    releaseFlashPosition.copy(centre);
  }

  function openSlingPortal(event) {

    const centre = screenToWorld(
      event.center.x * width,
      event.center.y * height
    );

    // The portal is larger than the drawn ring, like in the films
    const radius = THREE.MathUtils.clamp(
      event.radius * visibleHeight * 1.3,
      TUNING.portalMinRadius,
      TUNING.portalMaxRadius
    );

    effects.openPortal(centre, radius, event.direction);

    shake = Math.max(shake, 6);
    releaseFlash = Math.max(releaseFlash, 0.5);
    releaseFlashPosition.copy(centre);
  }

  function openMandalaFromEvent(event) {

    const anchorState = handStates.get(event.anchor.handId);

    const follow = TUNING.mandalaAnchor === 'palm';

    const centre = follow && anchorState
      ? anchorState.palm.clone()
      : screenToWorld(event.center.x * width, event.center.y * height);

    const radius = THREE.MathUtils.clamp(
      event.radius * visibleHeight * 1.5,
      TUNING.mandalaMinRadius,
      TUNING.mandalaMaxRadius
    );

    effects.openMandala(event.anchor.handId, centre, radius, event.direction);

    mandalaMeta.set(event.anchor.handId, { follow, lostAt: 0 });

    shake = Math.max(shake, 7);
    releaseFlash = Math.max(releaseFlash, 0.6);
    releaseFlashPosition.copy(centre);
  }

  // ==============================================
  // THANOS SNAP
  // ==============================================

  const DUST_COLOR = {
    rock: [0.26, 0.21, 0.18],
    crystal: [0.95, 0.55, 0.18],
    core: [1.0, 0.5, 0.15]
  };

  function vanishObject(object) {

    for (const [id, held] of holds) {
      if (held === object) holds.delete(id);
    }

    object.heldBy = null;
    object.grabbed = false;

    const position = object.group.position;

    if (thanos) {
      thanos.emitDust(
        position,
        110,
        object.radius * 1.2,
        DUST_COLOR[object.type] || DUST_COLOR.rock
      );
    }

    effects.sparks(position, 24, 1.2);

    object.velocity.set(0, 0, 0);
    object.group.visible = false;
    object.dead = true;
  }

  function reviveObject(object) {

    object.dead = false;
    object.appear = 0;

    object.group.visible = true;
    object.group.scale.setScalar(0.001);

    effects.sparks(object.group.position, 18, 0.9);
  }

  // Objects go (and come back) when the sweep reaches them
  function updateSnapObjects() {

    const state = thanos.getState();
    const progress = thanos.getProgress();

    for (const object of objects) {

      const p = object.group.position;
      const d = thanos.dissolveAtWorld(p.x, p.y);

      if ((state === 'DISSOLVING' || state === 'HOLD') && !object.dead && progress > d) {
        vanishObject(object);
      } else if (state === 'RESTORING' && object.dead && progress < d) {
        reviveObject(object);
      } else if (state === 'IDLE' && object.dead) {
        reviveObject(object);
      }
    }
  }

  function snapStrike(event) {

    const centre = screenToWorld(
      event.position.x * width,
      event.position.y * height
    );

    shake = Math.max(shake, 26);

    releaseFlash = 1;
    releaseFlashPosition.copy(centre);

    effects.ring(centre, 520, 0.8);
    effects.burst(centre, 0.7);

    // Everything shudders before the dust takes it
    for (const object of objects) {
      object.heat = 1;
      object.spinBoost = 6;
    }

    if (thanos) thanos.toggle(nowMs());
  }

  // ==============================================
  // PUBLIC UPDATE - CALLED BY handTracking.js
  // ==============================================

  function update(hands, time = nowMs(), frame = null) {

    if (thanos) thanos.processFrame(time);

    if (!frame) return;

    for (const h of frame.hands) {

      let state = handStates.get(h.id);

      if (!state) {
        state = {
          pinch: new THREE.Vector3(),
          palm: new THREE.Vector3(),
          tip: new THREE.Vector3(),
          pose: 'NONE',
          history: [],
          mode: 'IDLE',
          energy: 0,
          pinching: false,
          lastSeen: time
        };
        handStates.set(h.id, state);
      }

      state.pinch.copy(
        screenToWorld(h.pinchPoint.x * width, h.pinchPoint.y * height)
      );

      state.palm.copy(
        screenToWorld(h.palm.x * width, h.palm.y * height)
      );

      state.tip.copy(
        screenToWorld(h.fingerTip.x * width, h.fingerTip.y * height)
      );
      state.tip.z = 45;

      state.pose = h.pose;
      state.mode = h.mode;
      state.energy = h.energy;
      state.pinching =
        (h.grabbing || h.pose === 'PINCH') && h.mode !== 'CHARGING';
      state.lastSeen = time;

      state.history.push({ t: time, x: state.palm.x, y: state.palm.y });

      while (
        state.history.length > 0 &&
        time - state.history[0].t > 500
      ) {
        state.history.shift();
      }
    }

    // Fingertip strokes (two-finger drawing)
    if (frame.circles) {

      for (const stroke of frame.circles.strokes) {

        const position = screenToWorld(
          stroke.tip.x * width,
          stroke.tip.y * height
        );

        position.z = 40;

        let state = strokeStates.get(stroke.handId);

        if (!state) {
          state = { pos: new THREE.Vector3(), power: 0, lastSeen: 0 };
          strokeStates.set(stroke.handId, state);
        }

        state.pos.copy(position);
        state.power = THREE.MathUtils.clamp(0.25 + stroke.speed * 0.8, 0.25, 1.15);
        state.lastSeen = time;

        effects.trailPoint(`stroke-${stroke.handId}`, position, time);
      }
    }

    for (const event of frame.events) {

      switch (event.type) {

        case 'GRAB_START':
          tryGrab(event.handId);
          break;

        case 'GRAB_END':
          releaseHold(event.handId, event.time ?? time);
          break;

        case 'RELEASE':
          explode(event);
          break;

        case 'SNAP':
          snapStrike(event);
          break;

        case 'CIRCLE_COMPLETE':
          if (event.anchor && handStates.has(event.anchor.handId)) {
            openMandalaFromEvent(event);
          } else {
            openSlingPortal(event);
          }
          break;

        case 'CHARGE_CANCEL': {
          const state = handStates.get(event.handId);
          if (state) effects.sparks(state.palm, 30, 0.8);
          break;
        }
      }
    }

    for (const [id, state] of strokeStates) {
      if (time - state.lastSeen > 600) strokeStates.delete(id);
    }

    // Forget hands that disappeared (and are not holding anything)
    for (const [id, state] of handStates) {
      if (time - state.lastSeen > 900 && !holds.has(id)) {
        handStates.delete(id);
      }
    }
  }

  // How "energised" an object is: charged by a nearby fist, held, or called
  function computeHeatTarget(object) {

    const now = nowMs();
    const p = object.group.position;

    let target = object.heldBy !== null ? 0.65 : 0;

    for (const state of handStates.values()) {

      if (!handIsLive(state, now)) continue;

      if (state.mode === 'CHARGING') {

        const d = Math.hypot(p.x - state.palm.x, p.y - state.palm.y);
        const closeness = 1 - Math.min(d / (TUNING.chargeRange * 1.1), 1);

        target = Math.max(target, (0.2 + 0.8 * state.energy) * closeness);

      } else if (state.pinching) {

        const d = Math.hypot(p.x - state.pinch.x, p.y - state.pinch.y);

        if (d < TUNING.assistRadius) {
          target = Math.max(target, 0.35 * (1 - d / TUNING.assistRadius));
        }
      }
    }

    return target;
  }

  // ==============================================
  // PHYSICS
  // ==============================================

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function updatePhysics(dt, time) {

    const now = nowMs();

    // Pinching hands that hold nothing keep trying to catch something
    for (const [id, state] of handStates) {

      if (
        state.pinching &&
        handIsLive(state, now) &&
        !holds.has(id)
      ) {
        tryGrab(id);
      }
    }

    for (const object of objects) {

      if (object.dead) continue;

      const position = object.group.position;

      // ---------------- held object ----------------
      if (object.heldBy !== null) {

        const state = handStates.get(object.heldBy);

        if (state) {

          // The offset melts away so the object snaps into the fingers
          object.offset.multiplyScalar(
            Math.exp(-TUNING.offsetDecay * dt)
          );

          tmp.set(
            state.pinch.x + object.offset.x,
            state.pinch.y + object.offset.y,
            object.baseZ + 40
          );

          position.lerp(
            tmp,
            1 - Math.exp(-TUNING.followStiffness * dt)
          );
        }

        object.velocity.set(0, 0, 0);

        effects.flame(`obj-${object.group.id}`, position, 0.45, dt, object.radius * 0.6);

        continue;
      }

      // ---------------- pinching hand calls free objects ----------------
      for (const [id, state] of handStates) {

        if (!handIsLive(state, now)) continue;

        if (state.pinching && !holds.has(id)) {

          tmp.set(
            state.pinch.x - position.x,
            state.pinch.y - position.y,
            0
          );

          const distance = tmp.length();

          if (distance < TUNING.assistRadius && distance > 1) {

            tmp.normalize();

            const strength =
              TUNING.assistStrength * (1 - distance / TUNING.assistRadius);

            object.velocity.addScaledVector(tmp, strength * dt);
            object.velocity.multiplyScalar(Math.exp(-1.4 * dt));
          }
        }

        // ---------------- charging fist pulls objects into orbit ----------------
        if (state.mode === 'CHARGING') {

          tmp.set(
            state.palm.x - position.x,
            state.palm.y - position.y,
            0
          );

          const distance = tmp.length();

          if (distance < TUNING.chargeRange && distance > 1) {

            tmp.normalize();

            const e = state.energy;
            const falloff = 1 - distance / TUNING.chargeRange;

            // Radial spring toward this object's orbit radius
            const radial = THREE.MathUtils.clamp(
              (distance - object.orbitRadius) * (7 + 18 * e),
              -700,
              700
            );

            object.velocity.addScaledVector(tmp, radial * TUNING.chargePull * dt);

            // Tangential push -> orbiting motion
            tmp2.set(-tmp.y, tmp.x, 0);

            object.velocity.addScaledVector(
              tmp2,
              (200 + 520 * e) * (0.35 + falloff) * dt
            );

            object.velocity.multiplyScalar(Math.exp(-1.1 * dt));
          }
        }
      }

      // ---------------- open portals draw objects in and fling them out ----------------
      for (const portal of effects.getPortals()) {

        if (portal.fade < 0.5) continue;

        tmp.set(portal.x - position.x, portal.y - position.y, 0);

        const distance = tmp.length();
        const reach = portal.radius * 2.6;

        if (distance < reach && distance > 1) {

          tmp.normalize();

          const k = 1 - distance / reach;

          object.velocity.addScaledVector(tmp, TUNING.portalPull * k * dt);

          tmp2.set(-tmp.y, tmp.x, 0);

          object.velocity.addScaledVector(
            tmp2,
            TUNING.portalSwirl * portal.dir * k * dt
          );
        }

        if (distance < portal.radius * 0.35 && now > object.portalUntil) {

          const a = Math.random() * Math.PI * 2;

          object.velocity.set(
            Math.cos(a) * TUNING.portalEjectSpeed,
            Math.sin(a) * TUNING.portalEjectSpeed,
            0
          );

          object.heat = 1;
          object.spinBoost = 4;
          object.portalUntil = now + 1500;

          effects.sparks(position, 40, 1.6);
        }
      }

      // ---------------- mandala shield: objects bounce off it ----------------
      for (const mandala of effects.getMandalas()) {

        if (mandala.fade < 0.5) continue;

        tmp.set(position.x - mandala.x, position.y - mandala.y, 0);

        const distance = tmp.length();
        const limit = mandala.radius + object.radius;

        if (distance < limit && distance > 0.001) {

          tmp.normalize();

          const inward = object.velocity.dot(tmp);

          // Reflect the inward part of the velocity (restitution 0.7)
          if (inward < 0) {
            object.velocity.addScaledVector(tmp, -inward * 1.7);
          }

          // Shove objects out of the shield (limited per frame, not a snap)
          position.addScaledVector(tmp, Math.min(limit - distance, 900 * dt));

          object.velocity.addScaledVector(tmp, 160 * dt);

          if (now > object.shieldUntil) {
            effects.sparks(position, 16, 1.2);
            object.heat = 1;
            object.shieldUntil = now + 250;
          }
        }
      }

      // Natural floating force
      object.velocity.y +=
        Math.sin(time * 0.001 + object.phase) *
        7 * dt;

      // Velocity integration
      position.addScaledVector(
        object.velocity,
        dt
      );

      // Air resistance
      object.velocity.multiplyScalar(
        Math.pow(0.985, dt * 60)
      );

      // Maximum velocity
      if (object.velocity.length() > TUNING.maxSpeed) {
        object.velocity.setLength(TUNING.maxSpeed);
      }

      // Boundary handling
      const margin = object.radius * 2;

      const maxX = visibleWidth / 2 - margin;
      const maxY = visibleHeight / 2 - margin;

      if (position.x < -maxX) {
        position.x = -maxX;
        object.velocity.x *= -0.65;
      }

      if (position.x > maxX) {
        position.x = maxX;
        object.velocity.x *= -0.65;
      }

      if (position.y < -maxY) {
        position.y = -maxY;
        object.velocity.y *= -0.65;
      }

      if (position.y > maxY) {
        position.y = maxY;
        object.velocity.y *= -0.65;
      }
    }
  }

  // ==============================================
  // HAND FLAMES + LIGHT
  // ==============================================

  let lightTarget = 0;
  const lightPosition = new THREE.Vector3();

  function updateHandEffects(dt) {

    const now = nowMs();

    let strongest = 0;

    for (const [id, state] of handStates) {

      if (!handIsLive(state, now)) continue;

      // Orb flames at the pinch point
      if (state.pinching) {

        const power = holds.has(id) ? 0.9 : 0.75;

        effects.flame(`pinch-${id}`, state.pinch, power, dt, 9);

        if (power > strongest) {
          strongest = power;
          lightPosition.copy(state.pinch);
        }
      }

      // Charging: plume grows with stored energy
      if (state.mode === 'CHARGING') {

        const power = 0.25 + 0.95 * state.energy;

        effects.flame(`charge-${id}`, state.palm, power, dt, 12 + 22 * state.energy);

        if (power > strongest) {
          strongest = power;
          lightPosition.copy(state.palm);
        }
      }
    }

    // ---------------- mandala upkeep ----------------
    for (const mandala of effects.getMandalas()) {

      const meta = mandalaMeta.get(mandala.key) || { follow: true, lostAt: 0 };
      const anchor = handStates.get(mandala.key);

      const anchorOk =
        anchor && handIsLive(anchor, now) && anchor.pose === 'OPEN';

      if (anchorOk) {

        meta.lostAt = 0;

        if (meta.follow) effects.moveMandala(mandala.key, anchor.palm);

      } else {

        if (!meta.lostAt) meta.lostAt = now;

        if (now - meta.lostAt > TUNING.mandalaLostMs) {
          effects.closeMandala(mandala.key);
        }
      }

      mandalaMeta.set(mandala.key, meta);

      // Rays from the other hand's two fingers to the mandala
      let tip = null;

      for (const [id, state] of handStates) {

        if (id === mandala.key) continue;
        if (!handIsLive(state, now)) continue;

        if (state.pose === 'TWO_FINGERS') {
          tip = state.tip;
          break;
        }
      }

      effects.setBeams(mandala.key, tip);

      // The mandala lights the scene
      if (mandala.fade > 0.5 && strongest < 0.7) {
        strongest = 0.7;
        lightPosition.set(mandala.x, mandala.y, 0);
      }
    }

    // Embers shed by the fingertip while drawing a circle
    for (const [id, state] of strokeStates) {

      if (now - state.lastSeen > 200) continue;

      effects.sparkTrail(`stroke-${id}`, state.pos, state.power, dt);

      if (state.power > strongest) {
        strongest = state.power * 0.8;
        lightPosition.copy(state.pos);
      }
    }

    lightTarget = strongest * 380;

    handLight.intensity +=
      (lightTarget - handLight.intensity) * (1 - Math.exp(-12 * dt));

    handLight.position.set(lightPosition.x, lightPosition.y, 140);

    // Short warm flash at the explosion centre
    if (releaseFlash > 0.001) {

      handLight.position.set(
        releaseFlashPosition.x,
        releaseFlashPosition.y,
        160
      );

      handLight.intensity += releaseFlash * 2600;

      releaseFlash *= Math.exp(-9 * dt);
    }
  }

  // ==============================================
  // 3D ANIMATION
  // ==============================================

  let running = true;
  let animationId;
  let lastFrame = performance.now();

  function animate(now) {

    if (!running) return;

    animationId = requestAnimationFrame(animate);

    const dt = Math.min(
      (now - lastFrame) / 1000,
      0.033
    );

    lastFrame = now;

    updatePhysics(dt, now);

    if (thanos) {
      thanos.update(dt, now);
      updateSnapObjects();
    }

    for (const object of objects) {

      const group = object.group;

      if (object.dead) continue;

      // Objects pop back in (after the snap is undone)
      if (object.appear < 1) {

        object.appear = Math.min(1, object.appear + dt / 0.7);

        const c1 = 1.70158;
        const c3 = c1 + 1;
        const k = object.appear - 1;

        group.scale.setScalar(
          Math.max(0.001, 1 + c3 * k * k * k + c1 * k * k)
        );
      }

      // They tremble while the sweep is on its way
      if (thanos && thanos.getState() === 'DISSOLVING') {
        group.rotation.z += (Math.random() - 0.5) * 0.14;
      }

      group.rotation.x +=
        object.rotationSpeed.x * object.spinBoost * dt;

      group.rotation.y +=
        object.rotationSpeed.y * object.spinBoost * dt;

      group.rotation.z +=
        object.rotationSpeed.z * object.spinBoost * dt;

      // Explosion spin settles back to normal
      object.spinBoost = 1 + (object.spinBoost - 1) * Math.exp(-1.6 * dt);

      object.phase += dt;

      if (object.heldBy === null) {

        group.position.z =
          object.baseZ + Math.sin(object.phase * 1.4) * 12;
      }

      // Heat follows the hand quickly when rising and cools slowly
      const heatTarget = computeHeatTarget(object);

      object.heat +=
        (heatTarget - object.heat) *
        (1 - Math.exp(-(heatTarget > object.heat ? 8 : 2.2) * dt));

      object.visual.update(dt, now * 0.001, object.heat);

      // Subtle fire around energy cores
      if (object.type === 'core' && TUNING.coreFlamePower > 0) {

        effects.flame(
          `core-${group.id}`,
          group.position,
          TUNING.coreFlamePower * (1 + object.heat),
          dt,
          object.radius * 0.7
        );
      }

      // Fast objects leave a thin spark trail
      const speed = object.velocity.length();

      if (speed > 220 && Math.random() < 0.35) {
        effects.sparks(group.position, 1, 0.35);
      }
    }

    updateHandEffects(dt);

    effects.update(dt, now);

    orangeLight.intensity =
      400 + Math.sin(now * 0.002) * 60;

    // Short camera shake (decays quickly)
    if (shake > 0.05) {

      camera.position.x = (Math.random() - 0.5) * shake;
      camera.position.y = (Math.random() - 0.5) * shake;

      shake *= Math.exp(-7 * dt);

    } else if (camera.position.x !== 0 || camera.position.y !== 0) {

      camera.position.x = 0;
      camera.position.y = 0;
      shake = 0;
    }

    renderer.render(scene, camera);
  }

  animate(lastFrame);

  // Let go of everything (used when system-control mode takes over the hands)
  function releaseAll() {

    for (const object of holds.values()) {
      object.velocity.set(0, 0, 0);
      object.heldBy = null;
      object.grabbed = false;
    }

    holds.clear();

    for (const mandala of effects.getMandalas()) {
      effects.closeMandala(mandala.key);
    }

    mandalaMeta.clear();
    strokeStates.clear();
    handStates.clear();
  }

  // ==============================================
  // CLEANUP
  // ==============================================

  function dispose() {

    running = false;

    cancelAnimationFrame(animationId);

    if (thanos) thanos.dispose();
    effects.dispose();
    factory.dispose();

    scene.traverse((child) => {

      if (child.geometry) {
        child.geometry.dispose();
      }

      if (child.material) {

        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach(material => {

          if (material.map) material.map.dispose();

          material.dispose();
        });
      }
    });

    glowTexture.dispose();

    renderer.dispose();
    renderer.forceContextLoss();

    renderer.domElement.remove();

    handStates.clear();
    holds.clear();
    strokeStates.clear();
    mandalaMeta.clear();
    objects.length = 0;
  }

  return {
    update,
    releaseAll,
    attachSegmenter: (instance) => {
      if (thanos) thanos.attachSegmenter(instance);
    },
    dispose
  };
}