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
    .select('role, department')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (staffError || !staff) return null;

  return staff; // { role, department }
}

module.exports = { getStaffFromRequest };
