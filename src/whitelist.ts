import fs from 'fs';
import path from 'path';

let cachedWhitelist: Set<string> | null = null;
let lastLoadedMs = 0;

function parseWhitelistFile(contents: string): Set<string> {
  const entries = new Set<string>();
  const lines = contents.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    entries.add(line.toLowerCase());
  }
  return entries;
}

export function getWhitelist(): Set<string> {
  const ttlMs = Number(process.env.WHITELIST_TTL_MS || 60000);
  const now = Date.now();
  if (cachedWhitelist && now - lastLoadedMs < ttlMs) return cachedWhitelist;

  const filePath = process.env.WHITELIST_PATH || path.resolve(process.cwd(), 'WLaddress.txt');
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    cachedWhitelist = parseWhitelistFile(text);
  } catch (err: any) {
    console.warn(`⚠️ Whitelist not loaded from ${filePath}: ${err?.message || String(err)}`);
    cachedWhitelist = new Set();
  }
  lastLoadedMs = now;
  return cachedWhitelist;
}

export function isWhitelisted(address: string): boolean {
  return getWhitelist().has(address.toLowerCase());
}


