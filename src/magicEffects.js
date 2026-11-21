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
  }

  return {
    flame,
    sparks,
    burst,
    ring,
    update,
    setViewport,
    dispose
  };
}