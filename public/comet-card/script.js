/* global ogl */

const GRID_COUNT = 999;
const MAX_ACTIVE = 14; // cap concurrent WebGL loops for smoothness
const grid = document.getElementById("grid");
const active = new Set(); // Set<CardShader>

const randomFromId = (id) => {
  // deterministic seed in [0,1)
  return ((id * 9301 + 49297) % 233280) / 233280;
};

for (let id = 1; id <= GRID_COUNT; id++) {
  grid.appendChild(buildCard(id, randomFromId(id)));
}

/** Build a single Comet-like card */
function buildCard(id, seed) {
  const card = document.createElement("button");
  card.className = "card";
  card.setAttribute("aria-label", `Regent Animata #${id}`);

  const media = document.createElement("div");
  media.className = "media";

  const canvas = document.createElement("canvas");
  canvas.className = "canvas";
  media.appendChild(canvas);

  const footer = document.createElement("div");
  footer.className = "footer";
  footer.innerHTML = `<div class="label">Regent Animata #${String(id).padStart(3,"0")}</div><div class="muted">#${String(
    id
  ).padStart(3, "0")} <img class="logo" src="../regentlogo.svg" alt="Regent" /></div>`;

  card.appendChild(media);
  card.appendChild(footer);

  // Tilt + pointer uniforms (throttled)
  let tiltRaf = 0;
  let shader = null;

  const onPointerMove = (e) => {
    const rect = card.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width; // 0..1
    const ny = (e.clientY - rect.top) / rect.height; // 0..1
    shader && shader.setPointer(nx, ny);
    if (!tiltRaf) {
      tiltRaf = requestAnimationFrame(() => {
        tiltRaf = 0;
        const x = nx * 2 - 1;
        const y = ny * 2 - 1;
        card.style.setProperty("--rx", `${-y * 8}deg`);
        card.style.setProperty("--ry", `${x * 8}deg`);
      });
    }
  };

  const onPointerLeave = () => {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    shader && shader.setPointer(0.5, 0.5);
  };

  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerleave", onPointerLeave);

  // Lazy-create + start/stop rendering based on visibility
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          if (shader) {
            shader.stop();
            active.delete(shader);
          }
          return;
        }
        // Entered viewport
        if (!shader) shader = new CardShader(canvas, seed);
        // Enforce active cap
        if (active.size >= MAX_ACTIVE) {
          const first = active.values().next().value;
          if (first) {
            first.stop();
            active.delete(first);
          }
        }
        shader.start();
        active.add(shader);
      });
    },
    { rootMargin: "200px 0px", threshold: 0.25 }
  );

  observer.observe(card);
  return card;
}

/** Minimal shader class for a full-bleed plane */
class CardShader {
  constructor(canvas, seed) {
    this.canvas = canvas;
    this.seed = seed;
    this.pointer = [0.5, 0.5];
    this.raf = 0;

    const { Renderer, Camera, Mesh, Plane, Program } = ogl;

    this.renderer = new Renderer({
      canvas,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      antialias: false,
      alpha: false,
      depth: false,
    });
    const gl = (this.gl = this.renderer.gl);
    

    this.camera = new Camera(gl, { near: 0.01, far: 10 });
    this.camera.position.z = 1;

    const geometry = new Plane(gl, { width: 2, height: 2 });

    const VERT = `
      attribute vec2 uv;
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    // Simple fbm-based hue animation with safe-set randomization
    const FRAG = `
      precision mediump float;
      varying vec2 vUv;
      uniform vec2  uResolution;
      uniform float uTime;
      uniform vec2  uPointer;
      uniform float uSeed;
      float rand(float s){ return fract(sin(s)*43758.5453123); }
      float hash(vec2 p){ p = fract(p*vec2(123.34, 234.34)); p += dot(p, p+34.45); return fract(p.x*p.y); }
      float noise(vec2 x){ vec2 i=floor(x); vec2 f=fract(x); float a=hash(i); float b=hash(i+vec2(1.,0.)); float c=hash(i+vec2(0.,1.)); float d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
      float fbm(vec2 p){ float v=0.; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+0.5; a*=0.5; } return v; }
      vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }
      void main(){
        // Safe-set per token
        float r1=rand(uSeed*113.); // baseHue
        float r2=rand(uSeed*227.); // hueRange
        float r3=rand(uSeed*389.); // speed
        float r4=rand(uSeed*521.); // frequency
        float r5=rand(uSeed*677.); // parallax
        float r6=rand(uSeed*811.); // gamma/phase
        float baseHue=r1; float hueRange=mix(0.10,0.30,r2);
        float speed=mix(0.18,0.60,r3); float freq=mix(3.0,8.0,r4);
        float parallax=mix(0.03,0.08,r5); float gamma=mix(0.9,1.2,r6);
        vec2 uv = vUv + (uPointer - 0.5) * parallax;
        float t = uTime*speed + r6*10.0;
        float n = fbm(uv*freq + vec2(t, -t));
        n = pow(n, gamma);
        float hue = fract(baseHue + hueRange*n);
        vec3 col = hsv2rgb(vec3(hue, 1.0, 0.90));
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    this.program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1] },
        uPointer: { value: this.pointer },
        uSeed: { value: seed },
      },
    });

    this.mesh = new Mesh(gl, { geometry, program: this.program });

    // Resize handling
    this.resize = () => {
      const w = this.canvas.clientWidth || 1;
      const h = this.canvas.clientHeight || 1;
      this.renderer.setSize(w, h);
      this.program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
      this.camera.perspective({ aspect: gl.canvas.width / gl.canvas.height });
    };
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(canvas);
    this.resize();
  }
  setPointer(nx, ny) {
    this.pointer[0] = nx;
    this.pointer[1] = 1 - ny; // flip Y so 0 is bottom
  }
  start() {
    if (this.raf) return;
    const loop = (t) => {
      this.program.uniforms.uTime.value = t * 0.001;
      this.renderer.render({ scene: this.mesh, camera: this.camera });
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

document.addEventListener("visibilitychange", () => {
  // Pause all when tab is hidden
  if (document.hidden) {
    active.forEach((s) => s.stop());
  } else {
    active.forEach((s) => s.start());
  }
});


