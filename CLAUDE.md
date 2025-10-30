Short notes for agents (non-canonical; see AGENTS.md for source of truth)

- Added `AGENTS.md` describing the whitelist-gated NFT mint flow over x402.
- Placeholder `WLaddress.txt` created at repo root; one address per line.
- `README.md` now links to `AGENTS.md` for the mint workflow.

Next work (see `src/TODO.md`):

- Implement `POST /mint` with a dedicated `MerchantExecutor` and whitelist gating.
- Wire ethers signer via `MINT_*` env and call the NFT contract's mint method.


Interactive NFT deliverables (static)

- Single-file token for `animation_url`: `token.html`. Self-contained (inline CSS/JS), renders a Comet-style interactive card seeded by `?id=###`. Example: `token.html?id=123`.
- Gallery (preview): `public/comet-card/` with `index.html`, `style.css`, `script.js` — renders 1..999 cards using OGL UMD via UNPKG; tilts on hover; shaders are lazy-booted via IntersectionObserver.
- Metadata template: `public/comet-card/metadata.example.json`.

IPFS/Pinata

- Pin a folder containing `token.html` (and optionally `previews/####.webp`).
- In token metadata, set `animation_url` to `ipfs://<CID>/token.html?id={id}` and `image` to a static preview for thumbnails.



Metadata generator (IPFS)

- Script: `scripts/gen-metadata.ts`
- Inputs (env):
  - `BUNDLE_CID` (required): CID containing `token.html`
  - `IMAGE_CID` (optional): CID with previews (`001.webp…999.webp`). If omitted and no `STATIC_IMAGE_URL`, the `image` field is omitted entirely.
  - `STATIC_IMAGE_URL` (optional): Single image for all tokens (e.g., `ipfs://$BUNDLE_CID/public/regentlogo.svg`). Skips previews.
  - Optional: `IMAGE_PATH_PREFIX` (e.g., `previews` if your files live under a subfolder), `IMAGE_EXT` (default `webp`), `OUT_DIR` (default `deploy/metadata`), `PAD_TO_THREE_JSON` (default `true`)
- Run:
  - `bun scripts/gen-metadata.ts` (after exporting env vars)
- Upload:
  - `storacha up --no-wrap ./deploy/metadata/*` → use returned CID for on-chain `tokenURI`

Mint quota + idempotency

- JSON store: `mint-store.json` (configurable via `MINT_STORE_PATH`).
- Helpers in `src/store.ts`:
  - `getMintCount(address)`, `incMintCount(address, by)` — enforce 3 mints/address.
  - `paymentIdFromPayload(payload)` — sha256 of canonical payload JSON.
  - `isPaymentProcessed(id)`, `markPaymentProcessed(id)` — dedupe retried requests.
- Flow in `/mint`:
  - verify → whitelist → idempotency check → quota check → mint → mark processed + increment → settle.

Runtime config

- File: `server-config.json` (override with `SERVER_CONFIG_PATH`). Auto-reloads (TTL 3s; `SERVER_CONFIG_TTL_MS`).
- Fields:
  - `whitelistEnabled`: boolean. Set to `false` to disable allowlist.
  - `perAddressLimit`: number or `null`. Set to `5` to raise; `null` for unlimited.

