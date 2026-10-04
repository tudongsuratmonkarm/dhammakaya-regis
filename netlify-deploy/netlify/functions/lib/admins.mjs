import crypto from 'node:crypto';
import { HEADERS, SHEETS } from './constants.mjs';
import { appendRows, ensureSheet, getRecords } from './sheets.mjs';

export function hashPassword(plain) {
  const hash = crypto.createHash('sha256').update(String(plain || '')).digest('hex');
  return `sha256:${hash}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || plain === undefined || plain === null) return false;
  const s = String(stored).trim();
  const inputStr = String(plain);

  if (s.startsWith('sha256:')) {
    const expected = s.slice(7);
    const computed = crypto.createHash('sha256').update(inputStr).digest('hex');
    const bExpected = Buffer.from(expected);
    const bComputed = Buffer.from(computed);
    return bExpected.length === bComputed.length && crypto.timingSafeEqual(bExpected, bComputed);
  }

  if (s.includes(':')) {
    const [kind, expected] = s.split(':');
    if (kind === 'sha256') {
      const computed = crypto.createHash('sha256').update(inputStr).digest('hex');
      const bExpected = Buffer.from(expected);
      const bComputed = Buffer.from(computed);
      return bExpected.length === bComputed.length && crypto.timingSafeEqual(bExpected, bComputed);
    }
  }

  // Plaintext fallback (e.g. if manually filled into Google Sheets directly)
  const left = Buffer.from(inputStr);
  const right = Buffer.from(s);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function ensureAdminsSheet() {
  await ensureSheet(SHEETS.ADMINS, HEADERS[SHEETS.ADMINS]);
  try {
    const existing = await getRecords(SHEETS.ADMINS);
    if (!existing.length && process.env.ADMIN_USERNAME) {
      const now = new Date().toISOString();
      const defaultAdmin = {
        adminId: 'ADM-1',
        username: process.env.ADMIN_USERNAME,
        passwordHash: process.env.ADMIN_PASSWORD_HASH || (process.env.ADMIN_PASSWORD ? hashPassword(process.env.ADMIN_PASSWORD) : ''),
        displayName: 'ผู้ดูแลระบบหลัก (Master)',
        role: 'SUPERADMIN',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: '',
        createdBy: 'SYSTEM'
      };
      await appendRows(SHEETS.ADMINS, [defaultAdmin]);
    }
  } catch (err) {
    console.warn('[ensureAdminsSheet] Failed checking records:', err?.message);
  }
}

export async function getAdmins(includeSecrets = false) {
  await ensureAdminsSheet();
  const records = await getRecords(SHEETS.ADMINS);
  if (includeSecrets) return records;
  return records.map(r => {
    const copy = { ...r };
    delete copy.passwordHash;
    delete copy.password;
    return copy;
  });
}

export async function findAdminByUsername(username) {
  if (!username) return null;
  const target = String(username).trim().toLowerCase();
  await ensureAdminsSheet();
  const records = await getRecords(SHEETS.ADMINS);
  return records.find(r => String(r.username || '').trim().toLowerCase() === target) || null;
}
