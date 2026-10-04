const api = async (path, options = {}) => {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({ success: false, error: { message: 'ไม่สามารถอ่านข้อมูลจากระบบได้' } }));
  if (!response.ok || !body.success) {
    if (response.status === 429 || /quota|rate limit|resource_exhausted/i.test(body.error?.message || '')) {
      throw new Error('ท่านทำรายการติดต่อกันมากจนเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
    }
    throw new Error(body.error?.message || 'เกิดข้อผิดพลาดในระบบ');
  }
  return body.data;
};

const state = { projects: [], sessions: [], formFields: [], temples: [], templeId: '', selectedBatch: null, submitted: null, publicPage: 1 };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

function alertUser(message, type = 'danger') {
  $('#alert-area').innerHTML = `<div class="alert alert-${type} alert-dismissible fade show mt-3" role="alert">${escapeHtml(message)}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="ปิด"></button></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * แปลงวันที่ไทย พ.ศ. รูปแบบ "วว/มม/ปปปป" เป็น ISO "YYYY-MM-DD" (ค.ศ.)
 * คืน '' ถ้าข้อมูลไม่ถูกต้อง
 */
function parseThaiBuddhistDate(str) {
  if (!str) return '';
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  const yearBE = Number(m[3]);
  if (yearBE < 2400 || yearBE > 2700) return ''; // sanity check
  const yearCE = yearBE - 543;
  return `${yearCE}-${month}-${day}`;
}

/**
 * แปลง ISO "YYYY-MM-DD" (ค.ศ.) เป็นวันที่ไทย พ.ศ. "วว/มม/ปปปป"
 */
function toThaiBuddhistDate(isoStr) {
  if (!isoStr || !/^\d{4}-\d{2}-\d{2}/.test(isoStr)) return isoStr || '';
  const [y, mo, d] = isoStr.slice(0,10).split('-');
  return `${d}/${mo}/${Number(y) + 543}`;
}

/**
 * คำนวณอายุจากวันที่ไทย (พ.ศ.) หรือ ISO
 */
function calculateAge(dateInput) {
  if (!dateInput) return '';
  // รองรับทั้ง "วว/มม/ปปปป" (พ.ศ.) และ "YYYY-MM-DD" (ค.ศ.)
  const iso = dateInput.includes('/') ? parseThaiBuddhistDate(dateInput) : dateInput;
  if (!iso) return '';
  const born = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  if (today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())) age--;
  return age >= 0 && age < 130 ? String(age) : '';
}

/**
 * คำนวณพรรษาจากวันที่บวช (พ.ศ. "วว/มม/ปปปป" หรือ ISO "YYYY-MM-DD")
 * ใช้สูตร: ปีปัจจุบัน - ปีที่บวช + 1
 *   หักถ้าบวชหลังเดือน 9, หักถ้าปัจจุบันยังไม่ถึงเดือน 7
 */
function calculatePhansa(dateInput) {
  if (!dateInput) return '';
  const iso = dateInput.includes('/') ? parseThaiBuddhistDate(dateInput) : dateInput;
  if (!iso) return '';
  const ordDate = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(ordDate.getTime())) return '';
  const today = new Date();
  const ordYear = ordDate.getFullYear();
  const ordMonth = ordDate.getMonth() + 1;
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  let phansa = currentYear - ordYear + 1;
  if (ordMonth > 9) phansa -= 1;
  if (currentMonth < 7) phansa -= 1;
  if (phansa < 0) phansa = 0;
  return String(phansa);
}

/**
 * Auto-format Thai date input as user types: 01/06/2545
 */
function autoFormatThaiDate(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 8) v = v.slice(0, 8);
  if (v.length > 4) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
  input.value = v;
}

/**
 * ตรวจสอบความถูกต้องของเลขบัตรประชาชน 13 หลักตามสูตร Modulo 11
 */
function isValidThaiNationalId(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(id.charAt(i), 10) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(id.charAt(12), 10);
}

/**
 * Live validation เบอร์มือถือ: แสดงผลสีเขียว/แดงเตือนทันทีขณะพิมพ์
 */
function validateThaiMobileLive(inputEl, feedbackEl) {
  if (!inputEl) return;
  const raw = inputEl.value;
  const clean = raw.replace(/\D/g, '').slice(0, 10);
  if (raw !== clean) inputEl.value = clean;
  
  if (!feedbackEl) return;

  if (!clean.length) {
    inputEl.classList.remove('is-valid', 'is-invalid');
    feedbackEl.className = 'mobile-feedback small mt-1 d-none';
    feedbackEl.textContent = '';
    return;
  }

  if (clean.length < 10) {
    inputEl.classList.add('is-invalid');
    inputEl.classList.remove('is-valid');
    feedbackEl.className = 'mobile-feedback small mt-1 text-danger fw-semibold d-block';
    feedbackEl.innerHTML = `⚠️ เบอร์โทรยังไม่ครบ 10 หลัก (ขณะนี้ ${clean.length} หลัก, ขาดอีก ${10 - clean.length} หลัก)`;
  } else if (clean.length === 10) {
    if (!clean.startsWith('0')) {
      inputEl.classList.add('is-invalid');
      inputEl.classList.remove('is-valid');
      feedbackEl.className = 'mobile-feedback small mt-1 text-danger fw-semibold d-block';
      feedbackEl.innerHTML = `❌ เบอร์โทรควรขึ้นต้นด้วย 0 (เช่น 08x, 09x, 06x)`;
    } else {
      inputEl.classList.remove('is-invalid');
      inputEl.classList.add('is-valid');
      feedbackEl.className = 'mobile-feedback small mt-1 text-success fw-semibold d-block';
      feedbackEl.innerHTML = `✓ เบอร์โทรถูกต้องครบ 10 หลัก`;
    }
  }
}

/**
 * Live validation เลขบัตรประชาชน: แสดงผลสีเขียว/แดงเตือนทันทีขณะพิมพ์
 */
function validateThaiNationalIdLive(inputEl, feedbackEl) {
  if (!inputEl) return;
  const raw = inputEl.value;
  const clean = raw.replace(/\D/g, '').slice(0, 13);
  if (raw !== clean) inputEl.value = clean;
  
  if (!feedbackEl) return;

  if (!clean.length) {
    inputEl.classList.remove('is-valid', 'is-invalid');
    feedbackEl.className = 'national-id-feedback small mt-1 d-none';
    feedbackEl.textContent = '';
    return;
  }

  if (clean.length < 13) {
    inputEl.classList.add('is-invalid');
    inputEl.classList.remove('is-valid');
    feedbackEl.className = 'national-id-feedback small mt-1 text-danger fw-semibold d-block';
    feedbackEl.innerHTML = `⚠️ เลขบัตรประชาชนยังไม่ครบ 13 หลัก (ขณะนี้ ${clean.length} หลัก, ขาดอีก ${13 - clean.length} หลัก)`;
  } else if (clean.length === 13) {
    const validChecksum = isValidThaiNationalId(clean);
    if (validChecksum) {
      inputEl.classList.remove('is-invalid');
      inputEl.classList.add('is-valid');
      feedbackEl.className = 'national-id-feedback small mt-1 text-success fw-semibold d-block';
      feedbackEl.innerHTML = `✓ เลขบัตรประชาชนถูกต้องครบ 13 หลัก`;
    } else {
      inputEl.classList.add('is-invalid');
      inputEl.classList.remove('is-valid');
      feedbackEl.className = 'national-id-feedback small mt-1 text-danger fw-semibold d-block';
      feedbackEl.innerHTML = `⚠️ เลขบัตรประชาชนครบ 13 หลัก แต่รูปแบบตัวเลขไม่ถูกต้อง กรุณาตรวจทาน`;
    }
  }
}


function persistDraft() {
  const temple = { templeId: state.templeId, templeName: $('#temple-name').value, subdistrict: $('#subdistrict').value, district: $('#district').value, province: $('#province').value };
  const participants = $$('.participant-card').map(card => {
    if (card.dataset.dynamic === 'true') {
      const data = {};
      $$('.dyn-input', card).forEach(el => data[el.dataset.key] = el.value);
      $$('.dyn-checkbox-group', card).forEach(grp => {
        const checked = $$('.dyn-check:checked', grp).map(cb => cb.value);
        data[grp.dataset.key] = checked;
      });
      return data;
    }
    return { prefix: $('.prefix', card).value, otherPrefix: $('.other-prefix', card).value, monasticName: $('.monastic-name', card).value, firstName: $('.first-name', card).value, lastName: $('.last-name', card).value, mobile: $('.mobile', card).value, birthDate: $('.birth-date', card).value, ordinationDate: $('.ordination-date', card)?.value || '' };
  });
  localStorage.setItem('ubk2569-draft', JSON.stringify({ sessionId: $('#session-id').value, temple, participants }));
}
function clearDraft() { localStorage.removeItem('ubk2569-draft'); }
function readDraft() { try { return JSON.parse(localStorage.getItem('ubk2569-draft') || 'null'); } catch { return null; } }

function renderProjects() {
  const root = $('#project-cards'); root.setAttribute('aria-busy', 'false');
  if (!state.projects.length) { root.innerHTML = '<p class="text-muted">ขณะนี้ยังไม่มีโครงการที่เปิดรับสมัคร</p>'; return; }
  root.innerHTML = state.projects.map(p => `
    <div class="col-md-6">
      <article class="session-card">
        <h3>${escapeHtml(p.projectName)}</h3>
        <p class="text-muted">${escapeHtml(p.projectType)}</p>
        <button class="btn btn-primary choose-project" data-id="${escapeHtml(p.projectId)}">เลือกโครงการนี้</button>
      </article>
    </div>
  `).join('');
  $$('.choose-project').forEach(btn => btn.addEventListener('click', () => selectProject(btn.dataset.id)));
}

function selectProject(projectId) {
  const project = state.projects.find(p => p.projectId === projectId);
  if (!project) return;
  $('#selected-project-name').textContent = project.projectName;
  $('#projects-section').classList.add('d-none');
  $('#sessions-section').classList.remove('d-none');
  renderSessions(projectId);
}

function renderSessions(projectId) {
  const root = $('#session-cards'); root.setAttribute('aria-busy', 'false');
  const projectSessions = state.sessions.filter(s => s.projectId === projectId);
  if (!projectSessions.length) { root.innerHTML = '<p class="text-muted">ขณะนี้ยังไม่มีรุ่นอบรมในโครงการนี้</p>'; return; }
  root.innerHTML = projectSessions.map(session => {
    const isClosed = !session.allowPublicRegistration || session.status !== 'OPEN';
    const capacityFull = Number(session.capacity) > 0 && Number(session.count) >= Number(session.capacity);
    const full = isClosed || capacityFull;
    const seats = Number(session.capacity) === 0 ? 'ไม่จำกัดจำนวน' : `${Math.max(0, Number(session.capacity) - Number(session.count))} ที่นั่งคงเหลือ`;
    const statusLabel = isClosed ? 'ปิดรับสมัคร' : (capacityFull ? 'เต็มแล้ว' : 'เปิดรับสมัคร');
    const dispDate = session.displayDate || (session.startDate ? `${session.startDate}${session.endDate ? ` ถึง ${session.endDate}` : ''}` : '');
    return `<div class="col-md-4"><article class="session-card"><p class="eyebrow">${statusLabel}</p><h3>${escapeHtml(session.sessionLabel)}</h3><p>${escapeHtml(dispDate)}</p><p class="count-line">${session.count} / ${session.capacity || '∞'} คน</p><p class="seats">${full ? (isClosed ? 'ปิดรับสมัคร' : 'เต็มแล้ว') : seats}</p><button class="btn ${full ? 'btn-outline-secondary' : 'btn-primary'} choose-session" data-id="${escapeHtml(session.sessionId)}" ${full ? 'disabled' : ''}>${full ? (isClosed ? 'ปิด' : 'เต็มแล้ว') : 'ลงทะเบียน'}</button></article></div>`;
  }).join('');
  $$('.choose-session').forEach(button => button.addEventListener('click', () => openForm(button.dataset.id)));
}

function isCurrentProjectTempleRequired() {
  const projectId = state.selectedBatch?.projectId;
  const project = (state.projects || []).find(p => String(p.projectId) === String(projectId));
  if (!project) return true;
  return project.requireTemple !== false && String(project.requireTemple).toUpperCase() !== 'FALSE';
}

function updateTempleRequirementUI() {
  const isRequired = isCurrentProjectTempleRequired();
  const nameInput = $('#temple-name');
  const badge = $('#temple-required-badge');
  const reqAsterisk = $('#temple-name-required');
  const subReq = $('#subdistrict-required');
  const distReq = $('#district-required');
  const provReq = $('#province-required');
  const subInput = $('#subdistrict');
  const distInput = $('#district');
  const provInput = $('#province');
  const sourceText = $('#temple-source');

  if (!isRequired) {
    if (badge) badge.classList.remove('d-none');
    if (reqAsterisk) reqAsterisk.classList.add('d-none');
    if (subReq) subReq.classList.add('d-none');
    if (distReq) distReq.classList.add('d-none');
    if (provReq) provReq.classList.add('d-none');

    if (nameInput) {
      nameInput.removeAttribute('required');
      nameInput.setAttribute('placeholder', 'หากไม่กรอกข้อมูลจะลงทะเบียนในนามธุดงคสถานสุราษฎร์ธานี');
    }
    if (subInput) subInput.removeAttribute('required');
    if (distInput) distInput.removeAttribute('required');
    if (provInput) provInput.removeAttribute('required');

    if (sourceText && !state.templeId) {
      sourceText.innerHTML = '💡 <em>หากไม่กรอกข้อมูลวัด ระบบจะลงทะเบียนในนาม "ธุดงคสถานสุราษฎร์ธานี" ให้อัตโนมัติ</em>';
    }
  } else {
    if (badge) badge.classList.add('d-none');
    if (reqAsterisk) reqAsterisk.classList.remove('d-none');
    if (subReq) subReq.classList.remove('d-none');
    if (distReq) distReq.classList.remove('d-none');
    if (provReq) provReq.classList.remove('d-none');

    if (nameInput) {
      nameInput.setAttribute('required', 'required');
      nameInput.removeAttribute('placeholder');
    }
    if (subInput) subInput.setAttribute('required', 'required');
    if (distInput) distInput.setAttribute('required', 'required');
    if (provInput) provInput.setAttribute('required', 'required');

    if (sourceText && !state.templeId) {
      sourceText.textContent = 'พิมพ์ชื่อวัดใหม่ได้ หากไม่พบในฐานข้อมูล';
    }
  }
}

function openForm(sessionId) {
  const session = state.sessions.find(item => String(item.sessionId) === String(sessionId)); if (!session) return;
  state.selectedBatch = session; $('#session-id').value = session.sessionId; $('#registration-section').classList.remove('d-none'); $('#summary-section').classList.add('d-none'); $('#success-section').classList.add('d-none');
  updateTempleRequirementUI();
  const draft = readDraft();
  if (draft?.sessionId === sessionId && !$('#participants').children.length) fillDraft(draft); else if (!$('#participants').children.length) addParticipant();
  $('#registration-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fillDraft(draft) {
  const temple = draft.temple || {}; state.templeId = temple.templeId || ''; $('#temple-name').value = temple.templeName || ''; $('#subdistrict').value = temple.subdistrict || ''; $('#district').value = temple.district || ''; $('#province').value = temple.province || '';
  (draft.participants?.length ? draft.participants : [{}]).forEach(person => addParticipant(person)); updateTempleSource();
}

const CORE_FIELD_KEYS = new Set([
  'prefix', 'otherPrefix', 'monasticName', 'firstName', 'lastName',
  'mobile', 'nationalId', 'birthDate', 'birthDateDisplay', 'age',
  'ordinationDate', 'ordinationDateDisplay', 'phansa', 'personId', 'useExistingMobile'
]);

function initPersonLookup(card) {
  const input = $('.person-search-input', card);
  const suggestionsBox = $('.person-suggestions', card);
  const matchBadge = $('.person-match-badge', card);
  const matchedName = $('.matched-person-name', card);
  const matchedMeta = $('.matched-person-meta', card);
  const clearBtn = $('.btn-clear-match', card);

  const existingMobileWrap = $('.existing-mobile-wrap', card);
  const existingMobileLabel = $('.existing-mobile-label', card);
  const inputMobileWrap = $('.input-mobile-wrap', card);
  const revertMobileWrap = $('.revert-mobile-wrap', card);
  const btnChangeMobile = $('.btn-change-mobile', card);
  const btnUseExistingMobile = $('.btn-use-existing-mobile', card);

  const existingNidWrap = $('.existing-nid-wrap', card);
  const existingNidLabel = $('.existing-nid-label', card);

  const personIdInput = $('.person-id', card);
  const useExistingMobileInput = $('.use-existing-mobile', card);

  if (!input) return;

  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      suggestionsBox.classList.add('d-none');
      suggestionsBox.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await api(`person-lookup?q=${encodeURIComponent(q)}`);
        const items = res.items || [];
        if (!items.length) {
          suggestionsBox.innerHTML = '<div class="p-2 small text-muted">ไม่พบบุคคลเดิมในระบบ — สามารถกรอกข้อมูลด้านล่างเป็นบุคคลใหม่ได้เลย</div>';
          suggestionsBox.classList.remove('d-none');
          return;
        }

        suggestionsBox.innerHTML = items.map(p => {
          const safeName = `${p.prefix} ${p.monasticName ? p.monasticName + ' ' : ''}${p.firstName} ${p.lastName}`.trim();
          const metaBadges = [];
          if (p.mobileMasked) metaBadges.push(`📱 ${p.mobileMasked}`);
          if (p.nationalIdMasked) metaBadges.push(`🪪 ${p.nationalIdMasked}`);
          if (p.age) metaBadges.push(`อายุ ${p.age} ปี`);
          if (p.address) metaBadges.push(p.address);

          return `
            <div class="suggestion-item p-2 border-bottom" style="cursor:pointer;" data-person="${escapeHtml(JSON.stringify(p))}">
              <div class="d-flex justify-content-between align-items-center">
                <strong>${escapeHtml(safeName)}</strong>
                <span class="badge bg-primary text-white small">ใช้ข้อมูลนี้</span>
              </div>
              <div class="small text-muted mt-1">${escapeHtml(metaBadges.join(' · '))}</div>
            </div>
          `;
        }).join('');

        suggestionsBox.classList.remove('d-none');

        $$('.suggestion-item', suggestionsBox).forEach(item => {
          item.addEventListener('pointerdown', (e) => { e.preventDefault(); });
          item.onclick = (e) => {
            e.stopPropagation();
            try {
              const person = JSON.parse(item.getAttribute('data-person'));
              selectPerson(person);
            } catch (err) {
              console.error(err);
            }
            suggestionsBox.classList.add('d-none');
            input.value = '';
          };
        });
      } catch (err) {
        console.warn('Person lookup error:', err);
      }
    }, 280);
  });

  function selectPerson(p) {
    personIdInput.value = p.personId;

    // Fill non-sensitive fields
    if (p.prefix) $('.prefix', card).value = p.prefix;
    if (p.otherPrefix) $('.other-prefix', card).value = p.otherPrefix;
    if (p.monasticName) $('.monastic-name', card).value = p.monasticName;
    if (p.firstName) $('.first-name', card).value = p.firstName;
    if (p.lastName) $('.last-name', card).value = p.lastName;
    togglePrefix(card);

    if (p.birthDateDisplay) {
      $('.birth-date', card).value = p.birthDateDisplay;
      $('.age', card).value = p.age || calculateAge(p.birthDateDisplay);
    }

    if (p.ordinationDateDisplay && $('.ordination-date', card)) {
      $('.ordination-date', card).value = p.ordinationDateDisplay;
      if ($('.phansa', card)) $('.phansa', card).value = calculatePhansa(p.ordinationDateDisplay);
    }

    // Privacy rule for Mobile
    if (p.hasMobile) {
      useExistingMobileInput.value = 'true';
      existingMobileLabel.textContent = `มีเบอร์เดิมอยู่แล้ว (${p.mobileMasked})`;
      existingMobileWrap.classList.remove('d-none');
      inputMobileWrap.classList.add('d-none');
      revertMobileWrap.classList.add('d-none');
      $('.mobile', card).value = p.mobileMasked;
      $('.mobile', card).removeAttribute('required');
    } else {
      useExistingMobileInput.value = 'false';
      existingMobileWrap.classList.add('d-none');
      inputMobileWrap.classList.remove('d-none');
      revertMobileWrap.classList.add('d-none');
      $('.mobile', card).setAttribute('required', 'required');
    }

    // Privacy rule for National ID
    if (p.hasNationalId) {
      existingNidLabel.textContent = `มีเลขบัตรเดิมในระบบแล้ว (${p.nationalIdMasked})`;
      existingNidWrap.classList.remove('d-none');
    } else {
      existingNidWrap.classList.add('d-none');
    }

    // Match badge
    matchedName.textContent = `${p.prefix} ${p.firstName} ${p.lastName}`;
    matchedMeta.textContent = p.age ? `(อายุ ${p.age} ปี)` : '';
    matchBadge.classList.remove('d-none');

    // Auto-fill address if present
    if (p.address) {
      const addrInput = card.querySelector('[data-key="address"]') || card.querySelector('.address');
      if (addrInput) addrInput.value = p.address;
    }

    // Highlight empty fields so user knows they can fill in additional info
    highlightEmptyFields(card);

    persistDraft();
  }

  function highlightEmptyFields(card) {
    clearEmptyHighlights(card);

    const candidates = [
      { el: $('.prefix', card), name: 'คำนำหน้า' },
      { el: $('.first-name', card), name: 'ชื่อ' },
      { el: $('.last-name', card), name: 'นามสกุล' },
      { el: $('.mobile', card), name: 'เบอร์มือถือ', checkHidden: () => !$('.existing-mobile-wrap', card)?.classList.contains('d-none') },
      { el: $('.national-id', card), name: 'เลขบัตรประชาชน', checkHidden: () => !$('.existing-nid-wrap', card)?.classList.contains('d-none') },
      { el: $('.birth-date', card), name: 'วันเกิด (พ.ศ.)' }
    ];

    if ($('.prefix', card)?.value === 'พระ' && $('.ordination-date', card)) {
      candidates.push({ el: $('.ordination-date', card), name: 'วันบวช' });
    }

    $$('.dyn-input, textarea', card).forEach(dyn => {
      candidates.push({ el: dyn, name: dyn.getAttribute('name') || 'ข้อมูลเพิ่มเติม' });
    });

    let emptyCount = 0;

    candidates.forEach(item => {
      const el = item.el;
      if (!el) return;
      if (item.checkHidden && item.checkHidden()) return;
      if (el.closest('.d-none')) return;
      if (el.hasAttribute('readonly') || el.hasAttribute('disabled')) return;

      const val = (el.value || '').trim();
      if (!val) {
        emptyCount++;
        el.classList.add('field-highlight-empty');

        const parent = el.closest('.col-sm-4, .col-md-4, .col-md-6, .col-12, .mb-3') || el.parentElement;
        if (parent && !parent.querySelector('.empty-field-hint')) {
          const hint = document.createElement('div');
          hint.className = 'empty-field-hint text-warning-emphasis small mt-1 d-flex align-items-center gap-1';
          hint.style.fontSize = '0.78rem';
          hint.innerHTML = '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-1 py-0">✏️ ยังไม่มีข้อมูล</span> <span>สามารถกรอกเพิ่มได้</span>';
          el.after(hint);
        }

        const cleanUp = () => {
          if ((el.value || '').trim()) {
            el.classList.remove('field-highlight-empty');
            const h = parent?.querySelector('.empty-field-hint') || el.parentElement?.querySelector('.empty-field-hint');
            if (h) h.remove();
          }
        };
        el.addEventListener('input', cleanUp, { once: false });
        el.addEventListener('change', cleanUp, { once: false });
      }
    });

    const matchBadge = $('.person-match-badge', card);
    if (matchBadge) {
      let notice = matchBadge.querySelector('.empty-fields-summary-badge');
      if (emptyCount > 0) {
        if (!notice) {
          notice = document.createElement('span');
          notice.className = 'badge bg-warning text-dark border border-warning shadow-sm empty-fields-summary-badge ms-md-2 mt-1 mt-md-0';
          notice.innerHTML = '📝 มีบางช่องยังไม่มีข้อมูล (กรอบสีส้ม) สามารถกรอกเพิ่มได้';
          matchBadge.querySelector('div:first-child')?.appendChild(notice);
        }
      } else if (notice) {
        notice.remove();
      }
    }
  }

  function clearEmptyHighlights(card) {
    $$('.field-highlight-empty', card).forEach(el => el.classList.remove('field-highlight-empty'));
    $$('.empty-field-hint', card).forEach(el => el.remove());
    const notice = card.querySelector('.empty-fields-summary-badge');
    if (notice) notice.remove();
  }

  // Change Mobile button
  btnChangeMobile.onclick = () => {
    useExistingMobileInput.value = 'false';
    existingMobileWrap.classList.add('d-none');
    inputMobileWrap.classList.remove('d-none');
    revertMobileWrap.classList.remove('d-none');
    const mobInput = $('.mobile', card);
    const mobFeedback = $('.mobile-feedback', card);
    mobInput.value = '';
    mobInput.classList.remove('is-valid', 'is-invalid');
    if (mobFeedback) { mobFeedback.className = 'mobile-feedback small mt-1 d-none'; mobFeedback.textContent = ''; }
    mobInput.setAttribute('required', 'required');
    mobInput.focus();
    persistDraft();
  };

  // Revert to Existing Mobile button
  btnUseExistingMobile.onclick = () => {
    useExistingMobileInput.value = 'true';
    existingMobileWrap.classList.remove('d-none');
    inputMobileWrap.classList.add('d-none');
    revertMobileWrap.classList.add('d-none');
    const mobInput = $('.mobile', card);
    const mobFeedback = $('.mobile-feedback', card);
    mobInput.value = existingMobileLabel.textContent;
    mobInput.classList.remove('is-valid', 'is-invalid');
    if (mobFeedback) { mobFeedback.className = 'mobile-feedback small mt-1 d-none'; mobFeedback.textContent = ''; }
    mobInput.removeAttribute('required');
    persistDraft();
  };

  // Clear match button
  clearBtn.onclick = () => {
    clearEmptyHighlights(card);
    personIdInput.value = '';
    useExistingMobileInput.value = 'false';
    matchBadge.classList.add('d-none');
    existingMobileWrap.classList.add('d-none');
    inputMobileWrap.classList.remove('d-none');
    revertMobileWrap.classList.add('d-none');
    existingNidWrap.classList.add('d-none');
    const mobInput = $('.mobile', card);
    const mobFeedback = $('.mobile-feedback', card);
    const nidInput = $('.national-id', card);
    const nidFeedback = $('.national-id-feedback', card);
    mobInput.value = '';
    mobInput.classList.remove('is-valid', 'is-invalid');
    if (mobFeedback) { mobFeedback.className = 'mobile-feedback small mt-1 d-none'; mobFeedback.textContent = ''; }
    if (nidInput) {
      nidInput.value = '';
      nidInput.classList.remove('is-valid', 'is-invalid');
      if (nidFeedback) { nidFeedback.className = 'national-id-feedback small mt-1 d-none'; nidFeedback.textContent = ''; }
    }
    mobInput.setAttribute('required', 'required');
    const addrInput = card.querySelector('[data-key="address"]') || card.querySelector('.address');
    if (addrInput) addrInput.value = '';
    persistDraft();
  };

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add('d-none');
    }
  });
}

function addParticipant(data = {}) {
  // Always render the core participant form from template
  const fragment = $('#participant-template').content.cloneNode(true);
  const card = $('.participant-card', fragment);

  // Initialize Person Lookup autocomplete and privacy handlers
  initPersonLookup(card);

  // Set initial values for core fields
  if (data.personId) $('.person-id', card).value = data.personId;
  if (data.useExistingMobile) {
    $('.use-existing-mobile', card).value = 'true';
    $('.existing-mobile-wrap', card)?.classList.remove('d-none');
    $('.input-mobile-wrap', card)?.classList.add('d-none');
    $('.mobile', card)?.removeAttribute('required');
  }

  $('.prefix', card).value = data.prefix || '';
  $('.other-prefix', card).value = data.otherPrefix || '';
  $('.monastic-name', card).value = data.monasticName || '';
  $('.first-name', card).value = data.firstName || '';
  $('.last-name', card).value = data.lastName || '';
  $('.mobile', card).value = data.mobile || '';
  $('.national-id', card).value = data.nationalId || '';
  
  // birthDate stored as ISO → display as พ.ศ.
  const bdVal = data.birthDate ? (data.birthDate.includes('/') ? data.birthDate : toThaiBuddhistDate(data.birthDate)) : '';
  $('.birth-date', card).value = bdVal;
  $('.age', card).value = calculateAge(bdVal);
  
  // ordinationDate
  const odVal = data.ordinationDate ? (data.ordinationDate.includes('/') ? data.ordinationDate : toThaiBuddhistDate(data.ordinationDate)) : '';
  if ($('.ordination-date', card)) $('.ordination-date', card).value = odVal;
  if ($('.phansa', card)) $('.phansa', card).value = calculatePhansa(odVal);

  // Events
  $('.prefix', card).addEventListener('change', () => { togglePrefix(card); persistDraft(); });

  // Birth date: auto-format + calculate age
  $('.birth-date', card).addEventListener('input', () => {
    autoFormatThaiDate($('.birth-date', card));
    $('.age', card).value = calculateAge($('.birth-date', card).value);
    persistDraft();
  });

  // Ordination date: auto-format + calculate phansa
  $('.ordination-date', card)?.addEventListener('input', () => {
    autoFormatThaiDate($('.ordination-date', card));
    if ($('.phansa', card)) $('.phansa', card).value = calculatePhansa($('.ordination-date', card).value);
    persistDraft();
  });

  // Mobile live inline validation
  const mobInput = $('.mobile', card);
  const mobFeedback = $('.mobile-feedback', card);
  if (mobInput) {
    mobInput.addEventListener('input', () => {
      validateThaiMobileLive(mobInput, mobFeedback);
      persistDraft();
    });
    mobInput.addEventListener('blur', () => {
      validateThaiMobileLive(mobInput, mobFeedback);
    });
    if (mobInput.value && !data.useExistingMobile) {
      validateThaiMobileLive(mobInput, mobFeedback);
    }
  }

  // National ID live inline validation
  const nidInput = $('.national-id', card);
  const nidFeedback = $('.national-id-feedback', card);
  if (nidInput) {
    nidInput.addEventListener('input', () => {
      validateThaiNationalIdLive(nidInput, nidFeedback);
      persistDraft();
    });
    nidInput.addEventListener('blur', () => {
      validateThaiNationalIdLive(nidInput, nidFeedback);
    });
    if (nidInput.value) {
      validateThaiNationalIdLive(nidInput, nidFeedback);
    }
  }

  $$('.form-control,.form-select', card).forEach(input => input.addEventListener('change', persistDraft));
  $('.remove-participant', card).addEventListener('click', () => {
    if ($$('.participant-card').length === 1) return alertUser('ต้องมีผู้เข้าร่วมอย่างน้อย 1 คน', 'warning');
    card.remove(); renumberParticipants(); persistDraft();
  });

  // Append any custom project FormFields configured in Admin
  const customFields = (state.formFields || []).filter(f => 
    f.projectId === state.selectedBatch?.projectId && 
    String(f.visible).toUpperCase() !== 'FALSE' && 
    !CORE_FIELD_KEYS.has(f.fieldKey)
  ).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  if (customFields.length > 0) {
    const customWrap = document.createElement('div');
    customWrap.className = 'custom-fields-wrap mt-3 pt-3 border-top';
    const cardIdx = Date.now() + Math.random().toString(36).slice(2, 6);
    let customHtml = `<h6 class="text-secondary small fw-bold mb-2">📋 ข้อมูลเพิ่มเติมที่ต้องกรอก</h6><div class="row g-3">`;
    
    customFields.forEach(f => {
      const isRequired = String(f.required).toUpperCase() === 'TRUE';
      const reqAttr = isRequired ? 'required' : '';
      const reqMark = isRequired ? ' <span class="text-danger">*</span>' : '';
      const val = escapeHtml(data[f.fieldKey] || '');

      customHtml += `<div class="col-sm-6"><label class="form-label">${escapeHtml(f.label)}${reqMark}</label>`;

      if (f.fieldType === 'select') {
        const opts = (f.optionsJson || '').split(',').map(s => s.trim()).filter(Boolean);
        customHtml += `<select class="form-select dyn-input" data-key="${escapeHtml(f.fieldKey)}" ${reqAttr}><option value="">-- เลือกข้อมูล --</option>${opts.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
      } else if (f.fieldType === 'radio') {
        const opts = (f.optionsJson || '').split(',').map(s => s.trim()).filter(Boolean);
        const radioName = `dyn_radio_${escapeHtml(f.fieldKey)}_${cardIdx}`;
        customHtml += `<div class="dyn-radio-group pt-1" data-key="${escapeHtml(f.fieldKey)}">` + opts.map(o => {
          const checked = val === o ? 'checked' : '';
          return `<div class="form-check form-check-inline"><input class="form-check-input dyn-radio" type="radio" name="${radioName}" value="${escapeHtml(o)}" ${checked}><label class="form-check-label">${escapeHtml(o)}</label></div>`;
        }).join('') + `</div>`;
      } else if (f.fieldType === 'checkbox') {
        const opts = (f.optionsJson || '').split(',').map(s => s.trim()).filter(Boolean);
        customHtml += `<div class="dyn-checkbox-group pt-1" data-key="${escapeHtml(f.fieldKey)}">` + opts.map(o => {
          const checked = (Array.isArray(data[f.fieldKey]) ? data[f.fieldKey] : String(data[f.fieldKey]||'').split(',')).includes(o) ? 'checked' : '';
          return `<div class="form-check form-check-inline"><input class="form-check-input dyn-check" type="checkbox" value="${escapeHtml(o)}" ${checked}><label class="form-check-label">${escapeHtml(o)}</label></div>`;
        }).join('') + `</div>`;
      } else if (f.fieldType === 'textarea') {
        customHtml += `<textarea class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" placeholder="${escapeHtml(f.placeholder || '')}" ${reqAttr} rows="2">${val}</textarea>`;
      } else if (f.fieldType === 'phone') {
        customHtml += `<input type="tel" maxlength="10" class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" value="${val}" placeholder="${escapeHtml(f.placeholder || 'เบอร์โทรศัพท์ 10 หลัก')}" ${reqAttr}>`;
      } else if (f.fieldType === 'nationalId') {
        customHtml += `<input type="text" maxlength="13" class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" value="${val}" placeholder="${escapeHtml(f.placeholder || 'เลขบัตรประชาชน 13 หลัก')}" ${reqAttr}>`;
      } else if (f.fieldType === 'email') {
        customHtml += `<input type="email" class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" value="${val}" placeholder="${escapeHtml(f.placeholder || 'อีเมล')}" ${reqAttr}>`;
      } else if (f.fieldType === 'number') {
        customHtml += `<input type="number" class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" value="${val}" placeholder="${escapeHtml(f.placeholder || '')}" ${reqAttr}>`;
      } else if (f.fieldType === 'date') {
        customHtml += `<input type="date" class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" value="${val}" ${reqAttr}>`;
      } else {
        customHtml += `<input type="text" class="form-control dyn-input" data-key="${escapeHtml(f.fieldKey)}" value="${val}" placeholder="${escapeHtml(f.placeholder || '')}" ${reqAttr}>`;
      }
      customHtml += `</div>`;
    });
    customHtml += `</div>`;
    customWrap.innerHTML = customHtml;
    card.appendChild(customWrap);

    $$('.dyn-input, .dyn-check, .dyn-radio', card).forEach(input => input.addEventListener('input', persistDraft));
    $$('.dyn-input, .dyn-check, .dyn-radio', card).forEach(input => input.addEventListener('change', persistDraft));
  }

  card.dataset.dynamic = 'false';
  $('#participants').append(card);
  togglePrefix(card);
  renumberParticipants();
}
function togglePrefix(card) {
  const prefix = $('.prefix', card).value;
  const isMonk = prefix === 'พระ';
  const isOther = prefix === 'อื่น ๆ';
  $('.monastic-wrap', card).classList.toggle('d-none', !isMonk);
  $('.other-prefix-wrap', card).classList.toggle('d-none', !isOther);
  $('.ordination-date-wrap', card)?.classList.toggle('d-none', !isMonk);
  $('.phansa-wrap', card)?.classList.toggle('d-none', !isMonk);
  // Clear ordination fields if not monk
  if (!isMonk) {
    if ($('.ordination-date', card)) $('.ordination-date', card).value = '';
    if ($('.phansa', card)) $('.phansa', card).value = '';
  }
}
function renumberParticipants() {
  const cards = $$('.participant-card');
  cards.forEach((card, index) => {
    $('.participant-title', card).textContent = `ผู้เข้าร่วมคนที่ ${index + 1}`;
  });
  const nextNum = $('#next-participant-num');
  if (nextNum) nextNum.textContent = cards.length + 1;
}
function updateTempleSource() {
  const isReq = isCurrentProjectTempleRequired();
  if (state.templeId) {
    $('#temple-source').textContent = 'เลือกจากฐานข้อมูลวัด — ข้อมูลที่แก้ไขด้านล่างจะใช้กับการสมัครครั้งนี้เท่านั้น';
  } else if (!isReq && !$('#temple-name').value.trim()) {
    $('#temple-source').innerHTML = '💡 <em>หากไม่กรอกข้อมูล ระบบจะบันทึกการลงทะเบียนในนาม "ธุดงคสถานสุราษฎร์ธานี" ให้อัตโนมัติ</em>';
  } else {
    $('#temple-source').textContent = isReq ? 'วัดใหม่ / ข้อมูลที่ผู้ใช้กรอก' : 'พิมพ์ชื่อวัดใหม่ได้ หากไม่พบในฐานข้อมูล';
  }
}

function searchTemples() {
  const term = normalize($('#temple-name').value); const box = $('#temple-suggestions');
  if (term.length < 1) { box.classList.add('d-none'); return; }
  const results = state.temples.filter(t => normalize(`${t.templeName} ${t.subdistrict} ${t.district} ${t.province}`).includes(term)).slice(0, 8);
  if (!results.length) { box.classList.add('d-none'); state.templeId = ''; updateTempleSource(); return; }
  box.innerHTML = results.map(t => `<button type="button" class="suggestion" data-id="${escapeHtml(t.templeId)}" role="option"><strong>${escapeHtml(t.templeName)}</strong><small>ต.${escapeHtml(t.subdistrict)} อ.${escapeHtml(t.district)} จ.${escapeHtml(t.province)}</small></button>`).join(''); box.classList.remove('d-none');
  $$('.suggestion', box).forEach(button => {
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); });
    button.addEventListener('click', () => selectTemple(button.dataset.id));
  });
}
function selectTemple(id) { const temple = state.temples.find(t => String(t.templeId) === String(id)); if (!temple) return; state.templeId = temple.templeId; $('#temple-name').value = temple.templeName; $('#subdistrict').value = temple.subdistrict; $('#district').value = temple.district; $('#province').value = temple.province; $('#temple-suggestions').classList.add('d-none'); updateTempleSource(); persistDraft(); }

function gatherPayload() {
  const isReq = isCurrentProjectTempleRequired();
  let templeName = $('#temple-name').value.trim();
  let subdistrict = $('#subdistrict').value.trim();
  let district = $('#district').value.trim();
  let province = $('#province').value.trim();

  if (!isReq && !templeName) {
    templeName = 'ธุดงคสถานสุราษฎร์ธานี';
    subdistrict = subdistrict || '-';
    district = district || 'เมืองสุราษฎร์ธานี';
    province = province || 'สุราษฎร์ธานี';
  }

  const temple = { 
    templeId: state.templeId || '', 
    templeName, 
    subdistrict, 
    district, 
    province 
  };
  const participants = $$('.participant-card').map(card => {
    // Core fields: convert Thai date (พ.ศ.) to ISO (ค.ศ.) for backend
    const bdThaiStr = $('.birth-date', card)?.value || '';
    const odThaiStr = $('.ordination-date', card)?.value || '';
    const useExistingMob = $('.use-existing-mobile', card)?.value === 'true';
    const personId = $('.person-id', card)?.value || '';
    const p = {
      personId,
      useExistingMobile: useExistingMob,
      prefix: $('.prefix', card)?.value || '',
      otherPrefix: $('.other-prefix', card)?.value.trim() || '',
      monasticName: $('.monastic-name', card)?.value.trim() || '',
      firstName: $('.first-name', card)?.value.trim() || '',
      lastName: $('.last-name', card)?.value.trim() || '',
      mobile: useExistingMob ? 'USE_EXISTING' : ($('.mobile', card)?.value.trim() || ''),
      nationalId: $('.national-id', card)?.value.trim() || '',
      birthDate: parseThaiBuddhistDate(bdThaiStr) || bdThaiStr,
      birthDateDisplay: bdThaiStr,
      ordinationDate: parseThaiBuddhistDate(odThaiStr) || odThaiStr,
      ordinationDateDisplay: odThaiStr,
    };

    // Gather custom dynamic inputs
    $$('.dyn-input', card).forEach(el => {
      p[el.dataset.key] = el.value.trim();
    });
    $$('.dyn-radio-group', card).forEach(grp => {
      const checkedRadio = grp.querySelector('.dyn-radio:checked');
      p[grp.dataset.key] = checkedRadio ? checkedRadio.value : '';
    });
    $$('.dyn-checkbox-group', card).forEach(grp => {
      const checked = $$('.dyn-check:checked', grp).map(cb => cb.value);
      p[grp.dataset.key] = checked;
    });

    return p;
  });
  return { sessionId: $('#session-id').value, temple, participants };
}

function validatePayload(payload) {
  const isReq = isCurrentProjectTempleRequired();
  if (!payload.sessionId) return 'กรุณาเลือกรุ่นการอบรม';
  if (isReq) {
    if (!payload.temple.templeName || !payload.temple.subdistrict || !payload.temple.district || !payload.temple.province) {
      return 'กรุณากรอกข้อมูลวัด ตำบล อำเภอ และจังหวัดให้ครบ';
    }
  } else if (payload.temple.templeName && payload.temple.templeName !== 'ธุดงคสถานสุราษฎร์ธานี') {
    if (!payload.temple.subdistrict || !payload.temple.district || !payload.temple.province) {
      return 'กรุณากรอกตำบล อำเภอ และจังหวัดของวัดให้ครบ';
    }
  }
  
  const customFields = (state.formFields || []).filter(f => 
    f.projectId === state.selectedBatch?.projectId && 
    String(f.visible).toUpperCase() !== 'FALSE' && 
    !CORE_FIELD_KEYS.has(f.fieldKey)
  );
  
  for (const [i, p] of payload.participants.entries()) { 
    // Validate core fields
    if (!p.prefix || !p.firstName || !p.lastName) {
      return `กรุณากรอกคำนำหน้า ชื่อ และนามสกุล ผู้เข้าร่วมคนที่ ${i + 1} ให้ครบถ้วน`;
    }
    if (!p.useExistingMobile) {
      if (!p.mobile || p.mobile.length !== 10) {
        return `กรุณากรอกเบอร์มือถือผู้เข้าร่วมคนที่ ${i + 1} ให้ครบ 10 หลัก (ขณะนี้ ${p.mobile ? p.mobile.length : 0} หลัก)`;
      }
      if (!p.mobile.startsWith('0')) {
        return `เบอร์มือถือผู้เข้าร่วมคนที่ ${i + 1} ต้องขึ้นต้นด้วย 0`;
      }
    }
    if (p.nationalId && p.nationalId.length > 0 && p.nationalId.length !== 13) {
      return `เลขบัตรประชาชนของผู้เข้าร่วมคนที่ ${i + 1} ต้องมี 13 หลัก (ขณะนี้ ${p.nationalId.length} หลัก)`;
    }
    if (p.prefix === 'อื่น ๆ' && !p.otherPrefix) {
      return `กรุณาระบุคำนำหน้าของผู้เข้าร่วมคนที่ ${i + 1}`; 
    }

    // Validate custom fields
    for (const f of customFields) {
      const val = p[f.fieldKey];
      if (String(f.required).toUpperCase() === 'TRUE' && (!val || (Array.isArray(val) && val.length === 0))) {
        return `กรุณากรอกข้อมูล "${f.label}" สำหรับคนที่ ${i + 1}`;
      }
      if (f.fieldType === 'number' && val && isNaN(Number(val))) {
        return `กรุณากรอกข้อมูล "${f.label}" เป็นตัวเลข สำหรับคนที่ ${i + 1}`;
      }
      if (f.fieldType === 'phone' && val && !/^\d{10}$/.test(val)) {
        return `เบอร์โทรศัพท์ "${f.label}" สำหรับคนที่ ${i + 1} ต้องมี 10 หลัก`;
      }
      if (f.fieldType === 'nationalId' && val && !/^\d{13}$/.test(val)) {
        return `เลขบัตรประชาชน "${f.label}" สำหรับคนที่ ${i + 1} ต้องมี 13 หลัก`;
      }
      if (f.fieldType === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        return `อีเมล "${f.label}" สำหรับคนที่ ${i + 1} ไม่ถูกต้อง`;
      }
    }
  }
  return '';
}

function showSummary(payload) {
  const session = state.selectedBatch; 
  const pList = payload.participants.map(p => {
    const nameStr = `${p.prefix === 'อื่น ๆ' ? p.otherPrefix : p.prefix} ${p.firstName} ${p.lastName}${p.monasticName ? ` (${p.monasticName})` : ''}`;
    const mobStr = p.useExistingMobile ? 'ใช้เบอร์เดิมในระบบ' : p.mobile;
    return `<li><strong>${escapeHtml(nameStr)}</strong> <small class="text-muted">(เบอร์โทร: ${escapeHtml(mobStr)})</small></li>`;
  }).join('');

  const templeDisplay = payload.temple.templeName === 'ธุดงคสถานสุราษฎร์ธานี'
    ? `<strong>สังกัด / ในนาม</strong><br>${escapeHtml(payload.temple.templeName)}<br><span class="text-muted">ต.${escapeHtml(payload.temple.subdistrict)} อ.${escapeHtml(payload.temple.district)} จ.${escapeHtml(payload.temple.province)}</span>`
    : `<strong>สถานที่ / วัด</strong><br>${escapeHtml(payload.temple.templeName)}<br><span class="text-muted">ต.${escapeHtml(payload.temple.subdistrict)} อ.${escapeHtml(payload.temple.district)} จ.${escapeHtml(payload.temple.province)}</span>`;

  $('#summary-content').innerHTML = `<div class="row g-3"><div class="col-md-6"><div class="metric"><strong>รุ่นอบรม</strong><br>${escapeHtml(session.sessionLabel)}<br><span class="text-muted">${escapeHtml(session.displayDate)}</span></div></div><div class="col-md-6"><div class="metric">${templeDisplay}</div></div></div><h3 class="h5 mt-4">ผู้เข้าร่วม ${payload.participants.length} คน</h3><ol class="summary-list">${pList}</ol>`; 
  $('#summary-section').classList.remove('d-none'); $('#registration-section').classList.add('d-none'); $('#summary-section').scrollIntoView({ behavior: 'smooth', block: 'start' }); 
}

async function submitRegistration() {
  const button = $('#confirm-registration'); button.disabled = true; button.textContent = 'กำลังบันทึก...';
  try { 
    const result = await api('registration', { method: 'POST', body: JSON.stringify(gatherPayload()) }); 
    state.submitted = result; clearDraft(); 
    $('#summary-section').classList.add('d-none'); 
    
    const isDynamic = $$('.participant-card')[0]?.dataset.dynamic === 'true';
    const pList = result.participants.map(p => {
      if (isDynamic) {
        const keys = Object.keys(p).filter(k => !['_rowNumber','personId','createdAt','updatedAt','firstName','lastName','prefix','otherPrefix','monasticName','mobile','nationalId','birthDate','age'].includes(k) && p[k]).slice(0, 2);
        return `<li>${keys.map(k => escapeHtml(p[k])).join(' ')}</li>`;
      }
      return `<li>${escapeHtml(`${p.prefix || ''} ${p.firstName || ''} ${p.lastName || ''}`)}</li>`;
    }).join('');

    $('#success-section').innerHTML = `<div class="success-icon">✓</div><h2>ลงทะเบียนสำเร็จ</h2><p class="lead">เลขลงทะเบียน: <strong>${escapeHtml(result.registrationGroupId)}</strong></p><p>${escapeHtml(result.session.sessionLabel)} · ${escapeHtml(result.session.displayDate)}<br>จำนวน ${result.participants.length} คน</p><ol class="summary-list text-start mx-auto" style="max-width:420px">${pList}</ol><div class="d-grid gap-2 d-sm-flex justify-content-center mt-4"><button class="btn btn-outline-secondary" onclick="window.print()">พิมพ์ข้อมูล</button><button id="back-home" class="btn btn-primary">กลับหน้าหลัก</button></div>`; 
    $('#success-section').classList.remove('d-none'); $('#success-section').scrollIntoView({ behavior: 'smooth' }); 
    $('#back-home').onclick = () => { location.href = 'index.html#register'; }; 
    await loadConfig(); 
  } catch (error) { 
    alertUser(error.message); 
  } finally { 
    button.disabled = false; button.textContent = 'ยืนยันการลงทะเบียน'; 
  }
}

async function loadPublicList(page = 1, projectId = null) {
  const projSelect = $('#public-project-filter');
  const activeProjId = projectId !== null ? projectId : (projSelect ? projSelect.value : '');
  const term = $('#public-search').value.trim();
  $('#public-results').innerHTML = '<div class="p-3 text-muted">กำลังโหลดรายชื่อ...</div>';
  
  try {
    const qParams = new URLSearchParams({ page, q: term });
    if (activeProjId) qParams.set('projectId', activeProjId);

    const data = await api(`public-list?${qParams.toString()}`);
    state.publicPage = data.page;

    // Update project filter options if returned
    if (projSelect && data.projects && projSelect.children.length <= 1) {
      const cur = activeProjId || data.selectedProjectId || '';
      const opts = [{ projectId: '', projectName: 'ทุกโครงการที่เปิดแสดง' }, ...data.projects];
      projSelect.innerHTML = opts.map(p => `<option value="${escapeHtml(p.projectId)}" ${p.projectId === cur ? 'selected' : ''}>${escapeHtml(p.projectName)}</option>`).join('');
    }

    $('#public-results').innerHTML = data.items.length ? data.items.map((item, i) => `
      <article class="public-row">
        <span class="text-muted me-2">${(data.page - 1) * data.pageSize + i + 1}.</span>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="small text-muted">${escapeHtml(item.templeName)} · ${escapeHtml(item.sessionLabel)}${item.projectName ? ` (${escapeHtml(item.projectName)})` : ''}</div>
      </article>
    `).join('') : '<div class="p-3 text-muted">ไม่พบรายชื่อในโครงการที่เลือก</div>';

    $('#public-pagination').innerHTML = data.totalPages > 1 ? `
      <ul class="pagination justify-content-center mt-3">
        <li class="page-item ${data.page === 1 ? 'disabled' : ''}"><button class="page-link" data-page="${data.page - 1}">ก่อนหน้า</button></li>
        <li class="page-item disabled"><span class="page-link">หน้า ${data.page} / ${data.totalPages}</span></li>
        <li class="page-item ${data.page === data.totalPages ? 'disabled' : ''}"><button class="page-link" data-page="${data.page + 1}">ถัดไป</button></li>
      </ul>` : '';

    $$('#public-pagination [data-page]').forEach(button => button.onclick = () => loadPublicList(Number(button.dataset.page), projSelect?.value || ''));
  } catch (error) {
    $('#public-results').innerHTML = `<div class="p-3 text-danger">${escapeHtml(error.message)}</div>`;
  }
}

async function loadConfig() { 
  try { 
    const data = await api('config'); 
    state.projects = data.projects || [];
    state.sessions = data.sessions || []; 
    state.formFields = data.formFields || [];
    state.temples = data.temples || []; 
    
    renderProjects();
    
    // Check if there is only 1 project, auto-select it for convenience
    if (state.projects.length === 1) {
      selectProject(state.projects[0].projectId);
      $('#back-to-projects').classList.add('d-none'); // Hide back button if there's no choice
    } else {
      $('#back-to-projects').classList.remove('d-none');
    }
  } catch (error) { 
    $('#project-cards').innerHTML = `<div class="col-12"><div class="alert alert-danger">${escapeHtml(error.message)}</div></div>`; 
  } 
}

document.addEventListener('DOMContentLoaded', () => {
  $('#refresh-projects').onclick = loadConfig; 
  $('#back-to-projects').onclick = () => {
    $('#sessions-section').classList.add('d-none');
    $('#projects-section').classList.remove('d-none');
  };
  const handleAddParticipant = () => {
    addParticipant();
    const cards = $$('.participant-card');
    const lastCard = cards[cards.length - 1];
    if (lastCard) {
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const input = $('.person-search-input', lastCard);
      if (input) setTimeout(() => input.focus(), 300);
    }
  };
  if ($('#add-participant')) $('#add-participant').onclick = handleAddParticipant;
  if ($('#add-participant-bottom')) $('#add-participant-bottom').onclick = handleAddParticipant; 
  $('#temple-name').addEventListener('input', () => { state.templeId = ''; searchTemples(); updateTempleSource(); persistDraft(); }); 
  ['#subdistrict','#district','#province'].forEach(id => $(id).addEventListener('input', persistDraft));
  $('#registration-form').addEventListener('submit', event => { event.preventDefault(); const payload = gatherPayload(); const error = validatePayload(payload); if (error) return alertUser(error, 'warning'); showSummary(payload); }); 
  $('#summary-back').onclick = () => { $('#summary-section').classList.add('d-none'); $('#registration-section').classList.remove('d-none'); }; 
  $('#confirm-registration').onclick = submitRegistration;
  $('#public-search-button').onclick = () => loadPublicList(1); 
  $('#public-search').addEventListener('keydown', event => { if (event.key === 'Enter') loadPublicList(1); }); 
  const pubProj = $('#public-project-filter');
  if (pubProj) pubProj.onchange = () => loadPublicList(1, pubProj.value);
  document.addEventListener('click', event => { if (!event.target.closest('#temple-name') && !event.target.closest('#temple-suggestions')) $('#temple-suggestions').classList.add('d-none'); }); 
  loadConfig(); 
  loadPublicList();
});
