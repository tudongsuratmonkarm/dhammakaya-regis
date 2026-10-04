import XLSX from 'xlsx';
import { SHEETS } from './lib/constants.mjs';
import { errorResponse, HttpError, requireAdmin } from './lib/http.mjs';
import { getRecords } from './lib/sheets.mjs';
import { netlify } from './lib/adapter.mjs';
export const handler = async event=>{
  try{
    requireAdmin(event);
    if(event.httpMethod!=='GET') throw new HttpError(405,'METHOD_NOT_ALLOWED','รองรับเฉพาะ GET');
    const type = event.queryStringParameters?.type;
    
    const projectId = event.queryStringParameters?.projectId;
    
    let output = [];
    if (type === 'temples') {
      const rows = await getRecords(SHEETS.TEMPLES);
      output = rows.map(({_rowNumber, ...row}) => row);
    } else if (type === 'registrations') {
      const [registrations, persons, sessions, temples, projects] = await Promise.all([
        getRecords(SHEETS.REGISTRATIONS),
        getRecords(SHEETS.PERSONS),
        getRecords(SHEETS.SESSIONS),
        getRecords(SHEETS.TEMPLES),
        getRecords(SHEETS.PROJECTS)
      ]);
      let targetRegs = registrations;
      if (projectId) {
        targetRegs = targetRegs.filter(r => (r.projectId || 'PRJ-1') === projectId);
      }

      const statusMap = {
        'ACTIVE': 'ลงทะเบียน',
        'ATTENDED': 'มาเข้าร่วม',
        'ABSENT': 'ไม่มาเข้าร่วม',
        'CANCELLED': 'ยกเลิก'
      };

      output = targetRegs.map(({_rowNumber, ...reg}, idx) => {
        const person = persons.find(p => p.personId === reg.personId) || {};
        const session = sessions.find(b => b.sessionId === reg.sessionId) || {};
        const temple = temples.find(t => t.templeId === reg.templeId) || {};
        const project = projects.find(p => p.projectId === reg.projectId) || {};
        const attendanceStatus = statusMap[reg.status] || reg.status || 'ลงทะเบียน';
        const operatorName = reg.updatedBy || reg.createdBy || '-';

        return {
          'ลำดับ': idx + 1,
          'รหัสลงทะเบียน': reg.registrationId || '',
          'สถานะการมาเข้าร่วม': attendanceStatus,
          'เจ้าหน้าที่ผู้บันทึก': operatorName,
          'โครงการ': project.projectName || reg.projectId || '',
          'รุ่น/รอบการอบรม': session.sessionLabel || '',
          'วัด': temple.templeName || '',
          'ตำบล': temple.subdistrict || '',
          'อำเภอ': temple.district || '',
          'จังหวัด': temple.province || '',
          'คำนำหน้า': person.prefix || '',
          'ชื่อ': person.firstName || '',
          'นามสกุล': person.lastName || '',
          'ฉายา': person.monasticName || '',
          'เบอร์โทรศัพท์': person.mobile || '',
          'เลขบัตรประชาชน': person.nationalId || '',
          'วันเกิด': person.birthDateDisplay || person.birthDate || '',
          'อายุ': person.age || '',
          'วันที่ลงทะเบียน': reg.registeredAt ? new Date(reg.registeredAt).toLocaleString('th-TH') : '',
          'วันที่แก้ไขล่าสุด': reg.updatedAt ? new Date(reg.updatedAt).toLocaleString('th-TH') : ''
        };
      });
    } else if (type === 'kathin') {
      const rows = await getRecords(SHEETS.KATHIN);
      output = rows.map(({_rowNumber, ...row}) => row);
    } else if (type === 'persons') {
      const rows = await getRecords(SHEETS.PERSONS);
      output = rows.map(({_rowNumber, nationalId, ...row}) => row);
    } else {
      throw new HttpError(400,'INVALID_TYPE','ชนิดข้อมูลไม่ถูกต้อง');
    }
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(output), type.charAt(0).toUpperCase() + type.slice(1));
    const buffer = XLSX.write(workbook, {type:'buffer', bookType:'xlsx'});
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${type}-2569.xlsx"`
      },
      isBase64Encoded: true,
      body: buffer.toString('base64')
    };
  } catch(error) {
    return errorResponse(error);
  }
};
export default netlify(handler);
