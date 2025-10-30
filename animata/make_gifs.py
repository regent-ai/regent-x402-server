import os, math, json, random, pathlib
from typing import Tuple, List

import numpy as np
from PIL import Image
import imageio
import moderngl

# ---------- output & render settings ----------
OUT_DIR   = pathlib.Path("out_gifs")
COUNT     = 5         # set to 5 for a quick test, then 999
WIDTH     = 512          # 512 or 768 is a good balance for GIFs
HEIGHT    = 512
FPS       = 24           # 24fps * 4s = 96 frames
DURATION  = 4.0          # seconds; fixed loop length
FRAMES    = int(FPS * DURATION)

# ---------- load shader ----------
FRAG_SRC = open("shader_frag.glsl", "r", encoding="utf-8").read()
VERT_SRC = """#version 330
void main() {
    // Full-screen triangle using gl_VertexID
    vec2 pos = vec2(-1.0, -1.0);
    if (gl_VertexID == 1) pos = vec2( 3.0, -1.0);
    else if (gl_VertexID == 2) pos = vec2(-1.0,  3.0);
    gl_Position = vec4(pos, 0.0, 1.0);
}
"""

def choose_params(seed: int):
    rng = random.Random(seed)

    # Hue: 4 integers in [0..6]
    hues = [rng.randint(0, 6) for _ in range(4)]

    # Rotation speed: one of {2, 3, 4}
    rot_speed = rng.choice([2.0, 3.0, 4.0])

    # Scale: 0.08..0.18 inclusive, step 0.01
    scales = [x / 100.0 for x in range(8, 19)]
    u_scale = rng.choice(scales)

    # Dot divisor: 0.5..0.9 inclusive, step 0.1
    u_dotdiv = rng.choice([0.5, 0.6, 0.7, 0.8, 0.9])

    return hues, rot_speed, u_scale, u_dotdiv

def ensure_dir(p: pathlib.Path):
    p.mkdir(parents=True, exist_ok=True)

def main():
    ensure_dir(OUT_DIR)

    # Headless GL context
    ctx = moderngl.create_standalone_context(require=330)
    prog = ctx.program(vertex_shader=VERT_SRC, fragment_shader=FRAG_SRC)
    vao  = ctx.vertex_array(prog, [])

    # Offscreen framebuffer
    fbo = ctx.simple_framebuffer((WIDTH, HEIGHT), components=4)
    fbo.use()
    # Ensure viewport matches framebuffer size
    ctx.viewport = (0, 0, WIDTH, HEIGHT)

    # Static uniforms
    prog["iResolution"].value = (float(WIDTH), float(HEIGHT), 1.0)

    for token_id in range(1, COUNT + 1):
        hues, rot_speed, u_scale, u_dotdiv = choose_params(token_id)

        # Set per-token uniforms
        prog["uHueI"].value      = tuple(int(h) for h in hues)
        prog["uRotSpeed"].value  = float(rot_speed)
        prog["uScale"].value     = float(u_scale)
        prog["uDotDiv"].value    = float(u_dotdiv)

        # Outputs
        gif_path  = OUT_DIR / f"{token_id:04d}.gif"
        meta_path = OUT_DIR / f"{token_id:04d}.json"

        # JSON sidecar (handy later for NFT metadata)
        with open(meta_path, "w", encoding="utf-8") as jf:
            json.dump({
                "token_id": token_id,
                "hue": hues,                   # four ints [0..6]
                "rotation_speed": rot_speed,   # 2, 3, or 4
                "scale": u_scale,              # 0.08..0.18
                "dot_divisor": u_dotdiv,       # 0.5..0.9
                "width": WIDTH,
                "height": HEIGHT,
                "fps": FPS,
                "duration_seconds": DURATION
            }, jf, indent=2)

        # Stream frames directly to GIF (low memory)
        with imageio.get_writer(
            gif_path,
            mode="I",
            duration=(DURATION/FRAMES),  # per-frame delay in seconds
            loop=0                       # loop forever
        ) as writer:

            for frame in range(FRAMES):
                # Drive iTime so that (iTime / uRotSpeed) runs 0..2π over exactly 4 seconds.
                # iTime(t) = 2π * uRotSpeed * (t / DURATION)
                phase = (2.0 * math.pi) * (frame / FRAMES)
                iTime = phase * rot_speed  # => (iTime / rot_speed) == phase

                prog["iTime"].value = float(iTime)

                fbo.clear(0.0, 0.0, 0.0, 1.0)
                vao.render(mode=moderngl.TRIANGLES, vertices=3)
                ctx.finish()

                # Read RGB, flip vertically (OpenGL origin is bottom-left)
                data = fbo.read(components=3, dtype="u1", alignment=1)
                img = np.frombuffer(data, dtype=np.uint8).reshape((HEIGHT, WIDTH, 3))
                img = np.flipud(img)
                # Ensure contiguous (avoid negative strides)
                img = np.ascontiguousarray(img)

                writer.append_data(img)

        print(f"[✓] {gif_path}  (speed={rot_speed}, scale={u_scale:.2f}, dot={u_dotdiv:.1f}, hue={hues})")

if __name__ == "__main__":
    main()
