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

// Ngày (YYYY-MM-DD) đã có lịch chia sẵn trong CSDL — dùng để quyết định nút
// "+ Thêm 1 dòng" nên thêm dòng trống bình thường (chưa chia lần nào) hay mở
// modal "thêm bệnh nhân mới" (đã chia rồi, không được xếp lại người cũ).
let scheduleExistsForDate = null;
let lastGenerateResult = null; // kết quả gần nhất của ngày đang chọn ở tab Chia thủ thuật — dùng để gợi ý khung giờ/giờ bắt đầu cho modal thêm bệnh nhân

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
  // Nạp cấu hình (gồm danh sách combo THẬT từ CSDL) TRƯỚC khi thêm dòng đầu
  // tiên — nếu không, dòng đầu tiên sẽ chỉ có mỗi lựa chọn "Tự động" (chưa
  // có currentConfig.combos để render ô chọn combo).
  await loadConfigAndRenderSettings();
  ensureAtLeastOneRow();
  await checkScheduleExists($('#input-date').value);
}

/** Kiểm tra ngày đang chọn ở tab "Chia thủ thuật" đã có lịch trong CSDL chưa
 * — quyết định hành vi nút "+ Thêm 1 dòng" (thêm dòng trống bình thường hay
 * mở modal "thêm bệnh nhân mới" để không xếp lại người đã có). */
async function checkScheduleExists(date) {
  if (!date) { scheduleExistsForDate = null; lastGenerateResult = null; return; }
  try {
    const result = await api('/api/ctt-schedule?date=' + encodeURIComponent(date));
    if (result.patients && result.patients.length > 0) {
      scheduleExistsForDate = date;
      lastGenerateResult = result;
      // Hiển thị lại đúng số suất đã dành riêng lần chia gần nhất của ngày
      // này — tránh việc để trống ô nhập rồi vô tình "chia lại" mất đi số
      // suất đã dành ra trước đó.
      const sc = result.summary && result.summary.shiftCapacity;
      if (sc && sc[0]) $('#input-reserved-morning').value = sc[0].reservedSlots || 0;
      if (sc && sc[1]) $('#input-reserved-afternoon').value = sc[1].reservedSlots || 0;
    } else {
      scheduleExistsForDate = null;
      lastGenerateResult = null;
    }
  } catch (e) {
    scheduleExistsForDate = null;
    lastGenerateResult = null;
  }
}

$('#input-date').addEventListener('change', () => { checkScheduleExists($('#input-date').value); });

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
  // Lấy ĐÚNG danh sách combo đang thật sự cấu hình trong CSDL (currentConfig.combos,
  // do api/ctt-config.js trả về) thay vì ghi cứng tên/mô tả ở đây — nếu không,
  // khi CSDL còn dữ liệu combo CŨ (VD chưa chạy migration sửa combo), ô chọn
  // vẫn hiển thị mô tả MỚI (đúng) trong khi hệ thống thực ra đang ép theo
  // định nghĩa CŨ — gây hiểu nhầm "chọn combo bị chia sai".
  const combos = (currentConfig?.combos || []).slice().sort((a, b) => a.priority - b.priority);
  const options = [['', 'Tự động (khuyên dùng)']].concat(combos.map((c) => [c.code, c.name]));
  return options.map(([v, label]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function addPatientRow(stt = '', name = '', combo = '', priorityDischarge = false) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="number" min="1" class="p-stt" value="${escapeHtml(stt)}"></td>
    <td><input type="text" class="p-name" value="${escapeHtml(name)}" placeholder="Họ và tên"></td>
    <td><select class="p-combo">${comboSelectHtml(combo)}</select></td>
    <td style="text-align:center;"><input type="checkbox" class="p-priority" ${priorityDischarge ? 'checked' : ''} title="Ưu tiên xếp vào khung giờ sớm nhất trong ngày để làm hồ sơ ra viện"></td>
    <td><span class="del-row" title="Xoá dòng">✕</span></td>
  `;
  tr.querySelector('.del-row').addEventListener('click', () => tr.remove());
  $('#patients-tbody').appendChild(tr);
}

function ensureAtLeastOneRow() {
  if ($('#patients-tbody').children.length === 0) addPatientRow();
}

$('#btn-add-row').addEventListener('click', () => {
  // Nếu ngày đang chọn ĐÃ có lịch chia sẵn -> không được xếp lại người cũ,
  // chỉ mở modal xếp thêm cho đúng 1 người mới (theo yêu cầu CEO). Nếu chưa
  // chia lần nào (đang nhập danh sách ban đầu) -> vẫn thêm dòng trống như cũ.
  const date = $('#input-date').value;
  if (scheduleExistsForDate && scheduleExistsForDate === date) {
    openAddPatientModal();
  } else {
    addPatientRow();
  }
});
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
    priorityDischarge: tr.querySelector('.p-priority').checked,
  })).filter((p) => p.name && p.stt);
}

$('#btn-generate').addEventListener('click', async () => {
  showError('#generate-error', '');
  const date = $('#input-date').value;
  const patients = collectPatients();
  if (!date) { showError('#generate-error', 'Chọn ngày.'); return; }
  if (patients.length === 0) { showError('#generate-error', 'Nhập ít nhất 1 bệnh nhân hợp lệ (có STT và Họ tên).'); return; }
  const reservedSlots = {
    morning: Math.max(0, Math.floor(Number($('#input-reserved-morning').value) || 0)),
    afternoon: Math.max(0, Math.floor(Number($('#input-reserved-afternoon').value) || 0)),
  };
  const btn = $('#btn-generate');
  btn.disabled = true;
  $('#generate-status').textContent = 'Đang chia thủ thuật cho ' + patients.length + ' bệnh nhân...';
  try {
    const result = await api('/api/ctt-generate', { method: 'POST', body: JSON.stringify({ date, patients, reservedSlots }) });
    lastResult = result;
    lastGenerateResult = result;
    scheduleExistsForDate = date;
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
    if ($('#input-date').value === date) { lastGenerateResult = result; scheduleExistsForDate = date; }
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
  const cls = code === 'C1' ? 'pill-c1' : (code === 'C2' ? 'pill-c2' : 'pill-c3');
  return `<span class="pill ${cls}">${code}</span>`;
}

/** Sắp xếp bệnh nhân theo GIỜ XẾP SỚM NHẤT trong ngày (không phải theo STT).
 * Cần thiết vì bệnh nhân "giữ chỗ" BNM được gán STT giả rất lớn (90001,
 * 95001...) để không trùng STT thật — nếu sắp theo STT, các dòng BNM luôn
 * hiện ở CUỐI bảng dù giờ giấc thực tế của họ thường sớm nhất trong buổi
 * (do được ưu tiên xếp trước bệnh nhân ngoại trú), dễ khiến hiểu NHẦM là hệ
 * thống xếp họ vào giờ muộn nhất. Bệnh nhân chưa xếp được thủ thuật nào
 * (thiếu bước) luôn xuống cuối bảng — hợp lý vì cần chú ý xử lý riêng. */
function sortPatientsBySchedule(patients, entries) {
  const earliestByPatient = new Map();
  for (const e of entries) {
    const cur = earliestByPatient.get(e.patientId);
    if (cur == null || e.start < cur) earliestByPatient.set(e.patientId, e.start);
  }
  return patients.slice().sort((a, b) => {
    const ta = earliestByPatient.has(a.id) ? earliestByPatient.get(a.id) : Infinity;
    const tb = earliestByPatient.has(b.id) ? earliestByPatient.get(b.id) : Infinity;
    return ta !== tb ? ta - tb : a.stt - b.stt;
  });
}

function renderResults(containerSel, result) {
  const entries = (result.scheduleEntries || []).slice().sort((a, b) => a.start - b.start);
  const patients = sortPatientsBySchedule(result.patients || [], entries);
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

    if (summary.shiftCapacity) {
      html += `<div class="panel"><h3>Sức chứa còn lại trong ngày (ước tính thực tế theo nhân sự/máy hiện có)</h3><table><thead><tr><th>Buổi</th><th>Khung giờ</th><th>Số suất đã dành riêng</th><th>Còn nhận thêm được (ước tính)</th></tr></thead><tbody>
        ${summary.shiftCapacity.map((sc, i) => `<tr><td>${i === 0 ? 'Sáng' : 'Chiều'}</td><td>${sc.startLabel}-${sc.endLabel}</td><td>${sc.reservedSlots || 0}</td><td><b>${sc.remainingFit}${sc.remainingAtLeast ? '+' : ''}</b> bệnh nhân</td></tr>`).join('')}
      </tbody></table></div>`;
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
    // Bệnh nhân "giữ chỗ" (BNM buổi sáng/chiều — suất để dành cho người mới
    // nhập viện thêm sau) hiển thị mờ + có nhãn riêng để phân biệt rõ với
    // bệnh nhân thật, tránh CEO tưởng nhầm là danh sách bị dư người.
    const rowStyle = p.is_placeholder ? ' style="opacity:.65;font-style:italic;"' : '';
    const placeholderBadge = p.is_placeholder ? ' <span class="badge-role" title="Suất để dành cho bệnh nhân mới nhập viện thêm sau — dùng nút &quot;+ Thêm 1 dòng&quot; để thay bằng người thật">giữ chỗ</span>' : '';
    byPatientHtml += `<tr${rowStyle}><td>${p.stt}</td><td>${escapeHtml(p.name)}${placeholderBadge}</td><td>${comboPillHtml(combo)}</td><td>${detail || '<span class="muted">Chưa xếp được thủ thuật nào</span>'}</td></tr>`;
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
  const patients = sortPatientsBySchedule(result.patients || [], entries);

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
// MODAL: THÊM 1 BỆNH NHÂN MỚI VÀO LỊCH ĐÃ CHIA SẴN (không xếp lại người cũ)
// ---------------------------------------------------------------------------
function suggestedStartForShift(shiftIndex) {
  if (!lastGenerateResult) return null;
  const sc = (lastGenerateResult.summary?.shiftCapacity || [])[shiftIndex];
  if (!sc) return null;
  // Gợi ý: bắt đầu ngay sau lượt cuối cùng đang bận trong buổi đó (đảm bảo
  // vẫn cách quãng chuyển giao), người dùng có thể tự sửa lại giờ này.
  const entries = (lastGenerateResult.scheduleEntries || []).filter((e) => e.start >= sc.start && e.start < sc.end);
  const maxEnd = entries.reduce((mx, e) => Math.max(mx, e.end), sc.start);
  return Math.min(maxEnd + 1, sc.end - 1);
}

function fillAddModalShiftInfo() {
  const shiftIndex = $('#add-shift').value === 'morning' ? 0 : 1;
  const sc = (lastGenerateResult?.summary?.shiftCapacity || [])[shiftIndex];
  $('#add-shift-window').textContent = sc
    ? `Khung giờ của buổi: ${sc.startLabel}-${sc.endLabel} · đã dành riêng ${sc.reservedSlots || 0} suất · ước tính còn nhận thêm được ${sc.remainingFit}${sc.remainingAtLeast ? '+' : ''} người.`
    : '';
  const suggested = suggestedStartForShift(shiftIndex);
  $('#add-start').value = suggested != null ? hhmm(suggested) : '';
}

function openAddPatientModal() {
  if (!lastGenerateResult) {
    alert('Chưa có lịch nào được chia cho ngày này — bấm "⚙ Chia thủ thuật" trước, sau đó mới dùng nút này để thêm bệnh nhân mới nhập viện.');
    return;
  }
  $('#modal-add-error').style.display = 'none';
  $('#modal-add-warning').style.display = 'none';
  $('#add-shift').value = 'morning';
  $('#add-stt').value = '';
  $('#add-name').value = '';
  $('#add-combo').innerHTML = comboSelectHtml('');
  fillAddModalShiftInfo();
  $('#add-patient-modal').style.display = 'flex';
}

$('#add-shift').addEventListener('change', fillAddModalShiftInfo);
$('#btn-modal-cancel').addEventListener('click', () => { $('#add-patient-modal').style.display = 'none'; });

$('#btn-modal-submit').addEventListener('click', async () => {
  const errEl = $('#modal-add-error');
  const warnEl = $('#modal-add-warning');
  errEl.style.display = 'none';
  warnEl.style.display = 'none';
  const date = $('#input-date').value;
  const stt = $('#add-stt').value;
  const name = $('#add-name').value.trim();
  const shift = $('#add-shift').value;
  const desiredStart = $('#add-start').value.trim();
  const comboOverride = $('#add-combo').value || null;
  if (!stt || !name || !desiredStart) {
    errEl.textContent = 'Nhập đủ STT, Họ tên và giờ bắt đầu.';
    errEl.style.display = 'block';
    return;
  }
  const btn = $('#btn-modal-submit');
  btn.disabled = true;
  try {
    const result = await api('/api/ctt-generate', { method: 'POST', body: JSON.stringify({ action: 'add_patient', date, stt, name, shift, desiredStart, comboOverride }) });
    if (!result.ok) {
      warnEl.innerHTML = escapeHtml(result.message || 'Không thêm được — quá tải.') + (result.suggestedMessage ? '<br>' + escapeHtml(result.suggestedMessage) : '');
      warnEl.style.display = 'block';
      if (result.suggestedCombo) $('#add-combo').value = result.suggestedCombo;
      return;
    }
    $('#add-patient-modal').style.display = 'none';
    // Tải lại lịch cả ngày để hiển thị đầy đủ (gồm cả người vừa thêm) —
    // những người đã có trước đó không bị đụng tới ở phía server, chỉ là
    // hiển thị lại cho đủ.
    const refreshed = await api('/api/ctt-schedule?date=' + encodeURIComponent(date));
    lastResult = refreshed;
    lastGenerateResult = refreshed;
    renderResults('#results-wrap', refreshed);
    alert(`Đã thêm bệnh nhân "${name}" (STT ${stt}) vào lịch — combo ${result.usedCombo || '(tự động)'}.`);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
checkSession();
