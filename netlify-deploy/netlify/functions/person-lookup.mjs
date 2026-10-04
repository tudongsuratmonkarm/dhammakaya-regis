import { ok, errorResponse, HttpError, rateLimit, cleanText } from './lib/http.mjs';
import { SHEETS } from './lib/constants.mjs';
import { getRecords } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';

function maskMobile(mobile) {
  if (!mobile) return '';
  const digits = String(mobile).replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-xxx-${digits.slice(7)}`;
  }
  if (digits.length >= 9) {
    return `${digits.slice(0, 3)}-xxx-${digits.slice(-3)}`;
  }
  return 'มีเบอร์เดิมอยู่แล้ว';
}

function maskNationalId(nationalId) {
  if (!nationalId) return '';
  const digits = String(nationalId).replace(/\D/g, '');
  if (digits.length === 13) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-xxxxx-${digits.slice(-2)}`;
  }
  return 'มีเลขบัตรเดิมอยู่แล้ว';
}

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะ GET');
    
    // Rate limit to protect privacy and prevent bulk scanning
    rateLimit(event, 'person-lookup', 30, 60_000);

    const q = cleanText(event.queryStringParameters?.q || '', 50).trim();
    if (q.length < 2) {
      return ok({ items: [] });
    }

    const qLower = q.toLowerCase();
    const qDigits = q.replace(/\D/g, '');

    const persons = await getRecords(SHEETS.PERSONS);

    const matches = [];
    for (const p of persons) {
      const fName = (p.firstName || '').toLowerCase();
      const lName = (p.lastName || '').toLowerCase();
      const fullName = `${fName} ${lName}`;
      const monName = (p.monasticName || '').toLowerCase();
      const mobileDigits = (p.mobile || '').replace(/\D/g, '');
      const nidDigits = (p.nationalId || '').replace(/\D/g, '');

      let matched = false;
      let matchType = '';

      // Match by Name
      if (fullName.includes(qLower) || fName.startsWith(qLower) || lName.startsWith(qLower) || monName.includes(qLower)) {
        matched = true;
        matchType = 'name';
      }
      // Match by Mobile digits (if query has at least 3 digits)
      else if (qDigits.length >= 3 && mobileDigits.includes(qDigits)) {
        matched = true;
        matchType = 'mobile';
      }
      // Match by National ID digits (if query has at least 4 digits)
      else if (qDigits.length >= 4 && nidDigits.includes(qDigits)) {
        matched = true;
        matchType = 'nationalId';
      }

      if (matched) {
        // Enforce STRICT PRIVACY: NEVER send unmasked phone number or full nationalId!
        matches.push({
          personId: p.personId,
          prefix: p.prefix || '',
          otherPrefix: p.otherPrefix || '',
          monasticName: p.monasticName || '',
          firstName: p.firstName || '',
          lastName: p.lastName || '',
          birthDate: p.birthDate || '',
          birthDateDisplay: p.birthDateDisplay || '',
          age: p.age || '',
          address: p.address || '',
          ordinationDate: p.ordinationDate || '',
          ordinationDateDisplay: p.ordinationDateDisplay || '',
          hasMobile: Boolean(mobileDigits),
          mobileMasked: maskMobile(mobileDigits),
          hasNationalId: Boolean(nidDigits),
          nationalIdMasked: maskNationalId(nidDigits),
          matchType
        });

        if (matches.length >= 10) break; // Limit to top 10 matches
      }
    }

    return ok({ items: matches });
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);
