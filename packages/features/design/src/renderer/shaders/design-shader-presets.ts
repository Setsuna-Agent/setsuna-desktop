import type { ImportDesignShaderInput } from '../../contracts/index.js';

export type DesignShaderSource = Pick<ImportDesignShaderInput, 'name' | 'source'>;
export type DesignShaderPreset = DesignShaderSource & Readonly<{ label: `feature.design.shaderPreset.${string}` }>;

const header = `precision highp float;
/** @resolution */
uniform vec2 u_resolution;
`;
const clock = `/** @time */
uniform float u_time;
`;
const noise = `float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
}

float clouds(vec2 p) {
  float value = 0.0;
  float weight = 0.52;
  for (int i = 0; i < 5; i++) {
    value += noise(p) * weight;
    p = mat2(1.64, 1.23, -1.23, 1.64) * p + 8.4;
    weight *= 0.48;
  }
  return value;
}
`;

// The project receives standalone GLSL so presets can be shared or edited like imported shaders.
export const designShaderPresets: readonly DesignShaderPreset[] = [
  {
    name: 'nebula.glsl', label: 'feature.design.shaderPreset.nebula',
    source: `${header}${clock}
/** @label Dust scale @default 4.5 @range 1, 12 */
uniform float u_scale;
/** @label Stars @default 0.3 @range 0, 1 */
uniform float u_stars;
/** @label Tint @color @default #BD75F3 */
uniform vec3 u_tint;
${noise}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.025;
  vec2 warped = p + vec2(clouds(p * 3.0 + t), clouds(p * 3.0 - 7.0)) * 0.52;
  float dust = clouds(warped * u_scale + t);
  float band = exp(-3.2 * abs(p.y + p.x * 0.42));
  vec3 color = vec3(0.025, 0.036, 0.08) + u_tint * smoothstep(0.3, 0.84, dust) * band * 0.65;
  color += vec3(0.04, 0.42, 0.51) * smoothstep(0.48, 0.79, clouds(warped * u_scale - 10.0)) * band;
  vec2 sky = p * 42.0;
  vec2 cell = floor(sky);
  float seed = hash(cell);
  vec2 point = vec2(hash(cell + 8.3), hash(cell - 13.7)) * 0.64 + 0.18;
  float star = 1.0 - smoothstep(0.018, 0.12, distance(fract(sky), point));
  color += vec3(0.82, 0.91, 1.0) * star * step(1.0 - u_stars * 0.45, seed) * (0.7 + 0.3 * sin(t * 20.0 + seed * 80.0));
  gl_FragColor = vec4(color, 1.0);
}
`,
  },
  {
    name: 'water-caustics.glsl', label: 'feature.design.shaderPreset.water',
    source: `${header}${clock}
/** @label Ripple size @default 5 @range 2, 14 */
uniform float u_scale;
/** @label Speed @default 0.6 @range 0, 2 */
uniform float u_speed;
/** @label Water @color @default #188BBE */
uniform vec3 u_water;

vec2 randomPair(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(139.2, 271.7)), dot(p, vec2(243.1, 91.7)))) * 34783.32);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = gl_FragCoord.xy / min(u_resolution.x, u_resolution.y) * u_scale;
  vec2 cell = floor(p);
  float first = 9.0;
  float second = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 position = 0.5 + 0.32 * sin(randomPair(cell + offset) * 6.283 + u_time * u_speed);
      float d = length(offset + position - fract(p));
      second = min(second, max(d, first));
      first = min(first, d);
    }
  }
  float light = exp(-8.0 * (second - first));
  vec3 base = u_water * (0.84 + 0.4 * uv.y + 0.14 * sin(p.x + p.y));
  gl_FragColor = vec4(mix(base, vec3(0.86, 1.0, 0.99), 0.74 * light), 1.0);
}
`,
  },
  {
    name: 'clouds.glsl', label: 'feature.design.shaderPreset.clouds',
    source: `${header}${clock}
/** @label Scale @default 3.8 @range 1, 12 */
uniform float u_scale;
/** @label Coverage @default 0.55 @range 0, 1 */
uniform float u_coverage;
/** @label Sky @color @default #4C96D5 */
uniform vec3 u_sky;
${noise}
void main() {
  vec2 p = gl_FragCoord.xy / min(u_resolution.x, u_resolution.y) * u_scale;
  p.x += u_time * 0.045;
  float cloud = clouds(p + vec2(0.65 * clouds(p + 9.0), clouds(p - 11.0)));
  float edge = mix(0.73, 0.24, u_coverage);
  float coverage = smoothstep(edge - 0.07, edge + 0.09, cloud);
  float shade = smoothstep(edge, edge + 0.27, cloud);
  vec3 sky = mix(u_sky * 1.24, u_sky * 0.78, gl_FragCoord.y / u_resolution.y);
  gl_FragColor = vec4(mix(sky, mix(vec3(0.72, 0.83, 0.95), vec3(1.0), shade), coverage), 1.0);
}
`,
  },
  {
    name: 'moire.glsl', label: 'feature.design.shaderPreset.moire',
    source: `${header}
/** @label Frequency @default 28 @range 4, 60 */
uniform float u_frequency;
/** @label Angle @default 12 @range -45, 45 */
uniform float u_angle;
/** @label Ink @color @default #2E625A */
uniform vec3 u_ink;
/** @label Paper @color @default #E0FCAD */
uniform vec3 u_paper;

void main() {
  vec2 p = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
  float angle = radians(u_angle);
  vec2 tilted = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * p;
  float waves = cos(length(p + vec2(0.41, 0.28)) * u_frequency * 6.283);
  float lines = cos(tilted.x * u_frequency * 6.283);
  float interference = smoothstep(-0.45, 0.82, 0.6 * (waves + lines) + 0.45 * waves * lines);
  gl_FragColor = vec4(mix(u_paper, u_ink, interference), 1.0);
}
`,
  },
  {
    name: 'glowing-wave.glsl', label: 'feature.design.shaderPreset.wave',
    source: `${header}${clock}
/** @label Amplitude @default 0.24 @range 0, 0.55 */
uniform float u_amplitude;
/** @label Glow @default 0.7 @range 0, 1 */
uniform float u_glow;
/** @label Highlight @color @default #FC7C95 */
uniform vec3 u_highlight;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float phase = uv.x * 8.4 + u_time * 0.42;
  float curve = 0.52 + sin(phase) * u_amplitude + 0.07 * cos(phase * 2.0 + 0.7);
  float d = abs(uv.y - curve);
  float echo = abs(uv.y - curve + 0.13 + 0.12 * sin(phase * 0.7));
  vec3 color = mix(vec3(0.055, 0.047, 0.19), vec3(0.075, 0.12, 0.32), uv.y);
  color += u_glow * (u_highlight * exp(-24.0 * d) + vec3(0.13, 0.56, 0.93) * exp(-17.0 * echo));
  color += u_highlight * (1.0 - smoothstep(0.004, 0.02, d)) * 0.64;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`,
  },
  {
    name: 'dot-pattern.glsl', label: 'feature.design.shaderPreset.pattern',
    source: `${header}
/** @label Columns @default 12 @range 3, 48 */
uniform int u_columns;
/** @label Dot size @default 0.36 @range 0.06, 0.46 */
uniform float u_size;
/** @label Dots @color @default #F4CB73 */
uniform vec3 u_dots;
/** @label Ground @color @default #193D6B */
uniform vec3 u_ground;

void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.x * float(u_columns);
  vec2 cell = floor(p);
  float stepGroup = mod(cell.x + 2.0 * cell.y, 5.0) / 4.0;
  float d = length(fract(p) - 0.5);
  float dotMask = 1.0 - smoothstep(u_size * (0.62 + 0.38 * stepGroup), u_size + 0.02, d);
  vec3 ground = mix(u_ground, u_dots, 0.08 * mod(cell.x + cell.y, 2.0));
  gl_FragColor = vec4(mix(ground, mix(u_dots * 0.74, u_dots, stepGroup), dotMask), 1.0);
}
`,
  },
];
