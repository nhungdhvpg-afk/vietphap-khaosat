const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');

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

  const { id, resolved } = req.body || {};
  if (!id || typeof resolved !== 'boolean') {
    res.status(400).json({ error: 'Thiếu dữ liệu' });
    return;
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: row, error: fetchError } = await supabaseAdmin
      .from('survey_responses')
      .select('id, department')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy phản hồi' });
      return;
    }
    if (staff.role !== 'ceo' && row.department !== staff.department) {
      res.status(403).json({ error: 'Không có quyền với khoa này' });
      return;
    }

    const resolvedBy = resolved ? (staff.role === 'ceo' ? 'CEO' : `Trưởng khoa ${staff.department}`) : null;
    const { error: updateError } = await supabaseAdmin
      .from('survey_responses')
      .update({
        resolved,
        resolved_by: resolvedBy,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq('id', id);
    if (updateError) throw updateError;

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('resolve-flag error', e);
    res.status(500).json({ error: 'Không cập nhật được' });
  }
};
