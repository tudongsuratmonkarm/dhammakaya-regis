import crypto from 'node:crypto';
import { audit } from './lib/audit.mjs';
import { clearSessionCookie, errorResponse, HttpError, makeSession, methodNotAllowed, ok, rateLimit, readJson, sessionCookie } from './lib/http.mjs';
import { netlify } from './lib/adapter.mjs';
import { findAdminByUsername, hashPassword, verifyPassword } from './lib/admins.mjs';
import { SHEETS } from './lib/constants.mjs';
import { updateRow } from './lib/sheets.mjs';

function equal(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function masterPasswordMatches(input) {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash) {
    const [kind, expected] = hash.split(':');
    if (kind === 'sha256' && expected) {
      return equal(crypto.createHash('sha256').update(String(input || '')).digest('hex'), expected);
    }
    return false;
  }
  return equal(String(input || ''), process.env.ADMIN_PASSWORD || '');
}

export const handler = async event => {
  try {
    if (event.httpMethod === 'DELETE') {
      return ok({ loggedOut: true }, { 'Set-Cookie': clearSessionCookie });
    }
    if (event.httpMethod !== 'POST') return methodNotAllowed();

    rateLimit(event, 'admin-login', 10, 15 * 60_000);
    const { username, password } = readJson(event);
    const inputUser = String(username || '').trim();
    const inputPass = String(password || '');

    if (!inputUser || !inputPass) {
      throw new HttpError(400, 'INVALID_INPUT', 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน');
    }

    let authenticatedUser = null;

    // 1. Check Master SuperAdmin from environment variables
    const masterUser = process.env.ADMIN_USERNAME;
    if (masterUser && equal(inputUser.toLowerCase(), masterUser.toLowerCase()) && masterPasswordMatches(inputPass)) {
      authenticatedUser = {
        username: masterUser,
        displayName: 'ผู้ดูแลระบบหลัก (Master)',
        role: 'SUPERADMIN'
      };
    }

    // 2. If not master env admin, check Admins sheet in Google Sheets
    if (!authenticatedUser) {
      try {
        const found = await findAdminByUsername(inputUser);
        if (found) {
          if ((found.status || 'ACTIVE').toUpperCase() === 'INACTIVE') {
            throw new HttpError(403, 'ACCOUNT_INACTIVE', 'บัญชีผู้ใช้นี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบหลัก');
          }

          const storedPass = found.passwordHash || found.password;
          if (verifyPassword(inputPass, storedPass)) {
            authenticatedUser = {
              username: found.username,
              displayName: found.displayName || found.username,
              role: found.role || 'ADMIN'
            };

            // Update lastLoginAt and upgrade plain password to hash if needed
            const now = new Date().toISOString();
            const updates = {
              lastLoginAt: now,
              updatedAt: now
            };
            if (!String(found.passwordHash || '').startsWith('sha256:')) {
              updates.passwordHash = hashPassword(inputPass);
            }
            if (found._rowNumber) {
              updateRow(SHEETS.ADMINS, found._rowNumber, { ...found, ...updates }).catch(err => {
                console.warn('[admin-login] Failed updating lastLoginAt:', err?.message);
              });
            }
          }
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        console.warn('[admin-login] Error checking Admins sheet:', err?.message);
      }
    }

    if (!authenticatedUser) {
      throw new HttpError(401, 'INVALID_LOGIN', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    const token = makeSession(authenticatedUser);
    await audit('LOGIN', 'ADMIN', authenticatedUser.username, authenticatedUser.displayName, {
      role: authenticatedUser.role
    });

    return ok({ loggedIn: true, admin: authenticatedUser }, { 'Set-Cookie': sessionCookie(token, event) });
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);
