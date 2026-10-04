export const SHEETS = {
  SETTINGS: 'Settings',
  PROJECTS: 'Projects',
  FORMFIELDS: 'FormFields',
  SESSIONS: 'Sessions',
  TEMPLES: 'Temples',
  PERSONS: 'Persons',
  REGISTRATIONS: 'Registrations',
  KATHIN: 'Kathin',
  DISBURSEMENTS: 'Disbursements',
  MEDIA: 'Media',
  AUDIT: 'AuditLogs',
  ADMINS: 'Admins',
  // Report sheets (aggregated — not raw data)
  RPT_SESSIONS: 'RPT_Sessions',
  RPT_PROVINCES: 'RPT_Provinces',
  RPT_KATHIN: 'RPT_Kathin',
};

export const HEADERS = {
  [SHEETS.SETTINGS]: ['key','value','description'],
  [SHEETS.ADMINS]: ['adminId','username','passwordHash','displayName','role','status','createdAt','updatedAt','lastLoginAt','createdBy'],
  [SHEETS.PROJECTS]: ['projectId','projectName','description','projectType','status','startDate','endDate','publicVisible','registrationOpen','createdAt','updatedAt','createdBy','updatedBy','requireTemple'],
  [SHEETS.FORMFIELDS]: ['fieldId','projectId','fieldKey','label','fieldType','required','visible','sortOrder','placeholder','optionsJson','validationJson','conditionalRuleJson','createdAt','updatedAt'],
  [SHEETS.SESSIONS]: ['sessionId','projectId','sessionLabel','sessionType','startDate','endDate','startTime','endTime','capacity','currentCount','status','allowPublicRegistration','adminOverride','sortOrder','createdAt','updatedAt'],
  [SHEETS.TEMPLES]: ['templeId','templeName','subdistrict','district','province','abbotName','templePhone','source','status','createdAt','updatedAt','abbotPhone'],
  [SHEETS.PERSONS]: ['personId','nationalId','firstName','lastName','prefix','otherPrefix','monasticName','mobile','birthDate','birthDateDisplay','age','ordinationDate','ordinationDateDisplay','address','createdAt','updatedAt'],
  [SHEETS.REGISTRATIONS]: ['registrationId','personId','projectId','sessionId','templeId','registrationGroupId','status','createdBy','registeredAt','updatedAt','updatedBy','additionalData'],
  [SHEETS.KATHIN]: ['kathinId','kathinType','templeId','templeName','subdistrict','district','province','residentMonks','kathinDate','kathinTime','abbotName','abbotPhone','disciple1Name','disciple1Phone','disciple2Name','disciple2Phone','status','description','createdAt','updatedAt','disbursementStatus','updatedBy'],
  [SHEETS.DISBURSEMENTS]: ['disbursementId','documentDate','recipient1Id','recipient1Name','recipient1Phone','recipient2Id','recipient2Name','recipient2Phone','recipient3Id','recipient3Name','recipient3Phone','donorName','totalAmount','totalTemples','templeIds','templeDetailsJson','status','createdAt','updatedAt','createdBy','updatedBy'],
  [SHEETS.MEDIA]: ['imageId','entityType','entityId','fileId','fileUrl','thumbnailUrl','caption','sortOrder','uploadedAt'],
  [SHEETS.AUDIT]: ['timestamp','action','entityType','entityId','adminUser','details'],
  // Report sheet headers
  [SHEETS.RPT_SESSIONS]: ['projectName','sessionLabel','capacity','totalRegistrations','monks','layMen','layWomen','children','cancelled','refreshedAt'],
  [SHEETS.RPT_PROVINCES]: ['province','totalRegistrations','monks','layPeople','uniqueTemples','refreshedAt'],
  [SHEETS.RPT_KATHIN]: ['kathinType','totalWats','approvedWats','pendingWats','cancelledWats','refreshedAt'],
};

export const PROJECT_SEED = [
  ['PRJ-1', 'โครงการอบรมอุบาสกอุบาสิกาแก้ว ปี 2569', 'โครงการฝึกอบรมประจำปี 2569', 'TRAINING', 'OPEN', '2026-09-01', '2026-09-30', 'TRUE', 'TRUE', new Date().toISOString(), new Date().toISOString(), 'SYSTEM', 'SYSTEM']
];

export const SESSION_SEED = [
  ['SES-1','PRJ-1','รุ่นที่ 1','BATCH','2026-09-04','2026-09-06','','','75','0','OPEN','TRUE','FALSE','1',new Date().toISOString(),new Date().toISOString()],
  ['SES-2','PRJ-1','รุ่นที่ 2','BATCH','2026-09-11','2026-09-13','','','75','0','OPEN','TRUE','FALSE','2',new Date().toISOString(),new Date().toISOString()],
  ['SES-3','PRJ-1','รุ่นที่ 3','BATCH','2026-09-18','2026-09-20','','','75','0','OPEN','TRUE','FALSE','3',new Date().toISOString(),new Date().toISOString()]
];

export const SETTINGS_SEED = [
  ['PLATFORM_NAME','แพลตฟอร์มจัดการข้อมูล ธุดงคสถานสุราษฎร์ธานี','ชื่อแพลตฟอร์ม'],
  ['PUBLIC_LIST_ENABLED','TRUE','เปิดหน้าแสดงรายชื่อสาธารณะ'],
  ['MAX_PARTICIPANTS_PER_SUBMISSION','0','0 หมายถึงไม่จำกัดจำนวน']
];
