import { ok, errorResponse, HttpError } from './lib/http.mjs';
import { SHEETS } from './lib/constants.mjs';
import { getRecords } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะ GET');

    const [kathins, media] = await Promise.all([
      getRecords(SHEETS.KATHIN),
      getRecords(SHEETS.MEDIA)
    ]);

    // Filter only APPROVED kathins if you want, or return all active
    // For now, let's return those that are not CANCELLED
    const activeKathins = kathins.filter(k => k.status !== 'CANCELLED');

    const kathinMedia = media.filter(m => m.entityType === 'KATHIN');

    // Attach media to kathin
    const results = activeKathins.map(k => {
      const kMedia = kathinMedia.filter(m => m.entityId === k.kathinId).sort((a,b) => Number(a.sortOrder) - Number(b.sortOrder));
      const imgUrl = kMedia[0]?.fileUrl || k.imageUrl || '';
      return {
        ...k,
        imageUrl: imgUrl,
        images: kMedia.map(m => m.fileUrl).filter(Boolean)
      };
    });

    return ok({ kathins: results });
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);