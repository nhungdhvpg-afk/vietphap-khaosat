const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');

// Chỉ CEO được xoá hàng loạt — xoá theo khoảng thời gian client đang lọc trên dashboard
// (from/to giống hệt tham số dùng ở /api/dashboard-data), không truyền gì = xoá toàn bộ.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const staff = await getStaffFromRequest(req);
  if (!staff) {
    res.status(401).json({ error: 'Chưa đăng nhập hoặc tài khoản chưa được gán vai trò.' });
    return;
  }
  if (staff.role !== 'ceo') {
    res.status(403).json({ error: 'Chỉ CEO mới có quyền xoá dữ liệu.' });
    return;
  }

  try {
    const { from, to } = req.body || {};
    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin.from('survey_responses').delete().select('id');
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (!from && !to) {
      // Không có điều kiện lọc nào (chọn "Toàn bộ") — thêm điều kiện luôn đúng
      // để tường minh rằng đây là xoá tất cả, có chủ đích.
      query = query.not('created_at', 'is', null);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json({ ok: true, deleted: (data || []).length });
  } catch (e) {
    console.error('delete-all-responses error', e);
    res.status(500).json({ error: 'Không xoá được' });
  }
};
