/**
 * SVG → Float32Array point-cloud pipeline.
 *
 * Five pitfalls this file addresses:
 *   1. Y-flip: SVG Y grows downward; world/WebGL Y grows upward. We flip when
 *      mapping raster pixels to normalized xy.
 *   2. fill-rule=evenodd: many brand/lucide paths rely on evenodd to carve
 *      holes. We honor per-path `fill-rule` when calling ctx.fill().
 *   3. Multi-path icons: some icons (react, gemini, …) contain N `<path>`
 *      elements. We rasterize ALL of them, not just the first.
 *   4. Stroke-only icons: lucide icons set `fill="none"` with a visible stroke.
 *      Filling those produces empty bitmaps. We detect fill=none and stroke
 *      instead of filling.
 *   5. Not every shape is a `<path>`: Lucide mixes `<path>`, `<circle>`,
 *      `<rect>`, `<line>`, `<polygon>`, `<polyline>`, `<ellipse>` (the User
 *      icon's head is a <circle>, its shoulders are a <path>). We extract ALL
 *      primitive types together, and resolve inherited attrs (fill, stroke,
 *      stroke-width, fill-rule) from ancestor <svg>/<g> elements so Lucide's
 *      root-level `stroke="currentColor"` reaches children that don't set it.
 *
 * Resolves a zone key → Promise<SVG string>, and converts an SVG string →
 * Promise<Float32Array> of point-cloud positions (xy in [-0.7, 0.7], z=0).
 *
 * Sources:
 *   - simple-icons: raw SVG via Vite `?raw` import
 *   - lobehub:      fetch from unpkg CDN (cached Promise)
 *   - lucide:       raw SVG strings from `lucide-static`
 */

import { LOGO_MAP, LOBEHUB_CDN_URL } from './constants.js';

// Eager raw imports for simple-icons. Vite bundles the SVG text as a string.
import rustSvg   from 'simple-icons/icons/rust.svg?raw';
import goSvg     from 'simple-icons/icons/go.svg?raw';
import pythonSvg from 'simple-icons/icons/python.svg?raw';
import reactSvg  from 'simple-icons/icons/react.svg?raw';

// lucide-static exposes each icon as a PascalCase named export (raw SVG string).
import { Star as lucideStar, User as lucideUser } from 'lucide-static';

const SIMPLE_ICONS_SVG = {
  rust: rustSvg,
  go: goSvg,
  python: pythonSvg,
  react: reactSvg,
};

// Map our zone ids (lowercase) to lucide-static's SVG strings.
const LUCIDE_SVG = {
  star: lucideStar,
  user: lucideUser,
};

const RASTER_SIZE = 512;
const FIT_SCALE = 0.9;

// Cache of in-flight / resolved fetches for lobehub.
const lobehubCache = new Map();

function fetchLobehub(slug) {
  if (!lobehubCache.has(slug)) {
    lobehubCache.set(
      slug,
      fetch(LOBEHUB_CDN_URL(slug))
        .then((r) => {
          if (!r.ok) throw new Error(`lobehub ${slug}: ${r.status}`);
          return r.text();
        })
        .catch(() => '') // Silent fallback — zone just won't morph.
    );
  }
  return lobehubCache.get(slug);
}

/** Returns a Promise<string> with the raw SVG for a given zone key. */
export function loadSvgForZone(zoneKey) {
  const entry = LOGO_MAP[zoneKey];
  if (!entry) return Promise.resolve('');
  switch (entry.source) {
    case 'simple-icons':
      return Promise.resolve(SIMPLE_ICONS_SVG[entry.id] || '');
    case 'lucide':
      return Promise.resolve(LUCIDE_SVG[entry.id] || '');
    case 'lobehub':
      return fetchLobehub(entry.id);
    default:
      return Promise.resolve('');
  }
}

// ---------- SVG → points ----------

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(size, size);
    } catch {
      /* fall through */
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }
  return null;
}

function parseViewBox(svgEl) {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));
    if (parts.length === 4) {
      const [x, y, w, h] = parts;
      if (w > 0 && h > 0) return { x, y, w, h };
    }
  }
  const w = parseFloat(svgEl.getAttribute('width')) || 24;
  const h = parseFloat(svgEl.getAttribute('height')) || 24;
  return { x: 0, y: 0, w, h };
}

function parseStrokeWidth(el) {
  const raw = el.getAttribute('stroke-width');
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getAttrInherited(el, name) {
  let cur = el;
  while (cur && cur.nodeType === 1) {
    const v = cur.getAttribute?.(name);
    if (v != null && v !== '') return v;
    cur = cur.parentNode;
  }
  return null;
}

function rasterizeSvg(svgString) {
  if (!svgString || typeof DOMParser === 'undefined') return null;

  const canvas = makeCanvas(RASTER_SIZE);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.documentElement;
  if (!svgEl || svgEl.nodeName.toLowerCase() !== 'svg') return null;

  const { x: vbx, y: vby, w: vbw, h: vbh } = parseViewBox(svgEl);

  // Fit viewBox into RASTER_SIZE at FIT_SCALE, centered.
  const fit = (RASTER_SIZE * FIT_SCALE) / Math.max(vbw, vbh);
  const offX = (RASTER_SIZE - vbw * fit) / 2;
  const offY = (RASTER_SIZE - vbh * fit) / 2;

  ctx.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(fit, fit);
  ctx.translate(-vbx, -vby);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  // Iterate ALL primitive shape types together (not path-first-with-fallback):
  // Lucide's User icon mixes <path> (shoulders) and <circle> (head); we must
  // render both.
  const drawables = doc.querySelectorAll(
    'path, circle, rect, ellipse, line, polygon, polyline'
  );
  for (const el of drawables) {
    const p2d = elementToPath2D(el);
    if (!p2d) continue;

    const fill = getAttrInherited(el, 'fill');
    const stroke = getAttrInherited(el, 'stroke');
    const fillRule = (
      el.getAttribute('fill-rule') || getAttrInherited(el, 'fill-rule') || 'nonzero'
    ).trim();
    const strokeWidth = parseStrokeWidth(el) ?? parseStrokeWidth(svgEl) ?? 2;
    const linecap = getAttrInherited(el, 'stroke-linecap') || 'butt';
    const linejoin = getAttrInherited(el, 'stroke-linejoin') || 'miter';

    const hasStroke = stroke && stroke !== 'none';
    const noFill = fill === 'none';
    const tag = el.nodeName.toLowerCase();
    const isOpenShape = tag === 'polyline' || tag === 'line';

    if (noFill && hasStroke) {
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = linecap;
      ctx.lineJoin = linejoin;
      ctx.stroke(p2d);
    } else if (isOpenShape && !hasStroke) {
      // Open shapes with no explicit stroke would vanish on fill; stroke them.
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = linecap;
      ctx.lineJoin = linejoin;
      ctx.stroke(p2d);
    } else {
      ctx.fill(p2d, fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
      if (hasStroke) {
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = linecap;
        ctx.lineJoin = linejoin;
        ctx.stroke(p2d);
      }
    }
  }
  ctx.restore();

  try {
    return ctx.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE);
  } catch {
    return null;
  }
}

function elementToPath2D(el) {
  const name = el.nodeName.toLowerCase();
  const p = new Path2D();
  if (name === 'path') {
    const d = el.getAttribute('d');
    if (!d) return null;
    try {
      return new Path2D(d);
    } catch {
      return null;
    }
  }
  if (name === 'polygon' || name === 'polyline') {
    const pts = (el.getAttribute('points') || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    if (pts.length < 4) return null;
    p.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length - 1; i += 2) p.lineTo(pts[i], pts[i + 1]);
    if (name === 'polygon') p.closePath();
    return p;
  }
  if (name === 'circle') {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = parseFloat(el.getAttribute('cy')) || 0;
    const r = parseFloat(el.getAttribute('r')) || 0;
    if (r <= 0) return null;
    p.arc(cx, cy, r, 0, Math.PI * 2);
    return p;
  }
  if (name === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = parseFloat(el.getAttribute('cy')) || 0;
    const rx = parseFloat(el.getAttribute('rx')) || 0;
    const ry = parseFloat(el.getAttribute('ry')) || 0;
    if (rx <= 0 || ry <= 0) return null;
    p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    return p;
  }
  if (name === 'rect') {
    const x = parseFloat(el.getAttribute('x')) || 0;
    const y = parseFloat(el.getAttribute('y')) || 0;
    const w = parseFloat(el.getAttribute('width')) || 0;
    const h = parseFloat(el.getAttribute('height')) || 0;
    if (w <= 0 || h <= 0) return null;
    const rx = parseFloat(el.getAttribute('rx')) || 0;
    if (rx > 0 && typeof p.roundRect === 'function') {
      p.roundRect(x, y, w, h, rx);
    } else {
      p.rect(x, y, w, h);
    }
    return p;
  }
  if (name === 'line') {
    const x1 = parseFloat(el.getAttribute('x1')) || 0;
    const y1 = parseFloat(el.getAttribute('y1')) || 0;
    const x2 = parseFloat(el.getAttribute('x2')) || 0;
    const y2 = parseFloat(el.getAttribute('y2')) || 0;
    p.moveTo(x1, y1);
    p.lineTo(x2, y2);
    return p;
  }
  return null;
}

/**
 * 4-connectivity BFS over the alpha channel. Returns an array of components,
 * each a list of {x, y} pixels.
 */
function findConnectedComponents(imageData, alphaThreshold = 0.5) {
  const { width, height, data } = imageData;
  const thr = alphaThreshold * 255;
  const visited = new Uint8Array(width * height);
  const components = [];
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      const a = data[idx * 4 + 3];
      if (a <= thr) {
        visited[idx] = 1;
        continue;
      }
      // BFS
      let head = 0, tail = 0;
      queueX[tail] = x; queueY[tail] = y; tail++;
      visited[idx] = 1;
      const pixels = [];
      while (head < tail) {
        const cx = queueX[head], cy = queueY[head]; head++;
        pixels.push({ x: cx, y: cy });
        // 4-neighbors
        if (cx > 0) {
          const ni = cy * width + (cx - 1);
          if (!visited[ni] && data[ni * 4 + 3] > thr) {
            visited[ni] = 1;
            queueX[tail] = cx - 1; queueY[tail] = cy; tail++;
          } else {
            visited[ni] = 1;
          }
        }
        if (cx < width - 1) {
          const ni = cy * width + (cx + 1);
          if (!visited[ni] && data[ni * 4 + 3] > thr) {
            visited[ni] = 1;
            queueX[tail] = cx + 1; queueY[tail] = cy; tail++;
          } else {
            visited[ni] = 1;
          }
        }
        if (cy > 0) {
          const ni = (cy - 1) * width + cx;
          if (!visited[ni] && data[ni * 4 + 3] > thr) {
            visited[ni] = 1;
            queueX[tail] = cx; queueY[tail] = cy - 1; tail++;
          } else {
            visited[ni] = 1;
          }
        }
        if (cy < height - 1) {
          const ni = (cy + 1) * width + cx;
          if (!visited[ni] && data[ni * 4 + 3] > thr) {
            visited[ni] = 1;
            queueX[tail] = cx; queueY[tail] = cy + 1; tail++;
          } else {
            visited[ni] = 1;
          }
        }
      }
      components.push({ pixels });
    }
  }
  return components;
}

function pixelToNormalized(px, py) {
  // x ∈ [-0.7, 0.7], y flipped so SVG-down → world-up.
  const x = (px / RASTER_SIZE) * 1.4 - 0.7;
  const y = -((py / RASTER_SIZE) * 1.4 - 0.7);
  return [x, y];
}

/**
 * Rasterize the SVG, find connected components, allocate points proportional
 * to √area, uniformly sample within each component. Returns Float32Array of
 * length targetPointCount*3 with z=0, xy in [-0.7, 0.7].
 */
export function svgStringToPoints(svgString, targetPointCount) {
  return new Promise((resolve) => {
    const out = new Float32Array(targetPointCount * 3);
    const imageData = rasterizeSvg(svgString);
    if (!imageData) {
      resolve(out);
      return;
    }
    const components = findConnectedComponents(imageData, 0.5);
    if (components.length === 0) {
      resolve(out);
      return;
    }

    // Density-aware allocation: ∝ √area.
    const sqrtAreas = components.map((c) => Math.sqrt(c.pixels.length));
    const sumSqrt = sqrtAreas.reduce((a, b) => a + b, 0) || 1;
    const allocations = sqrtAreas.map((s) => Math.floor((s / sumSqrt) * targetPointCount));
    let assigned = allocations.reduce((a, b) => a + b, 0);

    // Distribute remainder (largest fractional parts first).
    const remainders = sqrtAreas
      .map((s, i) => ({ i, frac: (s / sumSqrt) * targetPointCount - allocations[i] }))
      .sort((a, b) => b.frac - a.frac);
    let r = 0;
    while (assigned < targetPointCount && r < remainders.length) {
      allocations[remainders[r].i] += 1;
      assigned += 1;
      r += 1;
    }

    // Sample pixels per-component WITHOUT replacement using shuffled-stride.
    // Fisher-Yates shuffle + prefix-take avoids duplicates (which caused the
    // "dusty" clump/void look) and farthest-point-approximates blue noise at
    // O(n) per component. If need > pool, we stride-repeat for fill.
    const samples = [];
    for (let i = 0; i < components.length; i++) {
      const pool = components[i].pixels;
      const need = allocations[i];
      if (pool.length === 0 || need <= 0) continue;
      if (need >= pool.length) {
        for (const px of pool) samples.push(px);
        for (let k = pool.length; k < need; k++) {
          samples.push(pool[k % pool.length]);
        }
        continue;
      }
      // Partial Fisher-Yates: produce the first `need` unique picks.
      const idx = new Int32Array(pool.length);
      for (let k = 0; k < pool.length; k++) idx[k] = k;
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(Math.random() * (pool.length - k));
        const tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp;
        samples.push(pool[idx[k]]);
      }
    }

    // Top-up if still short (e.g., empty components); trim if over.
    if (samples.length < targetPointCount) {
      // Gather all pixels as a fallback pool.
      const all = [];
      for (const c of components) for (const p of c.pixels) all.push(p);
      while (samples.length < targetPointCount && all.length > 0) {
        samples.push(all[Math.floor(Math.random() * all.length)]);
      }
    }
    if (samples.length > targetPointCount) samples.length = targetPointCount;

    // Pad with origin if still short (degenerate SVG).
    for (let i = 0; i < targetPointCount; i++) {
      const s = samples[i];
      if (s) {
        const [x, y] = pixelToNormalized(s.x, s.y);
        out[i * 3 + 0] = x;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = 0;
      } else {
        out[i * 3 + 0] = 0;
        out[i * 3 + 1] = 0;
        out[i * 3 + 2] = 0;
      }
    }

    resolve(out);
  });
}
