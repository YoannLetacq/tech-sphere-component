/**
 * Pure math helpers: Fibonacci sphere sampling, greedy nearest-neighbor
 * matching for morph correspondence, easing functions, color utilities.
 */

// Golden ratio used by the Fibonacci (spherical) spiral.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Distributes `count` points near-uniformly across a sphere of `radius`.
 * Algorithm: walk y from +1 to -1 in equal steps; at each step the azimuth
 * advances by the golden angle. This gives the characteristic spiral with
 * no clustering at the poles.
 */
export function fibonacciSphere(count, radius, out) {
  const target = out || new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    target[i * 3 + 0] = x * radius;
    target[i * 3 + 1] = y * radius;
    target[i * 3 + 2] = z * radius;
  }
  return target;
}

/**
 * Greedy O(n*m) nearest-neighbor matching.
 * `particleIndices` are indices into a Float32Array of particle positions.
 * `logoPoints` is a flat Float32Array [x,y,z,x,y,z,...].
 * Returns Map<particleIndex, logoPointIndex> of length = logoPoints.length/3.
 *
 * Each pass picks the currently-closest (particle, logoPoint) pair and
 * removes both from the pool. Simple but good enough at ≤500×500.
 */
export function greedyNearestMatch(particleIndices, particlePositions, logoPoints) {
  const pcount = particleIndices.length;
  const lcount = logoPoints.length / 3;
  const usedParticle = new Uint8Array(pcount);
  const usedLogo = new Uint8Array(lcount);
  const pairs = new Map();

  const toMatch = Math.min(pcount, lcount);

  // Precompute all distances once in a flat array. Row = logo index.
  for (let matched = 0; matched < toMatch; matched++) {
    let bestDist = Infinity;
    let bestP = -1;
    let bestL = -1;
    for (let l = 0; l < lcount; l++) {
      if (usedLogo[l]) continue;
      const lx = logoPoints[l * 3 + 0];
      const ly = logoPoints[l * 3 + 1];
      const lz = logoPoints[l * 3 + 2];
      for (let pi = 0; pi < pcount; pi++) {
        if (usedParticle[pi]) continue;
        const p = particleIndices[pi];
        const dx = particlePositions[p * 3 + 0] - lx;
        const dy = particlePositions[p * 3 + 1] - ly;
        const dz = particlePositions[p * 3 + 2] - lz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          bestP = pi;
          bestL = l;
        }
      }
    }
    if (bestP === -1) break;
    usedParticle[bestP] = 1;
    usedLogo[bestL] = 1;
    pairs.set(particleIndices[bestP], bestL);
  }

  return pairs;
}

/**
 * Cheap alternative used on every activation. For each logo point, pick
 * the closest *unused* particle from the candidate pool. Matches the
 * guarantee that every logo point gets exactly one particle without the
 * quadratic outer loop of the pure-greedy variant above.
 */
export function assignClosestParticlePerLogoPoint(
  particleIndices,
  particlePositions,
  logoPoints
) {
  const pcount = particleIndices.length;
  const lcount = logoPoints.length / 3;
  const usedParticle = new Uint8Array(pcount);
  const pairs = new Map();

  for (let l = 0; l < lcount; l++) {
    const lx = logoPoints[l * 3 + 0];
    const ly = logoPoints[l * 3 + 1];
    const lz = logoPoints[l * 3 + 2];
    let bestDist = Infinity;
    let bestP = -1;
    for (let pi = 0; pi < pcount; pi++) {
      if (usedParticle[pi]) continue;
      const p = particleIndices[pi];
      const dx = particlePositions[p * 3 + 0] - lx;
      const dy = particlePositions[p * 3 + 1] - ly;
      const dz = particlePositions[p * 3 + 2] - lz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        bestP = pi;
      }
    }
    if (bestP === -1) break;
    usedParticle[bestP] = 1;
    pairs.set(particleIndices[bestP], l);
  }
  return pairs;
}

// Easings
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeInOutQuad = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Convert #RRGGBB → {r,g,b} in [0,1]. */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Project a world-space point onto NDC using a camera's projection and
 * world matrix. Returns {x, y, z_ndc, behind}. `behind` = z_ndc > 1 means
 * behind the near plane from camera POV.
 */
export function projectToNDC(vec3, camera) {
  vec3.project(camera);
  return { x: vec3.x, y: vec3.y, z: vec3.z };
}

/**
 * Find the cardinal whose angle (in degrees, per CARDINAL_ANGLES_DEG) is
 * closest to the given `angleDeg`. Returns the cardinal key string.
 */
export function nearestCardinal(angleDeg, cardinalsDeg) {
  let best = null;
  let bestDelta = Infinity;
  for (const key in cardinalsDeg) {
    let d = Math.abs(angleDeg - cardinalsDeg[key]);
    d = Math.min(d, 360 - d);
    if (d < bestDelta) {
      bestDelta = d;
      best = key;
    }
  }
  return best;
}
