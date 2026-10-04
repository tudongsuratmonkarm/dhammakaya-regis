import { HttpError, cleanText } from './http.mjs';

export function ageFromBirthDate(value) { if (!value) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'INVALID_BIRTH_DATE', 'รูปแบบวันเกิดไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)'); const born = new Date(`${value}T00:00:00Z`); if (Number.isNaN(born.getTime()) || born > new Date()) throw new HttpError(400, 'INVALID_BIRTH_DATE', 'วันเกิดไม่ถูกต้อง'); const today = new Date(); let age = today.getUTCFullYear() - born.getUTCFullYear(); if (today.getUTCMonth() < born.getUTCMonth() || (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate())) age--; if (age < 0 || age > 130) throw new HttpError(400, 'INVALID_BIRTH_DATE', 'วันเกิดไม่ถูกต้อง'); return String(age); }
export function ageFromOrdinationDate(value) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''; // soft fail for ordination date
  const ordDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(ordDate.getTime())) return '';
  const today = new Date();
  const ordYear = ordDate.getUTCFullYear();
  const ordMonth = ordDate.getUTCMonth() + 1;
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;
  let phansa = currentYear - ordYear + 1;
  if (ordMonth > 9) phansa -= 1;
  if (currentMonth < 7) phansa -= 1;
  if (phansa < 0) phansa = 0;
  return String(phansa);
}
export function validateTemple(input) {
  let templeName = cleanText(input?.templeName, 200);
  let subdistrict = cleanText(input?.subdistrict, 100);
  let district = cleanText(input?.district, 100);
  let province = cleanText(input?.province, 100);

  // If no temple name provided, fallback to ธุดงคสถานสุราษฎร์ธานี
  if (!templeName) {
    templeName = 'ธุดงคสถานสุราษฎร์ธานี';
    subdistrict = subdistrict || '-';
    district = district || 'เมืองสุราษฎร์ธานี';
    province = province || 'สุราษฎร์ธานี';
  } else if (!subdistrict || !district || !province) {
    throw new HttpError(400, 'INVALID_TEMPLE', 'กรุณากรอกชื่อวัด ตำบล อำเภอ และจังหวัดให้ครบ');
  }

  return {
    templeId: cleanText(input?.templeId, 80),
    templeName,
    subdistrict,
    district,
    province
  };
}
export function validateParticipant(input) { 
  const participant = { ...input };
  participant.prefix = cleanText(participant.prefix, 30); 
  participant.otherPrefix = cleanText(participant.otherPrefix, 50); 
  participant.monasticName = cleanText(participant.monasticName, 100); 
  participant.firstName = cleanText(participant.firstName, 100); 
  participant.lastName = cleanText(participant.lastName, 100); 
  participant.mobile = String(participant.mobile || '').replace(/\D/g, ''); 
  participant.nationalId = String(participant.nationalId || '').replace(/\D/g, ''); 
  participant.birthDate = cleanText(participant.birthDate, 10);
  participant.birthDateDisplay = cleanText(participant.birthDateDisplay || '', 20);
  participant.ordinationDate = cleanText(participant.ordinationDate || '', 10);
  participant.ordinationDateDisplay = cleanText(participant.ordinationDateDisplay || '', 20);
  
  participant.personId = cleanText(participant.personId, 60);
  participant.useExistingMobile = Boolean(participant.useExistingMobile);
  participant.address = cleanText(participant.address || participant.additionalData?.address, 500);

  // NOTE: In dynamic forms, these fields might be omitted entirely if not configured.
  // We only validate them if they are provided, or if they are traditionally required.
  if (!participant.useExistingMobile && participant.mobile && !/^\d{10}$/.test(participant.mobile)) {
    throw new HttpError(400, 'INVALID_PARTICIPANT', 'เบอร์มือถือต้องมี 10 หลัก'); 
  }
  if (participant.prefix === 'อื่น ๆ' && !participant.otherPrefix) throw new HttpError(400, 'INVALID_PREFIX', 'กรุณาระบุคำนำหน้าอื่น ๆ'); 
  if (participant.nationalId && !/^\d{13}$/.test(participant.nationalId)) throw new HttpError(400, 'INVALID_NATIONAL_ID', 'เลขบัตรประชาชนต้องมี 13 หลัก'); 
  
  if (participant.birthDate) participant.age = ageFromBirthDate(participant.birthDate);
  if (participant.ordinationDate) participant.phansa = ageFromOrdinationDate(participant.ordinationDate);
  return participant; 
}
export function normalized(value) { return cleanText(value, 200).toLowerCase(); }
export function isDuplicate(records, sessionId, participant) { 
  return records.some(row => { 
    if (String(row.sessionId) !== String(sessionId) || (row.status || 'ACTIVE') !== 'ACTIVE') return false; 
    if (participant.nationalId && row.nationalId && String(row.nationalId) === participant.nationalId) return true; 
    
    // Only check name+mobile if they actually have a name/mobile
    const hasName = participant.firstName || participant.lastName;
    if (hasName && participant.mobile) {
      return normalized(row.firstName) === normalized(participant.firstName) && 
             normalized(row.lastName) === normalized(participant.lastName) && 
             String(row.mobile) === participant.mobile; 
    }
    return false;
  }); 
}
export function validateBatchFields(input) {
  const session = {
    sessionId: cleanText(input.sessionId, 60),
    projectId: cleanText(input.projectId || 'PRJ-1', 60),
    sessionLabel: cleanText(input.sessionLabel, 100),
    sessionType: cleanText(input.sessionType || 'BATCH', 30).toUpperCase(),
    startDate: cleanText(input.startDate, 10),
    endDate: cleanText(input.endDate, 10),
    startTime: cleanText(input.startTime || '', 10),
    endTime: cleanText(input.endTime || '', 10),
    capacity: String(Math.max(0, parseInt(input.capacity, 10) || 0)),
    currentCount: String(Math.max(0, parseInt(input.currentCount, 10) || 0)),
    status: String(input.status).toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN',
    allowPublicRegistration: String(input.allowPublicRegistration ?? input.publicVisible ?? 'TRUE').toLowerCase() === 'false' ? 'FALSE' : 'TRUE',
    publicVisible: String(input.publicVisible ?? input.allowPublicRegistration ?? 'TRUE').toLowerCase() === 'false' ? 'FALSE' : 'TRUE',
    adminOverride: String(input.adminOverride || 'FALSE').toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
    sortOrder: cleanText(input.sortOrder || '999', 10),
    updatedAt: new Date().toISOString()
  };

  const VALID_SESSION_TYPES = ['BATCH', 'ROUND', 'VEHICLE', 'GROUP', 'TRIP', 'OTHER'];
  if (!VALID_SESSION_TYPES.includes(session.sessionType)) {
    session.sessionType = 'BATCH';
  }

  if (!session.sessionLabel) {
    throw new HttpError(400, 'INVALID_SESSION', 'กรุณาระบุชื่อรอบ/รุ่น (เช่น รุ่นที่ 1, รถคันที่ 1, เที่ยวที่ 1)');
  }
  return session;
}
