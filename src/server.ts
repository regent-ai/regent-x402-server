import express from 'express';
import dotenv from 'dotenv';
import { MerchantExecutor, type MerchantExecutorOptions } from './MerchantExecutor.js';
import type { Network, PaymentPayload } from 'x402/types';
import { isWhitelisted, getWhitelist } from './whitelist.js';
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
const NETWORK = process.env.NETWORK || 'base';
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
        'x402.payment.status': {
          type: 'string',
          required: false,
          enum: ['payment-submitted'],
          description: 'Client sets this when submitting the signed payment payload'
        },
        'x402.payment.payload': {
          type: 'object',
          required: false,
          description: 'Signed x402 exact payload (EIP-3009 authorization + signature)'
        }
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
        price: `$80.00`,
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
    const raw = req.body;
    console.log('   headers content-type=%s body.type=%s', req.headers['content-type'] || 'n/a', typeof raw);
    let body: any = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
        console.log('   parsed string body as JSON');
      } catch {
        console.log('   failed to parse string body as JSON');
        body = {};
      }
    }
    body = body || {};
    const { message } = body as any;
    // Allow empty body; unpaid requests should return 402 with Accepts

    // Log request body structure (sanitized) for debugging
    console.log('📦 Full request body keys:', Object.keys(body));
    console.log('📦 Body type:', typeof body);
    try {
      const bodyKeys = Object.keys(body).filter(k => k !== 'x402' && k !== 'paymentPayload' && k !== 'payment');
      const hasMessage = Boolean(body.message);
      const hasMetadata = Boolean(body.metadata);
      const messageKeys = message ? Object.keys(message).filter(k => k !== 'metadata') : [];
      const messageMetadataKeys = message?.metadata ? Object.keys(message.metadata).filter(k => !k.includes('payment')) : [];
      console.log(`📦 Request body structure: hasMessage=${hasMessage}, hasMetadata=${hasMetadata}, topLevelKeys=[${bodyKeys.join(',')}]`);
      if (message) {
        console.log(`   message keys: [${messageKeys.join(',')}]`);
        if (message.metadata) {
          console.log(`   message.metadata keys: [${messageMetadataKeys.join(',')}]`);
        }
      }
    } catch (e) {
      console.error('Error logging body structure:', e);
    }

    // Accept multiple shapes for x402 fields (message.metadata, metadata, top-level keys)
    // Also handle Railway API explorer format which might send JSON strings
    let paymentPayload: PaymentPayload | undefined;
    let payloadSource = '';
    const payloadCandidates: Array<[any, string]> = [
      [message?.metadata?.['x402.payment.payload'], 'message.metadata["x402.payment.payload"]'],
      [message?.metadata?.x402?.payment?.payload, 'message.metadata.x402.payment.payload'],
      [body?.metadata?.['x402.payment.payload'], 'body.metadata["x402.payment.payload"]'],
      [body?.metadata?.x402?.payment?.payload, 'body.metadata.x402.payment.payload'],
      [body?.['x402.payment.payload'], 'body["x402.payment.payload"]'],
      [body?.paymentPayload, 'body.paymentPayload'],
      [body?.payment?.payload, 'body.payment.payload'],
      [body?.x402?.payment?.payload, 'body.x402.payment.payload'],
    ];
    
    // Try to parse JSON strings if found
    for (const [val, src] of payloadCandidates) {
      if (val) {
        try {
          // If it's a string, try to parse it as JSON
          if (typeof val === 'string') {
            const parsed = JSON.parse(val);
            paymentPayload = parsed as PaymentPayload;
            payloadSource = `${src} (parsed from JSON string)`;
            break;
          } else {
            paymentPayload = val as PaymentPayload;
            payloadSource = src;
            break;
          }
        } catch {
          // If parsing fails, use the value as-is
          paymentPayload = val as PaymentPayload;
          payloadSource = src;
          break;
        }
      }
    }
    if (!paymentPayload) {
      console.log('❌ Payment payload not found. Checked locations:');
      for (const [val, src] of payloadCandidates) {
        const found = val !== undefined && val !== null;
        console.log(`   ${src}: ${found ? 'found' : 'not found'}`);
        if (found) {
          console.log(`      Value type: ${typeof val}, isObject: ${typeof val === 'object'}`);
        }
      }
    } else {
      console.log(`✅ Payment payload found at: ${payloadSource}`);
    }

    let paymentStatus: string | undefined;
    let statusSource = '';
    const statusCandidates: Array<[any, string]> = [
      [message?.metadata?.['x402.payment.status'], 'message.metadata["x402.payment.status"]'],
      [message?.metadata?.x402?.payment?.status, 'message.metadata.x402.payment.status'],
      [body?.metadata?.['x402.payment.status'], 'body.metadata["x402.payment.status"]'],
      [body?.metadata?.x402?.payment?.status, 'body.metadata.x402.payment.status'],
      [body?.['x402.payment.status'], 'body["x402.payment.status"]'],
      [body?.paymentStatus, 'body.paymentStatus'],
      [body?.payment?.status, 'body.payment.status'],
      [body?.x402?.payment?.status, 'body.x402.payment.status'],
    ];
    for (const [val, src] of statusCandidates) {
      if (typeof val === 'string') { paymentStatus = val; statusSource = src; break; }
    }
    if (!paymentStatus) {
      console.log('❌ Payment status not found. Checked locations:');
      for (const [val, src] of statusCandidates) {
        const found = val !== undefined && val !== null;
        console.log(`   ${src}: ${found ? `found="${val}" (type: ${typeof val})` : 'not found'}`);
      }
    } else {
      console.log(`✅ Payment status found at: ${statusSource} = "${paymentStatus}"`);
    }

    // Debug logging for incoming shapes (without leaking signature contents)
    try {
      const pp: any = paymentPayload as any;
      const sig = pp?.payload?.signature as string | undefined;
      const sigHint = sig ? `${sig.slice(0, 10)}…${sig.slice(-8)} (len=${sig.length})` : 'none';
      console.log('🧾 x402 fields: status=%s (from %s), payloadFrom=%s', paymentStatus ?? 'undefined', statusSource || 'n/a', payloadSource || 'n/a');
      if (pp) {
        console.log(
          '   payload: scheme=%s network=%s auth.from=%s to=%s value=%s validBefore=%s sig=%s',
          pp?.scheme ?? pp?.payload?.scheme,
          pp?.network,
          pp?.payload?.authorization?.from,
          pp?.payload?.authorization?.to,
          pp?.payload?.authorization?.value,
          pp?.payload?.authorization?.validBefore,
          sigHint
        );
      }
    } catch {}

    if (!paymentPayload || paymentStatus !== 'payment-submitted') {
      const paymentRequired = merchantExecutorMint.createPaymentRequiredResponse();
      console.log(`💰 Payment required for mint: payload=${paymentPayload ? 'found' : 'missing'}, status="${paymentStatus}" (expected "payment-submitted")`);
      return res.status(402).json(paymentRequired);
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

    console.log(`👤 Verified payer: ${payer}`);

    const { whitelistEnabled, perAddressLimit } = getConfig();
    console.log(`📋 Whitelist check: enabled=${whitelistEnabled}, perAddressLimit=${perAddressLimit ?? 'unlimited'}`);

    if (whitelistEnabled) {
      const isWhitelistedResult = isWhitelisted(payer);
      const whitelistSize = getWhitelist().size;
      console.log(`   Checking payer ${payer} against whitelist (${whitelistSize} addresses)...`);
      if (!isWhitelistedResult) {
        console.log(`⛔ Payer ${payer} NOT in whitelist`);
        return res.status(403).json({ error: 'address-not-whitelisted', payer });
      }
      console.log(`✅ Payer ${payer} is whitelisted`);
    } else {
      console.log(`⚠️ Whitelist is disabled - allowing all addresses`);
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

    // Record mint usage (NFT was delivered)
    const newCount = incMintCount(payer, 1);

    // Settle payment BEFORE marking as processed (allows retry if settlement fails)
    const settlement = await merchantExecutorMint.settlePayment(paymentPayload);
    
    if (!settlement.success) {
      // Mint succeeded but settlement failed - don't mark payment as processed to allow retry
      console.error(`⚠️ Mint succeeded but settlement failed: ${settlement.errorReason}`);
      return res.status(500).json({
        error: 'settlement-failed',
        mintSucceeded: true,
        paymentSettled: false,
        payer,
        mintTxHash: mint.transactionHash,
        tokenUri: mint.tokenUri,
        settlement,
        errorReason: settlement.errorReason,
        remainingMints: perAddressLimit == null ? null : Math.max(0, perAddressLimit - newCount),
      });
    }

    // Only mark payment as processed after successful settlement
    markPaymentProcessed(paymentId);
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

// Discovery endpoint: return 402 with x402 Accepts on GET for scanners
app.get('/mint', (req, res) => {
  const paymentRequired = merchantExecutorMint.createPaymentRequiredResponse();
  return res.status(402).json(paymentRequired);
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
