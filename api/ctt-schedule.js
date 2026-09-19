// Lấy lại lịch chia thủ thuật đã lưu của 1 ngày (để xem lại / xuất báo cáo mà
// không cần chia lại). GET /api/ctt-schedule?date=YYYY-MM-DD
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getStaffFromRequest } = require('./_lib/auth');
const { loadCttConfig } = require('./_lib/cttConfig');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const staffAcct = await getStaffFromRequest(req);
  if (!staffAcct) {
    res.status(401).json({ error: 'Chưa đăng nhập.' });
    return;
  }

  try {
    const { date } = req.query || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Thiếu ngày hoặc định dạng ngày không hợp lệ (YYYY-MM-DD).' });
      return;
    }

    const db = getSupabaseAdmin();
    const { data: patients, error: patientsError } = await db.from('ctt_patients').select('*').eq('date', date).order('stt');
    if (patientsError) throw patientsError;
    if (!patients || patients.length === 0) {
      res.status(200).json({ date, patients: [], scheduleEntries: [], warnings: [], summary: null });
      return;
    }

    const { data: schedules, error: schedulesError } = await db
      .from('ctt_schedules')
      .select('*, ctt_schedule_staffs(*)')
      .eq('date', date);
    if (schedulesError) throw schedulesError;

    const { raw, duplicateStaffNames } = await loadCttConfig();
    const procById = Object.fromEntries(raw.procedures.map((p) => [p.id, p]));
    const staffById = Object.fromEntries(raw.staff.map((s) => [s.id, s]));
    const machineById = Object.fromEntries(raw.machines.map((m) => [m.id, m]));

    const scheduleEntries = (schedules || [])
      .filter((s) => s.status === 'scheduled')
      .map((s) => ({
        patientId: s.patient_id,
        procedureCode: procById[s.procedure_type_id]?.code || null,
        procedureName: procById[s.procedure_type_id]?.name || null,
        machineId: s.machine_id,
        machineName: s.machine_id ? machineById[s.machine_id]?.name : null,
        comboCode: s.combo_code,
        start: s.start_time,
        end: s.end_time,
        staffAssignments: (s.ctt_schedule_staffs || []).map((a) => ({
          staffId: a.staff_id,
          staffName: staffById[a.staff_id]?.name || '?',
          start: a.start_time,
          end: a.end_time,
          roleType: a.role_type,
        })),
      }));

    const warnings = (schedules || [])
      .filter((s) => s.status === 'unassigned')
      .reduce((acc, s) => {
        const patient = patients.find((p) => p.id === s.patient_id);
        let entry = acc.find((w) => w.patientId === s.patient_id);
        if (!entry) {
          entry = { patientId: s.patient_id, patientName: patient?.name, stt: patient?.stt, missingSteps: [] };
          acc.push(entry);
        }
        entry.missingSteps.push(procById[s.procedure_type_id]?.code || '?');
        return acc;
      }, []);

    // Tổng hợp số liệu (giống hệt phần "Tổng quan" khi vừa chia mới), để tab
    // "Xem lại theo ngày" cũng hiển thị được — trước đây thiếu hẳn phần này.
    const totalPatients = patients.length;
    const incompletePatients = warnings.length;
    const comboCount = {};
    const countedPatientIds = new Set();
    for (const e of scheduleEntries) {
      if (!e.comboCode || countedPatientIds.has(e.patientId)) continue;
      countedPatientIds.add(e.patientId);
      comboCount[e.comboCode] = (comboCount[e.comboCode] || 0) + 1;
    }
    const procedureCount = raw.procedures.map((p) => ({
      code: p.code,
      name: p.name,
      count: scheduleEntries.reduce((n, e) => n + (e.procedureCode === p.code ? 1 : 0), 0),
    }));
    const machineUsedMinutes = {};
    for (const e of scheduleEntries) {
      if (!e.machineId) continue;
      machineUsedMinutes[e.machineId] = (machineUsedMinutes[e.machineId] || 0) + (e.end - e.start);
    }
    const capacityMinutes = (() => {
      const s1s = raw.settings.find((x) => x.key === 'shift1_start')?.value || '07:00';
      const s1e = raw.settings.find((x) => x.key === 'shift1_end')?.value || '11:30';
      const s2s = raw.settings.find((x) => x.key === 'shift2_start')?.value || '13:30';
      const s2e = raw.settings.find((x) => x.key === 'shift2_end')?.value || '17:00';
      const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      return (toMin(s1e) - toMin(s1s)) + (toMin(s2e) - toMin(s2s));
    })();
    const machineUtilization = raw.machines.map((m) => {
      const used = machineUsedMinutes[m.id] || 0;
      return { machineId: m.id, name: m.name, type: m.type, usedMinutes: used, capacityMinutes, utilizationPct: capacityMinutes ? Math.round((used / capacityMinutes) * 1000) / 10 : 0 };
    });
    const summary = { totalPatients, completedPatients: totalPatients - incompletePatients, incompletePatients, comboCount, procedureCount, machineUtilization };

    res.status(200).json({ date, patients, scheduleEntries, warnings, summary, duplicateStaffNames });
  } catch (e) {
    console.error('ctt-schedule error', e);
    res.status(500).json({ error: 'Không tải được lịch.' });
  }
};
