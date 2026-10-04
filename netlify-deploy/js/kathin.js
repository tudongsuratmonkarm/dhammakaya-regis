const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

let allKathins = [];
let activeType = 'กฐินแสน';
let activeDate = '';
let filterLeaderOnly = false;
let viewMode = 'cards'; // 'cards' | 'table'
let sortField = 'date';
let sortDir = 'asc';

export function hasKathinLeader(k) {
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
  } else if (field === 'abbot') {
    res = (a.abbotName || '').localeCompare(b.abbotName || '', 'th');
  } else if (field === 'disciple1') {
    res = (a.disciple1Name || '').localeCompare(b.disciple1Name || '', 'th');
  } else {
    res = (a.templeName || '').localeCompare(b.templeName || '', 'th');
  }
  return dir === 'desc' ? -res : res;
}

async function loadData() {
  try {
    const res = await fetch('/.netlify/functions/public-kathin');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429 || /quota|rate limit|resource_exhausted/i.test(body?.error?.message || '')) {
        throw new Error('ท่านทำรายการติดต่อกันมากจนเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
      }
      throw new Error(body.error?.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล');
    }
    allKathins = body.data?.kathins || [];
    updateTabCounts();
    buildDateBar();
    renderList();
  } catch (err) {
    const msg = /quota|rate limit|resource_exhausted/i.test(err?.message || '')
      ? 'ท่านทำรายการติดต่อกันมากจนเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'
      : (err.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล');
    $('#kathin-list').innerHTML = `<div class="col-12"><div class="alert alert-warning text-center">${esc(msg)}</div></div>`;
  }
}

function updateLeaderBadgeCount() {
  const pool = activeType ? allKathins.filter(k => k.kathinType === activeType) : allKathins;
  const count = pool.filter(hasKathinLeader).length;
  if ($('#badge-leader-count')) $('#badge-leader-count').textContent = count;
}

function updateTabCounts() {
  const saenCount = allKathins.filter(k => k.kathinType === 'กฐินแสน').length;
  const muenCount = allKathins.filter(k => k.kathinType === 'กฐินหมื่น').length;
  if ($('#tab-badge-saen')) $('#tab-badge-saen').textContent = `${saenCount} วัด`;
  if ($('#tab-badge-muen')) $('#tab-badge-muen').textContent = `${muenCount} วัด`;

  if (activeType === 'กฐินแสน' && saenCount === 0 && muenCount > 0) {
    setActiveType('กฐินหมื่น');
  }
  updateLeaderBadgeCount();
}

function setActiveType(type) {
  activeType = type;
  activeDate = '';

  const cardSaen = $('#card-tab-saen');
  const cardMuen = $('#card-tab-muen');
  const checkSaen = cardSaen?.querySelector('.tab-check');
  const checkMuen = cardMuen?.querySelector('.tab-check');

  if (type === 'กฐินแสน') {
    cardSaen?.style.setProperty('border-color', '#0284c7');
    cardSaen?.style.setProperty('background', '#f0f9ff');
    cardMuen?.style.setProperty('border-color', '#e2e8f0');
    cardMuen?.style.setProperty('background', '#ffffff');
    checkSaen?.classList.remove('d-none');
    checkMuen?.classList.add('d-none');
    if ($('#active-tab-title')) {
      $('#active-tab-title').textContent = 'กำลังแสดง: 🌟 กฐินแสน';
      $('#active-tab-title').className = 'small fw-semibold text-primary';
    }
  } else {
    cardMuen?.style.setProperty('border-color', '#16a34a');
    cardMuen?.style.setProperty('background', '#f0fdf4');
    cardSaen?.style.setProperty('border-color', '#e2e8f0');
    cardSaen?.style.setProperty('background', '#ffffff');
    checkMuen?.classList.remove('d-none');
    checkSaen?.classList.add('d-none');
    if ($('#active-tab-title')) {
      $('#active-tab-title').textContent = 'กำลังแสดง: 🎆 กฐินหมื่น';
      $('#active-tab-title').className = 'small fw-semibold text-success';
    }
  }

  updateLeaderBadgeCount();
  buildDateBar();
  renderList();
}


function buildDateBar() {
  const currentPool = activeType ? allKathins.filter(k => k.kathinType === activeType) : allKathins;
  const counts = {};
  currentPool.forEach(k => {
    const d = k.kathinDate || 'ไม่ระบุวัน';
    if (!counts[d]) counts[d] = { wats: 0, districts: new Set() };
    counts[d].wats++;
    if (k.district) counts[d].districts.add(k.district);
  });

  const bar = $('#date-filter-bar');
  if (!bar) return;

  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  let html = `<button class="btn btn-sm ${!activeDate ? 'btn-primary active-chip' : 'btn-outline-primary'} date-chip me-1 mb-1" data-date="">ทั้งหมด <span class="badge bg-white text-primary ms-1">${currentPool.length} วัด</span></button>`;
  entries.forEach(([d, v]) => {
    const isAct = activeDate === d;
    html += `<button class="btn btn-sm ${isAct ? 'btn-primary active-chip' : 'btn-outline-primary'} date-chip me-1 mb-1" data-date="${esc(d)}">📅 ${esc(d)} <span class="badge ${isAct ? 'bg-white text-primary' : 'bg-primary'} ms-1">${v.wats} วัด</span><span class="small ms-1 opacity-75">/ ${v.districts.size} อำเภอ</span></button>`;
  });
  bar.innerHTML = html;

  $$('.date-chip', bar).forEach(btn => btn.addEventListener('click', () => {
    $$('.date-chip', bar).forEach(b => {
      b.classList.remove('btn-primary', 'active-chip');
      b.classList.add('btn-outline-primary');
      const bg = b.querySelector('.badge');
      if (bg) { bg.classList.remove('bg-white', 'text-primary'); bg.classList.add('bg-primary'); }
    });
    btn.classList.remove('btn-outline-primary');
    btn.classList.add('btn-primary', 'active-chip');
    const badge = btn.querySelector('.badge');
    if (badge) { badge.classList.remove('bg-primary'); badge.classList.add('bg-white', 'text-primary'); }
    activeDate = btn.dataset.date;
    renderList();
  }));
}

function renderList() {
  const text = ($('#search-text')?.value || '').trim().toLowerCase();
  const dist = $('#filter-district')?.value || '';

  const pool = allKathins.map((k, idx) => ({ ...k, _origIdx: idx + 1 }));

  let filtered = pool.filter(k => {
    if (activeType && k.kathinType !== activeType) return false;
    if (activeDate && (k.kathinDate || 'ไม่ระบุวัน') !== activeDate) return false;
    if (filterLeaderOnly && !hasKathinLeader(k)) return false;
    if (text) {
      const searchTarget = `${k.templeName} ${k.district} ${k.subdistrict} ${k.abbotName || ''} ${k.disciple1Name || ''} ${k.disciple2Name || ''} ${k.description || ''} ${hasKathinLeader(k) ? 'มีประธานนำกล่าวแล้ว ประธานนำกล่าว มีประธาน' : ''}`.toLowerCase();
      if (!searchTarget.includes(text)) return false;
    }
    if (dist && k.district !== dist) return false;
    return true;
  });

  filtered.sort((a, b) => compareKathinRecords(a, b, sortField, sortDir));

  const countEl = $('#result-count');
  if (countEl) countEl.textContent = `พบ ${filtered.length} วัด`;

  const distSel = $('#filter-district');
  if (distSel) {
    const cur = distSel.value;
    const poolType = activeType ? allKathins.filter(k => k.kathinType === activeType) : allKathins;
    const list = [...new Set(poolType.map(k => k.district).filter(Boolean))].sort();
    let opts = '<option value="">ทุกอำเภอ</option>';
    list.forEach(d => { opts += `<option value="${esc(d)}"${d === cur ? ' selected' : ''}>${esc(d)}</option>`; });
    distSel.innerHTML = opts;
  }

  const listArea = $('#kathin-list');
  if (!filtered.length) {
    listArea.innerHTML = `<div class="col-12 text-center text-muted py-5"><div class="fs-1 mb-2">🔍</div>ไม่พบข้อมูลกฐินที่ค้นหา</div>`;
    return;
  }

  const phone = (name, ph) => {
    if (!name) return '<span class="text-muted small">-</span>';
    return `<span class="small">${esc(name)}${ph ? ` <a href="tel:${esc(ph)}" class="badge bg-success bg-opacity-10 text-success border border-success text-decoration-none">📞 ${esc(ph)}</a>` : ''}</span>`;
  };

  const sortIcon = f => {
    if (sortField === f) {
      return sortDir === 'asc' ? ' <span class="text-warning fw-bold">▲</span>' : ' <span class="text-warning fw-bold">▼</span>';
    }
    return ' <span class="text-white-50 small opacity-50">↕</span>';
  };

  if (viewMode === 'table') {
    listArea.innerHTML = `
      <div class="col-12">
        <div class="table-responsive bg-white rounded-3 shadow-sm border">
          <table class="table table-hover align-middle mb-0 small">
            <thead class="table-dark">
              <tr>
                <th class="text-center sortable-public-th" data-sort="index" style="width: 65px; cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงลำดับ">ลำดับ${sortIcon('index')}</th>
                <th class="sortable-public-th" data-sort="name" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงชื่อวัด (ก-ฮ / ฮ-ก)">ชื่อวัด${sortIcon('name')}</th>
                <th class="sortable-public-th" data-sort="district" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงตำบล/อำเภอ">ตำบล / อำเภอ / จังหวัด${sortIcon('district')}</th>
                <th class="sortable-public-th" data-sort="type" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงประเภท">ประเภท${sortIcon('type')}</th>
                <th class="text-center sortable-public-th" data-sort="monks" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงจำนวนพระ (มาก-น้อย / น้อย-มาก)">พระจำพรรษา${sortIcon('monks')}</th>
                <th class="sortable-public-th" data-sort="date" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงวันทอดกฐิน">วันทอดกฐิน / เวลา${sortIcon('date')}</th>
                <th class="sortable-public-th" data-sort="abbot" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงเจ้าอาวาส">เจ้าอาวาส${sortIcon('abbot')}</th>
                <th class="sortable-public-th" data-sort="disciple1" style="cursor:pointer; user-select:none;" title="คลิกเพื่อเรียงผู้ประสานงาน">ผู้ประสานงาน${sortIcon('disciple1')}</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((k, idx) => `
                <tr>
                  <td class="text-center fw-bold text-muted">${idx + 1}</td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      ${(k.imageUrl || (k.images && k.images[0])) ? `<img src="${esc(k.imageUrl || k.images[0])}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0;flex-shrink:0;" onerror="this.remove()">` : ''}
                      <div>
                        <strong class="text-primary">${esc(k.templeName)}</strong>
                        ${hasKathinLeader(k) ? `<div class="mt-1"><span class="badge bg-warning text-dark border border-warning shadow-sm"><i class="bi bi-star-fill me-1"></i>👑 มีประธานนำกล่าวแล้ว</span></div>` : ''}
                      </div>
                    </div>
                  </td>
                  <td>ต.${esc(k.subdistrict || '-')} อ.${esc(k.district || '-')}<br><small class="text-muted">จ.${esc(k.province || '-')}</small></td>
                  <td><span class="badge ${k.kathinType === 'กฐินแสน' ? 'bg-primary' : 'bg-success'}">${esc(k.kathinType)}</span></td>
                  <td class="text-center fw-bold">${esc(k.residentMonks || '0')} รูป</td>
                  <td><strong>${esc(k.kathinDate || 'ไม่ระบุ')}</strong>${k.kathinTime ? `<br><small class="text-muted">⏰ ${esc(k.kathinTime)} น.</small>` : ''}</td>
                  <td>${phone(k.abbotName, k.abbotPhone)}</td>
                  <td>${phone(k.disciple1Name, k.disciple1Phone)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    $$('.sortable-public-th').forEach(th => {
      th.onclick = () => {
        const f = th.dataset.sort;
        if (sortField === f) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = f;
          sortDir = (f === 'monks' ? 'desc' : 'asc');
        }
        if ($('#filter-sort')) {
          const val = `${sortField}-${sortDir}`;
          if ($(`#filter-sort option[value="${val}"]`)) {
            $('#filter-sort').value = val;
          }
        }
        renderList();
      };
    });

    return;
  }

  // Cards view
  listArea.innerHTML = filtered.map((k, idx) => {
    const rawImg = k.imageUrl || (k.images && k.images[0]) || '';
    const img = rawImg
      ? `<img src="${esc(rawImg)}" class="card-img-top" alt="ภาพวัด" style="height:160px;object-fit:cover;" onerror="this.onerror=null;this.classList.add('d-none');this.nextElementSibling?.classList.remove('d-none');"><div class="d-flex align-items-center justify-content-center text-muted d-none" style="height:90px;background:#f8fafc;font-size:2rem;">🙏</div>`
      : `<div class="d-flex align-items-center justify-content-center text-muted" style="height:90px;background:#f8fafc;font-size:2rem;">🙏</div>`;
    const badge = `<span class="badge ${k.kathinType === 'กฐินแสน' ? 'bg-primary' : 'bg-success'}">${esc(k.kathinType)}</span>`;
    const leaderTag = hasKathinLeader(k)
      ? `<span class="badge bg-warning text-dark border border-warning shadow-sm fw-bold">👑 มีประธานนำกล่าวแล้ว</span>`
      : '';
    const dateText = k.kathinDate
      ? `${esc(k.kathinDate)}${k.kathinTime ? ` เวลา ${esc(k.kathinTime)} น.` : ''}`
      : `<span class="text-muted">ยังไม่ระบุ</span>`;

    return `
      <div class="col-sm-6 col-lg-4 col-xl-3">
        <div class="card h-100 shadow-sm border-0 rounded-3 overflow-hidden position-relative">
          <div class="position-absolute top-0 start-0 m-2 z-1">
            <span class="badge bg-dark bg-opacity-75 fs-6 px-2 py-1 shadow-sm">ลำดับ ${idx + 1}</span>
          </div>
          ${img}
          <div class="card-body p-3">
            <div class="d-flex align-items-center justify-content-between mb-1 gap-1 flex-wrap">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                ${badge}
                ${leaderTag}
              </div>
              <small class="text-muted fw-semibold">${esc(k.residentMonks || '0')} รูป</small>
            </div>
            <h6 class="card-title fw-bold text-primary mb-0">${esc(k.templeName)}</h6>
            <p class="text-muted small mb-2">ต.${esc(k.subdistrict || '')} อ.${esc(k.district || '')} จ.${esc(k.province || '')}</p>
            <hr class="my-2">
            <div class="small">
              <div class="d-flex gap-1 mb-1"><span class="text-muted" style="min-width:75px">📅 วันทอด:</span><span class="fw-semibold">${dateText}</span></div>
              <div class="d-flex gap-1 mb-1 align-items-start"><span class="text-muted" style="min-width:75px">☸ เจ้าอาวาส:</span><div>${phone(k.abbotName, k.abbotPhone)}</div></div>
              <div class="d-flex gap-1 mb-1 align-items-start"><span class="text-muted" style="min-width:75px">👤 ศิษย์ที่ 1:</span><div>${phone(k.disciple1Name, k.disciple1Phone)}</div></div>
              ${k.disciple2Name ? `<div class="d-flex gap-1 align-items-start"><span class="text-muted" style="min-width:75px">👤 ศิษย์ที่ 2:</span><div>${phone(k.disciple2Name, k.disciple2Phone)}</div></div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  $('#card-tab-saen')?.addEventListener('click', () => setActiveType('กฐินแสน'));
  $('#card-tab-muen')?.addEventListener('click', () => setActiveType('กฐินหมื่น'));

  $('#btn-view-cards')?.addEventListener('click', () => {
    viewMode = 'cards';
    $('#btn-view-cards')?.classList.add('btn-primary', 'active');
    $('#btn-view-cards')?.classList.remove('btn-outline-primary');
    $('#btn-view-table')?.classList.add('btn-outline-primary');
    $('#btn-view-table')?.classList.remove('btn-primary', 'active');
    renderList();
  });

  $('#btn-view-table')?.addEventListener('click', () => {
    viewMode = 'table';
    $('#btn-view-table')?.classList.add('btn-primary', 'active');
    $('#btn-view-table')?.classList.remove('btn-outline-primary');
    $('#btn-view-cards')?.classList.add('btn-outline-primary');
    $('#btn-view-cards')?.classList.remove('btn-primary', 'active');
    renderList();
  });

  $('#btn-toggle-leader-filter')?.addEventListener('click', () => {
    filterLeaderOnly = !filterLeaderOnly;
    const btn = $('#btn-toggle-leader-filter');
    if (btn) {
      btn.classList.toggle('btn-warning', filterLeaderOnly);
      btn.classList.toggle('text-dark', true);
      btn.classList.toggle('btn-outline-warning', !filterLeaderOnly);
    }
    renderList();
  });

  $('#search-text')?.addEventListener('input', renderList);
  $('#filter-district')?.addEventListener('change', renderList);
  $('#filter-sort')?.addEventListener('change', () => {
    const parts = ($('#filter-sort')?.value || 'date-asc').split('-');
    sortField = parts[0] || 'date';
    sortDir = parts[1] || 'asc';
    renderList();
  });
  loadData();
});

