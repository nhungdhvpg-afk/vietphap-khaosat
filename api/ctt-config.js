// Quản lý cấu hình module Chia thủ thuật: nhân sự, máy móc, cài đặt ca làm
// việc, người trông cố định. GET để tải toàn bộ cấu hình cho màn hình
// "Cài đặt"; POST để thêm/sửa (action-based, xem các nhánh bên dưới).
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest, isCttManager } = require('./_lib/auth');
const { loadCttConfig } = require('./_lib/cttConfig');

module.exports = async (req, res) => {
  const staffAcct = await getStaffFromRequest(req);
  if (!staffAcct) {
    res.status(401).json({ error: 'Chưa đăng nhập.' });
    return;
  }

  const db = getSupabaseAdmin();

  if (req.method === 'GET') {
    // GET dùng cho MỌI người đã đăng nhập (kể cả nhân viên thường) — cần để
    // hiển thị tên nhân sự/máy/combo trong tab "Chia thủ thuật", không chỉ
    // riêng tab Cài đặt. `me` cho frontend biết có nên hiện tab Cài đặt/Quản
    // lý tài khoản hay không, KHÔNG dùng để tự cấp quyền ở phía trình duyệt —
    // mọi hành động ghi vẫn được kiểm tra lại ở POST bên dưới.
    try {
      const { raw } = await loadCttConfig();
      res.status(200).json({ ...raw, me: { role: staffAcct.role, ctt_manager: staffAcct.ctt_manager, canManage: isCttManager(staffAcct) } });
    } catch (e) {
      console.error('ctt-config GET error', e);
      res.status(500).json({ error: 'Không tải được cấu hình.' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!isCttManager(staffAcct)) {
      res.status(403).json({ error: 'Bạn không có quyền sửa Cài đặt. Chỉ CEO hoặc người được cấp quyền quản lý mới sửa được.' });
      return;
    }
    try {
      const { action, payload } = req.body || {};
      switch (action) {
        case 'upsert_staff': {
          const { id, name, role, qualification, active, note, work_days } = payload || {};
          if (!name || !['BS', 'YS', 'DD'].includes(role)) {
            res.status(400).json({ error: 'Thiếu tên hoặc vai trò không hợp lệ (BS/YS/DD).' });
            return;
          }
          if (work_days !== undefined && work_days !== null) {
            if (!Array.isArray(work_days) || work_days.length === 0 || work_days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
              res.status(400).json({ error: 'Ngày làm việc không hợp lệ — phải chọn ít nhất 1 ngày (0-6).' });
              return;
            }
          }
          const row = { name, role, qualification: qualification || null, active: active !== false, note: note || null, updated_at: new Date().toISOString() };
          // Chỉ ghi đè work_days khi payload có truyền lên (VD từ ô chọn "Ngày
          // làm việc") — các lượt gọi khác (VD chỉ bật/tắt active) không nên
          // vô tình xoá mất cấu hình ngày làm việc đã đặt trước đó.
          if (work_days !== undefined) row.work_days = work_days;
          const query = id ? db.from('ctt_staff').update(row).eq('id', id) : db.from('ctt_staff').insert(row);
          const { error } = await query;
          if (error) throw error;
          break;
        }
        case 'upsert_machine': {
          const { id, name, type, active } = payload || {};
          if (!name || !['XONG', 'CHAM'].includes(type)) {
            res.status(400).json({ error: 'Thiếu tên hoặc loại máy không hợp lệ (XONG/CHAM).' });
            return;
          }
          const row = { name, type, active: active !== false };
          const query = id ? db.from('ctt_machines').update(row).eq('id', id) : db.from('ctt_machines').insert(row);
          const { error } = await query;
          if (error) throw error;
          break;
        }
        case 'set_fixed_monitor': {
          const { procedureTypeId, staffId } = payload || {};
          if (!procedureTypeId) {
            res.status(400).json({ error: 'Thiếu procedureTypeId.' });
            return;
          }
          await db.from('ctt_procedure_fixed_monitor').delete().eq('procedure_type_id', procedureTypeId);
          if (staffId) {
            const { error } = await db.from('ctt_procedure_fixed_monitor').insert({ procedure_type_id: procedureTypeId, staff_id: staffId });
            if (error) throw error;
          }
          break;
        }
        case 'update_procedure': {
          const { id, monitor_max_patients, duration_minutes, active_minutes, monitor_minutes, active } = payload || {};
          if (!id) {
            res.status(400).json({ error: 'Thiếu id loại thủ thuật.' });
            return;
          }
          const row = { updated_at: new Date().toISOString() };
          if (monitor_max_patients != null) row.monitor_max_patients = monitor_max_patients;
          if (duration_minutes != null) row.duration_minutes = duration_minutes;
          if (active_minutes != null) row.active_minutes = active_minutes;
          if (monitor_minutes != null) row.monitor_minutes = monitor_minutes;
          if (active != null) row.active = active;
          const { error } = await db.from('ctt_procedure_types').update(row).eq('id', id);
          if (error) throw error;
          break;
        }
        case 'update_settings': {
          const updates = payload || {};
          for (const [key, value] of Object.entries(updates)) {
            const { error } = await db.from('ctt_settings').update({ value: String(value), updated_at: new Date().toISOString() }).eq('key', key);
            if (error) throw error;
          }
          break;
        }
        default:
          res.status(400).json({ error: 'Hành động không hợp lệ.' });
          return;
      }
      const { raw } = await loadCttConfig();
      res.status(200).json(raw);
    } catch (e) {
      console.error('ctt-config POST error', e);
      res.status(500).json({ error: 'Không lưu được thay đổi.' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
