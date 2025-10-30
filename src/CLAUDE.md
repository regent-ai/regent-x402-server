Notes for `src/` (see root AGENTS.md for canonical guidance)

- `/process` shows the paid flow pattern to reuse for `/mint`.
- Extract payer from verify result and gate with `WLaddress.txt`.
- Only mint to the verified payer; on mint success, then settle.

Metadata generation

Quota & idempotency

- Store: `src/store.ts` persists to `mint-store.json` (env `MINT_STORE_PATH` overrides).
- In `/mint`: verify → whitelist → idempotency (hash payload) → quota (3 per address) → mint → mark processed + increment → settle.

Runtime config

- `src/config.ts` reads `server-config.json` (TTL 3s; override path/TTL with env).
- Fields: `whitelistEnabled` (boolean), `perAddressLimit` (number|null).
- Use `scripts/gen-metadata.ts` to write 001–999 JSON files with deterministic traits and correct `animation_url`/`image`.
- Required env: `BUNDLE_CID`. You may omit both `IMAGE_CID` and `STATIC_IMAGE_URL` to drop the `image` field entirely; `animation_url` remains. Run with `bun scripts/gen-metadata.ts`.
