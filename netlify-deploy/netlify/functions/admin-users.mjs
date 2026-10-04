import { audit } from './lib/audit.mjs';
import { errorResponse, HttpError, methodNotAllowed, ok, readJson, requireAdmin } from './lib/http.mjs';
import { netlify } from './lib/adapter.mjs';
import { ensureAdminsSheet, getAdmins, hashPassword } from './lib/admins.mjs';
import { HEADERS, SHEETS } from './lib/constants.mjs';
import { appendRows, deleteRow, getRecords, updateRow } from './lib/sheets.mjs';

function sanitizeUsername(u) {
  return String(u || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export const handler = async event => {
  try {
    const admin = requireAdmin(event);
    await ensureAdminsSheet();

    // GET: List all admin accounts
    if (event.httpMethod === 'GET') {
      const admins = await getAdmins(false);
      return ok({
        admins: admins.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))),
        currentAdmin: {
          username: admin.u,
          displayName: admin.name || admin.u,
          role: admin.role || 'ADMIN'
        }
      });
    }

    if (!['POST', 'PUT', 'DELETE'].includes(event.httpMethod)) {
      return methodNotAllowed();
    }

    // Only SUPERADMIN or ADMIN can manage users
    const currentRole = (admin.role || 'ADMIN').toUpperCase();
    if (currentRole === 'STAFF') {
      throw new HttpError(403, 'FORBIDDEN', 'คุณไม่มีสิทธิ์จัดการบัญชีผู้ดูแลระบบ (สำหรับ SuperAdmin/Admin เท่านั้น)');
    }

    const body = readJson(event);
    const existingAdmins = await getRecords(SHEETS.ADMINS);

    // POST: Create Admin
    if (event.httpMethod === 'POST') {
      const rawUser = String(body.username || '').trim();
      const username = sanitizeUsername(rawUser);
      const password = String(body.password || '').trim();
      const displayName = String(body.displayName || rawUser).trim();
      const role = ['SUPERADMIN', 'STAFF'].includes(String(body.role || '').toUpperCase()) ? String(body.role).toUpperCase() : 'ADMIN';
      const status = String(body.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

      if (!username || username.length < 3) {
        throw new HttpError(400, 'INVALID_USERNAME', 'ชื่อผู้ใช้ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลขอย่างน้อย 3 ตัวอักษร');
      }
      if (!password || password.length < 4) {
        throw new HttpError(400, 'INVALID_PASSWORD', 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร');
      }

      // Check duplicates
      const dup = existingAdmins.some(a => String(a.username || '').trim().toLowerCase() === username);
      if (dup || username === String(process.env.ADMIN_USERNAME || '').toLowerCase()) {
        throw new HttpError(409, 'DUPLICATE_USERNAME', `ชื่อผู้ใช้ "${username}" มีอยู่ในระบบแล้ว`);
      }

      const now = new Date().toISOString();
      const adminId = `ADM-${Date.now()}`;
      const newAdmin = {
        adminId,
        username,
        passwordHash: hashPassword(password),
        displayName: displayName || username,
        role,
        status,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: '',
        createdBy: admin.name || admin.u
      };

      await appendRows(SHEETS.ADMINS, [newAdmin]);
      await audit('CREATE', 'ADMIN_USER', adminId, admin.name || admin.u, {
        username,
        displayName: newAdmin.displayName,
        role,
        status
      });

      const safeReturn = { ...newAdmin };
      delete safeReturn.passwordHash;
      return ok({ admin: safeReturn });
    }

    // PUT: Update Admin
    if (event.httpMethod === 'PUT') {
      const adminId = String(body.adminId || '').trim();
      const targetUser = String(body.username || '').trim().toLowerCase();

      const target = existingAdmins.find(a => (adminId && a.adminId === adminId) || (targetUser && String(a.username || '').toLowerCase() === targetUser));
      if (!target) {
        throw new HttpError(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ดูแลที่ต้องการแก้ไข');
      }

      const now = new Date().toISOString();
      const updated = { ...target };

      if (body.displayName !== undefined) updated.displayName = String(body.displayName || '').trim() || target.displayName;
      if (body.role !== undefined) {
        const newRole = String(body.role).toUpperCase();
        if (['SUPERADMIN', 'ADMIN', 'STAFF'].includes(newRole)) updated.role = newRole;
      }
      if (body.status !== undefined) {
        const newStatus = String(body.status).toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
        // Prevent disabling oneself
        if (newStatus === 'INACTIVE' && (target.username === admin.u || target.adminId === admin.u)) {
          throw new HttpError(400, 'SELF_DISABLE', 'ไม่สามารถปิดการใช้งานบัญชีของตนเองได้');
        }
        updated.status = newStatus;
      }
      if (body.password && String(body.password).trim().length >= 4) {
        updated.passwordHash = hashPassword(String(body.password).trim());
      }
      updated.updatedAt = now;

      await updateRow(SHEETS.ADMINS, target._rowNumber, updated);
      await audit('UPDATE', 'ADMIN_USER', target.adminId, admin.name || admin.u, {
        username: target.username,
        displayName: updated.displayName,
        role: updated.role,
        status: updated.status,
        passwordChanged: Boolean(body.password)
      });

      const safeReturn = { ...updated };
      delete safeReturn.passwordHash;
      return ok({ admin: safeReturn });
    }

    // DELETE: Delete Admin
    if (event.httpMethod === 'DELETE') {
      const adminId = String(body.adminId || '').trim();
      if (!adminId) throw new HttpError(400, 'INVALID_REQUEST', 'ไม่พบรหัสผู้ดูแลที่ต้องการลบ');

      const target = existingAdmins.find(a => a.adminId === adminId);
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ดูแลที่ต้องการลบ');

      if (target.username === admin.u || target.adminId === admin.u) {
        throw new HttpError(400, 'SELF_DELETE', 'ไม่สามารถลบบัญชีของตนเองได้');
      }

      await deleteRow(SHEETS.ADMINS, target._rowNumber);
      await audit('DELETE', 'ADMIN_USER', target.adminId, admin.name || admin.u, {
        username: target.username,
        displayName: target.displayName
      });

      return ok({ deleted: true, adminId });
    }

    return methodNotAllowed();
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);
