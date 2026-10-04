import { SHEETS, HEADERS } from './lib/constants.mjs';
import { errorResponse, HttpError, ok, requireAdmin } from './lib/http.mjs';
import { getRecords, ensureSheet, appendRows, batchUpdate, getSheetId } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';
import { google } from 'googleapis';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prefixGroup(prefix) {
  const p = (prefix || '').trim();
  if (p === 'พระ') return 'monks';
  if (p === 'นาย') return 'layMen';
  if (['นาง', 'นางสาว'].includes(p)) return 'layWomen';
  if (['เด็กชาย', 'เด็กหญิง'].includes(p)) return 'children';
  return 'other';
}

function buildSessionReport(projects, sessions, regs) {
  const now = new Date().toISOString();
  return sessions.map(session => {
    const project = projects.find(p => p.projectId === session.projectId) || {};
    const sRegs = regs.filter(r => r.sessionId === session.sessionId);
    const active = sRegs.filter(r => (r.status || 'ACTIVE') === 'ACTIVE');
    const cancelled = sRegs.filter(r => r.status === 'CANCELLED').length;
    const counts = { monks: 0, layMen: 0, layWomen: 0, children: 0 };
    active.forEach(r => { const g = prefixGroup(r.prefix); if (g in counts) counts[g]++; });
    return {
      projectName: project.projectName || session.projectId,
      sessionLabel: session.sessionLabel,
      capacity: session.capacity || '∞',
      totalRegistrations: active.length,
      monks: counts.monks,
      layMen: counts.layMen,
      layWomen: counts.layWomen,
      children: counts.children,
      cancelled,
      refreshedAt: now
    };
  });
}

function buildProvinceReport(regs) {
  const now = new Date().toISOString();
  const map = {};
  regs.filter(r => (r.status || 'ACTIVE') === 'ACTIVE').forEach(r => {
    const prov = r.province || 'ไม่ระบุ';
    if (!map[prov]) map[prov] = { province: prov, total: 0, monks: 0, lay: 0, temples: new Set() };
    map[prov].total++;
    prefixGroup(r.prefix) === 'monks' ? map[prov].monks++ : map[prov].lay++;
    if (r.templeName) map[prov].temples.add(r.templeName);
  });
  return Object.values(map)
    .sort((a, b) => b.total - a.total)
    .map(({ province, total, monks, lay, temples }) => ({
      province,
      totalRegistrations: total,
      monks,
      layPeople: lay,
      uniqueTemples: temples.size,
      refreshedAt: now
    }));
}

function buildKathinReport(kathins) {
  const now = new Date().toISOString();
  const map = {};
  kathins.forEach(k => {
    const t = k.kathinType || 'ไม่ระบุ';
    if (!map[t]) map[t] = { kathinType: t, totalWats: 0, approvedWats: 0, pendingWats: 0, cancelledWats: 0 };
    map[t].totalWats++;
    if (k.status === 'APPROVED') map[t].approvedWats++;
    else if (k.status === 'CANCELLED') map[t].cancelledWats++;
    else map[t].pendingWats++;
  });
  return Object.values(map).map(row => ({ ...row, refreshedAt: now }));
}

function buildSummaryStats(regs, sessions, kathins) {
  const active = regs.filter(r => (r.status || 'ACTIVE') === 'ACTIVE');
  const byPrefix = {};
  active.forEach(r => { const g = prefixGroup(r.prefix); byPrefix[g] = (byPrefix[g] || 0) + 1; });
  const provinces = [...new Set(active.map(r => r.province).filter(Boolean))];
  const today = new Date().toISOString().slice(0, 10);
  return {
    totalActive: active.length,
    totalCancelled: regs.filter(r => r.status === 'CANCELLED').length,
    todayRegistrations: active.filter(r => String(r.registeredAt || '').startsWith(today)).length,
    monks: byPrefix.monks || 0,
    layMen: byPrefix.layMen || 0,
    layWomen: byPrefix.layWomen || 0,
    children: byPrefix.children || 0,
    uniqueProvinces: provinces.length,
    kathinApproved: kathins.filter(k => k.status === 'APPROVED').length,
    kathinPending: kathins.filter(k => k.status !== 'APPROVED' && k.status !== 'CANCELLED').length,
    kathinTotal: kathins.length
  };
}

// ─── Clear report sheet and rewrite ──────────────────────────────────────────

async function refreshSheet(sheetName, rows) {
  await ensureSheet(sheetName, HEADERS[sheetName]);
  if (!rows.length) return 0;
  // Use values.clear then re-append
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\\\n/g, '\n');
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${sheetName}'!A2:ZZ` });
  await appendRows(sheetName, rows);
  return rows.length;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async event => {
  try {
    requireAdmin(event);

    const [projects, sessions, registrations, persons, kathins] = await Promise.all([
      getRecords(SHEETS.PROJECTS),
      getRecords(SHEETS.SESSIONS),
      getRecords(SHEETS.REGISTRATIONS),
      getRecords(SHEETS.PERSONS),
      getRecords(SHEETS.KATHIN)
    ]);

    // Enrich registrations with person prefix
    const joined = registrations.map(r => {
      const person = persons.find(p => p.personId === r.personId) || {};
      const temple = persons.find(p => p.personId === r.personId);
      return { ...r, prefix: person.prefix || r.prefix || '' };
    });

    const sessionRows = buildSessionReport(projects, sessions, joined);
    const provinceRows = buildProvinceReport(joined);
    const kathinRows = buildKathinReport(kathins);
    const summary = buildSummaryStats(joined, sessions, kathins);

    // GET — just return computed data, no write
    if (event.httpMethod === 'GET') {
      return ok({ summary, sessions: sessionRows, provinces: provinceRows, kathin: kathinRows, generatedAt: new Date().toISOString() });
    }

    // POST — write to Google Sheets report tabs
    if (event.httpMethod === 'POST') {
      const [s, p, k] = await Promise.all([
        refreshSheet(SHEETS.RPT_SESSIONS, sessionRows),
        refreshSheet(SHEETS.RPT_PROVINCES, provinceRows),
        refreshSheet(SHEETS.RPT_KATHIN, kathinRows)
      ]);
      return ok({ written: { sessions: s, provinces: p, kathin: k }, summary, refreshedAt: new Date().toISOString() });
    }

    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะ GET (ดูข้อมูล) และ POST (Refresh ลง Sheets)');
  } catch (err) {
    return errorResponse(err);
  }
};

export default netlify(handler);
