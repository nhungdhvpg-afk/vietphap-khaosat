// Ghi nhớ quyết định xem xét cảnh báo của module Bảng chấm công — theo cặp
// (người, loại cảnh báo), KHÔNG theo ngày cụ thể (vì file mới mỗi tháng có
// ngày khác nhau, nhưng cùng 1 người + cùng 1 loại cảnh báo lặp lại thì
// quyết định trước đó vẫn nên áp dụng). Không chứa dữ liệu bệnh nhân/BHYT
// nên được phép lưu ở server — khác với báo cáo gốc (chỉ xử lý client-side).
//
// GET: trả về toàn bộ quyết định đã lưu (để trang tự áp dụng khi tính cảnh báo).
// POST action=set: tạo/cập nhật 1 quyết định (upsert theo person_key+category).
// POST action=delete: xoá 1 quyết định (quay lại trạng thái "chưa xem xét").
// Bất kỳ ai vào được module này (canAccessChamCong) đều được set/delete — đây
// là công việc thường xuyên của người phụ trách hàng tháng, không cần CEO.
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest, canAccessChamCong } = require('./_lib/auth');

module.exports = async (req, res) => {
  const staffAcct = await getStaffFromRequest(req);
  if (!staffAcct) {
    res.status(401).json({ error: 'Chưa đăng nhập.' });
    return;
  }
  if (!canAccessChamCong(staffAcct)) {
    res.status(403).json({ error: 'Tài khoản này không có quyền vào module Bảng chấm công.' });
    return;
  }
  const db = getSupabaseAdmin();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('cham_cong_warning_reviews')
      .select('id, person_key, person_display, category, decision, note, reviewed_by, reviewed_at')
      .order('reviewed_at', { ascending: false });
    if (error) {
      console.error('cham-cong-reviews GET error', error);
      res.status(500).json({ error: 'Không tải được danh sách quyết định đã xem xét.' });
      return;
    }
    res.status(200).json({ reviews: data });
    return;
  }

  if (req.method === 'POST') {
    try {
      const { action, payload } = req.body || {};

      if (action === 'set') {
        const { person_key, person_display, category, decision, note } = payload || {};
        if (!person_key || !category || !['error', 'dismissed'].includes(decision)) {
          res.status(400).json({ error: 'Thiếu person_key/category hoặc decision không hợp lệ.' });
          return;
        }
        if (decision === 'dismissed' && !String(note || '').trim()) {
          res.status(400).json({ error: 'Bắt buộc nhập lý do khi bỏ qua cảnh báo.' });
          return;
        }
        const { error } = await db.from('cham_cong_warning_reviews').upsert({
          person_key,
          person_display: person_display || person_key,
          category,
          decision,
          note: note ? String(note).trim() : null,
          reviewed_by: staffAcct.email,
          reviewed_at: new Date().toISOString(),
        }, { onConflict: 'person_key,category' });
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'delete') {
        const { person_key, category } = payload || {};
        if (!person_key || !category) {
          res.status(400).json({ error: 'Thiếu person_key/category.' });
          return;
        }
        const { error } = await db.from('cham_cong_warning_reviews').delete().eq('person_key', person_key).eq('category', category);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'Hành động không hợp lệ.' });
    } catch (e) {
      console.error('cham-cong-reviews POST error', e);
      res.status(500).json({ error: 'Không thực hiện được: ' + (e.message || '') });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
