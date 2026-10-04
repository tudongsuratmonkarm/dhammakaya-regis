import { ok, errorResponse } from './lib/http.mjs';
import { countBySession, getConfigData, ensureHeaderRow } from './lib/sheets.mjs';
import { SHEETS, HEADERS } from './lib/constants.mjs';
import { netlify } from './lib/adapter.mjs';

function formatThaiDate(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return isoDate || '';
  const d = new Date(`${isoDate.slice(0,10)}T00:00:00Z`);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

function computeDisplayDate(session) {
  if (session.displayDate) return session.displayDate;
  const start = formatThaiDate(session.startDate);
  const end = formatThaiDate(session.endDate);
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || '';
}

export const handler = async () => {
  try {
    await ensureHeaderRow(SHEETS.PROJECTS, HEADERS[SHEETS.PROJECTS]);
    const [config, counts] = await Promise.all([getConfigData(), countBySession()]);

    const PUBLIC_PROJECT_STATUSES = new Set(['OPEN', 'UPCOMING', 'ACTIVE']);
    const projects = config.projects
      .filter(p => {
        const isPublic = String(p.publicVisible || 'TRUE').toUpperCase() === 'TRUE';
        const isOpenStatus = PUBLIC_PROJECT_STATUSES.has((p.status || 'OPEN').toUpperCase());
        return isPublic && isOpenStatus;
      })
      .map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        projectType: p.projectType,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        requireTemple: String(p.requireTemple ?? 'TRUE').toUpperCase() !== 'FALSE'
      }));

    const sessions = config.sessions
      .sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999))
      .map(session => {
        // Support both old 'publicVisible' header and new 'allowPublicRegistration' header
        const pubRaw = session.allowPublicRegistration ?? session.publicVisible ?? 'TRUE';
        return {
          sessionId: session.sessionId,
          projectId: session.projectId,
          sessionLabel: session.sessionLabel,
          displayDate: computeDisplayDate(session),
          capacity: Number(session.capacity || 0),
          status: session.status,
          allowPublicRegistration: String(pubRaw).toUpperCase() === 'TRUE',
          count: counts[session.sessionId] || 0
        };
      });

    const temples = config.temples.map(t => ({
      templeId: t.templeId,
      templeName: t.templeName,
      subdistrict: t.subdistrict,
      district: t.district,
      province: t.province
    }));

    const formFields = config.formFields.map(f => ({
      fieldId: f.fieldId,
      projectId: f.projectId,
      fieldKey: f.fieldKey,
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      visible: f.visible,
      sortOrder: f.sortOrder,
      placeholder: f.placeholder,
      optionsJson: f.optionsJson
    }));

    let homepageConfig = null;
    if (config.settings?.HOMEPAGE_CONFIG) {
      try {
        homepageConfig = JSON.parse(config.settings.HOMEPAGE_CONFIG);
      } catch (e) {
        console.warn('Could not parse HOMEPAGE_CONFIG from settings:', e.message);
      }
    }

    const totalRegistrations = Object.values(counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const stats = {
      totalPersons: totalRegistrations,
      totalTemples: temples.length,
      openProjectsCount: projects.filter(p => (p.status || 'OPEN').toUpperCase() === 'OPEN').length
    };

    return ok({
      projectName: config.settings.PLATFORM_NAME || config.settings.PROJECT_NAME || 'ธุดงคสถานสุราษฎร์ธานี',
      publicListEnabled: String(config.settings.PUBLIC_LIST_ENABLED || 'TRUE').toUpperCase() === 'TRUE',
      projects,
      sessions,
      temples,
      formFields,
      homepageConfig,
      stats
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export default netlify(handler);
