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

    const { raw } = await loadCttConfig();
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

    res.status(200).json({ date, patients, scheduleEntries, warnings });
  } catch (e) {
    console.error('ctt-schedule error', e);
    res.status(500).json({ error: 'Không tải được lịch.' });
  }
};
