import fs from "fs";
import path from "path";

interface DerivedTraits {
  H: [number, number, number, number];
  rot: number;
  k: number;
  dot: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getOptionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function mulberry32(seed: number): () => number {
  return function generate(): number {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveTraits(id: number): DerivedTraits {
  const rng = mulberry32((id * 2654435761) >>> 0);

  const H0 = Math.floor(rng() * 7);
  const H1 = Math.floor(rng() * 7);
  const H2 = Math.floor(rng() * 7);
  const H3 = Math.floor(rng() * 7);
  const H: [number, number, number, number] = [H0, H1, H2, H3];

  if (H[0] === H[1] && H[1] === H[2] && H[2] === H[3]) {
    H[1] = (H[1] + 1) % 7;
  }

  const rotationOptions = [2, 3, 4];
  const rot = rotationOptions[Math.floor(rng() * rotationOptions.length)];

  const kRaw = 0.08 + 0.01 * Math.floor(rng() * 11); // 0.08..0.18
  const k = Number(kRaw.toFixed(2));

  const dotOptions = [0.5, 0.6, 0.7, 0.8, 0.9];
  const dot = dotOptions[Math.floor(rng() * dotOptions.length)];

  return { H, rot, k, dot };
}

function ensureDir(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function formatId(id: number, padToThree: boolean): string {
  return padToThree ? String(id).padStart(3, "0") : String(id);
}

function buildImagePath(
  imageCid: string,
  imagePathPrefix: string,
  paddedId: string,
  imageExt: string
): string {
  const prefix = imagePathPrefix
    ? imagePathPrefix.endsWith("/")
      ? imagePathPrefix
      : `${imagePathPrefix}/`
    : "";
  return `ipfs://${imageCid}/${prefix}${paddedId}.${imageExt}`;
}

function main(): void {
  const bundleCid = requireEnv("BUNDLE_CID");
  const staticImageUrl = (process.env["STATIC_IMAGE_URL"] || "").trim();
  const imageCidEnv = (process.env["IMAGE_CID"] || "").trim();

  const countRaw = getOptionalEnv("METADATA_COUNT", "999");
  const count = Math.max(1, Math.min(9999, Number(countRaw)));

  const startIdRaw = getOptionalEnv("START_ID", "1");
  const startId = Math.max(1, Number(startIdRaw));

  const outDir = getOptionalEnv("OUT_DIR", "deploy/metadata");
  const imagePathPrefix = getOptionalEnv("IMAGE_PATH_PREFIX", ""); // e.g., "previews"
  const imageExt = getOptionalEnv("IMAGE_EXT", "webp");
  const padJsonFilenames = getOptionalEnv("PAD_TO_THREE_JSON", "true").toLowerCase() !== "false";

  ensureDir(outDir);

  let written = 0;
  for (let id = startId; id < startId + count; id += 1) {
    const padded = formatId(id, true); // Always pad for image filenames
    const jsonId = formatId(id, padJsonFilenames);

    const { H, rot, k, dot } = deriveTraits(id);

    const metadata: Record<string, unknown> = {
      name: `Regent Animata #${id}`,
      description: "Interactive Comet-style shader card.",
      animation_url: `ipfs://${bundleCid}/token.html?id=${id}`,
      attributes: [
        { trait_type: "Hue 1", value: H[0], display_type: "number" },
        { trait_type: "Hue 2", value: H[1], display_type: "number" },
        { trait_type: "Hue 3", value: H[2], display_type: "number" },
        { trait_type: "Hue 4", value: H[3], display_type: "number" },
        { trait_type: "Rotation Speed", value: rot, display_type: "number" },
        { trait_type: "K Step", value: k, display_type: "number" },
        { trait_type: "Dot Div", value: dot, display_type: "number" },
        { trait_type: "Human Supporter", value: "True" },
      ],
    };

    // Optional image field: include only if STATIC_IMAGE_URL or IMAGE_CID provided
    if (staticImageUrl) {
      (metadata as any).image = staticImageUrl;
    } else if (imageCidEnv) {
      const imageUrl = buildImagePath(imageCidEnv, imagePathPrefix, padded, imageExt);
      (metadata as any).image = imageUrl;
    }

    const targetPath = path.join(outDir, `${jsonId}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(metadata, null, 2));
    written += 1;
  }

  const sampleA = path.join(outDir, `${formatId(startId, padJsonFilenames)}.json`);
  const sampleB = path.join(outDir, `${formatId(startId + count - 1, padJsonFilenames)}.json`);

  console.log(
    `Wrote ${written} metadata files to ${outDir}. Examples:`,
    "\n  ", sampleA,
    "\n  ", sampleB,
  );
}

main();


