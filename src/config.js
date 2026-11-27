import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const contact = (process.env.POE2LAB_CONTACT || '').trim();

export const config = {
  port: Number(process.env.PORT || 3000),
  tradeMode: (process.env.TRADE_MODE || 'live').toLowerCase() === 'mock' ? 'mock' : 'live',
  poesessid: (process.env.POESESSID || '').trim(),
  // GGG: 서드파티 툴은 식별 가능한 User-Agent 를 보내야 함. ASCII 만 허용.
  userAgent: `poe2lab/0.1${contact ? ` (contact: ${contact.replace(/[^\x20-\x7e]/g, '')})` : ''}`,
  tradeBase: 'https://www.pathofexile.com',
  ninjaBase: 'https://poe.ninja',
  cacheTtlMs: 10 * 60 * 1000,
};
