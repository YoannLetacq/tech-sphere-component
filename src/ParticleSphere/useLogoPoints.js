/**
 * Turns each logo's SVG into a Float32Array point cloud (xy, z=0)
 * centered at the origin and scaled to LOGO_NORMALIZE_SIZE.
 *
 * Uses `svgStringToPoints` (canvas rasterization + connected-component
 * density-aware sampling) from logoLoaders.js.
 */

import { useEffect, useState } from 'react';
import {
  CARDINAL_KEYS,
  LOGO_MAP,
  POINTS_PER_LOGO,
  LOGO_NORMALIZE_SIZE,
} from './constants.js';
import { loadSvgForZone, svgStringToPoints } from './logoLoaders.js';

async function buildCloudFromSvg(svgString) {
  // svgStringToPoints returns xy in [-0.7, 0.7] (extent 1.4).
  const pts = await svgStringToPoints(svgString, POINTS_PER_LOGO);
  // Scale to LOGO_NORMALIZE_SIZE target bounding-box extent.
  const scale = LOGO_NORMALIZE_SIZE / 1.4;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    out[i + 0] = pts[i + 0] * scale;
    out[i + 1] = pts[i + 1] * scale;
    out[i + 2] = 0;
  }
  return out;
}

/**
 * Hook: loads all 8 zones' logos once and returns { clouds, ready }.
 * `clouds[zone]` is a Float32Array(POINTS_PER_LOGO * 3) with z=0.
 */
export function useLogoPoints() {
  const [state, setState] = useState({ clouds: {}, ready: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const clouds = {};
      await Promise.all(
        CARDINAL_KEYS.map(async (zone) => {
          const svg = await loadSvgForZone(zone);
          const cloud = await buildCloudFromSvg(svg);
          if (!cancelled) clouds[zone] = cloud;
        })
      );
      if (!cancelled) setState({ clouds, ready: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export { LOGO_MAP };
