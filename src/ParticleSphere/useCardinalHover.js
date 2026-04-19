/**
 * Screen-space cardinal-zone detection with angular binning, radial
 * hysteresis, and a delayed deactivation that cancels on re-entry.
 *
 * Usage:
 *   const { activeZone, pointerHandlers } = useCardinalHover({ disabled });
 *   <Canvas onPointerMove={pointerHandlers.onPointerMove} ... />
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ACTIVATION_THRESHOLD,
  DEACTIVATION_THRESHOLD,
  CARDINAL_ANGLES_DEG,
  DEACTIVATION_DELAY,
  LOGO_ANCHOR_RADIUS_FACTOR,
} from './constants.js';
import { nearestCardinal } from './math.js';

function getCanvasRect(el) {
  if (!el) return null;
  return el.getBoundingClientRect();
}

export function useCardinalHover({ disabled, radius }) {
  const [activeZone, setActiveZone] = useState(null);
  const activeZoneRef = useRef(null);
  const deactivateTimerRef = useRef(null);
  const canvasElRef = useRef(null);

  const cancelDeactivate = () => {
    if (deactivateTimerRef.current) {
      clearTimeout(deactivateTimerRef.current);
      deactivateTimerRef.current = null;
    }
  };

  const scheduleDeactivate = useCallback(() => {
    cancelDeactivate();
    deactivateTimerRef.current = setTimeout(() => {
      activeZoneRef.current = null;
      setActiveZone(null);
      deactivateTimerRef.current = null;
    }, DEACTIVATION_DELAY);
  }, []);

  const evaluatePointer = useCallback(
    (clientX, clientY) => {
      if (disabled) return;
      const el = canvasElRef.current;
      const rect = getCanvasRect(el);
      if (!rect) return;

      // Sphere projected center assumed at canvas center.
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = cy - clientY; // invert so up is +Y
      const dist = Math.hypot(dx, dy);

      // Working radius is in pixels. Treat canvas half-height as sphere radius.
      const pxPerUnit = Math.min(rect.width, rect.height) / 2 / radius;
      const r = dist / pxPerUnit;

      const active = activeZoneRef.current;

      // Outside deactivation ring → schedule deactivate if active.
      if (r > DEACTIVATION_THRESHOLD * radius) {
        if (active) scheduleDeactivate();
        return;
      }

      // Within rings → compute angle and nearest cardinal.
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const cardinal = nearestCardinal(angleDeg, CARDINAL_ANGLES_DEG);

      // Cardinal anchor (in world units) lies at LOGO_ANCHOR_RADIUS_FACTOR * r.
      const theta = (CARDINAL_ANGLES_DEG[cardinal] * Math.PI) / 180;
      const ax = Math.cos(theta) * radius * LOGO_ANCHOR_RADIUS_FACTOR;
      const ay = Math.sin(theta) * radius * LOGO_ANCHOR_RADIUS_FACTOR;
      const distToAnchor = Math.hypot(dx / pxPerUnit - ax, dy / pxPerUnit - ay);

      if (active === cardinal) {
        // Same zone — keep it, cancel any pending deactivate.
        if (distToAnchor <= DEACTIVATION_THRESHOLD * radius) {
          cancelDeactivate();
        } else {
          scheduleDeactivate();
        }
        return;
      }

      // Different / no active zone. Require activation threshold to enter.
      if (distToAnchor <= ACTIVATION_THRESHOLD * radius) {
        cancelDeactivate();
        activeZoneRef.current = cardinal;
        setActiveZone(cardinal);
      } else if (active) {
        scheduleDeactivate();
      }
    },
    [disabled, radius, scheduleDeactivate]
  );

  const onPointerMove = useCallback(
    (e) => {
      canvasElRef.current = e.currentTarget;
      evaluatePointer(e.clientX, e.clientY);
    },
    [evaluatePointer]
  );

  const onPointerLeave = useCallback(() => {
    if (activeZoneRef.current) scheduleDeactivate();
  }, [scheduleDeactivate]);

  const onTouchStart = useCallback(
    (e) => {
      if (!e.touches || e.touches.length === 0) return;
      canvasElRef.current = e.currentTarget;
      const t = e.touches[0];
      evaluatePointer(t.clientX, t.clientY);
    },
    [evaluatePointer]
  );

  const onTouchMove = onTouchStart;

  const onTouchEnd = useCallback(() => {
    if (activeZoneRef.current) scheduleDeactivate();
  }, [scheduleDeactivate]);

  useEffect(() => () => cancelDeactivate(), []);

  // When disabled flips on mid-session, clear any active zone.
  useEffect(() => {
    if (disabled) {
      cancelDeactivate();
      activeZoneRef.current = null;
      setActiveZone(null);
    }
  }, [disabled]);

  return {
    activeZone,
    pointerHandlers: {
      onPointerMove,
      onPointerLeave,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
