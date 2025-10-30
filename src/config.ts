import fs from 'fs';
import path from 'path';

export interface RuntimeConfig {
  whitelistEnabled: boolean;
  perAddressLimit: number | null; // null => unlimited
}

let cached: RuntimeConfig | null = null;
let lastLoadedMs = 0;
let lastMtimeMs = 0;

function getConfigPath(): string {
  const p = process.env.SERVER_CONFIG_PATH || 'server-config.json';
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function readJson(filePath: string): any | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs === lastMtimeMs && cached) return null; // unchanged
    const raw = fs.readFileSync(filePath, 'utf8');
    lastMtimeMs = stat.mtimeMs;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function baseDefaults(): RuntimeConfig {
  const envWhitelistEnabled = (process.env.WHITELIST_ENABLED || 'true').trim().toLowerCase();
  const envLimit = (process.env.MINT_PER_ADDRESS_LIMIT || '3').trim();

  const whitelistEnabled = envWhitelistEnabled !== 'false' && envWhitelistEnabled !== '0';

  let perAddressLimit: number | null = 3;
  if (envLimit.toLowerCase() === 'null' || envLimit === '' || envLimit === '-1') {
    perAddressLimit = null;
  } else {
    const num = Number(envLimit);
    perAddressLimit = Number.isFinite(num) && num >= 0 ? num : 3;
  }

  return { whitelistEnabled, perAddressLimit };
}

export function getConfig(): RuntimeConfig {
  const ttlMs = Number(process.env.SERVER_CONFIG_TTL_MS || 3000);
  const now = Date.now();
  if (cached && now - lastLoadedMs < ttlMs) return cached;

  const defaults = baseDefaults();
  const filePath = getConfigPath();
  const fromFile = readJson(filePath);

  const merged: RuntimeConfig = {
    whitelistEnabled: fromFile?.whitelistEnabled ?? defaults.whitelistEnabled,
    perAddressLimit: fromFile?.perAddressLimit ?? defaults.perAddressLimit,
  };

  cached = merged;
  lastLoadedMs = now;
  return cached;
}


