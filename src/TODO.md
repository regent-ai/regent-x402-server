# TODO (src)

- Add `merchantExecutorMint` with `resourceUrl` = `/mint` and `price` = env `MINT_PRICE_USD` (default 0.01)
- Implement `POST /mint` mirroring `/process` control flow
  - 402 if missing `x402.payment.payload`
  - verify → if invalid 402; if valid capture `verifyResult.payer`
  - WL check (lowercase compare)
  - if not in WL → 403 and return
  - else mint via ethers signer (env `MINT_*`) to `payer`
  - on success → settle x402 payment; respond with mint+settlement receipts
- Add WL loader utility (read once at start; ignore blanks and `#`)
- Add env validation for `MINT_*` and NFT contract method selection
- Add logs: chain, payer, tx hashes (no secrets)
  
Notes
- Off-chain metadata generation available via `scripts/gen-metadata.ts`; run with Bun after exporting `BUNDLE_CID`/`IMAGE_CID`.