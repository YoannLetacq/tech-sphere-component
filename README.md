# ParticleSphere

Interactive 3D particle sphere built on `@react-three/fiber`. A single
`THREE.Points` mesh distributes particles across a Fibonacci sphere, then
auto-cycles through eight cardinal zones — morphing a cluster of particles into
a brand logo at each zone while the sphere auto-rotates so the active cardinal
faces the camera.

![demo](./wooow.mp4)

## Logos cycled

| Zone | Logo | Source |
| --- | --- | --- |
| N | Rust | `simple-icons` |
| NE | Anthropic | `@lobehub/icons-static-svg` (CDN) |
| E | React | `simple-icons` |
| SE | Star | `lucide-static` |
| S | Go | `simple-icons` |
| SW | User | `lucide-static` |
| W | Python | `simple-icons` |
| NW | Gemini | `@lobehub/icons-static-svg` (CDN) |

## Install

```bash
npm install
npm run dev
```

## Usage

```jsx
import ParticleSphere from './src/ParticleSphere/index.jsx';

export default function App() {
  return (
    <div style={{ width: 600, height: 600 }}>
      <ParticleSphere />
    </div>
  );
}
```

### Props

| prop | default | description |
| --- | --- | --- |
| `particleCount` | `25000` | Total particles. Scales to 60% on viewports <640px wide. |
| `radius` | `2` | Sphere radius in world units. |
| `className` | `''` | Forwarded to wrapper. |
| `style` | `{}` | Merged onto wrapper style. |
| `disabled` | `false` | Freezes all animation. |
| `background` | `'transparent'` | CSS background for the wrapper. |
| `showHints` | `true` | Renders tiny "N / S / E / W" corner labels. |

The component fills 100% of its parent; size the parent to size the sphere.

Every tunable (particle count, points-per-logo, morph timing, colors, raster
resolution, hysteresis thresholds) lives in
`src/ParticleSphere/constants.js` — no magic numbers elsewhere.

## Next.js / SSR

`@react-three/fiber` requires a DOM. In Next.js, import with `next/dynamic` and
disable SSR:

```jsx
import dynamic from 'next/dynamic';
const ParticleSphere = dynamic(
  () => import('./src/ParticleSphere/index.jsx'),
  { ssr: false }
);
```

## Architecture

```
src/ParticleSphere/
  index.jsx              public component (Canvas, ResizeObserver, auto-cycle, hints)
  Particles.jsx          single THREE.Points + one useFrame loop
  particlesShader.js     vertex + fragment GLSL
  useFibonacciSphere.js  anchor positions hook (golden-ratio spiral)
  useLogoPoints.js       loads + samples all 8 logo clouds
  logoLoaders.js         SVG → point-cloud rasterization pipeline
  constants.js           every tunable constant
  math.js                Fibonacci, nearest-neighbor match, easings
```

Per-frame work is a single `useFrame` pass mutating typed arrays in-place and
flagging `needsUpdate` — exactly one draw call for the entire sphere.

### SVG → point-cloud pipeline

`logoLoaders.js` converts every logo SVG to a Float32Array point cloud via
`DOMParser` + `Path2D` + canvas rasterization. Five pitfalls the pipeline
handles explicitly (documented in the file's header to prevent regressions):

1. **Y-flip** — SVG Y is down, WebGL Y is up.
2. **`fill-rule="evenodd"`** — required for interior holes (Rust gear, Gemini star).
3. **Multi-path icons** — all `<path>` elements rendered, not just the first.
4. **Stroke-only icons** — Lucide uses `fill="none"` + `stroke="currentColor"`; the rasterizer strokes these instead of filling.
5. **Mixed primitives** — Lucide's User icon mixes `<path>` (shoulders) and `<circle>` (head); `<rect>`, `<line>`, `<polygon>`, `<polyline>`, `<ellipse>` are all handled together, and inherited attrs walk up through ancestors.

Per-component sampling uses shuffled-stride (partial Fisher-Yates) rather than
`Math.random()` with replacement — this eliminates duplicate points and the
"dusty" clump/void look that uniform random produces at high densities.
Density-aware allocation (∝ √area) keeps thin features (Go trail, Lucide
strokes) legible against bulk features.

## Dependencies

- `react`, `react-dom`
- `three`, `@react-three/fiber`, `@react-three/drei`
- `simplex-noise` — tangential drift on idle particles
- `simple-icons` — Rust / Go / Python / React SVGs
- `lucide-static` — Star / User SVG strings
- `@lobehub/icons-static-svg` — Anthropic / Gemini (fetched from unpkg CDN)

## License

MIT
