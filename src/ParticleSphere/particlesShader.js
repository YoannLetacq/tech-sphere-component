/**
 * GLSL shader source for the ShaderMaterial used by <Particles>.
 * Uniforms:
 *   uSize       — base particle size (world units)
 *   uDepthScale — how strongly depth attenuates point size
 * Per-vertex attributes:
 *   position    — current (morph-interpolated) world position
 *   color       — per-particle RGB (updated on color tween)
 */

export const VERTEX_SHADER = /* glsl */ `
  uniform float uSize;
  uniform float uDepthScale;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    // Slight attenuation: closer particles are larger, clamped to avoid blowup.
    float pointSize = (uSize * 300.0) / max(depth, 0.1);
    pointSize *= mix(1.0, 1.0 - clamp(depth * 0.02, 0.0, 0.5), uDepthScale);
    gl_PointSize = pointSize;
    gl_Position = projectionMatrix * mv;
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // Soft circular disc: discard fragments outside the unit circle,
    // fade alpha toward the edge for anti-aliased dots.
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.35, d);
    gl_FragColor = vec4(vColor, alpha);
  }
`;
