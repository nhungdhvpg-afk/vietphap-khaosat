// Quản lý tài khoản đăng nhập cho module Bảng chấm công (bảng staff_accounts,
// dùng chung hạ tầng đăng nhập với module Khảo sát/Chia thủ thuật, nhưng
// role='cham_cong_staff' là RIÊNG cho module này). GET: xem danh sách (CEO
// hoặc người được cấp quyền quản lý module này). POST: tạo tài khoản mới /
// đổi quyền / xoá — CHỈ CEO, để tránh 1 người tự nâng quyền cho mình.
//
// Endpoint này CHỈ tạo/sửa tài khoản role='cham_cong_staff' — không đụng tới
// tài khoản ceo/department_head/ctt_staff (những vai trò đó quản lý ở màn
// hình Cài đặt của module tương ứng).
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');

function randomTempPassword() {
  // Mật khẩu tạm 12 ký tự, bỏ các ký tự dễ nhầm lẫn (0/O, 1/l/I) để đọc/gõ lại dễ hơn.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

module.exports = async (req, res) => {
  const staffAcct = await getStaffFromRequest(req);
  if (!staffAcct) {
    res.status(401).json({ error: 'Chưa đăng nhập.' });
    return;
  }
  const db = getSupabaseAdmin();

  if (req.method === 'GET') {
    // Chỉ CEO xem được danh sách tài khoản/email — kể cả người có quyền
    // cham_cong_manager (chỉnh Cài đặt module này) cũng không xem được, vì
    // đây là dữ liệu tài khoản đăng nhập của người khác.
    if (staffAcct.role !== 'ceo') {
      res.status(403).json({ error: 'Chỉ CEO mới xem được danh sách tài khoản.' });
      return;
    }
    const { data, error } = await db
      .from('staff_accounts')
      .select('id, email, role, cham_cong_manager, created_at')
      .eq('role', 'cham_cong_staff')
      .order('created_at');
    if (error) {
      console.error('cham-cong-accounts GET error', error);
      res.status(500).json({ error: 'Không tải được danh sách tài khoản.' });
      return;
    }
    res.status(200).json({ accounts: data });
    return;
  }

  if (req.method === 'POST') {
    if (staffAcct.role !== 'ceo') {
      res.status(403).json({ error: 'Chỉ CEO mới được tạo tài khoản hoặc thay đổi quyền — tránh trường hợp người khác tự nâng quyền.' });
      return;
    }
    try {
      const { action, payload } = req.body || {};

      if (action === 'create_account') {
        const { email, cham_cong_manager } = payload || {};
        const cleanEmail = String(email || '').trim().toLowerCase();
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          res.status(400).json({ error: 'Email không hợp lệ.' });
          return;
        }

        const tempPassword = randomTempPassword();
        const { data: created, error: createErr } = await db.auth.admin.createUser({
          email: cleanEmail,
          password: tempPassword,
          email_confirm: true,
        });
        if (createErr) throw createErr;

        const { error: insertErr } = await db.from('staff_accounts').insert({
          id: created.user.id,
          email: cleanEmail,
          role: 'cham_cong_staff',
          department: null,
          cham_cong_manager: !!cham_cong_manager,
        });
        if (insertErr) {
          // Lỡ tạo user Auth rồi mà không lưu được vào staff_accounts -> xoá
          // lại user đó để không để lại tài khoản "vô chủ".
          await db.auth.admin.deleteUser(created.user.id).catch(() => {});
          throw insertErr;
        }

        res.status(200).json({ email: cleanEmail, tempPassword });
        return;
      }

      if (action === 'update_permission') {
        const { id, cham_cong_manager } = payload || {};
        if (!id) {
          res.status(400).json({ error: 'Thiếu id tài khoản.' });
          return;
        }
        const { error } = await db
          .from('staff_accounts')
          .update({ cham_cong_manager: !!cham_cong_manager })
          .eq('id', id)
          .eq('role', 'cham_cong_staff');
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'delete_account') {
        const { id } = payload || {};
        if (!id) {
          res.status(400).json({ error: 'Thiếu id tài khoản.' });
          return;
        }
        if (id === staffAcct.id) {
          res.status(400).json({ error: 'Không thể tự xoá tài khoản đang đăng nhập của chính mình.' });
          return;
        }
        await db.from('staff_accounts').delete().eq('id', id).eq('role', 'cham_cong_staff');
        await db.auth.admin.deleteUser(id).catch(() => {});
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'Hành động không hợp lệ.' });
    } catch (e) {
      console.error('cham-cong-accounts POST error', e);
      const msg = /already.*registered|duplicate/i.test(e.message || '') ? 'Email này đã có tài khoản.' : 'Không thực hiện được: ' + (e.message || '');
      res.status(500).json({ error: msg });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
