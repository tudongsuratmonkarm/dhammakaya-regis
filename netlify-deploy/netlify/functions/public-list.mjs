import { ok, fail, errorResponse, cleanText } from './lib/http.mjs';
import { SHEETS } from './lib/constants.mjs';
import { getConfigData, getRecords } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';

export const handler = async event => { 
  try { 
    const { settings } = await getConfigData(); 
    if (String(settings.PUBLIC_LIST_ENABLED || 'TRUE').toUpperCase() !== 'TRUE') return fail(403, 'PUBLIC_LIST_DISABLED', 'ยังไม่เปิดแสดงรายชื่อสาธารณะ'); 
    
    const requestedProjectId = cleanText(event.queryStringParameters?.projectId || '', 50);
    const query = cleanText(event.queryStringParameters?.q || '', 100).toLowerCase(); 
    const page = Math.max(1, Number(event.queryStringParameters?.page) || 1); 
    const pageSize = Math.min(50, Math.max(10, Number(event.queryStringParameters?.pageSize) || 20)); 
    
    const [registrations, persons, temples, sessions, projects] = await Promise.all([
      getRecords(SHEETS.REGISTRATIONS),
      getRecords(SHEETS.PERSONS),
      getRecords(SHEETS.TEMPLES),
      getRecords(SHEETS.SESSIONS),
      getRecords(SHEETS.PROJECTS)
    ]);

    // Only allow projects that are publicVisible
    const publicProjects = projects.filter(p => {
      const pub = String(p.publicVisible ?? p.publicListVisible ?? 'TRUE').toUpperCase();
      return pub !== 'FALSE';
    });
    const allowedProjectIds = new Set(publicProjects.map(p => p.projectId));

    // Filter registrations
    let activeRegistrations = registrations.filter(r => {
      if ((r.status || 'ACTIVE') !== 'ACTIVE') return false;
      const pId = r.projectId || 'PRJ-1';
      if (!allowedProjectIds.has(pId)) return false;
      if (requestedProjectId && pId !== requestedProjectId) return false;
      return true;
    });

    let rows = activeRegistrations.map(reg => {
      const person = persons.find(p => p.personId === reg.personId) || {};
      const temple = temples.find(t => t.templeId === reg.templeId) || {};
      const session = sessions.find(b => b.sessionId === reg.sessionId) || {};
      const project = projects.find(p => p.projectId === reg.projectId) || {};
      return {
        projectId: reg.projectId,
        projectName: project.projectName || '',
        firstName: person.firstName || '',
        lastName: person.lastName || '',
        prefix: person.prefix || '',
        otherPrefix: person.otherPrefix || '',
        templeName: temple.templeName || '',
        sessionLabel: session.sessionLabel || '',
        registeredAt: reg.registeredAt
      };
    });

    if (query) rows = rows.filter(r => `${r.firstName} ${r.lastName} ${r.templeName} ${r.sessionLabel} ${r.projectName}`.toLowerCase().includes(query)); 
    rows.sort((a,b) => String(b.registeredAt).localeCompare(String(a.registeredAt))); 
    
    const total = rows.length; 
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map(r => ({ 
      name: `${r.prefix === 'อื่น ๆ' ? r.otherPrefix : r.prefix} ${r.firstName} ${r.lastName}`.trim(), 
      templeName: r.templeName, 
      sessionLabel: r.sessionLabel,
      projectName: r.projectName
    })); 
    
    return ok({ 
      items, 
      page, 
      pageSize, 
      total, 
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      projects: publicProjects.map(p => ({ projectId: p.projectId, projectName: p.projectName })),
      selectedProjectId: requestedProjectId
    }); 
  } catch (error) { 
    return errorResponse(error); 
  } 
};
export default netlify(handler);
