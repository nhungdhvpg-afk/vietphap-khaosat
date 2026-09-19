// Tải toàn bộ cấu hình module Chia thủ thuật từ Supabase và chuyển sang đúng
// định dạng mà api/_lib/cttScheduler.js cần (procedures dạng object theo
// code, gắn sẵn fixed_monitor_staff_id, shifts dạng phút từ 00:00...).
const { getSupabaseAdmin } = require('./supabaseAdmin');

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

async function loadCttConfig() {
  const db = getSupabaseAdmin();

  const [{ data: staffRows, error: e1 }, { data: machineRows, error: e2 }, { data: procRows, error: e3 }, { data: fixedMonitorRows, error: e4 }, { data: comboRows, error: e5 }, { data: settingRows, error: e6 }] = await Promise.all([
    db.from('ctt_staff').select('*').order('name'),
    db.from('ctt_machines').select('*').order('name'),
    db.from('ctt_procedure_types').select('*'),
    db.from('ctt_procedure_fixed_monitor').select('*'),
    db.from('ctt_combos').select('*').order('priority'),
    db.from('ctt_settings').select('*'),
  ]);
  const firstError = e1 || e2 || e3 || e4 || e5 || e6;
  if (firstError) throw firstError;

  const settings = Object.fromEntries((settingRows || []).map((s) => [s.key, s.value]));
  const shifts = [
    { start: hhmmToMinutes(settings.shift1_start || '07:00'), end: hhmmToMinutes(settings.shift1_end || '11:30') },
    { start: hhmmToMinutes(settings.shift2_start || '13:30'), end: hhmmToMinutes(settings.shift2_end || '17:00') },
  ];
  const transferBufferMinutes = Number(settings.transfer_buffer_minutes || 2);
  const optimizationMode = settings.optimization_mode === 'max_patients' ? 'max_patients' : 'max_xong';

  const fixedMonitorByProcId = new Map();
  for (const row of fixedMonitorRows || []) fixedMonitorByProcId.set(row.procedure_type_id, row.staff_id);

  const procedures = {};
  for (const p of procRows || []) {
    procedures[p.code] = {
      id: p.id,
      code: p.code,
      name: p.name,
      duration_minutes: p.duration_minutes,
      requires_machine: p.requires_machine,
      machine_type: p.machine_type,
      rest_after_minutes: p.rest_after_minutes || 0,
      can_split: p.can_split,
      active_minutes: p.active_minutes,
      monitor_minutes: p.monitor_minutes,
      monitor_max_patients: p.monitor_max_patients,
      perform_roles: p.perform_roles || [],
      monitor_roles: p.monitor_roles || [],
      is_exam: p.is_exam,
      fixed_monitor_staff_id: fixedMonitorByProcId.get(p.id) || null,
    };
  }

  const comboLabels = {};
  for (const c of comboRows || []) {
    comboLabels[c.code] = { name: c.name, step2Code: c.step2_code, step4Code: c.step4_code, priority: c.priority };
  }

  const staff = (staffRows || []).map((s) => ({ id: s.id, name: s.name, role: s.role, active: s.active, qualification: s.qualification, note: s.note }));
  const machines = (machineRows || []).map((m) => ({ id: m.id, name: m.name, type: m.type, active: m.active }));

  // Cảnh báo trùng tên nhân sự ĐANG HOẠT ĐỘNG: nếu 2 người khác nhau (2 id
  // khác nhau) trong danh sách lại trùng TÊN HIỂN THỊ, thuật toán vẫn xếp
  // đúng theo từng id riêng biệt (không xung đột thật), nhưng báo cáo/phiếu
  // in ra sẽ HIỂN THỊ như thể 1 người bị xếp trùng giờ — dễ gây hiểu nhầm là
  // lỗi chia lịch. Phát hiện sớm để sửa dữ liệu (đổi tên phân biệt, VD thêm
  // ký tự lót) thay vì tưởng nhầm là bug thuật toán.
  const activeStaff = staff.filter((s) => s.active);
  const nameCounts = new Map();
  for (const s of activeStaff) nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1);
  const duplicateStaffNames = Array.from(nameCounts.entries()).filter(([, n]) => n > 1).map(([name]) => name);

  return {
    schedulerConfig: { shifts, transferBufferMinutes, procedures, staff: activeStaff, machines: machines.filter((m) => m.active), comboLabels, optimizationMode },
    raw: { staff, machines, procedures: procRows || [], combos: comboRows || [], settings: settingRows || [], fixedMonitor: fixedMonitorRows || [] },
    duplicateStaffNames,
  };
}

module.exports = { loadCttConfig, hhmmToMinutes };
