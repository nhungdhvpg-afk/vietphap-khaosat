// Nhận danh sách bệnh nhân trong ngày (STT + Họ tên [+ combo ép buộc nếu
// có]), chạy thuật toán chia thủ thuật, LƯU kết quả vào Supabase (ghi đè lịch
// cũ của đúng ngày đó nếu đã tồn tại — cho phép "chia lại" khi cần sửa danh
// sách), rồi trả về toàn bộ kết quả để hiển thị ngay.
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');
const { loadCttConfig } = require('./_lib/cttConfig');
const { generateSchedule } = require('./_lib/cttScheduler');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const staffAcct = await getStaffFromRequest(req);
  if (!staffAcct) {
    res.status(401).json({ error: 'Chưa đăng nhập.' });
    return;
  }

  try {
    const { date, patients } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Thiếu ngày hoặc định dạng ngày không hợp lệ (YYYY-MM-DD).' });
      return;
    }
    if (!Array.isArray(patients) || patients.length === 0) {
      res.status(400).json({ error: 'Danh sách bệnh nhân trống.' });
      return;
    }
    const cleanPatients = [];
    const seenStt = new Set();
    for (const p of patients) {
      const stt = Number(p.stt);
      const name = String(p.name || '').trim();
      if (!Number.isInteger(stt) || stt <= 0 || !name) {
        res.status(400).json({ error: `Dòng không hợp lệ: STT="${p.stt}" Tên="${p.name}". Mỗi dòng cần STT là số nguyên dương và Họ tên không rỗng.` });
        return;
      }
      if (seenStt.has(stt)) {
        res.status(400).json({ error: `STT ${stt} bị trùng trong danh sách.` });
        return;
      }
      seenStt.add(stt);
      cleanPatients.push({ stt, name: name.slice(0, 255), comboOverride: p.comboOverride || null });
    }

    const db = getSupabaseAdmin();
    const { schedulerConfig, duplicateStaffNames } = await loadCttConfig(date);
    if (schedulerConfig.staff.length === 0) {
      res.status(400).json({ error: 'Chưa có nhân sự nào đang hoạt động — vào Cài đặt để thêm nhân sự trước.' });
      return;
    }
    if (schedulerConfig.machines.length === 0) {
      res.status(400).json({ error: 'Chưa có máy móc nào đang hoạt động — vào Cài đặt để thêm máy trước.' });
      return;
    }

    // Xoá dữ liệu cũ của ngày này (nếu có) để chia lại từ đầu.
    const { data: oldPatients } = await db.from('ctt_patients').select('id').eq('date', date);
    if (oldPatients && oldPatients.length) {
      await db.from('ctt_schedules').delete().in('patient_id', oldPatients.map((p) => p.id));
      await db.from('ctt_patients').delete().eq('date', date);
    }

    const { data: insertedPatients, error: patientInsertError } = await db
      .from('ctt_patients')
      .insert(cleanPatients.map((p) => ({ date, stt: p.stt, name: p.name, combo_override: p.comboOverride })))
      .select('id, stt, name, combo_override');
    if (patientInsertError) throw patientInsertError;

    const patientForScheduler = insertedPatients.map((p) => ({ id: p.id, stt: p.stt, name: p.name, comboOverride: p.combo_override }));
    const result = generateSchedule(schedulerConfig, patientForScheduler);

    const procIdByCode = Object.fromEntries(Object.values(schedulerConfig.procedures).map((p) => [p.code, p.id]));

    const scheduleRowsToInsert = result.scheduleEntries.map((e) => ({
      date,
      patient_id: e.patientId,
      procedure_type_id: procIdByCode[e.procedureCode] || null,
      machine_id: e.machineId,
      combo_code: e.comboCode || null,
      start_time: e.start,
      end_time: e.end,
      status: 'scheduled',
    }));
    let insertedSchedules = [];
    if (scheduleRowsToInsert.length) {
      const { data, error } = await db.from('ctt_schedules').insert(scheduleRowsToInsert).select('id, patient_id, procedure_type_id, start_time, end_time');
      if (error) throw error;
      insertedSchedules = data;
    }

    // map lại (patientId, procedureTypeId, start) -> scheduleId để gắn nhân sự đúng lượt
    const scheduleIdByKey = new Map();
    for (const row of insertedSchedules) {
      scheduleIdByKey.set(`${row.patient_id}|${row.procedure_type_id}|${row.start_time}`, row.id);
    }
    const staffAssignRows = [];
    for (const e of result.scheduleEntries) {
      const scheduleId = scheduleIdByKey.get(`${e.patientId}|${procIdByCode[e.procedureCode]}|${e.start}`);
      if (!scheduleId) continue;
      for (const a of e.staffAssignments) {
        staffAssignRows.push({ schedule_id: scheduleId, staff_id: a.staffId, start_time: a.start, end_time: a.end, role_type: a.roleType });
      }
    }
    if (staffAssignRows.length) {
      const { error } = await db.from('ctt_schedule_staffs').insert(staffAssignRows);
      if (error) throw error;
    }

    // ghi lại các bệnh nhân bị thiếu bước (unassigned) để tiện tra cứu lịch sử
    if (result.warnings.length) {
      const unassignedRows = result.warnings.flatMap((w) => {
        const patientRow = insertedPatients.find((p) => p.stt === w.stt);
        if (!patientRow) return [];
        return w.missingSteps.map((code) => ({
          date,
          patient_id: patientRow.id,
          procedure_type_id: procIdByCode[code] || null,
          machine_id: null,
          start_time: 0,
          end_time: 0,
          status: 'unassigned',
          unassigned_reason: w.reason || 'Hết giờ ca hoặc hết tài nguyên (máy/nhân sự) khả dụng trong ngày.',
        }));
      });
      if (unassignedRows.length) {
        const { error } = await db.from('ctt_schedules').insert(unassignedRows);
        if (error) throw error;
      }
    }

    res.status(200).json({
      date,
      patients: insertedPatients,
      scheduleEntries: result.scheduleEntries,
      warnings: result.warnings,
      summary: result.summary,
      config: schedulerConfig,
      duplicateStaffNames,
    });
  } catch (e) {
    console.error('ctt-generate error', e);
    res.status(500).json({ error: 'Không chia được thủ thuật, vui lòng thử lại. Chi tiết: ' + (e.message || '') });
  }
};
