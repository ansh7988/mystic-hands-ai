import * as THREE from 'three';
import { createMagicEffects } from './magicEffects.js';

// ================================================
// MYSTIC HANDS AI - TELEKINESIS
//
// Interaction is driven by the gesture state machine (gestureEngine.js):
//   PINCH  (GRAB_START / GRAB_END)  -> grab, carry, throw
//   FIST   (CHARGING)               -> objects are pulled into orbit
//   OPEN   (RELEASE event)          -> radial explosion impulse
//
// Visual models are still the Milestone 1 placeholders; they are replaced
// in Milestone 3. Interaction and effects here are final-quality first passes.
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

  maxSpeed: 1600
};

export function createTelekinesisEngine(container, width, height) {

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
    2.0
  ));

  const ambient = new THREE.AmbientLight(
    0xffffff,
    0.65
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
  // ROCK GEOMETRY  (placeholder until Milestone 3)
  // ==============================================

  function createRockGeometry(radius) {

    const geometry = new THREE.IcosahedronGeometry(
      radius,
      2
    );

    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {

      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      const noise =
        0.82 + Math.random() * 0.36;

      positions.setXYZ(
        i,
        x * noise,
        y * noise,
        z * noise
      );
    }

    positions.needsUpdate = true;

    geometry.computeVertexNormals();

    return geometry;
  }

  // ==============================================
  // CRYSTAL GEOMETRY  (placeholder until Milestone 3)
  // ==============================================

  function createCrystalGeometry(radius) {

    const geometry = new THREE.OctahedronGeometry(
      radius,
      0
    );

    geometry.scale(
      0.85,
      1.5,
      0.85
    );

    return geometry;
  }

  // ==============================================
  // OBJECT FACTORY  (placeholder visuals until Milestone 3)
  // ==============================================

  const objects = [];

  function createEnergyObject(type, x, y, radius) {

    const group = new THREE.Group();

    let mainMesh;

    // ---------------- ROCK ----------------

    if (type === 'rock') {

      const material = new THREE.MeshStandardMaterial({
        color: 0x38312e,
        roughness: 0.88,
        metalness: 0.15,
        emissive: 0x421400,
        emissiveIntensity: 0.5,
        flatShading: true
      });

      mainMesh = new THREE.Mesh(
        createRockGeometry(radius),
        material
      );

      mainMesh.castShadow = true;
      mainMesh.receiveShadow = true;

      group.add(mainMesh);

      // Glowing lava cracks
      const edges = new THREE.EdgesGeometry(
        mainMesh.geometry,
        35
      );

      const crackLines = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: 0xff651b,
          transparent: true,
          opacity: 0.65
        })
      );

      group.add(crackLines);

      // Small debris pieces
      for (let i = 0; i < 3; i++) {

        const debris = new THREE.Mesh(
          new THREE.TetrahedronGeometry(radius * 0.18),
          new THREE.MeshStandardMaterial({
            color: 0x4c3020,
            emissive: 0x7c2400,
            emissiveIntensity: 0.5
          })
        );

        debris.position.set(
          (Math.random() - 0.5) * radius * 1.5,
          (Math.random() - 0.5) * radius * 1.5,
          (Math.random() - 0.5) * radius * 0.8
        );

        debris.castShadow = true;

        group.add(debris);
      }
    }

    // ---------------- CRYSTAL ----------------

    if (type === 'crystal') {

      const material = new THREE.MeshPhysicalMaterial({
        color: 0x9e4b19,
        emissive: 0x622000,
        emissiveIntensity: 0.5,
        metalness: 0.35,
        roughness: 0.15,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        flatShading: true
      });

      mainMesh = new THREE.Mesh(
        createCrystalGeometry(radius),
        material
      );

      mainMesh.castShadow = true;
      mainMesh.receiveShadow = true;

      group.add(mainMesh);

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(mainMesh.geometry),
        new THREE.LineBasicMaterial({
          color: 0xffc16b,
          transparent: true,
          opacity: 0.8
        })
      );

      group.add(outline);
    }

    // ---------------- ENERGY CORE ----------------

    if (type === 'core') {

      mainMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 40, 40),
        new THREE.MeshPhysicalMaterial({
          color: 0xffb13b,
          emissive: 0xff6500,
          emissiveIntensity: 2,
          metalness: 0.3,
          roughness: 0.12,
          clearcoat: 1
        })
      );

      mainMesh.castShadow = true;

      group.add(mainMesh);

      // Inner energy shell
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * 1.12, 1),
        new THREE.MeshBasicMaterial({
          color: 0xff8b20,
          wireframe: true,
          transparent: true,
          opacity: 0.5
        })
      );

      group.add(shell);

      // Energy rings
      const ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.4, 1.8, 8, 64),
        new THREE.MeshBasicMaterial({
          color: 0xffd07a
        })
      );

      ring1.rotation.x = 0.7;

      group.add(ring1);

      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.7, 1.2, 8, 64),
        new THREE.MeshBasicMaterial({
          color: 0xff7b24
        })
      );

      ring2.rotation.y = 1.1;

      group.add(ring2);
    }

    // ---------------- COMMON GLOW ----------------

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: type === 'crystal'
          ? 0xffc080
          : 0xff8a20,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );

    glow.scale.set(
      radius * 4.5,
      radius * 4.5,
      1
    );

    group.add(glow);

    // Position object
    group.position.copy(screenToWorld(x, y));

    // Depth variation is kept (it used to be overwritten every frame)
    const baseZ = Math.random() * 90 - 30;

    group.position.z = baseZ;

    scene.add(group);

    const object = {
      group,
      mainMesh,
      type,
      radius,

      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 35,
        0
      ),

      rotationSpeed: new THREE.Vector3(
        Math.random() * 0.8,
        Math.random() * 1.2,
        Math.random() * 0.8
      ),

      spinBoost: 1,
      baseZ,
      orbitRadius: 95 + objects.length % 3 * 48,

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

      if (object.heldBy !== null) continue;

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

      if (object.heldBy !== null) continue;

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

  // ==============================================
  // PUBLIC UPDATE - CALLED BY handTracking.js
  // ==============================================

  function update(hands, time = nowMs(), frame = null) {

    if (!frame) return;

    for (const h of frame.hands) {

      let state = handStates.get(h.id);

      if (!state) {
        state = {
          pinch: new THREE.Vector3(),
          palm: new THREE.Vector3(),
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

        case 'CHARGE_CANCEL': {
          const state = handStates.get(event.handId);
          if (state) effects.sparks(state.palm, 30, 0.8);
          break;
        }
      }
    }

    // Forget hands that disappeared (and are not holding anything)
    for (const [id, state] of handStates) {
      if (time - state.lastSeen > 900 && !holds.has(id)) {
        handStates.delete(id);
      }
    }
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

    for (const object of objects) {

      const group = object.group;

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

      // Core glow intensity animation
      if (object.type === 'core') {

        const pulse =
          1.6 + Math.sin(now * 0.004 + object.phase) * 0.4;

        object.mainMesh.material.emissiveIntensity = pulse;
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

  // ==============================================
  // CLEANUP
  // ==============================================

  function dispose() {

    running = false;

    cancelAnimationFrame(animationId);

    effects.dispose();

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
    objects.length = 0;
  }

  return {
    update,
    dispose
  };
}