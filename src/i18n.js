// 전직/스킬 이름 한글 <-> 영문 (data/i18n/ko.json, poe2db.tw 기반, npm run i18n 으로 갱신)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const file = path.join(ROOT, 'data', 'i18n', 'ko.json');
export const I18N = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { classes: [], skills: [] };

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const classMap = new Map();
for (const c of I18N.classes) for (const k of [c.en, c.ko]) classMap.set(norm(k), c);
const skillMap = new Map();
for (const s of I18N.skills) for (const k of [s.en, s.ko]) skillMap.set(norm(k), s);

/** 한글/영문 어느 쪽으로 입력해도 영문 전직명 반환 (모르면 입력 그대로) */
export const classToEn = (name) => classMap.get(norm(name))?.en || String(name || '').trim();
export const skillToEn = (name) => skillMap.get(norm(name))?.en || String(name || '').trim();
export const classInfo = (name) => classMap.get(norm(name)) || null;
export const skillKo = (en) => skillMap.get(norm(en))?.ko || en;
export const classKo = (en) => classMap.get(norm(en))?.ko || en;
