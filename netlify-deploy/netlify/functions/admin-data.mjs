import { audit } from './lib/audit.mjs';
import { SHEETS, HEADERS } from './lib/constants.mjs';
import { errorResponse, HttpError, methodNotAllowed, ok, readJson, cleanText } from './lib/http.mjs';
import { appendRows, countBySession, getRecords, batchGetRecords, updateRow, deleteRow, deleteRows, deleteProjectSheet } from './lib/sheets.mjs';
import { validateBatchFields } from './lib/validation.mjs';
import { requireAdmin } from './lib/http.mjs';
import { netlify } from './lib/adapter.mjs';
import { getAdmins } from './lib/admins.mjs';

function search(rows, q, fields) { if (!q) return rows; const term = q.toLowerCase(); return rows.filter(row => fields.some(field => String(row[field] || '').toLowerCase().includes(term))); }
function dashboard(sessions, joinedRegistrations) { const active = joinedRegistrations.filter(r => (r.status || 'ACTIVE') === 'ACTIVE'); const today = new Date().toISOString().slice(0,10); const count = key => Object.entries(active.reduce((result,row)=>{const value=row[key]||'-';result[value]=(result[value]||0)+1;return result;},{})).sort((a,b)=>b[1]-a[1])[0]?.[0] || '-'; return { total:active.length, today:active.filter(r=>String(r.registeredAt).startsWith(today)).length, topTemple:count('templeName'), topBatch:count('sessionLabel') }; }

export const handler = async event => { 
  try { 
    const admin = requireAdmin(event); 
    const adminModifier = admin.name || admin.u;
    if (event.httpMethod === 'GET') { 
      const q = cleanText(event.queryStringParameters?.q || '',100); 
      const scope = event.queryStringParameters?.scope || ''; 
      const sheetMap = await batchGetRecords([
        SHEETS.PROJECTS,
        SHEETS.SESSIONS,
        SHEETS.REGISTRATIONS,
        SHEETS.TEMPLES,
        SHEETS.PERSONS,
        SHEETS.FORMFIELDS,
        SHEETS.KATHIN,
        SHEETS.DISBURSEMENTS,
        SHEETS.SETTINGS,
        SHEETS.MEDIA
      ]);
      const projects = sheetMap[SHEETS.PROJECTS] || [];
      const sessions = sheetMap[SHEETS.SESSIONS] || [];
      const registrations = sheetMap[SHEETS.REGISTRATIONS] || [];
      const temples = sheetMap[SHEETS.TEMPLES] || [];
      const persons = sheetMap[SHEETS.PERSONS] || [];
      const formFields = sheetMap[SHEETS.FORMFIELDS] || [];
      const kathin = sheetMap[SHEETS.KATHIN] || [];
      const disbursements = sheetMap[SHEETS.DISBURSEMENTS] || [];
      const settings = sheetMap[SHEETS.SETTINGS] || [];
      const media = sheetMap[SHEETS.MEDIA] || [];

      const kathinMedia = media.filter(m => m.entityType === 'KATHIN');
      const templeMedia = media.filter(m => m.entityType === 'TEMPLE');

      const enrichedKathin = kathin.map(k => {
        const km = kathinMedia.filter(m => m.entityId === k.kathinId).sort((a,b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
        return {
          ...k,
          imageUrl: km[0]?.fileUrl || k.imageUrl || '',
          images: km.map(m => m.fileUrl).filter(Boolean)
        };
      });

      const enrichedTemples = temples.map(t => {
        const tm = templeMedia.find(m => m.entityId === t.templeId);
        return {
          ...t,
          imageUrl: tm?.fileUrl || t.imageUrl || ''
        };
      });

      // Calculate counts in-memory without extra Sheets API call!
      const counts = registrations.filter(r => (r.status || 'ACTIVE') === 'ACTIVE').reduce((map, row) => {
        map[row.sessionId] = (map[row.sessionId] || 0) + 1;
        return map;
      }, {});

      const enrichedSessions = sessions.sort((a,b)=>Number(a.sortOrder)-Number(b.sortOrder)).map(b=>({...b,count:counts[b.sessionId]||0})); 
      
      // Join relations for registrations
      const joinedRegistrations = registrations.map(reg => {
        const person = persons.find(p => p.personId === reg.personId) || {};
        const temple = temples.find(t => t.templeId === reg.templeId) || {};
        const session = sessions.find(b => b.sessionId === reg.sessionId) || {};
        const project = projects.find(p => p.projectId === reg.projectId) || {};
        return {
          ...person,
          ...reg,
          templeName: temple.templeName,
          province: temple.province,
          sessionLabel: session.sessionLabel,
          projectName: project.projectName
        };
      });

      let homepageConfig = null;
      const hpSetting = settings.find(s => s.key === 'HOMEPAGE_CONFIG');
      if (hpSetting && hpSetting.value) {
        try { homepageConfig = JSON.parse(hpSetting.value); } catch {}
      }

      const adminsList = await getAdmins(false).catch(() => []);
      const result = { 
        currentAdmin: {
          username: admin.u,
          displayName: admin.name || admin.u,
          role: admin.role || 'ADMIN'
        },
        admins: adminsList,
        dashboard: dashboard(enrichedSessions, joinedRegistrations),
        projects,
        sessions: enrichedSessions,
        formFields: formFields.sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)),
        kathin: enrichedKathin.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),
        disbursements: disbursements.sort((a,b)=>String(b.createdAt||b.documentDate||'').localeCompare(String(a.createdAt||a.documentDate||''))),
        persons: persons.map(p => ({ ...p, nationalId: undefined })).sort((a,b)=>String(a.firstName).localeCompare(String(b.firstName),'th')),
        registrations: search(joinedRegistrations, q, ['firstName','lastName','templeName','sessionLabel','mobile','registrationId']).sort((a,b)=>String(b.registeredAt).localeCompare(String(a.registeredAt))),
        temples: search(enrichedTemples, q, ['templeName','subdistrict','district','province','abbotName','abbotPhone','templePhone','abbot','phone']).sort((a,b)=>String(a.templeName).localeCompare(String(b.templeName),'th')),
        homepageConfig
      }; 
      
      if(scope==='registrations') delete result.temples; 
      if(scope==='temples') delete result.registrations; 
      return ok(result); 
    }

    
    if (!['POST','PUT','DELETE'].includes(event.httpMethod)) return methodNotAllowed(); 
    const body = readJson(event); 
    
    if (body.entity === 'project') {
      const existing = await getRecords(SHEETS.PROJECTS);
      const item = {
        projectId: body.projectId,
        projectName: body.projectName,
        projectType: body.projectType || 'TRAINING',
        startDate: body.startDate,
        endDate: body.endDate,
        status: body.status || 'OPEN',
        publicVisible: body.publicVisible !== undefined ? (String(body.publicVisible).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE') : 'TRUE',
        registrationOpen: body.registrationOpen !== undefined ? (String(body.registrationOpen).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE') : 'TRUE',
        requireTemple: body.requireTemple !== undefined ? (String(body.requireTemple).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE') : 'TRUE',
        updatedAt: new Date().toISOString()
      };
      
      // ── CLONE MODE ──────────────────────────────────────────────────────────
      if(event.httpMethod === 'POST' && body.mode === 'clone') {
        const source = existing.find(p => p.projectId === body.sourceProjectId);
        if(!source) throw new HttpError(404,'NOT_FOUND','ไม่พบโครงการต้นแบบ');
        
        const ts = Date.now();
        const newProjectId = `PRJ-${ts}`;
        const now = new Date().toISOString();
        
        const newProject = {
          ...source,
          projectId:     newProjectId,
          projectName:   `${source.projectName} (สำเนา)`,
          status:        'DRAFT',           // cloned projects start as draft
          publicVisible: 'FALSE',
          registrationOpen: 'FALSE',
          createdAt:     now,
          updatedAt:     now,
          createdBy:     adminModifier,
          updatedBy:     adminModifier,
          _rowNumber:    undefined           // don't carry over sheet row ref
        };
        delete newProject._rowNumber;
        
        await appendRows(SHEETS.PROJECTS, [newProject]);
        await audit('CLONE','PROJECT', newProjectId, adminModifier, { sourceProjectId: source.projectId });
        
        // Copy FormFields
        const allFields = await getRecords(SHEETS.FORMFIELDS);
        const sourceFields = allFields.filter(f => f.projectId === source.projectId);
        if(sourceFields.length > 0) {
          const clonedFields = sourceFields.map((f, i) => {
            const cloned = {
              ...f,
              fieldId:   `F${ts}-${i}`,
              projectId: newProjectId,
              createdAt: now,
              updatedAt: now
            };
            delete cloned._rowNumber;
            return cloned;
          });
          await appendRows(SHEETS.FORMFIELDS, clonedFields);
        }
        
        return ok({
          project: newProject,
          clonedFields: sourceFields.length,
          message: `โคลนโครงการสำเร็จ — คัดลอก Form Fields ${sourceFields.length} รายการ (ไม่รวมรุ่น/ผู้สมัคร)`
        });
      }
      // ────────────────────────────────────────────────────────────────────────
      
      if(event.httpMethod === 'DELETE') {
        const targetId = body.projectId || item.projectId;
        const old = existing.find(p => p.projectId === targetId);
        if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบโครงการ');
        await deleteRow(SHEETS.PROJECTS, old._rowNumber);
        await deleteProjectSheet(targetId);
        await audit('DELETE','PROJECT', old.projectId, adminModifier, old);
        return ok({project: old, sheetDeleted: true});
      }

      if(event.httpMethod === 'POST') {
        item.projectId = item.projectId || `P${Date.now()}`;
        if(existing.some(p => p.projectId === item.projectId)) throw new HttpError(409,'DUPLICATE_PROJECT','รหัสโครงการซ้ำ');
        item.createdAt = new Date().toISOString();
        await appendRows(SHEETS.PROJECTS, [item]);
        await audit('CREATE','PROJECT', item.projectId, adminModifier, item);
        return ok({project: item});
      }
      
      const old = existing.find(p => p.projectId === item.projectId);
      if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบโครงการ');
      item.createdAt = old.createdAt;
      item.description = body.description !== undefined ? body.description : (old.description || '');
      item.createdBy = old.createdBy || '';
      item.updatedBy = adminModifier || '';
      if (body.projectName === undefined) item.projectName = old.projectName;
      if (body.projectType === undefined) item.projectType = old.projectType || 'TRAINING';
      if (body.startDate === undefined) item.startDate = old.startDate || '';
      if (body.endDate === undefined) item.endDate = old.endDate || '';
      if (body.status === undefined) item.status = old.status || 'OPEN';
      if (body.publicVisible === undefined) item.publicVisible = old.publicVisible || 'TRUE';
      if (body.registrationOpen === undefined) item.registrationOpen = old.registrationOpen || 'TRUE';
      if (body.requireTemple === undefined) item.requireTemple = old.requireTemple || 'TRUE';
      await updateRow(SHEETS.PROJECTS, old._rowNumber, item);
      await audit('UPDATE','PROJECT', item.projectId, adminModifier, item);
      return ok({project: item});
    }

    if (body.entity === 'formField') {
      const existing = await getRecords(SHEETS.FORMFIELDS);
      const item = {
        fieldId: body.fieldId,
        projectId: body.projectId || 'PRJ-1',
        fieldKey: body.fieldKey,
        label: body.label,
        fieldType: body.fieldType || 'text',
        required: String(body.required).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
        visible: String(body.visible).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE',
        sortOrder: body.sortOrder || String(existing.length + 1),
        placeholder: body.placeholder || '',
        optionsJson: body.optionsJson || '',
        validationJson: body.validationJson || '',
        conditionalRuleJson: body.conditionalRuleJson || '',
        updatedAt: new Date().toISOString()
      };
      
      if(event.httpMethod === 'DELETE') {
        const targetId = body.fieldId || item.fieldId;
        const old = existing.find(f => f.fieldId === targetId);
        if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูล Field');
        await deleteRow(SHEETS.FORMFIELDS, old._rowNumber);
        await audit('DELETE','FORMFIELD', old.fieldId, adminModifier, old);
        return ok({formField: old});
      }

      if(event.httpMethod === 'POST') {
        item.fieldId = item.fieldId || `F${Date.now()}`;
        if(existing.some(f => f.fieldId === item.fieldId)) throw new HttpError(409,'DUPLICATE_FIELD','รหัส Field ซ้ำ');
        item.createdAt = new Date().toISOString();
        await appendRows(SHEETS.FORMFIELDS, [item]);
        await audit('CREATE','FORMFIELD', item.fieldId, adminModifier, item);
        return ok({formField: item});
      }
      
      const old = existing.find(f => f.fieldId === item.fieldId);
      if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูล Field');
      item.createdAt = old.createdAt;
      await updateRow(SHEETS.FORMFIELDS, old._rowNumber, item);
      await audit('UPDATE','FORMFIELD', item.fieldId, adminModifier, item);
      return ok({formField: item});
    }

    if(body.entity === 'kathin') {
      const existing = await getRecords(SHEETS.KATHIN);

      if(event.httpMethod === 'DELETE') {
        const ids = Array.isArray(body.kathinIds)
          ? body.kathinIds.map(id => String(id).trim()).filter(Boolean)
          : (body.kathinId ? [String(body.kathinId).trim()] : []);

        if (!ids.length) throw new HttpError(400, 'INVALID_REQUEST', 'ไม่พบรหัสกฐินที่ต้องการลบ');

        const idSet = new Set(ids);
        const toDelete = existing.filter(k => idSet.has(k.kathinId));
        if (!toDelete.length) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลกฐินที่ระบุ');

        const rowNumbers = toDelete.map(k => k._rowNumber);
        await deleteRows(SHEETS.KATHIN, rowNumbers);

        // Clean up corresponding media rows
        try {
          const mediaRows = await getRecords(SHEETS.MEDIA);
          const mediaToDelete = mediaRows.filter(m => m.entityType === 'KATHIN' && idSet.has(m.entityId));
          if (mediaToDelete.length) {
            await deleteRows(SHEETS.MEDIA, mediaToDelete.map(m => m._rowNumber));
          }
        } catch (e) {
          console.warn('Failed to delete kathin media:', e.message);
        }

        await audit('DELETE', 'KATHIN', ids.slice(0, 10).join(','), adminModifier, {
          count: toDelete.length,
          templeNames: toDelete.map(k => k.templeName).slice(0, 10)
        });
        return ok({ deleted: true, count: toDelete.length });
      }

      if(event.httpMethod === 'POST') {
        const templeName = cleanText(body.templeName, 200);
        const province = cleanText(body.province, 100);
        if(!templeName || !province) throw new HttpError(400, 'INVALID_KATHIN', 'กรุณาระบุชื่อวัดและจังหวัด');

        const now = new Date().toISOString();
        const newKathin = {
          kathinId: body.kathinId || `KAT-${Date.now().toString(36).toUpperCase()}`,
          kathinType: cleanText(body.kathinType, 50) || 'กฐินแสน',
          templeId: cleanText(body.templeId, 80) || '',
          templeName,
          subdistrict: cleanText(body.subdistrict, 100) || '',
          district: cleanText(body.district, 100) || '',
          province,
          residentMonks: String(body.residentMonks || '0').replace(/\D/g, '') || '0',
          kathinDate: cleanText(body.kathinDate, 50) || '',
          kathinTime: cleanText(body.kathinTime, 50) || '',
          abbotName: cleanText(body.abbotName, 100) || '',
          abbotPhone: cleanText(body.abbotPhone, 50) || '',
          disciple1Name: cleanText(body.disciple1Name, 100) || '',
          disciple1Phone: cleanText(body.disciple1Phone, 50) || '',
          disciple2Name: cleanText(body.disciple2Name, 100) || '',
          disciple2Phone: cleanText(body.disciple2Phone, 50) || '',
          status: cleanText(body.status, 20) || 'APPROVED',
          description: cleanText(body.description, 1000) || '',
          createdAt: now,
          updatedAt: now
        };

        await appendRows(SHEETS.KATHIN, [newKathin]);

        // Save imageUrl if provided
        const imgUrl = cleanText(body.imageUrl || '', 1000);
        if (imgUrl) {
          try {
            await appendRows(SHEETS.MEDIA, [{
              imageId: `IMG-${Date.now().toString(36).toUpperCase()}`,
              entityType: 'KATHIN',
              entityId: newKathin.kathinId,
              fileId: '',
              fileUrl: imgUrl,
              thumbnailUrl: '',
              caption: '',
              sortOrder: '1',
              uploadedAt: now
            }]);
          } catch (e) {
            console.warn('Failed to save kathin media:', e.message);
          }
        }

        await audit('CREATE', 'KATHIN', newKathin.kathinId, adminModifier, newKathin);
        return ok({ kathin: { ...newKathin, imageUrl: imgUrl, images: imgUrl ? [imgUrl] : [] } });
      }

      if (Array.isArray(body.kathinIds) && body.status) {
        const idSet = new Set(body.kathinIds.map(id => String(id).trim()));
        const targetStatus = cleanText(body.status, 20) || 'APPROVED';
        const toUpdate = existing.filter(k => idSet.has(k.kathinId));
        if (!toUpdate.length) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบรายการกฐินที่ระบุ');

        const now = new Date().toISOString();
        for (const item of toUpdate) {
          const updated = {
            ...item,
            status: targetStatus,
            updatedAt: now
          };
          await updateRow(SHEETS.KATHIN, item._rowNumber, updated);
        }
        await audit('BULK_STATUS', 'KATHIN', Array.from(idSet).slice(0, 10).join(','), adminModifier, {
          count: toUpdate.length,
          status: targetStatus
        });
        return ok({ updated: true, count: toUpdate.length, status: targetStatus });
      }

      const old = existing.find(k => k.kathinId === body.kathinId);
      if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูลกฐิน');
      
      const item = {
        ...old,
        kathinType: body.kathinType !== undefined ? cleanText(body.kathinType, 50) : old.kathinType,
        templeName: body.templeName !== undefined ? cleanText(body.templeName, 200) : old.templeName,
        subdistrict: body.subdistrict !== undefined ? cleanText(body.subdistrict, 100) : old.subdistrict,
        district: body.district !== undefined ? cleanText(body.district, 100) : old.district,
        province: body.province !== undefined ? cleanText(body.province, 100) : old.province,
        residentMonks: body.residentMonks !== undefined ? (String(body.residentMonks).replace(/\D/g, '') || '0') : old.residentMonks,
        kathinDate: body.kathinDate !== undefined ? cleanText(body.kathinDate, 50) : old.kathinDate,
        kathinTime: body.kathinTime !== undefined ? cleanText(body.kathinTime, 50) : old.kathinTime,
        abbotName: body.abbotName !== undefined ? cleanText(body.abbotName, 100) : old.abbotName,
        abbotPhone: body.abbotPhone !== undefined ? cleanText(body.abbotPhone, 50) : old.abbotPhone,
        disciple1Name: body.disciple1Name !== undefined ? cleanText(body.disciple1Name, 100) : old.disciple1Name,
        disciple1Phone: body.disciple1Phone !== undefined ? cleanText(body.disciple1Phone, 50) : old.disciple1Phone,
        disciple2Name: body.disciple2Name !== undefined ? cleanText(body.disciple2Name, 100) : old.disciple2Name,
        disciple2Phone: body.disciple2Phone !== undefined ? cleanText(body.disciple2Phone, 50) : old.disciple2Phone,
        status: body.status !== undefined ? (cleanText(body.status, 20) || old.status) : old.status,
        description: body.description !== undefined ? cleanText(body.description, 1000) : old.description,
        updatedAt: new Date().toISOString()
      };
      
      await updateRow(SHEETS.KATHIN, old._rowNumber, item);

      // Handle imageUrl sync to Media sheet
      let finalImgUrl = '';
      if (body.imageUrl !== undefined) {
        finalImgUrl = cleanText(body.imageUrl || '', 1000);
        try {
          const mediaRows = await getRecords(SHEETS.MEDIA);
          const existingMedia = mediaRows.find(m => m.entityType === 'KATHIN' && m.entityId === item.kathinId);
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
                entityType: 'KATHIN',
                entityId: item.kathinId,
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
          console.warn('Failed to sync kathin media:', e.message);
        }
      }

      await audit('UPDATE','KATHIN', item.kathinId, adminModifier, item);
      return ok({ kathin: { ...item, imageUrl: finalImgUrl, images: finalImgUrl ? [finalImgUrl] : [] } });

    }

    if(body.entity === 'person') {
      if(event.httpMethod !== 'PUT') throw new HttpError(405,'METHOD_NOT_ALLOWED','Person รองรับเฉพาะการแก้ไข (PUT)');
      const existing = await getRecords(SHEETS.PERSONS);
      const old = existing.find(p => p.personId === body.personId);
      if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูลบุคคล');

      // Calculate age from birthDate if provided
      let age = old.age;
      if(body.birthDate) {
        try {
          const bd = new Date(body.birthDate);
          const now = new Date();
          let calc = now.getFullYear() - bd.getFullYear();
          const mDiff = now.getMonth() - bd.getMonth();
          if (mDiff < 0 || (mDiff === 0 && now.getDate() < bd.getDate())) calc--;
          age = String(calc);
        } catch {}
      }

      const item = {
        ...old,
        prefix: cleanText(body.prefix, 20) || old.prefix,
        otherPrefix: cleanText(body.otherPrefix, 50) || old.otherPrefix || '',
        monasticName: cleanText(body.monasticName, 100) || old.monasticName || '',
        firstName: cleanText(body.firstName, 100) || old.firstName,
        lastName: cleanText(body.lastName, 100) || old.lastName,
        mobile: cleanText(body.mobile, 10) || old.mobile || '',
        nationalId: cleanText(body.nationalId, 13) || old.nationalId || '',
        birthDate: body.birthDate || old.birthDate || '',
        ordinationDate: body.ordinationDate || old.ordinationDate || '',
        age,
        status: cleanText(body.status, 20) || old.status || 'ACTIVE',
        updatedAt: new Date().toISOString()
      };

      await updateRow(SHEETS.PERSONS, old._rowNumber, item);
      await audit('UPDATE', 'PERSON', item.personId, adminModifier, { firstName: item.firstName, lastName: item.lastName });
      return ok({ person: { ...item, nationalId: undefined } });
    }

    if (body.entity === 'homepageConfig') {
      const existingSettings = await getRecords(SHEETS.SETTINGS);
      const jsonStr = typeof body.config === 'string' ? body.config : JSON.stringify(body.config);
      const target = existingSettings.find(s => s.key === 'HOMEPAGE_CONFIG');
      if (target && target._rowNumber) {
        await updateRow(SHEETS.SETTINGS, target._rowNumber, {
          key: 'HOMEPAGE_CONFIG',
          value: jsonStr,
          description: 'การตั้งค่าหน้าแรก Public Homepage CMS'
        });
      } else {
        await appendRows(SHEETS.SETTINGS, [{
          key: 'HOMEPAGE_CONFIG',
          value: jsonStr,
          description: 'การตั้งค่าหน้าแรก Public Homepage CMS'
        }]);
      }
      await audit('UPDATE', 'HOMEPAGE_CONFIG', 'HOMEPAGE_CONFIG', adminModifier, { updated: true });
      return ok({ success: true, message: 'บันทึกการตั้งค่าหน้าแรกสำเร็จ' });
    }

    if(body.entity !== 'session') throw new HttpError(400,'INVALID_ENTITY','รองรับเฉพาะการจัดการโครงการ, แบบฟอร์ม, กฐิน, บุคคล, การตั้งค่าหน้าแรก และรอบ/รุ่น'); 

    if(event.httpMethod === 'DELETE') {
      const existing = await getRecords(SHEETS.SESSIONS); 
      const targetId = body.sessionId;
      const old = existing.find(b => b.sessionId === targetId);
      if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูลรอบ/รุ่น');
      await deleteRow(SHEETS.SESSIONS, old._rowNumber);
      await audit('DELETE','SESSION', old.sessionId, adminModifier, old);
      return ok({session: old});
    }

    const item = validateBatchFields(body); 
    const existing = await getRecords(SHEETS.SESSIONS); 
    
    if(event.httpMethod === 'POST') { 
      item.sessionId = item.sessionId || `SES-${Date.now()}`; 
      item.projectId = item.projectId || 'PRJ-1';
      if(existing.some(b => b.sessionId === item.sessionId)) throw new HttpError(409,'DUPLICATE_SESSION','รหัสรอบ/รุ่นซ้ำ'); 
      item.sortOrder = item.sortOrder || String(existing.length + 1); 
      item.createdAt = new Date().toISOString();
      await appendRows(SHEETS.SESSIONS, [item]); 
      await audit('CREATE','SESSION', item.sessionId, adminModifier, item); 
      return ok({session: item}); 
    }
    
    const old = existing.find(b => b.sessionId === item.sessionId); 
    if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูลรอบ/รุ่น'); 
    item.sortOrder = item.sortOrder || old.sortOrder; 
    item.projectId = item.projectId || old.projectId || 'PRJ-1';
    item.createdAt = old.createdAt || new Date().toISOString();
    await updateRow(SHEETS.SESSIONS, old._rowNumber, item); 
    await audit('UPDATE','SESSION', item.sessionId, adminModifier, item); 
    return ok({session: item});
  } catch(error) { 
    return errorResponse(error); 
  } 
};
export default netlify(handler);
