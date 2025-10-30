![x402 Starter Kit](header.jpg)

# x402 Starter Kit

A starter kit for building paid APIs using the x402 payment protocol.

> To deploy to EigenCompute, follow [these steps](DEPLOYING_TO_EIGENCOMPUTE.md). To sign up for EigenAI, start [here](https://docs.eigencloud.xyz/products/eigenai/eigenai-overview)

## Overview

This starter kit demonstrates how to build paid APIs using x402. This fork focuses on a paid NFT mint flow:

1. Receives API requests
2. Requires payment ($80 USDC) for `POST /mint`
3. Verifies payment via x402 (facilitator or local)
4. Checks whitelist and mints an NFT to the payer address
5. Settles payment and returns the mint transaction details

## Architecture

The API consists of these components:

- **MerchantExecutor**: x402 verification/settlement helper (hosted facilitator or local EIP‑3009)
- **MintService**: Ethers-based minter that calls your NFT contract
- **Whitelist loader**: Parses `WLaddress.txt` for allowlist gating
- **Server**: Express HTTP server with `/health` and `/mint`

## Prerequisites

- Node.js 18 or higher (Bun 1.1+ recommended)
- A wallet with some ETH for gas fees (on your chosen network)
- A wallet address to receive USDC payments

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
# Server Configuration
PORT=3000

# Payment Configuration
# Wallet address that will receive USDC payments
PAY_TO_ADDRESS=0xYourWalletAddress

# Network Configuration
# Options: "base", "base-sepolia", "ethereum", "polygon", "polygon-amoy"
NETWORK=base-sepolia

# Mint Configuration
# Base RPC endpoint (e.g., https://sepolia.base.org)
MINT_RPC_URL=
# Chain ID: 84532 (Base Sepolia) or 8453 (Base)
MINT_CHAIN_ID=84532
# Private key for the mint signer (DO NOT COMMIT)
MINT_SIGNER_PRIVATE_KEY=
# NFT contract to call
NFT_CONTRACT_ADDRESS=
# Optional path to ABI JSON (array or { abi: [...] })
# NFT_ABI_PATH=./abi/MyNft.json
# Method to call: mint or safeMint (default: mint)
MINT_METHOD=mint
# Optional: pass token URI (otherwise calls single-arg mint)
# MINT_TOKEN_URI=ipfs://CID/1.json
# Or a template to pick random id in range
# MINT_TOKEN_URI_TEMPLATE=ipfs://CID/{id}.json
# MINT_TOKEN_ID_MIN=1
# MINT_TOKEN_ID_MAX=999

# Facilitator Configuration (optional)
# FACILITATOR_URL=https://your-custom-facilitator.com
# FACILITATOR_API_KEY=your_api_key_if_required

# Local Settlement (optional)
# SETTLEMENT_MODE=local
# PRIVATE_KEY=your_private_key_here
# RPC_URL=https://base-sepolia.g.alchemy.com/v2/your-api-key

# Custom Network Details (required if NETWORK is not base/base-sepolia/polygon/polygon-amoy)
# ASSET_ADDRESS=0xTokenAddress
# ASSET_NAME=USDC
# EXPLORER_URL=https://explorer.your-network.org
# CHAIN_ID=84532

# Public Service URL for mint (optional)
# Used in payment requirements so the facilitator sees a fully-qualified resource URL
# SERVICE_URL_MINT=http://localhost:3000/mint

# Test Client Configuration (optional - only needed for end-to-end payment testing)
# CLIENT_PRIVATE_KEY=your_test_wallet_private_key_here
# AGENT_URL=http://localhost:3000

# Optional: Debug logging
X402_DEBUG=true
```

## Quickstart

1. **Run the API**
   ```bash
   bun run dev
   ```

**Settlement Modes:**
- Default: no extra config, uses the hosted facilitator at `https://x402.org/facilitator`
- Local (direct): set `SETTLEMENT_MODE=local`, provide `PRIVATE_KEY`, and optionally override `RPC_URL` for your network
- Custom facilitator: set `FACILITATOR_URL` (and `FACILITATOR_API_KEY` if needed) to call a different facilitator endpoint (e.g., one you host yourself)
- Update `SERVICE_URL` if clients reach your API through a different hostname so the payment requirement has a fully-qualified resource URL
- If you set `NETWORK` to something other than `base`, `base-sepolia`, `polygon`, or `polygon-amoy`, provide `ASSET_ADDRESS`, `ASSET_NAME`, and (for local settlement) `CHAIN_ID`

**AI Provider:**
- Default: `AI_PROVIDER=openai` (requires `OPENAI_API_KEY`)
- EigenAI: set `AI_PROVIDER=eigenai`, provide `EIGENAI_API_KEY`, and optionally override `EIGENAI_BASE_URL`
- Use `AI_MODEL`, `AI_TEMPERATURE`, `AI_MAX_TOKENS`, and `AI_SEED` to tune inference behaviour for either provider

**Important:**
- `PAY_TO_ADDRESS` should be your wallet address where you want to receive USDC payments
- `NETWORK` should match where you want to receive payments (recommend `base-sepolia` for testing)
- `OPENAI_API_KEY` is required unless `AI_PROVIDER=eigenai` (then provide `EIGENAI_API_KEY`)
- Never commit your `.env` file to version control

## Running the API

### Development Mode

```bash
bun run dev
```

### Production Mode

```bash
bun run build
bun run start
```

The server will start on `http://localhost:3000` (or your configured PORT).

### Docker

```bash
# Build the image
docker build -t x402-starter .

# Run the container (make sure .env has the required variables)
docker run --env-file .env -p 3000:3000 x402-starter
```

## Usage

### Health Check

Check if the API is running:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "x402-payment-api",
  "version": "1.0.0",
  "payment": {
    "address": "0xYourAddress...",
    "network": "base-sepolia",
    "mint": { "resource": "/mint", "price": "$80.00" }
  }
}
```

### Mint Endpoint (`POST /mint`)

Unpaid request (expect 402):

```bash
curl -X POST http://localhost:3000/mint \
  -H "Content-Type: application/json" \
  -d '{"message": {"parts": [{"kind":"text","text":"mint"}]}}'
```

Paid flow:

1. Read the 402 response to get payment requirements for the `/mint` resource.
2. Use an x402-compatible client to sign an EIP-3009 payload for the shown requirements.
3. Submit the signed payload in `message.metadata["x402.payment.payload"]` and set `message.metadata["x402.payment.status"] = "payment-submitted"`.
4. If the payer address (from verification) is in `WLaddress.txt`, the server mints to that payer and then settles payment.

Response (success):

```json
{
  "success": true,
  "payer": "0x...",
  "mintTxHash": "0x...",
  "tokenUri": "ipfs://.../123.json",
  "settlement": { "success": true, "network": "base-sepolia", "transaction": "0x..." }
}
```

## How It Works

### Payment Flow

1. **Client sends request** → API receives the request
2. **API requires payment** → Returns 402 with payment requirements
3. **Client signs payment** → Creates EIP-3009 authorization
4. **Client submits payment** → Sends signed payment back to API
5. **API verifies payment** → Checks signature and authorization
6. **API processes request** → Mints an NFT to the payer (if whitelisted)
7. **API settles payment** → Completes blockchain transaction
8. **API returns response** → Sends mint and settlement details

### Payment Verification

`src/MerchantExecutor.ts` sends the payment payload either to the configured x402 facilitator **or** verifies/settles locally, depending on the settlement mode:

- **Facilitator mode** (default): forwards payloads to `https://x402.org/facilitator` or the URL set in `FACILITATOR_URL`
- **Local mode**: verifies signatures with `ethers.verifyTypedData` and submits `transferWithAuthorization` via your configured RPC/PRIVATE_KEY

Make sure `SERVICE_URL_MINT` reflects the public URL of your paid `/mint` endpoint so the facilitator can validate the `resource` field when using facilitator mode.

### Error Handling

- **Missing payment**: Returns 402 Payment Required
- **Invalid payment**: Returns payment verification failure
- **Settlement failure**: Returns settlement error details
 - **Mint failure**: Returns `mint-failed` with reason; payment is not settled

## Development

### Project Structure

```
x402-developer-starter-kit/
├── src/
│   ├── server.ts                     # Express server and endpoints
│   ├── MerchantExecutor.ts           # Payment verification & settlement helpers
│   ├── x402Types.ts                  # Shared task/message types
│   ├── MintService.ts                # Ethers contract minter
│   └── whitelist.ts                  # WLaddress.txt loader
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── TESTING.md
└── test-request.sh
```

### Building

```bash
bun run build
```

Compiled files will be in the `dist/` directory.

### Cleaning

```bash
npm run clean
```

## Testing with Real Payments

To test with real USDC payments:

1. Switch to a testnet (e.g., `base-sepolia`)
2. Get testnet USDC from a faucet
3. Use a client that implements the x402 protocol
4. Make sure your wallet has testnet ETH for gas

## Troubleshooting

### "Mint failed"

Check that:
- `MINT_RPC_URL` is correct and reachable
- `MINT_SIGNER_PRIVATE_KEY` has gas on the target chain
- `NFT_CONTRACT_ADDRESS` is correct and the signer has permission to mint
- `MINT_METHOD` matches a function on the contract (e.g., `mint(address)` or `safeMint(address)`)
- If passing a token URI, contract supports `(address,string)` signature

### "PAY_TO_ADDRESS is required"

Make sure you've set `PAY_TO_ADDRESS` in your `.env` file to your wallet address.

### Payment verification fails

- Check that you're using the correct network
- Verify your wallet has USDC approval set
- Make sure the payment amount matches ($0.10)
- If signature verification fails, review the logged invalid reason and confirm the client signed the latest payment requirements
- For facilitator settlement errors, confirm the facilitator is reachable and that any `FACILITATOR_URL` / `FACILITATOR_API_KEY` settings are correct
- For local settlement errors, ensure your `PRIVATE_KEY` has gas and that the configured `RPC_URL` (or the network default) is responsive

### Address not whitelisted

Add the payer address (the `from` recovered from the EIP‑3009 signature) to `WLaddress.txt` (one per line, case-insensitive). Comments with `#` and blank lines are ignored.

## Security Considerations

- Never commit your `.env` file
- Keep your private key secure
- Use testnet for development
- Validate all payment data before processing
- Implement rate limiting for production
- Monitor for failed payment attempts

## Next Steps

- Replace the example OpenAI service with your own API logic
- Implement request queuing for high volume
- Add support for different payment tiers
- Create a web client interface
- Add analytics and monitoring
- Implement caching for common requests
- Add support for streaming responses

## License

ISC

## Resources

- [x402 Package on npm](https://www.npmjs.com/package/x402)
- [A2A Specification](https://github.com/google/a2a)
- [OpenAI API Documentation](https://platform.openai.com/docs)

## NFT Mint Workflow (Whitelist)

This server includes a planned paid endpoint `POST /mint` that mints an NFT to the payer address only if that address is present in `WLaddress.txt` (one address per line). See `AGENTS.md` for implementation notes and operational guidance.
