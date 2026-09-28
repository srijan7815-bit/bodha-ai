// ─────────────────────────────────────────────────────────────────────────────
// WebGL orb engine — the presence at the centre of BODHA's Live Mode.
//
// Taken verbatim from Srijan Singh's nrvs-ai repo (src/lib/orbEngine.js) at his
// request, so the rendering quality is exactly the one he already liked. The
// only change is this header: nothing in the engine was touched, and nrvs-ai
// itself was left alone.
//
// Usage:  const orb = createOrb(canvas, { quality, theme, reducedMotion,
//                                    sampleAudio, onError })
//         orb.start() · orb.setState('listening'|'thinking'|'speaking'|...)
//         orb.resize(w, h) · orb.dispose()
// ─────────────────────────────────────────────────────────────────────────────

// NRVS Live Orb — WebGL2 particle-membrane renderer.
//
// Framework-agnostic engine. React wrapper lives in components/NRVSLiveOrb.jsx.
//
// WHY RAW WEBGL2 AND NOT THREE.JS
// Three.js would add ~600KB to a chat bundle for a single component, and we use
// almost none of it: one geometry, one draw call, custom shaders end to end.
//
// STRUCTURE
//   Pass 1  particle shell → offscreen FBO, additive, on black.
//           The FBO holds "energy", not final colour: rgb = emitted light,
//           a = particle coverage. Both themes read the same buffer.
//   Pass 2  bright-pass + separable blur at 1/4 res (conservative bloom).
//   Pass 3  composite. Dark theme ADDS energy to a near-black background.
//           Light theme SUBTRACTS coverage from white (dark cobalt particles)
//           and adds only the luminous cores. One physical system, two themes.
//
// The dark centre / bright limb in the reference is not painted on: it falls
// out of grazing-angle accumulation (Fresnel-weighted rim) plus the fact that a
// shell of points projects more densely at its silhouette.

// ── Geometry: Fibonacci sphere ────────────────────────────────────────────
// Even angular distribution with no pole clustering, which a lat/long grid
// would give (and which reads instantly as "a spinning ball").
function fibonacciSphere(count) {
  const dir = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  const size = new Float32Array(count)
  const golden = Math.PI * (3 - Math.sqrt(5))
  // Mean angular spacing between neighbours; the jitter is scaled to it so
  // density stays even at any particle count.
  const spacing = Math.sqrt(4 * Math.PI / count)
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const th = golden * i
    let x = Math.cos(th) * r
    let yy = y
    let z = Math.sin(th) * r
    // Decorrelate the lattice: without this the spiral arcs alias into a
    // visible diagonal moiré weave. Full random jitter fixes the moiré but
    // destroys the lattice order and reads as sand, so use a deterministic
    // low-discrepancy offset — irrational multipliers keep neighbour spacing
    // even while breaking the long-range spiral correlation.
    const j = spacing * 0.34
    x += (((i * 0.7548776662) % 1) - 0.5) * j
    yy += (((i * 0.5698402909) % 1) - 0.5) * j
    z += (((i * 0.3819660112) % 1) - 0.5) * j
    const inv = 1 / Math.sqrt(x * x + yy * yy + z * z)
    dir[i * 3] = x * inv
    dir[i * 3 + 1] = yy * inv
    dir[i * 3 + 2] = z * inv
    seed[i] = Math.random()
    // Slight size spread so the lattice never looks machine-uniform.
    size[i] = 0.62 + Math.random() * 0.75
  }
  return { dir, seed, size }
}

// ── Shared GLSL ───────────────────────────────────────────────────────────
const NOISE = `
// Ashima simplex noise (3D).
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
    + i.y+vec4(0.0,i1.y,i2.y,1.0))
    + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`

const PARTICLE_VS = `#version 300 es
precision highp float;
${NOISE}
in vec3 aDir; in float aSeed; in float aSize;

uniform mat4 uProj, uView;
uniform vec3 uCam;
uniform float uTime, uEnergy, uAudioLow, uAudioMid, uAudioHigh;
uniform float uThink, uTension, uScale, uPointScale, uMotion, uRimBoost;
uniform vec3 uL0,uL1,uL2,uL3, uC0,uC1,uC2,uC3;
uniform vec4 uLR;
uniform vec3 uPal0,uPal1,uPal2,uPal3;

out vec3 vCol; out float vCov;

// Layered displacement. Every octave runs on its own time axis at a speed that
// shares no common multiple with the others, so the motion never visibly loops.
float disp(vec3 d, float t){
  // LOW frequency dominates: whole regions of the sphere bulge and cave.
  float low  = snoise(d * 0.78 + vec3( t*0.0431, t*0.0567, -t*0.0389)) * 1.00;
  low       += snoise(d * 1.29 + vec3(-t*0.0293, t*0.0347,  t*0.0511)) * 0.42;
  // MEDIUM: broad ripples travelling over the low-frequency shape. Kept well
  // below the low octave, otherwise the surface reads as crinkled foil.
  float mid  = snoise(d * 2.42 + vec3( t*0.0721,-t*0.0613,  t*0.0668)) * 0.115;
  // MICRO: keeps the membrane from ever feeling frozen. Barely conscious.
  float mic  = snoise(d * 6.10 + vec3(-t*0.1310, t*0.1121,  t*0.0952)) * 0.022;

  float shape = (low * 0.80 + mid) * mix(1.0, 0.66, uTension);

  // THINKING: an asymmetric wave train sweeping the membrane — information
  // moving underneath. Deliberately not rotational, so it reads computational
  // rather than like a spinner.
  float think = snoise(d * 1.62 + vec3(t*0.29, -t*0.21, t*0.25))
              * sin(dot(d, vec3(0.63,0.44,-0.64)) * 2.2 - t * 1.05);

  // AUDIO: masked by noise so voice never scales the sphere uniformly.
  float mask = 0.42 + 0.58 * snoise(d * 1.85 + vec3(t*0.20, -t*0.16, t*0.13));
  float wave = sin(dot(d, vec3(-0.31,0.86,0.40)) * 5.4 - t * 2.7);
  float audio = (uAudioLow * 0.62 + uAudioMid * 0.34 * wave) * mask;

  return (shape * (0.026 + 0.045 * uEnergy)
        + think * 0.042 * uThink
        + audio * 0.075
        + mic  * (0.55 + 0.9 * uAudioHigh)) * uMotion;
}

void main(){
  vec3 d = normalize(aDir);
  float t = uTime;

  float h = disp(d, t);
  vec3 p = d * (1.0 + h);

  // Normal by finite difference on a tangent basis. Costs two extra
  // displacement evaluations but gives real shading instead of a radial fake.
  vec3 up = abs(d.y) < 0.92 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 t1 = normalize(cross(up, d));
  vec3 t2 = normalize(cross(d, t1));
  const float E = 0.075;
  vec3 da = normalize(d + t1 * E);
  vec3 db = normalize(d + t2 * E);
  vec3 pa = da * (1.0 + disp(da, t));
  vec3 pb = db * (1.0 + disp(db, t));
  vec3 n = normalize(cross(pa - p, pb - p));
  if (dot(n, d) < 0.0) n = -n;

  // Voice moves the silhouette by ~1-3% at most: the orb forms the voice, it
  // does not bounce to it.
  vec3 world = p * uScale;

  // Internal illumination: distance to moving energy fields.
  float inten = 0.0; vec3 tint = vec3(0.0);
  float w;
  // Squared falloff concentrates each field into a defined region, so the
  // membrane shows moving illuminated patches with genuinely dark space
  // between them instead of one flat wash.
  w = smoothstep(uLR.x, 0.0, distance(world, uL0)); w *= w * 1.6; inten += w; tint += uC0 * w;
  w = smoothstep(uLR.y, 0.0, distance(world, uL1)); w *= w * 1.6; inten += w; tint += uC1 * w;
  w = smoothstep(uLR.z, 0.0, distance(world, uL2)); w *= w * 1.6; inten += w; tint += uC2 * w;
  w = smoothstep(uLR.w, 0.0, distance(world, uL3)); w *= w * 1.6; inten += w; tint += uC3 * w;
  tint = tint / max(inten, 0.0001);
  inten = clamp(inten, 0.0, 1.30);

  // Deformation feeds illumination: expanding regions catch more light.
  inten *= 1.0 + clamp(h, -0.1, 0.1) * 2.4;

  vec4 mv = uView * vec4(world, 1.0);
  vec3 vdir = normalize(uCam - world);
  float ndv = dot(n, vdir);

  // Grazing angles accumulate — this is what produces the dark core and the
  // luminous limb, rather than a painted-on gradient.
  float rim = pow(1.0 - abs(ndv), 2.6);
  // Break the rim up so it never closes into a full traced outline.
  float rimMask = 0.35 + 0.65 * smoothstep(0.15, 0.85,
      inten * 0.6 + 0.5 + 0.5 * snoise(d * 2.1 + vec3(t*0.05, -t*0.04, t*0.03)));
  rim *= rimMask * uRimBoost;

  // Back of the shell is dimmer, so the object reads as volumetric.
  float facing = ndv > 0.0 ? 1.0 : 0.30;
  float depth = clamp((mv.z + 5.6) / 3.0, 0.0, 1.0);
  float depthAtt = mix(0.34, 1.0, depth);

  // Two separable contributions:
  //   body  — internal energy fields glowing through the membrane
  //   limb  — grazing-angle accumulation
  // Keeping them additive (not multiplied) stops the rim from flattening the
  // interior into a uniform shell.
  float body = pow(inten, 1.08) * 1.55;
  float limb = rim * (0.45 + 1.35 * inten);
  // Directional key. Without it a correctly-computed rim is uniform all the
  // way round the silhouette, which reads flat and cheap.
  vec3 key = normalize(vec3(-0.55, 0.68, 0.48));
  float kd = 0.35 + 0.85 * max(0.0, dot(n, key));
  float lum = (0.055 + body * kd + limb * (0.55 + 0.75 * kd)) * facing * depthAtt;
  lum *= 0.70 + 0.55 * uEnergy;
  // Per-particle variation: never a uniform lattice.
  lum *= 0.72 + 0.55 * aSeed;
  lum += uAudioHigh * 0.05 * aSeed * rim;

  // Palette ramp driven by illumination, not by a rainbow sweep.
  float g = clamp(inten * 0.85 + rim * 0.45, 0.0, 1.0);
  vec3 col = mix(uPal0, uPal1, smoothstep(0.00, 0.34, g));
  col = mix(col, uPal2, smoothstep(0.30, 0.68, g));
  col = mix(col, uPal3, smoothstep(0.66, 1.00, g));
  col = mix(col, tint, 0.46);

  vCol = col * lum;
  vCov = clamp(lum * 2.3, 0.0, 1.0);

  gl_Position = uProj * mv;
  gl_PointSize = max(1.0, uPointScale * aSize * (1.0 / max(0.35, -mv.z)));
}`

const PARTICLE_FS = `#version 300 es
precision highp float;
in vec3 vCol; in float vCov;
out vec4 frag;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  // Soft-edged dot: fine grains that merge into a surface at a distance.
  float a = smoothstep(0.25, 0.015, r2);
  frag = vec4(vCol * a, vCov * a);
}`

// Layer 1: a soft translucent inner body. Drawn behind the particle shell so
// the membrane reads as the SURFACE OF A VOLUME rather than a hollow cloud of
// points. Analytic sphere impostor on a fullscreen triangle — no extra geometry.
const BODY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform float uScale, uEnergy, uLight;
uniform vec3 uL0,uL1,uL2,uL3, uC0,uC1,uC2,uC3;
uniform vec4 uLR;
uniform mat4 uView;
out vec4 frag;
void main(){
  vec2 p = (vUv * 2.0 - 1.0);
  p.x *= uRes.x / uRes.y;
  // Match the perspective footprint of the shell.
  float R = uScale * 0.845;
  float r = length(p);
  if (r > R) { frag = vec4(0.0); return; }
  float z = sqrt(max(0.0, R*R - r*r));
  // Reconstruct an object-space point on the near hemisphere.
  vec3 hit = vec3(p, z);
  vec3 obj = (transpose(mat3(uView)) * hit);
  float inten = 0.0; vec3 tint = vec3(0.0); float w;
  w = smoothstep(uLR.x, 0.0, distance(obj, uL0)); inten += w; tint += uC0 * w;
  w = smoothstep(uLR.y, 0.0, distance(obj, uL1)); inten += w; tint += uC1 * w;
  w = smoothstep(uLR.z, 0.0, distance(obj, uL2)); inten += w; tint += uC2 * w;
  w = smoothstep(uLR.w, 0.0, distance(obj, uL3)); inten += w; tint += uC3 * w;
  tint = tint / max(inten, 0.0001);
  inten = clamp(inten, 0.0, 1.0);
  // Densest toward the middle of the volume, fading out before the silhouette
  // so it never competes with the particle rim.
  float body = pow(1.0 - r / R, 1.9) * (0.16 + 0.30 * uEnergy) * inten;
  frag = vec4(tint * body, body);
}`

const QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform float uThreshold;
out vec4 frag;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  frag = vec4(c * smoothstep(uThreshold, uThreshold + 0.35, l), 1.0);
}`

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir;
out vec4 frag;
void main(){
  // 9-tap gaussian.
  vec3 s = texture(uTex, vUv).rgb * 0.2270270270;
  s += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  frag = vec4(s, 1.0);
}`

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uBloom;
uniform float uBloomStrength, uLight;
uniform vec3 uBg, uInk;
out vec4 frag;
void main(){
  vec4 sc = texture(uScene, vUv);
  vec3 bl = texture(uBloom, vUv).rgb;
  vec3 outc;
  float alpha;
  if (uLight > 0.5) {
    // LIGHT THEME — not an inversion. Particle coverage darkens the page
    // toward deep cobalt; only the luminous cores add light back.
    // Coverage is gamma-shaped so the dense limb reads strongly while the
    // sparse interior stays airy.
    float cov = pow(clamp(sc.a * 2.15, 0.0, 1.0), 0.95);
    vec3 energy = sc.rgb * 0.95 + bl * uBloomStrength * 0.55;
    // Tonemap only the emitted light, then ink the background with coverage.
    energy = energy / (1.0 + energy * 0.85);
    // Ink the page toward cobalt where particles are dense; stay transparent
    // elsewhere so the orb sits ON the page, not in a box.
    outc = mix(uBg, uInk, cov * 0.88) + energy * 0.85;
    alpha = clamp(cov * 1.05 + dot(energy, vec3(0.8)), 0.0, 1.0);
    outc = mix(uBg, outc, alpha > 0.0001 ? 1.0 : 0.0);
  } else {
    // DARK THEME — emissive energy over near-black.
    vec3 energy = sc.rgb + bl * uBloomStrength;
    energy = energy / (1.0 + energy * 0.24);
    outc = energy;
    // Emissive over a dark page: alpha follows emitted luminance.
    alpha = clamp(dot(energy, vec3(1.4)) + sc.a * 0.55, 0.0, 1.0);
  }
  outc = clamp(outc, 0.0, 1.0);
  alpha = clamp(alpha, 0.0, 1.0);
  // Premultiplied: canvas is composited over the real page background.
  frag = vec4(outc * alpha, alpha);
}`

// ── Palettes ──────────────────────────────────────────────────────────────
const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
]

const THEMES = {
  dark: {
    bg: hex('#050304'),
    ink: hex('#000000'),
    pal: [hex('#120609'), hex('#5C101A'), hex('#A41F25'), hex('#FF7A32')],
    lights: [hex('#A41F25'), hex('#E34A2B'), hex('#FF7A32'), hex('#5C101A')],
    bloom: 0.85,
    rim: 1.0,
  },
  light: {
    bg: hex('#F7F9FC'),
    ink: hex('#102A70'),
    pal: [hex('#0B1F55'), hex('#164CCB'), hex('#2878FF'), hex('#B9DDFF')],
    lights: [hex('#164CCB'), hex('#2878FF'), hex('#65B8FF'), hex('#102A70')],
    bloom: 0.42,
    rim: 0.80,
    inkGain: 1.35,
  },
}

const lerp3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]

/** Interpolate the whole theme so a switch is a material change, not a cut. */
function blendTheme(m) {
  if (m <= 0.001) return THEMES.dark
  if (m >= 0.999) return THEMES.light
  const d = THEMES.dark, l = THEMES.light
  return {
    bg: lerp3(d.bg, l.bg, m),
    ink: lerp3(d.ink, l.ink, m),
    pal: d.pal.map((c, i) => lerp3(c, l.pal[i], m)),
    lights: d.lights.map((c, i) => lerp3(c, l.lights[i], m)),
    bloom: d.bloom + (l.bloom - d.bloom) * m,
    rim: d.rim + (l.rim - d.rim) * m,
  }
}

// ── State targets ─────────────────────────────────────────────────────────
// Every state drives the SAME physical system — only these numbers differ.
const STATES = {
  idle:       { energy: 0.20, think: 0.05, tension: 0.10, audio: 0.35, light: 0.55, scale: 1.000, rim: 1.00 },
  connecting: { energy: 0.30, think: 0.22, tension: 0.55, audio: 0.20, light: 1.35, scale: 0.955, rim: 1.10 },
  listening:  { energy: 0.42, think: 0.10, tension: 0.62, audio: 1.00, light: 0.85, scale: 0.985, rim: 1.18 },
  thinking:   { energy: 0.62, think: 1.00, tension: 0.28, audio: 0.30, light: 1.70, scale: 1.010, rim: 1.05 },
  speaking:   { energy: 0.58, think: 0.18, tension: 0.34, audio: 1.00, light: 1.10, scale: 1.005, rim: 1.12 },
  error:      { energy: 0.34, think: 0.12, tension: 0.90, audio: 0.15, light: 0.45, scale: 0.930, rim: 0.85 },
}

const QUALITY = {
  high:   { count: 92000, dpr: 2.0, bloom: true,  pointScale: 3.5 },
  medium: { count: 46000, dpr: 1.5, bloom: true,  pointScale: 4.2 },
  low:    { count: 18000, dpr: 1.25, bloom: false, pointScale: 5.4 },
}

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s)
    gl.deleteShader(s)
    throw new Error('shader: ' + log)
  }
  return s
}

function program(gl, vs, fs) {
  const p = gl.createProgram()
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p)
  gl.deleteShader(v); gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p)
    gl.deleteProgram(p)
    throw new Error('link: ' + log)
  }
  return p
}

function damp(cur, target, ms, dt) {
  if (ms <= 0) return target
  return cur + (target - cur) * (1 - Math.exp(-dt / (ms / 1000)))
}

/**
 * Create the orb renderer.
 * Returns a handle, or null when WebGL2 is unavailable (caller shows a
 * CSS fallback).
 */
export function createOrb(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false,
    premultipliedAlpha: true, powerPreference: 'high-performance',
    // Off in production (it costs bandwidth); the visual-regression harness
    // turns it on so it can read pixels back after compositing.
    preserveDrawingBuffer: Boolean(opts.preserveDrawingBuffer),
  })
  if (!gl) return null

  let quality = opts.quality && opts.quality !== 'auto' ? opts.quality : 'high'
  const autoQuality = !opts.quality || opts.quality === 'auto'
  let theme = opts.theme === 'light' ? 'light' : 'dark'
  // Themes cross-fade: 0 = dark, 1 = light. A hard cut looked like a bug.
  let themeMix = theme === 'light' ? 1 : 0
  let reduced = Boolean(opts.reducedMotion)

  let prog, bright, blur, comp, body, vao, buffers = []
  let fbo = null, tex = null, bloomFbo = [], bloomTex = []
  let W = 1, H = 1, bw = 1, bh = 1
  let count = 0
  let raf = 0, running = false, disposed = false
  let last = 0, clock = 0

  // Current vs target — nothing is ever assigned directly.
  const cur = { ...STATES.idle, aLow: 0, aMid: 0, aHigh: 0, rms: 0 }
  // Optional external audio override (orb.setAudioLevel / setFrequencyData).
  // When unset the orb pulls from its own analyser bus.
  let extAudio = null
  let target = { ...STATES.idle }
  let stateName = 'idle'
  let errorPulse = 0

  // FPS tracking for adaptive quality.
  let frames = 0, accum = 0, downgraded = 0

  function buildGeometry() {
    buffers.forEach((b) => gl.deleteBuffer(b))
    buffers = []
    if (vao) gl.deleteVertexArray(vao)
    count = QUALITY[quality].count
    const { dir, seed, size } = fibonacciSphere(count)
    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const mk = (data, loc, comps) => {
      const b = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0)
      buffers.push(b)
    }
    mk(dir, 0, 3); mk(seed, 1, 1); mk(size, 2, 1)
    gl.bindVertexArray(null)
  }

  function makeTarget(w, h) {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const f = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, f)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return [f, t]
  }

  function releaseTargets() {
    if (fbo) gl.deleteFramebuffer(fbo)
    if (tex) gl.deleteTexture(tex)
    bloomFbo.forEach((f) => gl.deleteFramebuffer(f))
    bloomTex.forEach((t) => gl.deleteTexture(t))
    fbo = null; tex = null; bloomFbo = []; bloomTex = []
  }

  function resize(cssW, cssH) {
    const dprCap = QUALITY[quality].dpr
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (w === W && h === H) return
    W = w; H = h
    canvas.width = W; canvas.height = H
    releaseTargets()
    ;[fbo, tex] = makeTarget(W, H)
    bw = Math.max(1, W >> 2); bh = Math.max(1, H >> 2)
    for (let i = 0; i < 2; i++) {
      const [f, t] = makeTarget(bw, bh)
      bloomFbo.push(f); bloomTex.push(t)
    }
  }

  try {
    prog = program(gl, PARTICLE_VS, PARTICLE_FS)
    bright = program(gl, QUAD_VS, BRIGHT_FS)
    blur = program(gl, QUAD_VS, BLUR_FS)
    comp = program(gl, QUAD_VS, COMPOSITE_FS)
    body = program(gl, QUAD_VS, BODY_FS)
  } catch (e) {
    if (opts.onError) opts.onError(e)
    return null
  }
  buildGeometry()

  const U = {}
  const u = (name) => {
    if (!(name in U)) U[name] = gl.getUniformLocation(prog, name)
    return U[name]
  }

  const emptyVao = gl.createVertexArray()

  // Camera: fixed, mild perspective. The orb's life comes from surface motion,
  // not from orbiting — an obviously rotating ball kills the illusion.
  const CAM = [0, 0, 4.15]
  const proj = new Float32Array(16)
  const view = new Float32Array(16)

  function setProj(aspect) {
    const fov = 40 * Math.PI / 180
    const f = 1 / Math.tan(fov / 2)
    const near = 0.1, far = 100
    proj.fill(0)
    proj[0] = f / aspect; proj[5] = f
    proj[10] = (far + near) / (near - far); proj[11] = -1
    proj[14] = (2 * far * near) / (near - far)
  }

  // Camera position expressed in object space. The view matrix rotates the
  // world, so a FIXED world-space uCam slowly diverges from the true eye ray —
  // after ~2 minutes the Fresnel term lit the far side of the orb (144° error).
  const camObj = new Float32Array(3)

  function setView(t) {
    // Extremely slow orientation drift — under a degree per second, on two
    // incommensurate periods. Present, but never legible as "spinning".
    const ax = Math.sin(t * 0.037) * 0.10
    const ay = t * 0.021
    const cy = Math.cos(ay), sy = Math.sin(ay)
    const cx = Math.cos(ax), sx = Math.sin(ax)
    // R = Ry * Rx, then translate by -CAM.
    view[0] = cy;      view[1] = sy * sx;  view[2] = -sy * cx; view[3] = 0
    view[4] = 0;       view[5] = cx;       view[6] = sx;       view[7] = 0
    view[8] = sy;      view[9] = -cy * sx; view[10] = cy * cx; view[11] = 0
    view[12] = 0;      view[13] = 0;       view[14] = -CAM[2]; view[15] = 1

    // R is orthonormal, so the eye in object space is Rᵀ·(0,0,d).
    camObj[0] = -sy * cx * CAM[2]
    camObj[1] = sx * CAM[2]
    camObj[2] = cy * cx * CAM[2]
  }

  // Light fields: 4 blobs on slow, mutually non-repeating trajectories.
  const lp = [new Float32Array(3), new Float32Array(3), new Float32Array(3), new Float32Array(3)]
  const lr = new Float32Array(4)
  function moveLights(t, speed) {
    const s = t * speed
    lp[0][0] = Math.sin(s * 0.31) * 0.95; lp[0][1] = Math.cos(s * 0.23) * 0.80; lp[0][2] = Math.sin(s * 0.19 + 1.1) * 0.85
    lp[1][0] = Math.cos(s * 0.17 + 2.0) * 0.90; lp[1][1] = Math.sin(s * 0.29 + 0.4) * 0.95; lp[1][2] = Math.cos(s * 0.37) * 0.75
    lp[2][0] = Math.sin(s * 0.41 + 4.1) * 0.75; lp[2][1] = Math.sin(s * 0.13 + 2.7) * 0.85; lp[2][2] = Math.cos(s * 0.27 + 3.3) * 0.95
    lp[3][0] = Math.cos(s * 0.11 + 5.2) * 1.00; lp[3][1] = Math.cos(s * 0.33 + 1.6) * 0.70; lp[3][2] = Math.sin(s * 0.23 + 4.8) * 0.80
    const base = 1.55 + cur.energy * 0.35
    lr[0] = base; lr[1] = base * 0.86; lr[2] = base * 1.10; lr[3] = base * 0.72
  }

  function frame(now) {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    if (!last) last = now
    let dt = (now - last) / 1000
    last = now
    // Clamp so a backgrounded tab does not jump the simulation.
    dt = Math.min(dt, 0.05)

    // Adaptive quality: sustained slow frames step the tier down once.
    if (autoQuality) {
      frames++; accum += dt
      // Time-gated, not frame-gated: at 9fps a 90-frame window would be ten
      // seconds of visible jank before we reacted.
      if (accum >= 1.4 && frames >= 12) {
        const fps = frames / accum
        if (fps < 34 && downgraded < 2) {
          quality = downgraded === 0 ? 'medium' : 'low'
          downgraded++
          buildGeometry()
          W = H = 0
          resize(canvas.clientWidth || 1, canvas.clientHeight || 1)
        }
        frames = 0; accum = 0
      }
    }

    const motion = reduced ? 0.22 : 1.0
    clock += dt * (reduced ? 0.35 : 1.0) * (0.55 + cur.light * 0.55)

    const audio = extAudio
      || (opts.sampleAudio ? opts.sampleAudio(dt) : { rms: 0, low: 0, mid: 0, high: 0 })

    // Damp every parameter toward its target. Different constants per
    // parameter so the orb feels physical rather than uniformly eased.
    cur.energy  = damp(cur.energy,  target.energy,  520, dt)
    cur.think   = damp(cur.think,   target.think,   700, dt)
    cur.tension = damp(cur.tension, target.tension, 420, dt)
    cur.light   = damp(cur.light,   target.light,   900, dt)
    cur.rim     = damp(cur.rim,     target.rim,     600, dt)

    // Error is a controlled contraction that recovers, not a red flash.
    if (errorPulse > 0) errorPulse = Math.max(0, errorPulse - dt / 0.75)
    const contract = Math.sin(errorPulse * Math.PI) * 0.05

    const inf = target.audio
    cur.aLow  = damp(cur.aLow,  audio.low  * inf, 260, dt)
    cur.aMid  = damp(cur.aMid,  audio.mid  * inf, 200, dt)
    cur.aHigh = damp(cur.aHigh, audio.high * inf, 170, dt)
    cur.rms   = damp(cur.rms,   audio.rms  * inf, 240, dt)

    // Overall scale barely moves: 1-3% ceiling, per spec.
    const scaleTarget = target.scale + cur.rms * 0.022 - contract
    cur.scale = damp(cur.scale, scaleTarget, 260, dt)

    moveLights(clock, 0.55 + cur.light * 0.75)
    setProj(W / Math.max(1, H))
    setView(clock)

    // Blend the two palettes so switching themes is a smooth material change
    // rather than an instant swap.
    themeMix = damp(themeMix, theme === 'light' ? 1 : 0, 420, dt)
    const th = blendTheme(themeMix)

    // ── Pass 1: particles → scene FBO ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, W, H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)   // additive accumulation

    // Layer 1 — translucent inner body, behind the membrane.
    gl.bindVertexArray(emptyVao)
    gl.useProgram(body)
    gl.uniform2f(gl.getUniformLocation(body, 'uRes'), W, H)
    gl.uniform1f(gl.getUniformLocation(body, 'uScale'), cur.scale)
    gl.uniform1f(gl.getUniformLocation(body, 'uEnergy'), cur.energy)
    gl.uniformMatrix4fv(gl.getUniformLocation(body, 'uView'), false, view)
    gl.uniform3fv(gl.getUniformLocation(body, 'uL0'), lp[0])
    gl.uniform3fv(gl.getUniformLocation(body, 'uL1'), lp[1])
    gl.uniform3fv(gl.getUniformLocation(body, 'uL2'), lp[2])
    gl.uniform3fv(gl.getUniformLocation(body, 'uL3'), lp[3])
    gl.uniform3fv(gl.getUniformLocation(body, 'uC0'), th.lights[0])
    gl.uniform3fv(gl.getUniformLocation(body, 'uC1'), th.lights[1])
    gl.uniform3fv(gl.getUniformLocation(body, 'uC2'), th.lights[2])
    gl.uniform3fv(gl.getUniformLocation(body, 'uC3'), th.lights[3])
    gl.uniform4fv(gl.getUniformLocation(body, 'uLR'), lr)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.useProgram(prog)
    gl.bindVertexArray(vao)

    gl.uniformMatrix4fv(u('uProj'), false, proj)
    gl.uniformMatrix4fv(u('uView'), false, view)
    gl.uniform3fv(u('uCam'), camObj)
    gl.uniform1f(u('uTime'), clock)
    gl.uniform1f(u('uEnergy'), cur.energy)
    gl.uniform1f(u('uAudioLow'), cur.aLow)
    gl.uniform1f(u('uAudioMid'), cur.aMid)
    gl.uniform1f(u('uAudioHigh'), cur.aHigh)
    gl.uniform1f(u('uThink'), cur.think)
    gl.uniform1f(u('uTension'), cur.tension)
    gl.uniform1f(u('uScale'), cur.scale)
    gl.uniform1f(u('uMotion'), motion)
    gl.uniform1f(u('uRimBoost'), cur.rim * th.rim)
    const dprNow = Math.min(window.devicePixelRatio || 1, QUALITY[quality].dpr)
    gl.uniform1f(u('uPointScale'), QUALITY[quality].pointScale * dprNow)
    gl.uniform3fv(u('uL0'), lp[0]); gl.uniform3fv(u('uL1'), lp[1])
    gl.uniform3fv(u('uL2'), lp[2]); gl.uniform3fv(u('uL3'), lp[3])
    gl.uniform3fv(u('uC0'), th.lights[0]); gl.uniform3fv(u('uC1'), th.lights[1])
    gl.uniform3fv(u('uC2'), th.lights[2]); gl.uniform3fv(u('uC3'), th.lights[3])
    gl.uniform4fv(u('uLR'), lr)
    gl.uniform3fv(u('uPal0'), th.pal[0]); gl.uniform3fv(u('uPal1'), th.pal[1])
    gl.uniform3fv(u('uPal2'), th.pal[2]); gl.uniform3fv(u('uPal3'), th.pal[3])

    gl.drawArrays(gl.POINTS, 0, count)
    gl.bindVertexArray(null)

    // ── Pass 2: bloom ──
    const useBloom = QUALITY[quality].bloom
    gl.bindVertexArray(emptyVao)
    if (useBloom) {
      gl.disable(gl.BLEND)
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[0])
      gl.viewport(0, 0, bw, bh)
      gl.useProgram(bright)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(gl.getUniformLocation(bright, 'uTex'), 0)
      gl.uniform1f(gl.getUniformLocation(bright, 'uThreshold'), 0.26 + 0.19 * themeMix)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      gl.useProgram(blur)
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[1])
        gl.bindTexture(gl.TEXTURE_2D, bloomTex[0])
        gl.uniform1i(gl.getUniformLocation(blur, 'uTex'), 0)
        gl.uniform2f(gl.getUniformLocation(blur, 'uDir'), 1 / bw, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[0])
        gl.bindTexture(gl.TEXTURE_2D, bloomTex[1])
        gl.uniform2f(gl.getUniformLocation(blur, 'uDir'), 0, 1 / bh)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
    }

    // ── Pass 3: composite ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    gl.disable(gl.BLEND)
    gl.useProgram(comp)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(comp, 'uScene'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, useBloom ? bloomTex[0] : tex)
    gl.uniform1i(gl.getUniformLocation(comp, 'uBloom'), 1)
    gl.uniform1f(gl.getUniformLocation(comp, 'uBloomStrength'), useBloom ? th.bloom : 0)
    gl.uniform1f(gl.getUniformLocation(comp, 'uLight'), themeMix)
    gl.uniform3fv(gl.getUniformLocation(comp, 'uBg'), th.bg)
    gl.uniform3fv(gl.getUniformLocation(comp, 'uInk'), th.ink)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  const onLost = (e) => {
    // preventDefault() is what makes the browser willing to fire
    // 'webglcontextrestored' afterwards.
    e.preventDefault()
    running = false
    cancelAnimationFrame(raf)
    opts.onContextLost?.()
  }
  canvas.addEventListener('webglcontextlost', onLost)

  return {
    resize,
    start() {
      if (running || disposed) return
      running = true; last = 0
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
    setState(name) {
      const next = STATES[name] || STATES.idle
      if (name === 'error' && stateName !== 'error') errorPulse = 1
      stateName = name
      target = { ...next }
    },
    setTheme(t) { theme = t === 'light' ? 'light' : 'dark' },
    /** Drive the orb from an external 0..1 level instead of the audio bus. */
    setAudioLevel(v) {
      if (v == null) { extAudio = null; return }
      const n = Math.max(0, Math.min(1, Number(v) || 0))
      extAudio = { rms: n, low: n * 0.9, mid: n * 0.65, high: n * 0.4 }
    },
    /** Drive from a real FFT array (Uint8 0..255 or Float 0..1). */
    setFrequencyData(bins) {
      if (!bins || !bins.length) { extAudio = null; return }
      const n = bins.length
      const norm = bins[0] > 1 ? 255 : 1
      const band = (a, b) => {
        let s2 = 0
        for (let i = a; i < b; i++) s2 += bins[i]
        return b > a ? (s2 / (b - a)) / norm : 0
      }
      const low = band(0, Math.floor(n * 0.06))
      const mid = band(Math.floor(n * 0.06), Math.floor(n * 0.26))
      const high = band(Math.floor(n * 0.26), Math.floor(n * 0.70))
      extAudio = { rms: Math.max(low, mid, high), low, mid, high }
    },
    getThemeMix: () => themeMix,
    setReducedMotion(v) { reduced = Boolean(v) },
    getQuality: () => quality,
    dispose() {
      disposed = true
      running = false
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      releaseTargets()
      buffers.forEach((b) => gl.deleteBuffer(b))
      if (vao) gl.deleteVertexArray(vao)
      if (emptyVao) gl.deleteVertexArray(emptyVao)
      ;[prog, bright, blur, comp, body].forEach((p) => p && gl.deleteProgram(p))
      // Only force-lose a context that is still alive; calling this on an
      // already-lost context can stop 'webglcontextrestored' from arriving.
      if (!gl.isContextLost()) {
        const ext = gl.getExtension('WEBGL_lose_context')
        if (ext) ext.loseContext()
      }
    },
  }
}

export const __test__ = { STATES, QUALITY, THEMES, fibonacciSphere, damp }
