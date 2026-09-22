// Thêm ĐÚNG 1 bệnh nhân mới vào lịch đã chia sẵn của 1 ngày — dùng khi có
// bệnh nhân mới nhập viện sau khi đã bấm "Chia thủ thuật" lần đầu trong
// ngày. TUYỆT ĐỐI KHÔNG xếp lại những người đã có (chỉ "phát lại" lịch cũ
// để biết chỗ nào đã bận, rồi tìm chỗ cho riêng người mới, đúng giờ/combo
// người dùng chọn hoặc combo tự động nếu combo yêu cầu không đủ chỗ).
// POST /api/ctt-add-patient { date, stt, name, shift: 'morning'|'afternoon',
//   desiredStart: 'HH:MM', comboOverride?: 'C1'|'C2'|'C3' }
const { randomUUID } = require('crypto');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');
const { loadCttConfig, hhmmToMinutes } = require('./_lib/cttConfig');
const { generateSchedule, minutesToHHMM } = require('./_lib/cttScheduler');

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
    const { date, stt, name, shift, desiredStart, comboOverride } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Thiếu ngày hoặc định dạng ngày không hợp lệ (YYYY-MM-DD).' });
      return;
    }
    const sttNum = Number(stt);
    const cleanName = String(name || '').trim();
    if (!Number.isInteger(sttNum) || sttNum <= 0 || !cleanName) {
      res.status(400).json({ error: 'STT phải là số nguyên dương và Họ tên không được để trống.' });
      return;
    }
    if (!['morning', 'afternoon'].includes(shift)) {
      res.status(400).json({ error: 'Buổi không hợp lệ (phải là "morning" hoặc "afternoon").' });
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(desiredStart || '')) {
      res.status(400).json({ error: 'Giờ bắt đầu không hợp lệ (định dạng HH:MM).' });
      return;
    }
    if (comboOverride && !['C1', 'C2', 'C3'].includes(comboOverride)) {
      res.status(400).json({ error: 'Combo không hợp lệ (chỉ nhận C1/C2/C3).' });
      return;
    }

    const db = getSupabaseAdmin();
    const { schedulerConfig } = await loadCttConfig(date);
    const shiftIndex = shift === 'morning' ? 0 : 1;
    const shiftWindow = schedulerConfig.shifts[shiftIndex];
    if (!shiftWindow) {
      res.status(400).json({ error: 'Chưa cấu hình đủ 2 ca sáng/chiều.' });
      return;
    }
    const desiredStartMinutes = hhmmToMinutes(desiredStart);
    if (desiredStartMinutes < shiftWindow.start || desiredStartMinutes >= shiftWindow.end) {
      res.status(400).json({
        error: `Giờ bắt đầu phải trong khung ${minutesToHHMM(shiftWindow.start)}-${minutesToHHMM(shiftWindow.end)} của buổi ${shift === 'morning' ? 'sáng' : 'chiều'}.`,
      });
      return;
    }

    // Kiểm tra STT chưa dùng cho ngày này (báo sớm, rõ ràng, trước khi tính toán).
    const { data: existingPatients, error: patientsError } = await db.from('ctt_patients').select('id, stt').eq('date', date);
    if (patientsError) throw patientsError;
    if ((existingPatients || []).some((p) => p.stt === sttNum)) {
      res.status(400).json({ error: `STT ${sttNum} đã có bệnh nhân khác trong ngày ${date}.` });
      return;
    }

    // Nạp lại TOÀN BỘ lịch đã chốt của ngày này (để tìm chỗ tránh, không xếp lại).
    const { data: schedules, error: schedulesError } = await db
      .from('ctt_schedules')
      .select('*, ctt_schedule_staffs(*)')
      .eq('date', date)
      .eq('status', 'scheduled');
    if (schedulesError) throw schedulesError;
    const procById = Object.fromEntries(Object.values(schedulerConfig.procedures).map((p) => [p.id, p]));
    const existingScheduleEntries = (schedules || []).map((s) => ({
      patientId: s.patient_id,
      procedureCode: procById[s.procedure_type_id]?.code || null,
      machineId: s.machine_id,
      comboCode: s.combo_code,
      start: s.start_time,
      end: s.end_time,
      staffAssignments: (s.ctt_schedule_staffs || []).map((a) => ({ staffId: a.staff_id, start: a.start_time, end: a.end_time, roleType: a.role_type })),
    }));

    const newPatientId = randomUUID();
    const runOne = (forcedCombo) => {
      const attemptConfig = { ...schedulerConfig, shifts: [shiftWindow], existingScheduleEntries, forcedExamFloor: desiredStartMinutes };
      return generateSchedule(attemptConfig, [{ id: newPatientId, stt: sttNum, name: cleanName, comboOverride: forcedCombo || null }]);
    };

    let result = runOne(comboOverride || null);
    let usedCombo = comboOverride || null;

    if (result.warnings.length > 0 && comboOverride) {
      // Combo yêu cầu quá tải đúng giờ này -> thử để hệ thống tự chọn combo
      // khả thi (nếu có) để GỢI Ý thay vì chỉ báo lỗi suông.
      const autoResult = runOne(null);
      if (autoResult.warnings.length === 0) {
        const suggested = autoResult.scheduleEntries.find((e) => e.patientId === newPatientId)?.comboCode;
        res.status(200).json({
          ok: false,
          overloaded: true,
          message: `Combo ${comboOverride} hiện quá tải lúc ${desiredStart} (buổi ${shift === 'morning' ? 'sáng' : 'chiều'}) — không đủ nhân sự/máy đúng lúc này.`,
          suggestedCombo: suggested,
          suggestedMessage: suggested ? `Có thể dùng ${suggested} thay thế — vẫn xếp được đủ 4 bước bắt đầu từ ${desiredStart}.` : null,
        });
        return;
      }
      res.status(200).json({
        ok: false,
        overloaded: true,
        message: `Combo ${comboOverride} hiện quá tải lúc ${desiredStart} (buổi ${shift === 'morning' ? 'sáng' : 'chiều'}), và thử các combo khác cũng không đủ chỗ đúng giờ này. Thử chọn giờ khác hoặc buổi khác.`,
        suggestedCombo: null,
      });
      return;
    }

    if (result.warnings.length > 0) {
      res.status(200).json({
        ok: false,
        overloaded: true,
        message: `Không đủ chỗ (máy/nhân sự) để xếp đủ 4 bước bắt đầu từ ${desiredStart} (buổi ${shift === 'morning' ? 'sáng' : 'chiều'}). Thử chọn giờ khác hoặc buổi khác.`,
        missingSteps: result.warnings[0]?.missingSteps || [],
      });
      return;
    }

    // Thành công — LƯU vào CSDL. Chỉ ghi bệnh nhân + lượt của người MỚI,
    // tuyệt đối không đụng tới các dòng đã có sẵn của ngày này.
    const { error: insertPatientErr } = await db
      .from('ctt_patients')
      .insert({ id: newPatientId, date, stt: sttNum, name: cleanName.slice(0, 255), combo_override: comboOverride || null, priority_discharge: false });
    if (insertPatientErr) throw insertPatientErr;

    const procIdByCode = Object.fromEntries(Object.values(schedulerConfig.procedures).map((p) => [p.code, p.id]));
    const newEntries = result.scheduleEntries.filter((e) => e.patientId === newPatientId);
    const scheduleRowsToInsert = newEntries.map((e) => ({
      date,
      patient_id: e.patientId,
      procedure_type_id: procIdByCode[e.procedureCode] || null,
      machine_id: e.machineId,
      combo_code: e.comboCode || null,
      start_time: e.start,
      end_time: e.end,
      status: 'scheduled',
    }));
    const { data: insertedSchedules, error: scheduleErr } = await db
      .from('ctt_schedules')
      .insert(scheduleRowsToInsert)
      .select('id, patient_id, procedure_type_id, start_time');
    if (scheduleErr) throw scheduleErr;

    const scheduleIdByKey = new Map(insertedSchedules.map((row) => [`${row.patient_id}|${row.procedure_type_id}|${row.start_time}`, row.id]));
    const staffAssignRows = [];
    for (const e of newEntries) {
      const scheduleId = scheduleIdByKey.get(`${e.patientId}|${procIdByCode[e.procedureCode]}|${e.start}`);
      if (!scheduleId) continue;
      for (const a of e.staffAssignments) {
        staffAssignRows.push({ schedule_id: scheduleId, staff_id: a.staffId, start_time: a.start, end_time: a.end, role_type: a.roleType });
      }
    }
    if (staffAssignRows.length) {
      const { error: staffAssignErr } = await db.from('ctt_schedule_staffs').insert(staffAssignRows);
      if (staffAssignErr) throw staffAssignErr;
    }

    res.status(200).json({
      ok: true,
      patient: { id: newPatientId, stt: sttNum, name: cleanName },
      scheduleEntries: newEntries,
      usedCombo: usedCombo || newEntries.find((e) => e.comboCode)?.comboCode || null,
    });
  } catch (e) {
    console.error('ctt-add-patient error', e);
    res.status(500).json({ error: 'Không thêm được bệnh nhân, vui lòng thử lại. Chi tiết: ' + (e.message || '') });
  }
};
