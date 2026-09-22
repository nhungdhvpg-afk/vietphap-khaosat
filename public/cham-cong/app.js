/* Bảng chấm công Y sĩ - Bác sĩ — Việt Pháp. Toàn bộ việc đọc 3 file HIS,
   tính bảng chấm công và phát hiện cảnh báo chạy NGAY TRONG TRÌNH DUYỆT bằng
   SheetJS (XLSX) — không có dữ liệu bệnh nhân nào được gửi lên server. Server
   (Vercel Functions) chỉ làm 1 việc: xác thực đăng nhập + phân quyền, giống
   cơ chế "me" của module Chia thủ thuật nhưng dùng role/cột riêng
   (cham_cong_staff / cham_cong_manager) để không lẫn tài khoản 2 module. */

const cfg = window.APP_CONFIG || {};
const supa = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

let me = null;              // { role, cham_cong_manager, canManage }
let lastResult = null;      // { events, warnings, month, year } của lần xử lý gần nhất (để xuất Excel)
const selectedFiles = { 1: null, 2: null, 3: null };

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pad2(n) { return String(n).padStart(2, '0'); }

// ---------------------------------------------------------------------------
// ĐĂNG NHẬP
// ---------------------------------------------------------------------------
function showError(elId, message) {
  const el = $(elId);
  if (!message) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = message;
  el.style.display = 'block';
}

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

function applyPermissions() {
  const caidatBtn = document.querySelector('.tabs button[data-tab="caidat"]');
  if (caidatBtn) caidatBtn.style.display = me && me.canManage ? '' : 'none';
  const accountsPanel = $('#panel-accounts');
  if (accountsPanel) accountsPanel.style.display = me && me.role === 'ceo' ? '' : 'none';
  if (!(me && me.canManage) && $('#tab-caidat').classList.contains('active')) {
    document.querySelector('.tabs button[data-tab="chamcong"]').click();
  }
}

async function enterApp() {
  try {
    const resp = await api('/api/cham-cong-whoami');
    me = resp.me;
  } catch (e) {
    showError('#login-error', e.message || 'Tài khoản không có quyền vào module này.');
    await supa.auth.signOut();
    return;
  }
  $('#view-login').style.display = 'none';
  $('#view-main').style.display = 'block';
  $('#btn-logout').style.display = 'inline-flex';
  applyPermissions();
  if (me.role === 'ceo') loadAccounts();
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

$all('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $all('.tabs button').forEach((b) => b.classList.remove('active'));
    $all('.tabview').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// CHUẨN HOÁ TÊN NHÂN SỰ (gộp về 1 khoá, không phân biệt hoa/thường)
// ---------------------------------------------------------------------------
function normKey(name) {
  if (!name) return null;
  return String(name).trim().replace(/\s+/g, ' ').toUpperCase();
}

function titleCase(raw) {
  return raw.split(' ').map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

function makeNameRegistry() {
  const display = new Map(); // key chuẩn hoá -> tên hiển thị đẹp nhất
  return {
    register(name) {
      if (!name) return null;
      const key = normKey(name);
      const raw = String(name).trim().replace(/\s+/g, ' ');
      const cur = display.get(key);
      if (cur == null) {
        display.set(key, raw);
      } else if (cur === cur.toUpperCase() && raw !== raw.toUpperCase()) {
        display.set(key, raw);
      }
      return key;
    },
    displayName(key) {
      const raw = display.get(key) || key;
      return raw === raw.toUpperCase() ? titleCase(raw) : raw;
    },
  };
}

// ---------------------------------------------------------------------------
// PHÂN TÍCH NGÀY GIỜ
// ---------------------------------------------------------------------------
function parseDT(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mo, yyyy, hh, mi, ss] = m;
  return new Date(Number(yyyy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss || 0));
}

function dateKeyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

const RANGE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})/;
function parseRange(s) {
  if (!s) return null;
  const m = String(s).trim().match(RANGE_RE);
  if (!m) return null;
  const [, dd, mo, yyyy, h1, m1, h2, m2] = m;
  const start = new Date(Number(yyyy), Number(mo) - 1, Number(dd), Number(h1), Number(m1));
  let end = new Date(Number(yyyy), Number(mo) - 1, Number(dd), Number(h2), Number(m2));
  if (end <= start) end = new Date(end.getTime() + 24 * 3600 * 1000);
  return { dateKey: dateKeyOf(start), start, end };
}

// ---------------------------------------------------------------------------
// ĐỌC 3 FILE (dùng chung 1 registry tên cho cả 3 để gộp đúng người)
// ---------------------------------------------------------------------------
async function readWorkbookRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}

function readFile1_ChiPhi(rows, reg) {
  const events = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const shs = row[0], hoten = row[2], tenkp = row[18], ngayYl = row[26], bacsi = row[30];
    if (!bacsi || !ngayYl) continue;
    const dt = parseDT(ngayYl);
    if (!dt) continue;
    const key = reg.register(bacsi);
    const dedupKey = `${key}|${shs}|${dt.getTime()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    events.push({
      person: key, dateKey: dateKeyOf(dt), start: dt, end: null,
      role: 'BS kê đơn/y lệnh', patient: shs, dept: tenkp,
      detail: `BN ${hoten || ''}`, source: '1-ChiPhi',
    });
  }
  return events;
}

function readFile2_CLS(rows, reg) {
  const events = [];
  for (let r = 8; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const makcb = row[1];
    if (!makcb) continue;
    const hoten = row[2], khoaCd = row[8], bsChiDinh = row[10], yeuCau = row[11];
    const bsDocKq = row[14], ngayLam = row[15], ngayLap = row[16];
    const dtLam = parseDT(ngayLam), dtLap = parseDT(ngayLap);
    if (bsChiDinh) {
      const key = reg.register(bsChiDinh);
      const dt = dtLap || dtLam;
      if (dt) events.push({ person: key, dateKey: dateKeyOf(dt), start: dt, end: null, role: 'BS chỉ định CLS', patient: makcb, dept: khoaCd, detail: `${yeuCau || ''} - BN ${hoten || ''}`, source: '2-CLS' });
    }
    if (bsDocKq) {
      const key = reg.register(bsDocKq);
      const dt = dtLam || dtLap;
      if (dt) events.push({ person: key, dateKey: dateKeyOf(dt), start: dt, end: null, role: 'BS đọc KQ CLS', patient: makcb, dept: khoaCd, detail: `${yeuCau || ''} - BN ${hoten || ''}`, source: '2-CLS' });
    }
  }
  return events;
}

function readFile3_ThuThuat(rows, reg) {
  const events = [];
  let missingPerformer = 0;
  for (let r = 7; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const makcb = row[1];
    if (!makcb) continue;
    const hoten = row[2], ppTt = row[9], ngayGio = row[11];
    const ttvChinh = row[13], ttvPhu = row[14], gayMe = row[15], giupViec = row[16];
    const parsed = parseRange(ngayGio);
    if (!parsed) continue;
    const { dateKey, start, end } = parsed;
    const performer = ttvChinh || ttvPhu;
    const assistant = ttvChinh ? ttvPhu : null;
    if (!performer) missingPerformer++;
    const detail = `${ppTt || ''} - BN ${hoten || ''}`;
    if (performer) events.push({ person: reg.register(performer), dateKey, start, end, role: 'TTV chính', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
    if (assistant) events.push({ person: reg.register(assistant), dateKey, start, end, role: 'TTV phụ', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
    if (gayMe) events.push({ person: reg.register(gayMe), dateKey, start, end, role: 'Gây mê', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
    if (giupViec) events.push({ person: reg.register(giupViec), dateKey, start, end, role: 'Giúp việc', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
  }
  return { events, missingPerformer };
}

// ---------------------------------------------------------------------------
// PHÁT HIỆN CẢNH BÁO (cùng ngưỡng với script Python build_cham_cong.py)
// ---------------------------------------------------------------------------
const MIN_PHUT_MOI_LUOT_KHAM = 3;
const MIN_PHUT_MOI_LUOT_CLS = 1;
const NGUONG_DONG_THOI_TRUNG_GIO = 3;
const NGUONG_TRUNG_GIAM_SAT_TB = 5;
const NGUONG_TRUNG_GIAM_SAT_CAO = 7;

function groupByPersonDay(events) {
  const map = new Map();
  for (const e of events) {
    const k = `${e.person}|${e.dateKey}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

function detectWarnings(events) {
  const warnings = []; // { sev, cat, person, dateKey, detail }
  const byPersonDay = groupByPersonDay(events);

  for (const [pdKey, evs] of byPersonDay) {
    const [person, dateKey] = pdKey.split('|');
    const intervals = evs.filter((e) => e.start && e.end);

    // 1) Số bệnh nhân trùng giờ tối đa cùng lúc (sweep-line)
    if (intervals.length >= 2) {
      const points = [];
      for (const e of intervals) { points.push([e.start.getTime(), 1, e]); points.push([e.end.getTime(), -1, e]); }
      points.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
      const active = [];
      let maxConcurrent = 0, snapshot = [];
      for (const [, delta, e] of points) {
        if (delta === 1) active.push(e);
        else { const idx = active.indexOf(e); if (idx >= 0) active.splice(idx, 1); }
        if (active.length > maxConcurrent) { maxConcurrent = active.length; snapshot = active.slice(); }
      }
      if (maxConcurrent >= NGUONG_TRUNG_GIAM_SAT_TB) {
        const sev = maxConcurrent >= NGUONG_TRUNG_GIAM_SAT_CAO ? 'CAO' : 'TRUNG BÌNH';
        const desc = snapshot.slice(0, 8).map((e) => `${e.role} ${hhmm(e.start)}-${hhmm(e.end)} (BN ${e.patient})`).join('; ');
        warnings.push({ sev, cat: 'Trùng giờ thủ thuật/dịch vụ (giám sát quá nhiều BN)', person, dateKey, detail: `Tối đa ${maxConcurrent} BN được ghi nhận trùng giờ cùng lúc trong ngày: ${desc}` });
      }
    }

    // 2) Sự kiện tức thời rơi vào 1 khoảng đang hoạt động khác bên (khác BN)
    const instants = evs.filter((e) => e.start && !e.end);
    for (const inst of instants) {
      for (const iv of intervals) {
        if (iv.patient === inst.patient) continue;
        if (iv.start <= inst.start && inst.start < iv.end) {
          warnings.push({ sev: 'CAO', cat: 'Trùng giờ giữa y lệnh/CLS và thủ thuật', person, dateKey, detail: `${inst.role} lúc ${hhmm(inst.start)} (BN ${inst.patient}) rơi vào trong lúc đang ${iv.role} ${hhmm(iv.start)}-${hhmm(iv.end)} (BN ${iv.patient})` });
        }
      }
    }

    // 3) Nhiều bệnh nhân cùng 1 phút ở vai trò tức thời -> ghi giờ hàng loạt
    const byMinute = new Map();
    for (const e of instants) {
      const mk = hhmm(e.start);
      if (!byMinute.has(mk)) byMinute.set(mk, []);
      byMinute.get(mk).push(e);
    }
    for (const [minute, evsMin] of byMinute) {
      const distinctPatients = new Set(evsMin.map((e) => e.patient));
      if (distinctPatients.size >= 2) {
        const sev = distinctPatients.size >= NGUONG_DONG_THOI_TRUNG_GIO ? 'CAO' : 'TRUNG BÌNH';
        const roles = new Set(evsMin.map((e) => e.role));
        warnings.push({ sev, cat: 'Ghi giờ đồng thời nhiều bệnh nhân', person, dateKey, detail: `Lúc ${minute} có ${distinctPatients.size} BN khác nhau cùng được ghi nhận vai trò ${[...roles].sort().join('/')} (BN: ${[...distinctPatients].slice(0, 8).join(', ')})` });
      }
    }

    // 4) Thời gian trung bình xử lý/BN quá ngắn trong ngày
    const times = evs.filter((e) => e.start).map((e) => e.start);
    if (times.length >= 2) {
      const patients = new Set(evs.map((e) => e.patient));
      const minT = new Date(Math.min(...times.map((t) => t.getTime())));
      const maxT = new Date(Math.max(...times.map((t) => t.getTime())));
      const spanMin = (maxT - minT) / 60000;
      if (spanMin > 0) {
        const avgMin = spanMin / Math.max(patients.size, 1);
        const rolesHere = new Set(evs.map((e) => e.role));
        const isClsReadOnly = rolesHere.size === 1 && rolesHere.has('BS đọc KQ CLS');
        const threshold = isClsReadOnly ? MIN_PHUT_MOI_LUOT_CLS : MIN_PHUT_MOI_LUOT_KHAM;
        if (patients.size >= 5 && avgMin < threshold) {
          warnings.push({ sev: 'TRUNG BÌNH', cat: 'Thời gian xử lý/BN quá ngắn', person, dateKey, detail: `${patients.size} BN trong khoảng ${hhmm(minT)}-${hhmm(maxT)} (~${avgMin.toFixed(1)} phút/BN, dưới ngưỡng ${threshold} phút) - cần đối chiếu hồ sơ` });
        }
      }
    }
  }
  return warnings;
}

function hhmm(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function ddmmyyyy(dateKey) { const [y, m, d] = dateKey.split('-'); return `${d}/${m}/${y}`; }

function detectMonthYear(events) {
  const counts = new Map();
  for (const e of events) {
    const ym = e.dateKey.slice(0, 7);
    counts.set(ym, (counts.get(ym) || 0) + 1);
  }
  let best = null, bestCount = -1;
  for (const [ym, c] of counts) if (c > bestCount) { best = ym; bestCount = c; }
  const [year, month] = best.split('-').map(Number);
  return { month, year };
}

// ---------------------------------------------------------------------------
// XỬ LÝ FILE
// ---------------------------------------------------------------------------
[1, 2, 3].forEach((n) => {
  $(`#file-${n}`).addEventListener('change', (ev) => {
    const file = ev.target.files[0] || null;
    selectedFiles[n] = file;
    $(`#fname-${n}`).textContent = file ? file.name : 'Chưa chọn file';
    $(`#slot-${n}`).classList.toggle('ready', !!file);
    $('#btn-process').disabled = !(selectedFiles[1] && selectedFiles[2] && selectedFiles[3]);
  });
});

$('#btn-process').addEventListener('click', async () => {
  showError('#process-error', '');
  $('#btn-process').disabled = true;
  $('#process-status').innerHTML = '<span class="spinner"></span>Đang đọc và xử lý dữ liệu...';
  try {
    const reg = makeNameRegistry();
    const [rows1, rows2, rows3] = await Promise.all([
      readWorkbookRows(selectedFiles[1]),
      readWorkbookRows(selectedFiles[2]),
      readWorkbookRows(selectedFiles[3]),
    ]);
    const ev1 = readFile1_ChiPhi(rows1, reg);
    const ev2 = readFile2_CLS(rows2, reg);
    const { events: ev3, missingPerformer } = readFile3_ThuThuat(rows3, reg);
    const allEvents = [...ev1, ...ev2, ...ev3];
    if (allEvents.length === 0) throw new Error('Không tìm thấy dữ liệu hợp lệ trong 3 file đã chọn — kiểm tra lại đúng file/đúng cấu trúc cột.');

    const { month, year } = detectMonthYear(allEvents);
    const warnings = detectWarnings(allEvents);
    lastResult = { events: allEvents, warnings, month, year, reg, missingPerformer, counts: { ev1: ev1.length, ev2: ev2.length, ev3: ev3.length } };
    renderResults(lastResult);
    $('#process-status').textContent = `Xong — ${allEvents.length} sự kiện, ${warnings.length} cảnh báo.`;
  } catch (e) {
    console.error(e);
    showError('#process-error', e.message || 'Có lỗi khi xử lý file.');
    $('#process-status').textContent = '';
  } finally {
    $('#btn-process').disabled = false;
  }
});

// ---------------------------------------------------------------------------
// HIỂN THỊ KẾT QUẢ
// ---------------------------------------------------------------------------
function renderResults(result) {
  const { events, warnings, month, year, reg, missingPerformer } = result;
  const daysInMonth = new Date(year, month, 0).getDate();
  const persons = [...new Set(events.map((e) => e.person))].sort((a, b) => reg.displayName(a).localeCompare(reg.displayName(b), 'vi'));
  const byPersonDay = groupByPersonDay(events);

  const warnCaoCells = new Set();
  let nCao = 0, nTb = 0;
  for (const w of warnings) {
    if (w.sev === 'CAO') { warnCaoCells.add(`${w.person}|${w.dateKey}`); nCao++; } else nTb++;
  }
  const distinctDays = new Set(events.map((e) => e.dateKey)).size;

  let html = '';

  html += `<div class="kpi-grid">
    <div class="kpi"><div class="v">${persons.length}</div><div class="l">Y sĩ/Bác sĩ có hoạt động</div></div>
    <div class="kpi"><div class="v">${pad2(month)}/${year}</div><div class="l">Kỳ chấm công phát hiện</div></div>
    <div class="kpi"><div class="v">${distinctDays}</div><div class="l">Ngày có dữ liệu</div></div>
    <div class="kpi"><div class="v warn">${nCao}</div><div class="l">Cảnh báo mức CAO</div></div>
    <div class="kpi"><div class="v">${nTb}</div><div class="l">Cảnh báo mức trung bình</div></div>
  </div>`;

  html += `<div class="toolbar">
    <button class="btn btn-primary btn-sm" id="btn-export-excel">⬇ Tải Excel đầy đủ (4 sheet)</button>
    <span class="muted">File tải về gồm: Chấm công theo ngày · Chi tiết hoạt động · Cảnh báo · Ghi chú &amp; căn cứ pháp lý.</span>
  </div>`;

  if (missingPerformer > 0) {
    html += `<div class="info-box" style="display:block;">Sổ thủ thuật có ${missingPerformer} dòng không xác định được người thực hiện (cả "TTV chính" và "TTV phụ" đều trống) — các dòng này không được tính vào bảng chấm công.</div>`;
  }

  // ---- Bảng chấm công ----
  html += `<div class="panel"><h3>Bảng chấm công theo ngày</h3><div class="matrix-wrap"><table><thead><tr>
    <th>Họ tên</th><th>Số ngày công</th><th>Số lượt HĐ</th><th>Vai trò ghi nhận</th><th>Cảnh báo CAO</th>`;
  for (let d = 1; d <= daysInMonth; d++) html += `<th>${pad2(d)}</th>`;
  html += `</tr></thead><tbody>`;
  for (const person of persons) {
    let nDays = 0, nEvents = 0, nHighWarn = 0;
    const roles = new Set();
    let rowCells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
      const evs = byPersonDay.get(`${person}|${dateKey}`);
      if (evs && evs.length) {
        nDays++; nEvents += evs.length;
        evs.forEach((e) => roles.add(e.role));
        const times = evs.filter((e) => e.start).map((e) => e.start);
        const cellTxt = times.length ? `${hhmm(new Date(Math.min(...times.map((t) => t.getTime()))))}-${hhmm(new Date(Math.max(...times.map((t) => t.getTime()))))}` : 'x';
        const isWarn = warnCaoCells.has(`${person}|${dateKey}`);
        if (isWarn) nHighWarn++;
        rowCells += `<td${isWarn ? ' class="cell-warn"' : ''}>${cellTxt}</td>`;
      } else {
        rowCells += `<td></td>`;
      }
    }
    html += `<tr><td>${escapeHtml(reg.displayName(person))}</td><td>${nDays}</td><td>${nEvents}</td><td><span class="badge-role">${escapeHtml([...roles].sort().join(', '))}</span></td><td>${nHighWarn ? `<span class="pill pill-cao">${nHighWarn}</span>` : '0'}</td>${rowCells}</tr>`;
  }
  html += `</tbody></table></div></div>`;

  // ---- Cảnh báo ----
  const sevOrder = { CAO: 0, 'TRUNG BÌNH': 1 };
  const warningsSorted = warnings.slice().sort((a, b) => (sevOrder[a.sev] - sevOrder[b.sev]) || a.dateKey.localeCompare(b.dateKey) || reg.displayName(a.person).localeCompare(reg.displayName(b.person), 'vi'));
  html += `<div class="panel"><h3>Cảnh báo nghi vấn (${warnings.length})</h3>`;
  if (warningsSorted.length === 0) {
    html += `<p class="muted">Không phát hiện dấu hiệu bất thường nào với dữ liệu tháng này.</p>`;
  } else {
    html += `<table><thead><tr><th style="width:90px;">Mức độ</th><th style="width:200px;">Loại cảnh báo</th><th style="width:150px;">Họ tên</th><th style="width:90px;">Ngày</th><th>Chi tiết</th></tr></thead><tbody>`;
    for (const w of warningsSorted) {
      const pillClass = w.sev === 'CAO' ? 'pill-cao' : 'pill-tb';
      html += `<tr><td><span class="pill ${pillClass}">${w.sev}</span></td><td>${escapeHtml(w.cat)}</td><td>${escapeHtml(reg.displayName(w.person))}</td><td>${ddmmyyyy(w.dateKey)}</td><td>${escapeHtml(w.detail)}</td></tr>`;
    }
    html += `</tbody></table>`;
  }
  html += `</div>`;

  $('#results-wrap').innerHTML = html;
  $('#btn-export-excel').addEventListener('click', () => exportExcel(result));
}

// ---------------------------------------------------------------------------
// XUẤT EXCEL (4 sheet, dữ liệu thuần — không tô màu, giống quy ước xuất Excel
// hiện có của module Chia thủ thuật)
// ---------------------------------------------------------------------------
function exportExcel(result) {
  const { events, warnings, month, year, reg, missingPerformer } = result;
  const daysInMonth = new Date(year, month, 0).getDate();
  const persons = [...new Set(events.map((e) => e.person))].sort((a, b) => reg.displayName(a).localeCompare(reg.displayName(b), 'vi'));
  const byPersonDay = groupByPersonDay(events);
  const warnCaoCells = new Set(warnings.filter((w) => w.sev === 'CAO').map((w) => `${w.person}|${w.dateKey}`));

  // Sheet 1
  const s1 = [];
  s1.push([`BẢNG CHẤM CÔNG Y SĨ - BÁC SĨ THÁNG ${pad2(month)}/${year} - PHÒNG KHÁM ĐA KHOA VIỆT PHÁP`]);
  s1.push(['Dữ liệu tái tạo từ 3 báo cáo HIS. Đây là GIỜ HOẠT ĐỘNG GHI NHẬN TRÊN HỆ THỐNG, không thay thế máy chấm công vân tay/camera - xem sheet 4.GhiChu trước khi dùng để tính lương.']);
  s1.push([]);
  const header1 = ['Họ tên', 'Số ngày công', 'Số lượt hoạt động', 'Vai trò ghi nhận', 'Cảnh báo CAO'];
  for (let d = 1; d <= daysInMonth; d++) header1.push(pad2(d));
  s1.push(header1);
  for (const person of persons) {
    let nDays = 0, nEvents = 0, nHighWarn = 0;
    const roles = new Set();
    const dayCells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
      const evs = byPersonDay.get(`${person}|${dateKey}`);
      if (evs && evs.length) {
        nDays++; nEvents += evs.length;
        evs.forEach((e) => roles.add(e.role));
        const times = evs.filter((e) => e.start).map((e) => e.start);
        dayCells.push(times.length ? `${hhmm(new Date(Math.min(...times.map((t) => t.getTime()))))}-${hhmm(new Date(Math.max(...times.map((t) => t.getTime()))))}` : 'x');
        if (warnCaoCells.has(`${person}|${dateKey}`)) nHighWarn++;
      } else {
        dayCells.push('');
      }
    }
    s1.push([reg.displayName(person), nDays, nEvents, [...roles].sort().join(', '), nHighWarn, ...dayCells]);
  }

  // Sheet 2
  const s2 = [['Họ tên', 'Ngày', 'Giờ bắt đầu', 'Giờ kết thúc', 'Vai trò', 'Nguồn dữ liệu', 'Mã bệnh nhân/KCB', 'Khoa/Phòng', 'Nội dung']];
  const eventsSorted = events.slice().sort((a, b) => reg.displayName(a.person).localeCompare(reg.displayName(b.person), 'vi') || a.dateKey.localeCompare(b.dateKey) || (a.start && b.start ? a.start - b.start : 0));
  for (const e of eventsSorted) {
    s2.push([reg.displayName(e.person), ddmmyyyy(e.dateKey), e.start ? hhmm(e.start) : '', e.end ? hhmm(e.end) : '', e.role, e.source, e.patient ? String(e.patient) : '', e.dept || '', e.detail || '']);
  }

  // Sheet 3
  const s3 = [['Mức độ', 'Loại cảnh báo', 'Họ tên', 'Ngày', 'Chi tiết', 'Khuyến nghị xử lý']];
  const RECOMMEND = {
    'Trùng giờ thủ thuật/dịch vụ (giám sát quá nhiều BN)': 'Kiểm tra số giường/chỗ thực tế có đủ để giám sát đồng thời số BN này không. Nếu vượt khả năng giám sát thực tế, cần bổ sung nhân sự hoặc điều chỉnh lịch, tránh bị giám định BHYT nghi ngờ kê khống dịch vụ.',
    'Trùng giờ giữa y lệnh/CLS và thủ thuật': 'Kiểm tra lại người thực hiện thực tế (có thể do nhân viên khác ký thay/nhập hộ). Đính chính dữ liệu trước khi quyết toán BHYT.',
    'Ghi giờ đồng thời nhiều bệnh nhân': 'Kiểm tra có phải nhập liệu hàng loạt (backdate) hay không. Nếu là thao tác nhập liệu (không phải giờ khám thực), cần chỉnh quy trình nhập liệu để đúng thời gian thực tế.',
    'Thời gian xử lý/BN quá ngắn': 'Rà soát khả năng đảm bảo thời gian khám/đọc KQ tối thiểu theo quy định chuyên môn; nguy cơ BHXH xuất toán khi giám định hồ sơ.',
  };
  const sevOrder = { CAO: 0, 'TRUNG BÌNH': 1 };
  const warningsSorted = warnings.slice().sort((a, b) => (sevOrder[a.sev] - sevOrder[b.sev]) || a.dateKey.localeCompare(b.dateKey) || reg.displayName(a.person).localeCompare(reg.displayName(b.person), 'vi'));
  for (const w of warningsSorted) {
    s3.push([w.sev, w.cat, reg.displayName(w.person), ddmmyyyy(w.dateKey), w.detail, RECOMMEND[w.cat] || 'Rà soát lại hồ sơ liên quan.']);
  }
  const nCao = warnings.filter((w) => w.sev === 'CAO').length;
  const nTb = warnings.filter((w) => w.sev === 'TRUNG BÌNH').length;
  s3.push([]);
  s3.push([`Tổng số cảnh báo: ${warnings.length}  (Cao: ${nCao} | Trung bình: ${nTb})`]);

  // Sheet 4
  const s4lines = [
    'BẢNG CHẤM CÔNG Y SĨ - BÁC SĨ - GHI CHÚ PHƯƠNG PHÁP & CĂN CỨ PHÁP LÝ', '',
    '1. NGUỒN DỮ LIỆU',
    "  - File 1 (Bảng kê chi phí chi tiết): lấy cột 'BacSi' (người kê đơn/ra y lệnh) và cột 'Ngay_YL' (thời điểm ra y lệnh) làm mốc thời gian hoạt động.",
    "  - File 2 (Sổ kết quả CLS theo bác sĩ): tách 2 vai trò riêng - 'BS chỉ định' (thời điểm 'Ngày lập') và 'Bs đọc kết quả' (thời điểm 'Ngày làm').",
    "  - File 3 (Sổ thủ thuật): thời gian lấy từ cột 'Ngày/giờ TT' (dạng DD/MM/YYYY HH:MM-HH:MM).", '',
    '2. GIẢ ĐỊNH XỬ LÝ QUAN TRỌNG (CẦN NGƯỜI PHỤ TRÁCH NHÂN SỰ XÁC NHẬN LẠI)',
    `  - Trong file Sổ thủ thuật, cột 'TTV chính' phần lớn để trống và tên người thực hiện thực tế lại nằm ở cột 'TTV phụ' (${missingPerformer} dòng không xác định được người thực hiện rõ ràng). Công cụ tự động dùng 'TTV phụ' làm người thực hiện chính khi 'TTV chính' bỏ trống.`,
    "  - 'Giờ hoạt động' trong bảng chấm công là GIỜ ĐẦU - GIỜ CUỐI của tất cả sự kiện hệ thống ghi nhận trong ngày, KHÔNG PHẢI giờ vào/ra thực tế qua máy chấm công. Chỉ mang tính tham chiếu, đối chiếu.",
    '  - Tên nhân sự được gộp theo họ tên không phân biệt hoa/thường. Nếu có 2 người trùng tên, cần bổ sung mã nhân viên/SĐT để tách riêng.', '',
    '3. CĂN CỨ PHÁP LÝ / QUY ĐỊNH THAM CHIẾU (BHYT)',
    '  - Luật BHYT 2008 (sửa đổi, bổ sung 2014, 2024) và Nghị định 146/2018/NĐ-CP: quy định điều kiện thanh toán chi phí KCB BHYT, trách nhiệm của cơ sở KCB trong ghi chép, lưu trữ hồ sơ làm căn cứ quyết toán.',
    '  - Thông tư 09/2019/TT-BYT và các văn bản hướng dẫn giám định BHYT: cơ quan BHXH có thể từ chối/xuất toán các dịch vụ có dấu hiệu trùng giờ, thời gian thực hiện không đảm bảo tối thiểu, hoặc hồ sơ thiếu thông tin người thực hiện.',
    '  - Để phòng tránh nguy cơ xuất toán: đối chiếu dữ liệu HIS với máy chấm công / lịch trực / chữ ký bác sĩ trước khi gửi hồ sơ đề nghị thanh toán BHYT hàng tháng, đặc biệt với các dòng mức CAO trong sheet 3.CanhBao.',
  ];
  const s4 = s4lines.map((line) => [line]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), '1.ChamCong');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), '2.ChiTietHoatDong');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), '3.CanhBao');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4), '4.GhiChu');
  XLSX.writeFile(wb, `cham-cong-y-si-bac-si-${pad2(month)}-${year}.xlsx`);
}

// ---------------------------------------------------------------------------
// QUẢN LÝ TÀI KHOẢN (chỉ CEO thấy — mirror api/cham-cong-accounts.js)
// ---------------------------------------------------------------------------
async function loadAccounts() {
  try {
    const { accounts } = await api('/api/cham-cong-accounts');
    const tbody = $('#accounts-tbody');
    tbody.innerHTML = accounts.map((a) => `
      <tr data-id="${a.id}">
        <td>${escapeHtml(a.email)}</td>
        <td><input type="checkbox" class="toggle-acct-manager" ${a.cham_cong_manager ? 'checked' : ''}></td>
        <td><span class="del-row del-account" title="Xoá tài khoản">✕</span></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.toggle-acct-manager').forEach((cb) => {
      cb.addEventListener('change', async (ev) => {
        const id = ev.target.closest('tr').dataset.id;
        await api('/api/cham-cong-accounts', { method: 'POST', body: JSON.stringify({ action: 'update_permission', payload: { id, cham_cong_manager: ev.target.checked } }) });
      });
    });
    tbody.querySelectorAll('.del-account').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        const tr = ev.target.closest('tr');
        if (!confirm('Xoá tài khoản này?')) return;
        await api('/api/cham-cong-accounts', { method: 'POST', body: JSON.stringify({ action: 'delete_account', payload: { id: tr.dataset.id } }) });
        loadAccounts();
      });
    });
  } catch (e) {
    showError('#account-error', e.message);
  }
}

$('#btn-add-account').addEventListener('click', async () => {
  showError('#account-error', '');
  const email = $('#new-acct-email').value.trim();
  const cham_cong_manager = $('#new-acct-manager').checked;
  if (!email) { showError('#account-error', 'Nhập email.'); return; }
  try {
    const result = await api('/api/cham-cong-accounts', { method: 'POST', body: JSON.stringify({ action: 'create_account', payload: { email, cham_cong_manager } }) });
    alert(`Đã tạo tài khoản ${result.email}\nMật khẩu tạm: ${result.tempPassword}\n\nGửi lại 2 thông tin này cho nhân viên — họ nên đổi mật khẩu sau lần đăng nhập đầu tiên (Supabase chưa có màn "đổi mật khẩu" trong app này, có thể đặt lại trực tiếp trong Supabase Auth nếu cần).`);
    $('#new-acct-email').value = '';
    $('#new-acct-manager').checked = false;
    loadAccounts();
  } catch (e) {
    showError('#account-error', e.message);
  }
});

checkSession();
