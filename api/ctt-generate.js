// Nhận danh sách bệnh nhân trong ngày (STT + Họ tên [+ combo ép buộc nếu
// có]), chạy thuật toán chia thủ thuật, LƯU kết quả vào Supabase (ghi đè lịch
// cũ của đúng ngày đó nếu đã tồn tại — cho phép "chia lại" khi cần sửa danh
// sách), rồi trả về toàn bộ kết quả để hiển thị ngay.
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');
const { loadCttConfig } = require('./_lib/cttConfig');
const { generateSchedule, estimateRemainingCapacity, minutesToHHMM } = require('./_lib/cttScheduler');

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

  // Thêm ĐÚNG 1 bệnh nhân mới vào lịch đã chia sẵn (nút "+ Thêm 1 dòng" sau
  // khi đã chia) dùng chung route này (action riêng) thay vì 1 file api/*.js
  // mới — xem lý do trong api/_lib/cttAddPatient.js.
  if (req.body && req.body.action === 'add_patient') {
    return require('./_lib/cttAddPatient')(req, res);
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
      cleanPatients.push({ stt, name: name.slice(0, 255), comboOverride: p.comboOverride || null, priorityDischarge: p.priorityDischarge === true });
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

    // Số suất muốn dành cho bệnh nhân mới nhập viện thêm sau (sáng/chiều), và
    // trong số đó, tối thiểu bao nhiêu suất bắt buộc nằm SAU mốc muộn (giờ
    // kết thúc ca trừ 60 phút, VD 10h30 sáng/16h00 chiều — không đủ giờ cho
    // phác đồ đầy đủ nên nhóm này tự dùng phác đồ RÚT GỌN nhiều tiền nhất) —
    // nếu request này không truyền lên (VD chia lại cùng ngày mà không đổi ý
    // định), dùng lại đúng giá trị đã lưu trước đó cho ngày này (hệ thống tự
    // "ghi nhớ", không cần nhập lại mỗi lần).
    let reservedMorning = 0;
    let reservedAfternoon = 0;
    let minCheckpointMorning = 0;
    let minCheckpointAfternoon = 0;
    if (req.body && req.body.reservedSlots && typeof req.body.reservedSlots === 'object') {
      reservedMorning = Math.max(0, Math.floor(Number(req.body.reservedSlots.morning) || 0));
      reservedAfternoon = Math.max(0, Math.floor(Number(req.body.reservedSlots.afternoon) || 0));
      const minAfterCheckpoint = req.body.minAfterCheckpoint || {};
      minCheckpointMorning = Math.max(0, Math.floor(Number(minAfterCheckpoint.morning) || 0));
      minCheckpointAfternoon = Math.max(0, Math.floor(Number(minAfterCheckpoint.afternoon) || 0));
      const { error: reserveErr } = await db
        .from('ctt_reserved_slots')
        .upsert({
          date,
          morning_slots: reservedMorning,
          afternoon_slots: reservedAfternoon,
          min_after_checkpoint_morning: minCheckpointMorning,
          min_after_checkpoint_afternoon: minCheckpointAfternoon,
          updated_at: new Date().toISOString(),
        });
      if (reserveErr) throw reserveErr;
    } else {
      const { data: reserveRow } = await db
        .from('ctt_reserved_slots')
        .select('morning_slots, afternoon_slots, min_after_checkpoint_morning, min_after_checkpoint_afternoon')
        .eq('date', date)
        .maybeSingle();
      if (reserveRow) {
        reservedMorning = reserveRow.morning_slots;
        reservedAfternoon = reserveRow.afternoon_slots;
        minCheckpointMorning = reserveRow.min_after_checkpoint_morning || 0;
        minCheckpointAfternoon = reserveRow.min_after_checkpoint_afternoon || 0;
      }
    }
    schedulerConfig.reservedSlotsByShift = [reservedMorning, reservedAfternoon];

    // Biến số suất muốn để dành thành các bệnh nhân "giữ chỗ" (BNM) CỤ THỂ,
    // cộng dồn thẳng vào danh sách chia thủ thuật — để chỗ để dành hiện RÕ
    // thành từng dòng có giờ giấc/nhân sự/combo cụ thể (không chỉ là 1 con số
    // trừu tượng), và để thuật toán THỰC SỰ giữ được chỗ đó (xem cttScheduler.js:
    // BNM được xếp ưu tiên TRƯỚC bệnh nhân ngoại trú, chỉ sau người ra viện
    // hôm nay, nên không bao giờ bị danh sách ngoại trú "ăn" mất suất). Trong
    // mỗi buổi, N suất ĐẦU (N = số tối thiểu sau mốc muộn) được đánh dấu
    // "checkpoint" — ép nằm sau mốc muộn, chấp nhận phác đồ rút gọn; số còn
    // lại là "tail" — vẫn xếp muộn nhất có thể với phác đồ đầy đủ như trước.
    for (let i = 1; i <= reservedMorning; i++) {
      cleanPatients.push({
        stt: 90000 + i,
        name: `BNM buổi sáng ${i}`,
        comboOverride: null,
        priorityDischarge: false,
        isPlaceholder: true,
        placeholderShift: 'morning',
        placeholderTier: i <= minCheckpointMorning ? 'checkpoint' : 'tail',
      });
    }
    for (let i = 1; i <= reservedAfternoon; i++) {
      cleanPatients.push({
        stt: 95000 + i,
        name: `BNM buổi chiều ${i}`,
        comboOverride: null,
        priorityDischarge: false,
        isPlaceholder: true,
        placeholderShift: 'afternoon',
        placeholderTier: i <= minCheckpointAfternoon ? 'checkpoint' : 'tail',
      });
    }

    // Xoá dữ liệu cũ của ngày này (nếu có) để chia lại từ đầu.
    const { data: oldPatients } = await db.from('ctt_patients').select('id').eq('date', date);
    if (oldPatients && oldPatients.length) {
      await db.from('ctt_schedules').delete().in('patient_id', oldPatients.map((p) => p.id));
      await db.from('ctt_patients').delete().eq('date', date);
    }

    const { data: insertedPatients, error: patientInsertError } = await db
      .from('ctt_patients')
      .insert(cleanPatients.map((p) => ({
        date,
        stt: p.stt,
        name: p.name,
        combo_override: p.comboOverride,
        priority_discharge: p.priorityDischarge,
        is_placeholder: p.isPlaceholder === true,
        placeholder_shift: p.placeholderShift || null,
        placeholder_tier: p.placeholderTier || null,
      })))
      .select('id, stt, name, combo_override, priority_discharge, is_placeholder, placeholder_shift, placeholder_tier');
    if (patientInsertError) throw patientInsertError;

    const patientForScheduler = insertedPatients.map((p) => ({
      id: p.id,
      stt: p.stt,
      name: p.name,
      comboOverride: p.combo_override,
      priorityDischarge: p.priority_discharge,
      isPlaceholder: p.is_placeholder,
      placeholderShift: p.placeholder_shift,
      placeholderTier: p.placeholder_tier,
    }));
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

    // Mô phỏng thử xem THỰC SỰ còn nhận thêm được bao nhiêu người mỗi buổi
    // (không chỉ dựa vào số suất đã dành ra — có thể ít/nhiều hơn tuỳ tải
    // thực tế của ngày hôm đó), để CEO biết chính xác trước khi quyết định
    // nhận thêm bệnh nhân mới.
    const shiftCapacity = schedulerConfig.shifts.map((s, i) => {
      const cap = estimateRemainingCapacity(schedulerConfig, result.scheduleEntries, i, result.summary.shiftCapacity[i].examCounter);
      return {
        start: s.start,
        end: s.end,
        startLabel: minutesToHHMM(s.start),
        endLabel: minutesToHHMM(s.end),
        reservedSlots: schedulerConfig.reservedSlotsByShift[i] || 0,
        minAfterCheckpoint: i === 0 ? minCheckpointMorning : minCheckpointAfternoon,
        remainingFit: cap.fit,
        remainingAtLeast: cap.atLeast,
      };
    });

    res.status(200).json({
      date,
      patients: insertedPatients,
      scheduleEntries: result.scheduleEntries,
      warnings: result.warnings,
      summary: { ...result.summary, shiftCapacity },
      config: schedulerConfig,
      duplicateStaffNames,
    });
  } catch (e) {
    console.error('ctt-generate error', e);
    res.status(500).json({ error: 'Không chia được thủ thuật, vui lòng thử lại. Chi tiết: ' + (e.message || '') });
  }
};
