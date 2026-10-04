import { audit } from './lib/audit.mjs';
import { SHEETS } from './lib/constants.mjs';
import { errorResponse, HttpError, methodNotAllowed, ok, readJson } from './lib/http.mjs';
import { appendRows, appendProjectRegistrations, updateProjectRegistration, deleteProjectRegistration, getRecords, nextSequence, updateRow, deleteRow, withLock } from './lib/sheets.mjs';
import { isDuplicate, validateParticipant, validateTemple } from './lib/validation.mjs';
import { requireAdmin } from './lib/http.mjs';
import { netlify } from './lib/adapter.mjs';

function participantFromBody(body) { return validateParticipant(body); }

function generatePersonId() {
  return `P-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}

function sanitizeRegistrationStatus(status) {
  const s = String(status || '').trim().toUpperCase();
  if (['ATTENDED', 'มาเข้าร่วม', 'เข้าร่วมแล้ว'].includes(s)) return 'ATTENDED';
  if (['ABSENT', 'ไม่มาเข้าร่วม', 'ไม่มา', 'ขาด'].includes(s)) return 'ABSENT';
  if (['CANCELLED', 'ยกเลิก'].includes(s)) return 'CANCELLED';
  return 'ACTIVE';
}

export const handler = async event => { 
  try { 
    const admin = requireAdmin(event); 
    if(!['POST','PUT','DELETE'].includes(event.httpMethod)) return methodNotAllowed(); 
    
    const body = readJson(event); 
    
    if (event.httpMethod === 'DELETE') { 
      if(!body.registrationId) throw new HttpError(400,'INVALID_REQUEST','ไม่พบรหัสผู้สมัคร'); 
      const rows = await getRecords(SHEETS.REGISTRATIONS); 
      const old = rows.find(r => r.registrationId === body.registrationId); 
      if(!old) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูลผู้สมัคร'); 
      
      await deleteRow(SHEETS.REGISTRATIONS, old._rowNumber); 
      if (old.projectId) {
        await deleteProjectRegistration(old.projectId, old.registrationId);
      }
      await audit('DELETE','REGISTRATION', old.registrationId, admin.u, {groupId: old.registrationGroupId}); 
      return ok({deleted: true}); 
    }

    // Quick status update (does not require full participant re-validation)
    if (event.httpMethod === 'PUT' && (body.action === 'update_status' || (!body.firstName && !body.lastName && body.status))) {
      if (!body.registrationId) throw new HttpError(400, 'INVALID_REQUEST', 'ไม่พบรหัสผู้สมัคร');
      const registrations = await getRecords(SHEETS.REGISTRATIONS);
      const oldReg = registrations.find(r => r.registrationId === body.registrationId);
      if (!oldReg) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลผู้สมัคร');

      const newStatus = sanitizeRegistrationStatus(body.status);
      const now = new Date().toISOString();
      const adminModifier = admin.name || admin.u;
      const updatedReg = {
        ...oldReg,
        status: newStatus,
        updatedAt: now,
        updatedBy: adminModifier
      };

      await updateRow(SHEETS.REGISTRATIONS, oldReg._rowNumber, updatedReg);
      if (oldReg.projectId) {
        await updateProjectRegistration(oldReg.projectId, oldReg.registrationId, {
          status: newStatus,
          updatedBy: adminModifier,
          updatedAt: now
        });
      }
      await audit('UPDATE_STATUS', 'REGISTRATION', oldReg.registrationId, adminModifier, {
        from: oldReg.status,
        to: newStatus,
        updatedBy: adminModifier
      });
      return ok({ registration: updatedReg });
    }

    const sessionId = String(body.sessionId || '').trim(); 
    const temple = validateTemple(body); 
    const personInput = participantFromBody(body); 
    
    const sessions = await getRecords(SHEETS.SESSIONS); 
    const session = sessions.find(b => String(b.sessionId) === sessionId); 
    if(!session) throw new HttpError(400,'INVALID_BATCH','ไม่พบรุ่นอบรม'); 
    
    if (event.httpMethod === 'POST') {
      return await withLock('registration-write', async () => { 
        const [registrations, persons] = await Promise.all([
          getRecords(SHEETS.REGISTRATIONS),
          getRecords(SHEETS.PERSONS)
        ]);
        
        // Find existing person or check duplicates
        const activePersonsInBatch = registrations
          .filter(r => r.sessionId === sessionId && r.status !== 'CANCELLED')
          .map(r => persons.find(p => p.personId === r.personId))
          .filter(Boolean);

        if(isDuplicate(activePersonsInBatch, sessionId, personInput) && body.allowDuplicate !== 'true') {
          throw new HttpError(409,'DUPLICATE_REGISTRATION','พบข้อมูลซ้ำในรุ่นนี้'); 
        }

        let person = null;
        if (body.personId) {
          person = persons.find(p => p.personId === String(body.personId).trim());
        }
        if (!person) {
          person = persons.find(p => 
            (personInput.nationalId && p.nationalId === personInput.nationalId) ||
            (p.firstName === personInput.firstName && p.lastName === personInput.lastName && p.mobile === personInput.mobile)
          );
        }

        let isNewPerson = false;
        const now = new Date().toISOString(); 

        if (!person) {
          isNewPerson = true;
          person = {
            personId: generatePersonId(),
            nationalId: personInput.nationalId || '',
            firstName: personInput.firstName,
            lastName: personInput.lastName,
            prefix: personInput.prefix,
            otherPrefix: personInput.otherPrefix || '',
            monasticName: personInput.monasticName || '',
            mobile: personInput.mobile,
            birthDate: personInput.birthDate || '',
            address: `${temple.subdistrict || ''} ${temple.district || ''} ${temple.province || ''}`.trim(),
            createdAt: now,
            updatedAt: now
          };
        } else {
          let updated = false;
          if (!person.nationalId && personInput.nationalId) {
            person.nationalId = personInput.nationalId;
            updated = true;
          }
          if (!person.birthDate && personInput.birthDate) {
            person.birthDate = personInput.birthDate;
            updated = true;
          }
          if (!person.address && (personInput.address || temple.province)) {
            person.address = personInput.address || `${temple.subdistrict || ''} ${temple.district || ''} ${temple.province || ''}`.trim();
            updated = true;
          }
          if (updated && person._rowNumber) {
            person.updatedAt = now;
            await updateRow(SHEETS.PERSONS, person._rowNumber, person);
          }
        }

        const seq = nextSequence(registrations, 'GRP-2569-'); 
        
        const row = {
          registrationId: `UBK2569-${seq}-01`,
          personId: person.personId,
          projectId: session.projectId || 'PRJ-1',
          sessionId: session.sessionId,
          templeId: temple.templeId || '',
          registrationGroupId: `GRP-2569-${seq}`,
          status: 'ACTIVE',
          createdBy: admin.u,
          registeredAt: now,
          updatedAt: now,
          updatedBy: admin.u
        }; 

        if (isNewPerson) {
          await appendRows(SHEETS.PERSONS, [person]);
        }

        const enrichedRow = {
          registrationId: row.registrationId,
          sessionLabel: session.sessionLabel || '',
          prefix: person.prefix || '',
          firstName: person.firstName || '',
          lastName: person.lastName || '',
          monasticName: person.monasticName || '',
          mobile: person.mobile || '',
          nationalId: person.nationalId || '',
          birthDate: person.birthDate || '',
          age: person.age || '',
          ordinationDate: person.ordinationDate || '',
          phansa: person.phansa || '',
          address: personInput.address || person.address || '',
          templeName: temple.templeName || '',
          subdistrict: temple.subdistrict || '',
          district: temple.district || '',
          province: temple.province || '',
          coordinatorName: body.coordinatorName || '',
          coordinatorPhone: body.coordinatorPhone || '',
          status: 'ACTIVE',
          registeredAt: now,
          registrationGroupId: row.registrationGroupId,
          personId: person.personId,
          templeId: temple.templeId || '',
          sessionId: session.sessionId
        };
        await appendProjectRegistrations(row.projectId, [row], [enrichedRow]);
        
        await audit('ADMIN_OVERRIDE', 'REGISTRATION', row.registrationId, admin.u, {sessionId, capacity: session.capacity});
        return ok({registration: {...row, ...person}}); 
      });
    }
    
    // PUT (Update)
    if(!body.registrationId) throw new HttpError(400,'INVALID_REQUEST','ไม่พบรหัสผู้สมัคร'); 
    
    const [registrations, persons] = await Promise.all([
      getRecords(SHEETS.REGISTRATIONS),
      getRecords(SHEETS.PERSONS)
    ]);
    
    const oldReg = registrations.find(r => r.registrationId === body.registrationId);
    if(!oldReg) throw new HttpError(404,'NOT_FOUND','ไม่พบข้อมูลผู้สมัคร'); 

    const oldPerson = persons.find(p => p.personId === oldReg.personId);
    if (!oldPerson) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบข้อมูลบุคคล');

    // Duplicate check for others in session
    const othersInBatch = registrations
      .filter(r => r.sessionId === sessionId && r.registrationId !== oldReg.registrationId && r.status !== 'CANCELLED')
      .map(r => persons.find(p => p.personId === r.personId))
      .filter(Boolean);

    if (isDuplicate(othersInBatch, sessionId, personInput) && body.allowDuplicate !== 'true') {
      throw new HttpError(409,'DUPLICATE_REGISTRATION','พบข้อมูลซ้ำในรุ่นนี้');
    }

    const now = new Date().toISOString(); 
    
    const updatedPerson = {
      ...oldPerson,
      prefix: personInput.prefix,
      otherPrefix: personInput.otherPrefix,
      monasticName: personInput.monasticName,
      firstName: personInput.firstName,
      lastName: personInput.lastName,
      mobile: personInput.mobile,
      nationalId: personInput.nationalId,
      birthDate: personInput.birthDate,
      address: personInput.address || oldPerson.address,
      updatedAt: now
    };

    const newStatus = sanitizeRegistrationStatus(body.status);
    const adminModifier = admin.name || admin.u;
    const updatedReg = {
      ...oldReg,
      sessionId: session.sessionId,
      templeId: temple.templeId || oldReg.templeId,
      status: newStatus,
      updatedAt: now,
      updatedBy: adminModifier
    }; 
    
    // Update both sheets
    await updateRow(SHEETS.PERSONS, oldPerson._rowNumber, updatedPerson);
    await updateRow(SHEETS.REGISTRATIONS, oldReg._rowNumber, updatedReg);

    // Sync to project registration sheet
    const enrichedUpdated = {
      sessionLabel: session.sessionLabel || '',
      prefix: updatedPerson.prefix || '',
      firstName: updatedPerson.firstName || '',
      lastName: updatedPerson.lastName || '',
      monasticName: updatedPerson.monasticName || '',
      mobile: updatedPerson.mobile || '',
      nationalId: updatedPerson.nationalId || '',
      birthDate: updatedPerson.birthDate || '',
      age: updatedPerson.age || '',
      address: updatedPerson.address || '',
      templeName: temple.templeName || '',
      subdistrict: temple.subdistrict || '',
      district: temple.district || '',
      province: temple.province || '',
      status: newStatus,
      updatedBy: adminModifier,
      updatedAt: now,
      sessionId: session.sessionId,
      templeId: temple.templeId || oldReg.templeId
    };
    await updateProjectRegistration(oldReg.projectId || session.projectId, oldReg.registrationId, enrichedUpdated);
    
    await audit(oldReg.sessionId !== sessionId ? 'MOVE_BATCH' : 'UPDATE', 'REGISTRATION', oldReg.registrationId, adminModifier, {
      from: oldReg.sessionId,
      to: sessionId,
      fromStatus: oldReg.status,
      toStatus: newStatus,
      updatedBy: adminModifier
    });
    return ok({registration: {...updatedReg, ...updatedPerson}});
    
  } catch(error) {
    return errorResponse(error);
  } 
};
export default netlify(handler);
