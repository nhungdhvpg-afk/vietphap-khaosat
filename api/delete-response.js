const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');

// Chỉ CEO được xoá — trưởng khoa không có quyền xoá dữ liệu, kể cả khoa mình.
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

  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'Thiếu id' });
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.from('survey_responses').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('delete-response error', e);
    res.status(500).json({ error: 'Không xoá được' });
  }
};
