import crypto from 'node:crypto';

export const ok = (data = {}, headers = {}) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify({ success: true, data }) });
export const fail = (statusCode, code, message, headers = {}) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify({ success: false, error: { code, message } }) });
export const methodNotAllowed = () => fail(405, 'METHOD_NOT_ALLOWED', 'ไม่อนุญาตให้ใช้ HTTP Method นี้');
export function readJson(event) { try { if (!event.body) return {}; const bodyStr = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body; return JSON.parse(bodyStr); } catch { throw new HttpError(400, 'INVALID_JSON', 'รูปแบบข้อมูลไม่ถูกต้อง'); } }
export class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
export const errorResponse = error => {
  const msg = String(error?.message || '');
  if (/storageQuotaExceeded|storage.*quota/i.test(msg)) {
    return fail(400, 'STORAGE_FULL', 'พื้นที่จัดเก็บไฟล์เต็ม (Storage Quota Exceeded)');
  }

  const isQuota = (
    error?.status === 429 ||
    error?.code === 429 ||
    error?.code === 'RATE_LIMITED' ||
    /(?:rate[ _-]?limit|resource_exhausted|too many requests)/i.test(msg) ||
    (!/storage/i.test(msg) && /quota/i.test(msg))
  );

  if (isQuota) {
    return fail(429, 'RATE_LIMITED', 'ท่านทำรายการติดต่อกันมากจนเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
  }

  if (error instanceof HttpError) return fail(error.status, error.code, error.message);
  console.error(error);
  return fail(500, 'INTERNAL_ERROR', error?.message || 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง');
};

const limits = new Map();
export function rateLimit(event, key, max = 10, windowMs = 60_000) {
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown'; const now = Date.now(); const id = `${key}:${ip}`;
  const record = limits.get(id) || { start: now, count: 0 }; if (now - record.start > windowMs) { record.start = now; record.count = 0; } record.count++; limits.set(id, record);
  if (record.count > max) throw new HttpError(429, 'RATE_LIMITED', 'ท่านทำรายการติดต่อกันมากจนเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
}
export function cleanText(value, max = 200) { return String(value ?? '').replace(/[\u0000-\u001F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
export function safeCell(value, max = 50000) {
  if (value === null || value === undefined) return '';
  const text = String(value).slice(0, max);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
export function bool(value) { return value === true || String(value).toUpperCase() === 'TRUE' || String(value).toLowerCase() === 'true'; }

function secret() { const s = process.env.SESSION_SECRET || process.env.ADMIN_JWT_SECRET; if (!s || s.length < 32) throw new HttpError(500, 'SERVER_CONFIGURATION', 'ยังไม่ได้ตั้งค่า SESSION_SECRET หรือ ADMIN_JWT_SECRET ให้ปลอดภัย (ต้องมีความยาวอย่างน้อย 32 ตัวอักษร)'); return s; }
function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
export function makeSession(user) {
  const u = typeof user === 'string' ? user : (user.username || user.u || '');
  const name = typeof user === 'object' ? (user.displayName || user.name || u) : u;
  const role = typeof user === 'object' ? (user.role || 'ADMIN') : 'ADMIN';
  const payload = Buffer.from(JSON.stringify({
    u,
    name,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 8
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function parseCookies(event) { return Object.fromEntries((event.headers.cookie || '').split(';').map(p => p.trim().split(/=(.*)/s)).filter(p => p[0]).map(([k,v]) => [k, decodeURIComponent(v || '')])); }
export function requireAdmin(event) { const token = parseCookies(event).admin_session; if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบผู้ดูแล'); const [payload, signature] = token.split('.'); if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(sign(payload)), Buffer.from(signature))) throw new HttpError(401, 'UNAUTHORIZED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); let session; try { session = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new HttpError(401, 'UNAUTHORIZED', 'เซสชันไม่ถูกต้อง'); } if (!session.u || session.exp < Date.now()) throw new HttpError(401, 'UNAUTHORIZED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); return session; }
export const sessionCookie = (token, event) => {
  const host = event?.headers?.host || '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; ${isLocal ? '' : 'Secure; '}SameSite=Lax; Max-Age=28800`;
};
export const clearSessionCookie = 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
