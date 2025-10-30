import os, math, json, random, pathlib, argparse, subprocess, shutil
import numpy as np
from PIL import Image
import imageio
import imageio_ffmpeg  # ensure ffmpeg backend is available
import moderngl

# --------------------- CLI ---------------------
def parse_args():
    p = argparse.ArgumentParser(
        description="Render shader animations to GIF/MP4/WebM + poster PNG + ERC721 metadata."
    )
    p.add_argument("--out-root", default="out", help="Root output folder (default: out)")
    p.add_argument("--count", type=int, default=999, help="How many tokens (default: 999)")
    p.add_argument("--start-id", type=int, default=1, help="Starting token id (default: 1)")
    p.add_argument("--width", type=int, default=512, help="Render width (even number)")
    p.add_argument("--height", type=int, default=512, help="Render height (even number)")
    p.add_argument("--fps", type=int, default=24, help="Frames per second (default: 24)")
    p.add_argument("--seconds", type=float, default=4.0, help="Loop length seconds (default: 4)")
    p.add_argument("--thumb-at", type=float, default=1.0,
                   help="Poster time (seconds from start; default: 1.0)")
    p.add_argument("--collection", default="Regent Animata",
                   help='Name prefix; metadata "name" will be "Regent Animata [id]"')
    p.add_argument("--description", default="A procedurally generated looping shader animation. "
                                            "MP4 is primary; WebM/GIF provided as alternates.",
                   help="Metadata description text")

    # Encoding quality
    p.add_argument("--mp4-crf", type=int, default=18, help="x264 CRF (lower = better)")
    p.add_argument("--mp4-preset", default="medium", help="x264 preset")
    p.add_argument("--webm-crf", type=int, default=28, help="VP9 CRF (lower = better)")
    p.add_argument("--webm-codec", default="libvpx-vp9", choices=["libvpx-vp9", "libvpx"],
                   help="VP9 (better) or VP8 (faster)")
    p.add_argument("--threads", type=int, default=0, help="ffmpeg threads (0=auto)")

    # IPFS embedding (second pass)
    p.add_argument("--animations-cid", default=None, help="CID for animations folder (mp4/webm/gif)")
    p.add_argument("--images-cid", default=None, help="CID for poster images folder (png)")
    p.add_argument("--metadata-only", action="store_true",
                   help="Skip rendering; only (re)write metadata with given CIDs")

    # Debug / diagnostics
    p.add_argument("--debug-dump", action="store_true",
                   help="Dump first frame png and raw rgb; print array info")
    p.add_argument("--gradient-test", action="store_true",
                   help="Render a simple UV gradient fragment shader to isolate issues")
    p.add_argument("--rgba-read", action="store_true",
                   help="Read RGBA from FBO then drop A (workaround for packing issues)")
    p.add_argument("--use-raw-mp4", action="store_true",
                   help="Write MP4 via ffmpeg raw pipe instead of imageio writer")
    p.add_argument("--limit-mp4-frames", type=int, default=0,
                   help="If >0 with --use-raw-mp4, only pipe this many frames to MP4 (debug)")
    p.add_argument("--use-texture-fbo", action="store_true",
                   help="Attach a texture as color target and read via texture.read()")
    # Parameter control / sweeps
    p.add_argument("--fixed-hue", default=None,
                   help="Comma list of 4 ints (0..6) to fix hue, e.g. 3,3,3,3")
    p.add_argument("--fixed-rot-speed", type=float, default=None,
                   help="Fix rotation speed (e.g., 3.0)")
    p.add_argument("--fixed-scale", type=float, default=None,
                   help="Fix scale (0.08..0.18)")
    p.add_argument("--fixed-dotdiv", type=float, default=None,
                   help="Fix dot divisor (0.5..0.9)")
    p.add_argument("--sweep", choices=["rot", "scale", "dotdiv"], default=None,
                   help="Generate 4 clips sweeping the chosen variable; others at midpoint")
    p.add_argument("--sweep-values", default=None,
                   help="Comma list of 4 numbers to use for sweep (overrides defaults)")

    return p.parse_args()


# --------------------- utils ---------------------
def ensure_dir(p: pathlib.Path):
    p.mkdir(parents=True, exist_ok=True)

def choose_params(seed: int):
    """Deterministic per-token parameters."""
    rng = random.Random(seed)
    hues = [rng.randint(0, 6) for _ in range(4)]            # four ints in [0..6]
    rot_speed = rng.choice([2.0, 3.0, 4.0])                 # 2, 3, or 4
    u_scale = rng.choice([x / 100.0 for x in range(8, 19)]) # 0.08..0.18 step 0.01
    u_dotdiv = rng.choice([0.5, 0.6, 0.7, 0.8, 0.9])        # 0.5..0.9 step 0.1
    return hues, rot_speed, u_scale, u_dotdiv

def get_ffmpeg_writer(path, fps, codec, params):
    """Compatibility for imageio versions (ffmpeg_params vs output_params)."""
    try:
        return imageio.get_writer(path, fps=fps, codec=codec, ffmpeg_params=params)
    except TypeError:
        return imageio.get_writer(path, fps=fps, codec=codec, output_params=params)

def ipfs_or_local(cid, subdir, fname):
    return (f"ipfs://{cid}/{fname}") if cid else f"{subdir}/{fname}"

def parse_fixed_hue(s: str | None):
    if not s:
        return None
    parts = [p.strip() for p in s.split(',') if p.strip()]
    if len(parts) != 4:
        raise ValueError("--fixed-hue requires 4 comma-separated integers")
    vals = [int(p) for p in parts]
    for v in vals:
        if v < 0 or v > 6:
            raise ValueError("--fixed-hue values must be in 0..6")
    return vals

def parse_sweep_values(s: str | None):
    if not s:
        return None
    parts = [float(p.strip()) for p in s.split(',') if p.strip()]
    if len(parts) != 4:
        raise ValueError("--sweep-values requires exactly 4 numbers")
    return parts

def default_sweep_values(kind: str):
    if kind == 'rot':
        # include endpoints and two interior points
        return [2.0, 2.5, 3.5, 4.0]
    if kind == 'scale':
        return [0.08, 0.11, 0.15, 0.18]
    if kind == 'dotdiv':
        return [0.5, 0.6, 0.8, 0.9]
    raise ValueError(f"unknown sweep kind: {kind}")

def make_metadata_obj(token_id, args, hues, rot_speed, u_scale, u_dotdiv):
    pad = f"{token_id:04d}"
    mp4_uri  = ipfs_or_local(args.animations_cid, "animations", f"{pad}.mp4")
    webm_uri = ipfs_or_local(args.animations_cid, "animations", f"{pad}.webm")
    gif_uri  = ipfs_or_local(args.animations_cid, "animations", f"{pad}.gif")
    png_uri  = ipfs_or_local(args.images_cid,     "images",     f"{pad}.png")

    return {
        "name": f"{args.collection} {token_id}",
        "description": args.description,
        "animation_url": mp4_uri,                 # Primary animation: MP4
        "image": png_uri,                         # Poster
        "attributes": [
            {"trait_type": "Hue 1", "value": int(hues[0])},
            {"trait_type": "Hue 2", "value": int(hues[1])},
            {"trait_type": "Hue 3", "value": int(hues[2])},
            {"trait_type": "Hue 4", "value": int(hues[3])},
            {"trait_type": "Rotation Speed", "value": float(rot_speed), "display_type": "number"},
            {"trait_type": "Scale", "value": float(u_scale), "display_type": "number"},
            {"trait_type": "Dot Divisor", "value": float(u_dotdiv), "display_type": "number"},
            {"trait_type": "Human Supporter", "value": "True"}
        ],
        # Common pattern: declare alternates under properties.files for richer UIs
        "properties": {
            "category": "video",
            "files": [
                {"uri": mp4_uri,  "type": "video/mp4"},
                {"uri": webm_uri, "type": "video/webm"},
                {"uri": gif_uri,  "type": "image/gif"},
                {"uri": png_uri,  "type": "image/png"}
            ]
        }
    }


# --------------------- main ---------------------
def main():
    args = parse_args()

    OUT_ROOT = pathlib.Path(args.out_root)
    ANIM_DIR = OUT_ROOT / "animations"
    IMG_DIR  = OUT_ROOT / "images"
    META_DIR = OUT_ROOT / "metadata"
    PARAM_DIR= OUT_ROOT / "params"   # optional per‑token generative params for your records

    for d in (ANIM_DIR, IMG_DIR, META_DIR, PARAM_DIR):
        ensure_dir(d)

    # Timing
    frames = int(args.fps * args.seconds)
    thumb_frame = max(0, min(frames - 1, int(round(args.thumb_at * args.fps))))

    # Shader sources
    if args.gradient_test:
        frag_src = """#version 330
out vec4 FragColor;
uniform vec3 iResolution;
void main(){
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  FragColor = vec4(uv, 0.0, 1.0);
}
"""
    else:
        frag_src = pathlib.Path("shader_frag.glsl").read_text(encoding="utf-8")
    vert_src = """#version 330
    void main() {
        vec2 pos = vec2(-1.0, -1.0);
        if (gl_VertexID == 1) pos = vec2( 3.0, -1.0);
        else if (gl_VertexID == 2) pos = vec2(-1.0,  3.0);
        gl_Position = vec4(pos, 0.0, 1.0);
    }
    """

    if not args.metadata_only:
        # Headless GL context
        ctx = moderngl.create_standalone_context(require=330)
        prog = ctx.program(vertex_shader=vert_src, fragment_shader=frag_src)
        vao  = ctx.vertex_array(prog, [])

        # Offscreen framebuffer: use texture attachment if requested
        if args.use_texture_fbo:
            # Use RGBA8 renderable texture for widest compatibility, drop A on read
            color_tex = ctx.texture((args.width, args.height), components=4, dtype='u1')
            fbo = ctx.framebuffer(color_attachments=[color_tex])
        else:
            fbo = ctx.simple_framebuffer((args.width, args.height), components=4)
        fbo.use()
        # Ensure viewport matches framebuffer size
        ctx.viewport = (0, 0, args.width, args.height)

        # Static uniform
        prog["iResolution"].value = (float(args.width), float(args.height), 1.0)

    # Quality params for video encoders
    mp4_params = [
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        "-crf", str(args.mp4_crf),
        "-preset", args.mp4_preset
    ]
    webm_params = [
        "-pix_fmt", "yuv420p",
        "-b:v", "0",
        "-crf", str(args.webm_crf)
    ]
    if args.webm_codec == "libvpx-vp9":
        webm_params += ["-row-mt", "1"]
    if args.threads > 0:
        mp4_params  += ["-threads", str(args.threads)]
        webm_params += ["-threads", str(args.threads)]

    if args.debug_dump:
        print("ffmpeg (imageio) ->", imageio_ffmpeg.get_ffmpeg_exe())
        sys_ffmpeg = shutil.which("ffmpeg")
        if sys_ffmpeg:
            try:
                out = subprocess.check_output([sys_ffmpeg, "-hide_banner", "-version"], text=True)
                print(out.splitlines()[0])
            except Exception:
                pass

    # Sweep configuration (optional)
    sweep_values = None
    if args.sweep:
        sweep_values = parse_sweep_values(args.sweep_values) or default_sweep_values(args.sweep)
        # Force count to 4 unless explicitly larger, but only use first 4
        total = min(len(sweep_values), max(4, args.count))
    else:
        total = args.count

    # Main loop
    for idx in range(total):
        token_id = args.start_id + idx
        pad = f"{token_id:04d}"
        hues, rot_speed, u_scale, u_dotdiv = choose_params(token_id)

        # Fixed parameters
        fh = parse_fixed_hue(args.fixed_hue)
        if fh is not None:
            hues = fh
        if args.fixed_rot_speed is not None:
            rot_speed = float(args.fixed_rot_speed)
        if args.fixed_scale is not None:
            u_scale = float(args.fixed_scale)
        if args.fixed_dotdiv is not None:
            u_dotdiv = float(args.fixed_dotdiv)

        # Sweep: override one parameter, others to midpoints
        if sweep_values is not None:
            # Default constant hue unless user supplied fixed hue
            if fh is None:
                hues = [3, 3, 3, 3]
            rot_mid = 3.0
            scale_mid = 0.13
            dot_mid = 0.7
            if args.sweep == 'rot':
                rot_speed = sweep_values[idx % 4]
                u_scale = scale_mid
                u_dotdiv = dot_mid
            elif args.sweep == 'scale':
                u_scale = sweep_values[idx % 4]
                rot_speed = rot_mid
                u_dotdiv = dot_mid
            elif args.sweep == 'dotdiv':
                u_dotdiv = sweep_values[idx % 4]
                rot_speed = rot_mid
                u_scale = scale_mid

        # Always (re)write sidecar params + metadata
        with open(PARAM_DIR / f"{pad}.json", "w", encoding="utf-8") as jf:
            json.dump({
                "token_id": token_id,
                "hue": hues,
                "rotation_speed": rot_speed,
                "scale": u_scale,
                "dot_divisor": u_dotdiv,
                "width": args.width,
                "height": args.height,
                "fps": args.fps,
                "duration_seconds": args.seconds,
                "poster_frame": thumb_frame
            }, jf, indent=2)

        meta_obj = make_metadata_obj(token_id, args, hues, rot_speed, u_scale, u_dotdiv)
        if args.sweep:
            meta_obj.setdefault("attributes", []).append({
                "trait_type": f"sweep-{args.sweep}",
                "value": float(rot_speed if args.sweep=='rot' else (u_scale if args.sweep=='scale' else u_dotdiv)),
                "display_type": "number"
            })
        with open(META_DIR / f"{pad}.json", "w", encoding="utf-8") as mf:
            json.dump(meta_obj, mf, indent=2)

        if args.metadata_only:
            print(f"[meta✓] {pad}.json (CIDs embedded: "
                  f"animations={bool(args.animations_cid)}, images={bool(args.images_cid)})")
            continue

        # Set uniforms per token (if present)
        try:
            prog["uHueI"].value = tuple(int(h) for h in hues)
        except KeyError:
            pass
        try:
            prog["uRotSpeed"].value = float(rot_speed)
        except KeyError:
            pass
        try:
            prog["uScale"].value = float(u_scale)
        except KeyError:
            pass
        try:
            prog["uDotDiv"].value = float(u_dotdiv)
        except KeyError:
            pass
        try:
            prog["uGain"].value = float(os.environ.get("ANIMATA_GAIN", "0.35"))
        except KeyError:
            pass

        gif_path  = ANIM_DIR / f"{pad}.gif"
        mp4_path  = ANIM_DIR / f"{pad}.mp4"
        webm_path = ANIM_DIR / f"{pad}.webm"
        png_path  = IMG_DIR  / f"{pad}.png"

        gif_writer  = imageio.get_writer(gif_path, mode="I",
                                         duration=(args.seconds/frames), loop=0)
        if args.use_raw_mp4:
            mp4_frames = []  # collected only if debugging MP4 pipe
        else:
            mp4_writer  = get_ffmpeg_writer(mp4_path, fps=args.fps,
                                            codec="libx264", params=mp4_params)
        webm_writer = get_ffmpeg_writer(webm_path, fps=args.fps,
                                        codec=args.webm_codec, params=webm_params)

        poster_saved = False
        try:
            for frame in range(frames):
                # Seamless loop: (iTime / rot_speed) runs 0..2π across the clip
                phase = (2.0 * math.pi) * (frame / frames)
                iTime = phase * rot_speed
                try:
                    prog["iTime"].value = float(iTime)
                except KeyError:
                    # Gradient test or shaders without iTime
                    pass

                # Render
                fbo.clear(0.0, 0.0, 0.0, 1.0)
                vao.render(mode=moderngl.TRIANGLES, vertices=3)
                # Ensure GPU work is finished before reading
                ctx.finish()

                # Read & flip
                if args.use_texture_fbo:
                    # Read via texture attachment (RGBA8), then drop A
                    data = color_tex.read(alignment=1)
                    img4 = np.frombuffer(data, dtype=np.uint8).reshape((args.height, args.width, 4))
                    img4 = np.flipud(img4)
                    img4 = np.ascontiguousarray(img4)
                    img = img4[..., :3]
                elif args.rgba_read:
                    data = fbo.read(components=4, dtype="u1", alignment=1)
                    img4 = np.frombuffer(data, dtype=np.uint8).reshape((args.height, args.width, 4))
                    img4 = np.flipud(img4)
                    img4 = np.ascontiguousarray(img4)
                    img = img4[..., :3]
                else:
                    data = fbo.read(components=3, dtype="u1", alignment=1)
                    img = np.frombuffer(data, dtype=np.uint8).reshape((args.height, args.width, 3))
                    img = np.flipud(img)
                    img = np.ascontiguousarray(img)

                if args.debug_dump and token_id == args.start_id and frame == 0:
                    print("frame0", img.shape, img.dtype, "contig=", img.flags["C_CONTIGUOUS"], "strides=", img.strides, "min=", img.min(), "max=", img.max())
                    Image.fromarray(img).save("debug_first.png")
                    (pathlib.Path(".") / f"debug_{args.width}x{args.height}_rgb24.raw").write_bytes(img.tobytes())

                # Write frames
                gif_writer.append_data(img)
                if args.use_raw_mp4:
                    if args.limit_mp4_frames <= 0 or len(mp4_frames) < args.limit_mp4_frames:
                        mp4_frames.append(img)
                else:
                    mp4_writer.append_data(img)
                webm_writer.append_data(img)

                # Poster capture at thumb_frame
                if frame == thumb_frame and not poster_saved:
                    Image.fromarray(img).save(png_path)
                    poster_saved = True

            # Safety: if thumb_frame was out of range for some reason, capture first frame
            if not poster_saved:
                Image.fromarray(img).save(png_path)
                poster_saved = True

        finally:
            gif_writer.close()
            if args.use_raw_mp4:
                # Raw pipe to ffmpeg
                ff = shutil.which("ffmpeg")
                if not ff:
                    print("[warn] ffmpeg not found in PATH; skipping raw mp4 write")
                else:
                    cmd = [
                        ff, "-y",
                        "-f", "rawvideo",
                        "-pix_fmt", "rgb24",
                        "-s", f"{args.width}x{args.height}",
                        "-r", str(args.fps),
                        "-i", "-",
                        "-c:v", "libx264",
                        "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart",
                        "-crf", str(args.mp4_crf),
                        "-preset", args.mp4_preset,
                        str(mp4_path),
                    ]
                    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                    try:
                        for im in mp4_frames:
                            p.stdin.write(im.tobytes())
                    finally:
                        p.stdin.close()
                        p.wait()
            else:
                mp4_writer.close()
            webm_writer.close()

        print(f"[✓] {pad}: gif/mp4/webm + poster "
              f"(speed={rot_speed}, scale={u_scale:.2f}, dot={u_dotdiv:.1f}, hue={hues})")

if __name__ == "__main__":
    main()
