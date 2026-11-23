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
let reviewsMap = new Map(); // `${person_key}|${category}` -> { decision, note, reviewed_by, reviewed_at }
let detectedRows = { chiphi: null, cls: null, thuthuat: null };   // rows (array-of-arrays) đã đọc + nhận diện từ file
let detectedNames = { chiphi: null, cls: null, thuthuat: null };  // tên file tương ứng, để hiện trên UI
const reviewKey = (personKey, category) => `${personKey}|${category}`;

// Khung giờ hành chính — người dùng sửa được trên UI (ô nhập ở tab Chấm công),
// mặc định đúng quy định BHYT: Sáng 07:00–11:30, Chiều 13:30–17:00, tính cả 2 mốc biên.
const DEFAULT_KHUNG_GIO = { sangStart: '07:00', sangEnd: '11:30', chieuStart: '13:30', chieuEnd: '17:00' };

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
  await loadReviews();
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
// Chấp nhận ngày/giờ 1 hoặc 2 chữ số (VD "1/8/2026 7:4" lẫn "01/08/2026 07:04")
// dù dữ liệu HIS hiện tại luôn xuất đủ 2 chữ số — phòng trường hợp một bản
// xuất báo cáo sau này đổi định dạng, tránh âm thầm bỏ sót cả dòng dữ liệu.
function parseDT(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const [, dd, mo, yyyy, hh, mi, ss] = m;
  return new Date(Number(yyyy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss || 0));
}

function dateKeyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

const RANGE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})-(\d{1,2}):(\d{1,2})/;
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
// XÁC ĐỊNH CA (SÁNG/CHIỀU/NGOÀI KHUNG) THEO KHUNG GIỜ HÀNH CHÍNH
// ---------------------------------------------------------------------------
function hhmmToMinutes(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }

/** Trả về 'sang' | 'chieu' | 'ngoai_khung'. Với sự kiện có khoảng bắt đầu-kết
 * thúc (thủ thuật), CẢ HAI mốc phải cùng nằm trong 1 khung (tính cả biên) mới
 * tính ca đó — 1 ca lấn sang giờ nghỉ trưa hoặc ngoài giờ hành chính bị loại
 * hoàn toàn, không tính công. Với sự kiện tức thời (y lệnh/CLS), chỉ xét 1 mốc. */
function classifyBuoi(event, khungGio) {
  const sangStart = hhmmToMinutes(khungGio.sangStart), sangEnd = hhmmToMinutes(khungGio.sangEnd);
  const chieuStart = hhmmToMinutes(khungGio.chieuStart), chieuEnd = hhmmToMinutes(khungGio.chieuEnd);
  const startMin = minutesOfDay(event.start);
  const inSang = (t) => t >= sangStart && t <= sangEnd;
  const inChieu = (t) => t >= chieuStart && t <= chieuEnd;
  if (event.end) {
    const endMin = minutesOfDay(event.end);
    if (inSang(startMin) && inSang(endMin)) return 'sang';
    if (inChieu(startMin) && inChieu(endMin)) return 'chieu';
    return 'ngoai_khung';
  }
  if (inSang(startMin)) return 'sang';
  if (inChieu(startMin)) return 'chieu';
  return 'ngoai_khung';
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
  let dataRows = 0, dateParseFailures = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const shs = row[0], hoten = row[2], tenkp = row[18], ngayYl = row[26], bacsi = row[30];
    if (!bacsi) continue;
    dataRows++;
    if (!ngayYl) continue;
    const dt = parseDT(ngayYl);
    if (!dt) { dateParseFailures++; continue; }
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
  return { events, dataRows, dateParseFailures };
}

function readFile2_CLS(rows, reg) {
  const events = [];
  let dataRows = 0, dateParseFailures = 0;
  for (let r = 8; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const makcb = row[1];
    if (!makcb) continue;
    dataRows++;
    const hoten = row[2], khoaCd = row[8], bsChiDinh = row[10], yeuCau = row[11];
    const bsDocKq = row[14], ngayLam = row[15], ngayLap = row[16];
    // Đúng quy ước nghiệp vụ: BS chỉ định xét theo cột "Ngày lập", BS đọc KQ
    // xét theo cột "Ngày làm" — KHÔNG lấy chéo/dự phòng cột còn lại.
    const dtLam = parseDT(ngayLam), dtLap = parseDT(ngayLap);
    if ((ngayLam || ngayLap) && !dtLam && !dtLap) dateParseFailures++;
    if (bsChiDinh && dtLap) {
      const key = reg.register(bsChiDinh);
      events.push({ person: key, dateKey: dateKeyOf(dtLap), start: dtLap, end: null, role: 'BS chỉ định CLS', patient: makcb, dept: khoaCd, detail: `${yeuCau || ''} - BN ${hoten || ''}`, source: '2-CLS' });
    }
    if (bsDocKq && dtLam) {
      const key = reg.register(bsDocKq);
      events.push({ person: key, dateKey: dateKeyOf(dtLam), start: dtLam, end: null, role: 'BS đọc KQ CLS', patient: makcb, dept: khoaCd, detail: `${yeuCau || ''} - BN ${hoten || ''}`, source: '2-CLS' });
    }
  }
  return { events, dataRows, dateParseFailures };
}

function readFile3_ThuThuat(rows, reg) {
  const events = [];
  let missingPerformer = 0;
  let dataRows = 0, dateParseFailures = 0;
  for (let r = 7; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const makcb = row[1];
    if (!makcb) continue;
    dataRows++;
    const hoten = row[2], ppTt = row[9], ngayGio = row[11];
    const ttvChinh = row[13], ttvPhu = row[14], gayMe = row[15];
    const parsed = parseRange(ngayGio);
    if (!parsed) { if (ngayGio) dateParseFailures++; continue; }
    const { dateKey, start, end } = parsed;
    const performer = ttvChinh || ttvPhu;
    const assistant = ttvChinh ? ttvPhu : null;
    if (!performer) missingPerformer++;
    const detail = `${ppTt || ''} - BN ${hoten || ''}`;
    // Chỉ tính công cho TTV chính, TTV phụ, Gây mê chính — cột "Giúp việc"
    // không được tính theo quy tắc nghiệp vụ chấm công.
    if (performer) events.push({ person: reg.register(performer), dateKey, start, end, role: 'TTV chính', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
    if (assistant) events.push({ person: reg.register(assistant), dateKey, start, end, role: 'TTV phụ', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
    if (gayMe) events.push({ person: reg.register(gayMe), dateKey, start, end, role: 'Gây mê', patient: makcb, dept: 'YHCT/Thủ thuật', detail, source: '3-ThuThuat' });
  }
  return { events, missingPerformer, dataRows, dateParseFailures };
}

// ---------------------------------------------------------------------------
// PHÁT HIỆN CẢNH BÁO (cùng ngưỡng với script Python build_cham_cong.py)
// ---------------------------------------------------------------------------
const MIN_PHUT_MOI_LUOT_KHAM = 3;
const NGUONG_DONG_THOI_TRUNG_GIO = 3;

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

    // Trùng giờ nhiều bệnh nhân khi GIÁM SÁT thủ thuật đông y (vai trò "Gây
    // mê") hoặc ĐỌC KẾT QUẢ XÉT NGHIỆM cùng lúc nhiều người là nghiệp vụ bình
    // thường của phòng khám — KHÔNG cảnh báo các trường hợp này (xem dưới).

    // 1) Sự kiện tức thời rơi vào 1 khoảng đang hoạt động khác bên (khác BN) —
    // bỏ qua khi khoảng đang hoạt động là vai trò "Gây mê" (giám sát), vì 1
    // người giám sát có thể đồng thời ra y lệnh/đọc KQ cho bệnh nhân khác.
    const instants = evs.filter((e) => e.start && !e.end);
    for (const inst of instants) {
      for (const iv of intervals) {
        if (iv.patient === inst.patient) continue;
        if (iv.role === 'Gây mê') continue;
        if (iv.start <= inst.start && inst.start < iv.end) {
          warnings.push({ sev: 'CAO', cat: 'Trùng giờ giữa y lệnh/CLS và thủ thuật', person, dateKey, detail: `${inst.role} lúc ${hhmm(inst.start)} (BN ${inst.patient}) rơi vào trong lúc đang ${iv.role} ${hhmm(iv.start)}-${hhmm(iv.end)} (BN ${iv.patient})` });
        }
      }
    }

    // 2) Nhiều bệnh nhân cùng 1 phút ở vai trò tức thời -> ghi giờ hàng loạt —
    // bỏ qua khi TOÀN BỘ là vai trò "BS đọc KQ CLS" (đọc kết quả xét nghiệm
    // nhiều bệnh nhân cùng lúc là bình thường); vẫn cảnh báo nếu lẫn vai trò
    // khác (VD kê đơn hàng loạt).
    const byMinute = new Map();
    for (const e of instants) {
      const mk = hhmm(e.start);
      if (!byMinute.has(mk)) byMinute.set(mk, []);
      byMinute.get(mk).push(e);
    }
    for (const [minute, evsMin] of byMinute) {
      const distinctPatients = new Set(evsMin.map((e) => e.patient));
      const roles = new Set(evsMin.map((e) => e.role));
      if (roles.size === 1 && roles.has('BS đọc KQ CLS')) continue;
      if (distinctPatients.size >= 2) {
        const sev = distinctPatients.size >= NGUONG_DONG_THOI_TRUNG_GIO ? 'CAO' : 'TRUNG BÌNH';
        warnings.push({ sev, cat: 'Ghi giờ đồng thời nhiều bệnh nhân', person, dateKey, detail: `Lúc ${minute} có ${distinctPatients.size} BN khác nhau cùng được ghi nhận vai trò ${[...roles].sort().join('/')} (BN: ${[...distinctPatients].slice(0, 8).join(', ')})` });
      }
    }

    // 3) Thời gian trung bình xử lý/BN quá ngắn trong ngày — bỏ qua hoàn
    // toàn khi cả ngày chỉ có vai trò "BS đọc KQ CLS" (đọc nhanh nhiều kết
    // quả xét nghiệm) hoặc "Gây mê" (giám sát nhiều BN cùng lúc, không phải
    // xử lý tuần tự nên phép tính "thời gian/BN" không áp dụng được) — đều
    // là nghiệp vụ bình thường, không phải dấu hiệu bất thường.
    const times = evs.filter((e) => e.start).map((e) => e.start);
    if (times.length >= 2) {
      const patients = new Set(evs.map((e) => e.patient));
      const rolesHere = new Set(evs.map((e) => e.role));
      const isExemptRole = rolesHere.size === 1 && (rolesHere.has('BS đọc KQ CLS') || rolesHere.has('Gây mê'));
      if (!isExemptRole) {
        const minT = new Date(Math.min(...times.map((t) => t.getTime())));
        const maxT = new Date(Math.max(...times.map((t) => t.getTime())));
        const spanMin = (maxT - minT) / 60000;
        if (spanMin > 0) {
          const avgMin = spanMin / Math.max(patients.size, 1);
          if (patients.size >= 5 && avgMin < MIN_PHUT_MOI_LUOT_KHAM) {
            warnings.push({ sev: 'TRUNG BÌNH', cat: 'Thời gian xử lý/BN quá ngắn', person, dateKey, detail: `${patients.size} BN trong khoảng ${hhmm(minT)}-${hhmm(maxT)} (~${avgMin.toFixed(1)} phút/BN, dưới ngưỡng ${MIN_PHUT_MOI_LUOT_KHAM} phút) - cần đối chiếu hồ sơ` });
          }
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
// XEM XÉT CẢNH BÁO (xác nhận lỗi / bỏ qua có lý do) — lưu theo cặp
// (người, loại cảnh báo) nên áp dụng lại được cho các tháng sau, xem
// api/cham-cong-reviews.js và supabase/schema_cham_cong_warning_reviews.sql.
// ---------------------------------------------------------------------------
async function loadReviews() {
  try {
    const { reviews } = await api('/api/cham-cong-reviews');
    reviewsMap = new Map(reviews.map((r) => [reviewKey(r.person_key, r.category), r]));
    renderReviewsAdminPanel(reviews);
  } catch (e) {
    console.error('loadReviews failed', e);
  }
}

async function setReviewDecision(personKey, personDisplay, category, decision, note) {
  await api('/api/cham-cong-reviews', { method: 'POST', body: JSON.stringify({ action: 'set', payload: { person_key: personKey, person_display: personDisplay, category, decision, note } }) });
  await loadReviews();
  if (lastResult) renderResults(lastResult);
}

async function deleteReviewDecision(personKey, category) {
  await api('/api/cham-cong-reviews', { method: 'POST', body: JSON.stringify({ action: 'delete', payload: { person_key: personKey, category } }) });
  await loadReviews();
  if (lastResult) renderResults(lastResult);
}

function renderReviewsAdminPanel(reviews) {
  const panel = $('#panel-reviews-list');
  if (!panel) return;
  if (!reviews.length) {
    panel.innerHTML = '<p class="muted">Chưa có cảnh báo nào được xem xét.</p>';
    return;
  }
  let html = '<table><thead><tr><th>Họ tên</th><th>Loại cảnh báo</th><th style="width:100px;">Quyết định</th><th>Lý do</th><th style="width:150px;">Người xem xét</th><th style="width:70px;"></th></tr></thead><tbody>';
  for (const r of reviews) {
    const pill = r.decision === 'dismissed' ? '<span class="pill pill-tb">Bỏ qua</span>' : '<span class="pill pill-cao">Xác nhận lỗi</span>';
    html += `<tr><td>${escapeHtml(r.person_display)}</td><td>${escapeHtml(r.category)}</td><td>${pill}</td><td>${escapeHtml(r.note || '')}</td><td class="muted">${escapeHtml(r.reviewed_by)}<br>${new Date(r.reviewed_at).toLocaleDateString('vi-VN')}</td><td><span class="del-row" data-person="${encodeURIComponent(r.person_key)}" data-category="${encodeURIComponent(r.category)}" title="Huỷ quyết định — quay lại trạng thái chưa xem xét">✕</span></td></tr>`;
  }
  html += '</tbody></table>';
  panel.innerHTML = html;
  panel.querySelectorAll('.del-row').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Huỷ quyết định đã xem xét? Cảnh báo này sẽ được đánh giá lại từ đầu (kể cả các tháng sau).')) return;
      await deleteReviewDecision(decodeURIComponent(el.dataset.person), decodeURIComponent(el.dataset.category));
    });
  });
}

// ---------------------------------------------------------------------------
// XỬ LÝ FILE — chọn 1 lần cả 3 file, tự nhận diện đúng loại theo nội dung
// (không bắt buộc chọn đúng thứ tự ①②③).
// ---------------------------------------------------------------------------
// Nhận diện dựa trên tiêu đề/tên cột đặc trưng của mỗi báo cáo — ổn định hơn
// dựa vào tên file, vì tên file do HIS đặt có thể đổi mỗi lần xuất.
function detectFileKind(rows) {
  const sample = rows.slice(0, 10).flat().filter((v) => typeof v === 'string').join(' | ').toLowerCase();
  if (sample.includes('sổ thủ thuật') || sample.includes('ttv chính') || sample.includes('ngày/giờ tt')) return 'thuthuat';
  if (sample.includes('sổ kết quả') || sample.includes('bs chỉ định') || sample.includes('bs đọc kết quả')) return 'cls';
  if (sample.includes('bacsi') && sample.includes('ngay_yl')) return 'chiphi';
  return null;
}

function updateUploadSlotsUI() {
  for (const kind of ['chiphi', 'cls', 'thuthuat']) {
    const name = detectedNames[kind];
    $(`#fname-${kind}`).textContent = name || 'Chưa nhận diện được';
    $(`#slot-${kind}`).classList.toggle('ready', !!name);
  }
  $('#btn-process').disabled = !(detectedRows.chiphi && detectedRows.cls && detectedRows.thuthuat);
}

$('#file-multi').addEventListener('change', async (ev) => {
  const files = Array.from(ev.target.files || []);
  detectedRows = { chiphi: null, cls: null, thuthuat: null };
  detectedNames = { chiphi: null, cls: null, thuthuat: null };
  showError('#process-error', '');
  updateUploadSlotsUI();
  if (!files.length) return;
  $('#process-status').innerHTML = '<span class="spinner"></span>Đang nhận diện file...';
  const unrecognized = [];
  for (const file of files) {
    try {
      const rows = await readWorkbookRows(file);
      const kind = detectFileKind(rows);
      if (!kind) { unrecognized.push(file.name); continue; }
      detectedRows[kind] = rows;
      detectedNames[kind] = file.name;
    } catch (e) {
      unrecognized.push(`${file.name} (${e.message || 'không đọc được'})`);
    }
  }
  updateUploadSlotsUI();
  $('#process-status').textContent = '';
  if (unrecognized.length) {
    showError('#process-error', `Không nhận diện được ${unrecognized.length} file: ${unrecognized.join(', ')}. Kiểm tra lại đúng 3 báo cáo HIS gốc (không đổi cấu trúc cột/tiêu đề).`);
  }
});

$('#btn-process').addEventListener('click', async () => {
  showError('#process-error', '');
  $('#btn-process').disabled = true;
  $('#process-status').innerHTML = '<span class="spinner"></span>Đang xử lý dữ liệu...';
  try {
    const khungGio = readKhungGioInputs();
    const reg = makeNameRegistry();
    const { events: ev1, dataRows: dr1, dateParseFailures: dpf1 } = readFile1_ChiPhi(detectedRows.chiphi, reg);
    const { events: ev2, dataRows: dr2, dateParseFailures: dpf2 } = readFile2_CLS(detectedRows.cls, reg);
    const { events: ev3, missingPerformer, dataRows: dr3, dateParseFailures: dpf3 } = readFile3_ThuThuat(detectedRows.thuthuat, reg);
    const rawAllEvents = [...ev1, ...ev2, ...ev3];
    if (rawAllEvents.length === 0) throw new Error('Không tìm thấy dữ liệu hợp lệ trong 3 file đã chọn — kiểm tra lại đúng file/đúng cấu trúc cột.');

    // Cảnh báo sớm nếu 1 file có tỉ lệ dòng KHÔNG đọc được ngày/giờ bất thường
    // cao (>20%) — dấu hiệu HIS đã đổi cấu trúc cột dù tiêu đề vẫn khớp lúc
    // nhận diện, tránh âm thầm bỏ sót cả mảng dữ liệu mà không ai hay.
    const yieldWarnings = [];
    const checkYield = (label, dataRows, failures) => {
      if (dataRows > 0 && failures / dataRows > 0.2) {
        yieldWarnings.push(`${label}: ${failures}/${dataRows} dòng (${Math.round((failures / dataRows) * 100)}%) không đọc được ngày/giờ`);
      }
    };
    checkYield('Bảng kê chi phí chi tiết', dr1, dpf1);
    checkYield('Sổ kết quả CLS', dr2, dpf2);
    checkYield('Sổ thủ thuật', dr3, dpf3);

    const { month, year } = detectMonthYear(rawAllEvents);
    // File "chi phí chi tiết" đôi khi kèm theo vài dòng gối đầu từ kỳ trước
    // (VD đợt khám bắt đầu cuối tháng trước). Chỉ giữ lại sự kiện đúng tháng
    // đã phát hiện để "Ngày có dữ liệu"/cảnh báo/bảng chấm công không bị lẫn
    // dữ liệu ngoài kỳ báo cáo — nhưng vẫn báo rõ số lượng đã loại để đối
    // chiếu nếu cần.
    const ymPrefix = `${year}-${pad2(month)}`;
    const allEvents = rawAllEvents.filter((e) => e.dateKey.startsWith(ymPrefix));
    const outOfScopeCount = rawAllEvents.length - allEvents.length;

    // Xác định ca (sáng/chiều/ngoài khung) cho từng sự kiện theo khung giờ
    // hành chính hiện tại — sự kiện cảnh báo (detectWarnings) vẫn xét trên
    // TOÀN BỘ sự kiện kể cả ngoài khung (trùng giờ ngoài giờ hành chính càng
    // đáng ngờ hơn), còn bảng CHẤM CÔNG/CÔNG chỉ tính sự kiện trong khung.
    for (const e of allEvents) e.buoi = classifyBuoi(e, khungGio);
    const ngoaiKhungBySource = { '1-ChiPhi': 0, '2-CLS': 0, '3-ThuThuat': 0 };
    for (const e of allEvents) if (e.buoi === 'ngoai_khung') ngoaiKhungBySource[e.source]++;
    const attendance = buildAttendance(allEvents);

    // Nhân sự chỉ từng xuất hiện ở vai trò phụ (Gây mê/TTV phụ), chưa từng là
    // TTV chính/BS — có thể là kỹ thuật viên chứ không phải bác sĩ, cần xác minh.
    const rolesByPerson = new Map();
    for (const e of allEvents) {
      if (!rolesByPerson.has(e.person)) rolesByPerson.set(e.person, new Set());
      rolesByPerson.get(e.person).add(e.role);
    }
    const possibleNonDoctor = [...rolesByPerson.entries()]
      .filter(([, roles]) => [...roles].every((r) => r === 'Gây mê' || r === 'TTV phụ'))
      .map(([person]) => reg.displayName(person));

    const warnings = detectWarnings(allEvents);
    lastResult = {
      events: allEvents, warnings, month, year, reg, missingPerformer, outOfScopeCount, yieldWarnings,
      khungGio, ngoaiKhungBySource, attendance, possibleNonDoctor,
      counts: { ev1: ev1.length, ev2: ev2.length, ev3: ev3.length },
    };
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

function readKhungGioInputs() {
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const get = (id, fallback) => {
    const v = $(`#${id}`).value.trim();
    return timeRe.test(v) ? v : fallback;
  };
  const khungGio = {
    sangStart: get('khung-sang-start', DEFAULT_KHUNG_GIO.sangStart),
    sangEnd: get('khung-sang-end', DEFAULT_KHUNG_GIO.sangEnd),
    chieuStart: get('khung-chieu-start', DEFAULT_KHUNG_GIO.chieuStart),
    chieuEnd: get('khung-chieu-end', DEFAULT_KHUNG_GIO.chieuEnd),
  };
  // Ghi lại đúng giá trị đã dùng (kể cả khi người dùng gõ sai định dạng và bị
  // trả về mặc định) để không gây hiểu nhầm giữa ô nhập và kết quả tính.
  $('#khung-sang-start').value = khungGio.sangStart;
  $('#khung-sang-end').value = khungGio.sangEnd;
  $('#khung-chieu-start').value = khungGio.chieuStart;
  $('#khung-chieu-end').value = khungGio.chieuEnd;
  return khungGio;
}

/** Gộp sự kiện (đã có .buoi) thành dữ liệu chấm công: mỗi (người, ngày) biết
 * có mặt buổi sáng/chiều hay không (nhiều bản ghi cùng buổi chỉ tính 1 ca),
 * rồi suy ra công = 0 / 0,5 / 1. Trả về attendanceEvents (loại bỏ sự kiện
 * ngoài khung) để các bảng giờ sớm nhất-muộn nhất cũng chỉ phản ánh đúng giờ
 * hành chính. */
function buildAttendance(events) {
  const attendanceEvents = events.filter((e) => e.buoi !== 'ngoai_khung');
  const presence = new Map(); // `${person}|${dateKey}` -> { sang, chieu }
  for (const e of attendanceEvents) {
    const k = `${e.person}|${e.dateKey}`;
    if (!presence.has(k)) presence.set(k, { sang: false, chieu: false });
    const p = presence.get(k);
    if (e.buoi === 'sang') p.sang = true;
    if (e.buoi === 'chieu') p.chieu = true;
  }
  const congMap = new Map(); // `${person}|${dateKey}` -> 0.5 | 1
  let tongCa = 0;
  for (const [k, p] of presence) {
    const cong = (p.sang ? 0.5 : 0) + (p.chieu ? 0.5 : 0);
    if (p.sang) tongCa++;
    if (p.chieu) tongCa++;
    if (cong > 0) congMap.set(k, cong);
  }
  const tongCong = [...congMap.values()].reduce((s, c) => s + c, 0);
  return { attendanceEvents, presence, congMap, tongCa, tongCong };
}

// ---------------------------------------------------------------------------
// HIỂN THỊ KẾT QUẢ
// ---------------------------------------------------------------------------
function renderResults(result) {
  const { events, warnings, month, year, reg, missingPerformer, outOfScopeCount, yieldWarnings, khungGio, ngoaiKhungBySource, attendance, possibleNonDoctor } = result;
  const daysInMonth = new Date(year, month, 0).getDate();
  const persons = [...new Set(events.map((e) => e.person))].sort((a, b) => reg.displayName(a).localeCompare(reg.displayName(b), 'vi'));
  const byPersonDayAtt = groupByPersonDay(attendance.attendanceEvents);

  // Áp quyết định đã xem xét (theo cặp người + loại cảnh báo): "dismissed" thì
  // không tính là cảnh báo đang hoạt động nữa (nhưng vẫn giữ trong file Excel
  // xuất ra để có dấu vết); "error" thì vẫn cảnh báo bình thường, chỉ thêm nhãn
  // đã xác nhận.
  for (const w of warnings) w.review = reviewsMap.get(reviewKey(w.person, w.cat)) || null;
  const activeWarnings = warnings.filter((w) => !(w.review && w.review.decision === 'dismissed'));
  const dismissedWarnings = warnings.filter((w) => w.review && w.review.decision === 'dismissed');

  const warnCaoCells = new Set();
  let nCao = 0;
  for (const w of activeWarnings) {
    if (w.sev === 'CAO') { warnCaoCells.add(`${w.person}|${w.dateKey}`); nCao++; }
  }
  const distinctDays = new Set(attendance.attendanceEvents.map((e) => e.dateKey)).size;
  const tongNgoaiKhung = ngoaiKhungBySource['1-ChiPhi'] + ngoaiKhungBySource['2-CLS'] + ngoaiKhungBySource['3-ThuThuat'];

  let html = '';

  html += `<div class="kpi-grid">
    <div class="kpi"><div class="v">${persons.length}</div><div class="l">Y sĩ/Bác sĩ có hoạt động</div></div>
    <div class="kpi"><div class="v">${pad2(month)}/${year}</div><div class="l">Kỳ chấm công phát hiện</div></div>
    <div class="kpi"><div class="v">${distinctDays}</div><div class="l">Ngày có dữ liệu (trong khung giờ)</div></div>
    <div class="kpi"><div class="v">${attendance.tongCa}</div><div class="l">Tổng số ca</div></div>
    <div class="kpi"><div class="v">${String(attendance.tongCong).replace('.', ',')}</div><div class="l">Tổng công</div></div>
    <div class="kpi"><div class="v warn">${nCao}</div><div class="l">Cảnh báo CAO</div></div>
  </div>`;

  html += `<div class="toolbar">
    <button class="btn btn-primary btn-sm" id="btn-export-excel">⬇ Tải Excel đầy đủ (6 sheet)</button>
    <span class="muted">File tải về gồm: Chấm công BS · Chấm công ngày · Chấm công chi tiết · Chi tiết hoạt động · Cảnh báo · Ghi chú &amp; căn cứ pháp lý.</span>
  </div>`;

  if (yieldWarnings && yieldWarnings.length) {
    html += `<div class="error-box" style="display:block;"><b>Nghi ngờ sai lệch cấu trúc file đầu vào:</b><br>${yieldWarnings.map(escapeHtml).join('<br>')}<br>Kiểm tra lại đúng bản mẫu HIS gốc trước khi dùng kết quả này.</div>`;
  }
  if (missingPerformer > 0) {
    html += `<div class="info-box" style="display:block;">Sổ thủ thuật có ${missingPerformer} dòng không xác định được người thực hiện (cả "TTV chính" và "TTV phụ" đều trống) — các dòng này không được tính vào bảng chấm công.</div>`;
  }
  if (outOfScopeCount > 0) {
    html += `<div class="info-box" style="display:block;">Đã loại ${outOfScopeCount} sự kiện rơi ra ngoài tháng ${pad2(month)}/${year} (thường do file "chi phí chi tiết" kèm theo vài dòng gối đầu từ kỳ trước) — không tính vào bảng chấm công/cảnh báo của kỳ này.</div>`;
  }
  if (tongNgoaiKhung > 0) {
    html += `<div class="info-box" style="display:block;">Đã loại ${tongNgoaiKhung} bản ghi NGOÀI khung giờ hành chính (Sáng ${khungGio.sangStart}-${khungGio.sangEnd}, Chiều ${khungGio.chieuStart}-${khungGio.chieuEnd}) — không tính công. Theo nguồn: Bảng kê chi phí ${ngoaiKhungBySource['1-ChiPhi']} · Sổ kết quả CLS ${ngoaiKhungBySource['2-CLS']} · Sổ thủ thuật ${ngoaiKhungBySource['3-ThuThuat']}.</div>`;
  }
  if (possibleNonDoctor && possibleNonDoctor.length) {
    html += `<div class="info-box" style="display:block;">${possibleNonDoctor.length} người chỉ từng xuất hiện ở vai trò phụ (Gây mê/TTV phụ), chưa từng đứng tên TTV chính/BS — có thể là kỹ thuật viên chứ không phải bác sĩ, cần xác minh lại: ${possibleNonDoctor.map(escapeHtml).join(', ')}.</div>`;
  }

  // ---- Chấm công BS theo ngày (ma trận: mỗi ô 1 / 0,5 / trống theo ca) ----
  html += `<div class="panel"><h3>Chấm công BS theo ngày</h3><p class="muted" style="margin-top:0;">Mỗi ô: <b>1</b> = đủ công (có mặt cả sáng và chiều), <b>0,5</b> = nửa công (chỉ 1 buổi), để trống = không có ca. Chỉ tính bản ghi trong khung giờ hành chính.</p><div class="matrix-wrap"><table><thead><tr>
    <th>Họ tên</th><th>Ngày đủ (1)</th><th>Nửa ngày (0,5)</th><th>Tổng công</th><th>Cảnh báo CAO</th>`;
  for (let d = 1; d <= daysInMonth; d++) html += `<th>${pad2(d)}</th>`;
  html += `</tr></thead><tbody>`;
  const perPersonCong = new Map(); // person -> { full, half, total }
  for (const person of persons) {
    let full = 0, half = 0, nHighWarn = 0;
    let rowCells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
      const cong = attendance.congMap.get(`${person}|${dateKey}`);
      const isWarn = warnCaoCells.has(`${person}|${dateKey}`);
      if (isWarn) nHighWarn++;
      if (cong === 1) { full++; rowCells += `<td${isWarn ? ' class="cell-warn"' : ''}>1</td>`; }
      else if (cong === 0.5) { half++; rowCells += `<td${isWarn ? ' class="cell-warn"' : ''}>0,5</td>`; }
      else { rowCells += `<td${isWarn ? ' class="cell-warn"' : ''}></td>`; }
    }
    const total = full + half * 0.5;
    perPersonCong.set(person, { full, half, total });
    html += `<tr><td>${escapeHtml(reg.displayName(person))}</td><td>${full}</td><td>${half}</td><td>${String(total).replace('.', ',')}</td><td>${nHighWarn ? `<span class="pill pill-cao">${nHighWarn}</span>` : '0'}</td>${rowCells}</tr>`;
  }
  html += `</tbody></table></div></div>`;

  // ---- Chấm công ngày (tổng hợp theo bác sĩ, không phân ca) ----
  html += `<div class="panel"><h3>Chấm công ngày (tổng hợp)</h3><p class="muted" style="margin-top:0;">Bảng rút gọn để chốt công cuối tháng — số liệu suy ra từ bảng "Chấm công BS" ở trên.</p><table><thead><tr><th>Họ tên</th><th>Ngày đủ (1)</th><th>Nửa ngày (0,5)</th><th>Tổng công</th></tr></thead><tbody>`;
  let grandFull = 0, grandHalf = 0, grandTotal = 0;
  for (const person of persons) {
    const c = perPersonCong.get(person);
    grandFull += c.full; grandHalf += c.half; grandTotal += c.total;
    html += `<tr><td>${escapeHtml(reg.displayName(person))}</td><td>${c.full}</td><td>${c.half}</td><td>${String(c.total).replace('.', ',')}</td></tr>`;
  }
  html += `<tr style="font-weight:700;"><td>TỔNG</td><td>${grandFull}</td><td>${grandHalf}</td><td>${String(grandTotal).replace('.', ',')}</td></tr>`;
  html += `</tbody></table></div>`;

  // ---- Chấm công chi tiết (giờ sớm nhất - muộn nhất mỗi ngày, chỉ trong khung) ----
  html += `<div class="panel"><h3>Chấm công chi tiết theo ngày</h3><p class="muted" style="margin-top:0;">Mỗi ô: giờ SỚM NHẤT - MUỘN NHẤT trong khung giờ hành chính, ghi nhận được từ dữ liệu 3 file, trong ngày đó.</p><div class="matrix-wrap"><table><thead><tr>
    <th>Họ tên</th><th>Số ngày công</th><th>Số lượt HĐ</th><th>Vai trò ghi nhận</th>`;
  for (let d = 1; d <= daysInMonth; d++) html += `<th>${pad2(d)}</th>`;
  html += `</tr></thead><tbody>`;
  for (const person of persons) {
    let nDays = 0, nEvents = 0;
    const roles = new Set();
    let rowCells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
      const evs = byPersonDayAtt.get(`${person}|${dateKey}`);
      const isWarn = warnCaoCells.has(`${person}|${dateKey}`);
      if (evs && evs.length) {
        nDays++; nEvents += evs.length;
        evs.forEach((e) => roles.add(e.role));
        const times = evs.map((e) => e.start);
        const cellTxt = `${hhmm(new Date(Math.min(...times.map((t) => t.getTime()))))}-${hhmm(new Date(Math.max(...times.map((t) => t.getTime()))))}`;
        rowCells += `<td${isWarn ? ' class="cell-warn"' : ''}>${cellTxt}</td>`;
      } else {
        rowCells += `<td${isWarn ? ' class="cell-warn"' : ''}></td>`;
      }
    }
    html += `<tr><td>${escapeHtml(reg.displayName(person))}</td><td>${nDays}</td><td>${nEvents}</td><td><span class="badge-role">${escapeHtml([...roles].sort().join(', '))}</span></td>${rowCells}</tr>`;
  }
  html += `</tbody></table></div></div>`;

  // ---- Cảnh báo đang hoạt động ----
  const sevOrder = { CAO: 0, 'TRUNG BÌNH': 1 };
  const sortWarnings = (list) => list.slice().sort((a, b) => (sevOrder[a.sev] - sevOrder[b.sev]) || a.dateKey.localeCompare(b.dateKey) || reg.displayName(a.person).localeCompare(reg.displayName(b.person), 'vi'));
  const activeSorted = sortWarnings(activeWarnings);
  html += `<div class="panel"><h3>Cảnh báo đang hoạt động (${activeWarnings.length})</h3>
    <p class="muted" style="margin-top:0;">Kiểm tra xong 1 dòng: bấm <b>"✓ Xác nhận lỗi"</b> nếu đúng là bất thường (vẫn tiếp tục cảnh báo các tháng sau) hoặc <b>"✕ Bỏ qua"</b> kèm lý do nếu đây là tình huống bình thường (từ tháng sau sẽ không cảnh báo lại cho đúng người + đúng loại cảnh báo này nữa).</p>`;
  if (activeSorted.length === 0) {
    html += `<p class="muted">Không có cảnh báo nào đang hoạt động.</p>`;
  } else {
    html += `<table><thead><tr><th style="width:90px;">Mức độ</th><th style="width:190px;">Loại cảnh báo</th><th style="width:140px;">Họ tên</th><th style="width:85px;">Ngày</th><th>Chi tiết</th><th style="width:230px;">Xem xét</th></tr></thead><tbody>`;
    activeSorted.forEach((w, idx) => {
      const pillClass = w.sev === 'CAO' ? 'pill-cao' : 'pill-tb';
      let reviewCell;
      if (w.review && w.review.decision === 'error') {
        reviewCell = `<span class="pill pill-cao">✓ Đã xác nhận lỗi</span><br><span class="muted">${escapeHtml(w.review.reviewed_by)}</span> <span class="del-row" data-act="undo" data-idx="${idx}" title="Huỷ xác nhận">✕</span>`;
      } else {
        reviewCell = `<button class="btn btn-sm" data-act="confirm" data-idx="${idx}">✓ Xác nhận lỗi</button> <button class="btn btn-sm" data-act="dismiss" data-idx="${idx}">✕ Bỏ qua</button>`;
      }
      html += `<tr><td><span class="pill ${pillClass}">${w.sev}</span></td><td>${escapeHtml(w.cat)}</td><td>${escapeHtml(reg.displayName(w.person))}</td><td>${ddmmyyyy(w.dateKey)}</td><td>${escapeHtml(w.detail)}</td><td>${reviewCell}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // ---- Đã xem xét & bỏ qua ----
  if (dismissedWarnings.length) {
    const dismissedSorted = sortWarnings(dismissedWarnings);
    html += `<div class="panel"><h3>Đã xem xét &amp; bỏ qua (${dismissedWarnings.length})</h3>
      <p class="muted" style="margin-top:0;">Các cảnh báo này đã được người phụ trách kiểm tra và xác nhận là bình thường — không tính vào số liệu ở trên. Bấm "↺" nếu muốn đánh giá lại.</p>
      <table><thead><tr><th style="width:190px;">Loại cảnh báo</th><th style="width:140px;">Họ tên</th><th style="width:85px;">Ngày</th><th>Chi tiết</th><th>Lý do bỏ qua</th><th style="width:60px;"></th></tr></thead><tbody>`;
    dismissedSorted.forEach((w, idx) => {
      html += `<tr><td>${escapeHtml(w.cat)}</td><td>${escapeHtml(reg.displayName(w.person))}</td><td>${ddmmyyyy(w.dateKey)}</td><td>${escapeHtml(w.detail)}</td><td>${escapeHtml(w.review.note || '')}<br><span class="muted">${escapeHtml(w.review.reviewed_by)}</span></td><td><span class="del-row" data-act="undo-dismiss" data-idx="${idx}" title="Đánh giá lại">↺</span></td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  $('#results-wrap').innerHTML = html;
  $('#btn-export-excel').addEventListener('click', () => exportExcel(result));

  $('#results-wrap').querySelectorAll('[data-act="confirm"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const w = activeSorted[Number(btn.dataset.idx)];
      await setReviewDecision(w.person, reg.displayName(w.person), w.cat, 'error', null);
    });
  });
  $('#results-wrap').querySelectorAll('[data-act="dismiss"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const w = activeSorted[Number(btn.dataset.idx)];
      const note = prompt(`Lý do bỏ qua cảnh báo "${w.cat}" cho ${reg.displayName(w.person)}?\n(Bắt buộc nhập — từ tháng sau sẽ không cảnh báo lại loại này cho người này nữa)`);
      if (note === null) return;
      if (!note.trim()) { alert('Cần nhập lý do để bỏ qua cảnh báo.'); return; }
      await setReviewDecision(w.person, reg.displayName(w.person), w.cat, 'dismissed', note);
    });
  });
  $('#results-wrap').querySelectorAll('[data-act="undo"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const w = activeSorted[Number(el.dataset.idx)];
      await deleteReviewDecision(w.person, w.cat);
    });
  });
  $('#results-wrap').querySelectorAll('[data-act="undo-dismiss"]').forEach((el) => {
    el.addEventListener('click', async () => {
      const w = sortWarnings(dismissedWarnings)[Number(el.dataset.idx)];
      await deleteReviewDecision(w.person, w.cat);
    });
  });
}

// ---------------------------------------------------------------------------
// XUẤT EXCEL (6 sheet, dữ liệu thuần — không tô màu, giống quy ước xuất Excel
// hiện có của module Chia thủ thuật)
// ---------------------------------------------------------------------------
function exportExcel(result) {
  const { events, warnings, month, year, reg, missingPerformer, outOfScopeCount, khungGio, ngoaiKhungBySource, attendance, possibleNonDoctor } = result;
  const daysInMonth = new Date(year, month, 0).getDate();
  const persons = [...new Set(events.map((e) => e.person))].sort((a, b) => reg.displayName(a).localeCompare(reg.displayName(b), 'vi'));
  const byPersonDayAtt = groupByPersonDay(attendance.attendanceEvents);
  for (const w of warnings) w.review = reviewsMap.get(reviewKey(w.person, w.cat)) || null;
  const warnCaoCells = new Set(warnings.filter((w) => w.sev === 'CAO' && !(w.review && w.review.decision === 'dismissed')).map((w) => `${w.person}|${w.dateKey}`));
  const tongNgoaiKhung = ngoaiKhungBySource['1-ChiPhi'] + ngoaiKhungBySource['2-CLS'] + ngoaiKhungBySource['3-ThuThuat'];

  const perPersonCong = new Map();
  for (const person of persons) {
    let full = 0, half = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const cong = attendance.congMap.get(`${person}|${year}-${pad2(month)}-${pad2(d)}`);
      if (cong === 1) full++;
      else if (cong === 0.5) half++;
    }
    perPersonCong.set(person, { full, half, total: full + half * 0.5 });
  }

  // Sheet 1 — Chấm công BS (ma trận theo ngày, mỗi ô 1 / 0,5 / trống)
  const s1 = [];
  s1.push([`CHẤM CÔNG BS THEO NGÀY - THÁNG ${pad2(month)}/${year} - PHÒNG KHÁM ĐA KHOA VIỆT PHÁP`]);
  s1.push([`Khung giờ hành chính: Sáng ${khungGio.sangStart}-${khungGio.sangEnd}, Chiều ${khungGio.chieuStart}-${khungGio.chieuEnd}. Mỗi ô: 1 = đủ công (sáng+chiều), 0,5 = nửa công (1 buổi), trống = không có ca. Bản ghi ngoài khung giờ đã bị loại, không tính công — xem sheet 6.GhiChu.`]);
  s1.push([]);
  const header1 = ['Họ tên', 'Ngày đủ (1)', 'Nửa ngày (0,5)', 'Tổng công', 'Cảnh báo CAO'];
  for (let d = 1; d <= daysInMonth; d++) header1.push(pad2(d));
  s1.push(header1);
  for (const person of persons) {
    const { full, half, total } = perPersonCong.get(person);
    let nHighWarn = 0;
    const dayCells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
      const cong = attendance.congMap.get(`${person}|${dateKey}`);
      if (warnCaoCells.has(`${person}|${dateKey}`)) nHighWarn++;
      dayCells.push(cong === 1 ? 1 : cong === 0.5 ? '0,5' : '');
    }
    s1.push([reg.displayName(person), full, half, String(total).replace('.', ','), nHighWarn, ...dayCells]);
  }

  // Sheet 2 — Chấm công ngày (tổng hợp, không phân ca) + dòng TỔNG
  const s1b = [];
  s1b.push([`CHẤM CÔNG NGÀY (TỔNG HỢP) - THÁNG ${pad2(month)}/${year} - PHÒNG KHÁM ĐA KHOA VIỆT PHÁP`]);
  s1b.push(['Bảng rút gọn để chốt công cuối tháng — số liệu suy ra từ sheet "1.ChamCongBS".']);
  s1b.push([]);
  s1b.push(['Họ tên', 'Ngày đủ (1)', 'Nửa ngày (0,5)', 'Tổng công']);
  let grandFull = 0, grandHalf = 0, grandTotal = 0;
  for (const person of persons) {
    const { full, half, total } = perPersonCong.get(person);
    grandFull += full; grandHalf += half; grandTotal += total;
    s1b.push([reg.displayName(person), full, half, String(total).replace('.', ',')]);
  }
  s1b.push(['TỔNG', grandFull, grandHalf, String(grandTotal).replace('.', ',')]);

  // Sheet 3 — Chấm công chi tiết (giờ sớm nhất - muộn nhất, chỉ trong khung)
  const s1c = [];
  s1c.push([`CHẤM CÔNG CHI TIẾT - THÁNG ${pad2(month)}/${year} - PHÒNG KHÁM ĐA KHOA VIỆT PHÁP`]);
  s1c.push(['Mỗi ô: giờ SỚM NHẤT - MUỘN NHẤT trong khung giờ hành chính, ghi nhận được từ dữ liệu 3 file, trong ngày đó.']);
  s1c.push([]);
  const header1c = ['Họ tên', 'Số ngày công', 'Số lượt hoạt động', 'Vai trò ghi nhận'];
  for (let d = 1; d <= daysInMonth; d++) header1c.push(pad2(d));
  s1c.push(header1c);
  for (const person of persons) {
    let nDays = 0, nEvents = 0;
    const roles = new Set();
    const dayCells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${pad2(month)}-${pad2(d)}`;
      const evs = byPersonDayAtt.get(`${person}|${dateKey}`);
      if (evs && evs.length) {
        nDays++; nEvents += evs.length;
        evs.forEach((e) => roles.add(e.role));
        const times = evs.map((e) => e.start);
        dayCells.push(`${hhmm(new Date(Math.min(...times.map((t) => t.getTime()))))}-${hhmm(new Date(Math.max(...times.map((t) => t.getTime()))))}`);
      } else {
        dayCells.push('');
      }
    }
    s1c.push([reg.displayName(person), nDays, nEvents, [...roles].sort().join(', '), ...dayCells]);
  }

  // Sheet 4 — Chi tiết hoạt động (TẤT CẢ sự kiện, kể cả ngoài khung — có cột Ca)
  const s2 = [['Họ tên', 'Ngày', 'Giờ bắt đầu', 'Giờ kết thúc', 'Ca', 'Vai trò', 'Nguồn dữ liệu', 'Mã bệnh nhân/KCB', 'Khoa/Phòng', 'Nội dung']];
  const CA_LABEL = { sang: 'Sáng', chieu: 'Chiều', ngoai_khung: 'Ngoài khung' };
  const eventsSorted = events.slice().sort((a, b) => reg.displayName(a.person).localeCompare(reg.displayName(b.person), 'vi') || a.dateKey.localeCompare(b.dateKey) || (a.start && b.start ? a.start - b.start : 0));
  for (const e of eventsSorted) {
    s2.push([reg.displayName(e.person), ddmmyyyy(e.dateKey), e.start ? hhmm(e.start) : '', e.end ? hhmm(e.end) : '', CA_LABEL[e.buoi] || '', e.role, e.source, e.patient ? String(e.patient) : '', e.dept || '', e.detail || '']);
  }

  // Sheet 5 — bao gồm CẢ cảnh báo đã bỏ qua (có ghi rõ trạng thái + lý do) để
  // giữ đầy đủ dấu vết audit, không âm thầm biến mất khỏi hồ sơ xuất ra.
  const s3 = [['Mức độ', 'Loại cảnh báo', 'Họ tên', 'Ngày', 'Chi tiết', 'Trạng thái xem xét', 'Lý do / người xem xét', 'Khuyến nghị xử lý']];
  const RECOMMEND = {
    'Trùng giờ giữa y lệnh/CLS và thủ thuật': 'Kiểm tra lại người thực hiện thực tế (có thể do nhân viên khác ký thay/nhập hộ). Đính chính dữ liệu trước khi quyết toán BHYT.',
    'Ghi giờ đồng thời nhiều bệnh nhân': 'Kiểm tra có phải nhập liệu hàng loạt (backdate) hay không. Nếu là thao tác nhập liệu (không phải giờ khám thực), cần chỉnh quy trình nhập liệu để đúng thời gian thực tế.',
    'Thời gian xử lý/BN quá ngắn': 'Rà soát khả năng đảm bảo thời gian khám/đọc KQ tối thiểu theo quy định chuyên môn; nguy cơ BHXH xuất toán khi giám định hồ sơ.',
  };
  const sevOrder = { CAO: 0, 'TRUNG BÌNH': 1 };
  const warningsSorted = warnings.slice().sort((a, b) => (sevOrder[a.sev] - sevOrder[b.sev]) || a.dateKey.localeCompare(b.dateKey) || reg.displayName(a.person).localeCompare(reg.displayName(b.person), 'vi'));
  for (const w of warningsSorted) {
    const trangThai = w.review ? (w.review.decision === 'dismissed' ? 'Đã bỏ qua' : 'Đã xác nhận lỗi') : 'Chưa xem xét';
    const lyDo = w.review ? `${w.review.note ? w.review.note + ' — ' : ''}${w.review.reviewed_by}` : '';
    s3.push([w.sev, w.cat, reg.displayName(w.person), ddmmyyyy(w.dateKey), w.detail, trangThai, lyDo, RECOMMEND[w.cat] || 'Rà soát lại hồ sơ liên quan.']);
  }
  const activeForCount = warnings.filter((w) => !(w.review && w.review.decision === 'dismissed'));
  const nCao = activeForCount.filter((w) => w.sev === 'CAO').length;
  const nTb = activeForCount.filter((w) => w.sev === 'TRUNG BÌNH').length;
  const nDismissed = warnings.length - activeForCount.length;
  s3.push([]);
  s3.push([`Đang hoạt động: ${activeForCount.length} (Cao: ${nCao} | Trung bình: ${nTb})  ·  Đã xem xét & bỏ qua: ${nDismissed}  ·  Tổng phát hiện: ${warnings.length}`]);

  // Sheet 6 — Ghi chú
  const s4lines = [
    'BẢNG CHẤM CÔNG Y SĨ - BÁC SĨ - GHI CHÚ PHƯƠNG PHÁP & CĂN CỨ PHÁP LÝ', '',
    '1. NGUỒN DỮ LIỆU',
    "  - File 1 (Bảng kê chi phí chi tiết): cột 'BacSi' (người kê đơn/ra y lệnh), cột 'Ngay_YL' (thời điểm ra y lệnh).",
    "  - File 2 (Sổ kết quả CLS theo bác sĩ): 'BS chỉ định' xét theo cột 'Ngày lập'; 'Bs đọc kết quả' xét theo cột 'Ngày làm' — mỗi vai trò CHỈ dùng đúng 1 cột được quy định, không lấy chéo/dự phòng cột kia.",
    "  - File 3 (Sổ thủ thuật): thời gian lấy từ cột 'Ngày/giờ TT' (dạng DD/MM/YYYY HH:MM-HH:MM). Chỉ tính công cho TTV chính, TTV phụ, Gây mê chính — cột 'Giúp việc' KHÔNG được tính.", '',
    '2. QUY TẮC CHẤM CÔNG THEO CA (BẮT BUỘC)',
    `  - Khung giờ hành chính đang áp dụng: Sáng ${khungGio.sangStart}-${khungGio.sangEnd}, Chiều ${khungGio.chieuStart}-${khungGio.chieuEnd} (tính cả 2 mốc biên) — có thể chỉnh ở trang web trước khi xuất lại.`,
    '  - 1 bác sĩ được tính 1 ca ở 1 buổi trong ngày nếu có ít nhất 1 bản ghi (từ bất kỳ nguồn nào) rơi trong khung giờ của buổi đó. Nhiều bản ghi cùng buổi vẫn chỉ tính 1 ca.',
    '  - Với Sổ thủ thuật (có giờ bắt đầu-kết thúc): CẢ HAI mốc phải cùng nằm trong 1 khung mới tính ca đó — thủ thuật lấn qua giờ nghỉ trưa hoặc ngoài giờ hành chính bị loại hoàn toàn.',
    `  - Bản ghi ngoài khung giờ bị loại, không tính công. Tổng cộng đã loại ${tongNgoaiKhung} bản ghi (Bảng kê chi phí: ${ngoaiKhungBySource['1-ChiPhi']} · Sổ kết quả CLS: ${ngoaiKhungBySource['2-CLS']} · Sổ thủ thuật: ${ngoaiKhungBySource['3-ThuThuat']}) — các dòng này vẫn giữ trong sheet 4.ChiTietHoatDong, đánh dấu "Ngoài khung" ở cột Ca, không bị xoá.`,
    '  - 1 ca = 0,5 công. Đủ sáng và chiều trong ngày = 1 công; chỉ 1 buổi = 0,5 công; không có ca = để trống.',
    '  - So khớp tên bác sĩ bỏ khoảng trắng thừa, không phân biệt hoa/thường.', '',
    '3. GIẢ ĐỊNH XỬ LÝ KHÁC (CẦN NGƯỜI PHỤ TRÁCH NHÂN SỰ XÁC NHẬN LẠI)',
    "  - KHÔNG cảnh báo khi 1 người GIÁM SÁT nhiều thủ thuật đông y cùng lúc (vai trò 'Gây mê') hoặc ĐỌC KẾT QUẢ XÉT NGHIỆM nhiều bệnh nhân cùng lúc ('BS đọc KQ CLS') — đây là nghiệp vụ bình thường của phòng khám, không phải dấu hiệu sai lệch.",
    `  - Trong file Sổ thủ thuật, cột 'TTV chính' phần lớn để trống và tên người thực hiện thực tế lại nằm ở cột 'TTV phụ' (${missingPerformer} dòng không xác định được người thực hiện rõ ràng). Công cụ tự động dùng 'TTV phụ' làm người thực hiện chính khi 'TTV chính' bỏ trống.`,
    `  - Đã loại ${outOfScopeCount || 0} sự kiện rơi ra ngoài tháng ${pad2(month)}/${year} khỏi toàn bộ báo cáo này (thường do file 'chi phí chi tiết' kèm vài dòng gối đầu từ kỳ trước) — chỉ giữ lại đúng phạm vi 1 tháng để không lẫn dữ liệu ngoài kỳ.`,
    possibleNonDoctor && possibleNonDoctor.length
      ? `  - ${possibleNonDoctor.length} người chỉ từng xuất hiện ở vai trò phụ (Gây mê/TTV phụ), chưa từng đứng tên TTV chính/BS — có thể là kỹ thuật viên chứ không phải bác sĩ, cần xác minh: ${possibleNonDoctor.join(', ')}.`
      : '  - Không phát hiện nhân sự nào chỉ có vai trò phụ (Gây mê/TTV phụ) — danh sách chấm công có vẻ đều là người trực tiếp khám/thực hiện.',
    '  - Nếu có 2 người trùng tên hoàn toàn, công cụ sẽ gộp nhầm thành 1 người — cần bổ sung mã nhân viên/SĐT để tách riêng nếu xảy ra.', '',
    '4. ĐỐI CHIẾU',
    `  - Tổng công sheet "2.ChamCongNgay" (${String(grandTotal).replace('.', ',')}) phải bằng tổng cột "Tổng công" của sheet "1.ChamCongBS" — 2 sheet tính từ cùng 1 nguồn dữ liệu nên luôn khớp.`, '',
    '5. CĂN CỨ PHÁP LÝ / QUY ĐỊNH THAM CHIẾU (BHYT)',
    '  - Luật BHYT 2008 (sửa đổi, bổ sung 2014, 2024) và Nghị định 146/2018/NĐ-CP: quy định điều kiện thanh toán chi phí KCB BHYT, trách nhiệm của cơ sở KCB trong ghi chép, lưu trữ hồ sơ làm căn cứ quyết toán.',
    '  - Thông tư 09/2019/TT-BYT và các văn bản hướng dẫn giám định BHYT: cơ quan BHXH có thể từ chối/xuất toán các dịch vụ có dấu hiệu trùng giờ, thời gian thực hiện không đảm bảo tối thiểu, ngoài giờ hành chính không đúng quy định, hoặc hồ sơ thiếu thông tin người thực hiện.',
    '  - Để phòng tránh nguy cơ xuất toán: đối chiếu dữ liệu HIS với máy chấm công / lịch trực / chữ ký bác sĩ trước khi gửi hồ sơ đề nghị thanh toán BHYT hàng tháng, đặc biệt với các dòng mức CAO trong sheet 5.CanhBao.',
  ];
  const s4 = s4lines.map((line) => [line]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), '1.ChamCongBS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1b), '2.ChamCongNgay');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1c), '3.ChamCongChiTiet');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), '4.ChiTietHoatDong');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s3), '5.CanhBao');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s4), '6.GhiChu');
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
