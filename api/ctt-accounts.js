// Quản lý tài khoản đăng nhập cho module Chia thủ thuật (bảng staff_accounts,
// dùng chung với module Khảo sát). GET: xem danh sách (CEO hoặc người được
// cấp quyền quản lý CTT). POST: tạo tài khoản mới / đổi quyền / xoá — CHỈ
// CEO, để tránh 1 người quản lý tự nâng quyền cho mình hoặc người khác.
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');

const VALID_ROLES = ['ceo', 'department_head', 'ctt_staff'];
const DEPARTMENTS = ['Nội', 'QL bệnh Huyết áp - Tiểu đường', 'Y học cổ truyền', 'Sản', 'Nhi', 'Ngoại', 'Cấp cứu'];

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
    // ctt_manager (chỉnh Cài đặt CTT) cũng không xem được, vì đây là dữ liệu
    // tài khoản đăng nhập của người khác, nhạy cảm hơn cấu hình lịch chia.
    if (staffAcct.role !== 'ceo') {
      res.status(403).json({ error: 'Chỉ CEO mới xem được danh sách tài khoản.' });
      return;
    }
    const { data, error } = await db
      .from('staff_accounts')
      .select('id, email, role, department, ctt_manager, created_at')
      .order('created_at');
    if (error) {
      console.error('ctt-accounts GET error', error);
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
        const { email, role, department, ctt_manager } = payload || {};
        const cleanEmail = String(email || '').trim().toLowerCase();
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          res.status(400).json({ error: 'Email không hợp lệ.' });
          return;
        }
        if (!VALID_ROLES.includes(role)) {
          res.status(400).json({ error: 'Vai trò không hợp lệ.' });
          return;
        }
        if (role === 'department_head' && !DEPARTMENTS.includes(department)) {
          res.status(400).json({ error: 'Trưởng khoa cần chọn đúng 1 khoa/bộ phận hợp lệ.' });
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
          role,
          department: role === 'department_head' ? department : null,
          ctt_manager: !!ctt_manager,
        });
        if (insertErr) {
          // Lỡ tạo user Auth rồi mà không lưu được vào staff_accounts -> xoá
          // lại user đó để không để lại tài khoản "vô chủ" đăng nhập được
          // nhưng mọi API đều từ chối (getStaffFromRequest tra staff_accounts).
          await db.auth.admin.deleteUser(created.user.id).catch(() => {});
          throw insertErr;
        }

        res.status(200).json({ email: cleanEmail, tempPassword });
        return;
      }

      if (action === 'update_permission') {
        const { id, ctt_manager, role, department } = payload || {};
        if (!id) {
          res.status(400).json({ error: 'Thiếu id tài khoản.' });
          return;
        }
        const row = {};
        if (ctt_manager != null) row.ctt_manager = !!ctt_manager;
        if (role != null) {
          if (!VALID_ROLES.includes(role)) {
            res.status(400).json({ error: 'Vai trò không hợp lệ.' });
            return;
          }
          if (role === 'department_head' && !DEPARTMENTS.includes(department)) {
            res.status(400).json({ error: 'Trưởng khoa cần chọn đúng 1 khoa/bộ phận hợp lệ.' });
            return;
          }
          row.role = role;
          row.department = role === 'department_head' ? department : null;
        }
        const { error } = await db.from('staff_accounts').update(row).eq('id', id);
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
        await db.from('staff_accounts').delete().eq('id', id);
        await db.auth.admin.deleteUser(id).catch(() => {});
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'Hành động không hợp lệ.' });
    } catch (e) {
      console.error('ctt-accounts POST error', e);
      const msg = /already.*registered|duplicate/i.test(e.message || '') ? 'Email này đã có tài khoản.' : 'Không thực hiện được: ' + (e.message || '');
      res.status(500).json({ error: msg });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
