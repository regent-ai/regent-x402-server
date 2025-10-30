import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PaymentPayload } from 'x402/types';

interface StoreData {
  mints: Record<string, number>;
  processedPayments: Record<string, true>;
}

function getStorePath(): string {
  const configured = process.env.MINT_STORE_PATH;
  return configured && configured.trim() !== ''
    ? (path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured))
    : path.resolve(process.cwd(), 'mint-store.json');
}

function ensureDirFor(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore(): StoreData {
  const p = getStorePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      mints: parsed?.mints ?? {},
      processedPayments: parsed?.processedPayments ?? {},
    } as StoreData;
  } catch {
    return { mints: {}, processedPayments: {} };
  }
}

function writeStore(data: StoreData): void {
  const p = getStorePath();
  ensureDirFor(p);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  }
  return `{${parts.join(',')}}`;
}

export function paymentIdFromPayload(payload: PaymentPayload): string {
  const canonical = stableStringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function isPaymentProcessed(paymentId: string): boolean {
  const store = readStore();
  return Boolean(store.processedPayments[paymentId]);
}

export function markPaymentProcessed(paymentId: string): void {
  const store = readStore();
  store.processedPayments[paymentId] = true as const;
  writeStore(store);
}

export function getMintCount(address: string): number {
  const addr = address.toLowerCase();
  const store = readStore();
  return store.mints[addr] ?? 0;
}

export function incMintCount(address: string, by: number = 1): number {
  const addr = address.toLowerCase();
  const store = readStore();
  const next = (store.mints[addr] ?? 0) + by;
  store.mints[addr] = next;
  writeStore(store);
  return next;
}


