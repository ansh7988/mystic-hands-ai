import * as THREE from 'three';

// ================================================
// MYSTIC HANDS AI - THANOS SNAP
//
// On a snap, the person in front of the camera crumbles to dust and
// disappears, and the floating objects turn to dust too. A second snap
// brings everything back.
//
//   1. MediaPipe ImageSegmenter finds the person (a mask, ~256 px wide).
//   2. The video is re-drawn by a shader on a full-screen quad inside the
//      3D scene. Where the person has "dissolved" it shows the background:
//        - a learned background plate (pixels seen while you were not there),
//        - or, for never-seen pixels, a smear of the nearest background.
//   3. A sweep (left -> right, with noise) decides WHEN each pixel dissolves.
//      Pixels crossing the sweep spawn dust particles with the colour of the
//      pixel they came from, blown away by a wind.
//
// Without the segmentation model file the person effect is skipped, but the
// sweep still runs, so the floating objects still turn to dust.
// ================================================

export const THANOS_CONFIG = {

  gridWidth: 256,            // mask / sweep grid (height follows the video aspect)
  plateScale: 2,             // background plate = grid x this

  dissolveMs: 5200,          // time for the sweep to cross the whole frame
  maxProgress: 1.1,          // sweep position that means "everything is gone"
  holdMs: 9000,              // how long you stay invisible
  autoRestore: true,         // false = stay invisible until the next snap
  restoreMs: 2400,

  idleSegmentMs: 450,        // background learning rate while idle
  holdSegmentMs: 66,         // mask refresh while invisible
  learnBackground: true,

  dustMax: 24000,
  dustPerCell: 1.6,          // particles per dissolved cell

  invertMask: null,          // null = detect automatically, true / false = force

  // Dust is blown toward the RIGHT of the (mirrored) screen = world -x
  wind: [-1, 0.35]
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function hash2(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise2(x, y) {

  const ix = Math.floor(x);
  const iy = Math.floor(y);

  let fx = x - ix;
  let fy = y - iy;

  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);

  const l = (a, b, t) => a + (b - a) * t;

  return l(
    l(hash2(ix, iy), hash2(ix + 1, iy), fx),
    l(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx),
    fy
  );
}

const easeInOut = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// ------------------------------------------------
// Shaders
// ------------------------------------------------

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const QUAD_FRAGMENT = /* glsl */ `
  uniform sampler2D uVideo;
  uniform sampler2D uMask;
  uniform sampler2D uDissolve;
  uniform sampler2D uPlate;

  uniform float uProgress;
  uniform float uTime;
  uniform vec2 uTexel;

  varying vec2 vUv;

  float h21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float n2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
      mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // soft person mask, grown by ~1.5 texels so no fringe is left behind
  float personAt(vec2 g) {
    float m = texture2D(uMask, g).r;
    m = max(m, texture2D(uMask, g + vec2(uTexel.x * 1.5, 0.0)).r);
    m = max(m, texture2D(uMask, g - vec2(uTexel.x * 1.5, 0.0)).r);
    m = max(m, texture2D(uMask, g + vec2(0.0, uTexel.y * 1.5)).r);
    m = max(m, texture2D(uMask, g - vec2(0.0, uTexel.y * 1.5)).r);
    return smoothstep(0.25, 0.55, m);
  }

  // Fill a hole with the nearest background found left / right of it
  vec3 smearFill(vec2 g) {

    vec3 acc = vec3(0.0);
    float w = 0.0;

    for (int dir = 0; dir < 2; dir++) {

      float sgn = dir == 0 ? -1.0 : 1.0;

      for (int i = 1; i <= 40; i++) {

        vec2 q = g + vec2(sgn * float(i) * 0.012, 0.0);

        if (q.x < 0.0 || q.x > 1.0) break;

        if (texture2D(uMask, q).r < 0.1) {

          vec3 c = texture2D(uVideo, vec2(q.x, 1.0 - q.y)).rgb;
          float wt = 1.0 / float(i);

          acc += c * wt;
          w += wt;

          break;
        }
      }
    }

    return w > 0.0 ? acc / w : vec3(0.10);
  }

  void main() {

    // mask-space coordinates are top-down, video uv is bottom-up
    vec2 g = vec2(vUv.x, 1.0 - vUv.y);

    vec3 live = texture2D(uVideo, vUv).rgb;

    float person = personAt(g);
    float d = texture2D(uDissolve, g).r;

    float edge = uProgress - d;

    float gone = smoothstep(0.0, 0.03, edge);
    float rim = smoothstep(-0.02, 0.0, edge) * (1.0 - smoothstep(0.0, 0.06, edge));

    float removed = person * gone;

    vec3 col = live;

    if (removed > 0.01) {

      vec4 pl = texture2D(uPlate, g);
      vec3 fill = mix(smearFill(g), pl.rgb, pl.a);

      col = mix(live, fill, removed);
    }

    // crumbling edge: ash with a few glowing embers
    float n = n2(vUv * vec2(260.0, 150.0) + uTime * 3.0);
    float crumble = rim * person * smoothstep(0.30, 0.62, n);

    vec3 ash = vec3(0.08, 0.07, 0.065) +
               vec3(1.0, 0.42, 0.08) * smoothstep(0.80, 1.0, n) * 1.2;

    col = mix(col, ash, crumble);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAge;
  attribute float aSize;
  attribute float aKind;

  uniform float uScale;

  varying vec3 vColor;
  varying float vAge;
  varying float vKind;

  void main() {
    vColor = aColor;
    vAge = aAge;
    vKind = aKind;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;

    float s = aAge >= 1.0 ? 0.0 : aSize;
    gl_PointSize = clamp(s * uScale / max(-mv.z, 1.0), 0.0, 64.0);
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAge;
  varying float vKind;

  void main() {

    if (vAge >= 1.0) discard;

    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);

    if (r > 1.0) discard;

    float soft = 1.0 - r;
    float fade = (1.0 - vAge);
    fade *= fade;

    // dust drifts from its original colour toward grey ash
    vec3 col = mix(vColor, vec3(0.42, 0.40, 0.38), smoothstep(0.1, 0.8, vAge) * 0.75);
    float a = soft * fade;

    if (vKind > 0.5) {
      col = mix(vec3(1.0, 0.62, 0.15), vec3(0.8, 0.2, 0.05), vAge);
      a = soft * soft * fade * 1.2;
    }

    gl_FragColor = vec4(col, a);
  }
`;

// ================================================

export function createThanosSnap({
  scene,
  video,
  width,
  height,
  visibleWidth,
  visibleHeight,
  config = {}
}) {

  const cfg = { ...THANOS_CONFIG, ...config };

  const GW = cfg.gridWidth;
  const GH = Math.max(8, Math.round(GW * height / width));
  const PW = GW * cfg.plateScale;
  const PH = GH * cfg.plateScale;
  const CELLS = GW * GH;

  let segmenter = null;
  let segmenterFailures = 0;

  // ---------------- grids ----------------

  const mask = new Uint8Array(CELLS);          // 0..255 person
  const maskF = new Float32Array(CELLS);       // smoothed
  const maskDil = new Uint8Array(CELLS);       // dilated (background learning)
  const dissolveF = new Float32Array(CELLS);   // 0..1 sweep time per cell
  const dissolveU8 = new Uint8Array(CELLS);
  const plate = new Uint8Array(PW * PH * 4);   // rgb + confidence

  let colors = null;

  function makeDataTexture(data, w, h, format) {

    const texture = new THREE.DataTexture(
      data, w, h, format, THREE.UnsignedByteType
    );

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    return texture;
  }

  const maskTexture = makeDataTexture(mask, GW, GH, THREE.RedFormat);
  const dissolveTexture = makeDataTexture(dissolveU8, GW, GH, THREE.RedFormat);
  const plateTexture = makeDataTexture(plate, PW, PH, THREE.RGBAFormat);

  const videoTexture = new THREE.VideoTexture(video);

  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;

  // ---------------- 2D scratch canvases ----------------

  function makeScratch(w, h) {

    const canvas = document.createElement('canvas');

    canvas.width = w;
    canvas.height = h;

    return {
      canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true })
    };
  }

  const colorScratch = makeScratch(GW, GH);
  const plateScratch = makeScratch(PW, PH);

  // ---------------- composite quad ----------------

  const uniforms = {
    uVideo: { value: videoTexture },
    uMask: { value: maskTexture },
    uDissolve: { value: dissolveTexture },
    uPlate: { value: plateTexture },
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / GW, 1 / GH) }
  };

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(visibleWidth * 1.002, visibleHeight * 1.002),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: QUAD_VERTEX,
      fragmentShader: QUAD_FRAGMENT,
      depthTest: false,
      depthWrite: false
    })
  );

  quad.renderOrder = -10;
  quad.frustumCulled = false;
  quad.visible = false;

  scene.add(quad);

  // ---------------- dust particles ----------------

  const N = cfg.dustMax;

  const dustPos = new Float32Array(N * 3);
  const dustColor = new Float32Array(N * 3);
  const dustAge = new Float32Array(N).fill(1);
  const dustSize = new Float32Array(N);
  const dustKind = new Float32Array(N);

  const dustVel = new Float32Array(N * 3);
  const dustLife = new Float32Array(N).fill(1);
  const dustElapsed = new Float32Array(N).fill(1);
  const dustSize0 = new Float32Array(N);
  const dustDrag = new Float32Array(N);
  const dustAccel = new Float32Array(N);
  const dustSeed = new Float32Array(N);

  const dustGeometry = new THREE.BufferGeometry();

  const dustPosAttr = new THREE.BufferAttribute(dustPos, 3);
  const dustAgeAttr = new THREE.BufferAttribute(dustAge, 1);
  const dustSizeAttr = new THREE.BufferAttribute(dustSize, 1);

  [dustPosAttr, dustAgeAttr, dustSizeAttr].forEach((a) =>
    a.setUsage(THREE.DynamicDrawUsage)
  );

  dustGeometry.setAttribute('position', dustPosAttr);
  dustGeometry.setAttribute('aColor', new THREE.BufferAttribute(dustColor, 3));
  dustGeometry.setAttribute('aAge', dustAgeAttr);
  dustGeometry.setAttribute('aSize', dustSizeAttr);
  dustGeometry.setAttribute('aKind', new THREE.BufferAttribute(dustKind, 1));

  const dustUniforms = { uScale: { value: 800 } };

  const dustPoints = new THREE.Points(
    dustGeometry,
    new THREE.ShaderMaterial({
      uniforms: dustUniforms,
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false
    })
  );

  dustPoints.frustumCulled = false;
  dustPoints.renderOrder = 5;

  scene.add(dustPoints);

  const wind = new THREE.Vector2(cfg.wind[0], cfg.wind[1]).normalize();

  let cursor = 0;

  function spawnDust(x, y, z, r, g, b, kind, speedScale = 1) {

    const i = cursor;
    cursor = (cursor + 1) % N;

    const j = i * 3;

    const speed = rand(50, 280) * speedScale;

    dustPos[j] = x;
    dustPos[j + 1] = y;
    dustPos[j + 2] = z;

    dustVel[j] = wind.x * speed * 0.35 + rand(-35, 35);
    dustVel[j + 1] = wind.y * speed * 0.35 + rand(-20, 55);
    dustVel[j + 2] = rand(-20, 20);

    dustColor[j] = r;
    dustColor[j + 1] = g;
    dustColor[j + 2] = b;

    dustKind[i] = kind;
    dustSeed[i] = Math.random();

    dustSize0[i] = (kind > 0.5 ? rand(1.2, 2.4) : rand(1.4, 3.4));
    dustSize[i] = dustSize0[i];

    dustLife[i] = rand(1.3, 3.4);
    dustElapsed[i] = 0;
    dustAge[i] = 0;

    dustDrag[i] = rand(0.6, 1.4);
    dustAccel[i] = rand(120, 380) * speedScale;
  }

  function updateDust(dt, now) {

    for (let i = 0; i < N; i++) {

      if (dustElapsed[i] >= dustLife[i]) {
        dustAge[i] = 1;
        continue;
      }

      dustElapsed[i] += dt;

      const u = dustElapsed[i] / dustLife[i];

      if (u >= 1) {
        dustAge[i] = 1;
        continue;
      }

      dustAge[i] = u;

      const j = i * 3;

      const damp = Math.exp(-dustDrag[i] * dt);

      // the wind picks up as the dust ages: it is blown away, not just flung
      const acc = dustAccel[i] * (0.35 + u * 1.5);

      dustVel[j] = dustVel[j] * damp + wind.x * acc * dt;
      dustVel[j + 1] = dustVel[j + 1] * damp + wind.y * acc * dt;
      dustVel[j + 2] *= damp;

      const w = now * 0.004 + dustSeed[i] * 20 + dustPos[j + 1] * 0.05;

      dustVel[j] += Math.sin(w) * 30 * dt;
      dustVel[j + 1] += Math.cos(w * 1.3) * 22 * dt;

      dustPos[j] += dustVel[j] * dt;
      dustPos[j + 1] += dustVel[j + 1] * dt;
      dustPos[j + 2] += dustVel[j + 2] * dt;

      dustSize[i] = dustSize0[i] * (1 - 0.5 * u);
    }

    dustPosAttr.needsUpdate = true;
    dustAgeAttr.needsUpdate = true;
    dustSizeAttr.needsUpdate = true;
  }

  // ---------------- coordinate helpers ----------------

  function gridToWorld(gx, gy) {

    const u = (gx + 0.5) / GW;
    const v = (gy + 0.5) / GH;

    return {
      x: (u - 0.5) * visibleWidth,
      y: (0.5 - v) * visibleHeight
    };
  }

  function worldToCell(wx, wy) {

    const u = wx / visibleWidth + 0.5;
    const v = 0.5 - wy / visibleHeight;

    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;

    const gx = Math.min(GW - 1, Math.floor(u * GW));
    const gy = Math.min(GH - 1, Math.floor(v * GH));

    return gy * GW + gx;
  }

  // ---------------- the sweep ----------------

  function buildDissolve() {

    const seedX = Math.random() * 50;
    const seedY = Math.random() * 50;

    for (let gy = 0; gy < GH; gy++) {

      for (let gx = 0; gx < GW; gx++) {

        const u = (gx + 0.5) / GW;
        const v = (gy + 0.5) / GH;

        // screen-space sweep: the view is mirrored, so screen-x = 1 - u.
        // It starts at the bottom-left and moves right and up, with the wind.
        const sweep = (1 - u) * 0.78 + (1 - v) * 0.22;

        const noise =
          valueNoise2(u * 9 + seedX, v * 9 + seedY) * 0.6 +
          valueNoise2(u * 28 + seedY, v * 28 + seedX) * 0.4;

        const d = clamp01((sweep * 0.80 + noise * 0.32) / 1.12);

        const i = gy * GW + gx;

        dissolveF[i] = d;
        dissolveU8[i] = Math.round(d * 255);
      }
    }

    dissolveTexture.needsUpdate = true;
  }

  // ---------------- segmentation ----------------

  let orientation = { votes: 0, coverage: 0, center: 0, border: 0, decided: false, invert: false };

  function decideOrientation() {

    if (cfg.invertMask !== null) {
      orientation.invert = !!cfg.invertMask;
      orientation.decided = true;
      return;
    }

    const o = orientation;
    const coverage = o.coverage / o.votes;
    const center = o.center / o.votes;
    const border = o.border / o.votes;

    // A person rarely fills more than ~70% of the frame, and normally
    // stands in the middle rather than along the edges
    o.invert = coverage > 0.72 || center + 0.15 < border;
    o.decided = true;

    console.info(
      `[thanos] mask orientation: coverage ${coverage.toFixed(2)}, ` +
      `centre ${center.toFixed(2)}, border ${border.toFixed(2)} -> ` +
      `${o.invert ? 'inverted' : 'as is'}`
    );
  }

  function writeMask(src, mw, mh, multiClass) {

    const o = orientation;

    let sum = 0;
    let centerSum = 0;
    let centerCount = 0;
    let borderSum = 0;
    let borderCount = 0;

    for (let gy = 0; gy < GH; gy++) {

      const sy = Math.min(mh - 1, Math.floor(((gy + 0.5) / GH) * mh));
      const row = sy * mw;

      for (let gx = 0; gx < GW; gx++) {

        const sx = Math.min(mw - 1, Math.floor(((gx + 0.5) / GW) * mw));

        let v = src[row + sx];

        if (multiClass) v = 1 - v;   // class 0 is the background

        if (!o.decided) {

          sum += v;

          const fx = gx / GW;
          const fy = gy / GH;

          if (fx > 0.3 && fx < 0.7 && fy > 0.2 && fy < 0.8) {
            centerSum += v;
            centerCount++;
          } else if (fx < 0.1 || fx > 0.9 || fy < 0.08) {
            borderSum += v;
            borderCount++;
          }
        }

        if (o.invert) v = 1 - v;

        const i = gy * GW + gx;

        maskF[i] = maskF[i] * 0.45 + v * 0.55;
        mask[i] = Math.round(clamp01(maskF[i]) * 255);
      }
    }

    if (!o.decided) {

      o.votes++;
      o.coverage += sum / CELLS;
      o.center += centerCount ? centerSum / centerCount : 0;
      o.border += borderCount ? borderSum / borderCount : 0;

      if (o.votes >= 3) decideOrientation();
    }

    maskTexture.needsUpdate = true;
  }

  function dilateMask() {

    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {

        let m = 0;

        for (let oy = -1; oy <= 1; oy++) {

          const y = gy + oy;

          if (y < 0 || y >= GH) continue;

          for (let ox = -1; ox <= 1; ox++) {

            const x = gx + ox;

            if (x < 0 || x >= GW) continue;

            const v = mask[y * GW + x];

            if (v > m) m = v;
          }
        }

        maskDil[gy * GW + gx] = m;
      }
    }
  }

  function runSegmentation(now) {

    let ok = false;

    try {

      segmenter.segmentForVideo(video, now, (result) => {

        const masks = result && result.confidenceMasks;

        if (!masks || masks.length === 0) return;

        const first = masks[0];

        writeMask(
          first.getAsFloat32Array(),
          first.width,
          first.height,
          masks.length > 1
        );

        ok = true;
      });

      segmenterFailures = 0;

    } catch (error) {

      segmenterFailures++;

      if (segmenterFailures >= 3) {
        console.warn('[thanos] segmentation stopped after repeated errors:', error);
        segmenter = null;
        quad.visible = false;
      }
    }

    return ok;
  }

  // ---------------- background plate ----------------

  function updatePlate() {

    dilateMask();

    plateScratch.ctx.drawImage(video, 0, 0, PW, PH);

    const frame = plateScratch.ctx.getImageData(0, 0, PW, PH).data;

    for (let py = 0; py < PH; py++) {

      const gy = py >> 1;

      for (let px = 0; px < PW; px++) {

        const gx = px >> 1;

        if (maskDil[gy * GW + gx] >= 25) continue;   // person (or next to one)

        const j = (py * PW + px) * 4;

        if (plate[j + 3] === 0) {

          plate[j] = frame[j];
          plate[j + 1] = frame[j + 1];
          plate[j + 2] = frame[j + 2];
          plate[j + 3] = 255;

        } else {

          plate[j] += (frame[j] - plate[j]) * 0.5;
          plate[j + 1] += (frame[j + 1] - plate[j + 1]) * 0.5;
          plate[j + 2] += (frame[j + 2] - plate[j + 2]) * 0.5;
        }
      }
    }

    plateTexture.needsUpdate = true;
  }

  function readColors() {

    colorScratch.ctx.drawImage(video, 0, 0, GW, GH);
    colors = colorScratch.ctx.getImageData(0, 0, GW, GH).data;
  }

  // ---------------- state machine ----------------

  let state = 'IDLE';           // IDLE | DISSOLVING | HOLD | RESTORING
  let stateStart = 0;
  let progress = 0;
  let restoreFrom = 0;
  let lastSpawnProgress = 0;
  let lastSegment = -1e9;

  function setState(next, now) {
    state = next;
    stateStart = now;
  }

  function start(now = performance.now()) {

    if (state !== 'IDLE') return;

    buildDissolve();

    progress = 0;
    lastSpawnProgress = 0;

    setState('DISSOLVING', now);

    quad.visible = !!segmenter;
  }

  function restore(now = performance.now()) {

    if (state !== 'DISSOLVING' && state !== 'HOLD') return;

    restoreFrom = progress;
    lastSpawnProgress = progress;

    setState('RESTORING', now);
  }

  /** First snap starts the dust; a snap while invisible brings you back. */
  function toggle(now = performance.now()) {

    if (state === 'IDLE') start(now);
    else if (state === 'HOLD' || state === 'DISSOLVING') restore(now);

    return state;
  }

  function spawnFrontierDust() {

    const lo = Math.min(lastSpawnProgress, progress);
    const hi = Math.max(lastSpawnProgress, progress);

    if (hi - lo < 1e-4) return;

    const restoring = state === 'RESTORING';

    let ready = false;

    for (let i = 0; i < CELLS; i++) {

      if (mask[i] < 110) continue;

      const d = dissolveF[i];

      if (d <= lo || d > hi) continue;

      if (!ready) {
        readColors();
        ready = true;
      }

      const count = restoring
        ? (Math.random() < 0.35 ? 1 : 0)
        : Math.floor(cfg.dustPerCell + Math.random());

      const gx = i % GW;
      const gy = (i / GW) | 0;

      const base = gridToWorld(gx, gy);
      const k = i * 4;

      for (let n = 0; n < count; n++) {

        const cellW = visibleWidth / GW;
        const cellH = visibleHeight / GH;

        const r = colors[k] / 255;
        const g = colors[k + 1] / 255;
        const b = colors[k + 2] / 255;

        if (restoring) {

          // golden sparkle where the person is coming back
          spawnDust(
            base.x + rand(-cellW, cellW), base.y + rand(-cellH, cellH), rand(-15, 15),
            1, 0.7, 0.25, 1, 0.5
          );

        } else {

          const ember = Math.random() < 0.05;

          spawnDust(
            base.x + rand(-cellW * 0.5, cellW * 0.5),
            base.y + rand(-cellH * 0.5, cellH * 0.5),
            rand(-18, 18),
            ember ? 1 : r, ember ? 0.6 : g, ember ? 0.15 : b,
            ember ? 1 : 0
          );
        }
      }
    }
  }

  /**
   * Called once per camera frame (from telekinesis.update).
   */
  function processFrame(now) {

    if (segmenter) {

      let interval = null;

      if (state === 'DISSOLVING' || state === 'RESTORING') interval = 0;
      else if (state === 'HOLD') interval = cfg.holdSegmentMs;
      else if (cfg.learnBackground) interval = cfg.idleSegmentMs;

      if (interval !== null && now - lastSegment >= interval) {

        lastSegment = now;

        const ok = runSegmentation(now);

        if (ok && state === 'IDLE') updatePlate();
      }
    }

    if (state === 'DISSOLVING' || state === 'RESTORING') {

      if (segmenter) spawnFrontierDust();

      lastSpawnProgress = progress;
    }
  }

  /**
   * Called once per rendered frame.
   */
  function update(dt, now) {

    switch (state) {

      case 'DISSOLVING': {

        const t = (now - stateStart) / cfg.dissolveMs;

        progress = Math.min(cfg.maxProgress, easeInOut(Math.min(t, 1)) * cfg.maxProgress);

        if (t >= 1) setState('HOLD', now);

        break;
      }

      case 'HOLD':

        progress = cfg.maxProgress;

        if (cfg.autoRestore && now - stateStart > cfg.holdMs) restore(now);

        break;

      case 'RESTORING': {

        const t = (now - stateStart) / cfg.restoreMs;

        progress = restoreFrom * (1 - easeInOut(Math.min(t, 1)));

        if (t >= 1) {
          progress = 0;
          setState('IDLE', now);
          quad.visible = false;
        }

        break;
      }

      default:
        break;
    }

    uniforms.uProgress.value = progress;
    uniforms.uTime.value = now * 0.001;

    updateDust(dt, now);
  }

  // ---------------- API used by the 3D scene ----------------

  /** Sweep value at a world position (0 = first to go), or 1 outside the frame. */
  function dissolveAtWorld(wx, wy) {

    const i = worldToCell(wx, wy);

    return i < 0 ? 1 : dissolveF[i];
  }

  /** Dust for something that is not the person (e.g. a floating rock). */
  function emitDust(position, count, radius, rgb) {

    for (let n = 0; n < count; n++) {

      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;

      const ember = Math.random() < 0.12;

      spawnDust(
        position.x + Math.cos(a) * r,
        position.y + Math.sin(a) * r,
        position.z + rand(-12, 12),
        ember ? 1 : rgb[0] * rand(0.8, 1.1),
        ember ? 0.6 : rgb[1] * rand(0.8, 1.1),
        ember ? 0.15 : rgb[2] * rand(0.8, 1.1),
        ember ? 1 : 0,
        1.1
      );
    }
  }

  function attachSegmenter(instance) {
    segmenter = instance || null;
    segmenterFailures = 0;
  }

  function setViewport(heightPx, fovDegrees) {

    dustUniforms.uScale.value =
      (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  }

  function setInvertMask(value) {
    cfg.invertMask = value;
    orientation = { votes: 0, coverage: 0, center: 0, border: 0, decided: false, invert: false };
  }

  function dispose() {

    scene.remove(quad);
    scene.remove(dustPoints);

    quad.geometry.dispose();
    quad.material.dispose();

    dustGeometry.dispose();
    dustPoints.material.dispose();

    maskTexture.dispose();
    dissolveTexture.dispose();
    plateTexture.dispose();
    videoTexture.dispose();

    segmenter = null;
  }

  return {
    attachSegmenter,
    hasSegmenter: () => !!segmenter,
    processFrame,
    update,
    toggle,
    start,
    restore,
    getState: () => state,
    getProgress: () => progress,
    dissolveAtWorld,
    emitDust,
    setViewport,
    setInvertMask,
    dispose
  };
}