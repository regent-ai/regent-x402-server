import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

interface MintResult {
  success: boolean;
  transactionHash?: string;
  tokenUri?: string;
  functionSignature?: string;
  errorReason?: string;
}

function loadAbi(): any[] {
  const abiPath = process.env.NFT_ABI_PATH;
  if (abiPath) {
    const resolved = path.isAbsolute(abiPath) ? abiPath : path.resolve(process.cwd(), abiPath);
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray((parsed as any).abi)) return (parsed as any).abi;
    throw new Error('NFT_ABI_PATH JSON must be an ABI array or an object with an "abi" array');
  }
  // Minimal common ERC-721 mint ABIs
  return [
    'function mint(address to)',
    'function safeMint(address to)',
    'function safeMint(address to, string uri)',
    'function mint(address to, string uri)'
  ];
}

function pickSignature(contract: ethers.Contract, preferredMethod: string, needsUri: boolean): string {
  const candidates: string[] = needsUri
    ? [
        `${preferredMethod}(address,string)`,
        'safeMint(address,string)',
        'mint(address,string)'
      ]
    : [
        `${preferredMethod}(address)`,
        'safeMint(address)',
        'mint(address)'
      ];

  for (const sig of candidates) {
    try {
      // getFunction will throw if not present
      contract.getFunction(sig);
      return sig;
    } catch {}
  }
  throw new Error(`No matching mint function found on contract for method "${preferredMethod}"`);
}

function resolveTokenUri(): string | undefined {
  const explicit = process.env.MINT_TOKEN_URI;
  if (explicit) return explicit;
  const template = process.env.MINT_TOKEN_URI_TEMPLATE;
  if (!template) return undefined;
  const min = Number.parseInt(process.env.MINT_TOKEN_ID_MIN || '1', 10);
  const max = Number.parseInt(process.env.MINT_TOKEN_ID_MAX || '999', 10);
  const id = Math.floor(Math.random() * (max - min + 1)) + min;
  return template.replace('{id}', String(id));
}

export async function mintToAddress(to: string): Promise<MintResult> {
  const rpcUrl = process.env.MINT_RPC_URL;
  const privateKey = process.env.MINT_SIGNER_PRIVATE_KEY;
  const contractAddress = process.env.NFT_CONTRACT_ADDRESS;
  const method = (process.env.MINT_METHOD || 'mint').trim();

  if (!rpcUrl) return { success: false, errorReason: 'MINT_RPC_URL is not set' };
  if (!privateKey) return { success: false, errorReason: 'MINT_SIGNER_PRIVATE_KEY is not set' };
  if (!contractAddress) return { success: false, errorReason: 'NFT_CONTRACT_ADDRESS is not set' };

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);
  const abi = loadAbi();
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  const tokenUri = resolveTokenUri();
  const needsUri = Boolean(tokenUri);
  const signature = pickSignature(contract, method, needsUri);

  try {
    const args: any[] = needsUri ? [to, tokenUri] : [to];
    const fn = contract.getFunction(signature);
    const tx = await fn(...args);
    const receipt = await tx.wait();
    const success = receipt?.status === 1;
    return {
      success,
      transactionHash: receipt?.hash,
      tokenUri: tokenUri,
      functionSignature: signature,
      errorReason: success ? undefined : 'Transaction reverted',
    };
  } catch (err: any) {
    return {
      success: false,
      errorReason: err?.message || String(err),
      functionSignature: signature,
      tokenUri,
    };
  }
}


