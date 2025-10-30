import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Wallet } from 'ethers';

function readJson(p: string): any {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing env: ${name}`);
  return v.trim();
}

async function main(): Promise<void> {
  const inPath = process.env.REQUIREMENT_JSON_PATH || '/tmp/mint_402.json';
  const outPath = process.env.OUT_PATH || '/tmp/mint_payload.json';
  const pkRaw = requireEnv('CLIENT_PRIVATE_KEY');

  const root = readJson(inPath);
  const req = root.required ?? root; // accept either the full 402 wrapper or the accepts-only object
  if (!req?.accepts || !Array.isArray(req.accepts) || req.accepts.length === 0) {
    throw new Error('No payment requirements found in input JSON');
  }
  const opt = req.accepts[0];

  // Normalize private key to a single 0x prefix
  const pkNorm = '0x' + pkRaw.replace(/^(0x)+/i, '');
  const wallet = new Wallet(pkNorm);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: wallet.address,
    to: opt.payTo,
    value: opt.maxAmountRequired,
    validAfter: '0',
    validBefore: String(now + (opt.maxTimeoutSeconds || 600)),
    nonce: '0x' + crypto.randomBytes(32).toString('hex'),
  };

  const chainId = opt.network === 'base' ? 8453 : 84532;
  const domain = {
    name: opt.extra?.name || 'USDC',
    version: opt.extra?.version || '2',
    chainId,
    verifyingContract: opt.asset,
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;

  const signature = await wallet.signTypedData(domain as any, types as any, authorization as any);

  const payload = {
    x402Version: 1,
    scheme: opt.scheme,
    network: opt.network,
    payload: { authorization, signature },
  };

  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${outPath} for ${wallet.address}`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});


