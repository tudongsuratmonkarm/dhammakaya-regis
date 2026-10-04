import { ok, errorResponse, HttpError, rateLimit, readJson, cleanText } from './lib/http.mjs';
import { SHEETS } from './lib/constants.mjs';
import { appendRows } from './lib/sheets.mjs';
import { uploadFile } from './lib/drive.mjs';
import { netlify } from './lib/adapter.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะ POST');
    rateLimit(event, 'upload', 10, 60_000); // 10 uploads per minute

    // We expect the body to be a JSON string from frontend, limiting file sizes around 4MB
    // which encodes to ~5.5MB base64, fitting within Netlify's 6MB payload limit.
    const body = readJson(event);
    
    if (!body.base64 || !body.fileName || !body.mimeType || !body.entityType || !body.entityId) {
      throw new HttpError(400, 'INVALID_INPUT', 'ข้อมูลอัปโหลดไม่ครบถ้วน');
    }

    // Upload to Google Drive
    const driveResult = await uploadFile(body.fileName, body.mimeType, body.base64);

    // Save to MEDIA sheet
    const imageId = `IMG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const newMedia = {
      imageId,
      entityType: cleanText(body.entityType, 50),
      entityId: cleanText(body.entityId, 50),
      fileId: driveResult.fileId,
      fileUrl: driveResult.fileUrl,
      thumbnailUrl: '', // Could be set if Drive returns thumbnailLink, but v3 requires requesting it
      caption: cleanText(body.caption || '', 200),
      sortOrder: '1',
      uploadedAt: new Date().toISOString()
    };

    await appendRows(SHEETS.MEDIA, [newMedia]);

    return ok({
      imageId,
      fileUrl: driveResult.fileUrl,
      message: 'อัปโหลดสำเร็จ'
    });

  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);