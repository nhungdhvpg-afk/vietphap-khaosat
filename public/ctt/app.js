/* Chia thủ thuật YHCT — Việt Pháp. Toàn bộ logic UI trong 1 file, theo cùng
   phong cách với app.js của module khảo sát (Supabase Auth + gọi API qua
   Vercel Functions, không gọi thẳng Supabase từ trình duyệt). */

const cfg = window.APP_CONFIG || {};
const supa = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

let currentConfig = null; // { staff, machines, procedures, combos, settings, fixedMonitor, me }
let lastResult = null;    // kết quả chia thủ thuật gần nhất (để xuất Excel/in)
let me = null;            // { role, ctt_manager, canManage } — quyền của tài khoản đang đăng nhập

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
/** Ẩn hẳn tab "Cài đặt" khỏi nhân viên thường (không phải CEO/quản lý CTT) —
 * và ẩn panel "Quản lý tài khoản" khỏi những người không phải CEO. Chỉ ẩn ở
 * giao diện để đỡ rối mắt/tránh nhầm lẫn; quyền THẬT được kiểm tra lại ở mọi
 * API ghi dữ liệu (api/ctt-config.js, api/ctt-accounts.js) nên không thể bỏ
 * qua bằng cách sửa HTML/JS phía trình duyệt. */
function applyPermissions() {
  const caidatBtn = document.querySelector('.tabs button[data-tab="caidat"]');
  if (caidatBtn) caidatBtn.style.display = me && me.canManage ? '' : 'none';
  const accountsPanel = $('#panel-accounts');
  if (accountsPanel) accountsPanel.style.display = me && me.role === 'ceo' ? '' : 'none';
  // Nếu đang đứng ở tab Cài đặt mà mất quyền (VD bị thu quyền ở tài khoản
  // khác) -> tự chuyển về tab Chia thủ thuật, tránh màn hình trắng.
  if (!(me && me.canManage) && $('#tab-caidat').classList.contains('active')) {
    document.querySelector('.tabs button[data-tab="chia"]').click();
  }
}

$all('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $all('.tabs button').forEach((b) => b.classList.remove('active'));
    $all('.tabview').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'caidat' && me && me.role === 'ceo') loadAccounts();
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
/** Tên máy (VD "Xông 1", "Châm 3") cho 1 lượt thủ thuật. Kết quả "Xem lại
 * theo ngày" đã gắn sẵn `e.machineName`; kết quả "Chia thủ thuật" (vừa chia
 * xong, chưa tải lại từ CSDL) chỉ có `e.machineId` nên phải tự tra cứu trong
 * currentConfig.machines — thiếu bước này thì cột máy trống trơn ngay sau
 * khi vừa bấm "Chia thủ thuật". */
function machineNameOf(e) {
  if (!e.machineId) return null;
  if (e.machineName) return e.machineName;
  const m = (currentConfig?.machines || []).find((x) => x.id === e.machineId);
  return m ? m.name : '?';
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

  if ((result.duplicateStaffNames || []).length > 0) {
    html += `<div class="panel" style="border:2px solid #d33;"><h3>⚠ Trùng tên nhân sự</h3>
      <p>Có <b>2 người khác nhau đang hoạt động</b> lại trùng tên hiển thị: <b>${result.duplicateStaffNames.map(escapeHtml).join(', ')}</b>.
      Thuật toán vẫn xếp đúng cho từng người (không xung đột thật), NHƯNG báo cáo dưới đây sẽ hiển thị như thể 1 người bị xếp trùng giờ, dễ gây hiểu nhầm là lỗi chia lịch.
      Vào <b>Cài đặt → Nhân sự</b> đổi tên phân biệt (VD thêm số/chữ lót) cho những người trùng tên này.</p>
    </div>`;
  }

  if (summary) {
    html += `<div class="panel"><h3>Tổng quan</h3><div class="kpi-grid">
      <div class="kpi"><div class="v">${summary.totalPatients}</div><div class="l">Tổng bệnh nhân</div></div>
      <div class="kpi"><div class="v">${summary.completedPatients}</div><div class="l">Hoàn thành đủ phác đồ</div></div>
      <div class="kpi"><div class="v">${summary.incompletePatients}</div><div class="l">Thiếu bước (hết giờ/chỗ)</div></div>
      ${Object.entries(summary.comboCount || {}).map(([code, n]) => `<div class="kpi"><div class="v">${n}</div><div class="l">Combo ${code}</div></div>`).join('')}
    </div></div>`;

    if (summary.procedureCount) {
      html += `<div class="panel"><h3>Số lượt từng thủ thuật</h3><div class="kpi-grid">
        ${summary.procedureCount.map((p) => `<div class="kpi"><div class="v">${p.count}</div><div class="l">${escapeHtml(p.name)}</div></div>`).join('')}
      </div></div>`;
    }

    html += `<div class="panel"><h3>Hiệu suất máy</h3><table><thead><tr><th>Máy</th><th>Loại</th><th>Phút đã dùng</th><th>Hiệu suất</th></tr></thead><tbody>
      ${summary.machineUtilization.map((m) => `<tr><td>${escapeHtml(m.name)}</td><td>${m.type === 'XONG' ? 'Xông' : 'Châm'}</td><td>${m.usedMinutes}</td><td>${m.utilizationPct}%</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  if ((result.warnings || []).length > 0) {
    html += `<div class="panel" style="border:2px solid #d33;"><h3>⚠ Bệnh nhân VƯỢT KHUNG GIỜ — cần hẹn chuyển sang ngày khác</h3><table><thead><tr><th>STT</th><th>Họ tên</th><th>Thiếu bước</th><th>Lý do</th></tr></thead><tbody>
      ${result.warnings.map((w) => `<tr><td>${w.stt}</td><td>${escapeHtml(w.patientName)}</td><td><span class="pill pill-warn">${w.missingSteps.join(', ')}</span></td><td><span class="pill pill-warn">Chuyển ngày hôm sau</span> ${escapeHtml(w.reason || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  // ---- Theo bệnh nhân ----
  let byPatientHtml = '<div class="panel"><h3>Theo bệnh nhân</h3><table><thead><tr><th style="width:50px;">STT</th><th>Họ tên</th><th>Combo</th><th>Chi tiết thủ thuật</th></tr></thead><tbody>';
  for (const p of patients) {
    const myEntries = entries.filter((e) => e.patientId === p.id);
    const combo = myEntries.find((e) => e.comboCode)?.comboCode;
    // Với thủ thuật chia đôi (DC/HC/TC), người "thực hiện" chỉ bận đúng vài
    // phút đặt kim ĐẦU khung giờ, còn người "trông" mới bận suốt phần còn lại
    // — hiển thị RÕ khung giờ THỰC TẾ của từng người (không chỉ ghi chung 1
    // khung giờ của cả lượt) để không bị hiểu nhầm là 1 người bận suốt cả
    // khung giờ hiển thị, dẫn đến tưởng nhầm là xếp trùng khi đối chiếu với
    // thủ thuật khác của chính người đó.
    const detail = myEntries.map((e) => {
      const staffList = e.staffAssignments.map((a) => {
        const sameAsEntry = a.start === e.start && a.end === e.end;
        if (sameAsEntry) return escapeHtml(staffNameOf(a));
        const roleLabel = a.roleType === 'monitor' ? 'trông' : 'thực hiện';
        return `${escapeHtml(staffNameOf(a))} (${roleLabel} ${hhmm(a.start)}-${hhmm(a.end)})`;
      }).join(', ');
      const machineName = machineNameOf(e);
      return `${hhmm(e.start)}-${hhmm(e.end)} <b>${procNameOf(e)}</b>${machineName ? ' (' + escapeHtml(machineName) + ')' : ''} — ${staffList}`;
    }).join('<br>');
    byPatientHtml += `<tr><td>${p.stt}</td><td>${escapeHtml(p.name)}</td><td>${comboPillHtml(combo)}</td><td>${detail || '<span class="muted">Chưa xếp được thủ thuật nào</span>'}</td></tr>`;
  }
  byPatientHtml += '</tbody></table></div>';

  // ---- Theo nhân viên ----
  const staffMap = new Map();
  for (const e of entries) {
    for (const a of e.staffAssignments) {
      const key = a.staffId;
      if (!staffMap.has(key)) staffMap.set(key, []);
      staffMap.get(key).push({ ...a, procedureCode: e.procedureCode, procName: procNameOf(e), patientId: e.patientId, machineName: machineNameOf(e) });
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
    const name = machineNameOf(list[0]) || machineId;
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

  const warningByPatientId = new Map((result.warnings || []).map((w) => [w.patientId, w]));
  const sheetPatient = [['STT', 'Họ tên', 'Combo', 'Thủ thuật', 'Bắt đầu', 'Kết thúc', 'Máy', 'Nhân viên']];
  for (const p of patients) {
    const myEntries = entries.filter((e) => e.patientId === p.id);
    if (myEntries.length === 0) {
      const w = warningByPatientId.get(p.id);
      sheetPatient.push([p.stt, p.name, '', 'VƯỢT KHUNG GIỜ — CHUYỂN NGÀY HÔM SAU', '', '', '', w ? `Thiếu: ${w.missingSteps.join(', ')}. ${w.reason || ''}` : '']);
    }
    for (const e of myEntries) {
      const staffCol = e.staffAssignments.map((a) => {
        const sameAsEntry = a.start === e.start && a.end === e.end;
        if (sameAsEntry) return staffNameOf(a);
        const roleLabel = a.roleType === 'monitor' ? 'trông' : 'thực hiện';
        return `${staffNameOf(a)} (${roleLabel} ${hhmm(a.start)}-${hhmm(a.end)})`;
      }).join(', ');
      sheetPatient.push([p.stt, p.name, e.comboCode || '', procNameOf(e), hhmm(e.start), hhmm(e.end), machineNameOf(e) || '', staffCol]);
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
    const name = machineNameOf(list[0]) || machineId;
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
    me = currentConfig.me || null;
    applyPermissions();
    renderSettings();
  } catch (e) {
    console.error(e);
    showError('#generate-error', 'Không tải được cấu hình hệ thống. Vui lòng tải lại trang (F5).');
  }
}

// Thứ tự hiển thị quen thuộc (T2 đầu tuần, CN cuối tuần); giá trị số khớp
// đúng quy ước Date.getDay() (0=CN...6=T7) mà server dùng để lọc work_days.
const WEEKDAY_LABELS = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' },
  { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' },
  { value: 0, label: 'CN' },
];
function workDaysCheckboxesHtml(s) {
  const restricted = Array.isArray(s.work_days) && s.work_days.length > 0;
  return WEEKDAY_LABELS.map(({ value, label }) => {
    const checked = !restricted || s.work_days.includes(value);
    return `<label style="display:inline-flex;align-items:center;gap:2px;margin-right:6px;font-weight:400;cursor:pointer;font-size:12px;">
      <input type="checkbox" class="work-day-chk" data-day="${value}" ${checked ? 'checked' : ''}>${label}
    </label>`;
  }).join('');
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
      <td>${workDaysCheckboxesHtml(s)}</td>
      <td><input type="checkbox" class="toggle-staff-active" ${s.active ? 'checked' : ''}></td>
      <td><span class="del-row del-staff" title="Xoá hẳn nhân sự này">✕</span></td>
    </tr>`).join('');
  $all('.del-staff').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      const tr = ev.target.closest('tr');
      const s = c.staff.find((x) => x.id === tr.dataset.id);
      if (!confirm(`Xoá HẲN nhân sự "${s.name}" khỏi hệ thống?\n\nKhác với việc bỏ tích "Đang chia" (chỉ tạm ngừng, giữ lại lịch sử) — xoá là VĨNH VIỄN, không thể hoàn tác. Nếu người này đang là "người trông cố định" của Điện châm/Thủy châm, phân công đó cũng bị xoá theo. Lịch sử những ngày đã chia trước đây vẫn được giữ lại (chỉ mất tên người thực hiện ở các lượt cũ).\n\nNếu chỉ tạm nghỉ phép, nên dùng cột "Đang chia" thay vì xoá.`)) return;
      showError('#generate-error', '');
      try {
        await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'delete_staff', payload: { id: s.id } }) });
        await loadConfigAndRenderSettings();
      } catch (e) {
        alert('Không xoá được: ' + e.message);
      }
    });
  });
  $all('.work-day-chk').forEach((chk) => {
    chk.addEventListener('change', async (ev) => {
      const tr = ev.target.closest('tr');
      const checkedDays = Array.from(tr.querySelectorAll('.work-day-chk')).filter((x) => x.checked).map((x) => Number(x.dataset.day));
      if (checkedDays.length === 0) {
        alert('Phải chọn ít nhất 1 ngày làm việc trong tuần.');
        ev.target.checked = true;
        return;
      }
      const s = c.staff.find((x) => x.id === tr.dataset.id);
      const work_days = checkedDays.length === 7 ? null : checkedDays; // đủ 7 ngày = làm cả tuần (lưu null cho gọn)
      await api('/api/ctt-config', { method: 'POST', body: JSON.stringify({ action: 'upsert_staff', payload: { id: s.id, name: s.name, role: s.role, qualification: s.qualification, note: s.note, active: s.active, work_days } }) });
      await loadConfigAndRenderSettings();
    });
  });
  $all('.toggle-staff-active').forEach((chk) => {
    chk.addEventListener('change', async (ev) => {
      if (!ev.target.checked && !confirm('Ngừng hoạt động nhân sự này? Họ sẽ không được xếp lịch chia thủ thuật nữa cho tới khi bật lại.')) {
        ev.target.checked = true;
        return;
      }
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
      if (!ev.target.checked && !confirm('Ngừng hoạt động máy này? Máy sẽ không được xếp bệnh nhân nữa cho tới khi bật lại.')) {
        ev.target.checked = true;
        return;
      }
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
  if (!confirm('Lưu thay đổi giờ ca? Áp dụng cho MỌI lượt chia thủ thuật kể từ bây giờ, kể cả những ngày đã lên lịch trước nhưng chưa diễn ra.')) return;
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
// QUẢN LÝ TÀI KHOẢN (chỉ CEO thấy — xem applyPermissions())
// ---------------------------------------------------------------------------
const ROLE_LABELS = { ceo: 'CEO', department_head: 'Trưởng khoa', ctt_staff: 'Nhân viên (chỉ Chia thủ thuật)' };

async function loadAccounts() {
  if (!(me && me.role === 'ceo')) return;
  try {
    const { accounts } = await api('/api/ctt-accounts');
    renderAccounts(accounts);
  } catch (e) {
    showError('#account-error', e.message);
  }
}

function renderAccounts(accounts) {
  $('#accounts-tbody').innerHTML = accounts.map((a) => `
    <tr data-id="${a.id}">
      <td>${escapeHtml(a.email)}</td>
      <td>${escapeHtml(ROLE_LABELS[a.role] || a.role)}${a.department ? `<br><span class="muted">${escapeHtml(a.department)}</span>` : ''}</td>
      <td><input type="checkbox" class="toggle-acct-manager" ${a.ctt_manager ? 'checked' : ''} ${a.role === 'ceo' ? 'disabled' : ''}></td>
      <td>${a.role === 'ceo' ? '' : '<span class="del-row del-account" title="Xoá tài khoản">✕</span>'}</td>
    </tr>`).join('');

  $all('.toggle-acct-manager').forEach((chk) => {
    chk.addEventListener('change', async (ev) => {
      const id = ev.target.closest('tr').dataset.id;
      showError('#account-error', '');
      try {
        await api('/api/ctt-accounts', { method: 'POST', body: JSON.stringify({ action: 'update_permission', payload: { id, ctt_manager: ev.target.checked } }) });
      } catch (e) {
        ev.target.checked = !ev.target.checked;
        showError('#account-error', e.message);
      }
    });
  });

  $all('.del-account').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      const tr = ev.target.closest('tr');
      const email = tr.querySelector('td').textContent;
      if (!confirm(`Xoá tài khoản "${email}"? Người này sẽ KHÔNG đăng nhập được nữa. Không thể hoàn tác.`)) return;
      showError('#account-error', '');
      try {
        await api('/api/ctt-accounts', { method: 'POST', body: JSON.stringify({ action: 'delete_account', payload: { id: tr.dataset.id } }) });
        await loadAccounts();
      } catch (e) {
        showError('#account-error', e.message);
      }
    });
  });
}

$('#new-acct-role').addEventListener('change', () => {
  $('#new-acct-dept-wrap').style.display = $('#new-acct-role').value === 'department_head' ? '' : 'none';
});

$('#btn-add-account').addEventListener('click', async () => {
  showError('#account-error', '');
  const email = $('#new-acct-email').value.trim();
  const role = $('#new-acct-role').value;
  const department = $('#new-acct-dept').value;
  const ctt_manager = $('#new-acct-manager').checked;
  if (!email) { showError('#account-error', 'Nhập email.'); return; }
  const btn = $('#btn-add-account');
  btn.disabled = true;
  try {
    const result = await api('/api/ctt-accounts', { method: 'POST', body: JSON.stringify({ action: 'create_account', payload: { email, role, department, ctt_manager } }) });
    alert(`Đã tạo tài khoản cho ${result.email}.\n\nMật khẩu tạm thời (chỉ hiện 1 lần — chép lại gửi cho nhân viên ngay):\n${result.tempPassword}\n\nNhân viên nên đăng nhập thử ngay để xác nhận, mật khẩu này KHÔNG được lưu lại ở đâu khác.`);
    $('#new-acct-email').value = '';
    $('#new-acct-manager').checked = false;
    await loadAccounts();
  } catch (e) {
    showError('#account-error', e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
checkSession();
