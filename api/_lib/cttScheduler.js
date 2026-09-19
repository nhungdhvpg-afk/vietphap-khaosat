// ============================================================================
// THUẬT TOÁN CHIA THỦ THUẬT Y HỌC CỔ TRUYỀN — VIỆT PHÁP
// ============================================================================
// Đầu vào: danh sách bệnh nhân trong ngày (chỉ cần STT + Họ tên) + cấu hình
// (nhân sự, máy móc, loại thủ thuật, ca làm việc).
//
// Phác đồ chuẩn (mặc định cho mọi bệnh nhân, trừ khi ép combo khác):
//   Bước A: Xoa bóp bấm huyệt (XBBH)               — cố định
//   Bước B: Điện châm (DC) ưu tiên, dự phòng Hào châm (HC) khi hết máy/chỗ
//   Bước C: Thủy châm (TC)                          — cố định
//   Bước D: Xông hơi (XH) ưu tiên, dự phòng Cứu ngải (CN) khi hết máy/chỗ
//
// Quy tắc tối ưu cốt lõi:
//   1. Luôn tận dụng tối đa công suất máy Xông trước khi chuyển bệnh nhân
//      sang Cứu ngải (không để máy Xông rảnh trong khi có bệnh nhân đang chờ
//      xếp thủ thuật, trừ khi việc chờ máy Xông khiến bệnh nhân không thể
//      hoàn tất phác đồ trong ca làm việc còn lại).
//   2. Tương tự cho Điện châm so với Hào châm (máy Châm là tài nguyên quý).
//   3. Không xếp thủ thuật vượt khung giờ ca (BHYT không thanh toán ngoài giờ)
//      và không xếp vắt qua giờ nghỉ trưa.
//   4. Thứ tự bốc thăm STT chỉ dùng để phân xử khi tài nguyên bị tranh chấp
//      (ai đến lượt trước được ưu tiên giữ chỗ trước), không bắt buộc phải
//      hoàn thành tuần tự — thứ tự các bước của TỪNG bệnh nhân có thể xáo để
//      đạt tổng thời gian hoàn thành ngắn nhất.
// ============================================================================

const MINUTE_EPS = 1e-6;

/** Tìm khoảng thời gian rảnh sớm nhất (>= notBefore) đủ `duration` phút, nằm
 * trọn trong 1 trong các khung ca `shifts`, không đụng các khoảng bận đã có
 * trong `busyIntervals` (mảng {start,end}, không cần sắp xếp trước). */
function findEarliestSlot(busyIntervals, shifts, duration, notBefore) {
  const sorted = busyIntervals.slice().sort((a, b) => a.start - b.start);
  for (const shift of shifts) {
    let candidate = Math.max(notBefore, shift.start);
    if (candidate + duration > shift.end + MINUTE_EPS) continue; // không đủ chỗ trong ca này nữa
    // Duyệt qua các khoảng bận nằm trong ca này, đẩy candidate tới sau mỗi khoảng chồng lấn.
    for (const busy of sorted) {
      if (busy.end <= candidate) continue;
      if (busy.start >= candidate + duration) break; // không còn chồng lấn nữa (đã sort)
      // chồng lấn -> đẩy candidate ra sau khoảng bận này
      candidate = busy.end;
    }
    if (candidate + duration <= shift.end + MINUTE_EPS) {
      return { start: candidate, end: candidate + duration };
    }
  }
  return null; // không còn chỗ trong ngày
}

/** Kiểm tra 1 khoảng [start,end] có được phép thêm vào 1 "tài nguyên có sức
 * chứa" (VD: 1 điều dưỡng theo dõi tối đa N bệnh nhân cùng lúc) hay không,
 * và số bệnh nhân đang chồng lấn tại mọi thời điểm không vượt `capacity`. */
function capacityFits(existingIntervals, start, end, capacity) {
  // đếm số khoảng đang chồng lấn với [start,end]; xấp xỉ đủ tốt vì các thủ
  // thuật đều có thời lượng cố định, không cần quét từng phút.
  let overlapCount = 0;
  for (const iv of existingIntervals) {
    if (iv.start < end - MINUTE_EPS && iv.end > start + MINUTE_EPS) overlapCount++;
  }
  return overlapCount < capacity;
}

/** Tìm khoảng rảnh sớm nhất cho 1 tài nguyên có sức chứa (không phải loại
 * "độc chiếm" như máy/nhân viên thực hiện, mà kiểu N-người-theo-dõi-cùng-lúc). */
function findEarliestCapacitySlot(existingIntervals, shifts, duration, notBefore, capacity) {
  // thử từng mốc "kết thúc" của các khoảng đã có (đây là các điểm mà sức chứa
  // có thể vừa giảm xuống), cộng thêm mốc bắt đầu ca và notBefore.
  const candidates = new Set([notBefore]);
  for (const shift of shifts) candidates.add(Math.max(notBefore, shift.start));
  for (const iv of existingIntervals) if (iv.end >= notBefore) candidates.add(iv.end);
  const sortedCandidates = Array.from(candidates).sort((a, b) => a - b);

  for (const shift of shifts) {
    for (const t of sortedCandidates) {
      if (t < shift.start - MINUTE_EPS) continue;
      if (t + duration > shift.end + MINUTE_EPS) continue;
      if (t < notBefore - MINUTE_EPS) continue;
      if (capacityFits(existingIntervals, t, t + duration, capacity)) {
        return { start: t, end: t + duration };
      }
    }
  }
  return null;
}

/** Tìm nhân sự (trong danh sách `staffPool`, đã có role phù hợp) có lịch rảnh
 * sớm nhất cho 1 khoảng `duration` phút. `getBusy(staffId)` phải trả về TOÀN
 * BỘ khoảng thời gian người đó đang bận — kể cả lúc đang "theo dõi" một thủ
 * thuật khác (nếu là người giám sát cố định) — để không bị gán chồng 2 việc
 * cùng lúc. Trả về {staffId, start, end} hoặc null. */
function findEarliestStaffSlot(staffPool, getBusy, shifts, duration, notBefore) {
  let best = null;
  for (const staff of staffPool) {
    const busy = getBusy(staff.id);
    const slot = findEarliestSlot(busy, shifts, duration, notBefore);
    if (slot && (!best || slot.start < best.slot.start)) {
      best = { staff, slot };
    }
  }
  if (!best) return null;
  return { staffId: best.staff.id, start: best.slot.start, end: best.slot.end };
}

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Chạy thuật toán chia thủ thuật.
 * @param {object} config - { shifts, transferBufferMinutes, procedures, staff, machines, comboLabels }
 * @param {Array}  patients - [{ id, stt, name }], đã sắp theo stt tăng dần hoặc sẽ được sắp lại.
 * @returns {object} { scheduleEntries, warnings, summary }
 */
function generateSchedule(config, patients) {
  const { shifts, transferBufferMinutes = 2, procedures, staff, machines, comboLabels = {} } = config;
  // Mỗi bệnh nhân PHẢI hoàn tất cả 4 bước TRONG CÙNG 1 buổi (đến 1 lần, làm
  // xong rồi về — không quay lại buổi sau). `activeShifts` là buổi đang được
  // thử cho bệnh nhân hiện tại; mọi hàm tìm chỗ trống bên dưới đều tra cứu
  // biến này (qua closure) thay vì toàn bộ `shifts`, để không bao giờ vô tình
  // xếp 1 người vắt sang buổi khác.
  let activeShifts = shifts.slice(0, 1);

  // Nhân sự được gán "trông cố định" 1 thủ thuật (VD Vi Thị Hoá -> Thủy châm)
  // được xem là ĐÃ CÓ VIỆC TOÀN THỜI GIAN — không được kéo đi làm việc khác
  // (Xoa bóp bấm huyệt, Xông hơi, Cứu ngải...) kẻo hết giờ trông cho các bệnh
  // nhân đến sau, gây thiếu người trông hàng loạt.
  const fixedMonitorStaffIds = new Set(Object.values(procedures).map((p) => p.fixed_monitor_staff_id).filter(Boolean));
  const staffByRole = { BS: [], YS: [], DD: [] };
  for (const s of staff.filter((s) => s.active !== false && !fixedMonitorStaffIds.has(s.id))) {
    if (staffByRole[s.role]) staffByRole[s.role].push(s);
  }
  const staffPoolForRoles = (roles) => roles.flatMap((r) => staffByRole[r] || []);

  // ---- Trạng thái tài nguyên dùng chung trong suốt quá trình xếp lịch ----
  const staffBusy = new Map(staff.map((s) => [s.id, []])); // độc chiếm (đang thực hiện thủ thuật)
  const machinesByType = { CHAM: machines.filter((m) => m.type === 'CHAM' && m.active !== false), XONG: machines.filter((m) => m.type === 'XONG' && m.active !== false) };
  const machineBusy = new Map(machines.map((m) => [m.id, []])); // gồm cả thời gian nghỉ máy (rest_after)
  const monitorLoad = new Map(); // key: procedureCode hoặc procedureCode+fixedStaffId -> mảng khoảng theo dõi

  function monitorKey(proc) {
    return proc.code; // theo dõi được gộp theo loại thủ thuật (đã tách theo người cố định nếu có)
  }
  function getMonitorIntervals(key) {
    if (!monitorLoad.has(key)) monitorLoad.set(key, []);
    return monitorLoad.get(key);
  }
  function overlapsAny(intervals, start, end) {
    return intervals.some((iv) => iv.start < end - MINUTE_EPS && iv.end > start + MINUTE_EPS);
  }
  /** Toàn bộ khoảng bận thực sự của 1 nhân sự: đang "thực hiện" (staffBusy)
   * CỘNG với đang "theo dõi cố định" 1 thủ thuật khác (nếu họ là người giám
   * sát cố định của thủ thuật đó) — để không bao giờ bị gán 2 việc chồng giờ,
   * kể cả khi 1 trong 2 việc là theo dõi (vốn cho phép nhiều bệnh nhân cùng
   * lúc, nhưng vẫn chiếm người đó, không thể đồng thời làm việc khác). */
  function staffOccupiedIntervals(staffId, excludeMonitorKey) {
    const intervals = (staffBusy.get(staffId) || []).slice();
    for (const [key, list] of monitorLoad.entries()) {
      if (key === excludeMonitorKey) continue;
      if (key.endsWith(':' + staffId)) intervals.push(...list);
    }
    return intervals;
  }
  /** 1 nhân sự có thực sự rảnh trọn vẹn khoảng [start,end] hay không (khoảng
   * đó phải nằm gọn trong 1 ca làm việc và không chồng lịch bận nào khác). */
  function isStaffFreeAt(staffId, start, end) {
    if (start < -MINUTE_EPS) return false;
    const inShift = activeShifts.some((s) => start >= s.start - MINUTE_EPS && end <= s.end + MINUTE_EPS);
    if (!inShift) return false;
    return !overlapsAny(staffOccupiedIntervals(staffId), start, end);
  }
  function findFreeStaffAt(pool, start, end) {
    for (const s of pool) if (isStaffFreeAt(s.id, start, end)) return s.id;
    return null;
  }

  const scheduleEntries = [];
  const warnings = [];
  const staffWorkMinutes = new Map(staff.map((s) => [s.id, 0]));
  const machineUsedMinutes = new Map(machines.map((m) => [m.id, 0]));
  const comboCount = {};

  /** Chụp lại toàn bộ trạng thái tài nguyên đang dùng, để có thể HOÀN TÁC
   * nếu 1 bệnh nhân thử xếp dở trong 1 buổi rồi không xong (VD thiếu 1 bước
   * cuối) — tránh để lại rác nửa vời rồi mới chuyển sang thử buổi khác. */
  function snapshotState() {
    return {
      staffBusy: Array.from(staffBusy, ([k, v]) => [k, v.slice()]),
      machineBusy: Array.from(machineBusy, ([k, v]) => [k, v.slice()]),
      monitorLoad: Array.from(monitorLoad, ([k, v]) => [k, v.slice()]),
      staffWorkMinutes: Array.from(staffWorkMinutes),
      machineUsedMinutes: Array.from(machineUsedMinutes),
      scheduleEntriesLength: scheduleEntries.length,
    };
  }
  function restoreState(snap) {
    staffBusy.clear();
    for (const [k, v] of snap.staffBusy) staffBusy.set(k, v);
    machineBusy.clear();
    for (const [k, v] of snap.machineBusy) machineBusy.set(k, v);
    monitorLoad.clear();
    for (const [k, v] of snap.monitorLoad) monitorLoad.set(k, v);
    staffWorkMinutes.clear();
    for (const [k, v] of snap.staffWorkMinutes) staffWorkMinutes.set(k, v);
    machineUsedMinutes.clear();
    for (const [k, v] of snap.machineUsedMinutes) machineUsedMinutes.set(k, v);
    scheduleEntries.length = snap.scheduleEntriesLength;
  }

  function addStaffBusy(staffId, start, end) {
    staffBusy.get(staffId).push({ start, end });
    staffWorkMinutes.set(staffId, (staffWorkMinutes.get(staffId) || 0) + (end - start));
  }

  /** Thử xếp 1 thủ thuật KHÔNG chia đôi (không tách tay nghề/theo dõi),
   * có thể cần máy hoặc không. Trả về plan {start,end,...} hoặc null. */
  function planSimpleProcedure(proc, notBefore) {
    const roles = proc.perform_roles;
    const pool = staffPoolForRoles(roles);
    if (proc.requires_machine) {
      const candidateMachines = machinesByType[proc.machine_type] || [];
      let best = null;
      for (const machine of candidateMachines) {
        const mBusy = machineBusy.get(machine.id) || [];
        const mSlot = findEarliestSlot(mBusy, activeShifts, proc.duration_minutes, notBefore);
        if (!mSlot) continue;
        const staffSlot = findEarliestStaffSlot(pool, staffOccupiedIntervals, activeShifts, proc.duration_minutes, mSlot.start);
        if (!staffSlot || staffSlot.start !== mSlot.start) {
          // máy rảnh nhưng đúng lúc đó không có nhân sự -> thử khớp lại: lấy
          // mốc muộn hơn giữa máy và người, xếp lại cả hai từ mốc đó.
          const notBefore2 = staffSlot ? Math.max(mSlot.start, staffSlot.start) : null;
          if (notBefore2 == null) continue;
          const mSlot2 = findEarliestSlot(mBusy, activeShifts, proc.duration_minutes, notBefore2);
          const staffSlot2 = mSlot2 ? findEarliestStaffSlot(pool, staffOccupiedIntervals, activeShifts, proc.duration_minutes, mSlot2.start) : null;
          if (!mSlot2 || !staffSlot2 || staffSlot2.start !== mSlot2.start) continue;
          const candidate = { start: mSlot2.start, end: mSlot2.end, machineId: machine.id, staffId: staffSlot2.staffId };
          if (!best || candidate.start < best.start) best = candidate;
          continue;
        }
        const candidate = { start: mSlot.start, end: mSlot.end, machineId: machine.id, staffId: staffSlot.staffId };
        if (!best || candidate.start < best.start) best = candidate;
      }
      return best;
    }
    const staffSlot = findEarliestStaffSlot(pool, staffOccupiedIntervals, activeShifts, proc.duration_minutes, notBefore);
    if (!staffSlot) return null;
    return { start: staffSlot.start, end: staffSlot.end, machineId: null, staffId: staffSlot.staffId };
  }

  /** Thử xếp 1 thủ thuật CHIA ĐÔI (tay nghề + theo dõi), có thể cần máy.
   * Người theo dõi có thể là 1 người cố định (fixedMonitorId) hoặc bất kỳ ai
   * trong monitor_roles, dùng mô hình "sức chứa" monitor_max_patients.
   *
   * QUAN TRỌNG: không được chỉ thử ĐÚNG 1 mốc giờ rồi bỏ cuộc nếu người theo
   * dõi bận lúc đó — vì người thực hiện (BS/YS) thường có nhiều lựa chọn thay
   * thế trong khi người theo dõi (đặc biệt là người cố định như Vi Thị Hoá /
   * Đỗ Văn Thắng) là tài nguyên khan hiếm hơn. Vì vậy ta duyệt qua các mốc
   * giờ mà người theo dõi CÓ THỂ rảnh (dựa trên lịch theo dõi hiện có của họ),
   * rồi mới tìm người thực hiện rảnh đúng khớp mốc đó — đảm bảo không bỏ sót
   * phương án khả thi chỉ vì thử sai thứ tự. */
  function planSplitProcedure(proc, notBefore, fixedMonitorStaffId) {
    const performPool = staffPoolForRoles(proc.perform_roles);
    const activeDur = proc.active_minutes;
    const monitorDur = proc.monitor_minutes;
    const totalDur = proc.duration_minutes;
    const capacity = proc.monitor_max_patients;
    const monitorCandidateIds = fixedMonitorStaffId ? [fixedMonitorStaffId] : staffPoolForRoles(proc.monitor_roles || []).map((s) => s.id);

    if (proc.requires_machine) {
      const candidateMachines = machinesByType[proc.machine_type] || [];
      let best = null;
      for (const machine of candidateMachines) {
        const mBusy = machineBusy.get(machine.id) || [];
        // Duyệt lần lượt các mốc máy có thể bắt đầu (không dừng lại ở mốc đầu
        // tiên nếu mốc đó không tìm được người thực hiện + người trông phù hợp).
        let t = notBefore;
        for (let guard = 0; guard < 1000; guard++) {
          const mSlot = findEarliestSlot(mBusy, activeShifts, totalDur, t);
          if (!mSlot) break;
          const performStaffId = findFreeStaffAt(performPool, mSlot.start, mSlot.start + activeDur);
          if (performStaffId) {
            const monitorStart = mSlot.start + activeDur;
            const monitorEnd = monitorStart + monitorDur;
            for (const monitorStaffId of monitorCandidateIds) {
              const mKey = monitorKey(proc) + ':' + monitorStaffId;
              if (capacityFits(getMonitorIntervals(mKey), monitorStart, monitorEnd, capacity) && !overlapsAny(staffOccupiedIntervals(monitorStaffId, mKey), monitorStart, monitorEnd)) {
                const candidate = { start: mSlot.start, end: mSlot.end, machineId: machine.id, performStaffId, monitorStaffId, monitorStart, monitorEnd };
                if (!best || candidate.start < best.start) best = candidate;
                break;
              }
            }
          }
          if (best && best.machineId === machine.id) break; // đã có phương án tốt nhất trên máy này
          t = mSlot.start + 1; // thử mốc kế tiếp trên cùng máy này
        }
      }
      return best;
    }

    // Không cần máy (TC, HC): tìm mốc SỚM NHẤT mà cả người theo dõi lẫn
    // người thực hiện đều rảnh, xét từng người theo dõi khả dĩ.
    let best = null;
    for (const monitorStaffId of monitorCandidateIds) {
      const mKey = monitorKey(proc) + ':' + monitorStaffId;
      const monitorIntervals = getMonitorIntervals(mKey);
      const candidateStarts = new Set([notBefore]);
      for (const shift of activeShifts) candidateStarts.add(Math.max(notBefore, shift.start));
      for (const iv of monitorIntervals) if (iv.end >= notBefore) candidateStarts.add(iv.end);
      const sortedStarts = Array.from(candidateStarts).sort((a, b) => a - b);

      for (const shift of activeShifts) {
        let foundInShift = null;
        for (const monitorStart of sortedStarts) {
          if (monitorStart < notBefore - MINUTE_EPS || monitorStart < shift.start - MINUTE_EPS) continue;
          const monitorEnd = monitorStart + monitorDur;
          if (monitorEnd > shift.end + MINUTE_EPS) continue;
          const performStart = monitorStart - activeDur;
          if (performStart < shift.start - MINUTE_EPS) continue;
          if (!capacityFits(monitorIntervals, monitorStart, monitorEnd, capacity)) continue;
          if (overlapsAny(staffOccupiedIntervals(monitorStaffId, mKey), monitorStart, monitorEnd)) continue;
          const performStaffId = findFreeStaffAt(performPool, performStart, monitorStart);
          if (!performStaffId) continue;
          foundInShift = { start: performStart, end: monitorEnd, machineId: null, performStaffId, monitorStaffId, monitorStart, monitorEnd };
          break; // sortedStarts tăng dần -> mốc đầu tiên khớp là sớm nhất trong ca này
        }
        if (foundInShift) {
          if (!best || foundInShift.start < best.start) best = foundInShift;
          break; // ca sau chỉ muộn hơn, không cần xét tiếp cho người theo dõi này
        }
      }
    }
    return best;
  }

  function commitSimple(proc, plan, patientState) {
    addStaffBusy(plan.staffId, plan.start, plan.end);
    if (plan.machineId) {
      machineBusy.get(plan.machineId).push({ start: plan.start, end: plan.end + (proc.rest_after_minutes || 0) });
      machineUsedMinutes.set(plan.machineId, (machineUsedMinutes.get(plan.machineId) || 0) + (plan.end - plan.start));
    }
    scheduleEntries.push({
      patientId: patientState.id,
      procedureCode: proc.code,
      machineId: plan.machineId,
      start: plan.start,
      end: plan.end,
      staffAssignments: [{ staffId: plan.staffId, start: plan.start, end: plan.end, roleType: 'performer' }],
    });
    patientState.cursor = Math.max(patientState.cursor, plan.end + transferBufferMinutes);
  }

  function commitSplit(proc, plan, patientState) {
    addStaffBusy(plan.performStaffId, plan.start, plan.start + proc.active_minutes);
    const mKey = monitorKey(proc) + ':' + plan.monitorStaffId;
    getMonitorIntervals(mKey).push({ start: plan.monitorStart, end: plan.monitorEnd });
    if (plan.machineId) {
      machineBusy.get(plan.machineId).push({ start: plan.start, end: plan.end + (proc.rest_after_minutes || 0) });
      machineUsedMinutes.set(plan.machineId, (machineUsedMinutes.get(plan.machineId) || 0) + (plan.end - plan.start));
    }
    const staffAssignments = [
      { staffId: plan.performStaffId, start: plan.start, end: plan.start + proc.active_minutes, roleType: 'performer' },
      { staffId: plan.monitorStaffId, start: plan.monitorStart, end: plan.monitorEnd, roleType: 'monitor' },
    ];
    staffWorkMinutes.set(plan.monitorStaffId, (staffWorkMinutes.get(plan.monitorStaffId) || 0) + (plan.monitorEnd - plan.monitorStart));
    scheduleEntries.push({
      patientId: patientState.id,
      procedureCode: proc.code,
      machineId: plan.machineId,
      start: plan.start,
      end: plan.end,
      staffAssignments,
    });
    patientState.cursor = Math.max(patientState.cursor, plan.end + transferBufferMinutes);
  }

  function fixedMonitorFor(proc) {
    return proc.fixed_monitor_staff_id || null;
  }

  /** Với 1 lượt "khe co dãn" (VD bước Điện châm/Hào châm), tính phương án tốt
   * nhất đồng thời áp dụng thiên hướng ưu tiên phương án "chính" (dùng máy)
   * hơn phương án "dự phòng", TRỪ khi chờ phương án chính khiến bệnh nhân
   * không kịp hoàn tất các bước còn lại trong ca. */
  function chooseBiasedOption(primaryPlan, fallbackPlan, notBefore, remainingDurationAfterThis) {
    if (!primaryPlan && !fallbackPlan) return null;
    if (!fallbackPlan) return { plan: primaryPlan, usedPrimary: true };
    if (!primaryPlan) return { plan: fallbackPlan, usedPrimary: false };
    // Ca hiện tại (dựa theo notBefore) còn bao nhiêu thời gian?
    const shift = activeShifts.find((s) => notBefore >= s.start - MINUTE_EPS && notBefore <= s.end + MINUTE_EPS) || activeShifts[activeShifts.length - 1];
    const latestSafeStart = shift.end - remainingDurationAfterThis;
    if (primaryPlan.start <= latestSafeStart + MINUTE_EPS) {
      return { plan: primaryPlan, usedPrimary: true };
    }
    return { plan: fallbackPlan, usedPrimary: false };
  }

  // ---- Xử lý từng bệnh nhân theo thứ tự STT ----
  const sortedPatients = patients.slice().sort((a, b) => a.stt - b.stt);
  const procByCode = Object.fromEntries(Object.values(procedures).map((p) => [p.code, p]));

  /** Thử xếp đủ 4 bước cho 1 bệnh nhân, CHỈ TRONG PHẠM VI 1 buổi (shiftWindow).
   * Trả về { ok, missing, comboCode }. Không tự rollback — bên gọi (vòng lặp
   * chính) chịu trách nhiệm chụp/khôi phục trạng thái quanh lời gọi này. */
  function attemptPatientInShift(patient, shiftWindow) {
    activeShifts = [shiftWindow];
    const comboOverride = patient.comboOverride && comboLabels[patient.comboOverride];
    const forceStep2 = comboOverride ? comboOverride.step2Code : null;
    const forceStep4 = comboOverride ? comboOverride.step4Code : null;

    const patientState = { id: patient.id, cursor: shiftWindow.start };
    let usedStep2 = null; // 'DC' | 'HC'
    let usedStep4 = null; // 'XH' | 'CN'
    const missing = [];

    // Bước A: Xoa bóp bấm huyệt (cố định, không có biến thể)
    {
      const proc = procByCode.XBBH;
      const plan = planSimpleProcedure(proc, patientState.cursor);
      if (plan) {
        commitSimple(proc, plan, patientState);
      } else {
        missing.push(proc.code);
      }
    }

    // Bước B + D còn linh hoạt thứ tự: lặp tối đa 2 lần, mỗi lần chọn bước
    // nào cho kết quả hoàn thành sớm nhất (có thiên hướng ưu tiên máy).
    const pendingFlexSteps = ['step2', 'step4'];
    // ước lượng thời lượng còn lại tối thiểu cho từng bước để tính latestSafeStart
    const minDurStep2 = Math.min(procByCode.DC.duration_minutes, procByCode.HC.duration_minutes);
    const minDurStep4 = Math.min(procByCode.XH.duration_minutes, procByCode.CN.duration_minutes);
    const minDurTC = procByCode.TC.duration_minutes;

    let step3Done = false;
    while (pendingFlexSteps.length > 0 || !step3Done) {
      const options = [];

      if (pendingFlexSteps.includes('step2')) {
        const remainingAfter = (pendingFlexSteps.includes('step4') ? minDurStep4 : 0) + (!step3Done ? minDurTC : 0);
        let primaryPlan = null;
        let fallbackPlan = null;
        if (!forceStep2 || forceStep2 === 'DC') {
          primaryPlan = planSplitProcedure(procByCode.DC, patientState.cursor, fixedMonitorFor(procByCode.DC));
        }
        if (!forceStep2 || forceStep2 === 'HC') {
          fallbackPlan = planSplitProcedure(procByCode.HC, patientState.cursor, fixedMonitorFor(procByCode.HC));
        }
        const choice = forceStep2
          ? (forceStep2 === 'DC' ? (primaryPlan && { plan: primaryPlan, usedPrimary: true }) : (fallbackPlan && { plan: fallbackPlan, usedPrimary: false }))
          : chooseBiasedOption(primaryPlan, fallbackPlan, patientState.cursor, remainingAfter);
        if (choice) {
          options.push({ key: 'step2', finish: choice.plan.end, choice });
        }
      }
      if (pendingFlexSteps.includes('step4')) {
        const remainingAfter = (pendingFlexSteps.includes('step2') ? minDurStep2 : 0) + (!step3Done ? minDurTC : 0);
        let primaryPlan = null;
        let fallbackPlan = null;
        if (!forceStep4 || forceStep4 === 'XH') {
          primaryPlan = planSimpleProcedure(procByCode.XH, patientState.cursor);
        }
        if (!forceStep4 || forceStep4 === 'CN') {
          fallbackPlan = planSimpleProcedure(procByCode.CN, patientState.cursor);
        }
        const choice = forceStep4
          ? (forceStep4 === 'XH' ? (primaryPlan && { plan: primaryPlan, usedPrimary: true }) : (fallbackPlan && { plan: fallbackPlan, usedPrimary: false }))
          : chooseBiasedOption(primaryPlan, fallbackPlan, patientState.cursor, remainingAfter);
        if (choice) {
          options.push({ key: 'step4', finish: choice.plan.end, choice });
        }
      }
      if (!step3Done) {
        const remainingAfter = (pendingFlexSteps.includes('step2') ? minDurStep2 : 0) + (pendingFlexSteps.includes('step4') ? minDurStep4 : 0);
        const plan = planSplitProcedure(procByCode.TC, patientState.cursor, fixedMonitorFor(procByCode.TC));
        if (plan) options.push({ key: 'step3', finish: plan.end, choice: { plan, usedPrimary: true } });
      }

      if (options.length === 0) {
        // không còn bước nào xếp được nữa trong ngày -> đánh dấu các bước còn thiếu
        if (pendingFlexSteps.includes('step2')) missing.push(forceStep2 || 'DC/HC');
        if (pendingFlexSteps.includes('step4')) missing.push(forceStep4 || 'XH/CN');
        if (!step3Done) missing.push('TC');
        break;
      }

      options.sort((a, b) => a.finish - b.finish);
      const winner = options[0];

      if (winner.key === 'step2') {
        const procCode = winner.choice.usedPrimary ? (forceStep2 || 'DC') : (forceStep2 ? (forceStep2 === 'DC' ? 'HC' : 'DC') : 'HC');
        const proc = procByCode[procCode];
        commitSplit(proc, winner.choice.plan, patientState);
        usedStep2 = procCode;
        pendingFlexSteps.splice(pendingFlexSteps.indexOf('step2'), 1);
      } else if (winner.key === 'step4') {
        const procCode = winner.choice.usedPrimary ? (forceStep4 || 'XH') : (forceStep4 ? (forceStep4 === 'XH' ? 'CN' : 'XH') : 'CN');
        const proc = procByCode[procCode];
        commitSimple(proc, winner.choice.plan, patientState);
        usedStep4 = procCode;
        pendingFlexSteps.splice(pendingFlexSteps.indexOf('step4'), 1);
      } else {
        commitSplit(procByCode.TC, winner.choice.plan, patientState);
        step3Done = true;
      }
    }

    const comboCode = comboOverride
      ? patient.comboOverride
      : Object.keys(comboLabels).find((code) => {
          const c = comboLabels[code];
          return c.step2Code === usedStep2 && c.step4Code === usedStep4;
        }) || null;

    // gắn nhãn combo vào các entry vừa tạo cho bệnh nhân này (chỉ có ý nghĩa
    // nếu attempt này thành công; nếu thất bại, bên gọi sẽ rollback nên các
    // entry này biến mất theo, không cần dọn ở đây)
    for (const entry of scheduleEntries) {
      if (entry.patientId === patient.id && !entry.comboCode) entry.comboCode = comboCode;
    }

    return { ok: missing.length === 0, missing, comboCode };
  }

  for (const patient of sortedPatients) {
    let outcome = null;
    for (const shiftWindow of shifts) {
      const snap = snapshotState();
      outcome = attemptPatientInShift(patient, shiftWindow);
      if (outcome.ok) break;
      restoreState(snap); // buổi này không đủ chỗ cho ĐỦ 4 bước -> hoàn tác sạch, thử buổi kế tiếp từ đầu
    }
    if (!outcome.ok) {
      warnings.push({ patientId: patient.id, patientName: patient.name, stt: patient.stt, missingSteps: outcome.missing });
    } else if (outcome.comboCode) {
      comboCount[outcome.comboCode] = (comboCount[outcome.comboCode] || 0) + 1;
    }
  }

  // ---- Tổng hợp số liệu ----
  const totalPatients = patients.length;
  const completedPatients = totalPatients - warnings.length;
  const machineUtilization = machines.map((m) => {
    const capacityMinutes = shifts.reduce((sum, s) => sum + (s.end - s.start), 0);
    const used = machineUsedMinutes.get(m.id) || 0;
    return { machineId: m.id, name: m.name, type: m.type, usedMinutes: used, capacityMinutes, utilizationPct: capacityMinutes ? Math.round((used / capacityMinutes) * 1000) / 10 : 0 };
  });
  // "workMinutes" cộng dồn cả lúc theo dõi song song nhiều bệnh nhân (VD 1
  // điều dưỡng trông cùng lúc 4 người 19 phút = 76 phút quy đổi công việc),
  // nên tách riêng "occupiedMinutes" = thời gian THỰC TẾ người đó bận (gộp
  // các khoảng chồng lấn lại), để không hiểu nhầm là làm việc vượt quá 1 ca.
  function unionMinutes(intervals) {
    if (intervals.length === 0) return 0;
    const sorted = intervals.slice().sort((a, b) => a.start - b.start);
    let total = 0;
    let curStart = sorted[0].start;
    let curEnd = sorted[0].end;
    for (let i = 1; i < sorted.length; i++) {
      const iv = sorted[i];
      if (iv.start <= curEnd + MINUTE_EPS) {
        curEnd = Math.max(curEnd, iv.end);
      } else {
        total += curEnd - curStart;
        curStart = iv.start;
        curEnd = iv.end;
      }
    }
    total += curEnd - curStart;
    return total;
  }
  const staffWorkload = staff.map((s) => ({
    staffId: s.id,
    name: s.name,
    role: s.role,
    workMinutes: staffWorkMinutes.get(s.id) || 0,
    occupiedMinutes: unionMinutes(staffOccupiedIntervals(s.id)),
  }));

  return {
    scheduleEntries,
    warnings,
    summary: {
      totalPatients,
      completedPatients,
      incompletePatients: warnings.length,
      comboCount,
      machineUtilization,
      staffWorkload,
    },
  };
}

module.exports = { generateSchedule, findEarliestSlot, findEarliestCapacitySlot, capacityFits, minutesToHHMM };
