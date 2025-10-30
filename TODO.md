# TODO (x402 server)

## Current
- Verify environment and test the flow end-to-end
  - Set `MINT_*`, `PAY_TO_ADDRESS`, and (for direct settlement) `PRIVATE_KEY`
  - Build with `bun run build`; run server `bun run dev`
  - Test unpaid 402 via `./test-request.sh` and paid flow via `node dist/testClient.js`

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
- Implement `POST /mint` paid endpoint (whitelist-gated)
  - `src/server.ts` 
- Instantiate separate `MerchantExecutor` for `/mint` with its own `resource` and price
  - `src/server.ts` → `merchantExecutorMint` with env `MINT_PRICE_USD`
- Add whitelist loader for `WLaddress.txt` (one address per line; ignore blanks and `#`)
  - `src/whitelist.ts` TTL-cached loader
- Mint via ethers using `MINT_*` env (signer, rpc, chainId, contract, method)
  - `src/MintService.ts`
- Error handling: do not settle if whitelist fails or mint fails
  - `src/server.ts` flow: verify → WL → mint → settle
- Update tests/clients to target `/mint` and parse 402 accepts
  - `test-request.sh`, `src/testClient.ts`
- Fixed mint price at $80 and display in `/health`
  - `src/server.ts`

## Pointers
- `/mint` endpoint and flow: `src/server.ts` (POST /mint)
- Verify and settle helpers: `src/MerchantExecutor.ts` (`verifyPayment`, `settlePayment`)
- Mint implementation: `src/MintService.ts`
- Whitelist loader: `src/whitelist.ts`
- Runtime config (WL toggle, per-address limit): `src/config.ts`
- Quota & idempotency helpers: `src/store.ts`
- A2A message shapes: `src/x402Types.ts`
- Metadata generation script: `scripts/gen-metadata.ts` (run with Bun)
