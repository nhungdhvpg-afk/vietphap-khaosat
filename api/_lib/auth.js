const { getSupabaseAdmin } = require('./supabaseAdmin');

// Đọc token đăng nhập từ header Authorization, xác minh user, rồi tra vai trò
// (ceo / department_head) trong bảng staff_accounts. Trả về null nếu không hợp lệ.
async function getStaffFromRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData || !userData.user) return null;

  const { data: staff, error: staffError } = await supabaseAdmin
    .from('staff_accounts')
    .select('id, email, role, department, ctt_manager, cham_cong_manager')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (staffError || !staff) return null;

  return staff; // { id, email, role, department, ctt_manager, cham_cong_manager }
}

/** Có quyền sửa Cài đặt của module Chia thủ thuật (nhân sự/máy móc/giờ ca...)
 * hay không: CEO luôn có toàn quyền; ngoài ra tài khoản nào được CEO đánh dấu
 * ctt_manager=true cũng được — không liên quan đến role department_head vốn
 * chỉ có ý nghĩa cho module Khảo sát. */
function isCttManager(staffAcct) {
  return !!staffAcct && (staffAcct.role === 'ceo' || staffAcct.ctt_manager === true);
}

/** Có quyền VÀO module "Bảng chấm công" hay không: CEO luôn vào được; ngoài
 * ra tài khoản role='cham_cong_staff' hoặc được đánh dấu cham_cong_manager=true
 * cũng vào được. Một tài khoản ctt_staff/department_head thường KHÔNG vào
 * được module này (và ngược lại) — đây là điểm khác với Chia thủ thuật, nơi
 * module đó mở cho mọi tài khoản đã đăng nhập. */
function canAccessChamCong(staffAcct) {
  return !!staffAcct && (staffAcct.role === 'ceo' || staffAcct.role === 'cham_cong_staff' || staffAcct.cham_cong_manager === true);
}

/** Có quyền sửa Cài đặt (ngưỡng cảnh báo, quản lý tài khoản) của module
 * "Bảng chấm công" hay không: CEO luôn có toàn quyền. */
function isChamCongManager(staffAcct) {
  return !!staffAcct && (staffAcct.role === 'ceo' || staffAcct.cham_cong_manager === true);
}

module.exports = { getStaffFromRequest, isCttManager, canAccessChamCong, isChamCongManager };
