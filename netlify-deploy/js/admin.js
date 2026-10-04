const api = async (path, options = {}, retries = 2) => {
  try {
    const response = await fetch(`/api/${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({ success: false, error: { message: 'ไม่สามารถอ่านข้อมูลจากระบบได้' } }));
    if (!response.ok || !body.success) {
      const isQuota = response.status === 429 || /quota|rate limit|resource_exhausted/i.test(body.error?.message || '');
      if (isQuota && retries > 0) {
        await new Promise(r => setTimeout(r, 1500));
        return await api(path, options, retries - 1);
      }
      if (isQuota) {
        console.warn('Google Sheets API Quota handled seamlessly, serving cached state.');
        return data;
      }
      throw new Error(body.error?.message || 'เกิดข้อผิดพลาด');
    }
    return body.data;
  } catch (err) {
    if (/quota|rate limit|resource_exhausted/i.test(err?.message || '')) {
      console.warn('Quota suppressed for admin, using local state.');
      return data;
    }
    throw err;
  }
};
const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)]; const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
let data = { sessions: [], registrations: [], temples: [], persons: [], dashboard: {}, admins: [], currentAdmin: null }, modal, publicListModal, templeProfileModal, personProfileModal, editContext = null, pendingImport = null;
let adminKathinViewMode = window.innerWidth < 768 ? 'cards' : 'table';
let adminRegViewMode = window.innerWidth < 768 ? 'cards' : 'table';
let adminTempleViewMode = window.innerWidth < 768 ? 'cards' : 'table';
let adminPersonViewMode = window.innerWidth < 768 ? 'cards' : 'table';
let dashState = {
  selectedProjectId: '',
  selectedSessionId: '',
  templeTableSearch: ''
};
let adminRegStatusFilter = '';

const REG_STATUS_CONFIG = {
  ACTIVE: { label: 'ลงทะเบียน', badgeClass: 'badge bg-success-subtle text-success border border-success-subtle', icon: '🟢' },
  ATTENDED: { label: 'มาเข้าร่วม', badgeClass: 'badge bg-primary-subtle text-primary border border-primary-subtle', icon: '🔵' },
  ABSENT: { label: 'ไม่มาเข้าร่วม', badgeClass: 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle', icon: '🟠' },
  CANCELLED: { label: 'ยกเลิก', badgeClass: 'badge bg-secondary-subtle text-secondary border border-secondary-subtle', icon: '⚪' }
};

function getRegStatusMeta(status) {
  const s = String(status || 'ACTIVE').trim().toUpperCase();
  if (['ATTENDED', 'มาเข้าร่วม', 'เข้าร่วมแล้ว'].includes(s)) return { key: 'ATTENDED', ...REG_STATUS_CONFIG.ATTENDED };
  if (['ABSENT', 'ไม่มาเข้าร่วม', 'ไม่มา', 'ขาด'].includes(s)) return { key: 'ABSENT', ...REG_STATUS_CONFIG.ABSENT };
  if (['CANCELLED', 'ยกเลิก'].includes(s)) return { key: 'CANCELLED', ...REG_STATUS_CONFIG.CANCELLED };
  return { key: 'ACTIVE', ...REG_STATUS_CONFIG.ACTIVE };
}

function formatShortDateTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = (d.getFullYear() + 543).toString().slice(-2);
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day}/${m}/${y} ${time} น.`;
  } catch {
    return isoStr;
  }
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = d.getDate();
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const m = months[d.getMonth()] || '';
    const y = d.getFullYear() + 543;
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${m} ${y} เวลา ${time} น.`;
  } catch {
    return isoStr;
  }
}

function renderStatusDropdownHtml(r) {
  const meta = getRegStatusMeta(r.status);
  const changerInfo = r.updatedBy ? `
    <div class="mt-1 small text-muted text-nowrap" style="font-size: 0.72rem; line-height: 1.25;" title="ผู้แก้ไขล่าสุด: ${esc(r.updatedBy)} เมื่อ ${esc(formatDateTime(r.updatedAt))}">
      <span class="text-secondary fw-semibold">👤 ${esc(r.updatedBy)}</span><br>
      <span class="opacity-75">${esc(formatShortDateTime(r.updatedAt))}</span>
    </div>
  ` : '';

  return `
    <div class="d-inline-flex flex-column align-items-start">
      <div class="dropdown d-inline-block">
        <button class="btn btn-xs dropdown-toggle py-1 px-2 ${meta.badgeClass} d-inline-flex align-items-center gap-1 shadow-xs fw-semibold" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="คลิกเพื่อเปลี่ยนสถานะ">
          <span>${meta.icon}</span> <span>${meta.label}</span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end shadow-sm small py-1" style="z-index: 1055;">
          <li><h6 class="dropdown-header small py-1 text-muted fw-bold">เลือกสถานะผู้สมัคร:</h6></li>
          <li><button type="button" class="dropdown-item py-1 d-flex align-items-center gap-2 ${meta.key==='ACTIVE'?'active fw-bold':''} btn-quick-status" data-id="${esc(r.registrationId)}" data-status="ACTIVE"><span>🟢</span> <span>ลงทะเบียน</span></button></li>
          <li><button type="button" class="dropdown-item py-1 d-flex align-items-center gap-2 ${meta.key==='ATTENDED'?'active fw-bold':''} btn-quick-status" data-id="${esc(r.registrationId)}" data-status="ATTENDED"><span>🔵</span> <span>มาเข้าร่วม</span></button></li>
          <li><button type="button" class="dropdown-item py-1 d-flex align-items-center gap-2 ${meta.key==='ABSENT'?'active fw-bold':''} btn-quick-status" data-id="${esc(r.registrationId)}" data-status="ABSENT"><span>🟠</span> <span>ไม่มาเข้าร่วม</span></button></li>
          <li><hr class="dropdown-divider my-1"></li>
          <li><button type="button" class="dropdown-item py-1 text-danger d-flex align-items-center gap-2 ${meta.key==='CANCELLED'?'active fw-bold':''} btn-quick-status" data-id="${esc(r.registrationId)}" data-status="CANCELLED"><span>⚪</span> <span>ยกเลิก</span></button></li>
        </ul>
      </div>
      ${changerInfo}
    </div>
  `;
}

async function quickChangeRegistrationStatus(registrationId, newStatus) {
  const statusMeta = getRegStatusMeta(newStatus);
  try {
    const res = await api('admin-registration', {
      method: 'PUT',
      body: JSON.stringify({ action: 'update_status', registrationId, status: newStatus })
    });
    const target = (data.registrations || []).find(r => r.registrationId === registrationId);
    if (target) {
      target.status = newStatus;
      target.updatedBy = res.registration?.updatedBy || 'admin';
      target.updatedAt = res.registration?.updatedAt || new Date().toISOString();
    }
    toast(`เปลี่ยนสถานะเป็น "${statusMeta.label}" เรียบร้อยแล้ว`, 'success');
    renderRegistrations();
  } catch(e) {
    alertUser(e.message || 'ไม่สามารถเปลี่ยนสถานะได้');
  }
}

function toast(msg, type='success') { const el=document.createElement('div'); el.className=`alert alert-${type} position-fixed bottom-0 end-0 m-3 shadow`; el.style.zIndex=9999; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),3500); }
function req(url,opts={}) { return fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts}).then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error?.message||'เกิดข้อผิดพลาด');return b;}); }
function alertUser(message, type='danger') {
  if (/quota|rate limit|resource_exhausted|โควต้า/i.test(String(message || ''))) {
    console.warn('Suppressed quota alert for admin:', message);
    return;
  }
  $('#admin-alert').innerHTML = `<div class="alert alert-${type} alert-dismissible fade show">${esc(message)}<button class="btn-close" data-bs-dismiss="alert"></button></div>`;
  window.scrollTo({top:0,behavior:'smooth'});
}
function field(label, name, value='', type='text', required=false) { return `<div class="mb-3"><label class="form-label">${label}${required?' <span class="text-danger">*</span>':''}</label><input class="form-control" type="${type}" name="${name}" value="${esc(value)}" ${required?'required':''}></div>`; }
function select(label, name, value, options) { return `<div class="mb-3"><label class="form-label">${label}</label><select class="form-select" name="${name}">${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`; }
function showModal(title, body, context) { editContext=context; $('#modal-title').textContent=title; $('#modal-body').innerHTML=body; $('#modal-body').scrollTop=0; modal.show(); }

function openTempleProfile(templeId = '', templeName = '') {
  const norm = str => (str || '').trim().toLowerCase();
  const tNorm = norm(templeName);
  
  let temple = (data.temples || []).find(t => (templeId && t.templeId === templeId) || (tNorm && norm(t.templeName) === tNorm));
  if (!temple) {
    const regMatch = (data.registrations || []).find(r => norm(r.templeName) === tNorm || (templeId && r.templeId === templeId));
    temple = {
      templeId: templeId || regMatch?.templeId || 'TPL-TEMP',
      templeName: templeName || regMatch?.templeName || 'ไม่ระบุชื่อวัด',
      province: regMatch?.province || '',
      district: regMatch?.district || '',
      subdistrict: regMatch?.subdistrict || '',
      abbotName: '-',
      abbotPhone: '-',
      status: 'ACTIVE'
    };
  }

  const tName = temple.templeName;
  const tId = temple.templeId;
  const relatedRegs = (data.registrations || []).filter(r => {
    if ((r.status || 'ACTIVE').toUpperCase() === 'CANCELLED') return false;
    if (tId && r.templeId && r.templeId === tId) return true;
    if (tName && norm(r.templeName) === norm(tName)) return true;
    return false;
  });

  $('#temple-profile-name').textContent = temple.templeName || 'ข้อมูลวัด';
  const locParts = [temple.subdistrict ? `ต.${temple.subdistrict}` : '', temple.district ? `อ.${temple.district}` : '', temple.province ? `จ.${temple.province}` : ''].filter(Boolean).join(' ');
  $('#temple-profile-location').textContent = locParts || 'ไม่ระบุที่ตั้ง';
  $('#temple-profile-abbot').textContent = temple.abbotName || temple.abbot || '-';
  $('#temple-profile-phone').textContent = temple.abbotPhone || temple.templePhone || temple.phone || '-';
  $('#temple-profile-id').textContent = temple.templeId || '-';
  $('#temple-profile-status').innerHTML = `<span class="badge bg-${temple.status === 'INACTIVE' ? 'secondary' : 'success'}">${esc(temple.status || 'ACTIVE')}</span>`;

  const projectMap = new Map();
  relatedRegs.forEach(r => {
    const pId = r.projectId || 'PRJ-1';
    const pObj = (data.projects || []).find(p => p.projectId === pId);
    const pName = pObj?.projectName || r.projectName || pId;
    if (!projectMap.has(pId)) {
      projectMap.set(pId, { projectName: pName, count: 0, sessions: new Set() });
    }
    const item = projectMap.get(pId);
    item.count++;
    if (r.sessionLabel) item.sessions.add(r.sessionLabel);
  });

  const projRows = Array.from(projectMap.values());
  $('#temple-profile-project-breakdown').innerHTML = projRows.length ? projRows.map(p => `
    <tr>
      <td><strong>${esc(p.projectName)}</strong></td>
      <td class="text-center fw-bold text-primary">${p.count} คน</td>
      <td class="text-center small text-muted">${Array.from(p.sessions).map(esc).join(', ') || '-'}</td>
    </tr>
  `).join('') : '<tr><td colspan="3" class="text-center text-muted py-2">ไม่มีประวัติการส่งผู้เข้าร่วมในโครงการ</td></tr>';

  $('#temple-profile-total-count').textContent = `${relatedRegs.length} คน`;
  $('#temple-profile-people-count').textContent = relatedRegs.length;

  $('#temple-profile-people-tbody').innerHTML = relatedRegs.length ? relatedRegs.map(r => `
    <tr class="dash-temple-tr" onclick="openPersonProfile('${esc(r.personId || '')}', '${esc(r.firstName || '')} ${esc(r.lastName || '')}')">
      <td>
        <strong>${esc([r.prefix, r.monasticName, r.firstName, r.lastName].filter(Boolean).join(' '))}</strong>
        <br><small class="text-muted font-monospace">${esc(r.registrationId || '')}</small>
      </td>
      <td><span class="badge bg-light text-dark border">${esc(r.projectName || r.projectId || '-')}</span></td>
      <td>${esc(r.sessionLabel || '-')}</td>
      <td><small>${esc(r.mobile || '-')}</small></td>
      <td class="text-center">
        <button class="btn btn-xs btn-outline-info py-0 px-2 small" type="button">โปรไฟล์ →</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">ยังไม่มีรายชื่อบุคคลที่ลงทะเบียน</td></tr>';

  const editBtn = $('#temple-profile-edit-master-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      templeProfileModal?.hide();
      editTemple(temple.templeId);
    };
  }

  if (templeProfileModal) templeProfileModal.show();
}

function openPersonProfile(personId = '', fullName = '') {
  const norm = str => (str || '').trim().toLowerCase();
  const fNorm = norm(fullName);

  let person = (data.persons || []).find(p => (personId && p.personId === personId) || (fNorm && norm(`${p.firstName} ${p.lastName}`) === fNorm));
  if (!person) {
    const regMatch = (data.registrations || []).find(r => (personId && r.personId === personId) || (fNorm && norm(`${r.firstName} ${r.lastName}`) === fNorm));
    if (regMatch) {
      person = {
        personId: regMatch.personId || personId || 'PER-TEMP',
        prefix: regMatch.prefix || '',
        monasticName: regMatch.monasticName || '',
        firstName: regMatch.firstName || '',
        lastName: regMatch.lastName || '',
        mobile: regMatch.mobile || '',
        nationalId: regMatch.nationalId || '',
        birthDate: regMatch.birthDate || '',
        ordinationDate: regMatch.ordinationDate || '',
        phansa: regMatch.phansa || '',
        templeName: regMatch.templeName || '',
        templeId: regMatch.templeId || '',
        address: regMatch.address || '',
        status: regMatch.status || 'ACTIVE'
      };
    } else {
      person = {
        personId: personId || 'PER-UNKNOWN',
        prefix: '',
        monasticName: '',
        firstName: fullName || 'ไม่ระบุชื่อ',
        lastName: '',
        mobile: '-',
        nationalId: '',
        status: 'ACTIVE'
      };
    }
  }

  const pFullName = [person.prefix, person.monasticName, person.firstName, person.lastName].filter(Boolean).join(' ');
  $('#person-profile-fullname').textContent = pFullName || 'ข้อมูลบุคคล';
  $('#person-profile-id-tag').textContent = `รหัสบุคคล: ${person.personId || '-'}`;

  $('#person-profile-prefix').textContent = person.prefix || '-';
  $('#person-profile-monastic').textContent = person.monasticName || '-';
  $('#person-profile-mobile').textContent = person.mobile || '-';
  $('#person-profile-national-id').textContent = person.nationalId || '-';

  const thaiDate = d => {
    if (!d) return '-';
    try {
      const parts = String(d).split(/[-/]/);
      if (parts.length === 3) {
        let [y, m, day] = parts;
        if (y.length === 4) return `${+day}/${m}/${+y > 2400 ? +y : +y + 543}`;
        return `${parts[0]}/${parts[1]}/${parts[2]}`;
      }
      return d;
    } catch { return d; }
  };

  const birthText = person.birthDate ? `${thaiDate(person.birthDate)} ${person.age ? `(อายุ ${person.age} ปี)` : ''}` : '-';
  $('#person-profile-birth').textContent = birthText;

  const ordText = person.ordinationDate ? `${thaiDate(person.ordinationDate)} ${person.phansa ? `(${person.phansa} พรรษา)` : ''}` : (person.prefix === 'พระ' ? 'ไม่ได้ระบุวันบวช' : '-');
  $('#person-profile-ordination').textContent = ordText;

  $('#person-profile-temple').textContent = person.templeName || '-';
  $('#person-profile-status').innerHTML = `<span class="badge bg-${person.status === 'INACTIVE' ? 'secondary' : 'success'}">${esc(person.status || 'ACTIVE')}</span>`;
  $('#person-profile-address').textContent = person.address || '-';

  const historyRegs = (data.registrations || []).filter(r => {
    if (person.personId && r.personId && r.personId === person.personId) return true;
    if (person.mobile && r.mobile && r.mobile === person.mobile) return true;
    if (norm(`${r.firstName} ${r.lastName}`) === norm(`${person.firstName} ${person.lastName}`)) return true;
    return false;
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  $('#person-profile-history-tbody').innerHTML = historyRegs.length ? historyRegs.map(r => {
    const pObj = (data.projects || []).find(p => p.projectId === r.projectId);
    const pName = pObj?.projectName || r.projectName || r.projectId || '-';
    const cDate = r.createdAt ? thaiDate(r.createdAt.split('T')[0]) : '-';
    const isCancelled = (r.status || '').toUpperCase() === 'CANCELLED';
    return `
      <tr>
        <td><small class="text-muted font-monospace">${esc(cDate)}</small></td>
        <td><strong>${esc(pName)}</strong></td>
        <td><span class="badge bg-light text-dark border">${esc(r.sessionLabel || '-')}</span></td>
        <td><span class="cursor-pointer text-primary" onclick="openTempleProfile('${esc(r.templeId || '')}', '${esc(r.templeName || '')}')">${esc(r.templeName || '-')}</span></td>
        <td><span class="badge bg-${isCancelled ? 'danger' : 'success'}">${esc(r.status || 'ACTIVE')}</span></td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">ยังไม่มีประวัติการลงทะเบียนในระบบ</td></tr>';

  const editBtn = $('#person-profile-edit-master-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      personProfileModal?.hide();
      editPerson(person.personId);
    };
  }

  if (personProfileModal) personProfileModal.show();
}

window.openTempleProfile = openTempleProfile;
window.openPersonProfile = openPersonProfile;

function renderDashboard() {
  if (!$('#dash-kpis')) return;

  const allProjects = data.projects || [];
  const allSessions = data.sessions || [];
  const allRegs = data.registrations || [];
  const allTemples = data.temples || [];

  // Update Project Filter dropdown
  const projSel = $('#dash-project-filter');
  if (projSel) {
    const curVal = dashState.selectedProjectId;
    projSel.innerHTML = [
      { value: '', label: 'ทุกโครงการ (ภาพรวมทั้งหมด)' },
      ...allProjects.map(p => ({ value: p.projectId, label: p.projectName }))
    ].map(o => `<option value="${esc(o.value)}" ${o.value === curVal ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    projSel.onchange = () => {
      dashState.selectedProjectId = projSel.value;
      dashState.selectedSessionId = '';
      renderDashboard();
    };
  }

  const activeProjects = allProjects.filter(p => (p.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  let activeRegs = allRegs.filter(r => (r.status || 'ACTIVE').toUpperCase() !== 'CANCELLED');
  if (dashState.selectedProjectId) {
    activeRegs = activeRegs.filter(r => (r.projectId || 'PRJ-1') === dashState.selectedProjectId);
  }

  let projectSessions = allSessions;
  if (dashState.selectedProjectId) {
    projectSessions = projectSessions.filter(s => (s.projectId || 'PRJ-1') === dashState.selectedProjectId);
  }

  const openProjectsCount = activeProjects.length;
  const totalApplicants = activeRegs.length;

  const todayIso = new Date().toISOString().split('T')[0];
  const todayCount = activeRegs.filter(r => String(r.createdAt || '').startsWith(todayIso)).length;

  const templeNamesSet = new Set(activeRegs.map(r => (r.templeName || '').trim()).filter(Boolean));
  const uniqueTemplesCount = templeNamesSet.size;

  let fullSessionsCount = 0;
  let nearFullSessionsCount = 0;
  projectSessions.forEach(s => {
    const sRegs = allRegs.filter(r => (r.sessionId === s.sessionId || r.sessionLabel === s.sessionLabel) && (r.status || 'ACTIVE').toUpperCase() !== 'CANCELLED');
    const cap = Number(s.capacity) || 0;
    if (cap > 0) {
      if (sRegs.length >= cap) fullSessionsCount++;
      else if (sRegs.length / cap >= 0.8) nearFullSessionsCount++;
    }
  });

  const projectRegCounts = {};
  allRegs.forEach(r => {
    if ((r.status || 'ACTIVE').toUpperCase() === 'CANCELLED') return;
    const pid = r.projectId || 'PRJ-1';
    projectRegCounts[pid] = (projectRegCounts[pid] || 0) + 1;
  });
  let topProjId = '';
  let topProjCount = 0;
  for (const [pid, cnt] of Object.entries(projectRegCounts)) {
    if (cnt > topProjCount) {
      topProjCount = cnt;
      topProjId = pid;
    }
  }
  const topProjObj = allProjects.find(p => p.projectId === topProjId);
  const topProjectName = topProjObj ? topProjObj.projectName : (allProjects[0]?.projectName || 'ไม่มีข้อมูล');

  const templeRegCounts = {};
  activeRegs.forEach(r => {
    const t = (r.templeName || '').trim();
    if (!t) return;
    templeRegCounts[t] = (templeRegCounts[t] || 0) + 1;
  });
  let topTempleName = '-';
  let topTempleCount = 0;
  for (const [tname, cnt] of Object.entries(templeRegCounts)) {
    if (cnt > topTempleCount) {
      topTempleCount = cnt;
      topTempleName = tname;
    }
  }

  // Render Top KPI Cards
  $('#dash-kpis').innerHTML = `
    <div class="col-6 col-md-4 col-xl-2">
      <div class="dash-kpi-card">
        <div class="small text-muted mb-1">📁 โครงการเปิดรับ</div>
        <div class="h3 fw-bold text-navy mb-0">${openProjectsCount} <span class="fs-6 fw-normal text-muted">โครงการ</span></div>
        <small class="text-success">สถานะ: เปิดรับสมัคร</small>
      </div>
    </div>
    <div class="col-6 col-md-4 col-xl-2">
      <div class="dash-kpi-card">
        <div class="small text-muted mb-1">👥 ผู้สมัครทั้งหมด</div>
        <div class="h3 fw-bold text-primary mb-0">${totalApplicants} <span class="fs-6 fw-normal text-muted">คน</span></div>
        <small class="text-secondary">วันนี้: <strong class="text-success">+${todayCount} คน</strong></small>
      </div>
    </div>
    <div class="col-6 col-md-4 col-xl-2">
      <div class="dash-kpi-card">
        <div class="small text-muted mb-1">🏛️ วัดที่เข้าร่วม</div>
        <div class="h3 fw-bold text-navy mb-0">${uniqueTemplesCount} <span class="fs-6 fw-normal text-muted">วัด</span></div>
        <small class="text-muted">ส่งผู้เข้าร่วมโครงการ</small>
      </div>
    </div>
    <div class="col-6 col-md-4 col-xl-2">
      <div class="dash-kpi-card">
        <div class="small text-muted mb-1">⚠️ สถานะรอบ/รุ่น</div>
        <div class="h4 fw-bold mb-0 ${fullSessionsCount > 0 ? 'text-danger' : 'text-success'}">
          ${fullSessionsCount > 0 ? `เต็ม ${fullSessionsCount} รุ่น` : 'ยังไม่เต็ม'}
        </div>
        <small class="text-muted">${nearFullSessionsCount > 0 ? `ใกล้เต็ม ${nearFullSessionsCount} รุ่น` : 'ความจุปกติ'}</small>
      </div>
    </div>
    <div class="col-6 col-md-4 col-xl-2">
      <div class="dash-kpi-card">
        <div class="small text-muted mb-1">🏆 โครงการยอดนิยม</div>
        <div class="fw-bold text-truncate text-navy" title="${esc(topProjectName)}">${esc(topProjectName)}</div>
        <small class="text-primary font-monospace">${topProjCount} คนสมัคร</small>
      </div>
    </div>
    <div class="col-6 col-md-4 col-xl-2">
      <div class="dash-kpi-card">
        <div class="small text-muted mb-1">🥇 วัดที่ส่งคนมากสุด</div>
        <div class="fw-bold text-truncate text-navy cursor-pointer" onclick="openTempleProfile('', '${esc(topTempleName)}')" title="${esc(topTempleName)}">
          ${esc(topTempleName)}
        </div>
        <small class="text-primary font-monospace">${topTempleCount} คน</small>
      </div>
    </div>
  `;

  // Left Column: Sessions List with Capacity & Drilldown
  const sessionSubheading = $('#dash-session-subheading');
  const resetSessionBtn = $('#dash-reset-session-filter');

  if (dashState.selectedSessionId) {
    const selSessionObj = projectSessions.find(s => s.sessionId === dashState.selectedSessionId);
    if (sessionSubheading) sessionSubheading.innerHTML = `<span class="badge bg-primary text-white">กำลังเจาะลึก: ${esc(selSessionObj?.sessionLabel || dashState.selectedSessionId)}</span>`;
    if (resetSessionBtn) {
      resetSessionBtn.classList.remove('d-none');
      resetSessionBtn.onclick = () => {
        dashState.selectedSessionId = '';
        renderDashboard();
      };
    }
  } else {
    if (sessionSubheading) sessionSubheading.textContent = 'คลิกที่รุ่นเพื่อดูรายชื่อวัดที่ส่งคนมา';
    if (resetSessionBtn) resetSessionBtn.classList.add('d-none');
  }

  $('#dash-sessions-list').innerHTML = projectSessions.length ? projectSessions.map(s => {
    const isSelected = dashState.selectedSessionId === s.sessionId;
    const sRegs = allRegs.filter(r => (r.sessionId === s.sessionId || r.sessionLabel === s.sessionLabel) && (r.status || 'ACTIVE').toUpperCase() !== 'CANCELLED');
    const count = sRegs.length;
    const cap = Number(s.capacity) || 0;
    const pct = cap > 0 ? Math.min(100, Math.round((count / cap) * 100)) : 0;
    const sTemplesCount = new Set(sRegs.map(r => (r.templeName || '').trim()).filter(Boolean)).size;

    let statusBadge = '<span class="badge bg-success-subtle text-success border border-success-subtle">🟢 เปิดรับ</span>';
    let progressBg = 'bg-success';
    if (cap > 0 && count >= cap) {
      statusBadge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">🔴 เต็มแล้ว</span>';
      progressBg = 'bg-danger';
    } else if (cap > 0 && pct >= 80) {
      statusBadge = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">🟠 ใกล้เต็ม (${pct}%)</span>`;
      progressBg = 'bg-warning';
    }

    return `
      <div class="dash-session-item mb-2 ${isSelected ? 'selected' : ''}" data-sess-id="${esc(s.sessionId)}">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <strong class="text-navy">${esc(s.sessionLabel)}</strong>
          ${statusBadge}
        </div>
        <div class="d-flex justify-content-between align-items-center small text-muted mb-1">
          <span>ความจุ: <strong class="text-navy font-monospace">${count} / ${cap || '∞'} คน</strong></span>
          <span>${pct}%</span>
        </div>
        <div class="progress mb-2" style="height: 6px;">
          <div class="progress-bar ${progressBg}" role="progressbar" style="width: ${pct}%"></div>
        </div>
        <div class="d-flex justify-content-between align-items-center small">
          <span class="text-secondary">🏛️ วัดที่ส่งคนมา: <strong>${sTemplesCount} วัด</strong></span>
          <small class="text-primary">${isSelected ? '✓ แสดงผลอยู่' : 'คลิกเพื่อเจาะลึก →'}</small>
        </div>
      </div>
    `;
  }).join('') : '<p class="text-muted p-3 text-center mb-0">ไม่มีข้อมูลรอบ/รุ่น</p>';

  $$('#dash-sessions-list .dash-session-item').forEach(el => {
    el.onclick = () => {
      const sid = el.dataset.sessId;
      if (dashState.selectedSessionId === sid) {
        dashState.selectedSessionId = '';
      } else {
        dashState.selectedSessionId = sid;
      }
      renderDashboard();
    };
  });

  // Right Column: Temples Breakdown
  let regsForTemples = activeRegs;
  let templeSectionTitle = '🏛️ วัดที่ส่งผู้เข้าร่วม';
  if (dashState.selectedSessionId) {
    const selSessionObj = projectSessions.find(s => s.sessionId === dashState.selectedSessionId);
    regsForTemples = allRegs.filter(r => (r.sessionId === dashState.selectedSessionId || r.sessionLabel === selSessionObj?.sessionLabel) && (r.status || 'ACTIVE').toUpperCase() !== 'CANCELLED');
    templeSectionTitle = `🏛️ วัดที่ส่งผู้เข้าร่วม (${esc(selSessionObj?.sessionLabel || 'รุ่นที่เลือก')})`;
  } else if (dashState.selectedProjectId) {
    const curP = allProjects.find(p => p.projectId === dashState.selectedProjectId);
    templeSectionTitle = `🏛️ วัดที่ส่งผู้เข้าร่วม (${esc(curP?.projectName || 'โครงการที่เลือก')})`;
  }
  $('#dash-temple-section-title').textContent = templeSectionTitle;

  const templeMap = new Map();
  regsForTemples.forEach(r => {
    const tName = (r.templeName || 'ไม่ระบุชื่อวัด').trim();
    if (!templeMap.has(tName)) {
      const tMaster = allTemples.find(t => t.templeName === tName || (r.templeId && t.templeId === r.templeId));
      templeMap.set(tName, {
        templeName: tName,
        templeId: r.templeId || tMaster?.templeId || '',
        province: tMaster?.province || r.province || '',
        district: tMaster?.district || r.district || '',
        subdistrict: tMaster?.subdistrict || r.subdistrict || '',
        count: 0,
        monks: 0,
        lay: 0
      });
    }
    const t = templeMap.get(tName);
    t.count++;
    if ((r.prefix || '').includes('พระ')) t.monks++;
    else t.lay++;
  });

  let templeList = Array.from(templeMap.values()).sort((a, b) => b.count - a.count);

  const tableSearchInput = $('#dash-temple-table-search');
  if (tableSearchInput) {
    tableSearchInput.oninput = e => {
      dashState.templeTableSearch = e.target.value.trim().toLowerCase();
      renderDashTempleTable(templeList);
    };
  }

  $('#dash-temple-count-badge').textContent = `${templeList.length} วัด`;
  renderDashTempleTable(templeList);

  // Demographics Breakdown
  const totalR = activeRegs.length;
  let monks = 0, layMen = 0, layWomen = 0, children = 0;
  activeRegs.forEach(r => {
    const pfx = (r.prefix || '').trim();
    if (pfx === 'พระ' || (r.monasticName && r.monasticName.trim())) monks++;
    else if (pfx === 'นาย') layMen++;
    else if (pfx === 'นาง' || pfx === 'นางสาว') layWomen++;
    else if (pfx === 'ด.ช.' || pfx === 'ด.ญ.' || pfx === 'เด็กชาย' || pfx === 'เด็กหญิง') children++;
    else layMen++;
  });

  const pct = (n, tot) => tot > 0 ? Math.round((n / tot) * 100) : 0;
  $('#dash-demographics-body').innerHTML = `
    <div class="row g-2 text-center mb-3">
      <div class="col-6 col-sm-3">
        <div class="p-2 border rounded bg-warning-subtle text-dark">
          <small class="d-block text-muted">พระภิกษุ</small>
          <strong class="h5 mb-0">${monks}</strong> <small>คน</small>
          <div class="small fw-semibold text-warning-emphasis">${pct(monks, totalR)}%</div>
        </div>
      </div>
      <div class="col-6 col-sm-3">
        <div class="p-2 border rounded bg-primary-subtle text-dark">
          <small class="d-block text-muted">อุบาสก (ชาย)</small>
          <strong class="h5 mb-0">${layMen}</strong> <small>คน</small>
          <div class="small fw-semibold text-primary">${pct(layMen, totalR)}%</div>
        </div>
      </div>
      <div class="col-6 col-sm-3">
        <div class="p-2 border rounded bg-info-subtle text-dark">
          <small class="d-block text-muted">อุบาสิกา (หญิง)</small>
          <strong class="h5 mb-0">${layWomen}</strong> <small>คน</small>
          <div class="small fw-semibold text-info-emphasis">${pct(layWomen, totalR)}%</div>
        </div>
      </div>
      <div class="col-6 col-sm-3">
        <div class="p-2 border rounded bg-light text-dark">
          <small class="d-block text-muted">เยาวชน</small>
          <strong class="h5 mb-0">${children}</strong> <small>คน</small>
          <div class="small fw-semibold text-secondary">${pct(children, totalR)}%</div>
        </div>
      </div>
    </div>
    <div class="progress" style="height: 12px;">
      <div class="progress-bar bg-warning" style="width: ${pct(monks, totalR)}%" title="พระภิกษุ ${monks} คน"></div>
      <div class="progress-bar bg-primary" style="width: ${pct(layMen, totalR)}%" title="อุบาสก ${layMen} คน"></div>
      <div class="progress-bar bg-info" style="width: ${pct(layWomen, totalR)}%" title="อุบาสิกา ${layWomen} คน"></div>
      <div class="progress-bar bg-secondary" style="width: ${pct(children, totalR)}%" title="เยาวชน ${children} คน"></div>
    </div>
  `;

  // Province Breakdown
  const provMap = new Map();
  activeRegs.forEach(r => {
    let prv = r.province;
    if (!prv) {
      const tm = allTemples.find(t => t.templeName === r.templeName || (r.templeId && t.templeId === r.templeId));
      prv = tm?.province;
    }
    prv = (prv || 'ไม่ระบุจังหวัด').trim();
    if (!provMap.has(prv)) {
      provMap.set(prv, { province: prv, total: 0, monks: 0, lay: 0, temples: new Set() });
    }
    const item = provMap.get(prv);
    item.total++;
    if ((r.prefix || '').includes('พระ')) item.monks++;
    else item.lay++;
    if (r.templeName) item.temples.add(r.templeName);
  });

  const provList = Array.from(provMap.values()).sort((a, b) => b.total - a.total);
  $('#dash-provinces-count').textContent = `รวม ${provList.length} จังหวัด`;
  $('#dash-provinces-tbody').innerHTML = provList.length ? provList.map(p => `
    <tr>
      <td><strong>${esc(p.province)}</strong></td>
      <td class="text-center fw-bold text-navy font-monospace">${p.total}</td>
      <td class="text-center text-warning font-monospace">${p.monks}</td>
      <td class="text-center font-monospace">${p.lay}</td>
      <td class="text-center text-muted font-monospace">${p.temples.size}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="text-center text-muted py-2">ไม่มีข้อมูลจังหวัด</td></tr>';

  // Kathin Summary Card
  const allKathin = data.kathin || [];
  const saenCount = allKathin.filter(k => (k.kathinType || '').includes('แสน')).length;
  const muenCount = allKathin.filter(k => (k.kathinType || '').includes('หมื่น')).length;
  const approvedCount = allKathin.filter(k => (k.status || 'APPROVED').toUpperCase() === 'APPROVED').length;

  $('#dash-kathin-summary').innerHTML = `
    <div class="col-6 col-md-3">
      <div class="p-2 border rounded bg-light text-center">
        <div class="small text-muted">วัดกฐินทั้งหมด</div>
        <strong class="h4 text-navy">${allKathin.length}</strong> <small>วัด</small>
      </div>
    </div>
    <div class="col-6 col-md-3">
      <div class="p-2 border rounded bg-warning-subtle text-center">
        <div class="small text-muted">🌟 กฐินแสน</div>
        <strong class="h4 text-warning-emphasis">${saenCount}</strong> <small>วัด</small>
      </div>
    </div>
    <div class="col-6 col-md-3">
      <div class="p-2 border rounded bg-info-subtle text-center">
        <div class="small text-muted">🎆 กฐินหมื่น</div>
        <strong class="h4 text-info-emphasis">${muenCount}</strong> <small>วัด</small>
      </div>
    </div>
    <div class="col-6 col-md-3">
      <div class="p-2 border rounded bg-success-subtle text-center">
        <div class="small text-muted">✅ สถานะพร้อมจัดงาน</div>
        <strong class="h4 text-success">${approvedCount}</strong> <small>วัด</small>
      </div>
    </div>
  `;
}

function renderDashTempleTable(templeList) {
  const tbody = $('#dash-temple-tbody');
  if (!tbody) return;

  const search = dashState.templeTableSearch;
  const filtered = search ? templeList.filter(t => 
    t.templeName.toLowerCase().includes(search) || 
    (t.province || '').toLowerCase().includes(search) ||
    (t.district || '').toLowerCase().includes(search)
  ) : templeList;

  tbody.innerHTML = filtered.length ? filtered.map((t, idx) => {
    const locParts = [t.district ? `อ.${t.district}` : '', t.province ? `จ.${t.province}` : ''].filter(Boolean).join(' ');
    return `
      <tr class="dash-temple-tr" onclick="openTempleProfile('${esc(t.templeId)}', '${esc(t.templeName)}')">
        <td class="text-center text-muted small">${idx + 1}</td>
        <td>
          <strong class="text-navy">${esc(t.templeName)}</strong>
          ${locParts ? `<br><small class="text-muted">${esc(locParts)}</small>` : ''}
        </td>
        <td class="text-center">
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 fs-6">${t.count}</span>
        </td>
        <td class="text-center small text-secondary">
          พระ <strong class="text-warning-emphasis">${t.monks}</strong> · ฆราวาส <strong class="text-navy">${t.lay}</strong>
        </td>
        <td class="text-center">
          <button class="btn btn-xs btn-outline-primary py-0 px-2 small" type="button">ดูวัด →</button>
        </td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">ไม่พบข้อมูลวัดตามเงื่อนไขที่เลือก</td></tr>';
}

function setupQuickSearchListeners() {
  const personInput = $('#dash-person-search-input');
  const personDropdown = $('#dash-person-autocomplete');
  if (personInput && personDropdown) {
    personInput.oninput = () => {
      const q = personInput.value.trim().toLowerCase();
      if (!q) {
        personDropdown.classList.add('d-none');
        return;
      }
      const allPersons = data.persons || [];
      const allRegs = data.registrations || [];

      const matches = [];
      const seen = new Set();

      allPersons.forEach(p => {
        const full = `${p.prefix || ''} ${p.monasticName || ''} ${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
        if (full.includes(q) || (p.mobile && p.mobile.includes(q))) {
          matches.push({ id: p.personId, name: [p.prefix, p.monasticName, p.firstName, p.lastName].filter(Boolean).join(' '), mobile: p.mobile, temple: p.templeName });
          seen.add(p.personId);
        }
      });

      allRegs.forEach(r => {
        if (r.personId && seen.has(r.personId)) return;
        const full = `${r.prefix || ''} ${r.monasticName || ''} ${r.firstName || ''} ${r.lastName || ''}`.toLowerCase();
        if (full.includes(q) || (r.mobile && r.mobile.includes(q))) {
          matches.push({ id: r.personId, name: [r.prefix, r.monasticName, r.firstName, r.lastName].filter(Boolean).join(' '), mobile: r.mobile, temple: r.templeName });
          if (r.personId) seen.add(r.personId);
        }
      });

      if (matches.length) {
        personDropdown.innerHTML = matches.slice(0, 8).map(m => `
          <button type="button" class="suggestion" onpointerdown="event.preventDefault();" onclick="openPersonProfile('${esc(m.id || '')}', '${esc(m.name)}'); $('#dash-person-autocomplete').classList.add('d-none'); $('#dash-person-search-input').value='';">
            <strong>${esc(m.name)}</strong>
            <small>📱 ${esc(m.mobile || '-')} ${m.temple ? `· 🏛️ ${esc(m.temple)}` : ''}</small>
          </button>
        `).join('');
        personDropdown.classList.remove('d-none');
      } else {
        personDropdown.innerHTML = '<div class="p-2 text-muted small">ไม่พบบุคคลที่ตรงกับคำค้นหา</div>';
        personDropdown.classList.remove('d-none');
      }
    };

    document.addEventListener('click', e => {
      if (!personInput.contains(e.target) && !personDropdown.contains(e.target)) {
        personDropdown.classList.add('d-none');
      }
    });
  }

  const templeInput = $('#dash-temple-search-input');
  const templeDropdown = $('#dash-temple-autocomplete');
  if (templeInput && templeDropdown) {
    templeInput.oninput = () => {
      const q = templeInput.value.trim().toLowerCase();
      if (!q) {
        templeDropdown.classList.add('d-none');
        return;
      }
      const allTemples = data.temples || [];
      const matches = allTemples.filter(t => 
        (t.templeName || '').toLowerCase().includes(q) ||
        (t.province || '').toLowerCase().includes(q) ||
        (t.district || '').toLowerCase().includes(q) ||
        (t.abbotName || '').toLowerCase().includes(q)
      );

      if (matches.length) {
        templeDropdown.innerHTML = matches.slice(0, 8).map(t => `
          <button type="button" class="suggestion" onpointerdown="event.preventDefault();" onclick="openTempleProfile('${esc(t.templeId)}', '${esc(t.templeName)}'); $('#dash-temple-autocomplete').classList.add('d-none'); $('#dash-temple-search-input').value='';">
            <strong>${esc(t.templeName)}</strong>
            <small>${esc([t.district ? `อ.${t.district}` : '', t.province ? `จ.${t.province}` : ''].filter(Boolean).join(' '))}</small>
          </button>
        `).join('');
        templeDropdown.classList.remove('d-none');
      } else {
        templeDropdown.innerHTML = '<div class="p-2 text-muted small">ไม่พบวัดที่ตรงกับคำค้นหา</div>';
        templeDropdown.classList.remove('d-none');
      }
    };

    document.addEventListener('click', e => {
      if (!templeInput.contains(e.target) && !templeDropdown.contains(e.target)) {
        templeDropdown.classList.add('d-none');
      }
    });
  }
}
function renderRegistrations() {
  const projSel = $('#registration-project-filter');
  if (projSel) {
    const curVal = projSel.value;
    const opts = [{ value: '', label: 'ทุกโครงการ (ทั้งหมด)' }, ...(data.projects || []).map(p => ({ value: p.projectId, label: p.projectName }))];
    projSel.innerHTML = opts.map(o => `<option value="${esc(o.value)}" ${o.value === curVal ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }
  const projFilter = projSel?.value || '';

  // Update public list status badge next to filter
  const statusBadge = $('#reg-project-public-status');
  if (statusBadge) {
    if (projFilter) {
      const currProj = (data.projects || []).find(p => p.projectId === projFilter);
      if (currProj) {
        const isPub = String(currProj.publicVisible ?? currProj.publicListVisible ?? 'TRUE').toUpperCase() !== 'FALSE';
        statusBadge.className = `badge ${isPub ? 'bg-success' : 'bg-secondary'} ms-2 py-1 px-2`;
        statusBadge.style.cursor = 'pointer';
        statusBadge.title = 'คลิกเพื่อสลับสถานะการแสดงผลในหน้าสาธารณะ';
        statusBadge.innerHTML = isPub ? '🌐 หน้าสาธารณะ: เปิดแสดง (คลิกเพื่อสลับ)' : '🔒 หน้าสาธารณะ: ซ่อน (คลิกเพื่อสลับ)';
        statusBadge.onclick = () => toggleProjectPublicVisibility(currProj.projectId, isPub ? 'FALSE' : 'TRUE');
      } else {
        statusBadge.className = 'd-none';
      }
    } else {
      statusBadge.className = 'd-none';
    }
  }

  // Update view mode toggle buttons
  const btnCards = $('#btn-reg-view-cards');
  const btnTable = $('#btn-reg-view-table');
  if (btnCards && btnTable) {
    btnCards.classList.toggle('active', adminRegViewMode === 'cards');
    btnCards.classList.toggle('btn-primary', adminRegViewMode === 'cards');
    btnCards.classList.toggle('btn-outline-primary', adminRegViewMode !== 'cards');

    btnTable.classList.toggle('active', adminRegViewMode === 'table');
    btnTable.classList.toggle('btn-primary', adminRegViewMode === 'table');
    btnTable.classList.toggle('btn-outline-primary', adminRegViewMode !== 'table');

    btnCards.onclick = () => { adminRegViewMode = 'cards'; renderRegistrations(); };
    btnTable.onclick = () => { adminRegViewMode = 'table'; renderRegistrations(); };
  }

  const allInProj = (data.registrations || []).filter(r => !projFilter || (r.projectId || 'PRJ-1') === projFilter);
  const countAll = allInProj.length;
  const countActive = allInProj.filter(r => getRegStatusMeta(r.status).key === 'ACTIVE').length;
  const countAttended = allInProj.filter(r => getRegStatusMeta(r.status).key === 'ATTENDED').length;
  const countAbsent = allInProj.filter(r => getRegStatusMeta(r.status).key === 'ABSENT').length;
  const countCancelled = allInProj.filter(r => getRegStatusMeta(r.status).key === 'CANCELLED').length;

  if ($('#reg-count-all')) $('#reg-count-all').textContent = countAll;
  if ($('#reg-count-active')) $('#reg-count-active').textContent = countActive;
  if ($('#reg-count-attended')) $('#reg-count-attended').textContent = countAttended;
  if ($('#reg-count-absent')) $('#reg-count-absent').textContent = countAbsent;
  if ($('#reg-count-cancelled')) $('#reg-count-cancelled').textContent = countCancelled;

  // Update active state on status filter buttons
  $$('.reg-status-filter-btn').forEach(btn => {
    const btnStatus = btn.dataset.status || '';
    btn.classList.toggle('active', btnStatus === adminRegStatusFilter);
    btn.onclick = () => {
      adminRegStatusFilter = btnStatus;
      renderRegistrations();
    };
  });

  const q = ($('#registration-search')?.value || '').trim().toLowerCase();
  const rows = allInProj.filter(r => {
    if (adminRegStatusFilter && getRegStatusMeta(r.status).key !== adminRegStatusFilter) return false;
    if (q && !`${r.prefix} ${r.firstName} ${r.lastName} ${r.templeName} ${r.sessionLabel} ${r.mobile} ${r.registrationId} ${r.updatedBy || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const filteredCountEl = $('#reg-filtered-count-text');
  if (filteredCountEl) {
    filteredCountEl.textContent = `แสดง ${rows.length} จาก ${countAll} คน`;
  }

  const tableContainer = $('#registration-table');
  if (!rows.length) {
    tableContainer.innerHTML = '<p class="text-muted p-3 text-center mb-0">ไม่พบข้อมูลผู้สมัครที่ตรงกับเงื่อนไข</p>';
    return;
  }

  if (adminRegViewMode === 'cards') {
    tableContainer.innerHTML = `
      <div class="row g-2">
        ${rows.map(r => `
          <div class="col-12 col-md-6 col-xl-4">
            <div class="mobile-data-card">
              <div class="mobile-card-header align-items-start">
                <div>
                  <h4 class="mobile-card-title">${esc(`${r.prefix} ${r.firstName} ${r.lastName}`)}</h4>
                  <small class="text-muted font-monospace">${esc(r.registrationId)}</small>
                </div>
                <div class="text-end">
                  ${renderStatusDropdownHtml(r)}
                </div>
              </div>
              <div class="mobile-card-row">
                <span class="mobile-card-label">โครงการ:</span>
                <span class="mobile-card-val"><span class="badge bg-light text-dark border">${esc(r.projectName || r.projectId || '-')}</span></span>
              </div>
              <div class="mobile-card-row">
                <span class="mobile-card-label">รอบ / รุ่น:</span>
                <span class="mobile-card-val fw-semibold text-navy">${esc(r.sessionLabel || '-')}</span>
              </div>
              <div class="mobile-card-row">
                <span class="mobile-card-label">สังกัดวัด:</span>
                <span class="mobile-card-val">${esc(r.templeName || '-')}</span>
              </div>
              <div class="mobile-card-row">
                <span class="mobile-card-label">เบอร์มือถือ:</span>
                <span class="mobile-card-val">${r.mobile ? `<a href="tel:${esc(r.mobile)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none">📱 ${esc(r.mobile)}</a>` : '-'}</span>
              </div>
              <div class="mobile-card-actions">
                <button class="btn btn-sm btn-outline-primary edit-registration" data-id="${esc(r.registrationId)}">✏️ แก้ไข</button>
                <button class="btn btn-sm btn-outline-danger delete-registration" data-id="${esc(r.registrationId)}">🗑️ ลบ</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    tableContainer.innerHTML = `
      <div class="table-responsive">
        <table class="table table-hover align-middle small">
          <thead class="table-light">
            <tr><th>ชื่อ</th><th>โครงการ</th><th>รุ่น</th><th>วัด</th><th>มือถือ</th><th>สถานะ / ผู้แก้ไข</th><th class="text-end">จัดการ</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(`${r.prefix} ${r.firstName} ${r.lastName}`)}</strong><br><small class="text-muted font-monospace">${esc(r.registrationId)}</small></td>
                <td><span class="badge bg-light text-dark border">${esc(r.projectName || r.projectId || '-')}</span></td>
                <td>${esc(r.sessionLabel)}</td>
                <td>${esc(r.templeName)}</td>
                <td>${r.mobile ? `<a href="tel:${esc(r.mobile)}" class="text-decoration-none">${esc(r.mobile)}</a>` : '-'}</td>
                <td>${renderStatusDropdownHtml(r)}</td>
                <td class="text-nowrap text-end">
                  <button class="btn btn-xs btn-outline-primary edit-registration" data-id="${esc(r.registrationId)}">แก้ไข</button>
                  <button class="btn btn-xs btn-outline-danger delete-registration" data-id="${esc(r.registrationId)}">ลบ</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  $$('.btn-quick-status').forEach(b => {
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      quickChangeRegistrationStatus(b.dataset.id, b.dataset.status);
    };
  });
  $$('.edit-registration').forEach(b => b.onclick = () => editRegistration(b.dataset.id));
  $$('.delete-registration').forEach(b => b.onclick = () => deleteRegistration(b.dataset.id));
}
function renderSessions() {
  const container = $('#session-editor');
  if (!container) return;

  const projSel = $('#session-project-filter');
  if (projSel) {
    const curVal = projSel.value;
    const opts = [{ value: '', label: 'ทุกโครงการ (ทั้งหมด)' }, ...(data.projects || []).map(p => ({ value: p.projectId, label: p.projectName }))];
    projSel.innerHTML = opts.map(o => `<option value="${esc(o.value)}" ${o.value === curVal ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }

  const projFilter = projSel?.value || '';
  const typeFilter = $('#session-type-filter')?.value || '';

  const sessions = (data.sessions || []).filter(s => {
    if (projFilter && s.projectId !== projFilter) return false;
    if (typeFilter && (s.sessionType || 'BATCH') !== typeFilter) return false;
    return true;
  }).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  if ($('#session-count-text')) {
    $('#session-count-text').textContent = `แสดง ${sessions.length} รายการ`;
  }

  const typeMeta = {
    BATCH: { label: 'รุ่น (Batch)', color: 'primary', icon: '🎓' },
    ROUND: { label: 'รอบ (Round)', color: 'info text-dark', icon: '⏱️' },
    VEHICLE: { label: 'รถ/คัน (Vehicle)', color: 'warning text-dark', icon: '🚐' },
    GROUP: { label: 'กลุ่ม (Group)', color: 'success', icon: '👥' },
    TRIP: { label: 'เที่ยว (Trip)', color: 'secondary', icon: '🧭' },
    OTHER: { label: 'อื่น ๆ', color: 'dark', icon: '📌' },
  };

  if (!sessions.length) {
    container.innerHTML = `<div class="p-4 text-center bg-light rounded border text-muted">
      <p class="mb-2">ไม่พบรอบ/รุ่น (Session) ตามเงื่อนไขที่เลือก</p>
      <button class="btn btn-outline-primary btn-sm" id="empty-add-session">+ สร้าง Session ใหม่</button>
    </div>`;
    const btn = $('#empty-add-session');
    if (btn) btn.onclick = () => editSession(null);
    return;
  }

  container.innerHTML = sessions.map(s => {
    const p = (data.projects || []).find(x => x.projectId === s.projectId);
    const tm = typeMeta[s.sessionType || 'BATCH'] || typeMeta.OTHER;
    const isPublic = String(s.allowPublicRegistration ?? s.publicVisible ?? 'TRUE').toLowerCase() !== 'false';
    const isOpen = (s.status || 'OPEN') === 'OPEN';
    const regCount = s.currentCount || s.count || 0;
    const capText = Number(s.capacity) > 0 ? `${regCount} / ${s.capacity} คน` : `${regCount} คน (ไม่จำกัด)`;

    const dateStr = s.startDate ? `${s.startDate}${s.endDate ? ` ถึง ${s.endDate}` : ''}` : 'ไม่ระบุวัน';
    const timeStr = s.startTime ? `${s.startTime}${s.endTime ? ` - ${s.endTime}` : ''}` : '';

    return `<article class="border rounded-3 p-3 mb-3 shadow-sm bg-white">
      <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
        <div>
          <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
            <span class="badge bg-${tm.color}">${tm.icon} ${tm.label}</span>
            <strong class="h6 mb-0 text-navy">${esc(s.sessionLabel)}</strong>
            <span class="badge ${isOpen ? 'bg-success' : 'bg-danger'}">${isOpen ? 'เปิดรับสมัคร' : 'ปิดรับสมัคร'}</span>
            ${isPublic ? '<span class="badge bg-light text-secondary border">🌐 แสดงสาธารณะ</span>' : '<span class="badge bg-secondary">🔒 เฉพาะแอดมิน</span>'}
          </div>
          <div class="text-muted small">
            ${p ? `📁 <strong>${esc(p.projectName)}</strong> · ` : ''}
            📅 ${esc(dateStr)} ${timeStr ? `⏰ ${esc(timeStr)}` : ''} · 👥 ${esc(capText)}
          </div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-primary btn-sm edit-session" data-id="${esc(s.sessionId)}">✏️ แก้ไข</button>
          <button class="btn btn-outline-danger btn-sm delete-session" data-id="${esc(s.sessionId)}" data-label="${esc(s.sessionLabel)}">🗑️ ลบ</button>
        </div>
      </div>
    </article>`;
  }).join('');

  $$('.edit-session', container).forEach(b => b.onclick = () => editSession(b.dataset.id));
  $$('.delete-session', container).forEach(b => b.onclick = () => deleteSession(b.dataset.id, b.dataset.label));
}

async function deleteSession(id, label) {
  const regCount = (data.registrations || []).filter(r => r.sessionId === id).length;
  let warn = '';
  if (regCount > 0) {
    warn = `\n\n⚠️ คำเตือน: มีผู้สมัครในรายการนี้แล้ว ${regCount} คน`;
  }
  if (!confirm(`ยืนยันการลบ "${label}" หรือไม่?${warn}\n(หากลบแล้ว ประชาชนจะไม่สามารถเลือกลงทะเบียนในรายการนี้ได้อีก)`)) return;
  try {
    modal?.hide();
    await api('admin-data', {
      method: 'DELETE',
      body: JSON.stringify({ entity: 'session', sessionId: id })
    });
    alertUser(`ลบ "${label}" เรียบร้อยแล้ว`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message);
  }
}

let selectedTempleIds = new Set();
let templeSortField = 'name';
let templeSortDir = 'asc';

function compareTempleRecords(a, b, field, dir) {
  let res = 0;
  if (field === 'index') {
    res = (a._origIdx ?? 0) - (b._origIdx ?? 0);
  } else if (field === 'name') {
    res = (a.templeName || '').localeCompare(b.templeName || '', 'th');
  } else if (field === 'address') {
    const da = `${a.province || ''} ${a.district || ''} ${a.subdistrict || ''}`;
    const db = `${b.province || ''} ${b.district || ''} ${b.subdistrict || ''}`;
    res = da.localeCompare(db, 'th');
  } else if (field === 'abbot') {
    const aa = `${a.abbotName || a.abbot || ''} ${a.abbotPhone || ''} ${a.templePhone || ''}`;
    const ab = `${b.abbotName || b.abbot || ''} ${b.abbotPhone || ''} ${b.templePhone || ''}`;
    res = aa.localeCompare(ab, 'th');
  } else if (field === 'status') {
    res = (a.status || 'ACTIVE').localeCompare(b.status || 'ACTIVE', 'th');
  } else {
    res = (a.templeName || '').localeCompare(b.templeName || '', 'th');
  }
  return dir === 'desc' ? -res : res;
}

function updateTempleSelectionUI() {
  const count = selectedTempleIds.size;
  const topBtn = $('#btn-delete-selected-temples');
  const bar = $('#temple-bulk-bar');
  const countEl = $('#selected-temple-count');
  const barCountEl = $('#selected-temple-count-bar');
  const selectAllBox = $('#temple-select-all');

  if (countEl) countEl.textContent = count;
  if (barCountEl) barCountEl.textContent = count;

  if (count > 0) {
    if (topBtn) topBtn.classList.remove('d-none');
    if (bar) bar.classList.remove('d-none');
  } else {
    if (topBtn) topBtn.classList.add('d-none');
    if (bar) bar.classList.add('d-none');
  }

  if (selectAllBox && data.temples && data.temples.length > 0) {
    const visibleIds = data.temples.map(t => t.templeId);
    const allChecked = visibleIds.length > 0 && visibleIds.every(id => selectedTempleIds.has(id));
    const someChecked = visibleIds.some(id => selectedTempleIds.has(id));
    selectAllBox.checked = allChecked;
    selectAllBox.indeterminate = !allChecked && someChecked;
  }
}

function renderTemples() {
  // Update view mode toggle buttons
  const btnCards = $('#btn-temple-view-cards');
  const btnTable = $('#btn-temple-view-table');
  if (btnCards && btnTable) {
    btnCards.classList.toggle('active', adminTempleViewMode === 'cards');
    btnCards.classList.toggle('btn-primary', adminTempleViewMode === 'cards');
    btnCards.classList.toggle('btn-outline-primary', adminTempleViewMode !== 'cards');

    btnTable.classList.toggle('active', adminTempleViewMode === 'table');
    btnTable.classList.toggle('btn-primary', adminTempleViewMode === 'table');
    btnTable.classList.toggle('btn-outline-primary', adminTempleViewMode !== 'table');

    btnCards.onclick = () => { adminTempleViewMode = 'cards'; renderTemples(); };
    btnTable.onclick = () => { adminTempleViewMode = 'table'; renderTemples(); };
  }

  const allTemples = (data.temples || []).map((t, idx) => ({ ...t, _origIdx: idx + 1 }));
  const rows = [...allTemples].sort((a, b) => compareTempleRecords(a, b, templeSortField, templeSortDir));

  const tableContainer = $('#temple-table');
  if (!rows.length) {
    tableContainer.innerHTML = '<p class="text-muted p-3 text-center mb-0">ไม่พบข้อมูลวัด</p>';
    return;
  }

  if (adminTempleViewMode === 'cards') {
    tableContainer.innerHTML = `
      <div class="row g-2">
        ${rows.map((t, idx) => {
          const abbot = t.abbotName || t.abbot || '-';
          const abbotPhone = t.abbotPhone || '';
          const phone = t.templePhone || t.phone || '';
          const isChecked = selectedTempleIds.has(t.templeId) ? 'checked' : '';
          const isActive = (t.status || 'ACTIVE') === 'ACTIVE';
          return `
            <div class="col-12 col-md-6 col-xl-4">
              <div class="mobile-data-card ${isChecked ? 'selected' : ''}">
                <div class="mobile-card-header">
                  <div class="d-flex align-items-center gap-2">
                    <input type="checkbox" class="form-check-input temple-item-check" data-id="${esc(t.templeId)}" ${isChecked}>
                    <span class="badge bg-secondary-subtle text-secondary small">#${idx + 1}</span>
                    <h4 class="mobile-card-title text-primary">${esc(t.templeName)}</h4>
                  </div>
                  <div><span class="badge ${isActive ? 'bg-success' : 'bg-secondary'}">${esc(t.status || 'ACTIVE')}</span></div>
                </div>
                ${t.imageUrl ? `<div class="mb-2 text-center"><a href="${esc(t.imageUrl)}" target="_blank" rel="noopener" title="คลิกดูรูปขนาดเต็ม"><img src="${esc(t.imageUrl)}" alt="รูปวัด" style="max-height: 140px; max-width: 100%; border-radius: 6px; object-fit: cover;" onerror="this.remove()"></a></div>` : ''}
                <div class="mobile-card-row">
                  <span class="mobile-card-label">ที่ตั้ง:</span>
                  <span class="mobile-card-val">ต.${esc(t.subdistrict || '-')} อ.${esc(t.district || '-')} จ.${esc(t.province || '-')}</span>
                </div>
                <div class="mobile-card-row">
                  <span class="mobile-card-label">เจ้าอาวาส:</span>
                  <span class="mobile-card-val">
                    ☸ <strong>${esc(abbot)}</strong>
                    ${abbotPhone ? `<br><a href="tel:${esc(abbotPhone)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none mt-1">📱 ${esc(abbotPhone)}</a>` : ''}
                  </span>
                </div>
                ${phone && phone !== abbotPhone ? `
                <div class="mobile-card-row">
                  <span class="mobile-card-label">เบอร์วัด:</span>
                  <span class="mobile-card-val"><a href="tel:${esc(phone)}" class="text-decoration-none">📞 ${esc(phone)}</a></span>
                </div>` : ''}
                <div class="mobile-card-actions">
                  <button class="btn btn-sm btn-outline-primary edit-temple" data-id="${esc(t.templeId)}">✏️ แก้ไข</button>
                  <button class="btn btn-sm btn-outline-danger delete-temple ms-1" data-id="${esc(t.templeId)}">🗑️ ลบ</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    const sortIcon = f => {
      if (templeSortField === f) {
        return templeSortDir === 'asc' ? ' <span class="text-primary fw-bold">▲</span>' : ' <span class="text-primary fw-bold">▼</span>';
      }
      return ' <span class="text-muted small opacity-50">↕</span>';
    };

    tableContainer.innerHTML = `
      <div class="table-responsive">
        <table class="table table-hover align-middle small">
          <thead class="table-light border-bottom">
            <tr>
              <th style="width: 44px;" class="text-center">
                <input type="checkbox" id="temple-select-all" class="form-check-input" title="เลือกทั้งหมด">
              </th>
              <th style="width: 70px; cursor: pointer; user-select: none;" class="text-center sortable-temple-th" data-sort="index" title="คลิกเพื่อเรียงลำดับ">ลำดับ${sortIcon('index')}</th>
              <th style="cursor: pointer; user-select: none;" class="sortable-temple-th" data-sort="name" title="คลิกเพื่อเรียงชื่อวัด">ชื่อวัด${sortIcon('name')}</th>
              <th style="cursor: pointer; user-select: none;" class="sortable-temple-th" data-sort="address" title="คลิกเพื่อเรียงที่อยู่">ที่อยู่${sortIcon('address')}</th>
              <th style="cursor: pointer; user-select: none;" class="sortable-temple-th" data-sort="abbot" title="คลิกเพื่อเรียงเจ้าอาวาส">เจ้าอาวาส / เบอร์โทร${sortIcon('abbot')}</th>
              <th style="width: 105px; cursor: pointer; user-select: none;" class="sortable-temple-th text-center" data-sort="status" title="คลิกเพื่อเรียงสถานะ">สถานะ${sortIcon('status')}</th>
              <th style="width: 130px;" class="text-center">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((t, idx) => {
              const abbot = t.abbotName || t.abbot || '-';
              const abbotPhone = t.abbotPhone || '';
              const phone = t.templePhone || t.phone || '';
              const isChecked = selectedTempleIds.has(t.templeId) ? 'checked' : '';
              const isActive = (t.status || 'ACTIVE') === 'ACTIVE';
              return `<tr class="${isChecked ? 'table-warning' : ''}">
                <td class="text-center">
                  <input type="checkbox" class="form-check-input temple-item-check" data-id="${esc(t.templeId)}" ${isChecked}>
                </td>
                <td class="text-center fw-bold text-muted">${idx + 1}</td>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    ${t.imageUrl ? `<a href="${esc(t.imageUrl)}" target="_blank" rel="noopener" title="ดูรูปเต็ม"><img src="${esc(t.imageUrl)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onerror="this.remove()"></a>` : ''}
                    <div><strong class="text-primary">${esc(t.templeName)}</strong></div>
                  </div>
                </td>
                <td>ต.${esc(t.subdistrict || '-')} อ.${esc(t.district || '-')}<br>จ.${esc(t.province || '-')}</td>
                <td>
                  <div>☸ <strong>${esc(abbot)}</strong></div>
                  ${abbotPhone ? `<div class="small text-primary">📱 โทรเจ้าอาวาส: <a href="tel:${esc(abbotPhone)}" class="text-decoration-none fw-semibold">${esc(abbotPhone)}</a></div>` : ''}
                  ${phone && phone !== abbotPhone ? `<div class="small text-muted">📞 เบอร์วัด: <a href="tel:${esc(phone)}" class="text-decoration-none">${esc(phone)}</a></div>` : (!abbotPhone && !phone ? '<div class="small text-muted">-</div>' : '')}
                </td>
                <td class="text-center"><span class="badge ${isActive ? 'bg-success' : 'bg-secondary'}">${esc(t.status || 'ACTIVE')}</span></td>
                <td class="text-nowrap text-center">
                  <button class="btn btn-xs btn-outline-primary edit-temple" data-id="${esc(t.templeId)}">แก้ไข</button>
                  <button class="btn btn-xs btn-outline-danger delete-temple ms-1" data-id="${esc(t.templeId)}">ลบ</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

    `;

    // Sortable headers click binding
    $$('.sortable-temple-th').forEach(th => {
      th.onclick = () => {
        const f = th.dataset.sort;
        if (templeSortField === f) {
          templeSortDir = templeSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          templeSortField = f;
          templeSortDir = 'asc';
        }
        renderTemples();
      };
    });
  }

  // Checkbox & buttons bindings (common to both views)
  $$('.temple-item-check').forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        selectedTempleIds.add(id);
        cb.closest('tr')?.classList.add('table-warning');
        cb.closest('.mobile-data-card')?.classList.add('selected');
      } else {
        selectedTempleIds.delete(id);
        cb.closest('tr')?.classList.remove('table-warning');
        cb.closest('.mobile-data-card')?.classList.remove('selected');
      }
      updateTempleSelectionUI();
    };
  });

  const selectAll = $('#temple-select-all');
  if (selectAll) {
    selectAll.onchange = () => {
      const check = selectAll.checked;
      rows.forEach(t => {
        if (check) selectedTempleIds.add(t.templeId);
        else selectedTempleIds.delete(t.templeId);
      });
      $$('.temple-item-check').forEach(cb => {
        cb.checked = check;
        if (check) cb.closest('tr')?.classList.add('table-warning');
        else cb.closest('tr')?.classList.remove('table-warning');
      });
      updateTempleSelectionUI();
    };
  }

  $$('.edit-temple').forEach(b => b.onclick = () => editTemple(b.dataset.id));
  $$('.delete-temple').forEach(b => b.onclick = () => deleteTemple(b.dataset.id));

  updateTempleSelectionUI();
}

function renderProjects() { 
  $('#project-editor').innerHTML = data.projects.length
    ? data.projects.map(p => {
        const fieldCount = (data.formFields||[]).filter(f=>f.projectId===p.projectId).length;
        const sessionCount = (data.sessions||[]).filter(s=>s.projectId===p.projectId).length;
        const isPublicList = String(p.publicVisible ?? p.publicListVisible ?? 'TRUE').toUpperCase() !== 'FALSE';
        const isRegOpen = String(p.registrationOpen ?? 'TRUE').toUpperCase() !== 'FALSE';
        const isTempleReq = String(p.requireTemple ?? 'TRUE').toUpperCase() !== 'FALSE';
        const statusColor = (p.status === 'ACTIVE' || p.status === 'OPEN') ? 'success' : (p.status === 'CLOSED' ? 'danger' : 'secondary');
        return `<article class="border rounded-3 p-3 mb-3 shadow-sm bg-white">
          <div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">
            <div>
              <strong class="h6 mb-0 text-navy">${esc(p.projectName)}</strong>
              <div class="d-flex flex-wrap gap-2 mt-1 align-items-center">
                <span class="badge bg-${statusColor}">${esc(p.status)}</span>
                ${isPublicList ? '<span class="badge bg-info text-dark">🌐 แสดงรายชื่อสาธารณะ</span>' : '<span class="badge bg-secondary">🔒 ซ่อนรายชื่อสาธารณะ</span>'}
                ${isRegOpen ? '<span class="badge bg-success">📝 เปิดรับสมัคร</span>' : '<span class="badge bg-danger">🚫 ปิดรับสมัคร</span>'}
                ${isTempleReq ? '<span class="badge bg-light text-secondary border">🏛️ บังคับระบุวัด</span>' : '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">🏛️ ไม่บังคับวัด (ธุดงคสถานฯ)</span>'}
                <small class="text-muted ms-1">${esc(p.projectType)} · ${esc(p.startDate||'-')} ถึง ${esc(p.endDate||'-')}</small>
              </div>
              <div class="small text-muted mt-1">
                📝 ${fieldCount} Form Fields · 📅 ${sessionCount} Sessions (รอบ/รุ่น)
              </div>
            </div>
            <div class="d-flex gap-2 flex-wrap align-items-center">
              <button class="btn btn-sm ${isPublicList ? 'btn-outline-danger' : 'btn-outline-success'} toggle-project-pub-btn" data-id="${esc(p.projectId)}" data-next="${isPublicList ? 'FALSE' : 'TRUE'}" title="${isPublicList ? 'คลิกเพื่อซ่อนรายชื่อจากหน้าสาธารณะ' : 'คลิกเพื่อเปิดแสดงรายชื่อในหน้าสาธารณะ'}">
                ${isPublicList ? '🔒 ซ่อนจากหน้าสาธารณะ' : '🌐 แสดงในหน้าสาธารณะ'}
              </button>
              <button class="btn btn-outline-primary btn-sm edit-project" data-id="${esc(p.projectId)}">✏️ แก้ไข</button>
              <button class="btn btn-outline-secondary btn-sm clone-project" data-id="${esc(p.projectId)}" data-name="${esc(p.projectName)}" title="Clone โครงการ (คัดลอก Form Fields)">📋 Clone</button>
              <button class="btn btn-outline-danger btn-sm delete-project" data-id="${esc(p.projectId)}" data-name="${esc(p.projectName)}">🗑️ ลบ</button>
            </div>
          </div>
        </article>`;
      }).join('')
    : '<p class="text-muted">ยังไม่มีโครงการ</p>';
  $$('.toggle-project-pub-btn').forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = '⏳ กำลังบันทึก...';
      await toggleProjectPublicVisibility(b.dataset.id, b.dataset.next);
    };
  });
  $$('.edit-project').forEach(b=>b.onclick=()=>editProject(b.dataset.id));
  $$('.clone-project').forEach(b=>b.onclick=()=>cloneProject(b.dataset.id, b.dataset.name));
  $$('.delete-project').forEach(b=>b.onclick=()=>deleteProject(b.dataset.id, b.dataset.name));
}

function openPublicListConfigModal() {
  renderPublicListConfigModal();
  if (!publicListModal) publicListModal = new bootstrap.Modal($('#public-list-config-modal'));
  publicListModal.show();
}

function renderPublicListConfigModal() {
  const body = $('#public-list-config-body');
  if (!body) return;
  const projects = data.projects || [];
  if (!projects.length) {
    body.innerHTML = '<p class="text-muted text-center py-3">ยังไม่มีโครงการในระบบ</p>';
    return;
  }

  body.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead class="table-light">
          <tr>
            <th>ชื่อโครงการ</th>
            <th style="width:110px;" class="text-center">ผู้สมัคร</th>
            <th style="width:180px;" class="text-center">สถานะหน้าสาธารณะ</th>
            <th style="width:200px;" class="text-end">การตั้งค่า</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(p => {
            const isPub = String(p.publicVisible ?? p.publicListVisible ?? 'TRUE').toUpperCase() !== 'FALSE';
            const regCount = (data.registrations || []).filter(r => (r.projectId || 'PRJ-1') === p.projectId).length;
            return `<tr>
              <td>
                <strong class="text-navy">${esc(p.projectName)}</strong>
                <br><small class="text-muted font-monospace">${esc(p.projectId)} · ${esc(p.projectType || 'TRAINING')}</small>
              </td>
              <td class="text-center fw-bold">${regCount} คน</td>
              <td class="text-center">
                <span class="badge ${isPub ? 'bg-success' : 'bg-secondary'} py-1 px-2">
                  ${isPub ? '🌐 เปิดแสดงรายชื่อ' : '🔒 ซ่อน / ไม่แสดง'}
                </span>
              </td>
              <td class="text-end">
                <button class="btn btn-sm ${isPub ? 'btn-outline-danger' : 'btn-success'} btn-modal-toggle-pub" data-id="${esc(p.projectId)}" data-next="${isPub ? 'FALSE' : 'TRUE'}">
                  ${isPub ? '🔒 เปลี่ยนเป็น: ซ่อน' : '🌐 เปลี่ยนเป็น: เปิดแสดง'}
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  $$('.btn-modal-toggle-pub', body).forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = '⏳ กำลังบันทึก...';
      await toggleProjectPublicVisibility(b.dataset.id, b.dataset.next);
    };
  });
}

async function toggleProjectPublicVisibility(projectId, nextVal) {
  const p = (data.projects || []).find(x => x.projectId === projectId);
  const pName = p ? p.projectName : projectId;
  try {
    await api('admin-data', {
      method: 'PUT',
      body: JSON.stringify({
        entity: 'project',
        projectId: projectId,
        publicVisible: nextVal
      })
    });
    if (p) p.publicVisible = nextVal;
    toast(`ตั้งค่าโครงการ "${pName}" เป็น: ${nextVal === 'TRUE' ? 'เปิดแสดงในหน้าสาธารณะแล้ว 🌐' : 'ซ่อนจากหน้าสาธารณะแล้ว 🔒'}`, 'success');
    renderProjects();
    renderRegistrations();
    renderPublicListConfigModal();
  } catch (err) {
    alertUser(err.message || 'ไม่สามารถอัปเดตการตั้งค่าได้');
  }
}

async function deleteProject(id, name) {
  const sessionCount = (data.sessions || []).filter(s => s.projectId === id).length;
  const regCount = (data.registrations || []).filter(r => r.projectId === id).length;
  const fieldCount = (data.formFields || []).filter(f => f.projectId === id).length;
  let warn = '';
  if (sessionCount > 0 || regCount > 0 || fieldCount > 0) {
    warn = `\n\n⚠️ คำเตือน: โครงการนี้มี:\n- ${sessionCount} รอบ/รุ่น (Sessions)\n- ${fieldCount} Form Fields\n- ${regCount} ผู้สมัคร (Registrations)\n- ชีตลงทะเบียนเฉพาะของโครงการนี้ใน Google Sheets (Reg_${id}) จะถูกลบออกด้วย`;
  }
  if (!confirm(`ยืนยันการลบโครงการ "${name}" และชีตลงทะเบียนของโครงการนี้ออกจากระบบหรือไม่?${warn}`)) return;
  try {
    modal?.hide();
    await api('admin-data', {
      method: 'DELETE',
      body: JSON.stringify({ entity: 'project', projectId: id })
    });
    alertUser(`ลบโครงการ "${name}" และชีตลงทะเบียนเรียบร้อยแล้ว (ข้อมูลบุคคลกลางยังคงถูกเก็บรักษาไว้)`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message);
  }
}
async function cloneProject(sourceId, sourceName) {
  if (!confirm(
    `โคลนโครงการ "${sourceName}"?\n\n` +
    `✅ จะคัดลอก:\n  - ข้อมูลโครงการ\n  - Form Fields ทั้งหมด\n\n` +
    `❌ จะไม่คัดลอก:\n  - รุ่นอบรม (Sessions)\n  - ผู้สมัคร (Registrations)\n\n` +
    `โครงการใหม่จะมีสถานะ "DRAFT" และซ่อนจากสาธารณะ`
  )) return;
  try {
    const result = await api('admin-data', {
      method: 'POST',
      body: JSON.stringify({ entity: 'project', mode: 'clone', sourceProjectId: sourceId })
    });
    alertUser(`✅ ${result.message}`, 'success');
    await load();
    // Jump to new project's Form Fields tab automatically
    if (result.project?.projectId) {
      $$('[data-tab]').forEach(x => x.classList.remove('active'));
      $$('.tab-pane').forEach(x => x.classList.add('d-none'));
      document.querySelector('[data-tab="forms"]').classList.add('active');
      $('#forms-pane').classList.remove('d-none');
      $('#form-project-selector').value = result.project.projectId;
      renderFormFields();
    }
  } catch(e) {
    alertUser(e.message);
  }
}
// ---- Kathin filter & selection state ----
let selectedKathinIds = new Set();
let kathinFilter = { text: '', type: 'กฐินแสน', district: '', leader: '', sortField: 'date', sortDir: 'asc' };

function hasKathinLeader(k) {
  if (!k) return false;
  const desc = String(k.description || '');
  const status = String(k.status || '');
  const text = `${desc} ${status}`;
  if (/ไม่มีประธาน|ยังไม่มีประธาน/i.test(text)) return false;
  return /มีประธานนำกล่าวแล้ว|ประธานนำกล่าว/i.test(text);
}

const THAI_MONTHS_MAP = {
  'ม.ค.': '01', 'ก.พ.': '02', 'มี.ค.': '03', 'เม.ย.': '04', 'พ.ค.': '05', 'มิ.ย.': '06',
  'ก.ค.': '07', 'ส.ค.': '08', 'ก.ย.': '09', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12'
};

function getComparableDate(str = '') {
  if (!str || str === '-' || str === "'-" || str.includes('ไม่ระบุ')) return '9999-99-99';
  const trimmed = String(str).trim();
  const slashParts = trimmed.split('/');
  if (slashParts.length === 3) {
    let year = Number(slashParts[2]);
    if (year > 2400) year -= 543;
    return `${String(year).padStart(4, '0')}-${slashParts[1].padStart(2, '0')}-${slashParts[0].padStart(2, '0')}`;
  }
  const spaceParts = trimmed.split(/\s+/);
  if (spaceParts.length >= 3) {
    const day = spaceParts[0].padStart(2, '0');
    const mStr = spaceParts[1];
    const month = THAI_MONTHS_MAP[mStr] || '00';
    let yStr = spaceParts[2].replace(/\D/g, '');
    let year = Number(yStr);
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;
    return `${String(year).padStart(4, '0')}-${month}-${day}`;
  }
  return trimmed;
}

function compareKathinRecords(a, b, field, dir) {
  let res = 0;
  if (field === 'index') {
    res = (a._origIdx ?? 0) - (b._origIdx ?? 0);
  } else if (field === 'name') {
    res = (a.templeName || '').localeCompare(b.templeName || '', 'th');
  } else if (field === 'district') {
    const da = `${a.province||''} ${a.district||''} ${a.subdistrict||''}`;
    const db = `${b.province||''} ${b.district||''} ${b.subdistrict||''}`;
    res = da.localeCompare(db, 'th');
  } else if (field === 'type') {
    res = (a.kathinType || '').localeCompare(b.kathinType || '', 'th');
  } else if (field === 'monks') {
    res = Number(a.residentMonks || 0) - Number(b.residentMonks || 0);
  } else if (field === 'date') {
    const da = getComparableDate(a.kathinDate);
    const db = getComparableDate(b.kathinDate);
    res = da.localeCompare(db);
    if (res === 0) {
      res = (a.kathinTime || '').localeCompare(b.kathinTime || '');
    }
  } else if (field === 'time') {
    res = (a.kathinTime || '').localeCompare(b.kathinTime || '');
  } else if (field === 'abbot') {
    res = (a.abbotName || '').localeCompare(b.abbotName || '', 'th');
  } else if (field === 'disciple1') {
    res = (a.disciple1Name || '').localeCompare(b.disciple1Name || '', 'th');
  } else if (field === 'disciple2') {
    res = (a.disciple2Name || '').localeCompare(b.disciple2Name || '', 'th');
  } else if (field === 'status') {
    res = (a.status || '').localeCompare(b.status || '', 'th');
  } else {
    res = (a.templeName || '').localeCompare(b.templeName || '', 'th');
  }
  return dir === 'desc' ? -res : res;
}

function updateKathinSelectionUI() {
  const count = selectedKathinIds.size;
  const topBtn = $('#btn-delete-selected-kathins');
  const bar = $('#kathin-bulk-bar');
  const countEl = $('#selected-kathin-count');
  const barCountEl = $('#selected-kathin-count-bar');
  const selectAllBox = $('#kathin-select-all');

  if (countEl) countEl.textContent = count;
  if (barCountEl) barCountEl.textContent = count;

  if (count > 0) {
    if (topBtn) topBtn.classList.remove('d-none');
    if (bar) bar.classList.remove('d-none');
  } else {
    if (topBtn) topBtn.classList.add('d-none');
    if (bar) bar.classList.add('d-none');
  }

  if (selectAllBox && data.kathin && data.kathin.length > 0) {
    const visibleIds = (data.kathin || []).map(k => k.kathinId);
    const allChecked = visibleIds.length > 0 && visibleIds.every(id => selectedKathinIds.has(id));
    const someChecked = visibleIds.some(id => selectedKathinIds.has(id));
    selectAllBox.checked = allChecked;
    selectAllBox.indeterminate = !allChecked && someChecked;
  }
}

async function deleteSelectedKathins() {
  const count = selectedKathinIds.size;
  if (!count) return;
  if (!confirm(`ยืนยันการลบข้อมูลกฐินที่เลือกจำนวน ${count} รายการใช่หรือไม่?\n(ข้อมูลที่ถูกลบออกจากฐานข้อมูลจะไม่สามารถกู้คืนได้)`)) return;

  const buttons = [$('#btn-delete-selected-kathins'), $('#btn-delete-selected-kathins-bar')].filter(Boolean);
  buttons.forEach(b => { b.disabled = true; b.textContent = '⏳ กำลังลบข้อมูล...'; });

  try {
    const result = await api('admin-data', {
      method: 'DELETE',
      body: JSON.stringify({ entity: 'kathin', kathinIds: Array.from(selectedKathinIds) })
    });
    alertUser(`ลบข้อมูลกฐินเรียบร้อยแล้ว ${result.count || count} รายการ`, 'success');
    selectedKathinIds.clear();
    updateKathinSelectionUI();
    await load();
  } catch(e) {
    alertUser(e.message);
  } finally {
    buttons.forEach(b => { b.disabled = false; b.textContent = `🗑️ ลบที่เลือก (${selectedKathinIds.size} รายการ)`; });
    updateKathinSelectionUI();
  }
}

function deselectAllKathins() {
  selectedKathinIds.clear();
  $$('.kathin-item-check').forEach(cb => {
    cb.checked = false;
    cb.closest('tr')?.classList.remove('table-warning');
  });
  updateKathinSelectionUI();
}

async function bulkUpdateKathinStatus(targetStatus) {
  const count = selectedKathinIds.size;
  if (!count) return;

  const statusLabelMap = {
    'APPROVED': 'อนุมัติ (APPROVED)',
    'PENDING': 'รอดำเนินการ (PENDING)',
    'CANCELLED': 'ยกเลิก (CANCELLED)'
  };
  const label = statusLabelMap[targetStatus] || targetStatus;

  if (!confirm(`ยืนยันการเปลี่ยนสถานะเป็น "${label}" สำหรับข้อมูลกฐินที่เลือก ${count} รายการใช่หรือไม่?`)) return;

  const buttons = $$('.btn-bulk-kathin-status');
  buttons.forEach(b => { b.disabled = true; });

  try {
    const result = await api('admin-data', {
      method: 'PUT',
      body: JSON.stringify({
        entity: 'kathin',
        kathinIds: Array.from(selectedKathinIds),
        status: targetStatus
      })
    });
    toast(`เปลี่ยนสถานะเป็น "${label}" สำเร็จ ${result.count || count} รายการ`, 'success');
    selectedKathinIds.clear();
    updateKathinSelectionUI();
    await load();
  } catch(e) {
    alertUser(e.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
  } finally {
    buttons.forEach(b => { b.disabled = false; });
    updateKathinSelectionUI();
  }
}

function renderKathin() {
  const tableEl = $('#kathin-table');
  if (!tableEl) return;
  const allRows = data.kathin || [];

  // Update view mode toggle buttons
  const btnCards = $('#btn-kathin-view-cards');
  const btnTable = $('#btn-kathin-view-table');
  if (btnCards && btnTable) {
    btnCards.classList.toggle('active', adminKathinViewMode === 'cards');
    btnCards.classList.toggle('btn-primary', adminKathinViewMode === 'cards');
    btnCards.classList.toggle('btn-outline-primary', adminKathinViewMode !== 'cards');

    btnTable.classList.toggle('active', adminKathinViewMode === 'table');
    btnTable.classList.toggle('btn-primary', adminKathinViewMode === 'table');
    btnTable.classList.toggle('btn-outline-primary', adminKathinViewMode !== 'table');

    btnCards.onclick = () => { adminKathinViewMode = 'cards'; applyKathinFilter(); };
    btnTable.onclick = () => { adminKathinViewMode = 'table'; applyKathinFilter(); };
  }

  // Update tab counter badges
  const saenCount = allRows.filter(k => k.kathinType === 'กฐินแสน').length;
  const muenCount = allRows.filter(k => k.kathinType === 'กฐินหมื่น').length;
  const leaderCount = allRows.filter(k => hasKathinLeader(k)).length;
  if ($('#admin-count-saen')) $('#admin-count-saen').textContent = saenCount;
  if ($('#admin-count-muen')) $('#admin-count-muen').textContent = muenCount;
  if ($('#admin-count-all')) $('#admin-count-all').textContent = allRows.length;
  if ($('#admin-count-leader')) $('#admin-count-leader').textContent = leaderCount;

  // Bind leader toggle button in tabs header
  const leaderToggleBtn = $('#btn-admin-leader-toggle');
  if (leaderToggleBtn) {
    leaderToggleBtn.classList.toggle('btn-warning', kathinFilter.leader === 'yes');
    leaderToggleBtn.classList.toggle('btn-outline-warning', kathinFilter.leader !== 'yes');
    leaderToggleBtn.onclick = () => {
      kathinFilter.leader = kathinFilter.leader === 'yes' ? '' : 'yes';
      if ($('#kf-leader')) $('#kf-leader').value = kathinFilter.leader;
      leaderToggleBtn.classList.toggle('btn-warning', kathinFilter.leader === 'yes');
      leaderToggleBtn.classList.toggle('btn-outline-warning', kathinFilter.leader !== 'yes');
      applyKathinFilter();
    };
  }

  // Bind sub-tabs (กฐินแสน / กฐินหมื่น / ทั้งหมด)
  $$('#admin-kathin-tabs button[data-type]').forEach(btn => {
    btn.onclick = () => {
      $$('#admin-kathin-tabs button[data-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      kathinFilter.type = btn.dataset.type || '';
      if ($('#kf-type')) $('#kf-type').value = kathinFilter.type;
      applyKathinFilter();
    };
  });

  // Build district list dynamically
  const districts = [...new Set(allRows.map(k => k.district).filter(Boolean))].sort();

  // Filter controls HTML (inject above table, only on first render)
  const controlsId = 'kathin-filter-controls';
  if (!$('#' + controlsId)) {
    const wrapper = document.createElement('div');
    wrapper.id = controlsId;
    wrapper.className = 'mb-3';
    wrapper.innerHTML = `
      <div class="row g-2 align-items-end">
        <div class="col-12 col-md-3">
          <input id="kf-text" class="form-control form-control-sm" placeholder="🔍 ค้นหาชื่อวัด เจ้าอาวาส ประธานนำกล่าว...">
        </div>
        <div class="col-6 col-md-2">
          <select id="kf-type" class="form-select form-select-sm">
            <option value="">ทุกประเภท</option>
            <option value="กฐินแสน" ${kathinFilter.type === 'กฐินแสน' ? 'selected' : ''}>🌟 กฐินแสน</option>
            <option value="กฐินหมื่น" ${kathinFilter.type === 'กฐินหมื่น' ? 'selected' : ''}>🎆 กฐินหมื่น</option>
          </select>
        </div>
        <div class="col-6 col-md-2">
          <select id="kf-leader" class="form-select form-select-sm">
            <option value="">👑 ทุกสถานะประธาน</option>
            <option value="yes" ${kathinFilter.leader === 'yes' ? 'selected' : ''}>👑 มีประธานนำกล่าวแล้ว</option>
            <option value="no" ${kathinFilter.leader === 'no' ? 'selected' : ''}>⚪ ยังไม่มีประธานนำกล่าว</option>
          </select>
        </div>
        <div class="col-6 col-md-2">
          <select id="kf-district" class="form-select form-select-sm">
            <option value="">ทุกอำเภอ</option>
            ${districts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
          </select>
        </div>
        <div class="col-6 col-md-2">
          <select id="kf-sort" class="form-select form-select-sm">
            <option value="date-asc">วันทอดกฐิน (เร็ว -> ช้า)</option>
            <option value="date-desc">วันทอดกฐิน (ช้า -> เร็ว)</option>
            <option value="name-asc">ชื่อวัด (ก - ฮ)</option>
            <option value="name-desc">ชื่อวัด (ฮ - ก)</option>
            <option value="monks-desc">จำนวนพระ (มาก -> น้อย)</option>
            <option value="monks-asc">จำนวนพระ (น้อย -> มาก)</option>
          </select>
        </div>
        <div class="col-12 col-md-1 d-flex gap-1 justify-content-between justify-content-md-end align-items-center">
          <button id="kf-reset" class="btn btn-outline-secondary btn-sm w-100">รีเซ็ต</button>
        </div>
      </div>
      <div class="d-flex justify-content-end align-items-center mt-2">
        <span id="kf-count" class="text-muted small text-nowrap"></span>
      </div>`;
    tableEl.before(wrapper);

    $('#kf-text').oninput = () => { kathinFilter.text = $('#kf-text').value; applyKathinFilter(); };
    $('#kf-type').onchange = () => {
      kathinFilter.type = $('#kf-type').value;
      $$('#admin-kathin-tabs button[data-type]').forEach(b => {
        b.classList.toggle('active', (b.dataset.type || '') === kathinFilter.type);
      });
      applyKathinFilter();
    };
    $('#kf-leader').onchange = () => {
      kathinFilter.leader = $('#kf-leader').value;
      if (leaderToggleBtn) {
        leaderToggleBtn.classList.toggle('btn-warning', kathinFilter.leader === 'yes');
        leaderToggleBtn.classList.toggle('btn-outline-warning', kathinFilter.leader !== 'yes');
      }
      applyKathinFilter();
    };
    $('#kf-district').onchange = () => { kathinFilter.district = $('#kf-district').value; applyKathinFilter(); };
    $('#kf-sort').onchange = () => {
      const parts = ($('#kf-sort').value || 'date-asc').split('-');
      kathinFilter.sortField = parts[0] || 'date';
      kathinFilter.sortDir = parts[1] || 'asc';
      applyKathinFilter();
    };
    $('#kf-reset').onclick = () => {
      kathinFilter = { text: '', type: '', district: '', leader: '', sortField: 'date', sortDir: 'asc' };
      $('#kf-text').value = ''; $('#kf-type').value = ''; $('#kf-district').value = ''; $('#kf-leader').value = ''; $('#kf-sort').value = 'date-asc';
      if (leaderToggleBtn) {
        leaderToggleBtn.classList.remove('btn-warning');
        leaderToggleBtn.classList.add('btn-outline-warning');
      }
      $$('#admin-kathin-tabs button[data-type]').forEach(b => b.classList.toggle('active', (b.dataset.type || '') === ''));
      applyKathinFilter();
    };
  } else {
    // Refresh district options
    const sel = $('#kf-district');
    const cur = sel.value;
    sel.innerHTML = `<option value="">ทุกอำเภอ</option>` + districts.map(d => `<option value="${esc(d)}"${d===cur?' selected':''}>${esc(d)}</option>`).join('');
  }

  applyKathinFilter();
}

function applyKathinFilter() {
  const tableEl = $('#kathin-table');
  if (!tableEl) return;
  const rows = (data.kathin || []).map((k, idx) => ({ ...k, _origIdx: idx + 1 }));
  const { text, type, district, leader, sortField, sortDir } = kathinFilter;
  const q = text.trim().toLowerCase();

  let filtered = rows.filter(k => {
    const isLeader = hasKathinLeader(k);
    if (q) {
      const matchText = `${k.templeName} ${k.abbotName} ${k.disciple1Name} ${k.disciple2Name} ${k.subdistrict} ${k.district} ${k.province} ${k.description || ''} ${isLeader ? 'มีประธานนำกล่าวแล้ว ประธานนำกล่าว ประธาน' : ''}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    if (type && k.kathinType !== type) return false;
    if (district && k.district !== district) return false;
    if (leader === 'yes' && !isLeader) return false;
    if (leader === 'no' && isLeader) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => compareKathinRecords(a, b, sortField, sortDir));

  // Date summary bar
  const dateCounts = {};
  filtered.forEach(k => {
    const d = k.kathinDate || 'ไม่ระบุ';
    if (!dateCounts[d]) dateCounts[d] = { wats: 0, districts: new Set() };
    dateCounts[d].wats++;
    if (k.district) dateCounts[d].districts.add(k.district);
  });
  const dateSummaryHtml = Object.entries(dateCounts)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([d, v]) => `<span class="badge bg-light text-dark border me-1 mb-1" style="cursor:pointer" onclick="document.getElementById('kf-text').value='${esc(d)}';kathinFilter.text='${esc(d)}';applyKathinFilter();">
      📅 ${esc(d)} — ${v.wats} วัด / ${v.districts.size} อำเภอ</span>`)
    .join('');

  if ($('#kf-count')) $('#kf-count').textContent = `พบ ${filtered.length} รายการ`;

  // Summary bar
  let summaryEl = $('#kathin-date-summary');
  if (!summaryEl) {
    summaryEl = document.createElement('div');
    summaryEl.id = 'kathin-date-summary';
    summaryEl.className = 'mb-3';
    tableEl.before(summaryEl);
  }
  summaryEl.innerHTML = dateSummaryHtml
    ? `<div class="p-2 bg-light rounded border small">${dateSummaryHtml}</div>`
    : '';

  // Update view mode toggle buttons state
  const btnCards = $('#btn-kathin-view-cards');
  const btnTable = $('#btn-kathin-view-table');
  if (btnCards && btnTable) {
    btnCards.classList.toggle('active', adminKathinViewMode === 'cards');
    btnCards.classList.toggle('btn-primary', adminKathinViewMode === 'cards');
    btnCards.classList.toggle('btn-outline-primary', adminKathinViewMode !== 'cards');

    btnTable.classList.toggle('active', adminKathinViewMode === 'table');
    btnTable.classList.toggle('btn-primary', adminKathinViewMode === 'table');
    btnTable.classList.toggle('btn-outline-primary', adminKathinViewMode !== 'table');
  }

  const statusBadge = s => `<span class="badge bg-${s==='APPROVED'?'success':s==='PENDING'?'warning text-dark':'secondary'}">${esc(s==='APPROVED'?'อนุมัติ':s==='PENDING'?'รอดำเนินการ':'ยกเลิก')}</span>`;

  if (!filtered.length) {
    tableEl.innerHTML = '<p class="text-muted p-3 text-center mb-0">ไม่พบข้อมูลกฐิน</p>';
    return;
  }

  if (adminKathinViewMode === 'cards') {
    tableEl.innerHTML = `
      <div class="row g-2">
        ${filtered.map((k, idx) => {
          const isChecked = selectedKathinIds.has(k.kathinId);
          return `
            <div class="col-12 col-md-6 col-xl-4">
              <div class="mobile-data-card ${isChecked ? 'selected' : ''}">
                <div class="mobile-card-header">
                  <div class="d-flex align-items-center gap-2">
                    <input type="checkbox" class="form-check-input kathin-item-check" data-id="${esc(k.kathinId)}" ${isChecked}>
                    <span class="badge bg-secondary-subtle text-secondary small">#${idx + 1}</span>
                    <h4 class="mobile-card-title text-primary">${esc(k.templeName)}</h4>
                  </div>
                  <div>${statusBadge(k.status||'PENDING')}</div>
                </div>
                ${hasKathinLeader(k) ? `<div class="mb-2"><span class="badge bg-warning text-dark border border-warning shadow-sm">👑 มีประธานนำกล่าวแล้ว</span></div>` : ''}
                ${k.description ? `<div class="mb-2"><span class="badge bg-light text-secondary border">${esc(k.description)}</span></div>` : ''}
                <div class="mobile-card-row">
                  <span class="mobile-card-label">ที่ตั้ง:</span>
                  <span class="mobile-card-val">ต.${esc(k.subdistrict||'-')} อ.${esc(k.district||'-')} จ.${esc(k.province||'-')}</span>
                </div>
                <div class="mobile-card-row">
                  <span class="mobile-card-label">ประเภท / พระ:</span>
                  <span class="mobile-card-val"><span class="badge ${k.kathinType==='กฐินแสน'?'bg-primary':'bg-success'} me-1">${esc(k.kathinType)}</span> <strong>${esc(k.residentMonks||'0')} รูป</strong></span>
                </div>
                <div class="mobile-card-row">
                  <span class="mobile-card-label">วันทอดกฐิน:</span>
                  <span class="mobile-card-val fw-semibold text-primary">📅 ${esc(k.kathinDate||'-')} ${k.kathinTime ? `⏰ ${esc(k.kathinTime)} น.` : ''}</span>
                </div>
                <div class="mobile-card-row">
                  <span class="mobile-card-label">เจ้าอาวาส:</span>
                  <span class="mobile-card-val">
                    ☸ ${esc(k.abbotName||'-')}
                    ${k.abbotPhone ? `<br><a href="tel:${esc(k.abbotPhone)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none mt-1">📞 ${esc(k.abbotPhone)}</a>` : ''}
                  </span>
                </div>
                <div class="mobile-card-row">
                  <span class="mobile-card-label">ศิษย์คนที่ 1:</span>
                  <span class="mobile-card-val">
                    ${k.disciple1Name ? `${esc(k.disciple1Name)}${k.disciple1Phone ? `<br><a href="tel:${esc(k.disciple1Phone)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none mt-1">📞 ${esc(k.disciple1Phone)}</a>` : ''}` : '-'}
                  </span>
                </div>
                ${k.disciple2Name ? `
                <div class="mobile-card-row">
                  <span class="mobile-card-label">ศิษย์คนที่ 2:</span>
                  <span class="mobile-card-val">
                    ${esc(k.disciple2Name)}${k.disciple2Phone ? `<br><a href="tel:${esc(k.disciple2Phone)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none mt-1">📞 ${esc(k.disciple2Phone)}</a>` : ''}
                  </span>
                </div>` : ''}
                <div class="mobile-card-actions">
                  <button class="btn btn-sm btn-outline-primary edit-kathin" data-id="${esc(k.kathinId)}">✏️ แก้ไข</button>
                  <button class="btn btn-sm btn-outline-danger delete-kathin" data-id="${esc(k.kathinId)}" data-name="${esc(k.templeName)}">🗑️ ลบ</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    // Sort indicator helper
    const sortIcon = f => {
      if (sortField === f) {
        return sortDir === 'asc' ? ' <span class="text-warning fw-bold">▲</span>' : ' <span class="text-warning fw-bold">▼</span>';
      }
      return ' <span class="text-white-50 small opacity-50">↕</span>';
    };

    tableEl.innerHTML = `
      <div class="table-responsive"><table class="table table-hover align-middle small">
        <thead class="table-dark">
          <tr>
            <th style="width: 44px;" class="text-center">
              <input type="checkbox" id="kathin-select-all" class="form-check-input" title="เลือกทั้งหมด">
            </th>
            <th style="width:65px" class="text-center sortable-kathin-th" data-sort="index" title="คลิกเพื่อเรียงลำดับ" style="cursor:pointer;user-select:none;">ลำดับ${sortIcon('index')}</th>
            <th style="min-width:160px" class="sortable-kathin-th" data-sort="name" title="คลิกเพื่อเรียงชื่อวัด (ก-ฮ / ฮ-ก)" style="cursor:pointer;user-select:none;">ชื่อวัด${sortIcon('name')}</th>
            <th class="sortable-kathin-th" data-sort="district" title="คลิกเพื่อเรียงตำบล/อำเภอ" style="cursor:pointer;user-select:none;">ตำบล/อำเภอ/จังหวัด${sortIcon('district')}</th>
            <th class="sortable-kathin-th" data-sort="type" title="คลิกเพื่อเรียงประเภท" style="cursor:pointer;user-select:none;">ประเภท${sortIcon('type')}</th>
            <th class="text-center sortable-kathin-th" data-sort="monks" title="คลิกเพื่อเรียงจำนวนพระ (มาก-น้อย / น้อย-มาก)" style="cursor:pointer;user-select:none;">พระ<br>จำพรรษา${sortIcon('monks')}</th>
            <th class="sortable-kathin-th" data-sort="date" title="คลิกเพื่อเรียงวันทอดกฐิน" style="cursor:pointer;user-select:none;">วันทอดกฐิน${sortIcon('date')}</th>
            <th class="sortable-kathin-th" data-sort="time" title="คลิกเพื่อเรียงเวลา" style="cursor:pointer;user-select:none;">เวลา${sortIcon('time')}</th>
            <th style="min-width:150px" class="sortable-kathin-th" data-sort="abbot" title="คลิกเพื่อเรียงเจ้าอาวาส" style="cursor:pointer;user-select:none;">เจ้าอาวาส<br><span class="fw-normal text-muted">เบอร์</span>${sortIcon('abbot')}</th>
            <th style="min-width:150px" class="sortable-kathin-th" data-sort="disciple1" title="คลิกเพื่อเรียงศิษยานุศิษย์" style="cursor:pointer;user-select:none;">ศิษยานุศิษย์ คนที่ 1<br><span class="fw-normal text-muted">เบอร์</span>${sortIcon('disciple1')}</th>
            <th style="min-width:150px" class="sortable-kathin-th" data-sort="disciple2" title="คลิกเพื่อเรียงศิษยานุศิษย์" style="cursor:pointer;user-select:none;">ศิษยานุศิษย์ คนที่ 2<br><span class="fw-normal text-muted">เบอร์</span>${sortIcon('disciple2')}</th>
            <th class="sortable-kathin-th" data-sort="status" title="คลิกเพื่อเรียงสถานะ" style="cursor:pointer;user-select:none;">สถานะ${sortIcon('status')}</th>
            <th style="width:90px" class="text-center">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((k, idx) => {
            const isChecked = selectedKathinIds.has(k.kathinId);
            const kImg = k.imageUrl || (k.images && k.images[0]) || '';
            return `<tr class="${isChecked ? 'table-warning' : ''}">
              <td class="text-center">
                <input type="checkbox" class="form-check-input kathin-item-check" data-id="${esc(k.kathinId)}" ${isChecked}>
              </td>
              <td class="text-center fw-bold text-muted">${idx + 1}</td>
              <td>
                <div class="d-flex align-items-center gap-2">
                  ${kImg ? `<a href="${esc(kImg)}" target="_blank" rel="noopener" title="ดูรูปเต็ม"><img src="${esc(kImg)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onerror="this.remove()"></a>` : ''}
                  <div>
                    <strong class="text-primary">${esc(k.templeName)}</strong>
                    ${hasKathinLeader(k) ? ` <span class="badge bg-warning text-dark border border-warning shadow-sm ms-1">👑 มีประธานนำกล่าวแล้ว</span>` : ''}
                    ${k.description ? `<br><small class="text-muted"><span class="badge bg-light text-secondary border">${esc(k.description)}</span></small>` : ''}
                  </div>
                </div>
              </td>
              <td><small>ต.${esc(k.subdistrict||'-')}<br>อ.${esc(k.district||'-')}<br>จ.${esc(k.province||'-')}</small></td>
              <td><span class="badge ${k.kathinType==='กฐินแสน'?'bg-primary':'bg-success'}">${esc(k.kathinType)}</span></td>
              <td class="text-center fw-bold">${esc(k.residentMonks||'0')}</td>
              <td class="text-nowrap">${esc(k.kathinDate||'-')}</td>
              <td class="text-nowrap">${esc(k.kathinTime||'-')}</td>
              <td>${esc(k.abbotName||'-')}<br><small class="text-muted">${k.abbotPhone ? `📞 ${esc(k.abbotPhone)}` : ''}</small></td>
              <td>${k.disciple1Name ? `${esc(k.disciple1Name)}<br><small class="text-muted">${k.disciple1Phone ? `📞 ${esc(k.disciple1Phone)}` : ''}</small>` : '<small class="text-muted">-</small>'}</td>
              <td>${k.disciple2Name ? `${esc(k.disciple2Name)}<br><small class="text-muted">${k.disciple2Phone ? `📞 ${esc(k.disciple2Phone)}` : ''}</small>` : '<small class="text-muted">-</small>'}</td>
              <td>${statusBadge(k.status||'PENDING')}</td>
              <td class="text-nowrap text-center">
                <div class="d-flex justify-content-center gap-1">
                  <button class="btn btn-xs btn-outline-primary edit-kathin" data-id="${esc(k.kathinId)}">✏️ แก้ไข</button>
                  <button class="btn btn-xs btn-outline-danger delete-kathin" data-id="${esc(k.kathinId)}" data-name="${esc(k.templeName)}">🗑️ ลบ</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    `;

    // Sortable headers click binding
    $$('.sortable-kathin-th').forEach(th => {
      th.style.cursor = 'pointer';
      th.onclick = () => {
        const f = th.dataset.sort;
        if (kathinFilter.sortField === f) {
          kathinFilter.sortDir = kathinFilter.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          kathinFilter.sortField = f;
          kathinFilter.sortDir = (f === 'monks' ? 'desc' : 'asc');
        }
        if ($('#kf-sort')) {
          const val = `${kathinFilter.sortField}-${kathinFilter.sortDir}`;
          if ($(`#kf-sort option[value="${val}"]`)) {
            $('#kf-sort').value = val;
          }
        }
        applyKathinFilter();
      };
    });
  }

  // Checkbox & buttons bindings (common to both views)
  $$('.kathin-item-check').forEach(cb => {
    cb.onchange = () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        selectedKathinIds.add(id);
        cb.closest('tr')?.classList.add('table-warning');
        cb.closest('.mobile-data-card')?.classList.add('selected');
      } else {
        selectedKathinIds.delete(id);
        cb.closest('tr')?.classList.remove('table-warning');
        cb.closest('.mobile-data-card')?.classList.remove('selected');
      }
      updateKathinSelectionUI();
    };
  });

  const selectAll = $('#kathin-select-all');
  if (selectAll) {
    selectAll.onchange = () => {
      const check = selectAll.checked;
      filtered.forEach(k => {
        if (check) selectedKathinIds.add(k.kathinId);
        else selectedKathinIds.delete(k.kathinId);
      });
      $$('.kathin-item-check').forEach(cb => {
        cb.checked = check;
        if (check) cb.closest('tr')?.classList.add('table-warning');
        else cb.closest('tr')?.classList.remove('table-warning');
      });
      updateKathinSelectionUI();
    };
  }

  $$('.edit-kathin').forEach(b => b.onclick = () => editKathin(b.dataset.id));
  $$('.delete-kathin').forEach(b => b.onclick = () => deleteKathin(b.dataset.id, b.dataset.name));

  updateKathinSelectionUI();
}

function setupImageUrlPreview(inputId, previewImgId, containerId, errorId, clearBtnId) {
  const input = document.getElementById(inputId);
  const img = document.getElementById(previewImgId);
  const container = document.getElementById(containerId);
  const errEl = document.getElementById(errorId);
  const clearBtn = document.getElementById(clearBtnId);

  if (!input || !img || !container) return;

  const update = () => {
    const url = input.value.trim();
    if (!url) {
      container.classList.add('d-none');
      if (errEl) errEl.classList.add('d-none');
      img.src = '';
      return;
    }
    container.classList.remove('d-none');
    if (errEl) errEl.classList.add('d-none');
    img.classList.remove('d-none');
    img.src = url;
  };

  img.onerror = () => {
    if (input.value.trim()) {
      img.classList.add('d-none');
      if (errEl) errEl.classList.remove('d-none');
    }
  };

  img.onload = () => {
    img.classList.remove('d-none');
    if (errEl) errEl.classList.add('d-none');
  };

  input.addEventListener('input', update);
  input.addEventListener('change', update);

  if (clearBtn) {
    clearBtn.onclick = () => {
      input.value = '';
      update();
      input.focus();
    };
  }
}

function editKathin(id) {
  const k = (data.kathin || []).find(x => x.kathinId === id) || {};
  const isUpdate = Boolean(k.kathinId);
  const title = isUpdate ? `แก้ไขข้อมูลกฐิน: ${esc(k.templeName || '')}` : 'เพิ่มข้อมูลกฐินใหม่';
  const imgUrl = k.imageUrl || (k.images && k.images[0]) || '';

  const typeOptions = [
    { value: 'กฐินแสน', label: '🌟 กฐินแสน' },
    { value: 'กฐินหมื่น', label: '🎆 กฐินหมื่น' }
  ];
  const statusOptions = [
    { value: 'APPROVED', label: 'อนุมัติแล้ว' },
    { value: 'PENDING', label: 'รอตรวจสอบ' },
    { value: 'CANCELLED', label: 'ยกเลิก' }
  ];

  const hasLeader = hasKathinLeader(k);

  const deleteBtnHtml = isUpdate
    ? `<div class="mt-4 pt-3 border-top d-flex justify-content-between align-items-center">
         <span class="text-danger small">⚠️ ลบข้อมูลกฐินวัดนี้ออกจากระบบ</span>
         <button type="button" class="btn btn-outline-danger btn-sm" id="btn-modal-del-kathin">🗑️ ลบข้อมูลกฐิน</button>
       </div>`
    : '';

  showModal(title, `
    <input type="hidden" name="kathinId" value="${esc(k.kathinId || '')}">
    <div class="row">
      <div class="col-md-4">${select('ประเภทกฐิน', 'kathinType', k.kathinType || (kathinFilter.type || 'กฐินแสน'), typeOptions)}</div>
      <div class="col-md-8">${field('ชื่อวัด', 'templeName', k.templeName || '', 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${field('ตำบล', 'subdistrict', k.subdistrict || '', 'text')}</div>
      <div class="col-md-4">${field('อำเภอ', 'district', k.district || '', 'text')}</div>
      <div class="col-md-4">${field('จังหวัด', 'province', k.province || 'สุราษฎร์ธานี', 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${field('จำนวนพระจำพรรษา (รูป)', 'residentMonks', k.residentMonks || '0', 'number')}</div>
      <div class="col-md-4">${field('วันทอดกฐิน (เช่น 08/11/2569)', 'kathinDate', k.kathinDate || '', 'text')}</div>
      <div class="col-md-4">${field('เวลาทอดกฐิน (เช่น 09:30)', 'kathinTime', k.kathinTime || '', 'text')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('ชื่อเจ้าอาวาส', 'abbotName', k.abbotName || '', 'text')}</div>
      <div class="col-md-6">${field('เบอร์โทรเจ้าอาวาส', 'abbotPhone', k.abbotPhone || '', 'tel')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('ชื่อศิษยานุศิษย์ คนที่ 1', 'disciple1Name', k.disciple1Name || '', 'text')}</div>
      <div class="col-md-6">${field('เบอร์โทรศิษยานุศิษย์ คนที่ 1', 'disciple1Phone', k.disciple1Phone || '', 'tel')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('ชื่อศิษยานุศิษย์ คนที่ 2', 'disciple2Name', k.disciple2Name || '', 'text')}</div>
      <div class="col-md-6">${field('เบอร์โทรศิษยานุศิษย์ คนที่ 2', 'disciple2Phone', k.disciple2Phone || '', 'tel')}</div>
    </div>
    <div class="row">
      <div class="col-12 mb-3">
        <label class="form-label fw-bold">🔗 ลิงก์รูปภาพงานกฐิน / วัด (Image URL)</label>
        <div class="input-group">
          <span class="input-group-text bg-white">🖼️</span>
          <input type="url" class="form-control" name="imageUrl" id="kathin-image-url-input"
            placeholder="https://... วางลิงก์รูปภาพจาก Facebook, เว็บไซต์วัด หรือลิงก์รูปภาพใดๆ"
            value="${esc(imgUrl)}">
          <button type="button" class="btn btn-outline-secondary" id="btn-clear-kathin-img" title="ล้างลิงก์รูป">✕</button>
        </div>
        <div class="form-text text-muted small mt-1">
          💡 <strong>วิธีนำลิงก์รูปมาใส่:</strong> เปิดรูปใน Facebook หรือหน้าเว็บวัด &gt; คลิกขวาที่รูป &gt; เลือก <em>"คัดลอกที่อยู่รูปภาพ" (Copy image address)</em> แล้วนำมาวางได้ทันที
        </div>
        <div id="kathin-img-preview-box" class="mt-2 p-2 border rounded bg-light text-center ${!imgUrl ? 'd-none' : ''}">
          <div class="small text-muted mb-1">ตัวอย่างภาพที่จะแสดง:</div>
          <img id="kathin-img-preview" src="${esc(imgUrl)}" alt="ตัวอย่างรูป" style="max-height: 180px; max-width: 100%; border-radius: 6px; object-fit: contain; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <div id="kathin-img-error" class="text-danger small mt-1 d-none">⚠️ ไม่สามารถโหลดรูปภาพจากลิงก์นี้ได้ โปรดตรวจสอบ URL</div>
        </div>
      </div>
    </div>
    <div class="row">
      <div class="col-md-4">${select('สถานะ', 'status', k.status || 'APPROVED', statusOptions)}</div>
      <div class="col-md-8">
        <label class="form-label">หมายเหตุ / บันทึกเพิ่มเติม</label>
        <input type="text" class="form-control" name="description" id="kathin-description-input" value="${esc(k.description || '')}">
        <div class="form-check form-switch mt-2">
          <input class="form-check-input" type="checkbox" id="kathin-has-leader-check" ${hasLeader ? 'checked' : ''}>
          <label class="form-check-label fw-bold text-dark" for="kathin-has-leader-check">
            👑 มีประธานนำกล่าวแล้ว
          </label>
          <div class="form-text small text-muted">เปิดสวิตช์นี้เพื่อติดแท็ก <em>"👑 มีประธานนำกล่าวแล้ว"</em> ให้กับวัดนี้</div>
        </div>
      </div>
    </div>
    ${deleteBtnHtml}
  `, { type: 'kathin', mode: isUpdate ? 'update' : 'create' });

  setupImageUrlPreview('kathin-image-url-input', 'kathin-img-preview', 'kathin-img-preview-box', 'kathin-img-error', 'btn-clear-kathin-img');

  const leaderCheck = $('#kathin-has-leader-check');
  const descInput = $('#kathin-description-input');
  if (leaderCheck && descInput) {
    leaderCheck.onchange = () => {
      let desc = descInput.value.trim();
      if (leaderCheck.checked) {
        if (!/มีประธานนำกล่าวแล้ว/i.test(desc)) {
          descInput.value = desc ? `${desc} | มีประธานนำกล่าวแล้ว` : 'มีประธานนำกล่าวแล้ว';
        }
      } else {
        descInput.value = desc
          .replace(/\s*\|\s*มีประธานนำกล่าวแล้ว/g, '')
          .replace(/มีประธานนำกล่าวแล้ว\s*\|\s*/g, '')
          .replace(/มีประธานนำกล่าวแล้ว/g, '')
          .trim();
      }
    };
  }

  if (isUpdate && $('#btn-modal-del-kathin')) {
    $('#btn-modal-del-kathin').onclick = () => deleteKathin(k.kathinId, k.templeName);
  }
}

async function deleteKathin(id, name) {
  if (!confirm(`ยืนยันการลบข้อมูลกฐิน "${name || id}" หรือไม่?\n(ข้อมูลจะถูกนำออกจากฐานข้อมูล)`)) return;
  try {
    modal?.hide();
    await api('admin-data', {
      method: 'DELETE',
      body: JSON.stringify({ entity: 'kathin', kathinId: id })
    });
    selectedKathinIds.delete(id);
    updateKathinSelectionUI();
    alertUser(`ลบข้อมูลกฐินเรียบร้อยแล้ว`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message);
  }
}

function uploadKathinImg(id) {
  // Option 1: Direct Image URL in edit modal
  editKathin(id);
}

function editProject(id) { 
  const p=data.projects.find(x=>x.projectId===id); 
  const isUpdate = Boolean(p);
  const deleteBtn = isUpdate ? `
    <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
      <button type="button" class="btn btn-outline-danger btn-sm" id="btn-modal-del-project">🗑️ ลบโครงการนี้ทิ้ง</button>
      <small class="text-muted">หากไม่ต้องการโครงการนี้แล้ว สามารถกดลบได้</small>
    </div>` : '';
  showModal(isUpdate?'แก้ไขโครงการ':'เพิ่มโครงการ',`<input type="hidden" name="projectId" value="${esc(p?.projectId||'')}">
    ${field('ชื่อโครงการ','projectName',p?.projectName||'','text',true)}
    <div class="row">
      <div class="col-md-6">${field('ประเภทโครงการ','projectType',p?.projectType||'TRAINING','text',true)}</div>
      <div class="col-md-6">${select('สถานะ','status',p?.status||'OPEN',[{value:'DRAFT',label:'ร่าง (DRAFT)'},{value:'OPEN',label:'เปิด (OPEN)'},{value:'CLOSED',label:'ปิด (CLOSED)'}])}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('วันเริ่ม','startDate',p?.startDate||'','date',true)}</div>
      <div class="col-md-6">${field('วันสิ้นสุด','endDate',p?.endDate||'','date',true)}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${select('แสดงรายชื่อในหน้าสาธารณะ (Public List)','publicVisible',String(p?.publicVisible??'TRUE').toUpperCase()==='FALSE'?'FALSE':'TRUE',[{value:'TRUE',label:'เปิดแสดงรายชื่อ (Public Visible)'},{value:'FALSE',label:'ปิด/ซ่อนรายชื่อ (Hidden)'}])}</div>
      <div class="col-md-6">${select('เปิดรับสมัครออนไลน์ (Registration Open)','registrationOpen',String(p?.registrationOpen??'TRUE').toUpperCase()==='FALSE'?'FALSE':'TRUE',[{value:'TRUE',label:'เปิดรับสมัคร'},{value:'FALSE',label:'ปิดรับสมัคร'}])}</div>
    </div>
    <div class="row">
      <div class="col-12">
        ${select('การกรอกข้อมูลวัดในระบบลงทะเบียน','requireTemple',String(p?.requireTemple??'TRUE').toUpperCase()==='FALSE'?'FALSE':'TRUE',[
          {value:'TRUE',label:'จำเป็นต้องกรอกข้อมูลวัด (บังคับกรอกชื่อวัดเหมือนเดิม)'},
          {value:'FALSE',label:'ไม่จำเป็นต้องกรอกข้อมูลวัด (หากไม่กรอก จะลงทะเบียนในนาม "ธุดงคสถานสุราษฎร์ธานี")'}
        ])}
      </div>
    </div>
    ${deleteBtn}`,{type:'project',mode:isUpdate?'update':'create'}); 

  if (isUpdate && $('#btn-modal-del-project')) {
    $('#btn-modal-del-project').onclick = () => deleteProject(p.projectId, p.projectName);
  }
}
function renderFormFields() {
  const projectId = $('#form-project-selector').value || (data.projects[0]?.projectId) || 'PRJ-1';
  const fields = (data.formFields || []).filter(f => f.projectId === projectId).sort((a,b)=>Number(a.sortOrder)-Number(b.sortOrder));
  
  if ($('#custom-fields-count')) {
    $('#custom-fields-count').textContent = `มีทั้งหมด ${fields.length} ฟิลด์`;
  }

  $('#form-field-list').innerHTML = fields.length ? `<table class="table table-hover align-middle">
    <thead class="table-light">
      <tr>
        <th style="width:70px;">ลำดับ</th>
        <th>ตัวแปร (Key)</th>
        <th>ป้ายกำกับ (Label)</th>
        <th>ประเภท</th>
        <th>จำเป็น</th>
        <th>สถานะ</th>
        <th style="width:140px;">จัดการ</th>
      </tr>
    </thead>
    <tbody>${fields.map(f => `<tr>
      <td><span class="badge bg-light text-dark border">${esc(f.sortOrder)}</span></td>
      <td><code>${esc(f.fieldKey)}</code></td>
      <td><strong>${esc(f.label)}</strong></td>
      <td><span class="badge bg-secondary">${esc(f.fieldType)}</span></td>
      <td>${String(f.required).toUpperCase()==='TRUE'?'<span class="badge bg-danger">บังคับกรอก</span>':'<span class="text-muted small">ไม่บังคับ</span>'}</td>
      <td>${String(f.visible).toUpperCase()==='TRUE'?'<span class="badge bg-success">แสดงผล</span>':'<span class="badge bg-secondary">ซ่อน</span>'}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-primary edit-form-field" data-id="${esc(f.fieldId)}">✏️ แก้ไข</button>
        <button class="btn btn-sm btn-outline-danger delete-form-field ms-1" data-id="${esc(f.fieldId)}">🗑️ ลบ</button>
      </td>
    </tr>`).join('')}</tbody>
  </table>` : `<div class="p-4 text-center bg-light rounded border text-muted">
    <p class="mb-2">ยังไม่มีฟิลด์เพิ่มเติมสำหรับโครงการนี้ (ใช้เฉพาะช่องกรอกพื้นฐานของระบบ)</p>
    <small>คุณสามารถกดปุ่ม <strong>+ เพิ่ม Field ใหม่</strong> หรือกดปุ่มตัวอย่างด้านบนเพื่อเพิ่มช่องกรอกเพิ่มเติมได้ทันที</small>
  </div>`;
  
  $$('.edit-form-field').forEach(b => b.onclick = () => editFormField(b.dataset.id));
  $$('.delete-form-field').forEach(b => b.onclick = () => deleteFormField(b.dataset.id));
}

async function deleteFormField(id) {
  const f = (data.formFields || []).find(x => x.fieldId === id);
  const label = f?.label || f?.fieldKey || 'ฟิลด์นี้';
  if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบฟิลด์ "${label}" ?\n(หากลบแล้ว ฟิลด์นี้จะไม่แสดงในหน้าลงทะเบียนอีกต่อไป)`)) return;
  try {
    modal?.hide();
    await api('admin-data', {
      method: 'DELETE',
      body: JSON.stringify({ entity: 'formField', fieldId: id })
    });
    alertUser(`ลบฟิลด์ "${label}" เรียบร้อยแล้ว`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message);
  }
}

function editFormField(id, preset = null) {
  const f = (data.formFields || []).find(x => x.fieldId === id) || preset;
  const isUpdate = Boolean(id && (data.formFields || []).some(x => x.fieldId === id));
  const projectId = $('#form-project-selector').value || 'PRJ-1';
  
  const deleteBtnHtml = isUpdate ? `
    <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
      <button type="button" class="btn btn-outline-danger btn-sm" id="btn-modal-del-field">🗑️ ลบฟิลด์นี้ทิ้ง</button>
      <small class="text-muted">หากไม่ต้องการช่องกรอกนี้แล้ว สามารถกดลบได้</small>
    </div>` : '';

  showModal(isUpdate ? 'แก้ไข Field' : 'เพิ่ม Field ใหม่', `<input type="hidden" name="fieldId" value="${esc(f?.fieldId||'')}">
    <input type="hidden" name="projectId" value="${esc(f?.projectId||projectId)}">
    <div class="row">
      <div class="col-md-6">${field('ตัวแปร (fieldKey - ภาษาอังกฤษหรือชื่อตัวแปร)', 'fieldKey', f?.fieldKey||'', 'text', true)}</div>
      <div class="col-md-6">${field('ป้ายกำกับ (Label - ข้อความที่แสดงให้ผู้ใช้เห็น)', 'label', f?.label||'', 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${select('ประเภท Input', 'fieldType', f?.fieldType||'text', [
        {value:'text',label:'ข้อความสั้น (Text)'},
        {value:'textarea',label:'ข้อความยาว (Textarea)'},
        {value:'number',label:'ตัวเลข (Number)'},
        {value:'phone',label:'เบอร์โทรศัพท์ (Phone - 10 หลัก)'},
        {value:'nationalId',label:'เลขบัตรประชาชน (National ID - 13 หลัก)'},
        {value:'email',label:'อีเมล (Email)'},
        {value:'date',label:'วันที่ (Date)'},
        {value:'select',label:'ตัวเลือกดรอปดาวน์ (Select)'},
        {value:'radio',label:'ตัวเลือกข้อเดียว (Radio)'},
        {value:'checkbox',label:'ตัวเลือกหลายข้อ (Checkbox)'}
      ])}</div>
      <div class="col-md-4">${field('ลำดับการแสดงผล', 'sortOrder', f?.sortOrder||'1', 'number')}</div>
      <div class="col-md-4">${field('คำอธิบายในช่อง (Placeholder)', 'placeholder', f?.placeholder||'')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${select('จำเป็นต้องกรอกหรือไม่ (Required)', 'required', String(f?.required).toUpperCase()==='TRUE'?'TRUE':'FALSE', [{value:'TRUE',label:'บังคับกรอก (*)'},{value:'FALSE',label:'ไม่บังคับ'}])}</div>
      <div class="col-md-6">${select('การแสดงผล (Visible)', 'visible', String(f?.visible).toUpperCase()==='FALSE'?'FALSE':'TRUE', [{value:'TRUE',label:'แสดงผลในแบบฟอร์ม'},{value:'FALSE',label:'ซ่อนไว้'}])}</div>
    </div>
    <div class="row">
      <div class="col-md-6 mb-3">
        <label class="form-label">ตัวเลือก (สำหรับ Select / Radio / Checkbox) - คั่นด้วยลูกน้ำ <code>,</code></label>
        <input class="form-control" type="text" name="optionsJson" value="${esc(f?.optionsJson||'')}" placeholder="เช่น: S, M, L, XL, 2XL">
      </div>
      <div class="col-md-6 mb-3">
        <label class="form-label">เงื่อนไขตรวจสอบ (Validation / Pattern)</label>
        <input class="form-control" type="text" name="validationJson" value="${esc(f?.validationJson||'')}" placeholder="เช่น: min:1, max:100 หรือ regex">
      </div>
    </div>
    ${deleteBtnHtml}`, {type:'formField', mode:isUpdate?'update':'create'});

  if (isUpdate && $('#btn-modal-del-field')) {
    $('#btn-modal-del-field').onclick = () => deleteFormField(id);
  }
}
async function login(e) {
  e.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (!username || !password) {
    alertUser('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    return;
  }
  const submitBtn = $('#login-form button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'กำลังเข้าสู่ระบบ...'; }
  try {
    await api('admin-login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    $('#login-view').classList.add('d-none');
    $('#admin-view').classList.remove('d-none');
    $('#admin-alert').innerHTML = '';
    await load();
  } catch (err) {
    alertUser(err.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'เข้าสู่ระบบ'; }
  }
}
async function load() { 
  try { 
    data=await api('admin-data'); 
    
    // Update form project selector
    const selector = $('#form-project-selector');
    const currentVal = selector.value;
    selector.innerHTML = data.projects.map(p => `<option value="${esc(p.projectId)}">${esc(p.projectName)}</option>`).join('');
    if (currentVal && data.projects.some(p => p.projectId === currentVal)) selector.value = currentVal;
    
    // Update admin user badge in top bar and sidebar
    const curAdm = data.currentAdmin;
    if (curAdm) {
      const topBadge = $('#top-admin-user-badge');
      if (topBadge) topBadge.textContent = `👤 ${curAdm.displayName || curAdm.username} (${curAdm.role || 'ADMIN'})`;
      const sideName = $('#sidebar-admin-name');
      if (sideName) sideName.textContent = `${curAdm.displayName || curAdm.username} (${curAdm.role || 'ADMIN'})`;
    }

    renderDashboard();renderRegistrations();renderSessions();renderTemples();renderProjects();renderFormFields();renderKathin();renderPersons();renderDisbursements();renderHomepageCMS();renderAdminUsers();
    $('#login-view').classList.add('d-none');
    $('#admin-view').classList.remove('d-none');
    $('#admin-site-header')?.classList.add('d-none');
  } catch(e) { 
    if (/เข้าสู่ระบบ|session|สิทธิ์|UNAUTHORIZED/.test(e.message)) { 
      $('#login-view').classList.remove('d-none');$('#admin-view').classList.add('d-none');
      $('#admin-site-header')?.classList.remove('d-none');
    } else alertUser(e.message); 
  } 
}

const DEFAULT_HOMEPAGE_CONFIG = {
  sections: [
    { id: 'hero', name: 'Banner / หัวเว็บ', enabled: true },
    { id: 'announcements', name: 'ข่าว / ประกาศสำคัญ', enabled: true },
    { id: 'projects', name: 'โครงการที่กำลังเปิดรับสมัคร & รอบ/รุ่น', enabled: true },
    { id: 'stats', name: 'ข้อมูลภาพรวมตัวเลขสถิติ', enabled: true },
    { id: 'kathin', name: 'กฐินแสน / กฐินหมื่น', enabled: true },
    { id: 'events', name: 'ตารางกิจกรรม / อบรมที่กำลังจะมาถึง', enabled: true },
    { id: 'contact', name: 'ข้อมูลติดต่อธุดงคสถาน', enabled: true },
    { id: 'quicklinks', name: 'ปุ่มลัด / เมนูลัด', enabled: true }
  ],
  hero: {
    badge: 'แพลตฟอร์มข้อมูลกลาง',
    title: 'ธุดงคสถานสุราษฎร์ธานี',
    subtitle: 'ข้อมูลข่าวสาร • โครงการ • กิจกรรม',
    description: 'ศูนย์รวมข้อมูลโครงการอบรม ปฏิบัติธรรม และงานบุญทอดกฐินประจำปีของธุดงคสถานสุราษฎร์ธานี เพื่อความเจริญรุ่งเรืองแห่งพระพุทธศาสนา',
    primaryBtnText: '📝 ลงทะเบียนโครงการ',
    primaryBtnLink: 'register.html',
    saenBtnText: '🌟 กฐินแสน',
    saenBtnLink: 'kathin.html?type=กฐินแสน',
    muenBtnText: '🎆 กฐินหมื่น',
    muenBtnLink: 'kathin.html?type=กฐินหมื่น'
  },
  announcements: [
    {
      id: 'ann-1',
      title: 'เปิดรับสมัครอบรมอุบาสกอุบาสิกาแก้ว ประจำปี 2569',
      badge: '📢 ประกาศสำคัญ',
      badgeColor: 'danger',
      date: '1 ต.ค. 2569',
      content: 'ขอเชิญชวนผู้มีจิตศรัทธาเข้าร่วมโครงการอบรม ณ ธุดงคสถานสุราษฎร์ธานี เพื่อปฏิบัติธรรมและสั่งสมบุญบารมี สามารถลงทะเบียนออนไลน์ได้แล้ววันนี้',
      link: 'register.html',
      linkText: 'ลงทะเบียนออนไลน์ →'
    },
    {
      id: 'ann-2',
      title: 'กำหนดการพิธีทอดกฐินสามัคคี ประจำปี 2569 (กฐินแสน / กฐินหมื่น)',
      badge: '🙏 งานบุญกฐิน',
      badgeColor: 'warning',
      date: '2 ต.ค. 2569',
      content: 'ตรวจสอบรายชื่อวัด กำหนดวันและเวลาทอดกฐินของวัดในสังกัดโครงการกฐินแสนและกฐินหมื่น ประจำปี 2569 ได้ทางหน้าเว็บไซต์',
      link: 'kathin.html',
      linkText: 'ดูรายชื่อวัดทอดกฐินทั้งหมด →'
    }
  ],
  stats: {
    mode: 'auto',
    customPersons: 1245,
    customTemples: 326,
    customProjects: 3,
    title: '📊 ข้อมูลภาพรวม',
    subtitle: 'สถิติการดำเนินงานและเครือข่ายงานบุญ'
  },
  events: [
    {
      id: 'evt-1',
      title: 'พิธีสวดมนต์ปฏิบัติธรรมประจำสัปดาห์',
      date: 'ทุกวันพระ และวันอาทิตย์',
      time: '09:00 - 11:30 น.',
      location: 'ศาลาปฏิบัติธรรม ธุดงคสถานสุราษฎร์ธานี',
      description: 'สวดมนต์ทำวัตรเช้า ปฏิบัติธรรมเจริญสมาธิภาวนา และรับฟังพระธรรมเทศนา'
    },
    {
      id: 'evt-2',
      title: 'โครงการอบรมอุบาสกอุบาสิกาแก้ว รุ่นที่ 1',
      date: '4 - 6 ก.ย. 2569',
      time: '3 วัน 2 คืน',
      location: 'ธุดงคสถานสุราษฎร์ธานี',
      description: 'อบรมพัฒนาจิตใจ เรียนรู้หลักธรรมและฝึกฝนตนเอง'
    },
    {
      id: 'evt-3',
      title: 'พิธีทอดกฐินสามัคคี ประจำปี 2569',
      date: 'ช่วงเทศกาลกฐิน 2569',
      time: '09:30 น. เป็นต้นไป',
      location: 'ธุดงคสถานสุราษฎร์ธานี',
      description: 'ร่วมบุญทอดกฐินสามัคคีเพื่อทำนุบำรุงพระพุทธศาสนา'
    }
  ],
  contact: {
    title: 'ติดต่อธุดงคสถานสุราษฎร์ธานี',
    subtitle: 'ร่วมบุญ สอบถามข้อมูลโครงการ หรือแจ้งข้อมูลวัด',
    address: 'ธุดงคสถานสุราษฎร์ธานี ตำบลบางใหญ่ อำเภอเมือง จังหวัดสุราษฎร์ธานี 84000',
    phone: '077-xxx-xxx, 081-xxx-xxxx',
    lineId: '@thudongsurat',
    facebook: 'ธุดงคสถานสุราษฎร์ธานี',
    openHours: 'เปิดทำการทุกวัน เวลา 08:00 – 17:00 น.'
  }
};

let currentHomepageConfig = null;
let activeCmsTab = 'hero';

function getHomepageConfig() {
  if (!currentHomepageConfig) {
    const raw = (data.homepageConfig && typeof data.homepageConfig === 'object') ? data.homepageConfig : {};
    currentHomepageConfig = {
      sections: (Array.isArray(raw.sections) && raw.sections.length)
        ? JSON.parse(JSON.stringify(raw.sections))
        : JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.sections)),
      hero: {
        ...DEFAULT_HOMEPAGE_CONFIG.hero,
        ...(raw.hero || {})
      },
      announcements: (Array.isArray(raw.announcements) && raw.announcements.length)
        ? JSON.parse(JSON.stringify(raw.announcements))
        : JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.announcements)),
      stats: {
        ...DEFAULT_HOMEPAGE_CONFIG.stats,
        ...(raw.stats || {})
      },
      events: (Array.isArray(raw.events) && raw.events.length)
        ? JSON.parse(JSON.stringify(raw.events))
        : JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.events)),
      contact: {
        ...DEFAULT_HOMEPAGE_CONFIG.contact,
        ...(raw.contact || {})
      }
    };
  }

  // Ensure arrays and objects are always defined
  if (!Array.isArray(currentHomepageConfig.sections)) {
    currentHomepageConfig.sections = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.sections));
  }
  if (!Array.isArray(currentHomepageConfig.announcements)) {
    currentHomepageConfig.announcements = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.announcements));
  }
  if (!Array.isArray(currentHomepageConfig.events)) {
    currentHomepageConfig.events = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONFIG.events));
  }
  if (!currentHomepageConfig.hero) {
    currentHomepageConfig.hero = { ...DEFAULT_HOMEPAGE_CONFIG.hero };
  }
  if (!currentHomepageConfig.stats) {
    currentHomepageConfig.stats = { ...DEFAULT_HOMEPAGE_CONFIG.stats };
  }
  if (!currentHomepageConfig.contact) {
    currentHomepageConfig.contact = { ...DEFAULT_HOMEPAGE_CONFIG.contact };
  }

  return currentHomepageConfig;
}

function renderHomepageCMS() {
  const cfg = getHomepageConfig();
  if (!$('#cms-sections-tbody')) return;

  // 1. Render Sections table (Reorder & Toggle)
  const tbody = $('#cms-sections-tbody');
  const sections = cfg.sections || DEFAULT_HOMEPAGE_CONFIG.sections;

  tbody.innerHTML = sections.map((sec, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === sections.length - 1;
    const isEnabled = sec.enabled !== false;
    return `
      <tr class="${isEnabled ? '' : 'table-light opacity-75'}">
        <td class="text-center">
          <input type="checkbox" class="form-check-input cms-section-toggle" data-id="${esc(sec.id)}" ${isEnabled ? 'checked' : ''} style="cursor:pointer;">
        </td>
        <td class="text-center font-monospace fw-bold text-muted">${idx + 1}</td>
        <td>
          <strong class="text-navy">${esc(sec.name)}</strong>
          <small class="text-muted d-block font-monospace">id: ${esc(sec.id)}</small>
        </td>
        <td class="text-center">
          ${isEnabled ? '<span class="badge bg-success">🟢 เปิดแสดงผล</span>' : '<span class="badge bg-secondary">⚪ ซ่อนไว้</span>'}
        </td>
        <td class="text-center">
          <button type="button" class="btn btn-outline-secondary btn-xs btn-cms-up me-1" data-id="${esc(sec.id)}" ${isFirst ? 'disabled' : ''} title="เลื่อนขึ้น">⬆️</button>
          <button type="button" class="btn btn-outline-secondary btn-xs btn-cms-down" data-id="${esc(sec.id)}" ${isLast ? 'disabled' : ''} title="เลื่อนลง">⬇️</button>
        </td>
      </tr>
    `;
  }).join('');

  // Wire toggle and move buttons
  $$('.cms-section-toggle').forEach(chk => {
    chk.onchange = () => {
      syncAllCurrentForm();
      const sec = sections.find(s => s.id === chk.dataset.id);
      if (sec) {
        sec.enabled = chk.checked;
        renderHomepageCMS();
      }
    };
  });

  $$('.btn-cms-up').forEach(btn => {
    btn.onclick = () => {
      syncAllCurrentForm();
      const idx = sections.findIndex(s => s.id === btn.dataset.id);
      if (idx > 0) {
        const temp = sections[idx];
        sections[idx] = sections[idx - 1];
        sections[idx - 1] = temp;
        renderHomepageCMS();
      }
    };
  });

  $$('.btn-cms-down').forEach(btn => {
    btn.onclick = () => {
      syncAllCurrentForm();
      const idx = sections.findIndex(s => s.id === btn.dataset.id);
      if (idx >= 0 && idx < sections.length - 1) {
        const temp = sections[idx];
        sections[idx] = sections[idx + 1];
        sections[idx + 1] = temp;
        renderHomepageCMS();
      }
    };
  });

  // 2. Wire Tab headers
  $$('#cms-content-tabs [data-cms-tab]').forEach(tabBtn => {
    tabBtn.classList.toggle('active', tabBtn.dataset.cmsTab === activeCmsTab);
    tabBtn.onclick = () => {
      syncAllCurrentForm();
      activeCmsTab = tabBtn.dataset.cmsTab;
      renderHomepageCMS();
    };
  });

  // 3. Render Form for activeCmsTab
  renderCmsTabContent(activeCmsTab, cfg);

  // Auto-sync form changes live on input/change
  const contentBody = $('#cms-content-body');
  if (contentBody) {
    contentBody.oninput = () => syncAllCurrentForm();
    contentBody.onchange = () => syncAllCurrentForm();
  }

  // Wire all Save buttons
  $$('.btn-save-homepage-cms-action, #btn-save-homepage-cms').forEach(b => {
    b.onclick = saveHomepageCMS;
  });
}

function syncAllCurrentForm() {
  syncCurrentCmsTabForm();
  if (activeCmsTab === 'announcements') syncAnnouncementsForm();
  if (activeCmsTab === 'events') syncEventsForm();
}

function syncCurrentCmsTabForm() {
  const cfg = getHomepageConfig();
  if (activeCmsTab === 'hero') {
    if (!cfg.hero) cfg.hero = {};
    const getVal = id => $(id)?.value || '';
    cfg.hero.badge = getVal('#cms-hero-badge');
    cfg.hero.title = getVal('#cms-hero-title');
    cfg.hero.subtitle = getVal('#cms-hero-subtitle');
    cfg.hero.description = getVal('#cms-hero-desc');
    cfg.hero.primaryBtnText = getVal('#cms-hero-btn1-txt');
    cfg.hero.primaryBtnLink = getVal('#cms-hero-btn1-link');
    cfg.hero.saenBtnText = getVal('#cms-hero-btn2-txt');
    cfg.hero.saenBtnLink = getVal('#cms-hero-btn2-link');
    cfg.hero.muenBtnText = getVal('#cms-hero-btn3-txt');
    cfg.hero.muenBtnLink = getVal('#cms-hero-btn3-link');
  } else if (activeCmsTab === 'stats') {
    if (!cfg.stats) cfg.stats = {};
    const isCustom = $('#cms-stats-mode-custom')?.checked;
    cfg.stats.mode = isCustom ? 'custom' : 'auto';
    cfg.stats.title = $('#cms-stats-title')?.value || '📊 ข้อมูลภาพรวม';
    cfg.stats.subtitle = $('#cms-stats-subtitle')?.value || 'สถิติการดำเนินงานและเครือข่ายงานบุญ';
    cfg.stats.customPersons = Number($('#cms-stats-persons')?.value || 0);
    cfg.stats.customTemples = Number($('#cms-stats-temples')?.value || 0);
    cfg.stats.customProjects = Number($('#cms-stats-projects')?.value || 0);
  } else if (activeCmsTab === 'contact') {
    if (!cfg.contact) cfg.contact = {};
    cfg.contact.title = $('#cms-contact-title')?.value || '';
    cfg.contact.subtitle = $('#cms-contact-subtitle')?.value || '';
    cfg.contact.address = $('#cms-contact-address')?.value || '';
    cfg.contact.phone = $('#cms-contact-phone')?.value || '';
    cfg.contact.lineId = $('#cms-contact-line')?.value || '';
    cfg.contact.facebook = $('#cms-contact-fb')?.value || '';
    cfg.contact.openHours = $('#cms-contact-hours')?.value || '';
  }
}

function renderCmsTabContent(tab, cfg) {
  const body = $('#cms-content-body');
  if (!body) return;

  if (tab === 'hero') {
    const h = cfg.hero || DEFAULT_HOMEPAGE_CONFIG.hero;
    body.innerHTML = `
      <h3 class="h6 fw-bold text-navy mb-3">🖼️ ปรับแต่ง Banner หัวเว็บ (Hero Section)</h3>
      <div class="row g-3">
        <div class="col-12 col-md-4">
          <label class="form-label small fw-semibold">ป้ายหัวเรื่อง (Badge):</label>
          <input class="form-control form-control-sm" id="cms-hero-badge" value="${esc(h.badge || '')}" placeholder="เช่น แพลตฟอร์มข้อมูลกลาง">
        </div>
        <div class="col-12 col-md-8">
          <label class="form-label small fw-semibold">หัวเรื่องหลัก (Main Title):</label>
          <input class="form-control form-control-sm fw-bold" id="cms-hero-title" value="${esc(h.title || '')}" placeholder="ธุดงคสถานสุราษฎร์ธานี">
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold">สโลแกน / หัวข้อย่อย (Subtitle):</label>
          <input class="form-control form-control-sm" id="cms-hero-subtitle" value="${esc(h.subtitle || '')}" placeholder="ข้อมูลข่าวสาร • โครงการ • กิจกรรม">
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold">คำอธิบายรายละเอียด (Description):</label>
          <textarea class="form-control form-control-sm" id="cms-hero-desc" rows="2">${esc(h.description || '')}</textarea>
        </div>

        <div class="col-12"><hr class="my-2"></div>
        <div class="col-12"><strong class="small text-navy">🔘 ปุ่มลัดหลัก 3 ปุ่มบน Banner:</strong></div>

        <div class="col-12 col-md-4">
          <div class="p-2 border rounded bg-light">
            <span class="badge bg-warning text-dark mb-2">ปุ่มที่ 1 (เด่น)</span>
            <label class="form-label small d-block mb-1">ข้อความ:</label>
            <input class="form-control form-control-sm mb-2" id="cms-hero-btn1-txt" value="${esc(h.primaryBtnText || '📝 ลงทะเบียนโครงการ')}">
            <label class="form-label small d-block mb-1">ลิงก์ URL:</label>
            <input class="form-control form-control-sm font-monospace" id="cms-hero-btn1-link" value="${esc(h.primaryBtnLink || 'register.html')}">
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="p-2 border rounded bg-light">
            <span class="badge bg-secondary mb-2">ปุ่มที่ 2</span>
            <label class="form-label small d-block mb-1">ข้อความ:</label>
            <input class="form-control form-control-sm mb-2" id="cms-hero-btn2-txt" value="${esc(h.saenBtnText || '🌟 กฐินแสน')}">
            <label class="form-label small d-block mb-1">ลิงก์ URL:</label>
            <input class="form-control form-control-sm font-monospace" id="cms-hero-btn2-link" value="${esc(h.saenBtnLink || 'kathin.html?type=กฐินแสน')}">
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="p-2 border rounded bg-light">
            <span class="badge bg-secondary mb-2">ปุ่มที่ 3</span>
            <label class="form-label small d-block mb-1">ข้อความ:</label>
            <input class="form-control form-control-sm mb-2" id="cms-hero-btn3-txt" value="${esc(h.muenBtnText || '🎆 กฐินหมื่น')}">
            <label class="form-label small d-block mb-1">ลิงก์ URL:</label>
            <input class="form-control form-control-sm font-monospace" id="cms-hero-btn3-link" value="${esc(h.muenBtnLink || 'kathin.html?type=กฐินหมื่น')}">
          </div>
        </div>
      </div>
    `;
  } else if (tab === 'announcements') {
    const list = cfg.announcements || [];
    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h3 class="h6 fw-bold text-navy mb-0">📢 ข่าวและประกาศสำคัญ (${list.length} รายการ)</h3>
        <button type="button" class="btn btn-sm btn-outline-primary" id="btn-cms-add-announcement">+ เพิ่มข่าวประกาศใหม่</button>
      </div>
      <div id="cms-announcement-list">
        ${list.length ? list.map((a, idx) => `
          <div class="card mb-3 border shadow-sm p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <span class="badge bg-primary">ข่าวที่ ${idx + 1}</span>
              <button type="button" class="btn btn-outline-danger btn-xs btn-del-announcement" data-idx="${idx}">🗑️ ลบข่าวนี้</button>
            </div>
            <div class="row g-2">
              <div class="col-12 col-md-7">
                <label class="form-label small fw-semibold">หัวข้อข่าว:</label>
                <input class="form-control form-control-sm fw-bold ann-title" data-idx="${idx}" value="${esc(a.title)}">
              </div>
              <div class="col-12 col-md-3">
                <label class="form-label small fw-semibold">ป้ายกำกับ (Badge):</label>
                <input class="form-control form-control-sm ann-badge" data-idx="${idx}" value="${esc(a.badge || '📢 ประกาศ')}">
              </div>
              <div class="col-12 col-md-2">
                <label class="form-label small fw-semibold">วันที่แสดง:</label>
                <input class="form-control form-control-sm ann-date" data-idx="${idx}" value="${esc(a.date || '')}">
              </div>
              <div class="col-12">
                <label class="form-label small fw-semibold">เนื้อหาข่าว:</label>
                <textarea class="form-control form-control-sm ann-content" data-idx="${idx}" rows="2">${esc(a.content || '')}</textarea>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small fw-semibold">ลิงก์อ่านต่อ / ดำเนินการ (URL):</label>
                <input class="form-control form-control-sm font-monospace ann-link" data-idx="${idx}" value="${esc(a.link || '')}">
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small fw-semibold">ข้อความปุ่มลิงก์:</label>
                <input class="form-control form-control-sm ann-linktext" data-idx="${idx}" value="${esc(a.linkText || 'อ่านรายละเอียด →')}">
              </div>
            </div>
          </div>
        `).join('') : '<div class="alert alert-light text-center py-4">ยังไม่มีข่าวประกาศ คลิกปุ่ม "+ เพิ่มข่าวประกาศใหม่" เพื่อเริ่มสร้าง</div>'}
      </div>
    `;

    const addAnnBtn = $('#btn-cms-add-announcement');
    if (addAnnBtn) {
      addAnnBtn.onclick = (e) => {
        e.preventDefault();
        syncAnnouncementsForm();
        if (!Array.isArray(cfg.announcements)) cfg.announcements = [];
        cfg.announcements.push({
          id: `ann-${Date.now()}`,
          title: 'หัวข้อประกาศใหม่',
          badge: '📢 ประกาศ',
          badgeColor: 'danger',
          date: new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
          content: 'ระบุรายละเอียดข่าวประกาศที่นี่...',
          link: 'register.html',
          linkText: 'อ่านรายละเอียด →'
        });
        renderHomepageCMS();
      };
    }

    $$('.btn-del-announcement').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        syncAnnouncementsForm();
        if (Array.isArray(cfg.announcements)) {
          cfg.announcements.splice(Number(btn.dataset.idx), 1);
        }
        renderHomepageCMS();
      };
    });
  } else if (tab === 'stats') {
    const s = cfg.stats || DEFAULT_HOMEPAGE_CONFIG.stats;
    const isAuto = s.mode !== 'custom';
    body.innerHTML = `
      <h3 class="h6 fw-bold text-navy mb-3">📊 ปรับแต่งตัวเลขสถิติภาพรวม</h3>
      <div class="card p-3 bg-light mb-3">
        <label class="form-label small fw-bold mb-2">เลือกรูปแบบการแสดงตัวเลขสถิติ:</label>
        <div class="form-check mb-2">
          <input class="form-check-input" type="radio" name="statsMode" id="cms-stats-mode-auto" value="auto" ${isAuto ? 'checked' : ''}>
          <label class="form-check-label fw-semibold" for="cms-stats-mode-auto">
            ⚡ คำนวณอัตโนมัติจากฐานข้อมูลจริง (Auto from Database)
          </label>
          <small class="text-muted d-block">ระบบจะนับจำนวนบุคคล วัด และโครงการที่เปิดรับสมัครจริงในระบบแบบเรียลไทม์</small>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" name="statsMode" id="cms-stats-mode-custom" value="custom" ${!isAuto ? 'checked' : ''}>
          <label class="form-check-label fw-semibold" for="cms-stats-mode-custom">
            ✍️ กำหนดตัวเลขเองตามต้องการ (Custom Numbers)
          </label>
          <small class="text-muted d-block">สามารถกรอกตัวเลขยอดรวมตามที่ผู้บริหารต้องการแสดงได้</small>
        </div>
      </div>

      <div class="row g-3">
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">หัวข้อส่วนสถิติ:</label>
          <input class="form-control form-control-sm" id="cms-stats-title" value="${esc(s.title || '📊 ข้อมูลภาพรวม')}">
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">คำบรรยายรอง:</label>
          <input class="form-control form-control-sm" id="cms-stats-subtitle" value="${esc(s.subtitle || 'สถิติการดำเนินงานและเครือข่ายงานบุญ')}">
        </div>

        <div class="col-12"><hr class="my-2"><strong class="small text-navy">ตัวเลขในโหมดกำหนดเอง:</strong></div>

        <div class="col-12 col-md-4">
          <label class="form-label small fw-semibold">👥 บุคคลในระบบ (คน):</label>
          <input type="number" class="form-control form-control-sm font-monospace fs-5 text-primary" id="cms-stats-persons" value="${s.customPersons ?? 1245}">
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label small fw-semibold">🏛️ วัดในเครือข่าย (วัด):</label>
          <input type="number" class="form-control form-control-sm font-monospace fs-5 text-navy" id="cms-stats-temples" value="${s.customTemples ?? 326}">
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label small fw-semibold">📁 โครงการที่เปิดรับ (โครงการ):</label>
          <input type="number" class="form-control form-control-sm font-monospace fs-5 text-success" id="cms-stats-projects" value="${s.customProjects ?? 3}">
        </div>
      </div>
    `;
  } else if (tab === 'events') {
    const list = cfg.events || [];
    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h3 class="h6 fw-bold text-navy mb-0">📅 ตารางกิจกรรม / อบรมที่กำลังจะมาถึง (${list.length} รายการ)</h3>
        <button type="button" class="btn btn-sm btn-outline-primary" id="btn-cms-add-event">+ เพิ่มกิจกรรมใหม่</button>
      </div>
      <div id="cms-events-list">
        ${list.length ? list.map((ev, idx) => `
          <div class="card mb-3 border shadow-sm p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <span class="badge bg-info text-dark">กิจกรรมที่ ${idx + 1}</span>
              <button type="button" class="btn btn-outline-danger btn-xs btn-del-event" data-idx="${idx}">🗑️ ลบกิจกรรมนี้</button>
            </div>
            <div class="row g-2">
              <div class="col-12 col-md-6">
                <label class="form-label small fw-semibold">ชื่องาน / กิจกรรม:</label>
                <input class="form-control form-control-sm fw-bold evt-title" data-idx="${idx}" value="${esc(ev.title)}">
              </div>
              <div class="col-12 col-md-3">
                <label class="form-label small fw-semibold">วันที่จัดงาน:</label>
                <input class="form-control form-control-sm evt-date" data-idx="${idx}" value="${esc(ev.date || '')}">
              </div>
              <div class="col-12 col-md-3">
                <label class="form-label small fw-semibold">เวลา:</label>
                <input class="form-control form-control-sm evt-time" data-idx="${idx}" value="${esc(ev.time || '')}">
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small fw-semibold">สถานที่จัดงาน:</label>
                <input class="form-control form-control-sm evt-location" data-idx="${idx}" value="${esc(ev.location || '')}">
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label small fw-semibold">รายละเอียดกิจกรรม:</label>
                <input class="form-control form-control-sm evt-desc" data-idx="${idx}" value="${esc(ev.description || '')}">
              </div>
            </div>
          </div>
        `).join('') : '<div class="alert alert-light text-center py-4">ยังไม่มีรายการกิจกรรม คลิกปุ่ม "+ เพิ่มกิจกรรมใหม่" เพื่อเริ่มสร้าง</div>'}
      </div>
    `;

    const addEvtBtn = $('#btn-cms-add-event');
    if (addEvtBtn) {
      addEvtBtn.onclick = (e) => {
        e.preventDefault();
        syncEventsForm();
        if (!Array.isArray(cfg.events)) cfg.events = [];
        cfg.events.push({
          id: `evt-${Date.now()}`,
          title: 'กิจกรรมใหม่',
          date: 'กำหนดการเร็วๆ นี้',
          time: '09:00 น.',
          location: 'ธุดงคสถานสุราษฎร์ธานี',
          description: 'รายละเอียดกิจกรรม...'
        });
        renderHomepageCMS();
      };
    }

    $$('.btn-del-event').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        syncEventsForm();
        if (Array.isArray(cfg.events)) {
          cfg.events.splice(Number(btn.dataset.idx), 1);
        }
        renderHomepageCMS();
      };
    });
  } else if (tab === 'contact') {
    const c = cfg.contact || DEFAULT_HOMEPAGE_CONFIG.contact;
    body.innerHTML = `
      <h3 class="h6 fw-bold text-navy mb-3">📞 ปรับแต่งข้อมูลติดต่อธุดงคสถานสุราษฎร์ธานี</h3>
      <div class="row g-3">
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">หัวข้อส่วนติดต่อ:</label>
          <input class="form-control form-control-sm" id="cms-contact-title" value="${esc(c.title || '')}">
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">คำบรรยาย:</label>
          <input class="form-control form-control-sm" id="cms-contact-subtitle" value="${esc(c.subtitle || '')}">
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold">ที่อยู่สถานที่ตั้ง:</label>
          <textarea class="form-control form-control-sm" id="cms-contact-address" rows="2">${esc(c.address || '')}</textarea>
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">เบอร์โทรศัพท์ติดต่อ:</label>
          <input class="form-control form-control-sm" id="cms-contact-phone" value="${esc(c.phone || '')}">
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">LINE ID:</label>
          <input class="form-control form-control-sm" id="cms-contact-line" value="${esc(c.lineId || '')}">
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">Facebook Page:</label>
          <input class="form-control form-control-sm" id="cms-contact-fb" value="${esc(c.facebook || '')}">
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label small fw-semibold">เวลาทำการ:</label>
          <input class="form-control form-control-sm" id="cms-contact-hours" value="${esc(c.openHours || '')}">
        </div>
      </div>
    `;
  }
}

function syncAnnouncementsForm() {
  const cfg = getHomepageConfig();
  if (!Array.isArray(cfg.announcements)) cfg.announcements = [];
  $$('.ann-title').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.announcements[idx]) cfg.announcements[idx] = {};
    cfg.announcements[idx].title = el.value;
  });
  $$('.ann-badge').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.announcements[idx]) cfg.announcements[idx] = {};
    cfg.announcements[idx].badge = el.value;
  });
  $$('.ann-date').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.announcements[idx]) cfg.announcements[idx] = {};
    cfg.announcements[idx].date = el.value;
  });
  $$('.ann-content').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.announcements[idx]) cfg.announcements[idx] = {};
    cfg.announcements[idx].content = el.value;
  });
  $$('.ann-link').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.announcements[idx]) cfg.announcements[idx] = {};
    cfg.announcements[idx].link = el.value;
  });
  $$('.ann-linktext').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.announcements[idx]) cfg.announcements[idx] = {};
    cfg.announcements[idx].linkText = el.value;
  });
}

function syncEventsForm() {
  const cfg = getHomepageConfig();
  if (!Array.isArray(cfg.events)) cfg.events = [];
  $$('.evt-title').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.events[idx]) cfg.events[idx] = {};
    cfg.events[idx].title = el.value;
  });
  $$('.evt-date').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.events[idx]) cfg.events[idx] = {};
    cfg.events[idx].date = el.value;
  });
  $$('.evt-time').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.events[idx]) cfg.events[idx] = {};
    cfg.events[idx].time = el.value;
  });
  $$('.evt-location').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.events[idx]) cfg.events[idx] = {};
    cfg.events[idx].location = el.value;
  });
  $$('.evt-desc').forEach(el => {
    const idx = Number(el.dataset.idx);
    if (!cfg.events[idx]) cfg.events[idx] = {};
    cfg.events[idx].description = el.value;
  });
}

async function saveHomepageCMS() {
  syncAllCurrentForm();

  const cfg = getHomepageConfig();
  const btns = $$('.btn-save-homepage-cms-action, #btn-save-homepage-cms');
  btns.forEach(b => {
    b.disabled = true;
    b.textContent = '⏳ กำลังบันทึก...';
  });

  try {
    const res = await api('admin-data', {
      method: 'POST',
      body: JSON.stringify({
        entity: 'homepageConfig',
        config: cfg
      })
    });
    data.homepageConfig = JSON.parse(JSON.stringify(cfg));
    currentHomepageConfig = JSON.parse(JSON.stringify(cfg));
    toast('บันทึกการตั้งค่าหน้าแรกสำเร็จแล้ว');
    const alertEl = $('#homepage-cms-alert');
    if (alertEl) {
      alertEl.innerHTML = `<div class="alert alert-success alert-dismissible fade show shadow-sm">✅ <strong>บันทึกการตั้งค่าหน้าแรกสำเร็จ</strong> — การจัดลำดับและเนื้อหาถูกอัปเดตลง Google Sheets และแสดงผลบนหน้าแรกเรียบร้อยแล้ว <a href="index.html" target="_blank" class="alert-link ms-2">👁️ เปิดดูหน้าแรกจริงทันที</a><button class="btn-close" data-bs-dismiss="alert"></button></div>`;
      alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    alertUser(err.message || 'บันทึกการตั้งค่าหน้าแรกไม่สำเร็จ');
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      b.textContent = '💾 บันทึกการเปลี่ยนแปลงหน้าแรก';
    });
  }
}

function renderPersons(filterPersons) {
  // Update view mode toggle buttons
  const btnCards = $('#btn-person-view-cards');
  const btnTable = $('#btn-person-view-table');
  if (btnCards && btnTable) {
    btnCards.classList.toggle('active', adminPersonViewMode === 'cards');
    btnCards.classList.toggle('btn-primary', adminPersonViewMode === 'cards');
    btnCards.classList.toggle('btn-outline-primary', adminPersonViewMode !== 'cards');

    btnTable.classList.toggle('active', adminPersonViewMode === 'table');
    btnTable.classList.toggle('btn-primary', adminPersonViewMode === 'table');
    btnTable.classList.toggle('btn-outline-primary', adminPersonViewMode !== 'table');

    btnCards.onclick = () => { adminPersonViewMode = 'cards'; renderPersons(filterPersons); };
    btnTable.onclick = () => { adminPersonViewMode = 'table'; renderPersons(filterPersons); };
  }

  const rows = filterPersons ?? (data.persons || []);
  const thaiDate = d => { if (!d) return '-'; try { const [y,m,day]=d.split('-'); return `${+day}/${m}/${+y+543}`; } catch { return d; } };
  const tableContainer = $('#person-table');

  if (!rows.length) {
    tableContainer.innerHTML = '<p class="text-muted p-3 text-center mb-0">ไม่พบข้อมูลบุคคล</p>';
    return;
  }

  if (adminPersonViewMode === 'cards') {
    tableContainer.innerHTML = `
      <div class="row g-2">
        ${rows.map(p => `
          <div class="col-12 col-md-6 col-xl-4">
            <div class="mobile-data-card">
              <div class="mobile-card-header">
                <div>
                  <h4 class="mobile-card-title">${esc(p.prefix||'')} ${esc(p.monasticName||'')} ${esc(p.firstName||'')} ${esc(p.lastName||'')}</h4>
                  <small class="text-muted font-monospace">${esc(p.personId)}</small>
                </div>
                <div>
                  <span class="badge bg-${p.status==='INACTIVE'?'secondary':'success'}">${esc(p.status||'ACTIVE')}</span>
                </div>
              </div>
              ${p.prefix === 'พระ' ? `
              <div class="mobile-card-row">
                <span class="mobile-card-label">ข้อมูลพระ:</span>
                <span class="mobile-card-val">บวช: ${thaiDate(p.ordinationDate)} ${p.phansa ? `(${p.phansa} พรรษา)` : ''}</span>
              </div>` : ''}
              <div class="mobile-card-row">
                <span class="mobile-card-label">เบอร์โทร:</span>
                <span class="mobile-card-val">${p.mobile ? `<a href="tel:${esc(p.mobile)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none">📱 ${esc(p.mobile)}</a>` : '-'}</span>
              </div>
              <div class="mobile-card-row">
                <span class="mobile-card-label">เลขบัตร:</span>
                <span class="mobile-card-val"><span class="badge ${p.nationalId ? 'bg-primary-subtle text-primary' : 'bg-light text-muted'}">${p.nationalId ? '🪪 มีข้อมูลในระบบ' : 'ไม่มี'}</span></span>
              </div>
              <div class="mobile-card-row">
                <span class="mobile-card-label">วันเกิด / อายุ:</span>
                <span class="mobile-card-val">${thaiDate(p.birthDate)} ${p.age ? `(อายุ ${p.age} ปี)` : ''}</span>
              </div>
              <div class="mobile-card-actions">
                <button class="btn btn-sm btn-outline-primary edit-person" data-id="${esc(p.personId)}">✏️ แก้ไข</button>
                <button class="btn btn-sm btn-outline-info view-person-history" data-id="${esc(p.personId)}">📜 ประวัติการสมัคร</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    tableContainer.innerHTML = `
      <div class="table-responsive">
        <table class="table table-hover align-middle small">
          <thead class="table-light"><tr><th>ชื่อ-นามสกุล</th><th>ข้อมูลพระ</th><th>ติดต่อ</th><th>วันเกิด / อายุ</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>${rows.map(p => `<tr>
            <td>
              <strong>${esc(p.prefix||'')} ${esc(p.monasticName||'')} ${esc(p.firstName||'')} ${esc(p.lastName||'')}</strong>
              <br><small class="text-muted font-monospace">${esc(p.personId)}</small>
            </td>
            <td>${p.prefix==='พระ'?`<small>บวช: ${thaiDate(p.ordinationDate)}</small>`:'-'}</td>
            <td>
              <small>📱 ${p.mobile ? `<a href="tel:${esc(p.mobile)}" class="text-decoration-none">${esc(p.mobile)}</a>` : '-'}</small><br>
              <small class="text-muted">🪪 ${p.nationalId?'มีข้อมูล':'ไม่มี'}</small>
            </td>
            <td><small>${thaiDate(p.birthDate)}<br>${p.age?p.age+' ปี':''}</small></td>
            <td><span class="badge bg-${p.status==='INACTIVE'?'secondary':'success'}">${esc(p.status||'ACTIVE')}</span></td>
            <td class="text-nowrap text-end">
              <button class="btn btn-xs btn-outline-primary edit-person" data-id="${esc(p.personId)}">แก้ไข</button>
              <button class="btn btn-xs btn-outline-info view-person-history" data-id="${esc(p.personId)}" title="ประวัติการสมัคร">ประวัติ</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  }

  $$('.edit-person').forEach(b => b.onclick = () => editPerson(b.dataset.id));
  $$('.view-person-history').forEach(b => b.onclick = () => viewPersonHistory(b.dataset.id));
}
function editPerson(id) {
  const p = data.persons.find(x => x.personId === id) || {};
  showModal('แก้ไขข้อมูลบุคคล', `
    <input type="hidden" name="personId" value="${esc(p.personId||'')}">
    <div class="alert alert-info small mb-3">
      <strong>Persons Master</strong> — ข้อมูลปัจจุบันของบุคคล การแก้ไขที่นี่จะอัปเดต Master เท่านั้น<br>
      ข้อมูลใน Registration (Snapshot) จะไม่เปลี่ยนย้อนหลัง
    </div>
    <div class="row">
      <div class="col-md-3">${select('คำนำหน้า','prefix',p.prefix||'', [{value:'พระ',label:'พระ'},{value:'นาย',label:'นาย'},{value:'นาง',label:'นาง'},{value:'นางสาว',label:'นางสาว'},{value:'เด็กชาย',label:'เด็กชาย'},{value:'เด็กหญิง',label:'เด็กหญิง'},{value:'อื่น ๆ',label:'อื่น ๆ'}])}</div>
      <div class="col-md-3">${field('ฉายา (สำหรับพระ)', 'monasticName', p.monasticName||'')}</div>
      <div class="col-md-3">${field('ชื่อ','firstName',p.firstName||'','text',true)}</div>
      <div class="col-md-3">${field('นามสกุล','lastName',p.lastName||'','text',true)}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('เบอร์มือถือ','mobile',p.mobile||'','tel')}</div>
      <div class="col-md-6">${field('เลขบัตรประชาชน','nationalId',p.nationalId||'')}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${field('วันเกิด (YYYY-MM-DD)','birthDate',p.birthDate||'','date')}</div>
      <div class="col-md-4">${field('วันบวช (YYYY-MM-DD)','ordinationDate',p.ordinationDate||'','date')}</div>
      <div class="col-md-4">${field('อายุ (คำนวณอัตโนมัติ)','age',p.age||'','number')}</div>
    </div>
    ${select('สถานะ','status',p.status||'ACTIVE',[{value:'ACTIVE',label:'ใช้งาน'},{value:'INACTIVE',label:'ปิดใช้งาน'}])}
  `, { type: 'person', mode: 'update' });
}
function viewPersonHistory(id) {
  const p = data.persons.find(x => x.personId === id);
  if (!p) return;
  const regs = (data.registrations || []).filter(r => r.personId === id);
  const regHtml = regs.length ? `<table class="table table-sm"><thead><tr><th>โครงการ</th><th>รุ่น</th><th>วัน</th><th>สถานะ</th></tr></thead><tbody>${regs.map(r=>`<tr><td>${esc(r.projectName||'-')}</td><td>${esc(r.sessionLabel||'-')}</td><td>${esc(String(r.registeredAt||'').slice(0,10))}</td><td>${esc(r.status||'ACTIVE')}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">ยังไม่มีประวัติการสมัคร</p>';
  const fullName = `${p.prefix||''} ${p.monasticName||''} ${p.firstName||''} ${p.lastName||''}`.trim();
  // Reuse the editor modal for display only (no save button needed — we show info panel only)
  editContext = { type: '__history__' };
  $('#modal-title').textContent = `ประวัติการสมัคร: ${fullName}`;
  $('#modal-body').innerHTML = `
    <div class="mb-3">
      <strong>${esc(fullName)}</strong><br>
      <small class="text-muted">${esc(p.personId)} · 📱 ${esc(p.mobile||'-')}</small>
    </div>
    <h6>ประวัติการลงทะเบียน (${regs.length} ครั้ง)</h6>
    ${regHtml}
  `;
  // Hide save button by adding class
  document.querySelector('#editor-modal .modal-footer button[type="submit"]').style.display = 'none';
  modal.show();
  // Restore save button when modal closes
  document.getElementById('editor-modal').addEventListener('hidden.bs.modal', () => {
    document.querySelector('#editor-modal .modal-footer button[type="submit"]').style.display = '';
  }, { once: true });
}
async function searchPersons() {
  const q = $('#person-search').value.trim().toLowerCase();
  if (!q) { renderPersons(); return; }
  const filtered = (data.persons || []).filter(p =>
    [`${p.firstName} ${p.lastName}`, p.monasticName, p.mobile, p.personId].some(v => String(v||'').toLowerCase().includes(q))
  );
  renderPersons(filtered);
}
function editRegistration(id) { 
  const r = (data.registrations || []).find(x => x.registrationId === id); 
  if (!r) return;
  const sessionOptions = (data.sessions || []).map(b => ({ value: b.sessionId, label: `${b.sessionLabel} (${b.displayDate || ''})` })); 
  const projectOptions = (data.projects || []).map(p => ({ value: p.projectId, label: p.projectName }));

  const statusOptions = [
    { value: 'ACTIVE', label: '🟢 ลงทะเบียน (ACTIVE)' },
    { value: 'ATTENDED', label: '🔵 มาเข้าร่วม (ATTENDED)' },
    { value: 'ABSENT', label: '🟠 ไม่มาเข้าร่วม (ABSENT)' },
    { value: 'CANCELLED', label: '⚪ ยกเลิก (CANCELLED)' }
  ];

  const currentStatusKey = getRegStatusMeta(r.status).key;

  const changerAlert = r.updatedBy ? `
    <div class="alert alert-light border small py-2 px-3 mb-3 d-flex align-items-center justify-content-between">
      <div>
        <span class="text-secondary fw-semibold">👤 แก้ไขล่าสุดโดย:</span> <strong class="text-dark">${esc(r.updatedBy)}</strong>
        ${r.updatedAt ? `<span class="text-muted ms-2">(${esc(formatDateTime(r.updatedAt))})</span>` : ''}
      </div>
      <span class="badge bg-secondary-subtle text-secondary">บันทึกการแก้ไข</span>
    </div>
  ` : '';

  showModal('แก้ไขข้อมูลผู้สมัคร', `
    <input type="hidden" name="registrationId" value="${esc(r.registrationId)}">
    ${changerAlert}
    <div class="alert alert-warning small py-2 mb-3">⚡ <strong>โหมด Admin Override</strong> สามารถย้ายรอบ หรือปรับปรุงข้อมูลผู้สมัครได้ทันที</div>
    <div class="row">
      <div class="col-md-6">${select('โครงการ', 'projectId', r.projectId, projectOptions)}</div>
      <div class="col-md-6">${select('รุ่น / รอบ', 'sessionId', r.sessionId, sessionOptions)}</div>
    </div>
    <div class="row">
      <div class="col-md-12">${field('ชื่อวัด', 'templeName', r.templeName, 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${field('ตำบล', 'subdistrict', r.subdistrict, 'text', true)}</div>
      <div class="col-md-4">${field('อำเภอ', 'district', r.district, 'text', true)}</div>
      <div class="col-md-4">${field('จังหวัด', 'province', r.province, 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-3">${field('คำนำหน้า', 'prefix', r.prefix, 'text', true)}</div>
      <div class="col-md-3">${field('ฉายา', 'monasticName', r.monasticName)}</div>
      <div class="col-md-3">${field('ชื่อ', 'firstName', r.firstName, 'text', true)}</div>
      <div class="col-md-3">${field('นามสกุล', 'lastName', r.lastName, 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${field('มือถือ', 'mobile', r.mobile, 'tel', true)}</div>
      <div class="col-md-4">${field('บัตรประชาชน', 'nationalId', r.nationalId)}</div>
      <div class="col-md-4">${field('วันเกิด', 'birthDate', r.birthDate, 'date')}</div>
    </div>
    <div class="row">
      <div class="col-md-12">
        ${select('สถานะผู้สมัคร', 'status', currentStatusKey, statusOptions)}
      </div>
    </div>
    <div class="form-check mt-2">
      <input class="form-check-input" type="checkbox" name="allowDuplicate" value="true" id="allow-duplicate">
      <label class="form-check-label small" for="allow-duplicate">ยืนยัน override กรณีพบข้อมูลซ้ำ</label>
    </div>
  `, { type: 'registration', mode: 'update' }); 
}
function addRegistration() {
  const curProj = $('#registration-project-filter')?.value || data.projects[0]?.projectId || 'PRJ-1';
  const availableSessions = (data.sessions || []).filter(s => !curProj || s.projectId === curProj);
  const sessionList = availableSessions.length ? availableSessions : (data.sessions || []);
  const opts = sessionList.map(b => ({
    value: b.sessionId,
    label: `${b.sessionLabel} (${b.count}/${b.capacity||'∞'})`
  }));

  const templeDatalist = (data.temples || []).slice(0, 300).map(t =>
    `<option value="${esc(t.templeName)}">${esc(t.subdistrict || '')} ${esc(t.district || '')} ${esc(t.province || '')}</option>`
  ).join('');

  showModal('เพิ่มรายชื่อโดยผู้ดูแล', `
    <div class="alert alert-warning small py-2 mb-3">
      ⚡ <strong>โหมด Admin Override</strong> — สามารถเพิ่มเกินจำนวนรับได้ และเลือกลิงก์กับบุคคลเดิมในระบบได้ทันที
    </div>

    <!-- ช่องค้นหาบุคคลเดิมในระบบ (Persons Master) -->
    <div class="person-lookup-box mb-3">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <label class="form-label small fw-bold mb-0 text-navy">
          🔍 ค้นหาบุคคลเดิมในระบบ (Persons Master)
        </label>
        <span class="badge bg-primary-subtle text-primary small" id="admin-person-count-badge">
          มีบุคคลในระบบ ${data.persons?.length || 0} คน
        </span>
      </div>
      <div class="position-relative">
        <div class="input-group input-group-sm">
          <span class="input-group-text bg-white">🔎</span>
          <input type="text" id="admin-person-search-input" class="form-control" placeholder="พิมพ์ชื่อ, นามสกุล, ฉายา, เบอร์โทร หรือเลขบัตร (2 ตัวขึ้นไป)..." autocomplete="off">
        </div>
        <div id="admin-person-suggestions" class="position-absolute w-100 shadow rounded border bg-white mt-1 d-none" style="z-index: 1060; max-height: 220px; overflow-y: auto;"></div>
      </div>
      <div id="admin-person-selected-badge" class="d-none mt-2 p-2 bg-success bg-opacity-10 border border-success border-opacity-25 rounded d-flex justify-content-between align-items-center">
        <div>
          <span class="badge bg-success me-1">✓ ลิงก์บุคคลเดิม</span>
          <strong id="admin-selected-person-name" class="text-success"></strong>
          <small id="admin-selected-person-meta" class="text-muted ms-1"></small>
          <input type="hidden" name="personId" id="admin-selected-person-id" value="">
        </div>
        <button type="button" id="admin-btn-clear-person" class="btn btn-xs btn-outline-secondary">ยกเลิก / กรอกใหม่</button>
      </div>
      <div class="text-muted small mt-1" style="font-size:0.8rem;">
        💡 หากเป็นบุคคลที่เคยลงทะเบียนแล้ว ให้เลือกจากรายการ ระบบจะดึงข้อมูลมาเติมให้และผูก <code>personId</code> เดิมให้อัตโนมัติ
      </div>
    </div>

    ${select('รุ่นอบรม', 'sessionId', '', opts)}

    <datalist id="admin-temple-datalist">${templeDatalist}</datalist>

    <div class="row">
      <div class="col-md-6">
        <div class="mb-3">
          <label class="form-label">ชื่อวัด <span class="text-danger">*</span></label>
          <input name="templeName" id="reg-temple-name" list="admin-temple-datalist" class="form-control" placeholder="พิมพ์หรือเลือกชื่อวัด..." required autocomplete="off">
        </div>
      </div>
      <div class="col-md-2">${field('ตำบล', 'subdistrict', '', 'text', true)}</div>
      <div class="col-md-2">${field('อำเภอ', 'district', '', 'text', true)}</div>
      <div class="col-md-2">${field('จังหวัด', 'province', '', 'text', true)}</div>
    </div>

    <div class="row">
      <div class="col-md-3">${field('คำนำหน้า', 'prefix', '', 'text', true)}</div>
      <div class="col-md-3">${field('ฉายา', 'monasticName')}</div>
      <div class="col-md-3">${field('ชื่อ', 'firstName', '', 'text', true)}</div>
      <div class="col-md-3">${field('นามสกุล', 'lastName', '', 'text', true)}</div>
    </div>

    <div class="row">
      <div class="col-md-4">${field('มือถือ', 'mobile', '', 'tel', true)}</div>
      <div class="col-md-4">${field('บัตรประชาชน', 'nationalId')}</div>
      <div class="col-md-4">${field('วันเกิด', 'birthDate', '', 'date')}</div>
    </div>

    <div class="form-check mt-2">
      <input class="form-check-input" type="checkbox" name="allowDuplicate" value="true" id="allow-duplicate">
      <label class="form-check-label" for="allow-duplicate">ยืนยัน override กรณีพบข้อมูลซ้ำ</label>
    </div>
  `, { type: 'registration', mode: 'create' });

  initAdminPersonSearch();
  initAdminTempleAutocomplete();
}

function initAdminTempleAutocomplete() {
  const tInput = $('#reg-temple-name');
  if (!tInput) return;
  tInput.onchange = () => {
    const val = tInput.value.trim();
    if (!val) return;
    const t = (data.temples || []).find(x => x.templeName && x.templeName.toLowerCase() === val.toLowerCase());
    if (t) {
      const setVal = (n, v) => { const el = $(`#editor-form [name="${n}"]`); if (el && v) el.value = v; };
      setVal('subdistrict', t.subdistrict || '');
      setVal('district', t.district || '');
      setVal('province', t.province || '');
    }
  };
}

function initAdminPersonSearch() {
  const input = $('#admin-person-search-input');
  const suggestionsBox = $('#admin-person-suggestions');
  const selectedBadge = $('#admin-person-selected-badge');
  const selectedName = $('#admin-selected-person-name');
  const selectedMeta = $('#admin-selected-person-meta');
  const selectedPersonId = $('#admin-selected-person-id');
  const clearBtn = $('#admin-btn-clear-person');

  if (!input || !suggestionsBox) return;

  const persons = data.persons || [];

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) {
      suggestionsBox.classList.add('d-none');
      suggestionsBox.innerHTML = '';
      return;
    }

    const cleanDigits = q.replace(/\D/g, '');

    const matches = persons.filter(p => {
      const fullname = `${p.prefix || ''} ${p.monasticName || ''} ${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
      const mobile = String(p.mobile || '').replace(/\D/g, '');
      const nid = String(p.nationalId || '').replace(/\D/g, '');
      const pid = String(p.personId || '').toLowerCase();

      return fullname.includes(q) ||
             pid.includes(q) ||
             (cleanDigits.length >= 2 && mobile.includes(cleanDigits)) ||
             (cleanDigits.length >= 2 && nid.includes(cleanDigits));
    }).slice(0, 10);

    if (!matches.length) {
      suggestionsBox.innerHTML = '<div class="p-2 small text-muted text-center">ไม่พบบุคคลเดิมในระบบ — สามารถพิมพ์ข้อมูลใหม่ด้านล่างได้เลย</div>';
      suggestionsBox.classList.remove('d-none');
      return;
    }

    suggestionsBox.innerHTML = matches.map(p => {
      const name = `${p.prefix || ''} ${p.monasticName ? p.monasticName + ' ' : ''}${p.firstName || ''} ${p.lastName || ''}`.trim();
      const meta = [];
      if (p.mobile) meta.push(`📱 ${p.mobile}`);
      if (p.nationalId) meta.push(`🪪 ${p.nationalId}`);
      if (p.age) meta.push(`อายุ ${p.age} ปี`);
      if (p.address) meta.push(`🏠 ${p.address}`);
      return `<div class="p-2 border-bottom admin-person-opt" style="cursor:pointer;" data-id="${esc(p.personId)}">
        <div class="d-flex justify-content-between align-items-center">
          <strong class="text-primary">${esc(name)}</strong>
          <span class="badge bg-primary text-white small">เลือกลิงก์คนนี้</span>
        </div>
        <div class="small text-muted mt-1">${esc(meta.join(' · '))}</div>
      </div>`;
    }).join('');

    suggestionsBox.classList.remove('d-none');

    $$('.admin-person-opt', suggestionsBox).forEach(el => {
      el.onclick = () => {
        const id = el.dataset.id;
        const p = persons.find(x => x.personId === id);
        if (!p) return;

        if (selectedPersonId) selectedPersonId.value = p.personId;

        const setVal = (name, val) => {
          const fieldEl = $(`#editor-form [name="${name}"]`);
          if (fieldEl && val !== undefined && val !== null) fieldEl.value = val;
        };

        setVal('prefix', p.prefix || '');
        setVal('monasticName', p.monasticName || '');
        setVal('firstName', p.firstName || '');
        setVal('lastName', p.lastName || '');
        setVal('mobile', p.mobile || '');
        setVal('nationalId', p.nationalId || '');
        setVal('birthDate', p.birthDate || '');

        // Check if person has past registration with temple info
        const pastReg = (data.registrations || []).find(r => r.personId === p.personId && r.templeName);
        if (pastReg) {
          const tNameInput = $('#reg-temple-name');
          if (tNameInput && !tNameInput.value) {
            tNameInput.value = pastReg.templeName;
            setVal('subdistrict', pastReg.subdistrict || '');
            setVal('district', pastReg.district || '');
            setVal('province', pastReg.province || '');
          }
        }

        if (selectedBadge) {
          selectedName.textContent = `${p.prefix || ''} ${p.firstName || ''} ${p.lastName || ''}`;
          selectedMeta.textContent = `(${p.personId} · 📱 ${p.mobile || '-'})`;
          selectedBadge.classList.remove('d-none');
        }

        const dupCheck = $('#allow-duplicate');
        if (dupCheck) dupCheck.checked = true;

        // Highlight empty fields in admin registration form
        const formEl = $('#editor-form');
        if (formEl) {
          $$('.field-highlight-empty', formEl).forEach(el => el.classList.remove('field-highlight-empty'));
          $$('.empty-field-hint', formEl).forEach(el => el.remove());
          
          const editableFields = $$('input:not([type="hidden"]):not([readonly]):not([disabled]), select:not([disabled])', formEl);
          editableFields.forEach(el => {
            if (el.id === 'admin-person-search-input') return;
            if (!el.value.trim()) {
              el.classList.add('field-highlight-empty');
              const hint = document.createElement('div');
              hint.className = 'empty-field-hint text-warning-emphasis small mt-1';
              hint.style.fontSize = '0.78rem';
              hint.innerHTML = '✏️ ยังไม่มีข้อมูล สามารถกรอกเพิ่มได้';
              el.after(hint);

              const onInput = () => {
                if (el.value.trim()) {
                  el.classList.remove('field-highlight-empty');
                  hint.remove();
                }
              };
              el.addEventListener('input', onInput, { once: true });
              el.addEventListener('change', onInput, { once: true });
            }
          });
        }

        suggestionsBox.classList.add('d-none');
        input.value = '';
      };
    });
  });

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (selectedPersonId) selectedPersonId.value = '';
      if (selectedBadge) selectedBadge.classList.add('d-none');
      input.value = '';
      const formEl = $('#editor-form');
      if (formEl) {
        $$('.field-highlight-empty', formEl).forEach(el => el.classList.remove('field-highlight-empty'));
        $$('.empty-field-hint', formEl).forEach(el => el.remove());
      }
    };
  }
}
function editSession(id) {
  const s = (data.sessions || []).find(x => x.sessionId === id);
  const isUpdate = Boolean(s);
  const defaultProj = $('#session-project-filter')?.value || data.projects[0]?.projectId || 'PRJ-1';

  const projectOptions = (data.projects || []).map(p => ({
    value: p.projectId,
    label: `${p.projectName} (${p.status})`
  }));

  const sessionTypeOptions = [
    { value: 'BATCH', label: 'รุ่น (BATCH) เช่น รุ่นที่ 1, รุ่นที่ 2' },
    { value: 'ROUND', label: 'รอบ (ROUND) เช่น รอบเช้า, รอบบ่าย' },
    { value: 'VEHICLE', label: 'รถ/คัน (VEHICLE) เช่น รถคันที่ 1, รถบัสสายใต้' },
    { value: 'GROUP', label: 'กลุ่ม (GROUP) เช่น กลุ่ม A, สายที่ 1' },
    { value: 'TRIP', label: 'เที่ยว/เดินทาง (TRIP) เช่น เที่ยวไป, เที่ยวกลับ' },
    { value: 'OTHER', label: 'อื่น ๆ (OTHER)' },
  ];

  const deleteBtnHtml = isUpdate ? `
    <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
      <button type="button" class="btn btn-outline-danger btn-sm" id="btn-modal-del-session">🗑️ ลบ Session นี้ทิ้ง</button>
      <small class="text-muted">หากไม่ต้องการรายการนี้แล้ว สามารถกดลบได้</small>
    </div>` : '';

  showModal(isUpdate ? 'แก้ไข Session (รอบ/รุ่น/รถ/เที่ยว)' : 'เพิ่ม Session ใหม่', `
    <input type="hidden" name="sessionId" value="${esc(s?.sessionId || '')}">
    <div class="row">
      <div class="col-md-7">${select('โครงการ (Project)', 'projectId', s?.projectId || defaultProj, projectOptions)}</div>
      <div class="col-md-5">${select('ประเภท Session (Type)', 'sessionType', s?.sessionType || 'BATCH', sessionTypeOptions)}</div>
    </div>
    <div class="row">
      <div class="col-md-8">${field('ชื่อรอบ/รุ่น/รถ/เที่ยว (sessionLabel)', 'sessionLabel', s?.sessionLabel || '', 'text', true)}</div>
      <div class="col-md-4">${field('ลำดับการแสดงผล (sortOrder)', 'sortOrder', s?.sortOrder || '1', 'number')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('วันเริ่ม (startDate)', 'startDate', s?.startDate || '', 'date')}</div>
      <div class="col-md-6">${field('วันสิ้นสุด (endDate)', 'endDate', s?.endDate || '', 'date')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('เวลาเริ่ม (startTime เช่น 09:00)', 'startTime', s?.startTime || '', 'text')}</div>
      <div class="col-md-6">${field('เวลาสิ้นสุด (endTime เช่น 16:30)', 'endTime', s?.endTime || '', 'text')}</div>
    </div>
    <div class="row">
      <div class="col-md-4">${field('จำนวนรับ (0 = ไม่จำกัด)', 'capacity', s?.capacity || '0', 'number', true)}</div>
      <div class="col-md-4">${select('สถานะการรับสมัคร', 'status', s?.status || 'OPEN', [{ value: 'OPEN', label: 'เปิดรับสมัคร' }, { value: 'CLOSED', label: 'ปิดรับสมัคร' }])}</div>
      <div class="col-md-4">${select('เปิดรับสาธารณะ', 'allowPublicRegistration', String(s?.allowPublicRegistration ?? s?.publicVisible ?? 'TRUE').toLowerCase() === 'false' ? 'false' : 'true', [{ value: 'true', label: 'เปิด (แสดงบนเว็บ)' }, { value: 'false', label: 'ปิด (เฉพาะแอดมิน)' }])}</div>
    </div>
    ${deleteBtnHtml}
  `, { type: 'session', mode: isUpdate ? 'update' : 'create' });

  if (isUpdate && $('#btn-modal-del-session')) {
    $('#btn-modal-del-session').onclick = () => deleteSession(s.sessionId, s.sessionLabel);
  }
}
const editBatch = editSession;
function editTemple(id) {
  const t = data.temples.find(x => x.templeId === id) || {};
  const isUpdate = Boolean(t.templeId);
  const imgUrl = t.imageUrl || '';

  showModal(isUpdate ? `แก้ไขข้อมูลวัด: ${esc(t.templeName || '')}` : 'เพิ่มวัดใหม่', `
    <input type="hidden" name="templeId" value="${esc(t.templeId || '')}">
    ${field('ชื่อวัด', 'templeName', t.templeName || '', 'text', true)}
    <div class="row">
      <div class="col-md-4">${field('ตำบล', 'subdistrict', t.subdistrict || '', 'text')}</div>
      <div class="col-md-4">${field('อำเภอ', 'district', t.district || '', 'text')}</div>
      <div class="col-md-4">${field('จังหวัด', 'province', t.province || '', 'text', true)}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('เจ้าอาวาส / ชื่อเจ้าอาวาส', 'abbotName', t.abbotName || t.abbot || '')}</div>
      <div class="col-md-6">${field('เบอร์โทรเจ้าอาวาส', 'abbotPhone', t.abbotPhone || '', 'tel')}</div>
    </div>
    <div class="row">
      <div class="col-md-6">${field('เบอร์วัด / เบอร์ติดต่อ', 'templePhone', t.templePhone || t.phone || '', 'tel')}</div>
      <div class="col-md-6">${select('สถานะ', 'status', t.status || 'ACTIVE', [{ value: 'ACTIVE', label: 'ใช้งาน' }, { value: 'INACTIVE', label: 'ปิดใช้งาน' }])}</div>
    </div>
    <div class="row">
      <div class="col-12 mb-3">
        <label class="form-label fw-bold">🔗 ลิงก์รูปภาพวัด (Image URL)</label>
        <div class="input-group">
          <span class="input-group-text bg-white">🖼️</span>
          <input type="url" class="form-control" name="imageUrl" id="temple-image-url-input"
            placeholder="https://... วางลิงก์รูปภาพวัดจาก Facebook, เว็บไซต์วัด หรือลิงก์รูปภาพใดๆ"
            value="${esc(imgUrl)}">
          <button type="button" class="btn btn-outline-secondary" id="btn-clear-temple-img" title="ล้างลิงก์รูป">✕</button>
        </div>
        <div class="form-text text-muted small mt-1">
          💡 <strong>วิธีนำลิงก์รูปมาใส่:</strong> เปิดรูปใน Facebook หรือหน้าเว็บวัด &gt; คลิกขวาที่รูป &gt; เลือก <em>"คัดลอกที่อยู่รูปภาพ" (Copy image address)</em> แล้วนำมาวางได้ทันที
        </div>
        <div id="temple-img-preview-box" class="mt-2 p-2 border rounded bg-light text-center ${!imgUrl ? 'd-none' : ''}">
          <div class="small text-muted mb-1">ตัวอย่างภาพวัด:</div>
          <img id="temple-img-preview" src="${esc(imgUrl)}" alt="ตัวอย่างรูปวัด" style="max-height: 180px; max-width: 100%; border-radius: 6px; object-fit: contain; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <div id="temple-img-error" class="text-danger small mt-1 d-none">⚠️ ไม่สามารถโหลดรูปภาพจากลิงก์นี้ได้ โปรดตรวจสอบ URL</div>
        </div>
      </div>
    </div>
  `, { type: 'temple', mode: isUpdate ? 'update' : 'create' });

  setupImageUrlPreview('temple-image-url-input', 'temple-img-preview', 'temple-img-preview-box', 'temple-img-error', 'btn-clear-temple-img');
}
async function deleteRegistration(id) { if(!confirm('ยืนยันลบรายชื่อนี้?'))return; try{await api('admin-registration',{method:'DELETE',body:JSON.stringify({registrationId:id})});await load();}catch(e){alertUser(e.message);} }
async function deleteTemple(id) {
  if (!confirm('ยืนยันลบวัดนี้?')) return;
  try {
    await api('admin-temples', { method: 'DELETE', body: JSON.stringify({ templeId: id }) });
    selectedTempleIds.delete(id);
    updateTempleSelectionUI();
    await load();
  } catch(e) {
    alertUser(e.message);
  }
}

async function deleteSelectedTemples() {
  const count = selectedTempleIds.size;
  if (!count) return;
  if (!confirm(`ยืนยันการลบข้อมูลวัดที่เลือกจำนวน ${count} รายการใช่หรือไม่?\n(ข้อมูลที่ถูกลบออกจากฐานข้อมูลจะไม่สามารถกู้คืนได้)`)) return;

  const buttons = [$('#btn-delete-selected-temples'), $('#btn-delete-selected-temples-bar')].filter(Boolean);
  buttons.forEach(b => { b.disabled = true; b.textContent = '⏳ กำลังลบข้อมูล...'; });

  try {
    const result = await api('admin-temples', {
      method: 'DELETE',
      body: JSON.stringify({ templeIds: Array.from(selectedTempleIds) })
    });
    alertUser(`ลบข้อมูลวัดเรียบร้อยแล้ว ${result.count || count} รายการ`, 'success');
    selectedTempleIds.clear();
    updateTempleSelectionUI();
    await load();
  } catch(e) {
    alertUser(e.message);
  } finally {
    buttons.forEach(b => { b.disabled = false; b.textContent = `🗑️ ลบที่เลือก (${selectedTempleIds.size} รายการ)`; });
    updateTempleSelectionUI();
  }
}

function deselectAllTemples() {
  selectedTempleIds.clear();
  $$('.temple-item-check').forEach(cb => {
    cb.checked = false;
    cb.closest('tr')?.classList.remove('table-warning');
  });
  updateTempleSelectionUI();
}

async function bulkUpdateTempleStatus(targetStatus) {
  const count = selectedTempleIds.size;
  if (!count) return;

  const label = targetStatus === 'ACTIVE' ? 'ใช้งาน (ACTIVE)' : 'ปิดใช้งาน (INACTIVE)';
  if (!confirm(`ยืนยันการเปลี่ยนสถานะเป็น "${label}" สำหรับวัดที่เลือก ${count} รายการใช่หรือไม่?`)) return;

  const buttons = $$('.btn-bulk-temple-status');
  buttons.forEach(b => { b.disabled = true; });

  try {
    const result = await api('admin-temples', {
      method: 'PUT',
      body: JSON.stringify({
        templeIds: Array.from(selectedTempleIds),
        status: targetStatus
      })
    });
    toast(`เปลี่ยนสถานะวัดเป็น "${label}" สำเร็จ ${result.count || count} รายการ`, 'success');
    selectedTempleIds.clear();
    updateTempleSelectionUI();
    await load();
  } catch(e) {
    alertUser(e.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
  } finally {
    buttons.forEach(b => { b.disabled = false; });
    updateTempleSelectionUI();
  }
}
async function saveEditor(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  const submitBtn = event.target.querySelector('button[type="submit"]') || $('#editor-modal .modal-footer button[type="submit"]');
  const origBtnText = submitBtn ? submitBtn.textContent : 'บันทึก';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ กำลังบันทึก...';
  }
  try {
    if (editContext.type === '__history__') { modal.hide(); return; }
    if (editContext.type === 'registration' || editContext.type === 'person') {
      const mobDigits = String(form.mobile || '').replace(/\D/g, '');
      if (form.mobile && mobDigits.length !== 10) {
        throw new Error(`เบอร์มือถือต้องมี 10 หลัก (ขณะนี้ ${mobDigits.length} หลัก)`);
      }
      const nidDigits = String(form.nationalId || '').replace(/\D/g, '');
      if (form.nationalId && nidDigits.length !== 13) {
        throw new Error(`เลขบัตรประชาชนต้องมี 13 หลัก (ขณะนี้ ${nidDigits.length} หลัก)`);
      }
    }
    if (editContext.type === 'registration') await api('admin-registration', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify(form) });
    if (editContext.type === 'session') await api('admin-data', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify({ entity: 'session', ...form }) });
    if (editContext.type === 'project') await api('admin-data', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify({ entity: 'project', ...form }) });
    if (editContext.type === 'formField') await api('admin-data', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify({ entity: 'formField', ...form }) });
    if (editContext.type === 'kathin') await api('admin-data', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify({ entity: 'kathin', ...form }) });
    if (editContext.type === 'person') await api('admin-data', { method: 'PUT', body: JSON.stringify({ entity: 'person', ...form }) });
    if (editContext.type === 'temple') await api('admin-temples', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify(form) });
    if (editContext.type === 'adminUser') await api('admin-users', { method: editContext.mode === 'create' ? 'POST' : 'PUT', body: JSON.stringify(form) });
    modal.hide();
    toast('บันทึกข้อมูลเรียบร้อยแล้ว', 'success');
    await load();
  } catch(e) {
    alertUser(e.message || 'บันทึกข้อมูลไม่สำเร็จ');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = origBtnText;
    }
  }
}

function renderAdminUsers() {
  const container = $('#admin-users-container');
  if (!container) return;

  const admins = data.admins || [];
  const searchQ = ($('#admin-user-search')?.value || '').trim().toLowerCase();

  const filtered = admins.filter(a => {
    if (!searchQ) return true;
    return `${a.displayName || ''} ${a.username || ''} ${a.role || ''}`.toLowerCase().includes(searchQ);
  });

  const countBadge = $('#admin-users-count-badge');
  if (countBadge) countBadge.textContent = `ผู้ดูแลทั้งหมด ${admins.length} คน`;
  const activeBadge = $('#admin-users-active-badge');
  if (activeBadge) activeBadge.textContent = `ใช้งานอยู่ ${admins.filter(a => (a.status || 'ACTIVE').toUpperCase() !== 'INACTIVE').length} คน`;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted bg-white rounded border">
        <div class="fs-1 mb-2">👤</div>
        <p class="mb-2 fw-semibold">ไม่พบข้อมูลบัญชีผู้ดูแล</p>
        <button class="btn btn-sm btn-primary" id="btn-add-admin-empty">+ เพิ่มบัญชีผู้ดูแลใหม่</button>
      </div>
    `;
    const btnEmpty = $('#btn-add-admin-empty');
    if (btnEmpty) btnEmpty.onclick = () => editAdminUser(null);
    return;
  }

  const roleMeta = role => {
    const r = String(role || 'ADMIN').toUpperCase();
    if (r === 'SUPERADMIN') return { label: '👑 SuperAdmin (ผู้ดูแลหลัก)', badge: 'bg-danger text-white' };
    if (r === 'STAFF') return { label: '👤 Staff (เจ้าหน้าที่)', badge: 'bg-info text-dark' };
    return { label: '🛡️ Admin (ผู้ดูแลระบบ)', badge: 'bg-primary text-white' };
  };

  const statusMeta = status => {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'INACTIVE') return { label: '🔴 ปิดใช้งาน', badge: 'bg-secondary text-white' };
    return { label: '🟢 ใช้งาน', badge: 'bg-success text-white' };
  };

  container.innerHTML = `
    <div class="table-responsive bg-white rounded shadow-sm border">
      <table class="table table-hover align-middle mb-0 small">
        <thead class="table-light">
          <tr>
            <th>ชื่อที่แสดง (Display Name)</th>
            <th>ชื่อผู้ใช้ (Username)</th>
            <th>ระดับสิทธิ์ (Role)</th>
            <th>สถานะ</th>
            <th>เข้าสู่ระบบล่าสุด</th>
            <th>สร้างเมื่อ</th>
            <th class="text-end">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(a => {
            const rMeta = roleMeta(a.role);
            const sMeta = statusMeta(a.status);
            const isMe = data.currentAdmin?.username === a.username;
            const isInactive = (a.status || 'ACTIVE').toUpperCase() === 'INACTIVE';
            return `
              <tr class="${isInactive ? 'opacity-75 bg-light' : ''}">
                <td>
                  <strong>${esc(a.displayName || a.username)}</strong>
                  ${isMe ? '<span class="badge bg-success-subtle text-success ms-1 small">คุณ</span>' : ''}
                  <br><small class="text-muted font-monospace">${esc(a.adminId || '-')}</small>
                </td>
                <td><code class="text-primary fw-bold">${esc(a.username)}</code></td>
                <td><span class="badge ${rMeta.badge}">${rMeta.label}</span></td>
                <td><span class="badge ${sMeta.badge}">${sMeta.label}</span></td>
                <td><span class="text-muted">${a.lastLoginAt ? esc(formatShortDateTime(a.lastLoginAt)) : 'ยังไม่เคยเข้าสู่ระบบ'}</span></td>
                <td><span class="text-muted">${a.createdAt ? esc(formatShortDateTime(a.createdAt)) : '-'}</span></td>
                <td class="text-nowrap text-end">
                  <button type="button" class="btn btn-xs btn-outline-primary btn-edit-admin me-1" data-id="${esc(a.adminId)}">✏️ แก้ไข</button>
                  <button type="button" class="btn btn-xs ${isInactive ? 'btn-outline-success' : 'btn-outline-warning'} btn-toggle-admin-status me-1" data-id="${esc(a.adminId)}" data-status="${isInactive ? 'ACTIVE' : 'INACTIVE'}" ${isMe ? 'disabled title="ไม่สามารถปิดบัญชีของตนเองได้"' : ''}>
                    ${isInactive ? '🔓 เปิดใช้' : '🔒 ปิดใช้'}
                  </button>
                  <button type="button" class="btn btn-xs btn-outline-danger btn-delete-admin" data-id="${esc(a.adminId)}" data-username="${esc(a.username)}" ${isMe ? 'disabled title="ไม่สามารถลบบัญชีของตนเองได้"' : ''}>
                    🗑️ ลบ
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  $$('.btn-edit-admin', container).forEach(b => {
    b.onclick = () => {
      const target = (data.admins || []).find(x => x.adminId === b.dataset.id);
      editAdminUser(target);
    };
  });

  $$('.btn-toggle-admin-status', container).forEach(b => {
    b.onclick = () => toggleAdminUserStatus(b.dataset.id, b.dataset.status);
  });

  $$('.btn-delete-admin', container).forEach(b => {
    b.onclick = () => deleteAdminUser(b.dataset.id, b.dataset.username);
  });
}

function editAdminUser(adminItem) {
  const isUpdate = Boolean(adminItem && adminItem.adminId);
  const a = adminItem || {};

  const roleOptions = [
    { value: 'ADMIN', label: '🛡️ Admin (ผู้ดูแลระบบทั่วไป - เพิ่ม/แก้/ลบข้อมูล)' },
    { value: 'SUPERADMIN', label: '👑 SuperAdmin (ผู้ดูแลสูงสุด - จัดการบัญชีอื่นได้)' },
    { value: 'STAFF', label: '👤 Staff (เจ้าหน้าที่ - ตรวจสอบและลงทะเบียน)' }
  ];

  const statusOptions = [
    { value: 'ACTIVE', label: '🟢 ใช้งาน (ACTIVE)' },
    { value: 'INACTIVE', label: '🔴 ปิดใช้งาน (INACTIVE)' }
  ];

  showModal(isUpdate ? 'แก้ไขข้อมูลผู้ดูแล' : 'เพิ่มผู้ดูแลระบบใหม่', `
    ${isUpdate ? `<input type="hidden" name="adminId" value="${esc(a.adminId)}">` : ''}
    <div class="alert alert-info small py-2 mb-3">
      💡 <strong>ชื่อที่แสดง (Display Name)</strong> จะถูกนำไปบันทึกเป็นชื่อผู้แก้ไข <code>Updated By</code> ในทุกรายการที่ผู้ใช้นี้ทำการเปลี่ยนแปลง เช่น <em>"พระอาร์ม"</em> หรือ <em>"สมชาย ฝ่ายทะเบียน"</em>
    </div>
    <div class="row">
      <div class="col-md-6 mb-3">
        <label class="form-label fw-bold small">ชื่อผู้ใช้สำหรับล็อกอิน (Username) <span class="text-danger">*</span></label>
        <input type="text" class="form-control" name="username" value="${esc(a.username || '')}" ${isUpdate ? 'readonly' : 'required pattern="[a-zA-Z0-9_-]{3,}"'} placeholder="เช่น arm, somchai, staff1">
        <div class="form-text small text-muted">ภาษาอังกฤษและตัวเลข 3 ตัวขึ้นไป (ไม่สามารถเปลี่ยนได้ภายหลัง)</div>
      </div>
      <div class="col-md-6 mb-3">
        <label class="form-label fw-bold small">ชื่อที่แสดงในระบบ (Display Name) <span class="text-danger">*</span></label>
        <input type="text" class="form-control" name="displayName" value="${esc(a.displayName || a.username || '')}" required placeholder="เช่น พระอาร์ม, สมชาย ทะเบียน">
        <div class="form-text small text-muted">ชื่อที่ระบบจะบันทึกว่าใครเป็นคนเปลี่ยนข้อมูล</div>
      </div>
    </div>
    <div class="row">
      <div class="col-md-12 mb-3">
        <label class="form-label fw-bold small">รหัสผ่าน (Password) ${isUpdate ? '<span class="text-muted fw-normal">(เว้นว่างไว้หากไม่ต้องการเปลี่ยน)</span>' : '<span class="text-danger">*</span>'}</label>
        <input type="password" class="form-control" name="password" ${isUpdate ? '' : 'required'} minlength="4" placeholder="${isUpdate ? 'พิมพ์รหัสผ่านใหม่เพื่อเปลี่ยน หรือเว้นว่างไว้' : 'ตั้งรหัสผ่านอย่างน้อย 4 ตัวอักษร'}">
      </div>
    </div>
    <div class="row">
      <div class="col-md-6 mb-3">
        ${select('ระดับสิทธิ์ (Role)', 'role', a.role || 'ADMIN', roleOptions)}
      </div>
      <div class="col-md-6 mb-3">
        ${select('สถานะบัญชี', 'status', a.status || 'ACTIVE', statusOptions)}
      </div>
    </div>
  `, { type: 'adminUser', mode: isUpdate ? 'update' : 'create' });
}

async function toggleAdminUserStatus(adminId, targetStatus) {
  const target = (data.admins || []).find(x => x.adminId === adminId);
  if (!target) return;
  const label = targetStatus === 'ACTIVE' ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
  if (!confirm(`ยืนยันการ${label}บัญชี "${target.displayName || target.username}" ใช่หรือไม่?`)) return;

  try {
    await api('admin-users', {
      method: 'PUT',
      body: JSON.stringify({ adminId, status: targetStatus })
    });
    toast(`เปลี่ยนสถานะบัญชีเป็น "${label}" เรียบร้อยแล้ว`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message || 'ไม่สามารถเปลี่ยนสถานะได้');
  }
}

async function deleteAdminUser(adminId, username) {
  if (!confirm(`ยืนยันการลบบัญชีผู้ดูแล "${username}" ใช่หรือไม่?\n(บัญชีนี้จะไม่สามารถเข้าสู่ระบบได้อีก)`)) return;

  try {
    await api('admin-users', {
      method: 'DELETE',
      body: JSON.stringify({ adminId })
    });
    toast(`ลบบัญชีผู้ดูแล "${username}" เรียบร้อยแล้ว`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message || 'ไม่สามารถลบบัญชีได้');
  }
}
async function searchRegistrations(){try{const result=await api(`admin-data?q=${encodeURIComponent($('#registration-search').value)}&scope=registrations`);data.registrations=result.registrations;renderRegistrations();}catch(e){alertUser(e.message);}}
async function searchTemples(){try{const result=await api(`admin-data?q=${encodeURIComponent($('#temple-search').value)}&scope=temples`);data.temples=result.temples;renderTemples();}catch(e){alertUser(e.message);}}
async function downloadExcel(type, projectId = '') { try { const q = projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''; const response=await fetch(`/api/export-excel?type=${type}${q}`,{credentials:'same-origin'}); if(!response.ok) { const body=await response.json().catch(()=>null); throw new Error(body?.error?.message||'ไม่สามารถ export Excel ได้'); } const blob=await response.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${type}${projectId?`-${projectId}`:''}-2569.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500); }catch(e){alertUser(e.message);} }
const KATHIN_FIELD_LABELS = {
  kathinType: 'ประเภทกฐิน',
  kathinDate: 'วันทอดกฐิน',
  kathinTime: 'เวลาทอดกฐิน',
  residentMonks: 'พระจำพรรษา',
  abbotName: 'ชื่อเจ้าอาวาส',
  abbotPhone: 'เบอร์โทรเจ้าอาวาส',
  disciple1Name: 'ศิษย์คนที่ 1',
  disciple1Phone: 'เบอร์โทรศิษย์ 1',
  disciple2Name: 'ศิษย์คนที่ 2',
  disciple2Phone: 'เบอร์โทรศิษย์ 2',
  templeType: 'ประเภทวัด',
  hasLeader: 'ประธานนำกล่าว',
  subdistrict: 'ตำบล',
  district: 'อำเภอ',
  province: 'จังหวัด',
  status: 'สถานะ',
  description: 'หมายเหตุ'
};

const TEMPLE_FIELD_LABELS = {
  templeName: 'ชื่อวัด',
  subdistrict: 'ตำบล',
  district: 'อำเภอ',
  province: 'จังหวัด',
  abbotName: 'ชื่อเจ้าอาวาส',
  abbotPhone: 'เบอร์โทรเจ้าอาวาส',
  templePhone: 'เบอร์วัด / เบอร์ติดต่อ',
  status: 'สถานะ'
};

function renderImportPreviewUI({
  containerId,
  entity,
  result,
  onConfirm,
  onCancel
}) {
  const container = $(`#${containerId}`);
  if (!container) return;
  container.classList.remove('d-none');

  const isKathin = entity === 'kathin';
  const title = isKathin ? 'ตัวอย่างการนำเข้าข้อมูลกฐิน (Upsert)' : 'ตัวอย่างการนำเข้าข้อมูลวัด (Upsert)';
  const labelMap = isKathin ? KATHIN_FIELD_LABELS : TEMPLE_FIELD_LABELS;
  const updates = result.updates || [];
  const inserts = result.inserts || [];
  const errors = result.errors || [];

  container.innerHTML = `
    <div class="alert alert-info border-info shadow-sm py-3 px-3">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <div>
          <strong class="h6 mb-1 d-block text-navy">📋 ${title}: รวม ${result.totalRows} แถว</strong>
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <span class="badge bg-success py-1 px-2">+ เพิ่มใหม่ ${result.insertCount} วัด</span>
            <span class="badge bg-warning text-dark py-1 px-2">🔄 อัปเดต ${result.updateCount} วัด</span>
            ${errors.length ? `<span class="badge bg-danger py-1 px-2">⚠️ มีปัญหา ${errors.length} รายการ</span>` : ''}
            <span class="text-muted small">พร้อมดำเนินการ ${result.validRows} รายการ</span>
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <button id="${containerId}-btn-confirm-top" class="btn btn-primary btn-sm">
            ✅ ยืนยัน Import & Upsert (${result.validRows} รายการ)
          </button>
          <button id="${containerId}-btn-cancel" class="btn btn-outline-secondary btn-sm">
            ยกเลิก
          </button>
        </div>
      </div>

      <!-- Quick Action / Expand Buttons -->
      <div class="d-flex flex-wrap gap-2 pt-2 border-top border-info-subtle align-items-center">
        <small class="text-muted fw-semibold">🔍 ตรวจสอบข้อมูลก่อนยืนยัน:</small>
        ${result.updateCount > 0 ? `
          <button type="button" class="btn btn-outline-warning text-dark btn-sm py-1 px-2" id="${containerId}-tab-updates-btn">
            🔄 ดูรายละเอียดที่จะอัปเดต (${result.updateCount} วัด)
          </button>
        ` : ''}
        ${result.insertCount > 0 ? `
          <button type="button" class="btn btn-outline-success btn-sm py-1 px-2" id="${containerId}-tab-inserts-btn">
            + ดูรายละเอียดที่จะเพิ่มใหม่ (${result.insertCount} วัด)
          </button>
        ` : ''}
        ${errors.length > 0 ? `
          <button type="button" class="btn btn-outline-danger btn-sm py-1 px-2" id="${containerId}-tab-errors-btn">
            ⚠️ ดูรายการที่มีปัญหา (${errors.length})
          </button>
        ` : ''}
        <button type="button" class="btn btn-link btn-sm text-decoration-none py-1 px-2 text-muted d-none" id="${containerId}-btn-hide-details">
          ✕ ซ่อนรายละเอียด
        </button>
      </div>

      <!-- Expandable Detail Section (Initially Hidden) -->
      <div id="${containerId}-details-box" class="d-none mt-3 bg-white p-3 rounded-3 border shadow-sm">
        <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
          <ul class="nav nav-pills gap-1" id="${containerId}-detail-pills">
            ${result.updateCount > 0 ? `
              <li class="nav-item">
                <button class="nav-link active btn-sm py-1 px-3" data-target="updates">
                  🔄 รายการที่จะอัปเดต (${result.updateCount})
                </button>
              </li>
            ` : ''}
            ${result.insertCount > 0 ? `
              <li class="nav-item">
                <button class="nav-link ${result.updateCount === 0 ? 'active' : ''} btn-sm py-1 px-3" data-target="inserts">
                  + รายการที่จะเพิ่มใหม่ (${result.insertCount})
                </button>
              </li>
            ` : ''}
            ${errors.length > 0 ? `
              <li class="nav-item">
                <button class="nav-link ${result.updateCount === 0 && result.insertCount === 0 ? 'active' : ''} btn-sm py-1 px-3 text-danger" data-target="errors">
                  ⚠️ รายการที่มีปัญหา (${errors.length})
                </button>
              </li>
            ` : ''}
          </ul>
          <button type="button" class="btn-close" id="${containerId}-btn-close-box" aria-label="Close"></button>
        </div>

        <!-- Panel: Updates -->
        <div id="${containerId}-panel-updates" class="${result.updateCount > 0 ? '' : 'd-none'}">
          <div class="table-responsive" style="max-height: 420px; overflow-y: auto;">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th style="width: 50px;" class="text-center">แถว</th>
                  <th style="width: 260px;">ชื่อวัด / ที่อยู่</th>
                  <th>รายละเอียดข้อมูลที่จะอัปเดต (ค่าเดิม ➔ ค่าใหม่)</th>
                </tr>
              </thead>
              <tbody>
                ${updates.map(item => {
                  const diffs = item.diffs || [];
                  const diffHtml = diffs.length > 0 ? diffs.map(d => {
                    const label = labelMap[d.field] || d.field;
                    const oldStr = d.oldVal ? `<del class="text-danger opacity-75">${esc(d.oldVal)}</del>` : '<span class="text-muted fst-italic">(ว่าง)</span>';
                    const newStr = `<strong class="text-success">${esc(d.newVal)}</strong>`;
                    return `<div class="mb-1 small">
                      <span class="badge bg-light text-dark border me-1">${esc(label)}:</span>
                      ${oldStr} ➔ ${newStr}
                    </div>`;
                  }).join('') : `
                    <div class="small text-muted">
                      <span class="badge bg-secondary-subtle text-secondary me-1">ไม่มีข้อมูลเปลี่ยนแปลง</span>
                      (ข้อมูลในไฟล์ตรงกับฐานข้อมูลเดิม)
                    </div>
                  `;
                  return `<tr>
                    <td class="text-center text-muted small fw-bold">${item._excelRow || '-'}</td>
                    <td>
                      <strong class="text-primary">${esc(item.templeName)}</strong>
                      <br><small class="text-muted">ต.${esc(item.subdistrict || '-')} อ.${esc(item.district || '-')} จ.${esc(item.province || '-')}</small>
                    </td>
                    <td>${diffHtml}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Panel: Inserts -->
        <div id="${containerId}-panel-inserts" class="${result.updateCount === 0 && result.insertCount > 0 ? '' : 'd-none'}">
          <div class="table-responsive" style="max-height: 420px; overflow-y: auto;">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th style="width: 50px;" class="text-center">แถว</th>
                  <th>ชื่อวัด</th>
                  <th>ที่อยู่</th>
                  ${isKathin ? '<th>ประเภทกฐิน</th><th>วัน/เวลาทอด</th><th>เจ้าอาวาส / เบอร์โทร</th><th>ศิษยานุศิษย์</th>' : '<th>เจ้าอาวาส</th><th>เบอร์โทร</th>'}
                </tr>
              </thead>
              <tbody>
                ${inserts.map(item => isKathin ? `
                  <tr>
                    <td class="text-center text-muted small fw-bold">${item._excelRow || '-'}</td>
                    <td><strong class="text-success">${esc(item.templeName)}</strong></td>
                    <td class="small">ต.${esc(item.subdistrict || '-')} อ.${esc(item.district || '-')} จ.${esc(item.province || '-')}</td>
                    <td><span class="badge ${item.kathinType === 'กฐินหมื่น' ? 'bg-info text-dark' : 'bg-warning text-dark'}">${esc(item.kathinType || 'กฐินแสน')}</span></td>
                    <td class="small">${esc(item.kathinDate || '-')} ${item.kathinTime ? `<br><small class="text-muted">⏰ ${esc(item.kathinTime)}</small>` : ''}</td>
                    <td class="small">
                      <div>${esc(item.abbotName || '-')}</div>
                      ${item.abbotPhone ? `<div class="text-primary font-monospace">📱 ${esc(item.abbotPhone)}</div>` : ''}
                    </td>
                    <td class="small">
                      ${item.disciple1Name ? `<div>1. ${esc(item.disciple1Name)} ${item.disciple1Phone ? `<span class="text-muted">(${esc(item.disciple1Phone)})</span>` : ''}</div>` : ''}
                      ${item.disciple2Name ? `<div>2. ${esc(item.disciple2Name)} ${item.disciple2Phone ? `<span class="text-muted">(${esc(item.disciple2Phone)})</span>` : ''}</div>` : ''}
                      ${!item.disciple1Name && !item.disciple2Name ? '<span class="text-muted">-</span>' : ''}
                    </td>
                  </tr>
                ` : `
                  <tr>
                    <td class="text-center text-muted small fw-bold">${item._excelRow || '-'}</td>
                    <td><strong class="text-success">${esc(item.templeName)}</strong></td>
                    <td class="small">ต.${esc(item.subdistrict || '-')} อ.${esc(item.district || '-')} จ.${esc(item.province || '-')}</td>
                    <td class="small">${esc(item.abbotName || item.abbot || '-')}</td>
                    <td class="small">
                      ${item.abbotPhone ? `<div class="text-primary">📱 โทรเจ้าอาวาส: ${esc(item.abbotPhone)}</div>` : ''}
                      ${item.templePhone ? `<div class="text-muted">📞 เบอร์วัด: ${esc(item.templePhone)}</div>` : (!item.abbotPhone ? '-' : '')}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Panel: Errors -->
        ${errors.length > 0 ? `
          <div id="${containerId}-panel-errors" class="${result.updateCount === 0 && result.insertCount === 0 ? '' : 'd-none'}">
            <div class="alert alert-danger py-2 mb-0">
              <h6 class="alert-heading small fw-bold mb-2">⚠️ รายการที่มีปัญหา ไม่สามารถนำเข้าได้ (${errors.length} รายการ):</h6>
              <ul class="mb-0 small ps-3">
                ${errors.map(e => `<li><strong>แถวที่ ${e.row}:</strong> ${esc(e.message)}</li>`).join('')}
              </ul>
            </div>
          </div>
        ` : ''}

        <!-- Bottom Action inside detail box -->
        <div class="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
          <button type="button" class="btn btn-outline-secondary btn-sm" id="${containerId}-btn-close-bottom">
            ✕ ซ่อนรายละเอียด
          </button>
          <button id="${containerId}-btn-confirm-bottom" class="btn btn-primary btn-sm">
            ✅ ยืนยัน Import & Upsert (${result.validRows} รายการ)
          </button>
        </div>
      </div>
    </div>
  `;

  // Attach event handlers
  const detailsBox = $(`#${containerId}-details-box`);
  const hideBtn = $(`#${containerId}-btn-hide-details`);

  function showPanel(panelName) {
    detailsBox.classList.remove('d-none');
    if (hideBtn) hideBtn.classList.remove('d-none');
    $$(`#${containerId}-detail-pills button`).forEach(b => {
      b.classList.toggle('active', b.dataset.target === panelName);
    });
    const pUpdates = $(`#${containerId}-panel-updates`);
    const pInserts = $(`#${containerId}-panel-inserts`);
    const pErrors = $(`#${containerId}-panel-errors`);
    if (pUpdates) pUpdates.classList.toggle('d-none', panelName !== 'updates');
    if (pInserts) pInserts.classList.toggle('d-none', panelName !== 'inserts');
    if (pErrors) pErrors.classList.toggle('d-none', panelName !== 'errors');
  }

  function hideBox() {
    detailsBox.classList.add('d-none');
    if (hideBtn) hideBtn.classList.add('d-none');
  }

  const tabUpdatesBtn = $(`#${containerId}-tab-updates-btn`);
  if (tabUpdatesBtn) tabUpdatesBtn.onclick = () => showPanel('updates');

  const tabInsertsBtn = $(`#${containerId}-tab-inserts-btn`);
  if (tabInsertsBtn) tabInsertsBtn.onclick = () => showPanel('inserts');

  const tabErrorsBtn = $(`#${containerId}-tab-errors-btn`);
  if (tabErrorsBtn) tabErrorsBtn.onclick = () => showPanel('errors');

  if (hideBtn) hideBtn.onclick = hideBox;
  const closeBoxBtn = $(`#${containerId}-btn-close-box`);
  if (closeBoxBtn) closeBoxBtn.onclick = hideBox;
  const closeBottomBtn = $(`#${containerId}-btn-close-bottom`);
  if (closeBottomBtn) closeBottomBtn.onclick = hideBox;

  $$(`#${containerId}-detail-pills button`).forEach(btn => {
    btn.onclick = () => showPanel(btn.dataset.target);
  });

  const confirmTop = $(`#${containerId}-btn-confirm-top`);
  if (confirmTop) confirmTop.onclick = onConfirm;
  const confirmBottom = $(`#${containerId}-btn-confirm-bottom`);
  if (confirmBottom) confirmBottom.onclick = onConfirm;

  const cancelBtn = $(`#${containerId}-btn-cancel`);
  if (cancelBtn) cancelBtn.onclick = onCancel;
}

async function previewImport(file) {
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  try {
    const result = await api('import-excel', {
      method: 'POST',
      body: JSON.stringify({ mode: 'preview', fileName: file.name, base64 })
    });
    pendingImport = { base64, fileName: file.name };
    renderImportPreviewUI({
      containerId: 'import-preview',
      entity: 'temple',
      result,
      onConfirm: confirmImport,
      onCancel: () => {
        pendingImport = null;
        $('#import-preview').classList.add('d-none');
        const fInput = $('#excel-file');
        if (fInput) fInput.value = '';
      }
    });
  } catch(e) {
    alertUser(e.message);
  }
}

async function confirmImport() {
  const btns = [
    $('#import-preview-btn-confirm-top'),
    $('#import-preview-btn-confirm-bottom'),
    $('#confirm-import')
  ].filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.textContent = '⏳ กำลังอัปเดตข้อมูล...'; });
  try {
    const result = await api('import-excel', {
      method: 'POST',
      body: JSON.stringify({ mode: 'confirm', ...pendingImport })
    });
    pendingImport = null;
    $('#import-preview').classList.add('d-none');
    const fInput = $('#excel-file');
    if (fInput) fInput.value = '';
    alertUser(`นำเข้าข้อมูลวัดสำเร็จ: เพิ่มใหม่ ${result.inserted} วัด, อัปเดต ${result.updated} วัด`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message);
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = '✅ ยืนยัน Import & Upsert'; });
  }
}

let pendingKathinImport = null;
async function previewKathinImport(file) {
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  try {
    const result = await api('import-excel', {
      method: 'POST',
      body: JSON.stringify({ entity: 'kathin', mode: 'preview', fileName: file.name, base64 })
    });
    pendingKathinImport = { base64, fileName: file.name };
    renderImportPreviewUI({
      containerId: 'kathin-import-preview',
      entity: 'kathin',
      result,
      onConfirm: confirmKathinImport,
      onCancel: () => {
        pendingKathinImport = null;
        $('#kathin-import-preview').classList.add('d-none');
        const fInput = $('#kathin-excel-file');
        if (fInput) fInput.value = '';
      }
    });
  } catch(e) {
    alertUser(e.message);
  }
}

async function confirmKathinImport() {
  const btns = [
    $('#kathin-import-preview-btn-confirm-top'),
    $('#kathin-import-preview-btn-confirm-bottom'),
    $('#confirm-kathin-import')
  ].filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.textContent = '⏳ กำลังอัปเดตข้อมูล...'; });
  try {
    const result = await api('import-excel', {
      method: 'POST',
      body: JSON.stringify({ entity: 'kathin', mode: 'confirm', ...pendingKathinImport })
    });
    pendingKathinImport = null;
    $('#kathin-import-preview').classList.add('d-none');
    const fInput = $('#kathin-excel-file');
    if (fInput) fInput.value = '';
    alertUser(`นำเข้ากฐินสำเร็จ: เพิ่มใหม่ ${result.inserted} วัด, อัปเดต ${result.updated} วัด`, 'success');
    await load();
  } catch(e) {
    alertUser(e.message);
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = '✅ ยืนยัน Import & Upsert'; });
  }
}
async function loadReports() {
  const statusEl = $('#report-status');
  statusEl.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2"></div><span class="text-muted">กำลังโหลดรายงาน...</span>';
  try {
    const result = await api('reports');
    renderReports(result);
    statusEl.innerHTML = `<small class="text-muted">สร้างรายงาน ณ ${new Date(result.generatedAt).toLocaleString('th-TH')}</small>`;
  } catch(e) {
    statusEl.innerHTML = `<div class="alert alert-danger small py-2">${esc(e.message)}</div>`;
  }
}
async function refreshReportSheets() {
  const btn = $('#refresh-report-sheets');
  const statusEl = $('#report-status');
  btn.disabled = true; btn.textContent = '⏳ กำลัง Refresh...';
  try {
    const result = await api('reports', { method: 'POST' });
    const { written } = result;
    statusEl.innerHTML = `<div class="alert alert-success small py-2">✅ Refresh สำเร็จ — บันทึกแล้ว: รุ่น ${written.sessions} แถว · จังหวัด ${written.provinces} แถว · กฐิน ${written.kathin} แถว<br><small>Sheets ที่อัปเดต: RPT_Sessions, RPT_Provinces, RPT_Kathin</small></div>`;
    renderReports(result);
    toast('Refresh Google Sheets สำเร็จ');
  } catch(e) {
    statusEl.innerHTML = `<div class="alert alert-danger small py-2">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '📊 Refresh ลง Google Sheets';
  }
}
function renderReports(result) {
  const { summary, sessions, provinces, kathin } = result;

  // Summary cards
  if (summary) {
    const pct = (n, total) => total ? Math.round(n / total * 100) : 0;
    const t = summary.totalActive || 0;
    $('#report-summary').innerHTML = [
      ['👥 ลงทะเบียนทั้งหมด', summary.totalActive, 'navy'],
      ['📅 วันนี้', summary.todayRegistrations, 'primary'],
      ['🧡 พระภิกษุ', `${summary.monks} คน (${pct(summary.monks,t)}%)`, 'warning'],
      ['👨 อุบาสก', `${summary.layMen} คน`, 'info'],
      ['👩 อุบาสิกา', `${summary.layWomen} คน`, 'info'],
      ['🗺️ จังหวัด', `${summary.uniqueProvinces} จังหวัด`, 'secondary'],
      ['🙏 กฐินทั้งหมด', summary.kathinTotal, 'secondary'],
      ['✅ กฐินอนุมัติ', summary.kathinApproved, 'success'],
    ].map(([label, val, color]) => `
      <div class="col-6 col-md-3">
        <div class="metric">
          <div class="small text-muted">${label}</div>
          <div class="number text-${color === 'navy' ? '' : color}" style="${color==='navy'?'color:var(--navy)':''}">${esc(String(val))}</div>
        </div>
      </div>`).join('');
  }

  // Session table
  if (sessions?.length) {
    $('#report-sessions').innerHTML = `<table class="table table-hover table-sm align-middle">
      <thead class="table-light"><tr><th>โครงการ</th><th>รุ่น</th><th>จำนวนรับ</th><th>สมัครทั้งหมด</th><th>พระ</th><th>อุบาสก</th><th>อุบาสิกา</th><th>เด็ก</th><th>ยกเลิก</th></tr></thead>
      <tbody>${sessions.map(s => `<tr>
        <td><small class="text-muted">${esc(s.projectName)}</small></td>
        <td><strong>${esc(s.sessionLabel)}</strong></td>
        <td class="text-center">${esc(String(s.capacity))}</td>
        <td class="text-center"><strong>${esc(String(s.totalRegistrations))}</strong></td>
        <td class="text-center text-warning">${esc(String(s.monks))}</td>
        <td class="text-center">${esc(String(s.layMen))}</td>
        <td class="text-center">${esc(String(s.layWomen))}</td>
        <td class="text-center">${esc(String(s.children))}</td>
        <td class="text-center text-danger">${esc(String(s.cancelled))}</td>
      </tr>`).join('')}</tbody>
      <tfoot class="table-light fw-bold"><tr>
        <td colspan="3">รวม</td>
        <td class="text-center">${sessions.reduce((a,s)=>a+s.totalRegistrations,0)}</td>
        <td class="text-center text-warning">${sessions.reduce((a,s)=>a+s.monks,0)}</td>
        <td class="text-center">${sessions.reduce((a,s)=>a+s.layMen,0)}</td>
        <td class="text-center">${sessions.reduce((a,s)=>a+s.layWomen,0)}</td>
        <td class="text-center">${sessions.reduce((a,s)=>a+s.children,0)}</td>
        <td class="text-center text-danger">${sessions.reduce((a,s)=>a+s.cancelled,0)}</td>
      </tr></tfoot>
    </table>`;
  }

  // Province table
  if (provinces?.length) {
    $('#report-provinces').innerHTML = `<table class="table table-hover table-sm align-middle">
      <thead class="table-light"><tr><th>จังหวัด</th><th>ผู้สมัครทั้งหมด</th><th>พระ</th><th>ฆราวาส</th><th>จำนวนวัด</th></tr></thead>
      <tbody>${provinces.map(p => `<tr>
        <td><strong>${esc(p.province)}</strong></td>
        <td class="text-center"><strong>${esc(String(p.totalRegistrations))}</strong></td>
        <td class="text-center text-warning">${esc(String(p.monks))}</td>
        <td class="text-center">${esc(String(p.layPeople))}</td>
        <td class="text-center">${esc(String(p.uniqueTemples))}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }

  // Kathin table
  if (kathin?.length) {
    $('#report-kathin').innerHTML = `<table class="table table-hover table-sm align-middle">
      <thead class="table-light"><tr><th>ประเภทกฐิน</th><th>จำนวนวัดทั้งหมด</th><th>อนุมัติแล้ว</th><th>รอตรวจสอบ</th><th>ยกเลิก</th></tr></thead>
      <tbody>${kathin.map(k => `<tr>
        <td><strong>${esc(k.kathinType)}</strong></td>
        <td class="text-center"><strong>${esc(String(k.totalWats))}</strong></td>
        <td class="text-center text-success">${esc(String(k.approvedWats))}</td>
        <td class="text-center text-warning">${esc(String(k.pendingWats))}</td>
        <td class="text-center text-danger">${esc(String(k.cancelledWats))}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
}

// ==========================================
// DISBURSEMENTS (ระบบจัดการการเบิกปัจจัยทอดกฐิน)
// ==========================================

let disbState = {
  activeSubtab: 'dashboard',
  selectedTemples: [], // { id, name, amphoe, tambon, amount, type }
  recipient1: { id: '', name: '', phone: '' },
  recipient2: { id: '', name: '', phone: '' },
  recipient3: { id: '', name: '', phone: '' },
  donorName: 'พระอนุชา ทานิสฺสโร',
  documentDate: new Date().toISOString().substring(0, 10),
  katinSearchText: '',
  isViewingHistoryPrint: false,
  createdByName: ''
};

function formatThaiBaht(amount) {
  return Number(amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 0 });
}

function formatThaiDocDate(dateStr) {
  if (!dateStr) return '........./.............../.............';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    const thYear = Number(y) + 543;
    return `${Number(d)}/${Number(m)}/${thYear}`;
  }
  return dateStr;
}

function resetDisbFormState() {
  disbState.selectedTemples = [];
  disbState.recipient1 = { id: '', name: '', phone: '' };
  disbState.recipient2 = { id: '', name: '', phone: '' };
  disbState.recipient3 = { id: '', name: '', phone: '' };
  disbState.donorName = 'พระอนุชา ทานิสฺสโร';
  disbState.documentDate = new Date().toISOString().substring(0, 10);
  disbState.isViewingHistoryPrint = false;
  disbState.createdByName = data.currentAdmin?.displayName || data.currentAdmin?.username || '';
}

function renderDisbursements() {
  const container = $('#disbursements-pane');
  if (!container) return;

  // Bind sub-navigation buttons
  $$('#disb-nav-pills button').forEach(b => {
    b.onclick = () => {
      setDisbSubtab(b.dataset.subtab);
    };
  });

  const historyCountEl = $('#disb-history-count');
  if (historyCountEl) {
    historyCountEl.textContent = (data.disbursements || []).length;
  }

  renderDisbSubtab();
}

function setDisbSubtab(subtab) {
  disbState.activeSubtab = subtab;
  $$('#disb-nav-pills button').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === subtab);
  });
  renderDisbSubtab();
}

function renderDisbSubtab() {
  const historyCountEl = $('#disb-history-count');
  if (historyCountEl) {
    historyCountEl.textContent = (data.disbursements || []).length;
  }

  switch (disbState.activeSubtab) {
    case 'katin100K':
      renderDisbKatinTable('กฐินแสน', 100000);
      break;
    case 'katin10K':
      renderDisbKatinTable('กฐินหมื่น', 10000);
      break;
    case 'form':
      renderDisbForm();
      break;
    case 'print':
      renderDisbPrint();
      break;
    case 'history':
      renderDisbHistory();
      break;
    case 'dashboard':
    default:
      renderDisbDashboard();
      break;
  }
}

function renderDisbDashboard() {
  const kathins = data.kathin || [];
  const saenTemples = kathins.filter(k => k.kathinType === 'กฐินแสน');
  const muenTemples = kathins.filter(k => k.kathinType === 'กฐินหมื่น');

  const saenPaid = saenTemples.filter(k => String(k.disbursementStatus || '').toUpperCase() === 'PAID').length;
  const muenPaid = muenTemples.filter(k => String(k.disbursementStatus || '').toUpperCase() === 'PAID').length;

  const saenTotalAmount = saenPaid * 100000;
  const muenTotalAmount = muenPaid * 10000;
  const totalPaidAmount = saenTotalAmount + muenTotalAmount;

  const saenPct = saenTemples.length ? Math.round((saenPaid / saenTemples.length) * 100) : 0;
  const muenPct = muenTemples.length ? Math.round((muenPaid / muenTemples.length) * 100) : 0;

  const disbCount = (data.disbursements || []).length;

  $('#disb-subview-content').innerHTML = `
    <div class="row g-3 mb-4">
      <div class="col-md-3 col-sm-6">
        <div class="card h-100 border-0 shadow-sm bg-primary bg-opacity-10 border-start border-primary border-4 p-3">
          <div class="text-muted small fw-semibold">💰 ยอดเงินเบิกจ่ายรวมทั้งหมด</div>
          <div class="fs-3 fw-bold text-primary mt-1">${formatThaiBaht(totalPaidAmount)} <span class="fs-6 fw-normal text-muted">บาท</span></div>
          <div class="small text-muted mt-1">จากกฐินแสนและกฐินหมื่น</div>
        </div>
      </div>
      <div class="col-md-3 col-sm-6">
        <div class="card h-100 border-0 shadow-sm bg-success bg-opacity-10 border-start border-success border-4 p-3">
          <div class="text-muted small fw-semibold">🌟 กฐินแสน (100,000 บาท)</div>
          <div class="fs-3 fw-bold text-success mt-1">${saenPaid} / ${saenTemples.length} <span class="fs-6 fw-normal text-muted">วัด</span></div>
          <div class="progress mt-2" style="height: 6px;">
            <div class="progress-bar bg-success" style="width: ${saenPct}%"></div>
          </div>
          <div class="d-flex justify-content-between small text-muted mt-1">
            <span>จ่ายแล้ว ${saenPct}%</span>
            <span>${formatThaiBaht(saenTotalAmount)} บ.</span>
          </div>
        </div>
      </div>
      <div class="col-md-3 col-sm-6">
        <div class="card h-100 border-0 shadow-sm bg-info bg-opacity-10 border-start border-info border-4 p-3">
          <div class="text-muted small fw-semibold">🎆 กฐินหมื่น (10,000 บาท)</div>
          <div class="fs-3 fw-bold text-info mt-1">${muenPaid} / ${muenTemples.length} <span class="fs-6 fw-normal text-muted">วัด</span></div>
          <div class="progress mt-2" style="height: 6px;">
            <div class="progress-bar bg-info" style="width: ${muenPct}%"></div>
          </div>
          <div class="d-flex justify-content-between small text-muted mt-1">
            <span>จ่ายแล้ว ${muenPct}%</span>
            <span>${formatThaiBaht(muenTotalAmount)} บ.</span>
          </div>
        </div>
      </div>
      <div class="col-md-3 col-sm-6">
        <div class="card h-100 border-0 shadow-sm bg-danger bg-opacity-10 border-start border-danger border-4 p-3">
          <div class="text-muted small fw-semibold">📜 ประวัติเอกสารที่เบิกจ่าย</div>
          <div class="fs-3 fw-bold text-danger mt-1">${disbCount} <span class="fs-6 fw-normal text-muted">ฉบับ</span></div>
          <div class="small text-muted mt-1">บันทึกในระบบ Google Sheets</div>
        </div>
      </div>
    </div>

    <!-- Quick action links -->
    <div class="card bg-light border-0 shadow-sm p-4 mb-4">
      <h3 class="h6 fw-bold text-navy mb-3">⚡ ทางลัดการทำงาน</h3>
      <div class="d-flex flex-wrap gap-2">
        <button class="btn btn-warning text-dark fw-bold disb-btn-action" data-goto="form">📝 ทำรายการเบิกปัจจัยใหม่</button>
        <button class="btn btn-outline-success disb-btn-action" data-goto="katin100K">🌟 ตรวจสอบรายชื่อกฐินแสน (${saenPaid}/${saenTemples.length} วัด)</button>
        <button class="btn btn-outline-info disb-btn-action" data-goto="katin10K">🎆 ตรวจสอบรายชื่อกฐินหมื่น (${muenPaid}/${muenTemples.length} วัด)</button>
        <button class="btn btn-outline-danger disb-btn-action" data-goto="history">📜 ดูประวัติเอกสารเบิกจ่าย (${disbCount} รายการ)</button>
      </div>
    </div>
  `;

  $$('.disb-btn-action').forEach(b => {
    b.onclick = () => {
      setDisbSubtab(b.dataset.goto);
    };
  });
}

function renderDisbKatinTable(katinType, defaultAmount) {
  const kathins = data.kathin || [];
  const typeTemples = kathins.filter(k => k.kathinType === katinType);
  const q = (disbState.katinSearchText || '').trim().toLowerCase();

  const filtered = typeTemples.filter(k => {
    if (!q) return true;
    return [k.templeName, k.district, k.subdistrict, k.province, k.abbotName, k.abbotPhone].some(v => String(v || '').toLowerCase().includes(q));
  });

  const paidCount = typeTemples.filter(k => String(k.disbursementStatus || '').toUpperCase() === 'PAID').length;
  const isSaen = katinType === 'กฐินแสน';

  $('#disb-subview-content').innerHTML = `
    <div class="card bg-white border-0 shadow-sm p-3 mb-3">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <h3 class="h5 fw-bold ${isSaen ? 'text-success' : 'text-info'} mb-1">
            ${isSaen ? '🌟 บัญชีวัดกฐินแสน (100,000 บาท)' : '🎆 บัญชีวัดกฐินหมื่น (10,000 บาท)'}
          </h3>
          <small class="text-muted">จ่ายแล้ว: <strong>${paidCount}</strong> จากทั้งหมด <strong>${typeTemples.length}</strong> วัด (ยอดเบิกจ่ายแล้ว ${formatThaiBaht(paidCount * defaultAmount)} บาท)</small>
        </div>
        <div class="d-flex gap-2">
          <input type="text" id="disb-katin-search-input" class="form-control form-control-sm" style="width: 260px;" placeholder="🔍 ค้นหาชื่อวัด ตำบล อำเภอ เจ้าอาวาส..." value="${esc(disbState.katinSearchText)}">
          <button class="btn btn-outline-secondary btn-sm" id="disb-katin-search-clear">รีเซ็ต</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-hover align-middle small mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 60px;" class="text-center">ลำดับ</th>
              <th style="min-width: 180px;">ชื่อวัด</th>
              <th>อำเภอ / ตำบล</th>
              <th>เจ้าอาวาส / ผู้ประสานงาน</th>
              <th class="text-end" style="width: 120px;">จำนวนเงิน</th>
              <th class="text-center" style="width: 110px;">สวิตช์สถานะ</th>
              <th class="text-center" style="width: 100px;">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map((k, idx) => {
              const isPaid = String(k.disbursementStatus || '').toUpperCase() === 'PAID';
              const kId = k.kathinId || k.templeId;
              return `
                <tr class="${isPaid ? 'table-success bg-opacity-25' : ''}">
                  <td class="text-center text-muted fw-bold">${idx + 1}</td>
                  <td><strong class="text-navy">${esc(k.templeName)}</strong></td>
                  <td>ต.${esc(k.subdistrict || '-')} อ.${esc(k.district || '-')} จ.${esc(k.province || 'สุราษฎร์ธานี')}</td>
                  <td>${esc(k.abbotName || '-')}<br><small class="text-muted">${k.abbotPhone ? '📞 ' + esc(k.abbotPhone) : ''}</small></td>
                  <td class="text-end fw-bold ${isSaen ? 'text-success' : 'text-info'}">${formatThaiBaht(defaultAmount)} บ.</td>
                  <td class="text-center">
                    <label class="disb-toggle-switch">
                      <input type="checkbox" class="disb-temple-toggle" data-id="${esc(kId)}" ${isPaid ? 'checked' : ''}>
                      <span class="disb-slider"></span>
                      <span class="disb-slider-label disb-unpaid-label">ยังไม่เบิก</span>
                      <span class="disb-slider-label disb-paid-label">จ่ายแล้ว</span>
                    </label>
                  </td>
                  <td class="text-center" id="disb-status-badge-${esc(kId)}">
                    <span class="badge ${isPaid ? 'bg-primary' : 'bg-danger'}">${isPaid ? 'จ่ายแล้ว' : 'ยังไม่ได้เบิก'}</span>
                    ${k.updatedBy ? `<br><small class="text-muted" style="font-size: 10px;">โดย: ${esc(k.updatedBy)}</small>` : ''}
                  </td>
                </tr>
              `;
            }).join('') : `<tr><td colspan="7" class="text-center text-muted py-4">ไม่พบข้อมูลวัดที่ค้นหา</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const sInput = $('#disb-katin-search-input');
  if (sInput) {
    sInput.oninput = () => {
      disbState.katinSearchText = sInput.value;
      renderDisbKatinTable(katinType, defaultAmount);
    };
  }
  const sClear = $('#disb-katin-search-clear');
  if (sClear) {
    sClear.onclick = () => {
      disbState.katinSearchText = '';
      renderDisbKatinTable(katinType, defaultAmount);
    };
  }

  $$('.disb-temple-toggle').forEach(chk => {
    chk.onchange = async () => {
      const templeId = chk.dataset.id;
      const newStatus = chk.checked ? 'PAID' : 'UNPAID';
      chk.disabled = true;
      try {
        await api('admin-disbursements', {
          method: 'PUT',
          body: JSON.stringify({ action: 'toggle_temple', templeId, status: newStatus })
        });
        const target = (data.kathin || []).find(k => (k.kathinId || k.templeId) === templeId);
        const adminName = data.currentAdmin?.displayName || data.currentAdmin?.username || '';
        if (target) {
          target.disbursementStatus = newStatus;
          target.updatedBy = adminName;
        }
        
        toast(`อัปเดตสถานะ "${target?.templeName || templeId}" เป็น ${newStatus === 'PAID' ? 'จ่ายแล้ว ✅' : 'ยังไม่ได้เบิก ⏳'}`, 'success');
        const badge = $(`#disb-status-badge-${templeId}`);
        if (badge) {
          badge.innerHTML = `<span class="badge ${newStatus === 'PAID' ? 'bg-primary' : 'bg-danger'}">${newStatus === 'PAID' ? 'จ่ายแล้ว' : 'ยังไม่ได้เบิก'}</span>${adminName ? `<br><small class="text-muted" style="font-size: 10px;">โดย: ${esc(adminName)}</small>` : ''}`;
        }
        const tr = chk.closest('tr');
        if (tr) {
          tr.classList.toggle('table-success', newStatus === 'PAID');
          tr.classList.toggle('bg-opacity-25', newStatus === 'PAID');
        }
      } catch (err) {
        chk.checked = !chk.checked;
        alertUser(err.message || 'ไม่สามารถอัปเดตสถานะได้');
      } finally {
        chk.disabled = false;
      }
    };
  });
}

function renderDisbForm() {
  const selectedTemples = disbState.selectedTemples || [];
  const totalAmount = selectedTemples.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  $('#disb-subview-content').innerHTML = `
    <div class="row g-4">
      <!-- LEFT COLUMN: Temple Selection -->
      <div class="col-lg-7">
        <div class="card border-0 shadow-sm p-4 bg-light bg-opacity-50 h-100">
          <h3 class="h6 fw-bold text-navy mb-3">1. เลือกวัดที่จะเบิกปัจจัย (เลือกได้หลายวัด)</h3>

          <!-- Search / Autocomplete Input -->
          <div class="position-relative mb-3">
            <label class="form-label small fw-semibold text-muted">🔍 ค้นหาวัดจากบัญชีกฐิน (ชื่อวัด, อำเภอ, ตำบล)</label>
            <div class="input-group input-group-sm">
              <span class="input-group-text bg-white">🔎</span>
              <input type="text" id="disb-temple-search" class="form-control" placeholder="พิมพ์ชื่อวัด ตำบล หรืออำเภอ..." autocomplete="off">
            </div>
            <div id="disb-temple-suggestions" class="position-absolute w-100 shadow rounded border bg-white mt-1 d-none" style="z-index: 1050; max-height: 240px; overflow-y: auto;"></div>
          </div>

          <!-- Custom Temple Box -->
          <div class="card bg-white border border-warning-subtle shadow-xs p-3 mb-3">
            <div class="small fw-bold text-warning-emphasis mb-2">➕ เพิ่มวัดนอกรายการ (Custom Temple)</div>
            <div class="row g-2">
              <div class="col-md-5">
                <input type="text" id="disb-custom-name" class="form-control form-control-sm" placeholder="ชื่อวัด">
              </div>
              <div class="col-md-4">
                <input type="text" id="disb-custom-amphoe" class="form-control form-control-sm" placeholder="อำเภอ / ตำบล">
              </div>
              <div class="col-md-3">
                <input type="number" id="disb-custom-amount" class="form-control form-control-sm" placeholder="จำนวนเงิน" value="10000">
              </div>
            </div>
            <button type="button" id="btn-disb-add-custom" class="btn btn-warning btn-sm mt-2 fw-semibold">
              + เพิ่มวัดกำหนดเอง
            </button>
          </div>

          <!-- Selected Temples List -->
          <div class="card bg-white border shadow-sm p-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="fw-bold small text-navy">วัดที่เลือกเบิกจ่าย (<span id="disb-selected-count">${selectedTemples.length}</span> วัด)</span>
              ${selectedTemples.length ? '<button type="button" id="btn-disb-clear-temples" class="btn btn-link btn-xs text-danger text-decoration-none p-0">ล้างรายการวัดที่เลือก</button>' : ''}
            </div>
            <div id="disb-selected-temples-list" style="max-height: 220px; overflow-y: auto;" class="d-flex flex-column gap-2 mb-3">
              ${selectedTemples.length ? selectedTemples.map(t => `
                <div class="d-flex justify-content-between align-items-center p-2 rounded border bg-light small">
                  <div>
                    <strong class="text-navy">${esc(t.name)}</strong>
                    <span class="text-muted ms-1">(${esc(t.amphoe || '-')})</span>
                    <span class="badge ${t.type === 'กฐินแสน' ? 'bg-success' : (t.type === 'กฐินหมื่น' ? 'bg-info' : 'bg-secondary')} ms-1">${esc(t.type || 'Custom')}</span>
                  </div>
                  <div class="d-flex align-items-center gap-2">
                    <span class="fw-bold text-danger">${formatThaiBaht(t.amount)} บ.</span>
                    <button type="button" class="btn btn-xs btn-outline-danger btn-disb-remove-temple" data-id="${esc(t.id)}">&times;</button>
                  </div>
                </div>
              `).join('') : '<p class="text-muted small text-center my-3">ยังไม่มีวัดที่เลือก (โปรดค้นหาด้านบนหรือเพิ่มวัดกำหนดเอง)</p>'}
            </div>
            <div class="border-top pt-2 d-flex justify-content-between align-items-center">
              <span class="fw-bold">ยอดรวมเบิกจ่าย:</span>
              <span class="fs-5 fw-bold text-danger">${formatThaiBaht(totalAmount)} <span class="fs-6 fw-normal text-muted">บาท</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN: Recipient Information -->
      <div class="col-lg-5">
        <div class="card border-0 shadow-sm p-4 bg-light bg-opacity-50 h-100">
          <h3 class="h6 fw-bold text-navy mb-3">2. ข้อมูลผู้รับปัจจัยและเอกสาร</h3>

          <!-- Operator Info -->
          <div class="alert alert-light border border-secondary-subtle d-flex align-items-center gap-2 py-2 px-3 mb-3 small shadow-2xs">
            <span class="fs-5">👤</span>
            <div>
              <div class="text-muted" style="font-size: 11px;">เจ้าหน้าที่ผู้ทำรายการเบิกจ่าย:</div>
              <strong class="text-navy">${esc(data.currentAdmin?.displayName || data.currentAdmin?.username || 'ผู้ดูแลระบบ')}</strong>
            </div>
          </div>

          <!-- Recipient 1 -->
          <div class="card bg-white border border-primary-subtle shadow-xs p-3 mb-3">
            <label class="form-label small fw-bold text-primary mb-1">ผู้รับปัจจัยคนที่ 1 <span class="text-danger">*</span></label>
            <div class="position-relative mb-2">
              <input type="text" id="disb-rec1-name" class="form-control form-control-sm" placeholder="🔍 พิมพ์ชื่อ-นามสกุล ค้นหาจากฐานข้อมูลบุคคล หรือกรอกใหม่..." value="${esc(disbState.recipient1.name || '')}" autocomplete="off">
              <div id="disb-rec1-suggestions" class="position-absolute w-100 shadow rounded border bg-white mt-1 d-none" style="z-index: 1050; max-height: 180px; overflow-y: auto;"></div>
            </div>
            <div>
              <input type="tel" id="disb-rec1-phone" class="form-control form-control-sm" placeholder="เบอร์โทรศัพท์ (ถ้ามี)" value="${esc(disbState.recipient1.phone || '')}">
            </div>
          </div>

          <!-- Recipient 2 -->
          <div class="card bg-white border border-primary-subtle shadow-xs p-3 mb-3">
            <label class="form-label small fw-bold text-primary mb-1">ผู้รับปัจจัยคนที่ 2 (ถ้ามี)</label>
            <div class="position-relative mb-2">
              <input type="text" id="disb-rec2-name" class="form-control form-control-sm" placeholder="🔍 พิมพ์ชื่อ-นามสกุล ค้นหาจากฐานข้อมูลบุคคล หรือกรอกใหม่..." value="${esc(disbState.recipient2.name || '')}" autocomplete="off">
              <div id="disb-rec2-suggestions" class="position-absolute w-100 shadow rounded border bg-white mt-1 d-none" style="z-index: 1050; max-height: 180px; overflow-y: auto;"></div>
            </div>
            <div>
              <input type="tel" id="disb-rec2-phone" class="form-control form-control-sm" placeholder="เบอร์โทรศัพท์ (ถ้ามี)" value="${esc(disbState.recipient2.phone || '')}">
            </div>
          </div>

          <!-- Recipient 3 / Witness -->
          <div class="card bg-white border border-info-subtle shadow-xs p-3 mb-3">
            <label class="form-label small fw-bold text-info-emphasis mb-1">ผู้รับปัจจัยคนที่ 3 / พยาน (ถ้ามี)</label>
            <div class="position-relative mb-2">
              <input type="text" id="disb-rec3-name" class="form-control form-control-sm" placeholder="🔍 พิมพ์ชื่อ-นามสกุล ค้นหาจากฐานข้อมูลบุคคล หรือกรอกใหม่..." value="${esc(disbState.recipient3.name || '')}" autocomplete="off">
              <div id="disb-rec3-suggestions" class="position-absolute w-100 shadow rounded border bg-white mt-1 d-none" style="z-index: 1050; max-height: 180px; overflow-y: auto;"></div>
            </div>
            <div>
              <input type="tel" id="disb-rec3-phone" class="form-control form-control-sm" placeholder="เบอร์โทรศัพท์ (ถ้ามี)" value="${esc(disbState.recipient3.phone || '')}">
            </div>
          </div>

          <!-- Document Date -->
          <div class="mb-3">
            <label class="form-label small fw-semibold text-muted mb-1">วันที่ทำเอกสาร</label>
            <input type="date" id="disb-doc-date" class="form-control form-control-sm" value="${disbState.documentDate}">
          </div>

          <!-- Donor Name -->
          <div class="mb-4">
            <label class="form-label small fw-semibold text-muted mb-1">ผู้มอบปัจจัย</label>
            <input type="text" id="disb-donor-name" class="form-control form-control-sm" value="${esc(disbState.donorName || 'พระอนุชา ทานิสฺสโร')}">
          </div>

          <!-- Action Buttons -->
          <div class="d-flex flex-column gap-2 mt-auto">
            <button type="button" id="btn-disb-proceed-print" class="btn btn-danger btn-sm py-2 fw-bold shadow-sm">
              🖨️ ไปหน้าตรวจสอบและพิมพ์เอกสาร (ชุด 2 แผ่น)
            </button>
            <button type="button" id="btn-disb-reset-form" class="btn btn-outline-secondary btn-sm">
              ล้างข้อมูลฟอร์ม
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Autocomplete for Temple search
  const tSearch = $('#disb-temple-search');
  const tSugg = $('#disb-temple-suggestions');
  if (tSearch && tSugg) {
    tSearch.oninput = () => {
      const q = tSearch.value.trim().toLowerCase();
      if (q.length < 1) { tSugg.classList.add('d-none'); return; }
      const kathins = data.kathin || [];
      const matches = kathins.filter(k =>
        [k.templeName, k.district, k.subdistrict].some(v => String(v || '').toLowerCase().includes(q))
      ).slice(0, 20);

      if (!matches.length) {
        tSugg.innerHTML = '<div class="p-2 text-muted small text-center">ไม่พบวัดที่ค้นหา</div>';
        tSugg.classList.remove('d-none');
        return;
      }

      tSugg.innerHTML = matches.map(k => {
        const kId = k.kathinId || k.templeId;
        const isSelected = disbState.selectedTemples.some(t => t.id === kId);
        const isPaid = String(k.disbursementStatus || '').toUpperCase() === 'PAID';
        const defaultAmt = k.kathinType === 'กฐินแสน' ? 100000 : 10000;
        return `
          <div class="p-2 cursor-pointer border-bottom d-flex justify-content-between align-items-center disb-sugg-item ${isSelected ? 'bg-warning-subtle' : 'hover-bg-light'}"
               style="cursor: pointer;"
               data-id="${esc(kId)}"
               data-name="${esc(k.templeName)}"
               data-amphoe="${esc(k.district || '')}"
               data-tambon="${esc(k.subdistrict || '')}"
               data-amount="${defaultAmt}"
               data-type="${esc(k.kathinType || 'กฐินหมื่น')}">
            <div>
              <strong>${esc(k.templeName)}</strong>
              <small class="text-muted ms-1">(${esc(k.district || '-')}/${esc(k.subdistrict || '-')})</small>
              <span class="badge ${k.kathinType === 'กฐินแสน' ? 'bg-success' : 'bg-info'} ms-1">${esc(k.kathinType || 'กฐินหมื่น')}</span>
            </div>
            <div class="text-end">
              <span class="small fw-bold">${formatThaiBaht(defaultAmt)} บ.</span><br>
              <small class="${isPaid ? 'text-primary' : 'text-danger'} fw-semibold">${isPaid ? '✓ จ่ายแล้ว' : '○ ยังไม่ได้เบิก'}</small>
            </div>
          </div>
        `;
      }).join('');
      tSugg.classList.remove('d-none');

      $$('.disb-sugg-item', tSugg).forEach(item => {
        item.onclick = () => {
          const id = item.dataset.id;
          const existIdx = disbState.selectedTemples.findIndex(t => t.id === id);
          if (existIdx > -1) {
            disbState.selectedTemples.splice(existIdx, 1);
          } else {
            disbState.selectedTemples.push({
              id,
              name: item.dataset.name,
              amphoe: item.dataset.amphoe,
              tambon: item.dataset.tambon,
              amount: Number(item.dataset.amount),
              type: item.dataset.type
            });
          }
          tSearch.value = '';
          tSugg.classList.add('d-none');
          renderDisbForm();
        };
      });
    };

    tSearch.onblur = () => {
      setTimeout(() => {
        tSugg.classList.add('d-none');
      }, 200);
    };
  }

  // Custom temple add
  const btnAddCustom = $('#btn-disb-add-custom');
  if (btnAddCustom) {
    btnAddCustom.onclick = () => {
      const name = ($('#disb-custom-name')?.value || '').trim();
      const amphoe = ($('#disb-custom-amphoe')?.value || '').trim();
      const amount = Number($('#disb-custom-amount')?.value || 10000);

      if (!name) {
        alert('กรุณากรอกชื่อวัด');
        return;
      }
      if (amount <= 0) {
        alert('กรุณากรอกจำนวนเงินให้ถูกต้อง');
        return;
      }

      disbState.selectedTemples.push({
        id: `custom-${Date.now()}`,
        name,
        amphoe: amphoe || '-',
        tambon: '-',
        amount,
        type: 'Custom'
      });
      renderDisbForm();
    };
  }

  // Remove temple
  $$('.btn-disb-remove-temple').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      disbState.selectedTemples = disbState.selectedTemples.filter(t => t.id !== id);
      renderDisbForm();
    };
  });

  // Clear temples
  const btnClearTemples = $('#btn-disb-clear-temples');
  if (btnClearTemples) {
    btnClearTemples.onclick = () => {
      disbState.selectedTemples = [];
      renderDisbForm();
    };
  }

  // Recipient autocomplete helper
  function setupRecAutocomplete(num) {
    const input = $(`#disb-rec${num}-name`);
    const phoneInput = $(`#disb-rec${num}-phone`);
    const sugg = $(`#disb-rec${num}-suggestions`);
    if (!input || !sugg) return;

    input.oninput = () => {
      disbState[`recipient${num}`].name = input.value;
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { sugg.classList.add('d-none'); return; }

      const persons = data.persons || [];
      const matches = persons.filter(p =>
        [`${p.firstName || ''} ${p.lastName || ''}`, p.monasticName, p.mobile, p.personId].some(v => String(v || '').toLowerCase().includes(q))
      ).slice(0, 15);

      if (!matches.length) {
        sugg.innerHTML = '';
        sugg.classList.add('d-none');
        return;
      }

      sugg.innerHTML = matches.map(p => {
        const full = `${p.prefix || ''} ${p.monasticName || ''} ${p.firstName || ''} ${p.lastName || ''}`.trim();
        return `
          <div class="p-2 cursor-pointer border-bottom disb-rec-item" style="cursor:pointer;"
               data-id="${esc(p.personId)}"
               data-name="${esc(full)}"
               data-phone="${esc(p.mobile || '')}">
            <strong class="text-navy small">${esc(full)}</strong>
            <small class="text-muted ms-1">${p.mobile ? '📱 ' + esc(p.mobile) : ''}</small>
          </div>
        `;
      }).join('');
      sugg.classList.remove('d-none');

      $$('.disb-rec-item', sugg).forEach(item => {
        item.onclick = () => {
          const chosenName = item.dataset.name;
          const chosenPhone = item.dataset.phone;
          input.value = chosenName;
          if (phoneInput && chosenPhone) phoneInput.value = chosenPhone;

          disbState[`recipient${num}`] = {
            id: item.dataset.id,
            name: chosenName,
            phone: chosenPhone
          };
          sugg.innerHTML = '';
          sugg.classList.add('d-none');
        };
      });
    };

    input.onblur = () => {
      setTimeout(() => {
        sugg.classList.add('d-none');
      }, 200);
    };

    if (phoneInput) {
      phoneInput.onfocus = () => {
        sugg.classList.add('d-none');
      };
      phoneInput.oninput = () => {
        disbState[`recipient${num}`].phone = phoneInput.value;
      };
    }
  }

  setupRecAutocomplete(1);
  setupRecAutocomplete(2);
  setupRecAutocomplete(3);

  // Date and donor change listeners
  const docDateInput = $('#disb-doc-date');
  if (docDateInput) {
    docDateInput.onchange = () => { disbState.documentDate = docDateInput.value; };
  }
  const donorInput = $('#disb-donor-name');
  if (donorInput) {
    donorInput.oninput = () => { disbState.donorName = donorInput.value; };
  }

  // Reset form
  const btnReset = $('#btn-disb-reset-form');
  if (btnReset) {
    btnReset.onclick = () => {
      if (confirm('ยืนยันล้างข้อมูลฟอร์มทั้งหมด?')) {
        resetDisbFormState();
        renderDisbForm();
      }
    };
  }

  // Proceed to print
  const btnProceed = $('#btn-disb-proceed-print');
  if (btnProceed) {
    btnProceed.onclick = () => {
      if (!disbState.selectedTemples.length) {
        alert('กรุณาเลือกวัดที่จะเบิกจ่ายอย่างน้อย 1 รายการ');
        return;
      }
      if (!disbState.recipient1.name.trim()) {
        alert('กรุณากรอกชื่อผู้รับปัจจัยคนที่ 1');
        return;
      }
      disbState.isViewingHistoryPrint = false;
      setDisbSubtab('print');
    };
  }
}

function renderDisbPrint() {
  const selectedTemples = disbState.selectedTemples || [];
  const totalAmount = selectedTemples.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const totalTemples = selectedTemples.length;
  const rec1Name = disbState.recipient1.name || '';
  const rec2Name = disbState.recipient2.name || '';
  const rec3Name = disbState.recipient3?.name || '';
  const donorName = disbState.donorName || 'พระอนุชา ทานิสฺสโร';
  const thaiDateStr = formatThaiDocDate(disbState.documentDate);
  const operatorName = disbState.createdByName || data.currentAdmin?.displayName || data.currentAdmin?.username || '-';

  const tableRows = selectedTemples.map((t, idx) => `
    <tr style="height: 28px;">
      <td style="border: 1px solid #333; text-align: center; font-size: 13px;">${idx + 1}</td>
      <td style="border: 1px solid #333; text-align: left; padding: 2px 8px; font-size: 13px;">
        ${esc(t.name)} (${esc(t.amphoe || '-')}${t.tambon && t.tambon !== '-' ? '/' + esc(t.tambon) : ''})
      </td>
      <td style="border: 1px solid #333; text-align: right; padding: 2px 8px; font-size: 13px; font-family: monospace;">
        ${formatThaiBaht(t.amount)}
      </td>
    </tr>
  `).join('');

  // Filler blank rows up to 10 rows (balances table height and leaves ample signature space without overflowing A4)
  const blankRowsCount = Math.max(0, 10 - selectedTemples.length);
  const blankRows = Array(blankRowsCount).fill(`
    <tr style="height: 28px;">
      <td style="border: 1px solid #333; text-align: center; font-size: 13px;">&nbsp;</td>
      <td style="border: 1px solid #333; text-align: left; padding: 2px 8px; font-size: 13px;">&nbsp;</td>
      <td style="border: 1px solid #333; text-align: right; padding: 2px 8px; font-size: 13px;">&nbsp;</td>
    </tr>
  `).join('');

  const tableHtml = `
    <div style="border: 1px solid #333; margin-bottom: 20px;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f1f5f9; font-weight: bold; height: 32px; color: #1e293b;">
            <th style="border: 1px solid #333; width: 8%; text-align: center; font-size: 13px;">ลำดับ</th>
            <th style="border: 1px solid #333; width: 67%; text-align: center; font-size: 13px;">ชื่อวัด (อำเภอ/ตำบล)</th>
            <th style="border: 1px solid #333; width: 25%; text-align: center; font-size: 13px;">จำนวนเงิน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          ${blankRows}
        </tbody>
        <tfoot>
          <tr style="background-color: #f8fafc; font-weight: bold; height: 32px; color: #1e293b;">
            <td colspan="2" style="border: 1px solid #333; text-align: right; padding-right: 12px; font-size: 14px;">
              รวมยอดปัจจัยเบิกจ่าย (${totalTemples} วัด)
            </td>
            <td style="border: 1px solid #333; text-align: right; padding-right: 8px; font-size: 15px; color: #dc2626; font-family: monospace;">
              ${formatThaiBaht(totalAmount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  const headerHtml = `
    <div style="text-align: center; margin-bottom: 16px;">
      <h2 style="font-size: 18px; font-weight: bold; border-bottom: 2px solid #000; display: inline-block; padding-bottom: 4px; margin: 0;">
        ใบลงชื่อรับปัจจัยและส่งใบอนุโมทนาบัตรจังหวัดสุราษฎร์ธานี พ.ศ.๒๕๖๙
      </h2>
    </div>
    <div style="margin-bottom: 12px; font-size: 14px; line-height: 1.6;">
      <div><strong>เรียน:</strong> ส่วนกลาง</div>
      <div><strong>เรื่อง:</strong> การเบิกปัจจัยทอดกฐิน</div>
    </div>
  `;

  const sheet1Html = `
    <div class="disb-print-sheet" style="background: white; padding: 24px; max-width: 800px; margin: 0 auto 30px auto; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-radius: 4px;">
      ${headerHtml}
      <p style="font-size: 14px; line-height: 1.8; margin-bottom: 14px; text-indent: 30px;">
        ข้าพเจ้าขอเบิกปัจจัยทอดกฐินตามรายการวัดข้างต้น รวมจำนวน ${totalTemples} วัด เป็นจำนวนเงินทั้งสิ้น ${formatThaiBaht(totalAmount)} บาท เพื่อมอบให้ผู้รับปัจจัยนำไปถวายตามพิธีทอดกฐินต่อไป
      </p>
      ${tableHtml}

      <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 14px; margin-top: 24px;">
        <!-- Left: Recipients -->
        <div style="width: 55%; display: flex; flex-direction: column; align-items: flex-start; gap: 32px;">
          <div style="text-align: center;">
            <div style="font-size: 13px; white-space: nowrap;">ลงชื่อ..................................................ผู้รับปัจจัยคนที่ 1</div>
            <div style="font-size: 13px; margin-top: 18px; font-weight: bold;">(${esc(rec1Name || '..................................................')})</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 13px; white-space: nowrap;">ลงชื่อ..................................................ผู้รับปัจจัยคนที่ 2</div>
            <div style="font-size: 13px; margin-top: 18px; font-weight: bold;">(${esc(rec2Name || '..................................................')})</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 13px; white-space: nowrap;">ลงชื่อ..........................................ผู้รับปัจจัยคนที่ 3 / พยาน</div>
            <div style="font-size: 13px; margin-top: 18px; font-weight: bold;">(${esc(rec3Name || '..................................................')})</div>
          </div>
          <div style="font-size: 13px; margin-top: 10px;">วันที่: ${thaiDateStr}</div>
        </div>

        <!-- Right: Donor -->
        <div style="width: 45%; display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-end;">
          <div style="text-align: center;">
            <div style="font-size: 13px; white-space: nowrap;">ลงชื่อ......................................................ผู้มอบปัจจัย</div>
            <div style="font-size: 13px; margin-top: 18px; font-weight: bold;">(${esc(donorName || '..................................................')})</div>
            <div style="font-size: 13px; margin-top: 14px;">วันที่: ${thaiDateStr}</div>
          </div>
        </div>
      </div>

      <div style="margin-top: 20px; padding-top: 8px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b;">
        <span>เจ้าหน้าที่ผู้ทำรายการ: <strong>${esc(operatorName)}</strong></span>
        <span>วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH')}</span>
      </div>
    </div>
  `;

  const sheet2Html = `
    <div class="disb-print-sheet" style="background: white; padding: 24px; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-radius: 4px;">
      ${headerHtml}
      <p style="font-size: 14px; line-height: 1.8; margin-bottom: 14px; text-indent: 30px;">
        ข้าพเจ้าขอเบิกปัจจัยทอดกฐินตามรายการวัดข้างต้น รวมจำนวน ${totalTemples} วัด เป็นจำนวนเงินทั้งสิ้น ${formatThaiBaht(totalAmount)} บาท เพื่อมอบให้ผู้รับปัจจัยนำไปถวายตามพิธีทอดกฐินต่อไป
      </p>
      ${tableHtml}

      <div style="margin-top: 10px;">
        <h3 style="font-size: 15px; font-weight: bold; color: #b91c1c; margin-bottom: 8px;">
          หมายเหตุและข้อปฏิบัติสำหรับผู้รับปัจจัย
        </h3>
        <ol style="font-size: 14px; line-height: 1.9; margin: 0; padding-left: 24px; color: #1e293b;">
          <li>รับปัจจัย พร้อมลงชื่อรับเป็นหลักฐาน <strong>ห้ามเปิดซองก่อนถวายปัจจัย</strong></li>
          <li>ดูแลถุงทอง ปัจจัยกฐิน ให้ครบถ้วนและถวายให้สำเร็จในวันทอดกฐิน</li>
          <li>เมื่อถวายแล้ว ให้เปิดซองปัจจัยยืนยันว่าถวายครบจำนวน <strong>พร้อมถ่ายภาพเป็นหลักฐาน</strong></li>
          <li>ประสานงานรับใบอนุโมทนาบัตรให้ถูกต้องในวันทอดกฐิน</li>
          <li><strong>ถ้าไม่มีใบอนุโมทนาบัตร ต้องคืนปัจจัยเต็มจำนวน ให้ส่วนกลาง</strong></li>
          <li>รวมปัจจัยกฐินทั้งหมดของวัดที่ไปทอด แล้วส่งข้อมูลให้ไอทีจังหวัด</li>
          <li>รวมจำนวนคนที่มาร่วมงานทั้งหมดของวัดที่ไปทอด และส่งข้อมูลให้ไอทีจังหวัด</li>
        </ol>
      </div>

      <div style="margin-top: 20px; padding-top: 8px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b;">
        <span>เจ้าหน้าที่ผู้ทำรายการ: <strong>${esc(operatorName)}</strong></span>
        <span>วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH')}</span>
      </div>
    </div>
  `;

  $('#disb-subview-content').innerHTML = `
    <!-- Top Action Bar (Hidden on print) -->
    <div class="print-hidden d-flex justify-content-between align-items-center mb-4 p-3 bg-white rounded shadow-sm">
      <button type="button" class="btn btn-outline-secondary btn-sm" id="btn-disb-back-form">
        ← กลับไปแก้ไขข้อมูล
      </button>
      <div class="d-flex align-items-center gap-2">
        <span class="text-muted small">พิมพ์เอกสารชุด 2 แผ่น (A4):</span>
        <button type="button" class="btn btn-danger btn-sm px-3 fw-bold shadow-sm" id="btn-disb-save-print">
          ${disbState.isViewingHistoryPrint ? '🖨️ สั่งพิมพ์เอกสารนี้' : '💾 บันทึกและสั่งพิมพ์จริง 🖨️'}
        </button>
      </div>
    </div>

    <!-- Printable Container -->
    <div id="disb-print-container">
      ${sheet1Html}
      ${sheet2Html}
    </div>
  `;

  $('#btn-disb-back-form').onclick = () => {
    setDisbSubtab('form');
  };

  $('#btn-disb-save-print').onclick = async () => {
    if (disbState.isViewingHistoryPrint) {
      window.print();
    } else {
      await saveAndPrintDisbursement();
    }
  };
}

async function saveAndPrintDisbursement() {
  const selectedTemples = disbState.selectedTemples || [];
  if (!selectedTemples.length) {
    alert('กรุณาเลือกวัดที่จะเบิกจ่ายอย่างน้อย 1 รายการ');
    return;
  }
  if (!disbState.recipient1.name.trim()) {
    alert('กรุณากรอกชื่อผู้รับปัจจัยคนที่ 1');
    return;
  }

  const btn = $('#btn-disb-save-print');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึกข้อมูล...'; }

  try {
    const totalAmount = selectedTemples.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const templeIds = selectedTemples.map(t => t.id).filter(id => !id.startsWith('custom-'));
    const payload = {
      documentDate: disbState.documentDate,
      recipient1Id: disbState.recipient1.id || '',
      recipient1Name: disbState.recipient1.name,
      recipient1Phone: disbState.recipient1.phone || '',
      recipient2Id: disbState.recipient2.id || '',
      recipient2Name: disbState.recipient2.name || '',
      recipient2Phone: disbState.recipient2.phone || '',
      recipient3Id: disbState.recipient3?.id || '',
      recipient3Name: disbState.recipient3?.name || '',
      recipient3Phone: disbState.recipient3?.phone || '',
      donorName: disbState.donorName || 'พระอนุชา ทานิสฺสโร',
      totalAmount,
      totalTemples: selectedTemples.length,
      templeIds,
      templeDetails: selectedTemples
    };

    const res = await api('admin-disbursements', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const adminName = data.currentAdmin?.displayName || data.currentAdmin?.username || '';
    templeIds.forEach(id => {
      const k = (data.kathin || []).find(x => x.templeId === id);
      if (k) {
        k.disbursementStatus = 'PAID';
        k.updatedBy = adminName;
      }
    });

    if (!data.disbursements) data.disbursements = [];
    data.disbursements.unshift(res.disbursement);

    toast('บันทึกเอกสารการเบิกปัจจัยสำเร็จแล้ว', 'success');

    setTimeout(() => {
      window.print();
      resetDisbFormState();
      setDisbSubtab('history');
    }, 400);
  } catch (err) {
    alertUser(err.message || 'บันทึกข้อมูลล้มเหลว');
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 บันทึกและสั่งพิมพ์จริง 🖨️'; }
  }
}

function renderDisbHistory() {
  const records = data.disbursements || [];

  $('#disb-subview-content').innerHTML = `
    <div class="card bg-white border-0 shadow-sm p-3 mb-3">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <h3 class="h5 fw-bold text-danger mb-1">📜 ประวัติเอกสารการเบิกจ่ายที่บันทึกแล้ว</h3>
          <small class="text-muted">ทั้งหมด <strong>${records.length}</strong> รายการ (บันทึกใน Google Sheets Disbursements)</small>
        </div>
        <button class="btn btn-warning btn-sm text-dark fw-bold" id="btn-disb-history-add">
          + ทำรายการเบิกปัจจัยใหม่
        </button>
      </div>

      <div class="table-responsive">
        <table class="table table-hover align-middle small mb-0">
          <thead class="table-light">
            <tr>
              <th style="width: 130px;">เลขที่เอกสาร</th>
              <th>วันที่ทำเอกสาร</th>
              <th class="text-center" style="width: 80px;">จำนวนวัด</th>
              <th class="text-end" style="width: 120px;">ยอดรวม (บาท)</th>
              <th>ผู้รับปัจจัย 1</th>
              <th>ผู้รับปัจจัย 2</th>
              <th>ผู้รับปัจจัย 3 / พยาน</th>
              <th>ผู้ทำรายการ</th>
              <th class="text-end" style="width: 180px;">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${records.length ? records.map(r => `
              <tr>
                <td><strong class="font-monospace text-navy">${esc(r.disbursementId)}</strong></td>
                <td>${esc(formatThaiDocDate(r.documentDate))}</td>
                <td class="text-center fw-bold">${esc(String(r.totalTemples || 0))} วัด</td>
                <td class="text-end fw-bold text-danger">${formatThaiBaht(r.totalAmount)} บ.</td>
                <td>
                  <strong>${esc(r.recipient1Name || '-')}</strong>
                  ${r.recipient1Phone ? `<br><small class="text-muted">📞 ${esc(r.recipient1Phone)}</small>` : ''}
                </td>
                <td>
                  ${r.recipient2Name ? `<strong>${esc(r.recipient2Name)}</strong><br><small class="text-muted">📞 ${esc(r.recipient2Phone || '')}</small>` : '<span class="text-muted">-</span>'}
                </td>
                <td>
                  ${r.recipient3Name ? `<strong>${esc(r.recipient3Name)}</strong><br><small class="text-muted">📞 ${esc(r.recipient3Phone || '')}</small>` : '<span class="text-muted">-</span>'}
                </td>
                <td>
                  <span class="badge bg-light text-dark border">👤 ${esc(r.createdBy || 'ไม่ระบุ')}</span>
                </td>
                <td class="text-end text-nowrap">
                  <button class="btn btn-xs btn-outline-info btn-disb-view-record" data-id="${esc(r.disbursementId)}" title="ดูรายละเอียด">👁️ ดูรายละเอียด</button>
                  <button class="btn btn-xs btn-outline-primary btn-disb-reprint-record" data-id="${esc(r.disbursementId)}" title="พิมพ์ซ้ำ">🖨️ พิมพ์ซ้ำ</button>
                  <button class="btn btn-xs btn-outline-danger btn-disb-delete-record" data-id="${esc(r.disbursementId)}" title="ลบเอกสาร">🗑️ ลบ</button>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="9" class="text-center text-muted py-5">ยังไม่มีประวัติการทำรายการเบิกปัจจัย</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const btnAdd = $('#btn-disb-history-add');
  if (btnAdd) {
    btnAdd.onclick = () => setDisbSubtab('form');
  }

  $$('.btn-disb-view-record').forEach(btn => {
    btn.onclick = () => viewDisbRecordModal(btn.dataset.id);
  });

  $$('.btn-disb-reprint-record').forEach(btn => {
    btn.onclick = () => reprintDisbRecord(btn.dataset.id);
  });

  $$('.btn-disb-delete-record').forEach(btn => {
    btn.onclick = () => deleteDisbursementRecord(btn.dataset.id);
  });
}

function viewDisbRecordModal(id) {
  const r = (data.disbursements || []).find(x => x.disbursementId === id);
  if (!r) return;

  let temples = [];
  try {
    temples = typeof r.templeDetailsJson === 'string' ? JSON.parse(r.templeDetailsJson) : (r.templeDetailsJson || []);
  } catch (e) {
    temples = [];
  }

  const templesHtml = temples.length ? temples.map((t, idx) => `
    <div class="d-flex justify-content-between align-items-center p-2 rounded border bg-light small mb-1">
      <div>
        <strong>${idx + 1}. ${esc(t.name || '-')}</strong>
        <span class="text-muted ms-1">(${esc(t.amphoe || '-')})</span>
      </div>
      <span class="fw-bold text-danger">${formatThaiBaht(t.amount)} บ.</span>
    </div>
  `).join('') : '<p class="text-muted small">ไม่พบรายละเอียดวัด</p>';

  editContext = { type: '__history__' };
  $('#modal-title').textContent = `รายละเอียดเอกสาร ${r.disbursementId}`;
  $('#modal-body').innerHTML = `
    <div class="mb-3">
      <div class="row g-2 mb-3">
        <div class="col-6"><strong>วันที่ทำเอกสาร:</strong> ${formatThaiDocDate(r.documentDate)}</div>
        <div class="col-6"><strong>ยอดรวม:</strong> <span class="text-danger fw-bold fs-6">${formatThaiBaht(r.totalAmount)} บาท</span> (${r.totalTemples} วัด)</div>
        <div class="col-6"><strong>ผู้ทำรายการ:</strong> <span class="badge bg-light text-dark border">👤 ${esc(r.createdBy || 'ไม่ระบุ')}</span></div>
        <div class="col-6"><strong>บันทึกเมื่อ:</strong> <small class="text-muted">${r.createdAt ? new Date(r.createdAt).toLocaleString('th-TH') : '-'}</small></div>
        <div class="col-6"><strong>ผู้รับคนที่ 1:</strong> ${esc(r.recipient1Name)} ${r.recipient1Phone ? `(${esc(r.recipient1Phone)})` : ''}</div>
        <div class="col-6"><strong>ผู้รับคนที่ 2:</strong> ${esc(r.recipient2Name || '-')} ${r.recipient2Phone ? `(${esc(r.recipient2Phone)})` : ''}</div>
        <div class="col-12"><strong>ผู้รับคนที่ 3 / พยาน:</strong> ${esc(r.recipient3Name || '-')} ${r.recipient3Phone ? `(${esc(r.recipient3Phone)})` : ''}</div>
        <div class="col-12"><strong>ผู้มอบปัจจัย:</strong> ${esc(r.donorName || 'พระอนุชา ทานิสฺสโร')}</div>
      </div>
      <h6 class="fw-bold text-navy border-top pt-3 mb-2">📋 รายชื่อวัดที่เบิกจ่าย:</h6>
      <div style="max-height: 240px; overflow-y: auto;">
        ${templesHtml}
      </div>
    </div>
  `;
  document.querySelector('#editor-modal .modal-footer button[type="submit"]').style.display = 'none';
  modal.show();
  document.getElementById('editor-modal').addEventListener('hidden.bs.modal', () => {
    document.querySelector('#editor-modal .modal-footer button[type="submit"]').style.display = '';
  }, { once: true });
}

function reprintDisbRecord(id) {
  const r = (data.disbursements || []).find(x => x.disbursementId === id);
  if (!r) return;

  let temples = [];
  try {
    temples = typeof r.templeDetailsJson === 'string' ? JSON.parse(r.templeDetailsJson) : (r.templeDetailsJson || []);
  } catch (e) {
    temples = [];
  }

  disbState.selectedTemples = temples;
  disbState.recipient1 = { id: r.recipient1Id || '', name: r.recipient1Name || '', phone: r.recipient1Phone || '' };
  disbState.recipient2 = { id: r.recipient2Id || '', name: r.recipient2Name || '', phone: r.recipient2Phone || '' };
  disbState.recipient3 = { id: r.recipient3Id || '', name: r.recipient3Name || '', phone: r.recipient3Phone || '' };
  disbState.donorName = r.donorName || 'พระอนุชา ทานิสฺสโร';
  disbState.documentDate = r.documentDate || new Date().toISOString().substring(0, 10);
  disbState.createdByName = r.createdBy || '';
  disbState.isViewingHistoryPrint = true;

  setDisbSubtab('print');
}

async function deleteDisbursementRecord(id) {
  if (!confirm(`ยืนยันการลบเอกสารเลขที่ ${id} หรือไม่?\nการลบจะเปลี่ยนสถานะวัดที่เกี่ยวข้องกลับเป็น "ยังไม่ได้เบิก"`)) return;
  try {
    const res = await api('admin-disbursements', {
      method: 'DELETE',
      body: JSON.stringify({ disbursementId: id, revertTemples: true })
    });
    data.disbursements = (data.disbursements || []).filter(d => d.disbursementId !== id);
    if (res.revertedTempleIds) {
      res.revertedTempleIds.forEach(tid => {
        const k = (data.kathin || []).find(x => x.templeId === tid);
        if (k) k.disbursementStatus = 'UNPAID';
      });
    }
    toast(`ลบเอกสารเรียบร้อยแล้ว (คืนสถานะวัด ${res.revertedTempleIds?.length || 0} วัด)`, 'success');
    renderDisbHistory();
  } catch (err) {
    alertUser(err.message || 'ไม่สามารถลบเอกสารได้');
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  modal=new bootstrap.Modal($('#editor-modal'));
  const pubModalEl = $('#public-list-config-modal');
  if (pubModalEl) publicListModal = new bootstrap.Modal(pubModalEl);
  const templeModalEl = $('#temple-profile-modal');
  if (templeModalEl) templeProfileModal = new bootstrap.Modal(templeModalEl);
  const personModalEl = $('#person-profile-modal');
  if (personModalEl) personProfileModal = new bootstrap.Modal(personModalEl);

  $('#btn-open-public-list-config') && ($('#btn-open-public-list-config').onclick = openPublicListConfigModal);
  $('#btn-open-public-list-config-prj') && ($('#btn-open-public-list-config-prj').onclick = openPublicListConfigModal);
  $('#login-form').onsubmit=login;
  $('#editor-form').onsubmit=saveEditor;

  // Sidebar expand / collapse / toggle controls
  function updateSidebarState(collapsed) {
    if (collapsed) {
      document.body.classList.add('sidebar-collapsed');
      localStorage.setItem('admin_sidebar_collapsed', 'true');
      const label = $('#btn-toggle-sidebar-label');
      if (label) label.textContent = 'แสดงเมนู';
      const badge = $('#badge-view-mode');
      if (badge) badge.textContent = '🖥️ โหมดเต็มจอ (Full Width)';
      const btn = $('#btn-toggle-sidebar');
      if (btn) {
        btn.classList.add('btn-primary', 'text-white');
        btn.classList.remove('btn-outline-secondary');
        btn.title = 'แสดงแถบเมนูด้านซ้าย (Ctrl+B)';
      }
    } else {
      document.body.classList.remove('sidebar-collapsed');
      localStorage.setItem('admin_sidebar_collapsed', 'false');
      const label = $('#btn-toggle-sidebar-label');
      if (label) label.textContent = 'ซ่อนเมนู';
      const badge = $('#badge-view-mode');
      if (badge) badge.textContent = '🖥️ โหมดปกติ';
      const btn = $('#btn-toggle-sidebar');
      if (btn) {
        btn.classList.remove('btn-primary', 'text-white');
        btn.classList.add('btn-outline-secondary');
        btn.title = 'ซ่อนแถบเมนูด้านซ้ายเพื่อขยายหน้าจอเต็มที่ (Ctrl+B)';
      }
    }
  }

  function toggleSidebar() {
    if (window.innerWidth < 992) {
      $('#admin-sidebar')?.classList.toggle('show');
      $('#admin-sidebar-backdrop')?.classList.toggle('d-none');
    } else {
      const isCurrentlyCollapsed = document.body.classList.contains('sidebar-collapsed');
      updateSidebarState(!isCurrentlyCollapsed);
    }
  }

  // Restore saved desktop preference
  if (localStorage.getItem('admin_sidebar_collapsed') === 'true' && window.innerWidth >= 992) {
    updateSidebarState(true);
  }

  // Sidebar buttons wiring
  $('#admin-sidebar-toggle') && ($('#admin-sidebar-toggle').onclick = toggleSidebar);
  $('#btn-toggle-sidebar') && ($('#btn-toggle-sidebar').onclick = toggleSidebar);
  $('#btn-collapse-sidebar') && ($('#btn-collapse-sidebar').onclick = () => updateSidebarState(true));
  $('#admin-sidebar-close') && ($('#admin-sidebar-close').onclick = () => {
    if (window.innerWidth < 992) {
      $('#admin-sidebar')?.classList.remove('show');
      $('#admin-sidebar-backdrop')?.classList.add('d-none');
    } else {
      updateSidebarState(true);
    }
  });
  $('#admin-sidebar-backdrop') && ($('#admin-sidebar-backdrop').onclick = () => {
    $('#admin-sidebar')?.classList.remove('show');
    $('#admin-sidebar-backdrop')?.classList.add('d-none');
  });

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        toggleSidebar();
      }
    }
  });

  $('#logout-mobile') && ($('#logout-mobile').onclick = async () => {
    await api('admin-login', { method: 'DELETE' });
    location.reload();
  });

  $$('[data-tab]').forEach(b=>b.onclick=()=>{
    $$('[data-tab]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $$('.tab-pane').forEach(x=>x.classList.add('d-none'));
    $(`#${b.dataset.tab}-pane`)?.classList.remove('d-none');
    $('#admin-sidebar')?.classList.remove('show');
    $('#admin-sidebar-backdrop')?.classList.add('d-none');
    if(b.dataset.tab==='dashboard')renderDashboard();
    if(b.dataset.tab==='reports')loadReports();
    if(b.dataset.tab==='disbursements')renderDisbursements();
    if(b.dataset.tab==='homepage')renderHomepageCMS();
    if(b.dataset.tab==='admins')renderAdminUsers();
  });

  $('#logout').onclick=async()=>{await api('admin-login',{method:'DELETE'});location.reload();};
  $('#admin-add-person').onclick=addRegistration;
  $('#add-project').onclick=()=>editProject(null);
  $('#add-session').onclick=()=>editSession(null);
  $('#session-project-filter') && ($('#session-project-filter').onchange = renderSessions);
  $('#session-type-filter') && ($('#session-type-filter').onchange = renderSessions);
  $('#add-temple').onclick=()=>editTemple(null);
  $('#add-kathin') && ($('#add-kathin').onclick = () => editKathin(null));
  $('#add-form-field').onclick=()=>editFormField(null);
  $('#quick-add-remarks') && ($('#quick-add-remarks').onclick = () => editFormField(null, { fieldKey: 'remarks', label: 'หมายเหตุ / ข้อความถึงเจ้าหน้าที่', fieldType: 'textarea', placeholder: 'ระบุข้อมูลเพิ่มเติม (ถ้ามี)', required: 'FALSE', visible: 'TRUE', sortOrder: '1' }));
  $('#quick-add-health') && ($('#quick-add-health').onclick = () => editFormField(null, { fieldKey: 'medicalCondition', label: 'โรคประจำตัว / ข้อจำกัดด้านสุขภาพ', fieldType: 'text', placeholder: 'เช่น ไม่มี หรือ ระบุโรค/อาหารที่แพ้', required: 'FALSE', visible: 'TRUE', sortOrder: '2' }));
  $('#quick-add-shirt') && ($('#quick-add-shirt').onclick = () => editFormField(null, { fieldKey: 'shirtSize', label: 'ขนาดเสื้อที่ต้องการ', fieldType: 'select', optionsJson: 'S, M, L, XL, 2XL, 3XL', placeholder: '', required: 'FALSE', visible: 'TRUE', sortOrder: '3' }));
  $('#quick-add-address') && ($('#quick-add-address').onclick = () => editFormField(null, { fieldKey: 'address', label: 'ที่อยู่ติดต่อ / ที่อยู่จัดส่ง', fieldType: 'textarea', placeholder: 'บ้านเลขที่ หมู่ที่ ซอย ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์', required: 'FALSE', visible: 'TRUE', sortOrder: '4' }));
  $('#form-project-selector').onchange=renderFormFields;
  $('#registration-search-button').onclick=searchRegistrations;
  $('#registration-search') && ($('#registration-search').oninput = () => renderRegistrations());
  $('#registration-search') && ($('#registration-search').onkeyup = e => { if (e.key === 'Enter') searchRegistrations(); });
  $('#temple-search-button').onclick=searchTemples;
  $('#temple-search') && ($('#temple-search').onkeyup = e => { if (e.key === 'Enter') searchTemples(); });
  $('#btn-delete-selected-temples') && ($('#btn-delete-selected-temples').onclick = deleteSelectedTemples);
  $('#btn-delete-selected-temples-bar') && ($('#btn-delete-selected-temples-bar').onclick = deleteSelectedTemples);
  $('#btn-deselect-all-temples') && ($('#btn-deselect-all-temples').onclick = deselectAllTemples);
  $$('.btn-bulk-temple-status').forEach(b => {
    b.onclick = () => bulkUpdateTempleStatus(b.dataset.status);
  });
  $('#btn-delete-selected-kathins') && ($('#btn-delete-selected-kathins').onclick = deleteSelectedKathins);
  $('#btn-delete-selected-kathins-bar') && ($('#btn-delete-selected-kathins-bar').onclick = deleteSelectedKathins);
  $('#btn-deselect-all-kathins') && ($('#btn-deselect-all-kathins').onclick = deselectAllKathins);
  $$('.btn-bulk-kathin-status').forEach(b => {
    b.onclick = () => bulkUpdateKathinStatus(b.dataset.status);
  });
  $('#person-search-button').onclick=searchPersons;
  $('#person-search').onkeyup=e=>{if(e.key==='Enter')searchPersons();};
  $('#excel-file').onchange=e=>e.target.files[0]&&previewImport(e.target.files[0]);
  $('#kathin-excel-file').onchange=e=>e.target.files[0]&&previewKathinImport(e.target.files[0]);
  $('#registration-project-filter') && ($('#registration-project-filter').onchange = renderRegistrations);
  $('#export-registrations').onclick = () => {
    const p = $('#registration-project-filter')?.value || '';
    downloadExcel('registrations', p);
  };
  $('#export-temples').onclick=()=>downloadExcel('temples');
  $('#export-kathin').onclick=()=>downloadExcel('kathin');
  $('#export-persons').onclick=()=>downloadExcel('persons');
  $('#btn-refresh-dashboard') && ($('#btn-refresh-dashboard').onclick = async () => {
    await load();
    toast('รีเฟรชข้อมูลล่าสุดเรียบร้อยแล้ว');
  });
  $('#btn-add-admin') && ($('#btn-add-admin').onclick = () => editAdminUser(null));
  $('#btn-refresh-admins') && ($('#btn-refresh-admins').onclick = async () => { await load(); renderAdminUsers(); toast('รีเฟรชรายชื่อผู้ดูแลแล้ว'); });
  $('#admin-user-search') && ($('#admin-user-search').oninput = renderAdminUsers);
  $('#refresh-report-view') && ($('#refresh-report-view').onclick = loadReports);
  $('#refresh-report-sheets') && ($('#refresh-report-sheets').onclick = refreshReportSheets);
  
  setupQuickSearchListeners();
  load();
});

