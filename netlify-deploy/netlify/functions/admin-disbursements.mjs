import { audit } from './lib/audit.mjs';
import { SHEETS } from './lib/constants.mjs';
import { cleanText, errorResponse, HttpError, methodNotAllowed, ok, readJson, requireAdmin } from './lib/http.mjs';
import { appendRows, batchUpdateRows, deleteRow, getRecords, updateRow } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';

export const handler = async event => {
  try {
    const admin = requireAdmin(event);
    const adminModifier = admin.name || admin.u;
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(event.httpMethod)) return methodNotAllowed();

    // GET: List disbursements and Kathin status
    if (event.httpMethod === 'GET') {
      const [disbursements, kathin] = await Promise.all([
        getRecords(SHEETS.DISBURSEMENTS),
        getRecords(SHEETS.KATHIN)
      ]);
      return ok({
        disbursements: disbursements.sort((a, b) => String(b.createdAt || b.documentDate || '').localeCompare(String(a.createdAt || a.documentDate || ''))),
        kathin
      });
    }

    const body = readJson(event);

    // POST: Create new Disbursement document & update temples to PAID
    if (event.httpMethod === 'POST') {
      const selectedTemples = Array.isArray(body.selectedTemples)
        ? body.selectedTemples
        : (Array.isArray(body.templeDetails) ? body.templeDetails : []);

      if (!selectedTemples.length) {
        throw new HttpError(400, 'INVALID_DATA', 'กรุณาเลือกวัดที่จะเบิกจ่ายอย่างน้อย 1 รายการ');
      }

      const totalAmount = selectedTemples.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const templeIds = selectedTemples.map(t => t.id || t.templeId || t.kathinId).filter(Boolean);
      const now = new Date().toISOString();
      const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const disbursementId = `DIS-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;

      const newDisbursement = {
        disbursementId,
        documentDate: cleanText(body.documentDate, 20) || now.substring(0, 10),
        recipient1Id: cleanText(body.recipient1?.id || body.recipient1Id, 50),
        recipient1Name: cleanText(body.recipient1?.name || body.recipient1Name, 100),
        recipient1Phone: cleanText(body.recipient1?.phone || body.recipient1Phone, 50),
        recipient2Id: cleanText(body.recipient2?.id || body.recipient2Id, 50),
        recipient2Name: cleanText(body.recipient2?.name || body.recipient2Name, 100),
        recipient2Phone: cleanText(body.recipient2?.phone || body.recipient2Phone, 50),
        recipient3Id: cleanText(body.recipient3?.id || body.recipient3Id, 50),
        recipient3Name: cleanText(body.recipient3?.name || body.recipient3Name, 100),
        recipient3Phone: cleanText(body.recipient3?.phone || body.recipient3Phone, 50),
        donorName: cleanText(body.donorName, 100) || 'พระอนุชา ทานิสฺสโร',
        totalAmount: String(totalAmount),
        totalTemples: String(selectedTemples.length),
        templeIds: templeIds.join(','),
        templeDetailsJson: JSON.stringify(selectedTemples),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        createdBy: adminModifier,
        updatedBy: adminModifier
      };

      await appendRows(SHEETS.DISBURSEMENTS, [newDisbursement]);

      // Update matching Kathin records to 'PAID'
      if (templeIds.length) {
        const kathinRecords = await getRecords(SHEETS.KATHIN);
        const templeIdSet = new Set(templeIds);
        const updates = kathinRecords
          .filter(k => templeIdSet.has(k.templeId) || templeIdSet.has(k.kathinId))
          .map(k => ({
            rowNumber: k._rowNumber,
            values: {
              ...k,
              disbursementStatus: 'PAID',
              updatedAt: now,
              updatedBy: adminModifier
            }
          }));

        if (updates.length) {
          await batchUpdateRows(SHEETS.KATHIN, updates);
        }
      }

      await audit('CREATE', 'DISBURSEMENT', disbursementId, adminModifier, {
        totalAmount,
        totalTemples: selectedTemples.length,
        templeIds
      });

      return ok({ disbursement: newDisbursement });
    }

    // PUT: Toggle temple disbursement status or update record
    if (event.httpMethod === 'PUT') {
      const now = new Date().toISOString();

      // Case 1: Toggle single temple status
      if (body.action === 'toggle_temple' && (body.templeId || body.kathinId)) {
        const targetId = body.templeId || body.kathinId;
        const kathinRecords = await getRecords(SHEETS.KATHIN);
        const target = kathinRecords.find(k => k.templeId === targetId || k.kathinId === targetId);
        if (!target) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลวัดกฐิน');

        const newStatus = body.status === 'PAID' ? 'PAID' : 'UNPAID';
        await updateRow(SHEETS.KATHIN, target._rowNumber, {
          ...target,
          disbursementStatus: newStatus,
          updatedAt: now,
          updatedBy: adminModifier
        });

        await audit('STATUS_CHANGE', 'KATHIN_DISBURSEMENT', targetId, adminModifier, { status: newStatus });
        return ok({ updated: true, templeId: targetId, status: newStatus });
      }

      // Case 2: Bulk toggle temples status
      if (body.action === 'bulk_toggle' && (Array.isArray(body.templeIds) || Array.isArray(body.kathinIds))) {
        const idList = body.templeIds || body.kathinIds;
        const kathinRecords = await getRecords(SHEETS.KATHIN);
        const idSet = new Set(idList);
        const targetStatus = body.status === 'PAID' ? 'PAID' : 'UNPAID';
        const updates = kathinRecords
          .filter(k => idSet.has(k.templeId) || idSet.has(k.kathinId))
          .map(k => ({
            rowNumber: k._rowNumber,
            values: {
              ...k,
              disbursementStatus: targetStatus,
              updatedAt: now,
              updatedBy: adminModifier
            }
          }));

        if (updates.length) {
          await batchUpdateRows(SHEETS.KATHIN, updates);
        }

        await audit('BULK_STATUS', 'KATHIN_DISBURSEMENT', idList.slice(0, 10).join(','), adminModifier, {
          count: updates.length,
          status: targetStatus
        });
        return ok({ updated: true, count: updates.length, status: targetStatus });
      }

      throw new HttpError(400, 'INVALID_ACTION', 'คำสั่งไม่ถูกต้อง');
    }

    // DELETE: Delete disbursement record and revert temple status to 'UNPAID'
    if (event.httpMethod === 'DELETE') {
      const disbursementId = String(body.disbursementId || '').trim();
      if (!disbursementId) throw new HttpError(400, 'INVALID_REQUEST', 'ไม่พบรหัสเอกสารที่ต้องการลบ');

      const disbursements = await getRecords(SHEETS.DISBURSEMENTS);
      const target = disbursements.find(d => d.disbursementId === disbursementId);
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลเอกสารเบิกจ่าย');

      // Revert associated temples to 'UNPAID'
      const templeIds = (target.templeIds || '').split(',').map(id => id.trim()).filter(Boolean);
      let revertedCount = 0;
      let revertedTempleIds = [];
      if (templeIds.length) {
        const kathinRecords = await getRecords(SHEETS.KATHIN);
        const templeIdSet = new Set(templeIds);
        const now = new Date().toISOString();
        const reverts = kathinRecords
          .filter(k => templeIdSet.has(k.templeId) || templeIdSet.has(k.kathinId))
          .map(k => {
            revertedTempleIds.push(k.templeId || k.kathinId);
            return {
              rowNumber: k._rowNumber,
              values: {
                ...k,
                disbursementStatus: 'UNPAID',
                updatedAt: now,
                updatedBy: adminModifier
              }
            };
          });

        if (reverts.length) {
          await batchUpdateRows(SHEETS.KATHIN, reverts);
          revertedCount = reverts.length;
        }
      }

      await deleteRow(SHEETS.DISBURSEMENTS, target._rowNumber);
      await audit('DELETE', 'DISBURSEMENT', disbursementId, adminModifier, {
        revertedTemples: revertedCount
      });

      return ok({ deleted: true, disbursementId, revertedTemples: revertedCount, revertedTempleIds });
    }
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);
