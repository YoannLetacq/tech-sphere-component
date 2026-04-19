/**
 * <Particles> — single THREE.Points draw call that owns:
 *   - Fibonacci anchor positions
 *   - per-particle targetPos / currentPos / currentColor
 *   - morph state (role, morphProgress)
 *   - one useFrame loop that drives idle noise, rotation, and morph/unmorph
 *
 * React state is NEVER used for positions. Only BufferAttribute.needsUpdate.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

import {
  IDLE_NOISE_AMPLITUDE,
  IDLE_NOISE_FREQUENCY,
  MORPH_NOISE_DAMP,
  MORPH_DURATION,
  COLOR_TRANSITION_DURATION,
  COLOR_TRANSITION_START,
  REVERSE_DURATION,
  REVERSE_DISPLACED_DURATION,
  REVERSE_COLOR_DURATION,
  POINTS_PER_LOGO,
  CARDINAL_ANGLES_DEG,
  LOGO_ANCHOR_RADIUS_FACTOR,
  LOGO_MAP,
  BASELINE_COLOR_HEX,
  HINT_COLOR_HEX,
  HINT_PARTICLE_COUNT,
  CARDINAL_HINT_DARKNESS,
  PARTICLE_SIZE,
  PARTICLE_DEPTH_SCALE,
  DISPLACEMENT_RADIUS_FACTOR,
  DISPLACEMENT_AMOUNT,
  REDUCED_MOTION_TWEEN_MS,
  CARDINAL_KEYS,
} from './constants.js';
import { useFibonacciSphere } from './useFibonacciSphere.js';
import {
  easeInOutCubic,
  easeInOutQuad,
  easeOutQuart,
  clamp01,
  hexToRgb,
  lerp,
  assignClosestParticlePerLogoPoint,
} from './math.js';
import { VERTEX_SHADER, FRAGMENT_SHADER } from './particlesShader.js';

// Role flags
const ROLE_SPHERE = 0;
const ROLE_LOGO = 1;
const ROLE_DISPLACED = 2;

function cardinalWorldPosition(zoneKey, radius) {
  const theta = (CARDINAL_ANGLES_DEG[zoneKey] * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(theta) * radius * LOGO_ANCHOR_RADIUS_FACTOR,
    Math.sin(theta) * radius * LOGO_ANCHOR_RADIUS_FACTOR,
    0
  );
}

export default function Particles({
  count,
  radius,
  activeZone,
  logoClouds,
  disabled,
  reducedMotion,
}) {
  const anchors = useFibonacciSphere(count, radius);
  const geomRef = useRef();

  // Typed arrays — live outside React state.
  const state = useMemo(() => {
    const positions = new Float32Array(anchors); // current rendered positions
    const colors = new Float32Array(count * 3);
    const anchorPos = new Float32Array(anchors);
    const targetPos = new Float32Array(anchors);
    const startPos = new Float32Array(anchors);
    const startColor = new Float32Array(count * 3);
    const targetColor = new Float32Array(count * 3);
    const morphProgress = new Float32Array(count);
    const morphStart = new Float32Array(count); // ms timestamp; 0 = not animating
    const morphDurationArr = new Float32Array(count);
    const colorStart = new Float32Array(count);
    const colorDurationArr = new Float32Array(count);
    const role = new Uint8Array(count);
    const phases = new Float32Array(count);

    const base = hexToRgb(BASELINE_COLOR_HEX);
    const hint = hexToRgb(HINT_COLOR_HEX);
    for (let i = 0; i < count; i++) {
      colors[i * 3 + 0] = base.r;
      colors[i * 3 + 1] = base.g;
      colors[i * 3 + 2] = base.b;
      startColor[i * 3 + 0] = base.r;
      startColor[i * 3 + 1] = base.g;
      startColor[i * 3 + 2] = base.b;
      targetColor[i * 3 + 0] = base.r;
      targetColor[i * 3 + 1] = base.g;
      targetColor[i * 3 + 2] = base.b;
      phases[i] = (i * 0.6180339887) % 1;
    }

    // Paint the HINT_PARTICLE_COUNT closest particles to each cardinal with HINT color.
    for (const zone of CARDINAL_KEYS) {
      const world = cardinalWorldPosition(zone, radius);
      // Collect distances
      const dists = new Array(count);
      for (let i = 0; i < count; i++) {
        const dx = anchors[i * 3 + 0] - world.x;
        const dy = anchors[i * 3 + 1] - world.y;
        const dz = anchors[i * 3 + 2] - world.z;
        dists[i] = { i, d: dx * dx + dy * dy + dz * dz };
      }
      dists.sort((a, b) => a.d - b.d);
      for (let k = 0; k < HINT_PARTICLE_COUNT && k < dists.length; k++) {
        const idx = dists[k].i;
        const r = lerp(base.r, hint.r, CARDINAL_HINT_DARKNESS);
        const g = lerp(base.g, hint.g, CARDINAL_HINT_DARKNESS);
        const b = lerp(base.b, hint.b, CARDINAL_HINT_DARKNESS);
        colors[idx * 3 + 0] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
        startColor[idx * 3 + 0] = r;
        startColor[idx * 3 + 1] = g;
        startColor[idx * 3 + 2] = b;
        targetColor[idx * 3 + 0] = r;
        targetColor[idx * 3 + 1] = g;
        targetColor[idx * 3 + 2] = b;
      }
    }

    return {
      positions,
      colors,
      anchorPos,
      targetPos,
      startPos,
      startColor,
      targetColor,
      morphProgress,
      morphStart,
      morphDurationArr,
      colorStart,
      colorDurationArr,
      role,
      phases,
    };
  }, [anchors, count, radius]);

  const noise3D = useMemo(() => createNoise3D(), []);
  const { camera } = useThree();

  // Geometry init
  useEffect(() => {
    const g = geomRef.current;
    if (!g) return;
    g.setAttribute('position', new THREE.BufferAttribute(state.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(state.colors, 3));
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }, [state]);

  // Track activeZone transitions.
  const zoneRef = useRef(null);
  const zoneTransitionTime = useRef(0);

  // Rotation group ref. We rotate the <points> directly.
  const groupRef = useRef();

  // Auto-focus quaternion tween: rotates group so active cardinal faces camera.
  const startQuatRef = useRef(new THREE.Quaternion());
  const targetQuatRef = useRef(new THREE.Quaternion());
  const quatStartRef = useRef(0);
  const quatDurationRef = useRef(MORPH_DURATION);

  // Build a morph plan on activation.
  const buildMorphIn = (zoneKey) => {
    const cloud = logoClouds[zoneKey];
    if (!cloud || cloud.length === 0) return;

    const world = cardinalWorldPosition(zoneKey, radius);

    // Candidate particles = those closest (in world) to the cardinal anchor.
    // Use POINTS_PER_LOGO closest + a pool of extras for displacement.
    const dists = new Array(count);
    for (let i = 0; i < count; i++) {
      const dx = state.anchorPos[i * 3 + 0] - world.x;
      const dy = state.anchorPos[i * 3 + 1] - world.y;
      const dz = state.anchorPos[i * 3 + 2] - world.z;
      dists[i] = { i, d: dx * dx + dy * dy + dz * dz };
    }
    dists.sort((a, b) => a.d - b.d);

    const selected = dists.slice(0, POINTS_PER_LOGO).map((x) => x.i);

    // Auto-focus: compute the quaternion that rotates the cardinal direction
    // onto the camera direction, so the logo forms dead-center in screen after
    // the group rotates. Logo points are laid out in LOCAL frame using the
    // inverse of that quaternion, so after the group rotates they land upright
    // in world space (aligned with camera right/up).
    const camDirWorld = camera.position.clone().normalize();
    const cardDir = world.clone().normalize();
    const qTarget = new THREE.Quaternion().setFromUnitVectors(cardDir, camDirWorld);
    const qInv = qTarget.clone().invert();

    startQuatRef.current.copy(groupRef.current.quaternion);
    targetQuatRef.current.copy(qTarget);
    quatStartRef.current = performance.now();
    quatDurationRef.current = reducedMotion ? REDUCED_MOTION_TWEEN_MS : MORPH_DURATION;

    const worldRight = new THREE.Vector3(1, 0, 0);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = worldRight.clone().applyQuaternion(qInv);
    const up = worldUp.clone().applyQuaternion(qInv);

    const nLogo = cloud.length / 3;
    const logoWorld = new Float32Array(nLogo * 3);
    for (let j = 0; j < nLogo; j++) {
      const lx = cloud[j * 3 + 0];
      const ly = cloud[j * 3 + 1];
      logoWorld[j * 3 + 0] = world.x + right.x * lx + up.x * ly;
      logoWorld[j * 3 + 1] = world.y + right.y * lx + up.y * ly;
      logoWorld[j * 3 + 2] = world.z + right.z * lx + up.z * ly;
    }

    const pairs = assignClosestParticlePerLogoPoint(selected, state.anchorPos, logoWorld);

    const now = performance.now();
    const dur = reducedMotion ? REDUCED_MOTION_TWEEN_MS : MORPH_DURATION;
    const colorHex = LOGO_MAP[zoneKey].color;
    const tgtColor = hexToRgb(colorHex);

    // Mark selected particles as LOGO role with targets.
    for (const [particleIdx, logoIdx] of pairs.entries()) {
      const p3 = particleIdx * 3;
      state.startPos[p3 + 0] = state.positions[p3 + 0];
      state.startPos[p3 + 1] = state.positions[p3 + 1];
      state.startPos[p3 + 2] = state.positions[p3 + 2];
      state.targetPos[p3 + 0] = logoWorld[logoIdx * 3 + 0];
      state.targetPos[p3 + 1] = logoWorld[logoIdx * 3 + 1];
      state.targetPos[p3 + 2] = logoWorld[logoIdx * 3 + 2];
      state.startColor[p3 + 0] = state.colors[p3 + 0];
      state.startColor[p3 + 1] = state.colors[p3 + 1];
      state.startColor[p3 + 2] = state.colors[p3 + 2];
      state.targetColor[p3 + 0] = tgtColor.r;
      state.targetColor[p3 + 1] = tgtColor.g;
      state.targetColor[p3 + 2] = tgtColor.b;
      state.morphStart[particleIdx] = now;
      state.morphDurationArr[particleIdx] = dur;
      state.colorStart[particleIdx] = 0;
      state.colorDurationArr[particleIdx] = reducedMotion
        ? REDUCED_MOTION_TWEEN_MS
        : COLOR_TRANSITION_DURATION;
      state.role[particleIdx] = ROLE_LOGO;
    }

    // Displacement for non-selected within DISPLACEMENT_RADIUS_FACTOR * radius.
    const displaceR2 =
      (DISPLACEMENT_RADIUS_FACTOR * radius) * (DISPLACEMENT_RADIUS_FACTOR * radius);
    const selectedSet = new Set(selected);
    for (let i = 0; i < count; i++) {
      if (selectedSet.has(i)) continue;
      const dx = state.anchorPos[i * 3 + 0] - world.x;
      const dy = state.anchorPos[i * 3 + 1] - world.y;
      const dz = state.anchorPos[i * 3 + 2] - world.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > displaceR2) continue;
      const len = Math.sqrt(
        state.anchorPos[i * 3] ** 2 +
        state.anchorPos[i * 3 + 1] ** 2 +
        state.anchorPos[i * 3 + 2] ** 2
      ) || 1;
      const nx = state.anchorPos[i * 3 + 0] / len;
      const ny = state.anchorPos[i * 3 + 1] / len;
      const nz = state.anchorPos[i * 3 + 2] / len;
      state.startPos[i * 3 + 0] = state.positions[i * 3 + 0];
      state.startPos[i * 3 + 1] = state.positions[i * 3 + 1];
      state.startPos[i * 3 + 2] = state.positions[i * 3 + 2];
      state.targetPos[i * 3 + 0] = state.anchorPos[i * 3 + 0] + nx * DISPLACEMENT_AMOUNT;
      state.targetPos[i * 3 + 1] = state.anchorPos[i * 3 + 1] + ny * DISPLACEMENT_AMOUNT;
      state.targetPos[i * 3 + 2] = state.anchorPos[i * 3 + 2] + nz * DISPLACEMENT_AMOUNT;
      state.morphStart[i] = now;
      state.morphDurationArr[i] = dur;
      state.role[i] = ROLE_DISPLACED;
    }
  };

  const buildMorphOut = () => {
    const now = performance.now();
    const dur = reducedMotion ? REDUCED_MOTION_TWEEN_MS : REVERSE_DURATION;
    const durD = reducedMotion ? REDUCED_MOTION_TWEEN_MS : REVERSE_DISPLACED_DURATION;
    const durC = reducedMotion ? REDUCED_MOTION_TWEEN_MS : REVERSE_COLOR_DURATION;
    const base = hexToRgb(BASELINE_COLOR_HEX);

    for (let i = 0; i < count; i++) {
      if (state.role[i] === ROLE_SPHERE) continue;
      const p3 = i * 3;
      state.startPos[p3 + 0] = state.positions[p3 + 0];
      state.startPos[p3 + 1] = state.positions[p3 + 1];
      state.startPos[p3 + 2] = state.positions[p3 + 2];
      state.targetPos[p3 + 0] = state.anchorPos[p3 + 0];
      state.targetPos[p3 + 1] = state.anchorPos[p3 + 1];
      state.targetPos[p3 + 2] = state.anchorPos[p3 + 2];
      state.startColor[p3 + 0] = state.colors[p3 + 0];
      state.startColor[p3 + 1] = state.colors[p3 + 1];
      state.startColor[p3 + 2] = state.colors[p3 + 2];
      state.targetColor[p3 + 0] = base.r;
      state.targetColor[p3 + 1] = base.g;
      state.targetColor[p3 + 2] = base.b;
      state.morphStart[i] = now;
      state.morphDurationArr[i] = state.role[i] === ROLE_LOGO ? dur : durD;
      state.colorStart[i] = now;
      state.colorDurationArr[i] = durC;
      // role is set back to SPHERE once progress reaches 1 in the frame loop.
    }
  };

  // React to activeZone changes.
  useEffect(() => {
    const prev = zoneRef.current;
    if (activeZone && activeZone !== prev) {
      buildMorphIn(activeZone);
      zoneRef.current = activeZone;
      zoneTransitionTime.current = performance.now();
    } else if (!activeZone && prev) {
      buildMorphOut();
      zoneRef.current = null;
      zoneTransitionTime.current = performance.now();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeZone]);

  // Frame loop
  useFrame(() => {
    if (disabled) return;
    const now = performance.now();

    // Auto-focus quaternion tween (group orients so active cardinal faces camera).
    if (groupRef.current && quatStartRef.current > 0) {
      const tq = clamp01((now - quatStartRef.current) / quatDurationRef.current);
      const eq = reducedMotion ? tq : easeInOutCubic(tq);
      groupRef.current.quaternion
        .copy(startQuatRef.current)
        .slerp(targetQuatRef.current, eq);
      if (tq >= 1) quatStartRef.current = 0;
    }

    // Noise time (Hz → radians)
    const tNoise = (now / 1000) * IDLE_NOISE_FREQUENCY * Math.PI * 2;

    const pos = state.positions;
    const col = state.colors;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const role = state.role[i];
      const morphStart = state.morphStart[i];
      let baseX, baseY, baseZ;

      if (morphStart > 0) {
        const elapsed = now - morphStart;
        const dur = state.morphDurationArr[i];
        const tRaw = clamp01(elapsed / dur);
        const e = reducedMotion
          ? tRaw
          : (role === ROLE_LOGO || role === ROLE_SPHERE
              ? easeInOutCubic(tRaw)
              : easeOutQuart(tRaw));
        baseX = lerp(state.startPos[i3 + 0], state.targetPos[i3 + 0], e);
        baseY = lerp(state.startPos[i3 + 1], state.targetPos[i3 + 1], e);
        baseZ = lerp(state.startPos[i3 + 2], state.targetPos[i3 + 2], e);
        state.morphProgress[i] = tRaw;

        // Kick off color transition once we're deep enough into the move.
        if (role === ROLE_LOGO && state.colorStart[i] === 0 && tRaw >= COLOR_TRANSITION_START) {
          state.colorStart[i] = now;
        }

        // Snap-complete.
        if (tRaw >= 1) {
          state.morphStart[i] = 0;
          state.morphProgress[i] = 0;
          // Reverse finished → back to sphere role.
          const atAnchor =
            Math.abs(state.targetPos[i3] - state.anchorPos[i3]) < 1e-4 &&
            Math.abs(state.targetPos[i3 + 1] - state.anchorPos[i3 + 1]) < 1e-4 &&
            Math.abs(state.targetPos[i3 + 2] - state.anchorPos[i3 + 2]) < 1e-4;
          if (atAnchor) state.role[i] = ROLE_SPHERE;
        }
      } else if (role === ROLE_LOGO || role === ROLE_DISPLACED) {
        baseX = state.targetPos[i3 + 0];
        baseY = state.targetPos[i3 + 1];
        baseZ = state.targetPos[i3 + 2];
      } else {
        baseX = state.anchorPos[i3 + 0];
        baseY = state.anchorPos[i3 + 1];
        baseZ = state.anchorPos[i3 + 2];
      }

      // Tangential noise oscillation — skip in reduced motion.
      if (!reducedMotion) {
        const phase = state.phases[i] * Math.PI * 2;
        const nx = noise3D(baseX * 0.8 + tNoise + phase, baseY * 0.8, baseZ * 0.8);
        const ny = noise3D(baseX * 0.8, baseY * 0.8 + tNoise + phase, baseZ * 0.8);
        const nz = noise3D(baseX * 0.8, baseY * 0.8, baseZ * 0.8 + tNoise + phase);
        // Remove radial component so noise is tangential.
        const len = Math.sqrt(baseX * baseX + baseY * baseY + baseZ * baseZ) || 1;
        const rx = baseX / len, ry = baseY / len, rz = baseZ / len;
        const dot = nx * rx + ny * ry + nz * rz;
        let tx = nx - dot * rx;
        let ty = ny - dot * ry;
        let tz = nz - dot * rz;
        let amp = IDLE_NOISE_AMPLITUDE;
        if (role !== ROLE_SPHERE) amp *= MORPH_NOISE_DAMP;
        pos[i3 + 0] = baseX + tx * amp;
        pos[i3 + 1] = baseY + ty * amp;
        pos[i3 + 2] = baseZ + tz * amp;
      } else {
        pos[i3 + 0] = baseX;
        pos[i3 + 1] = baseY;
        pos[i3 + 2] = baseZ;
      }

      // Color interpolation.
      if (state.colorStart[i] > 0) {
        const tC = clamp01((now - state.colorStart[i]) / state.colorDurationArr[i]);
        const eC = reducedMotion ? tC : easeInOutQuad(tC);
        col[i3 + 0] = lerp(state.startColor[i3 + 0], state.targetColor[i3 + 0], eC);
        col[i3 + 1] = lerp(state.startColor[i3 + 1], state.targetColor[i3 + 1], eC);
        col[i3 + 2] = lerp(state.startColor[i3 + 2], state.targetColor[i3 + 2], eC);
        if (tC >= 1) {
          state.colorStart[i] = 0;
          state.startColor[i3 + 0] = col[i3 + 0];
          state.startColor[i3 + 1] = col[i3 + 1];
          state.startColor[i3 + 2] = col[i3 + 2];
        }
      }
    }

    geomRef.current.attributes.position.needsUpdate = true;
    geomRef.current.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={groupRef}>
      <bufferGeometry ref={geomRef} />
      <shaderMaterial
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={{
          uSize: { value: PARTICLE_SIZE },
          uDepthScale: { value: PARTICLE_DEPTH_SCALE },
        }}
        transparent
        depthWrite={false}
      />
    </points>
  );
}
