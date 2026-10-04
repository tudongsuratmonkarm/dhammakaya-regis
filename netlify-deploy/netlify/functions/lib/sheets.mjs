import { google } from 'googleapis';
import { HEADERS, SHEETS } from './constants.mjs';
import { cleanText, safeCell } from './http.mjs';

let sheetsClient;
let configCache = { value: null, until: 0 };
const locks = new Map();
const recordsCache = new Map(); // sheet -> { data, expiry }
const lastKnownRecords = new Map(); // sheet -> data (fallback on 429 quota error)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function spreadsheetId() {
  if (!process.env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID is missing');
  return process.env.GOOGLE_SHEET_ID;
}

export function client() {
  if (sheetsClient) return sheetsClient;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) throw new Error('Google service account environment variables are missing');
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function callWithRetry(fn, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isQuota = err?.status === 429 || err?.code === 429 || /quota|rate limit|resource_exhausted/i.test(err?.message || '');
      if (isQuota && i < maxRetries - 1) {
        console.warn(`[Google Sheets API] Quota hit, retry attempt ${i + 1} in ${(i + 1) * 1200}ms...`);
        await sleep((i + 1) * 1200);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export function invalidateRecordsCache(sheet) {
  if (!sheet) {
    recordsCache.clear();
  } else {
    recordsCache.delete(sheet);
  }
}

export async function getSheetValues(sheet, range = 'A:ZZ') {
  if (!sheet || typeof sheet !== 'string') return [];
  return await callWithRetry(async () => {
    const response = await client().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `'${sheet}'!${range}`,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    return response.data.values || [];
  });
}

export async function getRecords(sheet, forceFresh = false) {
  if (!sheet || typeof sheet !== 'string') return [];
  const now = Date.now();
  const cached = recordsCache.get(sheet);
  if (!forceFresh && cached && cached.expiry > now) {
    return cached.data;
  }

  try {
    const values = await getSheetValues(sheet);
    if (!values.length) {
      recordsCache.set(sheet, { data: [], expiry: now + 25_000 });
      lastKnownRecords.set(sheet, []);
      return [];
    }
    const headers = values[0];
    const data = values.slice(1).map((row, index) =>
      Object.fromEntries(headers.map((header, col) => [header, row[col] ?? '']).concat([['_rowNumber', index + 2]]))
    );
    recordsCache.set(sheet, { data, expiry: now + 25_000 });
    lastKnownRecords.set(sheet, data);
    return data;
  } catch (err) {
    const isQuota = err?.status === 429 || err?.code === 429 || /quota|rate limit|resource_exhausted/i.test(err?.message || '');
    if (isQuota && lastKnownRecords.has(sheet)) {
      console.warn(`[Google Sheets API] Quota exceeded for sheet ${sheet}. Returning cached fallback.`);
      return lastKnownRecords.get(sheet);
    }
    throw err;
  }
}

/**
 * Fetch multiple sheets simultaneously in a SINGLE API request using batchGet
 * Massive reduction in Google Sheets API quota consumption!
 */
export async function batchGetRecords(sheetNames) {
  const validSheets = (sheetNames || []).filter(s => typeof s === 'string' && s.trim());
  if (!validSheets.length) return {};

  const now = Date.now();
  const allInCache = validSheets.every(s => {
    const c = recordsCache.get(s);
    return c && c.expiry > now;
  });

  if (allInCache) {
    return Object.fromEntries(validSheets.map(s => [s, recordsCache.get(s).data]));
  }

  try {
    const ranges = validSheets.map(s => `'${s}'!A:ZZ`);
    const response = await callWithRetry(async () => {
      return await client().spreadsheets.values.batchGet({
        spreadsheetId: spreadsheetId(),
        ranges,
        valueRenderOption: 'FORMATTED_VALUE'
      });
    });

    const valueRanges = response.data.valueRanges || [];
    const result = {};

    validSheets.forEach((sheet, idx) => {
      const values = valueRanges[idx]?.values || [];
      if (!values.length) {
        result[sheet] = [];
      } else {
        const headers = values[0];
        const data = values.slice(1).map((row, rIdx) =>
          Object.fromEntries(headers.map((header, col) => [header, row[col] ?? '']).concat([['_rowNumber', rIdx + 2]]))
        );
        result[sheet] = data;
      }
      recordsCache.set(sheet, { data: result[sheet], expiry: now + 25_000 });
      lastKnownRecords.set(sheet, result[sheet]);
    });

    return result;
  } catch (err) {
    const isQuota = err?.status === 429 || err?.code === 429 || /quota|rate limit|resource_exhausted/i.test(err?.message || '');
    if (isQuota) {
      console.warn(`[Google Sheets API] Quota exceeded in batchGetRecords. Falling back to cached data.`);
      const result = {};
      validSheets.forEach(sheet => {
        result[sheet] = lastKnownRecords.get(sheet) || [];
      });
      return result;
    }
    throw err;
  }
}

export async function ensureHeaderRow(sheet, targetHeaders) {
  if (!sheet || !targetHeaders || !targetHeaders.length) return targetHeaders || [];
  try {
    const values = await getSheetValues(sheet, '1:1');
    if (!values.length || !values[0] || !values[0].length) {
      await callWithRetry(async () => {
        await client().spreadsheets.values.update({
          spreadsheetId: spreadsheetId(),
          range: `'${sheet}'!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [targetHeaders] }
        });
      });
      invalidateRecordsCache(sheet);
      return targetHeaders;
    }
    const currentHeaders = values[0];
    const missing = targetHeaders.filter(h => !currentHeaders.includes(h));
    if (missing.length > 0) {
      const merged = [...currentHeaders, ...missing];
      await callWithRetry(async () => {
        await client().spreadsheets.values.update({
          spreadsheetId: spreadsheetId(),
          range: `'${sheet}'!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [merged] }
        });
      });
      invalidateRecordsCache(sheet);
      return merged;
    }
    return currentHeaders;
  } catch (err) {
    console.warn(`[ensureHeaderRow] Warning for ${sheet}:`, err?.message);
    return targetHeaders;
  }
}

export async function appendRows(sheet, rows) {
  if (!rows.length) return;
  const targetHeaders = HEADERS[sheet] || Object.keys(rows[0]);
  const headers = await ensureHeaderRow(sheet, targetHeaders);
  const values = rows.map(row => headers.map(header => safeCell(row[header] ?? '')));
  await callWithRetry(async () => {
    await client().spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: `'${sheet}'!A:ZZ`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });
  });
  invalidateRecordsCache(sheet);
  invalidateConfig(sheet);
}

export async function updateRow(sheet, rowNumber, values) {
  const targetHeaders = HEADERS[sheet] || Object.keys(values);
  const headers = await ensureHeaderRow(sheet, targetHeaders);
  const row = headers.map(header => safeCell(values[header] ?? ''));
  await callWithRetry(async () => {
    await client().spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `'${sheet}'!A${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  });
  invalidateRecordsCache(sheet);
  invalidateConfig(sheet);
}

export async function batchUpdateRows(sheet, updates) {
  if (!updates || !updates.length) return;
  const targetHeaders = HEADERS[sheet] || Object.keys(updates[0].values);
  const headers = await ensureHeaderRow(sheet, targetHeaders);
  const data = updates.map(({ rowNumber, values }) => ({
    range: `'${sheet}'!A${rowNumber}`,
    values: [headers.map(header => safeCell(values[header] ?? ''))]
  }));
  await callWithRetry(async () => {
    await client().spreadsheets.values.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { valueInputOption: 'RAW', data }
    });
  });
  invalidateRecordsCache(sheet);
  invalidateConfig(sheet);
}

export async function deleteRow(sheet, rowNumber) {
  const id = await getSheetId(sheet);
  await callWithRetry(async () => {
    await client().spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: id,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }]
      }
    });
  });
  invalidateRecordsCache(sheet);
  invalidateConfig(sheet);
}

export async function deleteRows(sheet, rowNumbers) {
  if (!rowNumbers || !rowNumbers.length) return;
  const id = await getSheetId(sheet);
  const sorted = [...new Set(rowNumbers)].map(Number).filter(n => n > 1).sort((a, b) => b - a);
  if (!sorted.length) return;
  const requests = sorted.map(rowNumber => ({
    deleteDimension: {
      range: {
        sheetId: id,
        dimension: 'ROWS',
        startIndex: rowNumber - 1,
        endIndex: rowNumber
      }
    }
  }));
  await callWithRetry(async () => {
    await client().spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { requests }
    });
  });
  invalidateRecordsCache(sheet);
  invalidateConfig(sheet);
}

export async function batchUpdate(requests) {
  return await callWithRetry(async () => {
    return client().spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { requests }
    });
  });
}

export async function findRows(sheet, predicate) {
  return (await getRecords(sheet)).filter(predicate);
}

export async function countRegistrations(sessionId) {
  return (await getRecords(SHEETS.REGISTRATIONS)).filter(r => String(r.sessionId) === String(sessionId) && (r.status || 'ACTIVE') === 'ACTIVE').length;
}

export async function countBySession() {
  const rows = await getRecords(SHEETS.REGISTRATIONS);
  return rows.filter(r => (r.status || 'ACTIVE') === 'ACTIVE').reduce((map, row) => {
    map[row.sessionId] = (map[row.sessionId] || 0) + 1;
    return map;
  }, {});
}

export async function getSheetId(title) {
  return await callWithRetry(async () => {
    const response = await client().spreadsheets.get({
      spreadsheetId: spreadsheetId(),
      fields: 'sheets.properties'
    });
    const sheet = response.data.sheets?.find(s => s.properties.title === title);
    if (!sheet) throw new Error(`Sheet ${title} not found`);
    return sheet.properties.sheetId;
  });
}

export async function ensureSheet(title, headers) {
  const response = await client().spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: 'sheets.properties'
  });
  if (!response.data.sheets?.some(s => s.properties.title === title)) {
    await client().spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }
  const current = await getSheetValues(title, '1:1');
  if (!current.length) {
    await client().spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `'${title}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
  }
}

export async function getConfigData() {
  if (configCache.value && configCache.until > Date.now()) return configCache.value;
  const sheetMap = await batchGetRecords([
    SHEETS.PROJECTS,
    SHEETS.SESSIONS,
    SHEETS.TEMPLES,
    SHEETS.SETTINGS,
    SHEETS.FORMFIELDS
  ]);
  const projects = sheetMap[SHEETS.PROJECTS] || [];
  const sessions = sheetMap[SHEETS.SESSIONS] || [];
  const temples = sheetMap[SHEETS.TEMPLES] || [];
  const settings = sheetMap[SHEETS.SETTINGS] || [];
  const formFields = sheetMap[SHEETS.FORMFIELDS] || [];

  const EXCLUDED_PROJECT_STATUSES = new Set(['ARCHIVED', 'DELETED']);
  const result = {
    projects: projects.filter(p => !EXCLUDED_PROJECT_STATUSES.has((p.status || 'OPEN').toUpperCase())),
    sessions,
    temples: temples.filter(t => (t.status || 'ACTIVE').toUpperCase() === 'ACTIVE'),
    settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
    formFields: formFields.filter(f => String(f.visible).toUpperCase() !== 'FALSE').sort((a,b) => Number(a.sortOrder) - Number(b.sortOrder))
  };
  configCache = { value: result, until: Date.now() + 60_000 };
  return result;
}

function invalidateConfig(sheet) {
  if ([SHEETS.PROJECTS, SHEETS.SESSIONS, SHEETS.TEMPLES, SHEETS.SETTINGS, SHEETS.FORMFIELDS].includes(sheet)) {
    configCache.until = 0;
  }
}

export async function withLock(key, operation) {
  const prior = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = prior.then(() => gate);
  locks.set(key, queue);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queue) locks.delete(key);
  }
}

export function nextSequence(records, prefix) {
  const values = records.map(r => String(r.registrationGroupId || r.registrationId || '')).filter(v => v.startsWith(prefix)).map(v => Number((v.match(/(\d+)(?:-\d+)?$/) || [])[1]) || 0);
  return String((Math.max(0, ...values) + 1)).padStart(6, '0');
}

export function createTempleId() {
  return `TMP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}

export function asRecord(input, headers) {
  return Object.fromEntries(headers.map(h => [h, cleanText(input[h] ?? '', 1000)]));
}

export function getProjectRegSheetName(projectId) {
  if (!projectId) return SHEETS.REGISTRATIONS;
  const safeId = String(projectId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `Reg_${safeId}`;
}

export const BASE_PROJECT_REG_HEADERS = [
  'registrationId',
  'sessionLabel',
  'prefix',
  'firstName',
  'lastName',
  'monasticName',
  'mobile',
  'nationalId',
  'birthDate',
  'age',
  'ordinationDate',
  'phansa',
  'address',
  'templeName',
  'subdistrict',
  'district',
  'province',
  'coordinatorName',
  'coordinatorPhone'
];

export const SYSTEM_PROJECT_REG_HEADERS = [
  'status',
  'registeredAt',
  'registrationGroupId',
  'personId',
  'templeId',
  'sessionId'
];

export async function getProjectRegHeaders(projectId, extraKeys = []) {
  let projectCustomKeys = [];
  try {
    const allFields = await getRecords(SHEETS.FORMFIELDS);
    projectCustomKeys = (allFields || [])
      .filter(f => f.projectId === projectId && f.fieldKey)
      .map(f => f.fieldKey);
  } catch (err) {
    console.warn('Could not fetch formFields for project headers:', err?.message);
  }

  const customKeys = [...new Set([...projectCustomKeys, ...extraKeys])].filter(k => 
    k &&
    !BASE_PROJECT_REG_HEADERS.includes(k) && 
    !SYSTEM_PROJECT_REG_HEADERS.includes(k) &&
    !['_rowNumber', 'projectId', 'createdBy', 'updatedAt', 'updatedBy', 'additionalData', 'useExistingMobile', 'birthDateDisplay', 'ordinationDateDisplay', 'otherPrefix'].includes(k)
  );

  return [
    ...BASE_PROJECT_REG_HEADERS,
    ...customKeys,
    ...SYSTEM_PROJECT_REG_HEADERS
  ];
}

export async function ensureProjectRegSheet(projectId, extraKeys = []) {
  const sheetName = getProjectRegSheetName(projectId);
  const targetHeaders = await getProjectRegHeaders(projectId, extraKeys);

  const response = await client().spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: 'sheets.properties'
  });
  const sheet = response.data.sheets?.find(s => s.properties.title === sheetName);

  if (!sheet) {
    await client().spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
    });
    await client().spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `'${sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [targetHeaders] }
    });
    return { sheetName, headers: targetHeaders };
  }

  // If sheet exists, read existing header row
  const headRes = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `'${sheetName}'!1:1`
  });
  const existingHeaders = headRes.data.values?.[0] || [];

  // Check if existing headers match the new format
  const missingHeaders = targetHeaders.filter(h => !existingHeaders.includes(h));
  if (missingHeaders.length > 0) {
    if (existingHeaders.includes('firstName') && existingHeaders.includes('templeName')) {
      const updatedHeaders = [...existingHeaders, ...missingHeaders];
      await client().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `'${sheetName}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [updatedHeaders] }
      });
      return { sheetName, headers: updatedHeaders };
    } else {
      // Re-align with target headers
      await client().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `'${sheetName}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [targetHeaders] }
      });
      return { sheetName, headers: targetHeaders };
    }
  }

  return { sheetName, headers: existingHeaders.length ? existingHeaders : targetHeaders };
}

export async function appendProjectRegistrations(projectId, globalRows, enrichedRows = null) {
  if (!globalRows || !globalRows.length) return;
  // 1. Append to global Registrations sheet
  await appendRows(SHEETS.REGISTRATIONS, globalRows);

  // 2. Append to project-specific registration sheet
  if (projectId) {
    try {
      const rowsToAppend = enrichedRows && enrichedRows.length ? enrichedRows : globalRows;
      const extraKeys = rowsToAppend.flatMap(r => Object.keys(r));
      const { sheetName, headers } = await ensureProjectRegSheet(projectId, extraKeys);

      const values = rowsToAppend.map(row => headers.map(header => safeCell(row[header] ?? '')));
      await callWithRetry(async () => {
        await client().spreadsheets.values.append({
          spreadsheetId: spreadsheetId(),
          range: `'${sheetName}'!A:ZZ`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values }
        });
      });
      invalidateRecordsCache(sheetName);
      invalidateConfig(sheetName);
    } catch (err) {
      console.warn(`[Google Sheets] Warning: Failed to append to project sheet Reg_${projectId}:`, err?.message);
    }
  }
}

export async function updateProjectRegistration(projectId, registrationId, updatedFields) {
  if (!projectId || !registrationId) return;
  try {
    const projSheet = getProjectRegSheetName(projectId);
    const records = await getRecords(projSheet);
    const target = records.find(r => r.registrationId === registrationId);
    if (target && target._rowNumber) {
      const merged = { ...target, ...updatedFields };
      delete merged._rowNumber;
      await updateRow(projSheet, target._rowNumber, merged);
    }
  } catch (err) {
    console.warn(`[Google Sheets] Warning: Could not update project sheet Reg_${projectId}:`, err?.message);
  }
}

export async function deleteProjectRegistration(projectId, registrationId) {
  if (!projectId || !registrationId) return;
  try {
    const projSheet = getProjectRegSheetName(projectId);
    const records = await getRecords(projSheet);
    const target = records.find(r => r.registrationId === registrationId);
    if (target && target._rowNumber) {
      await deleteRow(projSheet, target._rowNumber);
    }
  } catch (err) {
    console.warn(`[Google Sheets] Warning: Could not delete from project sheet Reg_${projectId}:`, err?.message);
  }
}

export async function deleteProjectSheet(projectId) {
  if (!projectId) return false;
  const sheetName = getProjectRegSheetName(projectId);
  try {
    const response = await client().spreadsheets.get({
      spreadsheetId: spreadsheetId(),
      fields: 'sheets.properties'
    });
    const target = response.data.sheets?.find(s => s.properties.title === sheetName);
    if (target && target.properties?.sheetId !== undefined) {
      await callWithRetry(async () => {
        await client().spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId(),
          requestBody: {
            requests: [{
              deleteSheet: {
                sheetId: target.properties.sheetId
              }
            }]
          }
        });
      });
      invalidateRecordsCache(sheetName);
      invalidateConfig(sheetName);
      console.log(`[Google Sheets] Successfully deleted project sheet: ${sheetName}`);
      return true;
    }
  } catch (err) {
    console.warn(`[Google Sheets] Warning: Failed to delete sheet ${sheetName}:`, err?.message);
  }
  return false;
}

