# ParticleSphere

Interactive 3D particle sphere. Hover the canvas near one of the eight cardinal
directions (N, NE, E, SE, S, SW, W, NW) and a cloud of ~500 particles morphs
into the corresponding logo. Cursor away for two seconds and the sphere
reassembles.

## Install

```bash
npm install
```

Dependencies added on top of the base Vite + React + R3F stack:

- `simple-icons` — raw SVG source for Rust / Go / Python / React
- `lucide-react` — reference for Star and Person (SVG paths inlined)
- `@lobehub/icons-static-svg` — fetched on-demand from unpkg CDN

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
| `particleCount` | `3000` | Total particles. Scales to 60% on viewports <640px wide. |
| `radius` | `2` | Sphere radius in world units. |
| `className` | `''` | Forwarded to wrapper. |
| `style` | `{}` | Merged onto wrapper style. |
| `disabled` | `false` | Freezes all animation. |
| `background` | `'transparent'` | CSS background for the wrapper. |
| `showHints` | `true` | Renders tiny "N / S / E / W" corner labels. |

The component fills 100% of its parent; size the parent to size the sphere.

## Next.js / SSR note

`@react-three/fiber` requires a DOM. In Next.js, import this component with
`next/dynamic` and disable SSR:

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
  index.jsx            public component (Canvas, ResizeObserver, hint overlay)
  Particles.jsx        single THREE.Points + one useFrame loop
  particlesShader.js   vertex + fragment GLSL
  useFibonacciSphere.js  anchor positions hook
  useLogoPoints.js     loads+samples all 8 logo clouds
  useCardinalHover.js  screen-space zone detection with hysteresis
  logoLoaders.js       simple-icons / lobehub CDN / lucide sources
  constants.js         every tunable constant
  math.js              Fibonacci, greedy NN match, easings
```

Per-frame work is a single `useFrame` pass mutating typed arrays in-place and
flagging `needsUpdate`; there is exactly one draw call.
