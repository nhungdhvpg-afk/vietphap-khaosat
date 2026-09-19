/* Chia thủ thuật YHCT — Việt Pháp. Toàn bộ logic UI trong 1 file, theo cùng
   phong cách với app.js của module khảo sát (Supabase Auth + gọi API qua
   Vercel Functions, không gọi thẳng Supabase từ trình duyệt). */

const cfg = window.APP_CONFIG || {};
const supa = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

let currentConfig = null; // { staff, machines, procedures, combos, settings, fixedMonitor }
let lastResult = null;    // kết quả chia thủ thuật gần nhất (để xuất Excel/in)

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hhmm(mins) { if (mins == null) return '-'; const h = Math.floor(mins / 60), m = Math.round(mins % 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
function todayStr() { const d = new Date(); return d.toISOString().slice(0, 10); }

async function authHeader() {
  if (!supa) return {};
  const { data } = await supa.auth.getSession();
  const token = data && data.session ? data.session.access_token : null;
  return token ? { Authorization: 'Bearer ' + token } : {};
}

async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, await authHeader(), options.headers || {});
  const res = await fetch(path, Object.assign({}, options, { headers }));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Lỗi không xác định (' + res.status + ')');
  return body;
}

// ---------------------------------------------------------------------------
// ĐĂNG NHẬP
// ---------------------------------------------------------------------------
function showError(elId, message) {
  const el = $(elId);
  if (!message) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = message;
  el.style.display = 'block';
}

async function enterApp() {
  $('#view-login').style.display = 'none';
  $('#view-main').style.display = 'block';
  $('#btn-logout').style.display = 'inline-flex';
  $('#input-date').value = todayStr();
  $('#reload-date').value = todayStr();
  ensureAtLeastOneRow();
  await loadConfigAndRenderSettings();
}

async function checkSession() {
  if (!supa) { showError('#login-error', 'Chưa cấu hình Supabase (public/config.js).'); return; }
  const { data } = await supa.auth.getSession();
  if (data && data.session) await enterApp();
}

$('#login-submit').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  showError('#login-error', '');
  if (!email || !password) { showError('#login-error', 'Nhập email và mật khẩu.'); return; }
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) { showError('#login-error', 'Sai email hoặc mật khẩu.'); return; }
  await enterApp();
});

$('#btn-logout').addEventListener('click', async () => {
  await supa.auth.signOut();
  location.reload();
});

// ---------------------------------------------------------------------------
// TABS
// ---------------------------------------------------------------------------
$all('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $all('.tabs button').forEach((b) => b.classList.remove('active'));
    $all('.tabview').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// NHẬP DANH SÁCH BỆNH NHÂN
// ---------------------------------------------------------------------------
function comboSelectHtml(selected) {
  const options = [['', 'Tự động (khuyên dùng)'], ['C1', 'C1 — Điện châm + Xông'], ['C2', 'C2 — Điện châm + Cứu ngải'], ['C2B', 'C2B — Hào châm + Cứu ngải'], ['C3', 'C3 — Hào châm + Xông']];
  return options.map(([v, label]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function addPatientRow(stt = '', name = '', combo = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="number" min="1" class="p-stt" value="${escapeHtml(stt)}"></td>
    <td><input type="text" class="p-name" value="${escapeHtml(name)}" placeholder="Họ và tên"></td>
    <td><select class="p-combo">${comboSelectHtml(combo)}</select></td>
    <td><span class="del-row" title="Xoá dòng">✕</span></td>
  `;
  tr.querySelector('.del-row').addEventListener('click', () => tr.remove());
  $('#patients-tbody').appendChild(tr);
}

function ensureAtLeastOneRow() {
  if ($('#patients-tbody').children.length === 0) addPatientRow();
}

$('#btn-add-row').addEventListener('click', () => addPatientRow());
$('#btn-clear-rows').addEventListener('click', () => { $('#patients-tbody').innerHTML = ''; ensureAtLeastOneRow(); });

$('#btn-paste-apply').addEventListener('click', () => {
  const text = $('#paste-area').value;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0;
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s*[.,\t-]?\s*(.+)$/);
    if (!m) continue;
    addPatientRow(m[1], m[2].trim());
    added++;
  }
  if (added > 0) {
    // xoá dòng trống đầu tiên nếu có
    const rows = $all('#patients-tbody tr');
    if (rows.length > added) {
      const first = rows[0];
      if (!first.querySelector('.p-stt').value && !first.querySelector('.p-name').value) first.remove();
    }
    $('#paste-area').value = '';
  }
});

function collectPatients() {
  return $all('#patients-tbody tr').map((tr) => ({
    stt: Number(tr.querySelector('.p-stt').value),
    name: tr.querySelector('.p-name').value.trim(),
    comboOverride: tr.querySelector('.p-combo').value || null,
  })).filter((p) => p.name && p.stt);
}

$('#btn-generate').addEventListener('click', async () => {
  showError('#generate-error', '');
  const date = $('#input-date').value;
  const patients = collectPatients();
  if (!date) { showError('#generate-error', 'Chọn ngày.'); return; }
  if (patients.length === 0) { showError('#generate-error', 'Nhập ít nhất 1 bệnh nhân hợp lệ (có STT và Họ tên).'); return; }
  const btn = $('#btn-generate');
  btn.disabled = true;
  $('#generate-status').textContent = 'Đang chia thủ thuật cho ' + patients.length + ' bệnh nhân...';
  try {
    const result = await api('/api/ctt-generate', { method: 'POST', body: JSON.stringify({ date, patients }) });
    lastResult = result;
    renderResults('#results-wrap', result);
    $('#generate-status').textContent = 'Xong lúc ' + new Date().toLocaleTimeString('vi-VN');
  } catch (e) {
    showError('#generate-error', e.message);
    $('#generate-status').textContent = '';
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// XEM LẠI THEO NGÀY
// ---------------------------------------------------------------------------
$('#btn-reload').addEventListener('click', async () => {
  showError('#reload-error', '');
  const date = $('#reload-date').value;
  if (!date) { showError('#reload-error', 'Chọn ngày.'); return; }
  try {
    const result = await api('/api/ctt-schedule?date=' + encodeURIComponent(date));
    if (!result.patients || result.patients.length === 0) {
      $('#reload-results-wrap').innerHTML = '<p class="muted">Chưa có dữ liệu cho ngày này.</p>';
      return;
    }
    lastResult = result;
    renderResults('#reload-results-wrap', result);
  } catch (e) {
    showError('#reload-error', e.message);
  }
});

// ---------------------------------------------------------------------------
// HIỂN THỊ KẾT QUẢ (dùng chung cho tab Chia & tab Xem lại)
// ---------------------------------------------------------------------------
function patientNameOf(result, patientId) {
  const p = (result.patients || []).find((x) => x.id === patientId);
  return p ? p.name : '?';
}
function procNameOf(entry) {
  return entry.procedureName || ({ XBBH: 'Xoa bóp bấm huyệt', DC: 'Điện châm', HC: 'Hào châm', TC: 'Thủy châm', XH: 'Xông hơi', CN: 'Cứu ngải', GH: 'Giác hơi', KH: 'Khám/Chỉ định' }[entry.procedureCode] || entry.procedureCode);
}
function staffNameOf(a) {
  if (a.staffName) return a.staffName;
  const s = (currentConfig?.staff || []).find((x) => x.id === a.staffId);
  return s ? s.name : '?';
}
function comboPillHtml(code) {
  if (!code) return '';
  const cls = code === 'C1' ? 'pill-c1' : (code === 'C2' ? 'pill-c2' : (code === 'C2B' ? 'pill-c2b' : 'pill-c3'));
  return `<span class="pill ${cls}">${code}</span>`;
}

function renderResults(containerSel, result) {
  const entries = (result.scheduleEntries || []).slice().sort((a, b) => a.start - b.start);
  const patients = (result.patients || []).slice().sort((a, b) => a.stt - b.stt);
  const summary = result.summary;

  let html = '';

  if (summary) {
    html += `<div class="panel"><h3>Tổng quan</h3><div class="kpi-grid">
      <div class="kpi"><div class="v">${summary.totalPatients}</div><div class="l">Tổng bệnh nhân</div></div>
      <div class="kpi"><div class="v">${summary.completedPatients}</div><div class="l">Hoàn thành đủ phác đồ</div></div>
      <div class="kpi"><div class="v">${summary.incompletePatients}</div><div class="l">Thiếu bước (hết giờ/chỗ)</div></div>
      ${Object.entries(summary.comboCount || {}).map(([code, n]) => `<div class="kpi"><div class="v">${n}</div><div class="l">Combo ${code}</div></div>`).join('')}
    </div></div>`;

    html += `<div class="panel"><h3>Hiệu suất máy</h3><table><thead><tr><th>Máy</th><th>Loại</th><th>Phút đã dùng</th><th>Hiệu suất</th></tr></thead><tbody>
      ${summary.machineUtilization.map((m) => `<tr><td>${escapeHtml(m.name)}</td><td>${m.type === 'XONG' ? 'Xông' : 'Châm'}</td><td>${m.usedMinutes}</td><td>${m.utilizationPct}%</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  if ((result.warnings || []).length > 0) {
    html += `<div class="panel"><h3>⚠ Bệnh nhân chưa xếp đủ phác đồ</h3><table><thead><tr><th>STT</th><th>Họ tên</th><th>Thiếu bước</th></tr></thead><tbody>
      ${result.warnings.map((w) => `<tr><td>${w.stt}</td><td>${escapeHtml(w.patientName)}</td><td><span class="pill pill-warn">${w.missingSteps.join(', ')}</span></td></tr>`).join('')}
    </tbody></table></div>`;
  }

  // ---- Theo bệnh nhân ----
  let byPatientHtml = '<div class="panel"><h3>Theo bệnh nhân</h3><table><thead><tr><th style="width:50px;">STT</th><th>Họ tên</th><th>Combo</th><th>Chi tiết thủ thuật</th></tr></thead><tbody>';
  for (const p of patients) {
    const myEntries = entries.filter((e) => e.patientId === p.id);
    const combo = myEntries.find((e) => e.comboCode)?.comboCode;
    const detail = myEntries.map((e) => `${hhmm(e.start)}-${hhmm(e.end)} <b>${procNameOf(e)}</b>${e.machineName ? ' (' + escapeHtml(e.machineName) + ')' : ''} — ${e.staffAssignments.map((a) => `${escapeHtml(staffNameOf(a))}${a.roleType === 'monitor' ? ' (trông)' : ''}`).join(', ')}`).join('<br>');
    byPatientHtml += `<tr><td>${p.stt}</td><td>${escapeHtml(p.name)}</td><td>${comboPillHtml(combo)}</td><td>${detail || '<span class="muted">Chưa xếp được thủ thuật nào</span>'}</td></tr>`;
  }
  byPatientHtml += '</tbody></table></div>';

  // ---- Theo nhân viên ----
  const staffMap = new Map();
  for (const e of entries) {
    for (const a of e.staffAssignments) {
      const key = a.staffId;
      if (!staffMap.has(key)) staffMap.set(key, []);
      staffMap.get(key).push({ ...a, procedureCode: e.procedureCode, procName: procNameOf(e), patientId: e.patientId, machineName: e.machineName });
    }
  }
  let byStaffHtml = '<div class="panel"><h3>Theo nhân viên</h3>';
  const staffEntries = Array.from(staffMap.entries()).sort((a, b) => staffNameOf({ staffId: a[0] }).localeCompare(staffNameOf({ staffId: b[0] })));
  for (const [staffId, list] of staffEntries) {
    list.sort((a, b) => a.start - b.start);
    const name = staffNameOf(list[0]);
    byStaffHtml += `<div class="staff-block"><div class="hd"><span>${escapeHtml(name)}</span><span class="muted">${list.length} lượt</span></div><table><tbody>`;
    for (const a of list) {
      byStaffHtml += `<tr><td style="width:110px;">${hhmm(a.start)}-${hhmm(a.end)}</td><td>${a.procName}${a.machineName ? ' · ' + escapeHtml(a.machineName) : ''}</td><td style="width:150px;">BN: ${escapeHtml(patientNameOf(result, a.patientId))}</td><td style="width:80px;"><span class="badge-role">${a.roleType === 'performer' ? 'Thực hiện' : 'Theo dõi'}</span></td></tr>`;
    }
    byStaffHtml += '</tbody></table></div>';
  }
  byStaffHtml += '</div>';

  // ---- Theo máy ----
  const machineMap = new Map();
  for (const e of entries) {
    if (!e.machineId) continue;
    if (!machineMap.has(e.machineId)) machineMap.set(e.machineId, []);
    machineMap.get(e.machineId).push(e);
  }
  let byMachineHtml = '<div class="panel"><h3>Theo máy</h3>';
  for (const [machineId, list] of machineMap.entries()) {
    list.sort((a, b) => a.start - b.start);
    const name = list[0].machineName || (currentConfig?.machines || []).find((m) => m.id === machineId)?.name || machineId;
    byMachineHtml += `<div class="staff-block"><div class="hd"><span>${escapeHtml(name)}</span><span class="muted">${list.length} lượt</span></div><table><tbody>`;
    for (const e of list) {
      byMachineHtml += `<tr><td style="width:110px;">${hhmm(e.start)}-${hhmm(e.end)}</td><td>${procNameOf(e)}</td><td>BN: ${escapeHtml(patientNameOf(result, e.patientId))}</td></tr>`;
    }
    byMachineHtml += '</tbody></table></div>';
  }
  byMachineHtml += '</div>';

  html += `<div class="tabs no-print" data-sub="1">
      <button class="sub-tab active" data-sub-tab="benhnhan">Theo bệnh nhân</button>
      <button class="sub-tab" data-sub-tab="nhanvien">Theo nhân viên</button>
      <button class="sub-tab" data-sub-tab="may">Theo máy</button>
    </div>
    <div class="toolbar no-print">
      <button class="btn btn-gold btn-sm" id="btn-export-excel">⬇ Xuất Excel</button>
      <button class="btn btn-sm" id="btn-print">🖨 In / Xuất PDF</button>
    </div>
    <div class="subview" data-sub-view="benhnhan">${byPatientHtml}</div>
    <div class="subview" data-sub-view="nhanvien" style="display:none;">${byStaffHtml}</div>
    <div class="subview" data-sub-view="may" style="display:none;">${byMachineHtml}</div>`;

  const container = $(containerSel);
  container.innerHTML = html;

  container.querySelectorAll('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.sub-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      container.querySelectorAll('.subview').forEach((v) => { v.style.display = v.dataset.subView === btn.dataset.subTab ? 'block' : 'none'; });
    });
  });

  const exportBtn = container.querySelector('#btn-export-excel');
  if (exportBtn) exportBtn.addEventListener('click', () => exportExcel(result));
  const printBtn = container.querySelector('#btn-print');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

// ---------------------------------------------------------------------------
// XUẤT EXCEL
// ---------------------------------------------------------------------------
function exportExcel(result) {
  const entries = (result.scheduleEntries || []).slice().sort((a, b) => a.start - b.start);
  const patients = (result.patients || []).slice().sort((a, b) => a.stt - b.stt);

  const sheetPatient = [['STT', 'Họ tên', 'Combo', 'Thủ thuật', 'Bắt đầu', 'Kết thúc', 'Máy', 'Nhân viên']];
  for (const p of patients) {
    const myEntries = entries.filter((e) => e.patientId === p.id);
    if (myEntries.length === 0) {
      sheetPatient.push([p.stt, p.name, '', 'CHƯA XẾP ĐƯỢC', '', '', '', '']);
    }
    for (const e of myEntries) {
      sheetPatient.push([p.stt, p.name, e.comboCode || '', procNameOf(e), hhmm(e.start), hhmm(e.end), e.machineName || '', e.staffAssignments.map((a) => `${staffNameOf(a)}${a.roleType === 'monitor' ? '(trông)' : ''}`).join(', ')]);
    }
  }

  const staffMap = new Map();
  for (const e of entries) for (const a of e.staffAssignments) { if (!staffMap.has(a.staffId)) staffMap.set(a.staffId, []); staffMap.get(a.staffId).push({ ...a, e }); }
  const sheetStaff = [['Nhân viên', 'Bắt đầu', 'Kết thúc', 'Thủ thuật', 'Bệnh nhân', 'Vai trò']];
  for (const [staffId, list] of staffMap.entries()) {
    list.sort((a, b) => a.start - b.start);
    for (const a of list) sheetStaff.push([staffNameOf(a), hhmm(a.start), hhmm(a.end), procNameOf(a.e), patientNameOf(result, a.e.patientId), a.roleType === 'performer' ? 'Thực hiện' : 'Theo dõi']);
  }

  const machineMap = new Map();
  for (const e of entries) { if (!e.machineId) continue; if (!machineMap.has(e.machineId)) machineMap.set(e.machineId, []); machineMap.get(e.machineId).push(e); }
  const sheetMachine = [['Máy', 'Bắt đầu', 'Kết thúc', 'Thủ thuật', 'Bệnh nhân']];
  for (const [machineId, list] of machineMap.entries()) {
    list.sort((a, b) => a.start - b.start);
    const name = list[0].machineName || machineId;
    for (const e of list) sheetMachine.push([name, hhmm(e.start), hhmm(e.end), procNameOf(e), patientNameOf(result, e.patientId)]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetPatient), 'Theo benh nhan');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetStaff), 'Theo nhan vien');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetMachine), 'Theo may');
  XLSX.writeFile(wb, `chia-thu-thuat-${result.date || todayStr()}.xlsx`);
}

// ---------------------------------------------------------------------------
// CÀI ĐẶT
// ---------------------------------------------------------------------------
async function loadConfigAndRenderSettings() {
  try {
    currentConfig = await api('/api/ctt-config');
    renderSettings();
  } catch (e) {
    console.error(e);
  }
}

function renderSettings() {
  const c = currentConfig;
  const settingsMap = Object.fromEntries((c.settings || []).map((s) => [s.key, s.value]));
  $('#set-shift1-start').value = settingsMap.shift1_start || '';
  $('#set-shift1-end').value = settingsMap.shift1_end || '';
  $('#set-shift2-start').value = settingsMap.shift2_start || '';
  $('#set-shift2-end').value = settingsMap.shift2_end || '';
  $('#set-buffer').value = settingsMap.transfer_buffer_minutes || 2;
  const optMode = settingsMap.optimization_mode === 'max_patients' ? 'max_patients' : 'max_xong';
  $('#opt-mode-xong').checked = optMode === 'max_xong';
  $('#opt-mode-patients').checked = optMode === 'max_patients';

  // Nhân sự
  $('#staff-tbody').innerHTML = (c.staff || []).map((s) => `
    <tr data-id="${s.id}">
      <td>${escapeHtml(s.name)}${s.note ? `<br><span class="muted">${escapeHtml(s.note)}</span>` : ''}</td>
      <td><span class="badge-role">${s.role}</span></td>
      <td><input type="checkbox" class="toggle-staff-active" ${s.active ? 'checked' : ''}></td>
      <td></td>
    </tr>`).join('');
  $all('.toggle-staff-active').forEach((chk) => {
    chk.addEventListener('change', async (ev) => {
      const tr = ev.target.closest('tr');
      const s = c.staff.find((x) => x.id === tr.dataset.id);
      await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'upsert_staff', payload: { id: s.id, name: s.name, role: s.role, qualification: s.qualification, note: s.note, active: ev.target.checked } }) });
      await loadConfigAndRenderSettings();
    });
  });

  // Máy móc
  $('#machine-tbody').innerHTML = (c.machines || []).map((m) => `
    <tr data-id="${m.id}">
      <td>${escapeHtml(m.name)}</td>
      <td>${m.type === 'XONG' ? 'Xông' : 'Châm'}</td>
      <td><input type="checkbox" class="toggle-machine-active" ${m.active ? 'checked' : ''}></td>
      <td></td>
    </tr>`).join('');
  $all('.toggle-machine-active').forEach((chk) => {
    chk.addEventListener('change', async (ev) => {
      const tr = ev.target.closest('tr');
      const m = c.machines.find((x) => x.id === tr.dataset.id);
      await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'upsert_machine', payload: { id: m.id, name: m.name, type: m.type, active: ev.target.checked } }) });
      await loadConfigAndRenderSettings();
    });
  });

  // Sức chứa theo dõi (chỉ hiện thủ thuật có can_split)
  const splitProcs = (c.procedures || []).filter((p) => p.can_split);
  $('#proc-tbody').innerHTML = splitProcs.map((p) => `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.name)}</td>
      <td><input type="number" min="1" class="proc-capacity" value="${p.monitor_max_patients}" style="width:90px;"></td>
      <td><button class="btn btn-sm save-proc">Lưu</button></td>
    </tr>`).join('');
  $all('.save-proc').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      const tr = ev.target.closest('tr');
      const cap = Number(tr.querySelector('.proc-capacity').value);
      await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'update_procedure', payload: { id: tr.dataset.id, monitor_max_patients: cap } }) });
      await loadConfigAndRenderSettings();
    });
  });

  // Người trông cố định (DC, TC là các thủ thuật chia đôi cần theo dõi)
  const fixedByProc = Object.fromEntries((c.fixedMonitor || []).map((f) => [f.procedure_type_id, f.staff_id]));
  const ddStaff = (c.staff || []).filter((s) => s.role === 'DD' && s.active);
  $('#fixed-monitor-rows').innerHTML = splitProcs.map((p) => {
    const options = ['<option value="">— Không cố định —</option>'].concat(ddStaff.map((s) => `<option value="${s.id}" ${fixedByProc[p.id] === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`));
    return `<div class="row" data-proc-id="${p.id}" style="align-items:center;">
      <div style="flex:0 0 140px;"><b>${escapeHtml(p.name)}</b></div>
      <div><select class="fixed-monitor-select">${options.join('')}</select></div>
    </div>`;
  }).join('');
  $all('.fixed-monitor-select').forEach((sel) => {
    sel.addEventListener('change', async (ev) => {
      const procId = ev.target.closest('[data-proc-id]').dataset.procId;
      await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'set_fixed_monitor', payload: { procedureTypeId: procId, staffId: ev.target.value || null } }) });
      await loadConfigAndRenderSettings();
    });
  });
}

$('#btn-save-settings').addEventListener('click', async () => {
  const payload = {
    shift1_start: $('#set-shift1-start').value,
    shift1_end: $('#set-shift1-end').value,
    shift2_start: $('#set-shift2-start').value,
    shift2_end: $('#set-shift2-end').value,
    transfer_buffer_minutes: $('#set-buffer').value,
  };
  await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'update_settings', payload }) });
  await loadConfigAndRenderSettings();
});

$('#btn-save-opt-mode').addEventListener('click', async () => {
  const optimization_mode = $('#opt-mode-patients').checked ? 'max_patients' : 'max_xong';
  await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'update_settings', payload: { optimization_mode } }) });
  await loadConfigAndRenderSettings();
});

$('#btn-add-staff').addEventListener('click', async () => {
  const name = $('#new-staff-name').value.trim();
  const role = $('#new-staff-role').value;
  if (!name) return;
  await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'upsert_staff', payload: { name, role, active: true } }) });
  $('#new-staff-name').value = '';
  await loadConfigAndRenderSettings();
});

$('#btn-add-machine').addEventListener('click', async () => {
  const name = $('#new-machine-name').value.trim();
  const type = $('#new-machine-type').value;
  if (!name) return;
  await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'upsert_machine', payload: { name, type, active: true } }) });
  $('#new-machine-name').value = '';
  await loadConfigAndRenderSettings();
});

// ---------------------------------------------------------------------------
checkSession();
