const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const staff = await getStaffFromRequest(req);
  if (!staff) {
    res.status(401).json({ error: 'Chưa đăng nhập hoặc tài khoản chưa được gán vai trò.' });
    return;
  }

  try {
    const { from, to } = req.query || {};
    const supabaseAdmin = getSupabaseAdmin();
    let query = supabaseAdmin
      .from('survey_responses')
      .select('*, referrals(*)')
      .order('created_at', { ascending: false })
      .limit(5000);

    // Trưởng khoa chỉ lấy dữ liệu khoa mình; CEO lấy toàn bộ.
    if (staff.role !== 'ceo') {
      query = query.eq('department', staff.department);
    }
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json({ staff, data });
  } catch (e) {
    console.error('dashboard-data error', e);
    res.status(500).json({ error: 'Không tải được dữ liệu' });
  }
};
