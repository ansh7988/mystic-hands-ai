import * as THREE from 'three';

// ================================================
// MYSTIC HANDS AI - MAGIC EFFECTS
//
// One GPU point-sprite pool renders two particle kinds:
//   - flame wisps : soft, noise-shaped, taper as they rise
//                   (white-gold core -> orange -> deep red)
//   - sparks      : tiny hot embers that spiral outward
//
// Palette is deliberately limited to gold / orange / ember red and
// everything is small and fast, so it reads as sling-ring sorcery
// rather than a cartoon campfire. All tuning lives in FLAME_CONFIG.
// ================================================

export const FLAME_CONFIG = {
  poolSize: 3200,

  // emissions per second at power = 1
  flameRate: 55,
  sparkRate: 95,

  // world units (the camera sees about 1230 x 690 units)
  flameSize: [9, 16],
  flameLife: [0.40, 0.75],
  flameRise: [45, 105],
  flameSwirl: 38,

  sparkSize: [1.4, 3.0],
  sparkLife: [0.7, 1.5],
  sparkSpeed: [90, 320],
  sparkSpiral: 0.55,     // 0 = straight out, 1 = tangential

  emitterRadius: 7
};

const VERTEX = /* glsl */ `
  attribute float aAge;
  attribute float aSize;
  attribute float aSeed;
  attribute float aKind;

  uniform float uScale;

  varying float vAge;
  varying float vSeed;
  varying float vKind;

  void main() {
    vAge = aAge;
    vSeed = aSeed;
    vKind = aKind;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float s = aAge >= 1.0 ? 0.0 : aSize;
    gl_PointSize = clamp(s * uScale / max(-mv.z, 1.0), 0.0, 220.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform float uTime;

  varying float vAge;
  varying float vSeed;
  varying float vKind;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p *= 2.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    if (vAge >= 1.0) discard;

    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float t = vAge;
    float alpha;
    vec3 col;

    if (vKind > 0.5) {

      // ----- spark: hot pin-point with a soft halo -----
      float core = pow(1.0 - r, 2.6);
      alpha = core * (1.0 - t * t) * 1.5;
      alpha *= 0.78 + 0.22 * sin(uTime * 38.0 + vSeed * 50.0);

      col = mix(vec3(1.0, 0.96, 0.78), vec3(1.0, 0.40, 0.06), smoothstep(0.0, 0.55, t));
      col = mix(col, vec3(0.55, 0.08, 0.02), smoothstep(0.6, 1.0, t));

    } else {

      // ----- flame wisp: noise-shaped, tapering, heat colour ramp -----
      vec2 q = p * 1.5 + vec2(vSeed * 10.0, -uTime * 1.7 + vSeed * 7.0);
      float n = fbm(q);

      float shape = smoothstep(1.0, 0.12, r);
      float fadeIn = smoothstep(0.0, 0.10, t);
      float fadeOut = 1.0 - smoothstep(0.30, 1.0, t);

      alpha = shape * (0.30 + 0.95 * n) * fadeIn * fadeOut * 0.62;

      float heat = clamp((1.0 - t) * (0.50 + 0.70 * shape * n), 0.0, 1.0);
      col = mix(vec3(0.42, 0.04, 0.01), vec3(1.0, 0.40, 0.05), smoothstep(0.0, 0.50, heat));
      col = mix(col, vec3(1.0, 0.86, 0.48), smoothstep(0.55, 1.0, heat));
    }

    if (alpha <= 0.002) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

export function createMagicEffects(scene) {

  const cfg = FLAME_CONFIG;
  const N = cfg.poolSize;

  // ---------------- particle storage ----------------

  const pos = new Float32Array(N * 3);
  const age01 = new Float32Array(N).fill(1);
  const size = new Float32Array(N);
  const seed = new Float32Array(N);
  const kind = new Float32Array(N);

  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N).fill(1);
  const elapsed = new Float32Array(N).fill(1);
  const size0 = new Float32Array(N);
  const size1 = new Float32Array(N);
  const drag = new Float32Array(N);
  const lift = new Float32Array(N);
  const turb = new Float32Array(N);

  const geometry = new THREE.BufferGeometry();

  const posAttr = new THREE.BufferAttribute(pos, 3);
  const ageAttr = new THREE.BufferAttribute(age01, 1);
  const sizeAttr = new THREE.BufferAttribute(size, 1);

  [posAttr, ageAttr, sizeAttr].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));

  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aAge', ageAttr);
  geometry.setAttribute('aSize', sizeAttr);
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));

  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 800 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geometry, material);

  points.frustumCulled = false;
  points.renderOrder = 10;

  scene.add(points);

  // ---------------- helpers ----------------

  let cursor = 0;
  let clock = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (range) => rand(range[0], range[1]);

  function spawn(i, k, x, y, z, vx, vy, vz, s0, s1, lifeSec, dragK, liftK, turbK) {

    const j = i * 3;

    pos[j] = x;
    pos[j + 1] = y;
    pos[j + 2] = z;

    vel[j] = vx;
    vel[j + 1] = vy;
    vel[j + 2] = vz;

    kind[i] = k;
    seed[i] = Math.random();

    size0[i] = s0;
    size1[i] = s1;
    size[i] = s0;

    life[i] = lifeSec;
    elapsed[i] = 0;
    age01[i] = 0;

    drag[i] = dragK;
    lift[i] = liftK;
    turb[i] = turbK;
  }

  function nextIndex() {
    const i = cursor;
    cursor = (cursor + 1) % N;
    return i;
  }

  function emitFlame(p, power, radius) {

    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * radius * (0.5 + 0.5 * power);

    const cx = Math.cos(a);
    const sy = Math.sin(a);

    const rise = pick(cfg.flameRise) * (0.6 + 0.4 * power);
    const swirl = cfg.flameSwirl * (0.5 + 0.5 * power);

    const s0 = pick(cfg.flameSize) * (0.6 + 0.5 * power);

    spawn(
      nextIndex(), 0,
      p.x + cx * rr, p.y + sy * rr, p.z + rand(-4, 4),
      -sy * swirl + rand(-14, 14),
      cx * swirl * 0.4 + rise,
      rand(-8, 8),
      s0, s0 * 0.45,
      pick(cfg.flameLife),
      1.4, 40, 55
    );
  }

  function emitSpark(p, speedScale, radius, spiral = cfg.sparkSpiral) {

    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * radius;

    const cx = Math.cos(a);
    const sy = Math.sin(a);

    const speed = pick(cfg.sparkSpeed) * speedScale;

    const radial = speed * (1 - spiral * 0.5);
    const tangent = speed * spiral;

    spawn(
      nextIndex(), 1,
      p.x + cx * rr, p.y + sy * rr, p.z + rand(-3, 3),
      cx * radial - sy * tangent,
      sy * radial + cx * tangent + 25,
      rand(-30, 30),
      pick(cfg.sparkSize), 0.4,
      pick(cfg.sparkLife),
      1.7, 18, 90
    );
  }

  // ---------------- public emitters ----------------

  const accumulator = new Map();

  /**
   * Continuous plume. Call every frame while something burns.
   * @param key   any stable id so each emitter keeps its own timer
   * @param power 0..1.5
   */
  function flame(key, position, power, dt, radius = cfg.emitterRadius) {

    if (power <= 0.001) return;

    let acc = accumulator.get(key);

    if (!acc) {
      acc = { flame: 0, spark: 0 };
      accumulator.set(key, acc);
    }

    acc.flame += cfg.flameRate * power * dt;
    acc.spark += cfg.sparkRate * power * dt;

    while (acc.flame >= 1) {
      acc.flame -= 1;
      emitFlame(position, Math.min(power, 1.2), radius);
    }

    while (acc.spark >= 1) {
      acc.spark -= 1;
      emitSpark(position, 0.55 + 0.5 * Math.min(power, 1.2), radius);
    }
  }

  function sparks(position, count, speedScale = 1) {
    for (let i = 0; i < count; i++) {
      emitSpark(position, speedScale, 4, 0.35);
    }
  }

  function burst(position, energy) {

    const e = Math.min(Math.max(energy, 0), 1);

    const sparkCount = Math.round(110 + 440 * e);
    const flameCount = Math.round(14 + 52 * e);

    for (let i = 0; i < sparkCount; i++) {
      emitSpark(position, 1.3 + 1.6 * e, 10, 0.25);
    }

    for (let i = 0; i < flameCount; i++) {

      const a = Math.random() * Math.PI * 2;
      const speed = rand(80, 260) * (0.6 + e);

      const s0 = rand(22, 40) * (0.7 + 0.6 * e);

      spawn(
        nextIndex(), 0,
        position.x, position.y, position.z + rand(-6, 6),
        Math.cos(a) * speed,
        Math.sin(a) * speed + 30,
        rand(-30, 30),
        s0, s0 * 0.5,
        rand(0.45, 0.95),
        2.2, 45, 60
      );
    }
  }

  // ---------------- shockwave rings ----------------

  const ringGeometry = new THREE.RingGeometry(0.93, 1, 96);
  const rings = [];

  for (let i = 0; i < 4; i++) {

    const mesh = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffa648,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );

    mesh.visible = false;
    mesh.renderOrder = 9;

    scene.add(mesh);

    rings.push({ mesh, t: 1, duration: 0.5, radius: 100 });
  }

  let ringCursor = 0;

  function ring(position, radius, duration = 0.55) {

    const r = rings[ringCursor];

    ringCursor = (ringCursor + 1) % rings.length;

    r.t = 0;
    r.duration = duration;
    r.radius = radius;

    r.mesh.position.set(position.x, position.y, position.z + 5);
    r.mesh.visible = true;
  }

  // ---------------- simulation ----------------

  function update(dt, time) {

    clock = time * 0.001;
    uniforms.uTime.value = clock;

    updateExtras(dt, time);

    for (let i = 0; i < N; i++) {

      if (elapsed[i] >= life[i]) {
        age01[i] = 1;
        continue;
      }

      elapsed[i] += dt;

      const u = elapsed[i] / life[i];

      if (u >= 1) {
        age01[i] = 1;
        continue;
      }

      age01[i] = u;

      const j = i * 3;

      // drag, buoyancy, turbulence
      const damp = Math.exp(-drag[i] * dt);

      vel[j] *= damp;
      vel[j + 1] = vel[j + 1] * damp + lift[i] * dt;
      vel[j + 2] *= damp;

      const w = clock * 7 + seed[i] * 40 + pos[j + 1] * 0.06;

      vel[j] += Math.sin(w) * turb[i] * dt;
      vel[j + 2] += Math.cos(w * 1.3) * turb[i] * 0.4 * dt;

      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;

      size[i] = size0[i] + (size1[i] - size0[i]) * u;
    }

    posAttr.needsUpdate = true;
    ageAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;

    for (const r of rings) {

      if (r.t >= 1) {
        r.mesh.visible = false;
        continue;
      }

      r.t = Math.min(1, r.t + dt / r.duration);

      const eased = 1 - Math.pow(1 - r.t, 3);

      r.mesh.scale.setScalar(Math.max(1, r.radius * eased));
      r.mesh.material.opacity = Math.pow(1 - r.t, 1.6) * 0.75;
    }
  }


  // ---------------- falling-ember trail (fingertip while drawing) ----------------

  const trailAccumulator = new Map();

  /**
   * Sparks shed by a moving fingertip.
   * @param power 0..1.2  (grows with fingertip speed)
   */
  function sparkTrail(key, position, power, dt) {

    if (power <= 0.001) return;

    let acc = trailAccumulator.get(key) || 0;

    acc += 85 * power * dt;

    while (acc >= 1) {

      acc -= 1;

      const a = Math.random() * Math.PI * 2;
      const speed = rand(25, 150) * (0.6 + power * 0.6);

      spawn(
        nextIndex(), 1,
        position.x + rand(-2, 2), position.y + rand(-2, 2), position.z,
        Math.cos(a) * speed,
        Math.sin(a) * speed + 20,
        rand(-20, 20),
        pick(cfg.sparkSize) * 1.1, 0.4,
        rand(0.6, 1.4),
        2.0, -28, 80
      );
    }

    trailAccumulator.set(key, acc);
  }

  // ---------------- glowing ribbon that follows the fingertip ----------------

  const TRAIL = {
    maxVertexPairs: 170,
    lifeMs: 1700,
    width: 4.6,
    subdivisions: 3,
    slots: 4
  };

  const TRAIL_VERTEX = /* glsl */ `
    attribute float aAlpha;
    attribute float aHead;
    attribute float aSide;

    varying float vAlpha;
    varying float vHead;
    varying float vSide;

    void main() {
      vAlpha = aAlpha;
      vHead = aHead;
      vSide = aSide;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const TRAIL_FRAGMENT = /* glsl */ `
    varying float vAlpha;
    varying float vHead;
    varying float vSide;

    void main() {
      float across = pow(1.0 - abs(vSide), 1.4);
      vec3 col = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.90, 0.60), pow(vHead, 3.0));
      float a = vAlpha * across;
      if (a < 0.003) discard;
      gl_FragColor = vec4(col, a);
    }
  `;

  function makeTrailSlot() {

    const pairs = TRAIL.maxVertexPairs;
    const vertices = pairs * 2;

    const posArray = new Float32Array(vertices * 3);
    const alphaArray = new Float32Array(vertices);
    const headArray = new Float32Array(vertices);
    const sideArray = new Float32Array(vertices);

    for (let i = 0; i < pairs; i++) {
      sideArray[i * 2] = -1;
      sideArray[i * 2 + 1] = 1;
    }

    const indices = new Uint16Array((pairs - 1) * 6);

    for (let i = 0; i < pairs - 1; i++) {

      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;

      indices.set([a, b, c, b, d, c], i * 6);
    }

    const geometry = new THREE.BufferGeometry();

    const pa = new THREE.BufferAttribute(posArray, 3);
    const aa = new THREE.BufferAttribute(alphaArray, 1);
    const ha = new THREE.BufferAttribute(headArray, 1);

    [pa, aa, ha].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));

    geometry.setAttribute('position', pa);
    geometry.setAttribute('aAlpha', aa);
    geometry.setAttribute('aHead', ha);
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sideArray, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: TRAIL_VERTEX,
        fragmentShader: TRAIL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );

    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.visible = false;

    scene.add(mesh);

    return {
      key: null,
      points: [],
      lastUsed: 0,
      mesh,
      geometry,
      posArray,
      alphaArray,
      headArray
    };
  }

  const trailSlots = [];

  for (let i = 0; i < TRAIL.slots; i++) trailSlots.push(makeTrailSlot());

  function trailPoint(key, position, timeMs) {

    let slot = trailSlots.find((t) => t.key === key);

    if (!slot) {

      slot =
        trailSlots.find((t) => t.points.length === 0) ||
        trailSlots.reduce((a, b) => (a.lastUsed < b.lastUsed ? a : b));

      slot.key = key;
      slot.points.length = 0;
    }

    const last = slot.points[slot.points.length - 1];

    if (last && Math.hypot(position.x - last.x, position.y - last.y) < 1.2) {
      return;
    }

    slot.points.push({ x: position.x, y: position.y, z: position.z, t: timeMs });

    if (slot.points.length > 60) slot.points.shift();

    slot.lastUsed = timeMs;
  }

  // Catmull-Rom subdivision so a hand-drawn circle looks round, not polygonal
  function densify(points) {

    const dense = [];
    const S = TRAIL.subdivisions;

    for (let i = 0; i < points.length - 1; i++) {

      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      for (let s = 0; s < S; s++) {

        const t = s / S;
        const t2 = t * t;
        const t3 = t2 * t;

        const cr = (a, b, c, d) =>
          0.5 * (
            2 * b +
            (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * t2 +
            (-a + 3 * b - 3 * c + d) * t3
          );

        dense.push({
          x: cr(p0.x, p1.x, p2.x, p3.x),
          y: cr(p0.y, p1.y, p2.y, p3.y),
          z: p1.z,
          t: p1.t + (p2.t - p1.t) * t
        });
      }
    }

    dense.push(points[points.length - 1]);

    return dense.length > TRAIL.maxVertexPairs
      ? dense.slice(dense.length - TRAIL.maxVertexPairs)
      : dense;
  }

  function updateTrails(timeMs) {

    for (const slot of trailSlots) {

      while (
        slot.points.length > 0 &&
        timeMs - slot.points[0].t > TRAIL.lifeMs
      ) {
        slot.points.shift();
      }

      if (slot.points.length < 2) {

        slot.mesh.visible = false;
        slot.geometry.setDrawRange(0, 0);

        if (slot.points.length === 0) slot.key = null;

        continue;
      }

      const dense = densify(slot.points);
      const n = dense.length;

      for (let i = 0; i < n; i++) {

        const p = dense[i];
        const prev = dense[Math.max(i - 1, 0)];
        const next = dense[Math.min(i + 1, n - 1)];

        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;

        const nx = -dy / len;
        const ny = dx / len;

        const u = i / (n - 1);
        const life01 = Math.min(Math.max(1 - (timeMs - p.t) / TRAIL.lifeMs, 0), 1);

        const w =
          TRAIL.width *
          (0.15 + 0.85 * Math.pow(u, 0.6)) *
          (0.4 + 0.6 * life01);

        const j = i * 6;

        slot.posArray[j] = p.x - nx * w;
        slot.posArray[j + 1] = p.y - ny * w;
        slot.posArray[j + 2] = p.z;
        slot.posArray[j + 3] = p.x + nx * w;
        slot.posArray[j + 4] = p.y + ny * w;
        slot.posArray[j + 5] = p.z;

        const alpha = life01 * (0.25 + 0.75 * u);

        slot.alphaArray[i * 2] = alpha;
        slot.alphaArray[i * 2 + 1] = alpha;
        slot.headArray[i * 2] = u;
        slot.headArray[i * 2 + 1] = u;
      }

      slot.geometry.attributes.position.needsUpdate = true;
      slot.geometry.attributes.aAlpha.needsUpdate = true;
      slot.geometry.attributes.aHead.needsUpdate = true;
      slot.geometry.setDrawRange(0, (n - 1) * 6);

      slot.mesh.visible = true;
    }
  }

  // ---------------- sling-ring portal ----------------

  const PORTAL_VERTEX = /* glsl */ `
    varying vec2 vP;

    void main() {
      vP = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const PORTAL_FRAGMENT = /* glsl */ `
    uniform float uTime;
    uniform float uOpen;
    uniform float uFade;
    uniform float uDir;

    varying vec2 vP;

    float glow(float d, float w) {
      float x = abs(d);
      return exp(-x / w) + 0.14 * exp(-x / (w * 7.0));
    }

    float polyD(vec2 p, float n, float R) {
      float a = atan(p.y, p.x);
      float s = 6.28318 / n;
      float k = floor(0.5 + a / s) * s;
      return cos(k - a) * length(p) - R * cos(3.14159 / n);
    }

    mat2 rot(float a) {
      float c = cos(a);
      float s = sin(a);
      return mat2(c, -s, s, c);
    }

    void main() {

      vec2 p = vP;
      float r = length(p);
      float ang = atan(p.y, p.x);
      float t = uTime;
      float turn = ang / 6.28318;

      // outer double ring
      float ring1 = glow(r - 0.90, 0.010) * 1.25;
      float ring2 = glow(r - 0.835, 0.005) * 0.75;

      // dashed ring, rotating
      float dashes = step(0.5, fract((turn + t * 0.05 * uDir) * 48.0));
      float ring3 = glow(r - 0.745, 0.006) * (0.30 + 0.70 * dashes);

      // rune ticks in a band, counter-rotating
      float tickPhase = fract((turn - t * 0.08 * uDir) * 18.0);
      float tick = step(0.60, tickPhase) * (1.0 - step(0.82, tickPhase));
      float band = smoothstep(0.575, 0.60, r) * (1.0 - smoothstep(0.67, 0.695, r));
      float runes = tick * band * 0.7;

      // counter-rotating hexagon and triangle (mandala geometry)
      vec2 q1 = rot(t * 0.35 * uDir) * p;
      vec2 q2 = rot(-t * 0.28 * uDir + 0.5236) * p;

      float poly1 = glow(polyD(q1, 6.0, 0.56), 0.007) * 0.9;
      float poly2 = glow(polyD(q2, 3.0, 0.50), 0.007) * 0.8;

      // inner rings
      float inner = glow(r - 0.30, 0.007) * 0.8 + glow(r - 0.215, 0.005) * 0.6;

      float v = ring1 + ring2 + ring3 + runes + poly1 + poly2 + inner;

      // soft swirling energy inside the disc
      float disc =
        smoothstep(0.93, 0.0, r) * 0.10 *
        (0.6 + 0.4 * sin(ang * 6.0 + t * 2.0 * uDir + r * 8.0));

      // the pattern is drawn outward from the centre when opening
      float mask = 1.0 - smoothstep(uOpen * 1.05 - 0.12, uOpen * 1.05, r);
      v *= mask;

      vec3 col = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.88, 0.55), clamp(v * 0.5, 0.0, 1.0));

      float a = clamp(v + disc * mask, 0.0, 1.0) * uFade;

      if (a < 0.003) discard;

      gl_FragColor = vec4(col, a);
    }
  `;

  const portalGeometry = new THREE.PlaneGeometry(2, 2);
  const portals = [];

  for (let i = 0; i < 2; i++) {

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uFade: { value: 0 },
        uDir: { value: 1 }
      },
      vertexShader: PORTAL_VERTEX,
      fragmentShader: PORTAL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(portalGeometry, material);

    mesh.visible = false;
    mesh.renderOrder = 7;
    mesh.frustumCulled = false;

    scene.add(mesh);

    portals.push({
      mesh,
      material,
      active: false,
      age: 0,
      life: 5.5,
      x: 0,
      y: 0,
      radius: 100,
      dir: 1,
      fade: 0,
      open: 0,
      sparkAcc: 0
    });
  }

  function openPortal(centre, radius, direction = 1, life = 5.5) {

    const portal =
      portals.find((p) => !p.active) ||
      portals.reduce((a, b) => (a.age > b.age ? a : b));

    portal.active = true;
    portal.age = 0;
    portal.life = life;
    portal.x = centre.x;
    portal.y = centre.y;
    portal.radius = radius;
    portal.dir = direction >= 0 ? 1 : -1;
    portal.sparkAcc = 0;

    portal.mesh.position.set(centre.x, centre.y, 20);
    portal.material.uniforms.uDir.value = portal.dir;

    // Opening burst of sparks along the rim
    const pos = new THREE.Vector3(centre.x, centre.y, 20);

    for (let i = 0; i < 220; i++) {

      const a = Math.random() * Math.PI * 2;
      const cx = Math.cos(a);
      const sy = Math.sin(a);

      const speed = rand(150, 520);

      spawn(
        nextIndex(), 1,
        pos.x + cx * radius, pos.y + sy * radius, pos.z,
        cx * speed * 0.7 - sy * speed * 0.45 * portal.dir,
        sy * speed * 0.7 + cx * speed * 0.45 * portal.dir,
        rand(-30, 30),
        pick(cfg.sparkSize) * 1.15, 0.4,
        rand(0.8, 1.7),
        1.6, 8, 70
      );
    }

    ring(pos, radius * 1.35, 0.7);
  }

  function updatePortals(dt) {

    for (const p of portals) {

      if (!p.active) continue;

      p.age += dt;

      if (p.age >= p.life) {
        p.active = false;
        p.fade = 0;
        p.mesh.visible = false;
        continue;
      }

      const openT = Math.min(p.age / 0.55, 1);

      // ease-out-back: a little overshoot, like the portal snapping open
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(openT - 1, 3) + c1 * Math.pow(openT - 1, 2);

      p.open = Math.min(openT * 1.0, 1);

      const fadeIn = Math.min(p.age / 0.15, 1);
      const fadeOut = Math.min((p.life - p.age) / 0.6, 1);

      p.fade = Math.min(fadeIn, fadeOut);

      p.material.uniforms.uTime.value = clock;
      p.material.uniforms.uOpen.value = p.open;
      p.material.uniforms.uFade.value = p.fade;

      p.mesh.scale.setScalar(p.radius * 1.15 * (0.8 + 0.2 * eased));
      p.mesh.visible = true;

      // Sparks keep flying off the rim
      p.sparkAcc += 120 * p.fade * dt;

      while (p.sparkAcc >= 1) {

        p.sparkAcc -= 1;

        const a = Math.random() * Math.PI * 2;
        const cx = Math.cos(a);
        const sy = Math.sin(a);

        const speed = rand(90, 260);

        spawn(
          nextIndex(), 1,
          p.x + cx * p.radius * 0.97, p.y + sy * p.radius * 0.97, 20,
          -sy * speed * 0.7 * p.dir + cx * speed * 0.5,
          cx * speed * 0.7 * p.dir + sy * speed * 0.5,
          rand(-25, 25),
          pick(cfg.sparkSize), 0.4,
          pick(cfg.sparkLife),
          1.5, 10, 75
        );
      }
    }
  }

  function getPortals() {
    return portals.filter((p) => p.active);
  }


  // ---------------- dual-hand mandala shield ----------------
  // One hand holds an open palm, the other draws the circle: the mandala
  // (nested spiralling squares, rings and runes) forms in front of the palm.

  const MANDALA_FRAGMENT = /* glsl */ `
    uniform float uTime;
    uniform float uOpen;
    uniform float uFade;
    uniform float uDir;

    varying vec2 vP;

    float glow(float d, float w) {
      float x = abs(d);
      return exp(-x / w) + 0.12 * exp(-x / (w * 8.0));
    }

    float polyD(vec2 p, float n, float R) {
      float a = atan(p.y, p.x);
      float s = 6.28318 / n;
      float k = floor(0.5 + a / s) * s;
      return cos(k - a) * length(p) - R * cos(3.14159 / n);
    }

    mat2 rot(float a) {
      float c = cos(a);
      float s = sin(a);
      return mat2(c, -s, s, c);
    }

    void main() {

      vec2 p = vP;
      float r = length(p);
      float turn = atan(p.y, p.x) / 6.28318;
      float t = uTime;

      float v = 0.0;

      // nested rotated squares: each one turns a little further, each one
      // unfolds in sequence when the mandala opens
      for (int i = 0; i < 14; i++) {

        float fi = float(i);

        float appear = smoothstep(fi * 0.045, fi * 0.045 + 0.25, uOpen);

        float a =
          fi * 0.105 +
          t * 0.12 * uDir * (1.0 + fi * 0.03) +
          (1.0 - appear) * 2.2 * uDir;

        vec2 q = rot(a) * p;

        float R = (0.93 - fi * 0.052) * (0.6 + 0.4 * appear);

        v += glow(polyD(q, 4.0, R), 0.0045) *
             (0.55 + 0.45 * (1.0 - fi / 14.0)) * appear;
      }

      // concentric rings
      v += glow(r - 0.94, 0.008) * 1.3;
      v += glow(r - 0.885, 0.004) * 0.8;
      v += glow(r - 0.66, 0.004) * 0.55;
      v += glow(r - 0.30, 0.004) * 0.5;

      // fine tick ring
      float tickPhase = fract((turn - t * 0.04 * uDir) * 60.0);
      float ticks = step(0.55, tickPhase) *
        smoothstep(0.895, 0.905, r) * (1.0 - smoothstep(0.925, 0.935, r));
      v += ticks * 0.6;

      // ring of dots
      float dotPhase = fract((turn + t * 0.03 * uDir) * 24.0);
      float dotDist = length(vec2((dotPhase - 0.5) * 0.26, r - 0.77));
      v += smoothstep(0.022, 0.0, dotDist) * 1.3;

      // pattern is drawn outward from the centre
      float mask = 1.0 - smoothstep(uOpen * 1.08 - 0.10, uOpen * 1.08, r);
      v *= mask;

      float disc = smoothstep(0.95, 0.0, r) * 0.06;

      vec3 col = mix(
        vec3(1.0, 0.42, 0.06),
        vec3(1.0, 0.86, 0.50),
        clamp(v * 0.4, 0.0, 1.0)
      );

      float a = clamp(v * 0.55 + disc * mask, 0.0, 1.0) * uFade;

      if (a < 0.003) discard;

      gl_FragColor = vec4(col, a);
    }
  `;

  const mandalas = [];

  for (let i = 0; i < 2; i++) {

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uFade: { value: 0 },
        uDir: { value: 1 }
      },
      vertexShader: PORTAL_VERTEX,
      fragmentShader: MANDALA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(portalGeometry, material);

    mesh.visible = false;
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;

    scene.add(mesh);

    mandalas.push({
      mesh,
      material,
      key: null,
      active: false,
      closing: false,
      closeT: 0,
      age: 0,
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      radius: 150,
      dir: 1,
      fade: 0,
      open: 0,
      sparkAcc: 0
    });
  }

  function rimSparks(m, count, speedLow, speedHigh, life) {

    for (let i = 0; i < count; i++) {

      const a = Math.random() * Math.PI * 2;
      const cx = Math.cos(a);
      const sy = Math.sin(a);

      const speed = rand(speedLow, speedHigh);

      spawn(
        nextIndex(), 1,
        m.x + cx * m.radius * 0.97, m.y + sy * m.radius * 0.97, 15,
        cx * speed * 0.7 - sy * speed * 0.45 * m.dir,
        sy * speed * 0.7 + cx * speed * 0.45 * m.dir,
        rand(-30, 30),
        pick(cfg.sparkSize) * 1.1, 0.4,
        rand(life[0], life[1]),
        1.6, 8, 70
      );
    }
  }

  function openMandala(key, centre, radius, direction = 1) {

    const m =
      mandalas.find((x) => x.active && x.key === key) ||
      mandalas.find((x) => !x.active) ||
      mandalas.reduce((a, b) => (a.age > b.age ? a : b));

    m.key = key;
    m.active = true;
    m.closing = false;
    m.closeT = 0;
    m.age = 0;
    m.x = m.tx = centre.x;
    m.y = m.ty = centre.y;
    m.radius = radius;
    m.dir = direction >= 0 ? 1 : -1;
    m.sparkAcc = 0;

    m.material.uniforms.uDir.value = m.dir;

    rimSparks(m, 260, 150, 540, [0.8, 1.8]);

    ring({ x: m.x, y: m.y, z: 15 }, radius * 1.3, 0.7);
  }

  function moveMandala(key, centre) {

    const m = mandalas.find((x) => x.active && x.key === key);

    if (m) {
      m.tx = centre.x;
      m.ty = centre.y;
    }
  }

  function closeMandala(key) {

    const m = mandalas.find((x) => x.active && x.key === key);

    if (m && !m.closing) {
      m.closing = true;
      m.closeT = 0;
      rimSparks(m, 140, 120, 420, [0.6, 1.3]);
    }
  }

  function updateMandalas(dt) {

    for (const m of mandalas) {

      if (!m.active) continue;

      m.age += dt;

      // Follow the palm smoothly
      const follow = 1 - Math.exp(-14 * dt);

      m.x += (m.tx - m.x) * follow;
      m.y += (m.ty - m.y) * follow;

      if (m.closing) {

        m.closeT += dt;

        if (m.closeT >= 0.55) {
          m.active = false;
          m.fade = 0;
          m.mesh.visible = false;
          continue;
        }

        m.fade = 1 - m.closeT / 0.55;

      } else {

        m.fade = Math.min(m.age / 0.2, 1);
      }

      const openT = Math.min(m.age / 0.85, 1);

      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(openT - 1, 3) + c1 * Math.pow(openT - 1, 2);

      m.open = openT;

      m.material.uniforms.uTime.value = clock;
      m.material.uniforms.uOpen.value = openT;
      m.material.uniforms.uFade.value = m.fade;

      m.mesh.position.set(m.x, m.y, 15);
      m.mesh.scale.setScalar(m.radius * 1.12 * (0.88 + 0.12 * eased));
      m.mesh.visible = true;

      m.sparkAcc += 90 * m.fade * dt;

      const whole = Math.floor(m.sparkAcc);

      if (whole > 0) {
        m.sparkAcc -= whole;
        rimSparks(m, whole, 90, 250, cfg.sparkLife);
      }
    }
  }

  function getMandalas() {
    return mandalas.filter((m) => m.active && !m.closing);
  }

  // ---------------- fan of rays from the casting fingertip to the mandala ----------------

  const BEAM_COUNT = 14;

  const BEAM_VERTEX = /* glsl */ `
    attribute float aAlong;
    attribute float aSeed;

    varying float vAlong;
    varying float vSeed;

    void main() {
      vAlong = aAlong;
      vSeed = aSeed;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const BEAM_FRAGMENT = /* glsl */ `
    uniform float uTime;
    uniform float uPower;

    varying float vAlong;
    varying float vSeed;

    void main() {
      float flicker = 0.55 + 0.45 * sin(uTime * 26.0 + vSeed * 40.0);
      float a = mix(1.0, 0.18, pow(vAlong, 0.7)) * flicker * uPower * 0.85;
      vec3 col = mix(vec3(1.0, 0.92, 0.65), vec3(1.0, 0.45, 0.08), vAlong);
      if (a < 0.003) discard;
      gl_FragColor = vec4(col, a);
    }
  `;

  const beamPositions = new Float32Array(BEAM_COUNT * 4 * 3);
  const beamAlong = new Float32Array(BEAM_COUNT * 4);
  const beamSeed = new Float32Array(BEAM_COUNT * 4);
  const beamIndices = new Uint16Array(BEAM_COUNT * 6);

  for (let k = 0; k < BEAM_COUNT; k++) {

    const base = k * 4;

    beamAlong.set([0, 0, 1, 1], base);
    beamSeed.fill(k / BEAM_COUNT, base, base + 4);
    beamIndices.set([base, base + 1, base + 2, base + 1, base + 3, base + 2], k * 6);
  }

  const beamGeometry = new THREE.BufferGeometry();

  const beamPosAttr = new THREE.BufferAttribute(beamPositions, 3);

  beamPosAttr.setUsage(THREE.DynamicDrawUsage);

  beamGeometry.setAttribute('position', beamPosAttr);
  beamGeometry.setAttribute('aAlong', new THREE.BufferAttribute(beamAlong, 1));
  beamGeometry.setAttribute('aSeed', new THREE.BufferAttribute(beamSeed, 1));
  beamGeometry.setIndex(new THREE.BufferAttribute(beamIndices, 1));

  const beamUniforms = {
    uTime: { value: 0 },
    uPower: { value: 0 }
  };

  const beamMesh = new THREE.Mesh(
    beamGeometry,
    new THREE.ShaderMaterial({
      uniforms: beamUniforms,
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );

  beamMesh.frustumCulled = false;
  beamMesh.renderOrder = 8;
  beamMesh.visible = false;

  scene.add(beamMesh);

  const beamState = { key: null, power: 0, target: 0, tip: new THREE.Vector3() };

  /** tip = fingertip world position, or null to fade the rays out */
  function setBeams(key, tip) {

    if (tip) {
      beamState.key = key;
      beamState.tip.copy(tip);
      beamState.target = 1;
    } else if (beamState.key === key) {
      beamState.target = 0;
    }
  }

  function updateBeams(dt) {

    beamState.power +=
      (beamState.target - beamState.power) * (1 - Math.exp(-12 * dt));

    const m = mandalas.find(
      (x) => x.active && !x.closing && x.key === beamState.key
    );

    if (!m || beamState.power < 0.02) {
      beamMesh.visible = false;
      return;
    }

    const tip = beamState.tip;

    const facing = Math.atan2(tip.y - m.y, tip.x - m.x);
    const spread = 0.9;

    for (let k = 0; k < BEAM_COUNT; k++) {

      const u = k / (BEAM_COUNT - 1);

      const angle =
        facing +
        spread * (2 * u - 1) +
        Math.sin(clock * 2.0 + k * 1.7) * 0.05;

      const ex = m.x + Math.cos(angle) * m.radius * 0.98;
      const ey = m.y + Math.sin(angle) * m.radius * 0.98;

      const dx = ex - tip.x;
      const dy = ey - tip.y;
      const len = Math.hypot(dx, dy) || 1;

      const nx = -dy / len;
      const ny = dx / len;

      const w0 = 2.4 * beamState.power;
      const w1 = 0.9 * beamState.power;

      const j = k * 12;
      const z = 45;

      beamPositions[j] = tip.x - nx * w0;
      beamPositions[j + 1] = tip.y - ny * w0;
      beamPositions[j + 2] = z;
      beamPositions[j + 3] = tip.x + nx * w0;
      beamPositions[j + 4] = tip.y + ny * w0;
      beamPositions[j + 5] = z;
      beamPositions[j + 6] = ex - nx * w1;
      beamPositions[j + 7] = ey - ny * w1;
      beamPositions[j + 8] = z;
      beamPositions[j + 9] = ex + nx * w1;
      beamPositions[j + 10] = ey + ny * w1;
      beamPositions[j + 11] = z;
    }

    beamPosAttr.needsUpdate = true;

    beamUniforms.uTime.value = clock;
    beamUniforms.uPower.value = beamState.power;

    beamMesh.visible = true;
  }

  function updateExtras(dt, timeMs) {
    updateTrails(timeMs);
    updatePortals(dt);
    updateMandalas(dt);
    updateBeams(dt);
  }

  function disposeExtras() {

    for (const slot of trailSlots) {
      scene.remove(slot.mesh);
      slot.geometry.dispose();
      slot.mesh.material.dispose();
    }

    for (const p of portals) {
      scene.remove(p.mesh);
      p.material.dispose();
    }

    for (const m of mandalas) {
      scene.remove(m.mesh);
      m.material.dispose();
    }

    scene.remove(beamMesh);
    beamGeometry.dispose();
    beamMesh.material.dispose();

    portalGeometry.dispose();
    trailAccumulator.clear();
  }

  // Must be called with the drawing-buffer height in pixels and the camera fov
  function setViewport(heightPx, fovDegrees) {

    uniforms.uScale.value =
      (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  }

  function dispose() {

    scene.remove(points);

    geometry.dispose();
    material.dispose();

    for (const r of rings) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
    }

    ringGeometry.dispose();
    accumulator.clear();
    disposeExtras();
  }

  return {
    flame,
    sparks,
    burst,
    ring,
    sparkTrail,
    trailPoint,
    openPortal,
    getPortals,
    openMandala,
    moveMandala,
    closeMandala,
    getMandalas,
    setBeams,
    update,
    setViewport,
    dispose
  };
}