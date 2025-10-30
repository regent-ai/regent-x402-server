/*
  Interactive Perlin-like shader inside a Comet-style card.
  - Reads ?id=### to deterministically seed palette + motion
  - Keeps the canvas pointer-events disabled so the tilt interactivity remains
*/

const clamp = (val, min = 0, max = 100) => Math.min(Math.max(val, min), max);
const round = (val, precision = 3) => parseFloat(val.toFixed(precision));
const adjust = (val, fromMin, fromMax, toMin, toMax) =>
  round(toMin + ((toMax - toMin) * (val - fromMin)) / (fromMax - fromMin));
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const ANIMATION_CONFIG = { SMOOTH_DURATION: 600, INITIAL_DURATION: 1200 };

function getIdFromQuery() {
  const sp = new URLSearchParams(location.search);
  const raw = sp.get("id");
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Mulberry32 PRNG (deterministic per id)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
    default: return [v, t, p];
  }
}

// ==== Tilt/shine interactivity (CSS vars) ====
function initTilt() {
  const wrap = document.getElementById("hc-wrapper");
  const card = document.getElementById("hc-card");
  const tokenIdEl = document.getElementById("token-id");
  if (!wrap || !card || !tokenIdEl) return { setPointer: () => {} };

  const id = getIdFromQuery();
  tokenIdEl.textContent = `#${String(id).padStart(4, "0")}`;

  let rafId = null;
  let lastOffset = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };

  const updateTransform = (offsetX, offsetY) => {
    const { clientWidth: width, clientHeight: height } = card;
    const percentX = clamp((100 / width) * offsetX);
    const percentY = clamp((100 / height) * offsetY);
    const centerX = percentX - 50;
    const centerY = percentY - 50;

    const props = {
      "--pointer-x": `${percentX}%`,
      "--pointer-y": `${percentY}%`,
      "--background-x": `${adjust(percentX, 0, 100, 35, 65)}%`,
      "--background-y": `${adjust(percentY, 0, 100, 35, 65)}%`,
      "--pointer-from-center": `${clamp(Math.hypot(centerY, centerX) / 50, 0, 1)}`,
      "--rotate-x": `${round(-(centerY / 5))}deg`,
      "--rotate-y": `${round(centerX / 4)}deg`,
    };
    Object.entries(props).forEach(([property, value]) => wrap.style.setProperty(property, value));
    lastOffset = { x: offsetX, y: offsetY };
  };

  const cancelAnimation = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

  const smoothAnimation = (duration, startX, startY) => {
    cancelAnimation();
    const startTime = performance.now();
    const targetX = wrap.clientWidth / 2;
    const targetY = wrap.clientHeight / 2;
    const loop = (currentTime) => {
      const progress = clamp((currentTime - startTime) / duration);
      const eased = easeInOutCubic(progress);
      const currentX = adjust(eased, 0, 1, startX, targetX);
      const currentY = adjust(eased, 0, 1, startY, targetY);
      updateTransform(currentX, currentY);
      if (progress < 1) rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  };

  card.addEventListener("pointerenter", () => {
    cancelAnimation();
    wrap.classList.add("active");
    card.classList.add("active");
  });
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    updateTransform(offsetX, offsetY);
  });
  card.addEventListener("pointerleave", () => {
    wrap.classList.remove("active");
    card.classList.remove("active");
    smoothAnimation(ANIMATION_CONFIG.SMOOTH_DURATION, lastOffset.x, lastOffset.y);
  });

  const initialize = () => {
    const initialX = wrap.clientWidth / 2;
    const initialY = wrap.clientHeight / 2;
    updateTransform(initialX, initialY);
    smoothAnimation(ANIMATION_CONFIG.INITIAL_DURATION, initialX, initialY);
  };
  initialize();

  // Expose normalized pointer for shader
  function setPointer(nx, ny) {
    const rect = card.getBoundingClientRect();
    const x = nx * rect.width;
    const y = ny * rect.height;
    updateTransform(x, y);
  }

  return { setPointer, id };
}

// ==== Minimal WebGL2 shader setup ====
const VERTEX_SRC = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// 3D simplex noise (Ashima Arts / Stefan Gustavson)
const NOISE_SNIPPET = `
vec3 mod289(vec3 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);} 
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 g0 = vec3(a0.xy, h.x);
  vec3 g1 = vec3(a1.xy, h.y);
  vec3 g2 = vec3(a0.zw, h.z);
  vec3 g3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g0,g0), dot(g1,g1), dot(g2,g2), dot(g3,g3)));
  g0 *= norm.x; g1 *= norm.y; g2 *= norm.z; g3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(g0,x0), dot(g1,x1), dot(g2,x2), dot(g3,x3)));
}
`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer; // 0..1
uniform float uBaseHue; // 0..1
uniform float uHueRange; // 0..1
uniform float uFrequency;
uniform float uSpeed;
in vec2 vUv;
out vec4 fragColor;
${NOISE_SNIPPET}

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main(){
  vec2 uv = vUv;
  uv += (uPointer - 0.5) * 0.08;
  float n = abs(snoise(vec3(uv * uFrequency, uTime * uSpeed)));
  float h = fract(uBaseHue + uHueRange * n);
  vec3 col = hsv2rgb(vec3(h, 1.0, 1.0));
  fragColor = vec4(col, 1.0);
}
`;

function createProgram(gl, vsSource, fsSource) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSource);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(vs) || "Vertex shader compile failed");
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSource);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(fs) || "Fragment shader compile failed");
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "Program link failed");
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function initGL(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) throw new Error("WebGL2 not supported");

  const program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
  gl.useProgram(program);

  // Fullscreen quad
  const positions = new Float32Array([
    -1, -1,  1, -1,  -1,  1,
    -1,  1,  1, -1,   1,  1,
  ]);
  const uvs = new Float32Array([
     0,  0,  1,  0,   0,  1,
     0,  1,  1,  0,   1,  1,
  ]);

  const posLoc = gl.getAttribLocation(program, "position");
  const uvLoc = gl.getAttribLocation(program, "uv");

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    uResolution: gl.getUniformLocation(program, "uResolution"),
    uTime: gl.getUniformLocation(program, "uTime"),
    uPointer: gl.getUniformLocation(program, "uPointer"),
    uBaseHue: gl.getUniformLocation(program, "uBaseHue"),
    uHueRange: gl.getUniformLocation(program, "uHueRange"),
    uFrequency: gl.getUniformLocation(program, "uFrequency"),
    uSpeed: gl.getUniformLocation(program, "uSpeed"),
  };

  return { gl, program, uniforms };
}

function main() {
  const { setPointer, id } = initTilt();
  const canvas = document.getElementById("perlin-canvas");
  const { gl, uniforms } = initGL(canvas);

  // Seeded palette + params per id
  const rng = mulberry32(id * 2654435761);
  const baseHue = rng(); // 0..1
  const hueRange = 0.12 + rng() * 0.25; // 0.12..0.37
  const frequency = 3.0 + rng() * 5.0; // 3..8
  const speed = 0.2 + rng() * 0.8; // 0.2..1.0

  // Initialize uniforms
  gl.uniform2f(uniforms.uPointer, 0.5, 0.5);
  gl.uniform1f(uniforms.uBaseHue, baseHue);
  gl.uniform1f(uniforms.uHueRange, hueRange);
  gl.uniform1f(uniforms.uFrequency, frequency);
  gl.uniform1f(uniforms.uSpeed, speed);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Forward pointer normalized to shader as well (keeps tilt synced visually)
  const wrap = document.getElementById("hc-wrapper");
  const card = document.getElementById("hc-card");
  const updatePointer = (e) => {
    const rect = card.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    gl.uniform2f(uniforms.uPointer, nx, 1.0 - ny);
    if (setPointer) setPointer(nx, ny);
  };
  card.addEventListener("pointermove", updatePointer);
  card.addEventListener("pointerleave", () => {
    gl.uniform2f(uniforms.uPointer, 0.5, 0.5);
  });

  let rafId = null;
  const loop = (t) => {
    gl.uniform1f(uniforms.uTime, t * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  // Cleanup on unload
  window.addEventListener("beforeunload", () => { if (rafId) cancelAnimationFrame(rafId); ro.disconnect(); });
}

window.addEventListener("DOMContentLoaded", main);


