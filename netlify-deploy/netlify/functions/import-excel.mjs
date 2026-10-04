import XLSX from 'xlsx';
import { audit } from './lib/audit.mjs';
import { SHEETS } from './lib/constants.mjs';
import { cleanText, errorResponse, HttpError, ok, readJson, requireAdmin } from './lib/http.mjs';
import { appendRows, batchUpdateRows, createTempleId, getRecords, updateRow } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';

const ignoredHeaders = [
  'ลำดับ', 'ลำดับที่', 'ที่', 'no', 'number', 'index', '#',
  'วันเวลาที่เพิ่มวัด', 'วันเวลาที่เพิ่ม', 'วันที่เพิ่มวัด', 'วันที่เพิ่ม', 'เวลาที่เพิ่ม',
  'วันเวลา', 'ประทับเวลา', 'timestamp', 'dateadded', 'createdat', 'updatedat'
];

const commonAliases = {
  templeName: ['ชื่อวัด', 'ชื่อวัด/ที่พักสงฆ์', 'ชื่อวัด/สำนักสงฆ์', 'ชื่อวัด / ที่พักสงฆ์', 'ชื่อวัด / สำนักสงฆ์', 'ที่พักสงฆ์', 'สำนักสงฆ์', 'วัด', 'temple', 'templename', 'temple name'],
  templeType: ['ประเภทวัด', 'ชนิดวัด', 'วัดประเภท', 'templetype', 'temple_type', 'temple type'],
  subdistrict: ['ตำบล', 'แขวง', 'subdistrict', 'tambon', 'ต', 'ต.'],
  district: ['อำเภอ', 'เขต', 'district', 'amphur', 'amphoe', 'อ', 'อ.'],
  province: ['จังหวัด', 'province', 'changwat', 'จ', 'จ.'],
};

const templeAliases = {
  ...commonAliases,
  abbotName: ['ชื่อเจ้าอาวาส', 'เจ้าอาวาส', 'ชื่อ!จ้าอาวาส', 'ชื่อจ้าอาวาส', '!จ้าอาวาส', 'จ้าอาวาส', 'พระสังฆาธิการ/เจ้าอาวาส', 'พระสังฆาธิการ', 'ชื่อ-สกุลเจ้าอาวาส', 'พระครู', 'เจ้าคณะ', 'abbot', 'abbotname', 'abbot_name', 'ชื่อเจ้าอาวาส/ผู้ดูแล', 'ผู้ดูแลที่พักสงฆ์', 'สาย', 'สายงาน', 'หัวหน้าสาย'],
  abbotPhone: ['เบอร์โทรเจ้าอาวาส', 'เบอร์เจ้าอาวาส', 'โทรเจ้าอาวาส', 'เบอร์โทรศัพท์เจ้าอาวาส', 'เบอร์มือถือเจ้าอาวาส', 'โทรศัพท์เจ้าอาวาส', 'เบอร์!จ้าอาวาส', 'เบอร์โทร!จ้าอาวาส', 'abbotphone', 'abbot_phone', 'abbot phone', 'abbottel'],
  templePhone: ['เบอร์โทร', 'เบอร์โทรศัพท์', 'เบอร์วัด', 'เบอร์โทรวัด', 'โทรศัพท์', 'โทรศัพท์วัด', 'โทร', 'เบอร์ติดต่อ', 'เบอร์โทรติดต่อ', 'เบอร์มือถือ', 'มือถือ', 'tel', 'phone', 'templephone', 'contact', 'mobile', 'เบอร์โทรศัพท์วัด'],
  status: ['สถานะ', 'status']
};

const kathinAliases = {
  ...commonAliases,
  kathinType: ['ประเภทกฐิน', 'ชนิดกฐิน', 'กฐิน', 'โครงการกฐิน', 'kathintype', 'kathin_type', 'kathin type'],
  residentMonks: ['จำนวนพระจำพรรษา', 'จำนวนพระ', 'พระจำพรรษา', 'พระจำพรรษา(รูป)', 'จำนวนพระ(รูป)', 'residentmonks', 'monks'],
  kathinDate: ['วันทอดกฐิน', 'วันที่ทอดกฐิน', 'วันทอด', 'วันที่', 'date', 'kathindate'],
  kathinTime: ['เวลาทอดกฐิน', 'เวลาทอด', 'เวลา', 'time', 'kathintime'],
  abbotName: ['ชื่อเจ้าอาวาส', 'เจ้าอาวาส', 'ชื่อ!จ้าอาวาส', 'ชื่อจ้าอาวาส', '!จ้าอาวาส', 'จ้าอาวาส', 'abbot', 'abbotname', 'พระครู', 'เจ้าคณะ', 'พระสังฆาธิการ', 'สาย', 'สายงาน', 'หัวหน้าสาย'],
  abbotPhone: ['เบอร์โทรเจ้าอาวาส', 'เบอร์เจ้าอาวาส', 'โทรเจ้าอาวาส', 'abbotphone'],
  disciple1Name: ['ชื่อศิษยานุศิษย์ คนที่1', 'ชื่อศิษยานุศิษย์ คนที่ 1', 'ชื่อศิษยานุศิษย์1', 'ศิษยานุศิษย์ คนที่1', 'ศิษยานุศิษย์ คนที่ 1', 'ศิษยานุศิษย์1', 'ผู้ประสานงาน1', 'ผู้ประสานงาน 1', 'ผู้ประสานงาน', 'ผู้ติดต่อ', 'disciple1name'],
  disciple1Phone: ['เบอร์โทรศิษยานุศิษย์ คนที่1', 'เบอร์โทรศิษยานุศิษย์ คนที่ 1', 'เบอร์โทรศิษยานุศิษย์1', 'เบอร์ศิษยานุศิษย์ คนที่1', 'เบอร์ศิษยานุศิษย์1', 'เบอร์ผู้ประสานงาน1', 'เบอร์ผู้ประสานงาน 1', 'เบอร์ผู้ประสานงาน', 'เบอร์ผู้ติดต่อ', 'disciple1phone'],
  disciple2Name: ['ชื่อศิษยานุศิษย์ คนที่2', 'ชื่อศิษยานุศิษย์ คนที่ 2', 'ชื่อศิษยานุศิษย์2', 'ศิษยานุศิษย์ คนที่2', 'ศิษยานุศิษย์ คนที่ 2', 'ศิษยานุศิษย์2', 'ผู้ประสานงาน2', 'ผู้ประสานงาน 2', 'disciple2name'],
  disciple2Phone: ['เบอร์โทรศิษยานุศิษย์ คนที่2', 'เบอร์โทรศิษยานุศิษย์ คนที่ 2', 'เบอร์โทรศิษยานุศิษย์2', 'เบอร์ศิษยานุศิษย์ คนที่2', 'เบอร์ศิษยานุศิษย์2', 'เบอร์ผู้ประสานงาน2', 'เบอร์ผู้ประสานงาน 2', 'disciple2phone'],
  hasLeader: ['มีประธานนำกล่าวแล้ว', 'มีประธานนำกล่าว', 'ประธานนำกล่าวแล้ว', 'ประธานนำกล่าว', 'ประธานกฐิน', 'hasleader', 'leader'],
  status: ['สถานะ', 'status'],
  description: ['หมายเหตุ', 'รายละเอียด', 'description', 'remark', 'note']
};

function normalizeHeader(str) {
  let s = cleanText(String(str || '').trim(), 100).toLowerCase();
  s = s.replace(/!/g, 'เ');
  return s.replace(/[\s\-_()*#./:;,]+/g, '');
}

function resolveMappings(headers, aliases) {
  const normIgnored = new Set(ignoredHeaders.map(normalizeHeader));

  const candidates = headers.map((rawHeader, colIdx) => {
    const norm = normalizeHeader(rawHeader);
    if (!norm || normIgnored.has(norm)) {
      return { col: colIdx, header: rawHeader, key: '', score: 0 };
    }

    // 1. Exact alias check
    for (const [key, values] of Object.entries(aliases)) {
      if (values.some(v => normalizeHeader(v) === norm)) {
        let score = 80;
        if (norm === 'ชื่อวัด' && key === 'templeName') score = 100;
        else if ((norm === 'ชื่อเจ้าอาวาส' || norm === 'เจ้าอาวาส') && key === 'abbotName') score = 100;
        else if ((norm === 'เบอร์โทรเจ้าอาวาส' || norm === 'เบอร์เจ้าอาวาส' || norm === 'โทรเจ้าอาวาส') && key === 'abbotPhone') score = 100;
        else if (norm === 'ประเภทวัด' && key === 'templeType') score = 95;
        else if (norm === 'ประเภทกฐิน' && key === 'kathinType') score = 95;
        else if (norm === 'สาย' && key === 'abbotName') score = 40;
        return { col: colIdx, header: rawHeader, key, score };
      }
    }

    // 2. Controlled fallback checks
    // NEVER match templeName if header contains 'ประเภท', 'วัน', 'เวลา', 'รหัส', 'รูป', 'สังกัด'
    if (norm.startsWith('ชื่อวัด') && !/(ประเภท|วัน|เวลา|รหัส|รูป|สังกัด)/.test(norm)) {
      return { col: colIdx, header: rawHeader, key: 'templeName', score: 70 };
    }
    if (norm.includes('ประเภทวัด') || norm.includes('ชนิดวัด')) {
      return { col: colIdx, header: rawHeader, key: 'templeType', score: 70 };
    }
    if (aliases.kathinType && (norm.includes('ประเภทกฐิน') || norm.includes('กฐิน'))) {
      return { col: colIdx, header: rawHeader, key: 'kathinType', score: 70 };
    }
    if (aliases.residentMonks && (norm.includes('จำนวนพระ') || norm.includes('จำพรรษา'))) {
      return { col: colIdx, header: rawHeader, key: 'residentMonks', score: 70 };
    }
    if (aliases.kathinDate && (norm.includes('วันทอด') || norm.includes('วันที่ทอด'))) {
      return { col: colIdx, header: rawHeader, key: 'kathinDate', score: 70 };
    }
    if (aliases.kathinTime && norm.includes('เวลาทอด')) {
      return { col: colIdx, header: rawHeader, key: 'kathinTime', score: 70 };
    }
    if (aliases.abbotPhone && (norm.includes('อาวาส') || norm.includes('จ้าอาวาส')) && /(เบอร์|โทร|tel|phone|contact|mobile)/.test(norm)) {
      return { col: colIdx, header: rawHeader, key: 'abbotPhone', score: 90 };
    }
    if (aliases.abbotName && (norm.includes('อาวาส') || norm.includes('จ้าอาวาส') || norm.includes('พระสังฆาธิการ')) && !/(เบอร์|โทร|tel|phone|contact|mobile)/.test(norm)) {
      return { col: colIdx, header: rawHeader, key: 'abbotName', score: 85 };
    }
    if (aliases.hasLeader && (norm.includes('ประธานนำกล่าว') || norm.includes('มีประธาน'))) {
      return { col: colIdx, header: rawHeader, key: 'hasLeader', score: 70 };
    }
    if (aliases.disciple1Phone && (norm.includes('เบอร์') && (norm.includes('ศิษย์') || norm.includes('ผู้ประสาน')) && (norm.includes('1') || !norm.includes('2')))) {
      return { col: colIdx, header: rawHeader, key: 'disciple1Phone', score: 70 };
    }
    if (aliases.disciple1Name && ((norm.includes('ศิษย์') || norm.includes('ผู้ประสาน')) && (norm.includes('1') || !norm.includes('2')))) {
      return { col: colIdx, header: rawHeader, key: 'disciple1Name', score: 70 };
    }
    if (aliases.disciple2Phone && (norm.includes('เบอร์') && (norm.includes('ศิษย์') || norm.includes('ผู้ประสาน')) && norm.includes('2'))) {
      return { col: colIdx, header: rawHeader, key: 'disciple2Phone', score: 70 };
    }
    if (aliases.disciple2Name && ((norm.includes('ศิษย์') || norm.includes('ผู้ประสาน')) && norm.includes('2'))) {
      return { col: colIdx, header: rawHeader, key: 'disciple2Name', score: 70 };
    }

    return { col: colIdx, header: rawHeader, key: '', score: 0 };
  });

  // Guarantee 1-to-1 Mapping: Higher score wins per key. No column can overwrite another key!
  const assignedKeys = new Map();
  const sortedCandidates = [...candidates].filter(c => c.key).sort((a, b) => b.score - a.score);
  for (const c of sortedCandidates) {
    if (!assignedKeys.has(c.key)) {
      assignedKeys.set(c.key, c);
    }
  }

  return headers.map((h, i) => {
    const match = candidates[i];
    if (match.key && assignedKeys.get(match.key)?.col === i) {
      return match.key;
    }
    return '';
  });
}

function parseExcel(base64, entity = 'temple') {
  if (!base64 || base64.length > 8_000_000) {
    throw new HttpError(400, 'INVALID_FILE', 'ไฟล์ไม่ถูกต้องหรือมีขนาดเกิน 6 MB');
  }
  let wb;
  try {
    wb = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
  } catch {
    throw new HttpError(400, 'INVALID_FILE', 'ไม่สามารถอ่านไฟล์ Excel ได้');
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new HttpError(400, 'INVALID_FILE', 'ไม่พบข้อมูลในไฟล์');
  
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (raw.length < 2) throw new HttpError(400, 'INVALID_FILE', 'ไฟล์ไม่มีแถวข้อมูล');

  const aliases = entity === 'kathin' ? kathinAliases : templeAliases;
  const mappings = resolveMappings(raw[0], aliases);
  
  if (!mappings.includes('templeName') || !mappings.includes('province')) {
    throw new HttpError(400, 'INVALID_HEADER', 'ต้องมีคอลัมน์ "ชื่อวัด" และ "จังหวัด"');
  }

  return raw.slice(1)
    .filter(row => row.some(value => String(value).trim()))
    .map((row, index) => {
      const record = {};
      mappings.forEach((name, col) => {
        if (name) {
          record[name] = cleanText(row[col], 300);
        }
      });
      record._excelRow = index + 2;
      return record;
    });
}

function cleanNameForMatch(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/^(วัด|ที่พักสงฆ์|สำนักสงฆ์)/g, '')
    .replace(/[\s\-_().]/g, '');
}

function cleanLocationForMatch(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/^(จ\.|จังหวัด|อ\.|อำเภอ|เขต|ต\.|ตำบล|แขวง)/g, '')
    .replace(/[\s\-_().]/g, '');
}

function validateTemplesUpsert(rows, existing = []) {
  const existingMap = new Map();
  const existingProvMap = new Map();

  for (const t of existing) {
    const rawKey = `${String(t.templeName).toLowerCase().trim()}|${String(t.province).toLowerCase().trim()}`;
    const cName = cleanNameForMatch(t.templeName);
    const cProv = cleanLocationForMatch(t.province);
    const cDist = cleanLocationForMatch(t.district);

    const fullKey = `${cName}|${cDist}|${cProv}`;
    const provKey = `${cName}|${cProv}`;

    if (!existingMap.has(rawKey)) existingMap.set(rawKey, t);
    if (cDist && !existingMap.has(fullKey)) existingMap.set(fullKey, t);
    if (!existingProvMap.has(provKey)) existingProvMap.set(provKey, t);
  }

  const fileSeen = new Set();
  const inserts = [];
  const updates = [];
  const errors = [];

  for (const row of rows) {
    if (!row.templeName) {
      errors.push({ row: row._excelRow, message: 'ไม่มีชื่อวัด' });
      continue;
    }
    if (!row.province) {
      errors.push({ row: row._excelRow, message: 'ไม่มีจังหวัด' });
      continue;
    }

    const cName = cleanNameForMatch(row.templeName);
    const cProv = cleanLocationForMatch(row.province);
    const cDist = cleanLocationForMatch(row.district);
    const rawKey = `${String(row.templeName).toLowerCase().trim()}|${String(row.province).toLowerCase().trim()}`;
    const fullKey = `${cName}|${cDist}|${cProv}`;
    const provKey = `${cName}|${cProv}`;

    const dedupeKey = cDist ? fullKey : provKey;
    if (fileSeen.has(dedupeKey)) {
      errors.push({ row: row._excelRow, message: `ข้อมูลวัด "${row.templeName}" ซ้ำกันในไฟล์เดียวกัน` });
      continue;
    }
    fileSeen.add(dedupeKey);

    let match = null;
    if (cDist && existingMap.has(fullKey)) {
      match = existingMap.get(fullKey);
    } else if (existingMap.has(rawKey)) {
      match = existingMap.get(rawKey);
    } else if (existingProvMap.has(provKey)) {
      match = existingProvMap.get(provKey);
    }

    if (match) {
      updates.push({
        ...row,
        _action: 'UPDATE',
        templeId: match.templeId,
        _rowNumber: match._rowNumber,
        original: match
      });
    } else {
      inserts.push({
        ...row,
        _action: 'INSERT'
      });
    }
  }

  return {
    inserts,
    updates,
    errors,
    totalValid: inserts.length + updates.length
  };
}

function validateKathinUpsert(rows, existing = []) {
  const existingMap = new Map();
  for (const k of existing) {
    const key = `${k.templeName}|${k.province}`.toLowerCase().trim();
    existingMap.set(key, k);
  }

  const fileSeen = new Set();
  const inserts = [];
  const updates = [];
  const errors = [];

  for (const row of rows) {
    const key = `${row.templeName}|${row.province}`.toLowerCase().trim();
    if (!row.templeName) {
      errors.push({ row: row._excelRow, message: 'ไม่มีชื่อวัด' });
      continue;
    }
    if (!row.province) {
      errors.push({ row: row._excelRow, message: 'ไม่มีจังหวัด' });
      continue;
    }
    if (fileSeen.has(key)) {
      errors.push({ row: row._excelRow, message: 'มีข้อมูลวัดนี้ซ้ำกันในไฟล์เดียวกัน' });
      continue;
    }
    fileSeen.add(key);

    if (existingMap.has(key)) {
      const match = existingMap.get(key);
      updates.push({ ...row, _action: 'UPDATE', kathinId: match.kathinId, _rowNumber: match._rowNumber, original: match });
    } else {
      inserts.push({ ...row, _action: 'INSERT' });
    }
  }

  return { inserts, updates, errors, totalValid: inserts.length + updates.length };
}

export const handler = async event => {
  try {
    const admin = requireAdmin(event);
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะ POST');
    
    const body = readJson(event);
    const entity = body.entity === 'kathin' ? 'kathin' : 'temple';
    const rows = parseExcel(body.base64, entity);

    if (entity === 'kathin') {
      const existing = await getRecords(SHEETS.KATHIN);
      const result = validateKathinUpsert(rows, existing);

      if (body.mode === 'preview') {
        const checkKeys = [
          'kathinType', 'subdistrict', 'district', 'residentMonks',
          'kathinDate', 'kathinTime', 'abbotName', 'abbotPhone',
          'disciple1Name', 'disciple1Phone', 'disciple2Name', 'disciple2Phone',
          'templeType', 'hasLeader', 'status', 'description'
        ];
        const enrichedUpdates = result.updates.map(item => {
          const diffs = [];
          for (const k of checkKeys) {
            const newVal = String(item[k] ?? '').trim();
            const oldVal = String(item.original?.[k] ?? '').trim();
            if (k === 'templeType' && newVal) {
              if (newVal !== oldVal && !String(item.original?.description || '').includes(newVal)) {
                diffs.push({ field: k, oldVal, newVal });
              }
            } else if (k === 'hasLeader' && newVal) {
              if (newVal !== oldVal && !String(item.original?.description || '').includes('ประธานนำกล่าว')) {
                diffs.push({ field: k, oldVal, newVal });
              }
            } else if (newVal && newVal !== oldVal) {
              diffs.push({ field: k, oldVal, newVal });
            }
          }
          return {
            ...item,
            diffs
          };
        });

        return ok({
          entity: 'kathin',
          totalRows: rows.length,
          validRows: result.totalValid,
          insertCount: result.inserts.length,
          updateCount: result.updates.length,
          errors: result.errors,
          inserts: result.inserts,
          updates: enrichedUpdates,
          preview: [...result.inserts.slice(0, 5), ...result.updates.slice(0, 5)]
        });
      }

      if (body.mode !== 'confirm') throw new HttpError(400, 'INVALID_MODE', 'ไม่พบโหมดการนำเข้า');

      const now = new Date().toISOString();
      let inserted = 0;
      let updated = 0;

      function buildKathinDescription(item, existingDesc = '') {
        const parts = [];
        if (existingDesc) parts.push(existingDesc);
        if (item.description && !parts.includes(item.description)) parts.push(item.description);
        if (item.templeType) {
          const tText = `ประเภทวัด: ${item.templeType}`;
          if (!parts.some(p => p.includes(item.templeType))) parts.push(tText);
        }
        if (item.hasLeader) {
          const lText = (item.hasLeader === 'มี' || item.hasLeader === 'มีประธานนำกล่าวแล้ว' || item.hasLeader === 'TRUE' || item.hasLeader === true)
            ? 'มีประธานนำกล่าวแล้ว'
            : `ประธานนำกล่าว: ${item.hasLeader}`;
          if (!parts.some(p => p.includes('ประธานนำกล่าว'))) parts.push(lText);
        }
        return parts.join(' | ');
      }

      // 1. Process Updates (Batch Upsert - Single Request)
      if (result.updates.length) {
        const updateBatch = result.updates.map(item => ({
          rowNumber: item._rowNumber,
          values: {
            ...item.original,
            kathinType: item.kathinType || item.original.kathinType || 'กฐินแสน',
            subdistrict: item.subdistrict || item.original.subdistrict || '',
            district: item.district || item.original.district || '',
            residentMonks: item.residentMonks || item.original.residentMonks || '0',
            kathinDate: item.kathinDate || item.original.kathinDate || '',
            kathinTime: item.kathinTime || item.original.kathinTime || '',
            abbotName: item.abbotName || item.original.abbotName || '',
            abbotPhone: item.abbotPhone || item.original.abbotPhone || '',
            disciple1Name: item.disciple1Name || item.original.disciple1Name || '',
            disciple1Phone: item.disciple1Phone || item.original.disciple1Phone || '',
            disciple2Name: item.disciple2Name || item.original.disciple2Name || '',
            disciple2Phone: item.disciple2Phone || item.original.disciple2Phone || '',
            status: item.status || item.original.status || 'APPROVED',
            description: buildKathinDescription(item, item.original.description),
            updatedAt: now
          }
        }));
        await batchUpdateRows(SHEETS.KATHIN, updateBatch);
        updated = updateBatch.length;
      }

      // 2. Process Inserts
      if (result.inserts.length) {
        const newRecords = result.inserts.map((item, idx) => ({
          kathinId: `KAT-${Date.now().toString(36).toUpperCase()}-${idx + 1}`,
          kathinType: item.kathinType || 'กฐินแสน',
          templeId: '',
          templeName: item.templeName,
          subdistrict: item.subdistrict || '',
          district: item.district || '',
          province: item.province,
          residentMonks: item.residentMonks || '0',
          kathinDate: item.kathinDate || '',
          kathinTime: item.kathinTime || '',
          abbotName: item.abbotName || '',
          abbotPhone: item.abbotPhone || '',
          disciple1Name: item.disciple1Name || '',
          disciple1Phone: item.disciple1Phone || '',
          disciple2Name: item.disciple2Name || '',
          disciple2Phone: item.disciple2Phone || '',
          status: item.status || 'APPROVED',
          description: buildKathinDescription(item),
          createdAt: now,
          updatedAt: now
        }));
        await appendRows(SHEETS.KATHIN, newRecords);
        inserted = newRecords.length;
      }

      await audit('IMPORT_EXCEL', 'KATHIN', 'UPSERT', admin.u, {
        fileName: cleanText(body.fileName, 200),
        inserted,
        updated,
        errors: result.errors.length
      });

      return ok({
        entity: 'kathin',
        inserted,
        updated,
        errors: result.errors
      });
    }

    // Default: Temple import (Upsert supported)
    const existing = await getRecords(SHEETS.TEMPLES);
    const result = validateTemplesUpsert(rows, existing);

    if (body.mode === 'preview') {
      const checkKeys = ['subdistrict', 'district', 'abbotName', 'abbotPhone', 'templePhone', 'status'];
      const enrichedUpdates = result.updates.map(item => {
        const diffs = [];
        for (const k of checkKeys) {
          const newVal = String(item[k] ?? '').trim();
          const oldVal = String(item.original?.[k] ?? '').trim();
          if (newVal && newVal !== oldVal) {
            diffs.push({ field: k, oldVal, newVal });
          }
        }
        return { ...item, diffs };
      });

      return ok({
        entity: 'temple',
        totalRows: rows.length,
        validRows: result.totalValid,
        insertCount: result.inserts.length,
        updateCount: result.updates.length,
        errors: result.errors,
        inserts: result.inserts,
        updates: enrichedUpdates,
        preview: [...result.inserts.slice(0, 5), ...result.updates.slice(0, 5)]
      });
    }

    if (body.mode !== 'confirm') throw new HttpError(400, 'INVALID_MODE', 'ไม่พบโหมดการนำเข้า');

    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;

    // 1. Process Updates
    if (result.updates.length) {
      const updateBatch = result.updates.map(item => ({
        rowNumber: item._rowNumber,
        values: {
          ...item.original,
          subdistrict: item.subdistrict || item.original.subdistrict || '',
          district: item.district || item.original.district || '',
          abbotName: item.abbotName || item.abbot || item.original.abbotName || item.original.abbot || '',
          abbotPhone: item.abbotPhone || item.original.abbotPhone || '',
          templePhone: item.templePhone || item.phone || item.original.templePhone || item.original.phone || item.abbotPhone || '',
          status: item.original.status || 'ACTIVE',
          updatedAt: now
        }
      }));
      await batchUpdateRows(SHEETS.TEMPLES, updateBatch);
      updated = updateBatch.length;
    }

    // 2. Process Inserts
    if (result.inserts.length) {
      const newRecords = result.inserts.map(item => ({
        templeId: createTempleId(),
        templeName: item.templeName,
        subdistrict: item.subdistrict || '',
        district: item.district || '',
        province: item.province,
        abbotName: item.abbotName || item.abbot || '',
        abbotPhone: item.abbotPhone || '',
        templePhone: item.templePhone || item.phone || item.abbotPhone || '',
        source: 'EXCEL_IMPORT',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      }));
      await appendRows(SHEETS.TEMPLES, newRecords);
      inserted = newRecords.length;
    }

    await audit('IMPORT_EXCEL', 'TEMPLE', 'UPSERT', admin.u, {
      fileName: cleanText(body.fileName, 200),
      inserted,
      updated,
      errors: result.errors.length
    });

    return ok({
      entity: 'temple',
      imported: inserted + updated,
      inserted,
      updated,
      errors: result.errors
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);
