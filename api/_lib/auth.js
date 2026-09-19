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
    .select('id, email, role, department, ctt_manager')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (staffError || !staff) return null;

  return staff; // { id, email, role, department, ctt_manager }
}

/** Có quyền sửa Cài đặt của module Chia thủ thuật (nhân sự/máy móc/giờ ca...)
 * hay không: CEO luôn có toàn quyền; ngoài ra tài khoản nào được CEO đánh dấu
 * ctt_manager=true cũng được — không liên quan đến role department_head vốn
 * chỉ có ý nghĩa cho module Khảo sát. */
function isCttManager(staffAcct) {
  return !!staffAcct && (staffAcct.role === 'ceo' || staffAcct.ctt_manager === true);
}

module.exports = { getStaffFromRequest, isCttManager };
