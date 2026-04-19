/**
 * <ParticleSphere /> — public component.
 * Wraps a single <Canvas> with OrbitControls, ResizeObserver, hint overlay,
 * and drives <Particles> via the cardinal auto-cycle state machine.
 *
 * Props:
 *   particleCount   — default DEFAULT_PARTICLE_COUNT (×0.6 on <640px screens)
 *   radius          — SPHERE_RADIUS
 *   className, style
 *   disabled        — freeze all animation
 *   background      — CSS bg for wrapper; 'transparent' by default
 *   showHints       — CSS-only corner hint labels
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Particles from './Particles.jsx';
import { useLogoPoints } from './useLogoPoints.js';
import {
  DEFAULT_PARTICLE_COUNT,
  SPHERE_RADIUS,
  MOBILE_BREAKPOINT_PX,
  MOBILE_PARTICLE_SCALE,
  RESIZE_DEBOUNCE_MS,
  CARDINAL_KEYS,
  MORPH_DURATION,
  COLOR_TRANSITION_DURATION,
  REVERSE_DURATION,
  AUTO_CYCLE_HOLD_MS,
  AUTO_CYCLE_GAP_MS,
  REDUCED_MOTION_TWEEN_MS,
} from './constants.js';

/**
 * Cycle activeZone through all 8 cardinals sequentially. Each zone morphs in,
 * holds, morphs out fully, then a small gap before the next one starts.
 */
function useCardinalAutoCycle({ disabled, reducedMotion }) {
  const [activeZone, setActiveZone] = useState(null);
  useEffect(() => {
    if (disabled) {
      setActiveZone(null);
      return;
    }
    const morphIn = reducedMotion ? REDUCED_MOTION_TWEEN_MS : MORPH_DURATION + COLOR_TRANSITION_DURATION;
    const morphOut = reducedMotion ? REDUCED_MOTION_TWEEN_MS : REVERSE_DURATION;
    const inToOut = morphIn + AUTO_CYCLE_HOLD_MS;
    const period = inToOut + morphOut + AUTO_CYCLE_GAP_MS;

    let idx = 0;
    let inT, outT, nextT;
    let stopped = false;

    const step = () => {
      if (stopped) return;
      const zone = CARDINAL_KEYS[idx % CARDINAL_KEYS.length];
      setActiveZone(zone);
      outT = setTimeout(() => setActiveZone(null), inToOut);
      nextT = setTimeout(() => {
        idx += 1;
        step();
      }, period);
    };

    inT = setTimeout(step, AUTO_CYCLE_GAP_MS);
    return () => {
      stopped = true;
      clearTimeout(inT);
      clearTimeout(outT);
      clearTimeout(nextT);
      setActiveZone(null);
    };
  }, [disabled, reducedMotion]);
  return activeZone;
}

function usePrefersReducedMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setRm(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return rm;
}

function useResponsiveCount(requested) {
  const [count, setCount] = useState(requested);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
      setCount(Math.round(requested * (isMobile ? MOBILE_PARTICLE_SCALE : 1)));
    };
    update();
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(update, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
    };
  }, [requested]);
  return count;
}

const hintStyle = {
  position: 'absolute',
  color: 'rgba(0,0,0,0.4)',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 11,
  letterSpacing: 2,
  pointerEvents: 'none',
  userSelect: 'none',
};

function HintOverlay() {
  return (
    <>
      <div style={{ ...hintStyle, top: 8, left: '50%', transform: 'translateX(-50%)' }}>N</div>
      <div style={{ ...hintStyle, bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>S</div>
      <div style={{ ...hintStyle, left: 8, top: '50%', transform: 'translateY(-50%)' }}>W</div>
      <div style={{ ...hintStyle, right: 8, top: '50%', transform: 'translateY(-50%)' }}>E</div>
    </>
  );
}

export default function ParticleSphere({
  particleCount = DEFAULT_PARTICLE_COUNT,
  radius = SPHERE_RADIUS,
  className = '',
  style,
  disabled = false,
  background = 'transparent',
  showHints = true,
}) {
  const wrapRef = useRef(null);
  const [pixelRatio, setPixelRatio] = useState(
    typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
  );
  const reducedMotion = usePrefersReducedMotion();
  const count = useResponsiveCount(particleCount);
  const { clouds } = useLogoPoints();
  const activeZone = useCardinalAutoCycle({ disabled, reducedMotion });

  // Debounced ResizeObserver — keeps DPR up-to-date.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !wrapRef.current) return;
    let t;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, []);

  const wrapperStyle = useMemo(
    () => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      background,
      touchAction: 'none',
      ...style,
    }),
    [background, style]
  );

  return (
    <div
      ref={wrapRef}
      className={className}
      style={wrapperStyle}
    >
      <Canvas
        camera={{ position: [0, 0, radius * 2.8], fov: 45 }}
        dpr={pixelRatio}
        gl={{ antialias: true, alpha: true }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          enableDamping
          makeDefault
        />
        <Particles
          count={count}
          radius={radius}
          activeZone={activeZone}
          logoClouds={clouds}
          disabled={disabled}
          reducedMotion={reducedMotion}
        />
      </Canvas>
      {showHints && <HintOverlay />}
    </div>
  );
}
