# TODO (x402 server)

## Current
- Implement `POST /mint` paid endpoint (whitelist-gated)
  - src/server.ts: mirror `/process` structure around the paid flow
- Instantiate separate `MerchantExecutor` for `/mint` with its own `resource` and price
  - src/server.ts: create `merchantExecutorMint`
- Add whitelist loader for `WLaddress.txt` (one address per line; ignore blanks and `#`)
  - Load at startup; cache `Set<string>` of lowercased addresses
- Mint via ethers using `MINT_*` env (signer, rpc, chainId, contract, method)
  - ERC‑721 or ERC‑1155 depending on contract; minimal ABI
- Error handling: do not settle if whitelist fails or mint fails
- Tests: 402 path, non‑WL address 403, happy path (mint+settle)

## Completed
- Add `AGENTS.md` describing NFT mint workflow and whitelist
- Add `WLaddress.txt` placeholder and format docs (353 addresses)
- Update `README.md` to reference AGENTS.md and the mint plan
- Add root `CLAUDE.md` notes
- Add metadata generator `scripts/gen-metadata.ts` for IPFS `animation_url` + previews
- Add quota (3 per address) + idempotency via `src/store.ts` and integrate in `/mint`
- Deploy RegentAnimata NFT contract to Base Sepolia: `0xe04dD4F701030c71d7AF160C9A25AdEE890de1eD`
- Upload metadata to IPFS (999 files without leading zeros)
- Configure contract baseURI: `ipfs://bafybeihzetxfwhlem6hro66wngw4fabudmvxwv567p3gzmk5vs64cdvuyq/`

## Pointers
- Payer surfaced after verify here (use for mint recipient): src/server.ts lines ~316‑321
- Verify and settle helpers: src/MerchantExecutor.ts
- A2A message shapes: src/x402Types.ts
- Metadata generation script: scripts/gen-metadata.ts (run with Bun)
 - Quota & idempotency helpers: src/store.ts
