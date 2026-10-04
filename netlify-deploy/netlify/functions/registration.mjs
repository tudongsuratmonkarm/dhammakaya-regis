import { ok, errorResponse, HttpError, rateLimit, readJson } from './lib/http.mjs';
import { SHEETS } from './lib/constants.mjs';
import { appendRows, appendProjectRegistrations, batchUpdateRows, getConfigData, getRecords, nextSequence, withLock } from './lib/sheets.mjs';
import { isDuplicate, validateParticipant, validateTemple } from './lib/validation.mjs';
import { netlify } from './lib/adapter.mjs';

function generatePersonId() {
  return `P-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
}

export const handler = async event => { 
  try { 
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะ POST'); 
    rateLimit(event, 'registration', 8, 60_000); 
    
    const body = readJson(event); 
    const sessionId = String(body.sessionId || '').trim(); 
    
    const temple = validateTemple(body.temple); 
    const participants = Array.isArray(body.participants) ? body.participants.map(validateParticipant) : []; 
    
    if (!sessionId || !participants.length) throw new HttpError(400, 'INVALID_REQUEST', 'กรุณาเลือกรุ่นและระบุผู้เข้าร่วมอย่างน้อย 1 คน'); 
    
    const { settings } = await getConfigData(); 
    const max = Number(settings.MAX_PARTICIPANTS_PER_SUBMISSION || 0); 
    if (max > 0 && participants.length > max) throw new HttpError(400, 'TOO_MANY_PARTICIPANTS', `ส่งข้อมูลได้ไม่เกิน ${max} คนต่อครั้ง`);

    return await withLock('registration-write', async () => { 
      const [sessions, registrations, persons] = await Promise.all([
        getRecords(SHEETS.SESSIONS), 
        getRecords(SHEETS.REGISTRATIONS),
        getRecords(SHEETS.PERSONS)
      ]); 
      
      const session = sessions.find(b => String(b.sessionId) === sessionId); 
      const pubRaw = session?.allowPublicRegistration ?? session?.publicVisible ?? 'TRUE';
      const isPublicOpen = String(pubRaw).toUpperCase() === 'TRUE';
      if (!session || session.status !== 'OPEN' || !isPublicOpen) {
        throw new HttpError(400, 'BATCH_CLOSED', 'รุ่นที่เลือกไม่เปิดรับสมัคร'); 
      }
      
      const active = registrations.filter(r => String(r.sessionId) === sessionId && (r.status || 'ACTIVE') === 'ACTIVE'); 
      const capacity = Number(session.capacity || 0); 
      
      if (capacity > 0 && active.length + participants.length > capacity) {
        throw new HttpError(409, 'BATCH_FULL', `ขออภัย ${session.sessionLabel} มีผู้ลงทะเบียนครบตามจำนวนที่รับแล้ว`); 
      }
      
      const activePersonsInBatch = active.map(r => persons.find(p => p.personId === r.personId)).filter(Boolean);
      
      const newPersons = [];
      const personsToUpdate = [];
      const newRegistrations = [];
      const enrichedRegistrations = [];
      const sequence = nextSequence(registrations, 'GRP-2569-'); 
      const groupId = `GRP-2569-${sequence}`; 
      const now = new Date().toISOString(); 
      
      for (const [index, participant] of participants.entries()) { 
        let person = null;

        // 1. If personId provided (e.g. from Person Lookup)
        if (participant.personId) {
          person = persons.find(p => p.personId === participant.personId);
          if (person && participant.useExistingMobile) {
            participant.mobile = person.mobile || '';
          }
        }

        // 2. Duplicate Confidence Matching Strategy
        if (!person && participant.nationalId) {
          const byNid = persons.find(p => p.nationalId === participant.nationalId);
          if (byNid) {
            // High confidence if nationalId matches AND (name matches or existing name is blank)
            if (!byNid.firstName || byNid.firstName === participant.firstName || byNid.lastName === participant.lastName) {
              person = byNid;
              if (participant.useExistingMobile) participant.mobile = person.mobile || '';
            }
          }
        }

        if (!person && participant.firstName && participant.lastName && participant.mobile) {
          person = persons.find(p => 
            p.firstName === participant.firstName && 
            p.lastName === participant.lastName && 
            p.mobile === participant.mobile
          );
        }

        // Check if already registered in this batch
        const isDuplicateInBatch = active.some(r => {
          if (person && r.personId === person.personId) return true;
          return false;
        });

        if (isDuplicateInBatch || isDuplicate(activePersonsInBatch, sessionId, participant)) {
          throw new HttpError(409, 'DUPLICATE_REGISTRATION', `พบข้อมูล ${participant.firstName} ${participant.lastName} ลงทะเบียนในรุ่นนี้แล้ว กรุณาตรวจสอบข้อมูลอีกครั้ง`); 
        }

        if (!person) {
          person = {
            personId: generatePersonId(),
            nationalId: participant.nationalId || '',
            firstName: participant.firstName,
            lastName: participant.lastName,
            prefix: participant.prefix,
            otherPrefix: participant.otherPrefix || '',
            monasticName: participant.monasticName || '',
            mobile: participant.mobile || '',
            birthDate: participant.birthDate || '',
            birthDateDisplay: participant.birthDateDisplay || '',
            age: participant.age || '',
            ordinationDate: participant.ordinationDate || '',
            ordinationDateDisplay: participant.ordinationDateDisplay || '',
            address: participant.address || `${temple.subdistrict || ''} ${temple.district || ''} ${temple.province || ''}`.trim(),
            createdAt: now,
            updatedAt: now
          };
          newPersons.push(person);
          persons.push(person); // Update local cache for next iteration
        } else {
          // Update missing fields without overwriting verified values
          let modified = false;
          if (!person.nationalId && participant.nationalId) { person.nationalId = participant.nationalId; modified = true; }
          if (participant.mobile && person.mobile !== participant.mobile && !participant.useExistingMobile) {
            person.mobile = participant.mobile;
            modified = true;
          }
          if (!person.birthDate && participant.birthDate) { person.birthDate = participant.birthDate; modified = true; }
          if (!person.birthDateDisplay && participant.birthDateDisplay) { person.birthDateDisplay = participant.birthDateDisplay; modified = true; }
          if (!person.age && participant.age) { person.age = participant.age; modified = true; }
          if (participant.address && person.address !== participant.address) {
            person.address = participant.address;
            modified = true;
          } else if (!person.address) {
            person.address = `${temple.subdistrict || ''} ${temple.district || ''} ${temple.province || ''}`.trim();
            modified = true;
          }
          if (modified) {
            person.updatedAt = now;
            if (person._rowNumber && !personsToUpdate.some(u => u.rowNumber === person._rowNumber)) {
              personsToUpdate.push({ rowNumber: person._rowNumber, values: person });
            }
          }
        }

        activePersonsInBatch.push(person);
        
        const coreKeys = ['prefix','otherPrefix','monasticName','firstName','lastName','mobile','nationalId',
          'birthDate','birthDateDisplay','age','ordinationDate','ordinationDateDisplay','phansa','personId','useExistingMobile'];
        const additionalData = Object.fromEntries(
          Object.entries(participant).filter(([k]) => !coreKeys.includes(k))
        );

        const registrationId = `UBK2569-${sequence}-${String(index + 1).padStart(2,'0')}`;
        newRegistrations.push({
          registrationId,
          personId: person.personId,
          projectId: session.projectId,
          sessionId: session.sessionId,
          templeId: temple.templeId || '',
          registrationGroupId: groupId,
          status: 'ACTIVE',
          createdBy: 'public',
          registeredAt: now,
          updatedAt: now,
          updatedBy: 'public',
          additionalData: JSON.stringify(additionalData)
        });

        enrichedRegistrations.push({
          registrationId,
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
          address: participant.address || person.address || '',
          templeName: temple.templeName || '',
          subdistrict: temple.subdistrict || '',
          district: temple.district || '',
          province: temple.province || '',
          coordinatorName: body.coordinatorName || '',
          coordinatorPhone: body.coordinatorPhone || '',
          ...additionalData,
          status: 'ACTIVE',
          registeredAt: now,
          registrationGroupId: groupId,
          personId: person.personId,
          templeId: temple.templeId || '',
          sessionId: session.sessionId
        });
      }
      
      // Save new Persons
      if (newPersons.length > 0) {
        await appendRows(SHEETS.PERSONS, newPersons);
      }

      // Update existing Persons if any fields changed
      if (personsToUpdate.length > 0) {
        await batchUpdateRows(SHEETS.PERSONS, personsToUpdate);
      }

      // If Temple has no templeId, check if it already exists by name, otherwise save it
      if (!temple.templeId) {
        const existingTemple = (allTemples || []).find(t => 
          String(t.templeName || '').trim().toLowerCase() === String(temple.templeName || '').trim().toLowerCase()
        );
        if (existingTemple) {
          temple.templeId = existingTemple.templeId;
        } else {
          const newTempleId = createTempleId();
          temple.templeId = newTempleId;
          await appendRows(SHEETS.TEMPLES, [{
            templeId: newTempleId,
            templeName: temple.templeName,
            subdistrict: temple.subdistrict || '',
            district: temple.district || '',
            province: temple.province || '',
            source: 'USER_ADDED',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now
          }]);
        }
        
        // Update the new registrations with this templeId
        for (const reg of newRegistrations) {
          if (!reg.templeId) reg.templeId = temple.templeId;
        }
        for (const reg of enrichedRegistrations) {
          if (!reg.templeId) reg.templeId = temple.templeId;
        }
      }

      // Save Registrations to both global Registrations and project-specific sheet (Reg_<projectId>)
      if (newRegistrations.length > 0) {
        await appendProjectRegistrations(session.projectId, newRegistrations, enrichedRegistrations);
      }

      return ok({ 
        registrationGroupId: groupId, 
        session: { sessionLabel: session.sessionLabel, displayDate: session.displayDate }, 
        participants 
      }); 
    }); 
  } catch (error) { 
    return errorResponse(error); 
  } 
};
export default netlify(handler);
