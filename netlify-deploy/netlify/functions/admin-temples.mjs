import { audit } from './lib/audit.mjs';
import { SHEETS } from './lib/constants.mjs';
import { cleanText, errorResponse, HttpError, methodNotAllowed, ok, readJson, requireAdmin } from './lib/http.mjs';
import { appendRows, createTempleId, deleteRow, deleteRows, getRecords, updateRow } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';

function temple(body, previous={}) {
  const abbotVal = cleanText(body.abbotName || body.abbot || previous.abbotName || previous.abbot || '', 100);
  const abbotPhoneVal = cleanText(body.abbotPhone || previous.abbotPhone || '', 50);
  const phoneVal = cleanText(body.templePhone || body.phone || previous.templePhone || previous.phone || '', 50);
  const item = {
    ...previous,
    templeId: cleanText(body.templeId || previous.templeId, 80),
    templeName: cleanText(body.templeName, 200),
    subdistrict: cleanText(body.subdistrict, 100),
    district: cleanText(body.district, 100),
    province: cleanText(body.province, 100),
    abbotName: abbotVal,
    abbotPhone: abbotPhoneVal,
    templePhone: phoneVal,
    abbot: abbotVal,
    phone: phoneVal,
    source: previous.source || 'DATABASE',
    status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!item.templeName || !item.province) throw new HttpError(400, 'INVALID_TEMPLE', 'กรุณากรอกชื่อวัดและจังหวัด');
  return item;
}

export const handler = async event => {
  try {
    const admin = requireAdmin(event);
    if (!['POST', 'PUT', 'DELETE'].includes(event.httpMethod)) return methodNotAllowed();
    const body = readJson(event);
    const records = await getRecords(SHEETS.TEMPLES);

    if (event.httpMethod === 'DELETE') {
      const ids = Array.isArray(body.templeIds)
        ? body.templeIds.map(id => String(id).trim()).filter(Boolean)
        : (body.templeId ? [String(body.templeId).trim()] : []);

      if (!ids.length) throw new HttpError(400, 'INVALID_REQUEST', 'ไม่พบรหัสวัดที่ต้องการลบ');

      const idSet = new Set(ids);
      const toDelete = records.filter(t => idSet.has(t.templeId));
      if (!toDelete.length) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลวัดที่ระบุ');

      const rowNumbers = toDelete.map(t => t._rowNumber);
      await deleteRows(SHEETS.TEMPLES, rowNumbers);

      // Clean up corresponding media rows
      try {
        const mediaRows = await getRecords(SHEETS.MEDIA);
        const mediaToDelete = mediaRows.filter(m => m.entityType === 'TEMPLE' && idSet.has(m.entityId));
        if (mediaToDelete.length) {
          await deleteRows(SHEETS.MEDIA, mediaToDelete.map(m => m._rowNumber));
        }
      } catch (e) {
        console.warn('Failed to delete temple media:', e.message);
      }

      await audit('DELETE', 'TEMPLE', ids.slice(0, 10).join(','), admin.u, {
        count: toDelete.length,
        templeNames: toDelete.map(t => t.templeName).slice(0, 10)
      });
      return ok({ deleted: true, count: toDelete.length });
    }

    if (event.httpMethod === 'POST') {
      const item = temple(body);
      item.templeId = createTempleId();
      if (records.some(t => t.templeName.toLowerCase() === item.templeName.toLowerCase() && t.province.toLowerCase() === item.province.toLowerCase())) {
        throw new HttpError(409, 'DUPLICATE_TEMPLE', 'พบชื่อวัดและจังหวัดนี้ในฐานข้อมูลแล้ว');
      }
      await appendRows(SHEETS.TEMPLES, [item]);

      // Save imageUrl if provided
      const imgUrl = cleanText(body.imageUrl || '', 1000);
      if (imgUrl) {
        try {
          await appendRows(SHEETS.MEDIA, [{
            imageId: `IMG-${Date.now().toString(36).toUpperCase()}`,
            entityType: 'TEMPLE',
            entityId: item.templeId,
            fileId: '',
            fileUrl: imgUrl,
            thumbnailUrl: '',
            caption: '',
            sortOrder: '1',
            uploadedAt: new Date().toISOString()
          }]);
        } catch (e) {
          console.warn('Failed to save temple media:', e.message);
        }
      }

      await audit('CREATE', 'TEMPLE', item.templeId, admin.u, item);
      return ok({ temple: { ...item, imageUrl: imgUrl } });
    }

    if (Array.isArray(body.templeIds) && body.status) {
      const idSet = new Set(body.templeIds.map(id => String(id).trim()));
      const targetStatus = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const toUpdate = records.filter(t => idSet.has(t.templeId));
      if (!toUpdate.length) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลวัดที่ระบุ');
      const now = new Date().toISOString();
      for (const item of toUpdate) {
        await updateRow(SHEETS.TEMPLES, item._rowNumber, { ...item, status: targetStatus, updatedAt: now });
      }
      await audit('BULK_STATUS', 'TEMPLE', Array.from(idSet).slice(0, 10).join(','), admin.u, { count: toUpdate.length, status: targetStatus });
      return ok({ updated: true, count: toUpdate.length, status: targetStatus });
    }

    const old = records.find(t => t.templeId === body.templeId);
    if (!old) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลวัด');
    const item = temple(body, old);
    await updateRow(SHEETS.TEMPLES, old._rowNumber, item);

    // Handle imageUrl sync to Media sheet
    let finalImgUrl = '';
    if (body.imageUrl !== undefined) {
      finalImgUrl = cleanText(body.imageUrl || '', 1000);
      try {
        const mediaRows = await getRecords(SHEETS.MEDIA);
        const existingMedia = mediaRows.find(m => m.entityType === 'TEMPLE' && m.entityId === item.templeId);
        if (finalImgUrl) {
          if (existingMedia) {
            await updateRow(SHEETS.MEDIA, existingMedia._rowNumber, {
              ...existingMedia,
              fileUrl: finalImgUrl,
              uploadedAt: new Date().toISOString()
            });
          } else {
            await appendRows(SHEETS.MEDIA, [{
              imageId: `IMG-${Date.now().toString(36).toUpperCase()}`,
              entityType: 'TEMPLE',
              entityId: item.templeId,
              fileId: '',
              fileUrl: finalImgUrl,
              thumbnailUrl: '',
              caption: '',
              sortOrder: '1',
              uploadedAt: new Date().toISOString()
            }]);
          }
        } else if (existingMedia) {
          await deleteRow(SHEETS.MEDIA, existingMedia._rowNumber);
        }
      } catch (e) {
        console.warn('Failed to sync temple media:', e.message);
      }
    }

    await audit('UPDATE', 'TEMPLE', item.templeId, admin.u, item);
    return ok({ temple: { ...item, imageUrl: finalImgUrl } });

  } catch (error) {
    return errorResponse(error);
  }
};
export default netlify(handler);
