import express from 'express';
import dotenv from 'dotenv';
import { MerchantExecutor, type MerchantExecutorOptions } from './MerchantExecutor.js';
import type { Network, PaymentPayload } from 'x402/types';
import { isWhitelisted } from './whitelist.js';
import { mintToAddress } from './MintService.js';
import { getConfig } from './config.js';
import {
  getMintCount,
  incMintCount,
  paymentIdFromPayload,
  isPaymentProcessed,
  markPaymentProcessed,
} from './store.js';
import {
  EventQueue,
  Message,
  RequestContext,
  Task,
  TaskState,
} from './x402Types.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const NETWORK = process.env.NETWORK || 'base-sepolia';
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;
const SERVICE_URL_MINT =
  process.env.SERVICE_URL_MINT || `http://localhost:${PORT}/mint`;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const SETTLEMENT_MODE_ENV = process.env.SETTLEMENT_MODE?.toLowerCase();
const ASSET_ADDRESS = process.env.ASSET_ADDRESS;
const ASSET_NAME = process.env.ASSET_NAME;
const EXPLORER_URL = process.env.EXPLORER_URL;
const CHAIN_ID = process.env.CHAIN_ID
  ? Number.parseInt(process.env.CHAIN_ID, 10)
  : undefined;
const SUPPORTED_NETWORKS: Network[] = [
  'base',
  'base-sepolia',
  'polygon',
  'polygon-amoy',
  'avalanche',
  'avalanche-fuji',
  'iotex',
  'sei',
  'sei-testnet',
  'peaq',
  'solana',
  'solana-devnet',
];

if (!PAY_TO_ADDRESS) {
  console.error('❌ PAY_TO_ADDRESS is required');
  process.exit(1);
}

if (!SUPPORTED_NETWORKS.includes(NETWORK as Network)) {
  console.error(
    `❌ NETWORK "${NETWORK}" is not supported. Supported networks: ${SUPPORTED_NETWORKS.join(
      ', '
    )}`
  );
  process.exit(1);
}

const resolvedNetwork = NETWORK as Network;

let settlementMode: 'facilitator' | 'direct';
if (SETTLEMENT_MODE_ENV === 'local' || SETTLEMENT_MODE_ENV === 'direct') {
  settlementMode = 'direct';
} else if (SETTLEMENT_MODE_ENV === 'facilitator') {
  settlementMode = 'facilitator';
} else if (FACILITATOR_URL) {
  settlementMode = 'facilitator';
} else if (PRIVATE_KEY) {
  settlementMode = 'direct';
} else {
  settlementMode = 'facilitator';
}

if (settlementMode === 'direct' && !PRIVATE_KEY) {
  console.error('❌ SETTLEMENT_MODE=local requires PRIVATE_KEY to be configured');
  process.exit(1);
}

// Initialize x402 executor for /mint
const merchantOptionsMint: MerchantExecutorOptions = {
  payToAddress: PAY_TO_ADDRESS,
  network: resolvedNetwork,
  price: 80,
  facilitatorUrl: FACILITATOR_URL,
  facilitatorApiKey: FACILITATOR_API_KEY,
  resourceUrl: SERVICE_URL_MINT,
  settlementMode,
  rpcUrl: RPC_URL,
  privateKey: PRIVATE_KEY,
  assetAddress: ASSET_ADDRESS,
  assetName: ASSET_NAME,
  explorerUrl: EXPLORER_URL,
  chainId: CHAIN_ID,
  description: 'Mint 1 ERC-721 to the verified payer (Base)',
  outputSchema: {
    input: {
      type: 'http',
      method: 'POST',
      bodyType: 'json',
      bodyFields: {
        message: {
          type: 'object',
          required: true,
          description: 'A2A message with x402 metadata',
          properties: {
            metadata: {
              type: 'object',
              required: true,
              properties: {
                'x402.payment.status': {
                  type: 'string',
                  enum: ['payment-submitted'],
                  description: 'Must be set when submitting signed payment payload',
                },
                'x402.payment.payload': {
                  type: 'object',
                  required: true,
                  description: 'x402 exact scheme payload (EIP-3009 authorization + signature)'
                }
              }
            }
          }
        }
      }
    },
    output: {
      success: 'boolean',
      payer: 'string',
      mintTxHash: 'string',
      tokenUri: 'string',
      settlement: {
        success: 'boolean',
        network: 'string',
        transaction: 'string'
      }
    }
  }
};

const merchantExecutorMint = new MerchantExecutor(merchantOptionsMint);

if (settlementMode === 'direct') {
  console.log('🧩 Using local settlement (direct EIP-3009 via RPC)');
  if (RPC_URL) {
    console.log(`🔌 RPC endpoint: ${RPC_URL}`);
  } else {
    console.log('🔌 RPC endpoint: using default for selected network');
  }
} else if (FACILITATOR_URL) {
  console.log(`🌐 Using custom facilitator: ${FACILITATOR_URL}`);
} else {
  console.log('🌐 Using default facilitator: https://x402.org/facilitator');
}

console.log('🚀 x402 Payment API initialized');
console.log(`💰 Payment address: ${PAY_TO_ADDRESS}`);
console.log(`🌐 Network: ${resolvedNetwork}`);
console.log(`💵 Mint price: $80.00 USDC`);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'x402-payment-api',
    version: '1.0.0',
    payment: {
      address: PAY_TO_ADDRESS,
      network: NETWORK,
      mint: {
        resource: '/mint',
        price: '$80.00',
      },
    },
  });
});

/**
 * Paid mint endpoint: verifies x402 payment, checks whitelist, mints NFT, then settles
 */
app.post('/mint', async (req, res) => {
  try {
    console.log('\n📥 Received /mint request');
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'Missing message in request body' });
    }

    const paymentPayload = message.metadata?.['x402.payment.payload'] as
      | PaymentPayload
      | undefined;
    const paymentStatus = message.metadata?.['x402.payment.status'];

    if (!paymentPayload || paymentStatus !== 'payment-submitted') {
      const paymentRequired = merchantExecutorMint.createPaymentRequiredResponse();
      console.log('💰 Payment required for mint');
      return res.status(402).json({
        success: false,
        error: 'Payment Required',
        required: paymentRequired,
      });
    }

    const verifyResult = await merchantExecutorMint.verifyPayment(paymentPayload);
    if (!verifyResult.isValid) {
      const reason = verifyResult.invalidReason || 'Invalid payment';
      console.log(`❌ Payment verification failed: ${reason}`);
      return res.status(402).json({ error: 'payment-rejected', reason });
    }

    const payer = (verifyResult.payer || '').toLowerCase();
    if (!payer) {
      return res.status(500).json({ error: 'payer-unavailable' });
    }

    const { whitelistEnabled, perAddressLimit } = getConfig();

    if (whitelistEnabled && !isWhitelisted(payer)) {
      console.log(`⛔ Payer ${payer} not in whitelist`);
      return res.status(403).json({ error: 'address-not-whitelisted', payer });
    }

    // Idempotency: dedupe by payment payload hash
    const paymentId = paymentIdFromPayload(paymentPayload);
    if (isPaymentProcessed(paymentId)) {
      const used = getMintCount(payer);
      const remaining = perAddressLimit == null ? null : Math.max(0, perAddressLimit - used);
      return res.json({ success: true, alreadyProcessed: true, payer, remainingMints: remaining });
    }

    // Quota: max 3 mints per address
    const used = getMintCount(payer);
    if (perAddressLimit != null && used >= perAddressLimit) {
      console.log(`⛔ Payer ${payer} exceeded mint limit (used=${used}, limit=${perAddressLimit})`);
      return res.status(403).json({ error: 'mint-limit-reached', limit: perAddressLimit, payer });
    }

    console.log(`✅ Payer ${payer} verified and whitelisted. Minting...`);
    const mint = await mintToAddress(payer);
    if (!mint.success || !mint.transactionHash) {
      console.error(`❌ Mint failed: ${mint.errorReason || 'unknown'}`);
      return res.status(500).json({
        error: 'mint-failed',
        reason: mint.errorReason,
        payer,
      });
    }

    // Record mint usage and idempotency as soon as mint succeeds
    const newCount = incMintCount(payer, 1);
    markPaymentProcessed(paymentId);

    const settlement = await merchantExecutorMint.settlePayment(paymentPayload);
    console.log('📤 Mint + settlement completed');

    return res.json({
      success: true,
      payer,
      mintTxHash: mint.transactionHash,
      tokenUri: mint.tokenUri,
      settlement,
      remainingMints: perAddressLimit == null ? null : Math.max(0, perAddressLimit - newCount),
    });
  } catch (error: any) {
    console.error('❌ Error in /mint:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
});

/**
 * Simple test endpoint to try the agent
 */
// (test endpoint removed)

// Start the server
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`📖 Health check: http://localhost:${PORT}/health`);
  console.log(`🧬 Mint endpoint: POST http://localhost:${PORT}/mint\n`);
});
