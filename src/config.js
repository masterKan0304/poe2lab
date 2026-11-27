import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const contact = (process.env.POE2LAB_CONTACT || '').trim();

const isVercel = !!process.env.VERCEL;

export const config = {
  isVercel,
  port: Number(process.env.PORT || 3000),
  // npm run start:mock (--mock) 는 Windows 에서도 동작하도록 환경변수 대신 인자로 받음
  // Vercel(호스팅)에서는 데모가 기본: 데이터센터 IP 는 GGG trade API 가 막기 때문
  tradeMode: process.argv.includes('--mock') || (process.env.TRADE_MODE || (isVercel ? 'mock' : 'live')).toLowerCase() === 'mock' ? 'mock' : 'live',
  // 공개 호스팅에서 POESESSID 를 쓰면 방문자 누구나 그 계정으로 요청하게 되므로 Vercel 에서는 무시
  poesessid: isVercel ? '' : (process.env.POESESSID || '').trim(),
  // GGG: 서드파티 툴은 식별 가능한 User-Agent 를 보내야 함. ASCII 만 허용.
  userAgent: `poe2lab/0.1${contact ? ` (contact: ${contact.replace(/[^\x20-\x7e]/g, '')})` : ''}`,
  tradeBase: 'https://www.pathofexile.com',
  ninjaBase: 'https://poe.ninja',
  cacheTtlMs: 10 * 60 * 1000,
};
