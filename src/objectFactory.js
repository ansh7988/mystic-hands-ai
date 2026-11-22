import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ================================================
// MYSTIC HANDS AI - OBJECT FACTORY (Milestone 3)
//
// Everything is generated in code, so there are no model or texture
// files to load or license.
//
//  ROCKS    fractured geometry (planar cleaves + noise, no mesh tearing),
//           dark PBR shading with per-pixel bump, glowing lava cracks
//           from 3D cellular noise, orbiting debris fragments.
//  CRYSTALS faceted hexagonal shards radiating from a glowing hub,
//           metallic amber glass reflecting a warm studio environment,
//           fresnel rim light.
//  CORES    plasma sphere + electric energy shell (both shaders),
//           partial rotating arcs and orbiting fragments.
//
// Every visual exposes update(dt, time, heat). heat (0..1) is driven by
// the hand: charging, holding, explosions.
// ================================================

// ------------------------------------------------
// JS noise (used for geometry)
// ------------------------------------------------

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, z) {

  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;

  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);

  const l = (a, b, t) => a + (b - a) * t;

  return l(
    l(
      l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx),
      l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx),
      fy
    ),
    l(
      l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx),
      l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx),
      fy
    ),
    fz
  );
}

function fbm3(x, y, z) {

  let v = 0;
  let a = 0.5;

  for (let i = 0; i < 4; i++) {
    v += a * vnoise(x, y, z);
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    a *= 0.5;
  }

  return v;
}

function randomUnit() {

  const v = new THREE.Vector3(
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1
  );

  if (v.lengthSq() < 1e-4) v.set(0, 1, 0);

  return v.normalize();
}

const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------
// GLSL noise shared by rock / core shaders
// (prefixed mh_ so nothing collides with three.js chunks)
// ------------------------------------------------

const GLSL_NOISE = /* glsl */ `
  float mh_hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 mh_hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
  }

  float mh_noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = mh_hash13(i);
    float n100 = mh_hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = mh_hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = mh_hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = mh_hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = mh_hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = mh_hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = mh_hash13(i + vec3(1.0, 1.0, 1.0));

    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  float mh_fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 4; k++) {
      v += a * mh_noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
`;

const GLSL_WORLEY = /* glsl */ `
  // distance to nearest (x) and second nearest (y) feature point
  vec2 mh_worley(vec3 p) {
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;

    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = mh_hash33(ip + g);
          vec3 r = g + o - fp;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; }
          else if (d < d2) { d2 = d; }
        }
      }
    }

    return sqrt(vec2(d1, d2));
  }
`;

// ------------------------------------------------
// Studio environment for reflections (no HDR file needed)
// ------------------------------------------------

function buildEnvironment(renderer) {

  const envScene = new THREE.Scene();

  envScene.add(new THREE.Mesh(
    new THREE.BoxGeometry(12, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x07050a, side: THREE.BackSide })
  ));

  function panel(w, h, color, intensity, x, y, z) {

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide
      })
    );

    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);

    envScene.add(mesh);
  }

  panel(4.0, 2.5, 0xff8a2a, 9, -3.5, 3.0, 2.5);   // warm key
  panel(2.5, 2.5, 0xffc070, 6, 3.5, 1.5, 3.0);    // gold fill
  panel(6.0, 1.2, 0xff5a10, 5, 0, -4.0, 0);       // lava glow from below
  panel(2.0, 4.0, 0x5a86ff, 2.2, 4.0, 0, -2.0);   // cool rim
  panel(3.0, 1.5, 0xffe2b0, 5, 0, 4.5, -1.0);     // top highlight

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.035);

  pmrem.dispose();

  envScene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });

  return target;
}

// ------------------------------------------------
// Rock geometry: planar cleaves + noise.
// Every vertex is displaced by a pure function of its position, so
// vertices that share a corner always move together (no tearing).
// ------------------------------------------------

function buildRockGeometry(radius, options = {}) {

  const {
    detail = 18,
    planeCount = 6,
    roughness = 0.03,
    seed = Math.random() * 40
  } = options;

  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;

  const stretch = new THREE.Vector3(
    rand(0.85, 1.2),
    rand(0.8, 1.15),
    rand(0.85, 1.15)
  );

  const planes = [];

  for (let i = 0; i < planeCount; i++) {
    planes.push({ n: randomUnit(), d: rand(0.6, 0.82) });
  }

  const v = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {

    v.fromBufferAttribute(position, i);

    // Low-frequency irregular shape
    const lf = fbm3(
      v.x * 1.2 + seed,
      v.y * 1.2 + seed * 0.7,
      v.z * 1.2 + seed * 1.3
    );

    v.multiplyScalar(0.82 + 0.5 * lf);

    // Fracture planes: flatten everything past each plane
    for (const plane of planes) {

      const s = v.dot(plane.n) - plane.d;

      if (s > 0) v.addScaledVector(plane.n, -s);
    }

    // Fine roughness
    const rn = fbm3(
      v.x * 5 + seed,
      v.y * 5,
      v.z * 5 - seed
    );

    v.multiplyScalar(1 + roughness * (rn - 0.5) * 2);

    v.multiply(stretch).multiplyScalar(radius);

    position.setXYZ(i, v.x, v.y, v.z);
  }

  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');

  // Hard edges where the angle is large, smooth elsewhere
  if (typeof BufferGeometryUtils.toCreasedNormals === 'function') {

    const creased = BufferGeometryUtils.toCreasedNormals(
      geometry,
      Math.PI / 6
    );

    geometry.dispose();

    return creased;
  }

  geometry.computeVertexNormals();

  return geometry;
}

// ------------------------------------------------
// Crystal shard geometry (hexagonal, pointed)
// ------------------------------------------------

function buildShardGeometry(length, radius) {

  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(radius * 0.92, length * 0.06),
    new THREE.Vector2(radius, length * 0.60),
    new THREE.Vector2(0, length)
  ];

  const geometry = new THREE.LatheGeometry(profile, 6);
  const position = geometry.attributes.position;

  const seed = Math.random() * 50;
  const lean = new THREE.Vector2(rand(-0.12, 0.12), rand(-0.12, 0.12));

  for (let i = 0; i < position.count; i++) {

    let x = position.getX(i);
    const y = position.getY(i);
    let z = position.getZ(i);

    // Deterministic per-position asymmetry
    const j = 1 + 0.18 * (vnoise(x * 0.35 + seed, y * 0.35, z * 0.35) - 0.5) * 2;

    x *= j;
    z *= j;

    // The tip leans a little, like a natural crystal
    const t = Math.max(0, y / length - 0.55) / 0.45;

    x += lean.x * length * t * t;
    z += lean.y * length * t * t;

    position.setXYZ(i, x, y, z);
  }

  return geometry;
}

// ================================================
// FACTORY
// ================================================

export function createObjectFactory(renderer, glowTexture) {

  const envTarget = buildEnvironment(renderer);
  const envMap = envTarget.texture;

  // ---------------- shared helpers ----------------

  function makeGlowSprite(color, scale, opacity) {

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );

    sprite.scale.set(scale, scale, 1);

    return sprite;
  }

  // ==============================================
  // ROCK
  // ==============================================

  function makeRockMaterial(seedVector, crackScale) {

    const uniforms = {
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uSeed: { value: seedVector },
      uBump: { value: 2.8 },
      uCrackScale: { value: crackScale }
    };

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.04,
      envMap,
      envMapIntensity: 0.55
    });

    material.onBeforeCompile = (shader) => {

      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vObjPos;'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvObjPos = transformed;'
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vObjPos;
            uniform float uTime;
            uniform float uHeat;
            uniform vec3 uSeed;
            uniform float uBump;
            uniform float uCrackScale;
            ${GLSL_NOISE}
            ${GLSL_WORLEY}
          `
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
            #include <color_fragment>

            vec3 mhP = vObjPos;

            float mhRock = mh_fbm(mhP * 0.20 + uSeed);
            float mhGrain = mh_fbm(mhP * 0.95 + uSeed * 1.7);

            vec3 mhWarp = vec3(
              mh_fbm(mhP * 0.12 + uSeed + 3.1),
              mh_fbm(mhP * 0.12 + uSeed + 7.7),
              mh_fbm(mhP * 0.12 + uSeed + 11.3)
            ) - 0.5;

            vec2 mhW = mh_worley(mhP * uCrackScale + mhWarp * 0.9 + uSeed);
            float mhEdge = mhW.y - mhW.x;

            float mhCrack = 1.0 - smoothstep(0.0, 0.085, mhEdge);
            float mhHalo = 1.0 - smoothstep(0.0, 0.34, mhEdge);

            vec3 mhBase = mix(
              vec3(0.060, 0.052, 0.048),
              vec3(0.200, 0.165, 0.140),
              mhRock
            ) * (0.65 + 0.7 * mhGrain);

            mhBase *= mix(1.0, 0.30, mhHalo);

            diffuseColor.rgb = mhBase;
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
            #include <normal_fragment_maps>

            {
              // Procedural bump: perturb the normal from a height field
              float mhHeight = (mhRock * 0.9 + mhGrain * 0.5 - mhCrack * 0.45) * uBump;

              vec3 mhDpdx = dFdx(-vViewPosition);
              vec3 mhDpdy = dFdy(-vViewPosition);

              float mhHx = dFdx(mhHeight);
              float mhHy = dFdy(mhHeight);

              vec3 mhR1 = cross(mhDpdy, normal);
              vec3 mhR2 = cross(normal, mhDpdx);

              float mhDet = dot(mhDpdx, mhR1);
              vec3 mhGrad = sign(mhDet) * (mhHx * mhR1 + mhHy * mhR2);

              normal = normalize(abs(mhDet) * normal - mhGrad);
            }
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
            #include <emissivemap_fragment>

            float mhPulse = 0.88 + 0.12 * sin(uTime * 2.1 + uSeed.x * 9.0 + mhP.y * 0.08);

            vec3 mhLava = mix(
              vec3(0.50, 0.05, 0.008),
              vec3(1.0, 0.43, 0.07),
              mhCrack
            );

            mhLava = mix(
              mhLava,
              vec3(1.0, 0.84, 0.50),
              pow(mhCrack, 5.0) * (0.35 + 0.65 * uHeat)
            );

            totalEmissiveRadiance +=
              mhLava * (mhCrack * mhCrack) * (1.5 + 4.5 * uHeat) * mhPulse;

            totalEmissiveRadiance +=
              vec3(0.50, 0.09, 0.015) * mhHalo * mhHalo * (0.25 + 1.4 * uHeat);
          `
        );
    };

    material.customProgramCacheKey = () => 'mystic-rock-v1';

    material.userData.uniforms = uniforms;

    return material;
  }

  function createRock(radius) {

    const group = new THREE.Group();

    const seedVector = new THREE.Vector3(
      Math.random() * 40,
      Math.random() * 40,
      Math.random() * 40
    );

    const material = makeRockMaterial(seedVector, 0.075);

    const mesh = new THREE.Mesh(
      buildRockGeometry(radius, { detail: 18, planeCount: 6, seed: seedVector.x }),
      material
    );

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    group.add(mesh);

    // Small floating debris
    const debrisMaterial = makeRockMaterial(seedVector.clone().add(
      new THREE.Vector3(13, 7, 3)
    ), 0.22);

    const debris = [];

    for (let i = 0; i < 5; i++) {

      const size = radius * rand(0.10, 0.20);

      const piece = new THREE.Mesh(
        buildRockGeometry(size, { detail: 4, planeCount: 3, roughness: 0.06 }),
        debrisMaterial
      );

      piece.castShadow = true;

      const holder = new THREE.Group();

      holder.rotation.set(
        rand(0, Math.PI),
        rand(0, Math.PI * 2),
        rand(0, Math.PI)
      );

      piece.position.x = radius * rand(1.3, 1.9);

      holder.add(piece);
      group.add(holder);

      debris.push({
        holder,
        piece,
        speed: rand(0.25, 0.7) * (Math.random() < 0.5 ? -1 : 1),
        spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1))
      });
    }

    const glow = makeGlowSprite(0xff6a1c, radius * 3.4, 0.2);

    group.add(glow);

    function update(dt, time, heat) {

      material.userData.uniforms.uTime.value = time;
      material.userData.uniforms.uHeat.value = heat;

      debrisMaterial.userData.uniforms.uTime.value = time;
      debrisMaterial.userData.uniforms.uHeat.value = heat;

      for (const d of debris) {

        d.holder.rotation.y += d.speed * dt;

        d.piece.rotation.x += d.spin.x * dt;
        d.piece.rotation.y += d.spin.y * dt;
        d.piece.rotation.z += d.spin.z * dt;
      }

      glow.material.opacity = 0.14 + 0.36 * heat;
    }

    return { group, update };
  }

  // ==============================================
  // CRYSTAL CLUSTER
  // ==============================================

  function makeCrystalMaterial(radius) {

    const uniforms = {
      uTime: { value: 0 },
      uHeat: { value: 0 }
    };

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x3a1a08,
      metalness: 0.72,
      roughness: 0.10,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMap,
      envMapIntensity: 1.9,
      flatShading: true
    });

    material.onBeforeCompile = (shader) => {

      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vObjPos;'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvObjPos = transformed;'
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
            #include <common>
            varying vec3 vObjPos;
            uniform float uTime;
            uniform float uHeat;
          `
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `
            #include <emissivemap_fragment>

            vec3 mhView = normalize(vViewPosition);
            float mhFres = pow(1.0 - clamp(dot(mhView, normal), 0.0, 1.0), 2.6);

            // Each shard starts at the hub, so local distance = distance from hub
            float mhHub = 1.0 - smoothstep(0.0, ${(radius * 1.15).toFixed(2)}, length(vObjPos));

            float mhFlicker = 0.9 + 0.1 * sin(uTime * 3.0 + vObjPos.x * 0.2);

            totalEmissiveRadiance +=
              vec3(1.0, 0.50, 0.10) * mhFres * (0.9 + 2.2 * uHeat) * mhFlicker;

            totalEmissiveRadiance +=
              vec3(1.0, 0.36, 0.04) * mhHub * mhHub * (0.5 + 2.2 * uHeat);
          `
        );
    };

    material.customProgramCacheKey = () => `mystic-crystal-${radius.toFixed(1)}`;

    material.userData.uniforms = uniforms;

    return material;
  }

  function createCrystal(radius) {

    const group = new THREE.Group();

    const material = makeCrystalMaterial(radius);

    const count = 8;
    const mainIndex = Math.floor(Math.random() * count);
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {

      // Fibonacci directions with jitter -> a natural burst of spikes
      const y = 1 - (i / (count - 1)) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * 2.39996;

      const dir = new THREE.Vector3(
        Math.cos(theta) * ring + rand(-0.18, 0.18),
        y + rand(-0.18, 0.18),
        Math.sin(theta) * ring + rand(-0.18, 0.18)
      ).normalize();

      const length = i === mainIndex
        ? radius * rand(1.5, 1.75)
        : radius * rand(0.7, 1.2);

      const shardRadius = length * rand(0.15, 0.2);

      const mesh = new THREE.Mesh(
        buildShardGeometry(length, shardRadius),
        material
      );

      mesh.quaternion.setFromUnitVectors(up, dir);
      mesh.rotateY(rand(0, Math.PI));

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      group.add(mesh);
    }

    const glow = makeGlowSprite(0xffa050, radius * 3.0, 0.3);

    group.add(glow);

    function update(dt, time, heat) {

      material.userData.uniforms.uTime.value = time;
      material.userData.uniforms.uHeat.value = heat;

      glow.material.opacity = 0.22 + 0.4 * heat;
    }

    return { group, update };
  }

  // ==============================================
  // ENERGY CORE
  // ==============================================

  const CORE_VERTEX = /* glsl */ `
    varying vec3 vPos;
    varying vec3 vN;
    varying vec3 vV;

    void main() {
      vPos = position;

      vec4 mv = modelViewMatrix * vec4(position, 1.0);

      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);

      gl_Position = projectionMatrix * mv;
    }
  `;

  const PLASMA_FRAGMENT = /* glsl */ `
    uniform float uTime;
    uniform float uHeat;

    varying vec3 vPos;
    varying vec3 vN;
    varying vec3 vV;

    ${GLSL_NOISE}

    void main() {

      float t = uTime * 0.35;
      vec3 p = normalize(vPos) * 2.2;

      // Domain-warped noise gives slow, liquid plasma
      vec3 q = p + vec3(
        mh_fbm(p + t),
        mh_fbm(p + 4.2 - t),
        mh_fbm(p + 8.1 + t)
      ) * 1.2;

      float n = mh_fbm(q * 1.6 - vec3(0.0, t * 2.0, 0.0));

      float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.0);

      float e = clamp(n * 1.35 + (1.0 - fres) * 0.35 + uHeat * 0.4, 0.0, 1.0);

      vec3 dark = vec3(0.50, 0.08, 0.01);
      vec3 mid = vec3(1.0, 0.48, 0.08);
      vec3 hot = vec3(1.0, 0.92, 0.62);

      vec3 col = mix(dark, mid, smoothstep(0.15, 0.60, e));
      col = mix(col, hot, smoothstep(0.60, 1.0, e));

      col *= 1.35 + 1.8 * uHeat;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const SHELL_FRAGMENT = /* glsl */ `
    uniform float uTime;
    uniform float uHeat;

    varying vec3 vPos;
    varying vec3 vN;
    varying vec3 vV;

    ${GLSL_NOISE}

    void main() {

      float t = uTime * 0.5;
      vec3 p = normalize(vPos);

      float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.2);

      // Thin electric veins drifting over the shell
      float n = mh_fbm(p * 3.2 + vec3(0.0, t, t * 0.6));
      float veins = pow(1.0 - abs(n * 2.0 - 1.0), 7.0);

      float alpha = fres * (0.30 + 0.9 * veins) + veins * 0.25;
      alpha *= 0.65 + 0.7 * uHeat;

      vec3 col = mix(vec3(1.0, 0.45, 0.07), vec3(1.0, 0.85, 0.5), veins);

      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `;

  function createCore(radius) {

    const group = new THREE.Group();

    const uniforms = {
      uTime: { value: 0 },
      uHeat: { value: 0 }
    };

    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.72, 48, 32),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: CORE_VERTEX,
        fragmentShader: PLASMA_FRAGMENT
      })
    );

    group.add(inner);

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.05, 48, 32),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: CORE_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );

    group.add(shell);

    // Partial rotating arcs (not full torus rings)
    const arcMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc878,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const arcs = [];

    const arcSpecs = [
      { inner: 1.42, outer: 1.46, start: 0.2, length: 2.3, tilt: [1.1, 0.2], speed: 0.9 },
      { inner: 1.68, outer: 1.71, start: 2.6, length: 1.7, tilt: [0.3, 1.2], speed: -0.65 }
    ];

    for (const spec of arcSpecs) {

      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(
          radius * spec.inner,
          radius * spec.outer,
          96,
          1,
          spec.start,
          spec.length
        ),
        arcMaterial
      );

      mesh.rotation.set(spec.tilt[0], spec.tilt[1], 0);

      const holder = new THREE.Group();

      holder.add(mesh);
      group.add(holder);

      arcs.push({ holder, speed: spec.speed });
    }

    // Orbiting amber fragments
    const fragmentMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a2208,
      metalness: 0.7,
      roughness: 0.18,
      emissive: 0xff5a10,
      emissiveIntensity: 0.9,
      envMap,
      envMapIntensity: 1.6,
      flatShading: true
    });

    const fragmentGeometry = new THREE.OctahedronGeometry(radius * 0.11);

    fragmentGeometry.scale(0.7, 1.5, 0.7);

    const fragments = [];

    for (let i = 0; i < 3; i++) {

      const piece = new THREE.Mesh(fragmentGeometry, fragmentMaterial);

      piece.castShadow = true;
      piece.position.x = radius * rand(1.55, 1.95);

      const holder = new THREE.Group();

      holder.rotation.set(rand(0, Math.PI), rand(0, Math.PI * 2), rand(0, 1));

      holder.add(piece);
      group.add(holder);

      fragments.push({
        holder,
        piece,
        speed: rand(0.7, 1.4) * (Math.random() < 0.5 ? -1 : 1)
      });
    }

    const glow = makeGlowSprite(0xff8a20, radius * 4.2, 0.7);

    group.add(glow);

    const phase = Math.random() * Math.PI * 2;

    function update(dt, time, heat) {

      uniforms.uTime.value = time + phase * 3;
      uniforms.uHeat.value = heat;

      const pulse = 1 + 0.05 * Math.sin(time * 3.0 + phase);

      inner.scale.setScalar(pulse);
      shell.scale.setScalar(1 + 0.12 * heat + 0.02 * Math.sin(time * 2.0 + phase));

      for (const arc of arcs) {
        arc.holder.rotation.z += arc.speed * dt * (1 + heat);
      }

      for (const f of fragments) {
        f.holder.rotation.y += f.speed * dt * (1 + 0.8 * heat);
        f.piece.rotation.x += dt * 2.0;
      }

      glow.material.opacity = 0.55 + 0.4 * heat;
    }

    return { group, update };
  }

  // ---------------- cleanup ----------------

  function dispose() {
    envTarget.dispose();
  }

  return {
    createRock,
    createCrystal,
    createCore,
    dispose
  };
}