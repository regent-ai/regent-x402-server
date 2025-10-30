## Regent x402 Server – Agents Guide (AGENTS.md)

This repository provides an Express + TypeScript server that exposes paid HTTP endpoints using the x402 protocol (EIP‑3009). It is designed to be consumed by agent frontends (e.g., the Regent Web app) and other programmatic clients.

This guide documents the stack, current endpoints, and the planned NFT mint workflow gated by a whitelist file (`WLaddress.txt`). It is the source of truth for agents working on or integrating with this service.

### Stack & Layout

- Runtime: Node.js 18+
- Server: Express
- Language: TypeScript (strict)
- Payments: `x402` (verify + settle via facilitator or direct)
- Chain SDK: `ethers`
- AI example: `openai` (replace with your own service as needed)

Key files:

- `src/server.ts` – Express server, routes, x402 verification/settlement flow
- `src/MerchantExecutor.ts` – Payment requirements, verify, settlement
- `src/MintService.ts` – On-chain NFT mint helper
- `src/x402Types.ts` – A2A-like task/message shapes
- `src/whitelist.ts` – Whitelist loader (TTL-cached)
- `src/config.ts` – Runtime config (server-config.json with TTL)
- `src/store.ts` – Idempotency and per-address mint counts (JSON file store)
- `WLaddress.txt` – Whitelist for NFT mint (one address per line; see below)

### Endpoints

- `GET /health` – Service health and payment summary
- `POST /mint` – Paid NFT mint endpoint (x402). Verifies payment, checks whitelist, mints to payer, then settles payment.

## NFT Mint Workflow (Whitelist-gated)

Goal: Expose a paid `POST /mint` endpoint. After payment verification, mint an NFT on Base (testnet or mainnet) to the payer address (the wallet that authorized the EIP‑3009 transfer), but only if the payer is present in a line‑delimited whitelist `WLaddress.txt`.

High‑level flow:

1) Client calls `/mint` → server returns 402 with x402 payment requirements (USDC on configured network, price set for the mint).
2) Client signs and submits EIP‑3009 payload → server verifies payment (without settling yet).
3) Server extracts payer address from verification result and checks whitelist:
   - If not whitelisted → reject with 403 (no on‑chain mint, no settlement).
   - If whitelisted → run mint transaction to the payer address.
4) If mint succeeds → settle x402 payment (facilitator or direct) → return mint receipt and settlement info.

Notes on ordering: We verify payment first (cheap), gate by whitelist, then mint (your on‑chain action), then settle the payment. This matches the existing `/process` pattern (service logic before `settlePayment`).

### Whitelist file: WLaddress.txt

Location: repo root `WLaddress.txt`.

Format:

- One address per line
- Accepts mixed case; comparison should be done on lowercased addresses
- Blank lines and lines starting with `#` are ignored

Example contents:

```
# Whitelisted addresses (Base chain). One per line.
0x1111111111111111111111111111111111111111
0x2222222222222222222222222222222222222222
```

Implementation guidance:

- Load once at process start and cache in a `Set<string>`; reload on change if you need hot‑reload.
- Normalize addresses to lowercase (or checksum) before storing/comparing.
- Expect ~340 lines; file I/O is trivial. Prefer lazy reload or a small TTL if operators update the file manually.

### Environment (mint)

Add the following server‑only variables to `.env` for the mint flow (names are suggestions; adapt as you implement):

- `MINT_RPC_URL` – Base RPC endpoint (e.g., `https://sepolia.base.org` or provider URL)
- `MINT_CHAIN_ID` – `84532` (Base Sepolia) or `8453` (Base)
- `MINT_SIGNER_PRIVATE_KEY` – Private key that can call mint on the NFT contract
- `NFT_CONTRACT_ADDRESS` – Target ERC‑721/1155 contract address
  - **Deployed:** `0xe04dD4F701030c71d7AF160C9A25AdEE890de1eD` (Base Sepolia)
  - **Base URI:** `ipfs://bafybeihzetxfwhlem6hro66wngw4fabudmvxwv567p3gzmk5vs64cdvuyq/`
- `NFT_ABI_PATH` – Optional path to a minimal ABI JSON if your method isn’t standard
- `MINT_METHOD` – Method to call, e.g., `safeMint` or `mint`
  (Price is fixed at $80 USDC for `/mint`.)
- Optional metadata:
  - `MINT_TOKEN_URI` – Static token URI (if your contract requires it)
  - or PINATA/IPFS keys if you dynamically upload metadata before mint

Security:

- Never log private keys.
- Keep signer funded with gas.
- Pin contract/network to Base; do not rely on default chain if your mint is chain‑specific.

### Contract expectations

This guide is agnostic to the NFT contract so long as it exposes a method to mint to a recipient address. Common patterns:

- ERC‑721: `function safeMint(address to, string memory uri)` or `function mint(address to)`
- ERC‑1155: `function mint(address to, uint256 id, uint256 amount, bytes data)`

Choose the method via `MINT_METHOD` and pass arguments accordingly in your implementation. Keep a minimal ABI (only the method(s) you call) to reduce surface area.

### Implementation details (server)

Paid endpoint uses a dedicated `MerchantExecutor` instance for `/mint` to allow an independent `resource` and `price`:

1) `merchantExecutorMint` is instantiated with:
   - `resourceUrl`: `SERVICE_URL_MINT` (e.g., `http://localhost:3000/mint`)
   - `price`: `80`
   - Network/asset parameters from built-ins or env

2) In `POST /mint`:
   - Parse `message` and x402 metadata (same shape as `/process`).
   - If no `paymentPayload` or missing status → return 402 using `merchantExecutorMint.createPaymentRequiredResponse()`.
   - `verifyPayment(paymentPayload)`; if invalid → 402 with reason.
   - Extract `verifyResult.payer` (this is the buyer address). Lowercase and check membership in the whitelist `Set` loaded from `WLaddress.txt`.
   - If not whitelisted → `403 { error: "address-not-whitelisted" }` and do NOT settle.
   - If whitelisted → call mint using `ethers` with `MINT_SIGNER_PRIVATE_KEY` and `MINT_RPC_URL` against `NFT_CONTRACT_ADDRESS` using the configured method/args.
   - On successful mint (receipt status 1), call `merchantExecutorMint.settlePayment(paymentPayload)`.
   - Return JSON including: mint transaction hash, settlement result, payer address, and any emitted token id/uri if retrievable.

3) Logging/observability:
   - Log chain, payer, tx hashes; do not log secrets.
   - If using a block explorer URL (e.g., BaseScan), include it in logs.

Error handling:

- Mint revert → return `500` with `mintFailed` and reason; do not settle payment.
- Settlement failure → return `200` with `mintSucceeded=true` and `paymentSettled=false` plus error; operator can decide on remediation.

### Testing the mint flow

Without payment (expect 402):

```
curl -X POST http://localhost:3000/mint \
  -H "Content-Type: application/json" \
  -d '{"message":{"parts":[{"kind":"text","text":"mint"}]}}'
```

With payment:

- Use an x402‑compatible client to sign the payment for `/mint`.
- Submit the signed payload in `message.metadata['x402.payment.payload']` with `x402.payment.status = 'payment-submitted'`.
- Payer address must be on the whitelist; otherwise you will receive a 403.

### Integration notes (Regent Web)

- The web app can present a "Mint" paid tool that calls this server’s `/mint` endpoint over x402.
- Price discovery: read the payment requirement from the 402 response for `/mint`.
- If you manage allowlists in web ops, ensure `WLaddress.txt` here gets updated (commit or provision at deploy time). Consider moving WL to a storage backend if you need runtime edits.

### Safety & guardrails

- Only mint to the verified payer address (never to untrusted input fields).
- Keep the whitelist authoritative; normalize addresses, ignore comments/blank lines.
- Never settle if whitelist check fails or minting fails.
- Prefer Base Sepolia for testing (`MINT_CHAIN_ID=84532`), then switch to Base mainnet (`8453`).

### Operational checklist

- [x] NFT Contract deployed: `0xe04dD4F701030c71d7AF160C9A25AdEE890de1eD` (Base Sepolia)
- [x] Metadata uploaded to IPFS (999 files, no leading zeros)
- [x] Base URI configured: `ipfs://bafybeihzetxfwhlem6hro66wngw4fabudmvxwv567p3gzmk5vs64cdvuyq/`
- [x] `WLaddress.txt` populated with one address per line (353 addresses)
- [ ] `MINT_*` env set; signer funded for gas
- [ ] `NFT_CONTRACT_ADDRESS` set to deployed contract in `.env`
- [ ] `/mint` endpoint returns 402 with correct `resource`
- [ ] Address gating denies non‑WL addresses (403)
- [ ] Successful mint returns mint tx hash
- [ ] Settlement includes facilitator/direct receipt

### Dev commands (bun)

- Build: `bun run build`
- Dev (compile + run): `bun run dev`

### Runtime updates (no redeploy)

- Config file: `server-config.json` (override path with `SERVER_CONFIG_PATH`).
- The server reads this file on the fly (TTL 3s; override via `SERVER_CONFIG_TTL_MS`).
- Supported fields:
  - `whitelistEnabled`: boolean — when `false`, disables whitelist gating.
  - `perAddressLimit`: number or `null` — set e.g. `5` to raise limit; `null` removes mint limits.

Examples

1) Increase limit to 5 for wallets on the list

```json
{
  "whitelistEnabled": true,
  "perAddressLimit": 5
}
```

2) Increase allowlist size

- Append addresses (one per line) to `WLaddress.txt`. The server already hot‑reloads this file (TTL via `WHITELIST_TTL_MS`).

3) Remove all wallet requirements and minting limits

```json
{
  "whitelistEnabled": false,
  "perAddressLimit": null
}
```



