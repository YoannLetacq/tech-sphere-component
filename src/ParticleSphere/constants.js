/**
 * Central registry for every tunable constant used by ParticleSphere.
 * No numeric literal controlling behavior lives outside this file.
 */

export const DEFAULT_PARTICLE_COUNT = 25000;
export const SPHERE_RADIUS = 2;
export const POINTS_PER_LOGO = 10000;

// Mobile/small-screen scaling
export const MOBILE_BREAKPOINT_PX = 640;
export const MOBILE_PARTICLE_SCALE = 0.6;

// Idle motion
export const IDLE_NOISE_AMPLITUDE = 0.015;
export const IDLE_NOISE_FREQUENCY = 0.3; // Hz
export const MORPH_NOISE_DAMP = 0.3;      // noise multiplier on morphing particles

// Morph timing (ms)
export const AUTO_CYCLE_HOLD_MS = 1500;
export const AUTO_CYCLE_GAP_MS = 400;
export const MORPH_DURATION = 900;
export const COLOR_TRANSITION_DURATION = 400;
export const COLOR_TRANSITION_START = 0.92;
export const REVERSE_DURATION = 700;
export const REVERSE_DISPLACED_DURATION = 500;
export const REVERSE_COLOR_DURATION = 500;

// Reduced-motion overrides
export const REDUCED_MOTION_TWEEN_MS = 300;

// Cardinal hint particles at rest
export const HINT_PARTICLE_COUNT = 8;
export const CARDINAL_HINT_DARKNESS = 0.75;

// Visual
export const BASELINE_COLOR_HEX = '#1a1a1a';
export const HINT_COLOR_HEX = '#000000';
export const PARTICLE_SIZE = 0.036;
export const PARTICLE_DEPTH_SCALE = 0.6;    // how much size attenuates with depth

// Logo cloud layout
export const LOGO_NORMALIZE_SIZE = 1.4;     // target world-space bounding box
export const LOGO_ANCHOR_RADIUS_FACTOR = 0.9; // cardinal anchor distance vs sphere radius
export const LOGO_RASTER_SIZE = 128;        // offscreen canvas NxN
export const LOGO_ALPHA_THRESHOLD = 0.5;    // > this alpha counts as fill

// Displacement push for particles near an activating logo but not selected
export const DISPLACEMENT_RADIUS_FACTOR = 1.2;
export const DISPLACEMENT_AMOUNT = 0.08;

// ResizeObserver debounce
export const RESIZE_DEBOUNCE_MS = 100;

// 8 cardinal zone angles in screen space. 0° = +X (east), 90° = +Y (north, up).
export const CARDINAL_ANGLES_DEG = {
  N: 90,
  NE: 45,
  E: 0,
  SE: -45,
  S: -90,
  SW: -135,
  W: 180,
  NW: 135,
};

export const CARDINAL_KEYS = Object.keys(CARDINAL_ANGLES_DEG);

export const LOGO_MAP = {
  N:  { id: 'rust',      source: 'simple-icons', color: '#CE422B' },
  S:  { id: 'go',        source: 'simple-icons', color: '#00ADD8' },
  W:  { id: 'python',    source: 'simple-icons', color: '#3776AB' },
  E:  { id: 'react',     source: 'simple-icons', color: '#61DAFB' },
  NE: { id: 'anthropic', source: 'lobehub',      color: '#D97757' },
  NW: { id: 'gemini',    source: 'lobehub',      color: '#4285F4' },
  SE: { id: 'star',      source: 'lucide',       color: '#FFD700' },
  SW: { id: 'user',      source: 'lucide',       color: '#A0A0A0' },
};

export const LOBEHUB_CDN_URL = (slug) =>
  `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${slug}.svg`;
