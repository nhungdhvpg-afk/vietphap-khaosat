// ============================================================================
// THUẬT TOÁN CHIA THỦ THUẬT Y HỌC CỔ TRUYỀN — VIỆT PHÁP
// ============================================================================
// Đầu vào: danh sách bệnh nhân trong ngày (chỉ cần STT + Họ tên) + cấu hình
// (nhân sự, máy móc, loại thủ thuật, ca làm việc).
//
// Phác đồ chuẩn (mặc định cho mọi bệnh nhân, trừ khi ép combo khác) — gồm 4
// bước, THỨ TỰ HOÀN TOÀN LINH HOẠT (kể cả Xoa bóp bấm huyệt), để có thể xếp
// Xông hơi ngay từ đầu ca khi máy còn rảnh thay vì luôn phải xoa bóp trước:
//   Xoa bóp bấm huyệt (XBBH)
//   Điện châm (DC) ưu tiên, dự phòng Hào châm (HC) khi hết máy/chỗ
//   Thủy châm (TC)
//   Xông hơi (XH) ưu tiên, dự phòng Cứu ngải (CN) khi hết máy/chỗ
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

// Khoảng đệm bắt buộc giữa lúc 1 người/1 máy vừa xong việc cho bệnh nhân này
// và lúc bắt đầu việc cho bệnh nhân KẾ TIẾP trên đúng người/máy đó — không
// được phép giờ kết thúc của người này trùng khít giờ bắt đầu của người sau
// (VD: BN1 xong máy Xông lúc 07:38 thì BN2 dùng máy đó sớm nhất là 07:39).
// Áp dụng đồng loạt cho MỌI thủ thuật/máy/nhân sự thực hiện — KHÔNG áp dụng
// cho việc "theo dõi" nhiều bệnh nhân cùng lúc (sức chứa), vì đó vốn dĩ được
// phép chồng giờ thật sự (1 điều dưỡng trông song song nhiều người).
const RESOURCE_HANDOFF_MINUTES = 1;

// Chỉ có 1 bác sĩ khám (Mai Thị Thủy) khám tuần tự từng bệnh nhân rồi chỉ
// định đi làm thủ thuật — không thể 2 người cùng bắt đầu làm thủ thuật cùng
// lúc, vì khám xong người này (1 phút) mới khám tiếp người sau (1 phút nữa)
// rồi mới chỉ định họ đi làm thủ thuật. Vậy nên mốc SỚM NHẤT bệnh nhân thứ
// N (tính theo thứ tự vào khám trong CÙNG 1 buổi) được phép bắt đầu bất kỳ
// bước nào phải cách bệnh nhân N-1 ít nhất 2 phút (VD BN1 07:01 -> BN2
// 07:03 -> BN3 07:05...), khớp ví dụ CEO đưa ra.
const EXAM_PACING_MINUTES = 2;

/** Tìm khoảng thời gian rảnh sớm nhất (>= notBefore) đủ `duration` phút, nằm
 * trọn trong 1 trong các khung ca `shifts`, không đụng các khoảng bận đã có
 * trong `busyIntervals` (mảng {start,end}, không cần sắp xếp trước), CÁCH
 * mỗi khoảng bận đó ít nhất `gap` phút (mặc định 0 = cho phép nối sát giờ). */
function findEarliestSlot(busyIntervals, shifts, duration, notBefore, gap = 0) {
  const sorted = busyIntervals.slice().sort((a, b) => a.start - b.start);
  for (const shift of shifts) {
    let candidate = Math.max(notBefore, shift.start);
    if (candidate + duration > shift.end + MINUTE_EPS) continue; // không đủ chỗ trong ca này nữa
    // Duyệt qua các khoảng bận nằm trong ca này, đẩy candidate tới sau mỗi khoảng chồng lấn (cộng khoảng đệm).
    for (const busy of sorted) {
      if (busy.end + gap <= candidate + MINUTE_EPS) continue;
      if (busy.start - gap >= candidate + duration - MINUTE_EPS) break; // không còn chồng lấn/đệm nữa (đã sort)
      // chồng lấn (hoặc trong khoảng đệm) -> đẩy candidate ra sau khoảng bận này CỘNG khoảng đệm
      candidate = busy.end + gap;
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
function findEarliestStaffSlot(staffPool, getBusy, shifts, duration, notBefore, gap = 0) {
  let best = null;
  for (const staff of staffPool) {
    const busy = getBusy(staff.id);
    const slot = findEarliestSlot(busy, shifts, duration, notBefore, gap);
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
 * @param {object} config - { shifts, transferBufferMinutes, procedures, staff, machines,
 *   comboLabels, optimizationMode }. optimizationMode:
 *   - 'max_xong' (mặc định): tận dụng Xông hơi/Điện châm mỗi khi vẫn còn máy
 *     VÀ không làm hỏng khả năng hoàn tất các bước khác của bệnh nhân đó —
 *     phù hợp khi số bệnh nhân/ngày còn trong khả năng đáp ứng, muốn khai
 *     thác tối đa 2 máy Xông hiện có.
 *   - 'max_patients': bỏ thiên hướng ưu tiên máy, luôn chọn phương án nào
 *     xong sớm hơn cho từng bệnh nhân (Xông/Cứu ngải, Điện/Hào châm đều như
 *     nhau) — phù hợp khi lượng bệnh nhân vượt khả năng đáp ứng của 2 máy
 *     Xông, cần tối đa số người được phục vụ trong ngày hơn là tối đa số
 *     lượt Xông.
 * @param {Array}  patients - [{ id, stt, name }], đã sắp theo stt tăng dần hoặc sẽ được sắp lại.
 * @returns {object} { scheduleEntries, warnings, summary }
 */
function generateSchedule(config, patients) {
  const {
    shifts: rawShifts,
    transferBufferMinutes = 2,
    procedures,
    staff,
    machines,
    comboLabels = {},
    optimizationMode = 'max_xong',
    // Số "suất" muốn để dành cho bệnh nhân mới nhập viện thêm sau, tính theo
    // từng buổi (mảng song song với `shifts`, VD [3, 2] = dành 3 suất sáng,
    // 2 suất chiều) — ước lượng 1 suất ~ EXAM_PACING_MINUTES phút (đúng bằng
    // nhịp khám tối đa của 1 bác sĩ khám), nên "dành N suất" tương đương thu
    // hẹp giờ kết thúc khả dụng của buổi đó lại N*EXAM_PACING_MINUTES phút
    // cho danh sách bệnh nhân "đã biết trước" — chỉ áp dụng cho lượt tự động
    // xếp bình thường, KHÔNG áp dụng khi thêm 1 bệnh nhân cụ thể sau này
    // (lúc đó dùng đúng khung giờ CÒN LẠI, xem forcedExamFloor bên dưới).
    reservedSlotsByShift = null,
    // Lịch đã CHỐT từ lần chia trước (nếu có) — dùng khi CHỈ thêm 1 bệnh nhân
    // mới vào lịch đã có, KHÔNG được xếp lại những người đã có. Các mảng
    // trạng thái tài nguyên bên dưới sẽ được "phát lại" (replay) từ đây
    // TRƯỚC KHI xử lý `patients` — nghĩa là `patients` truyền vào trong
    // trường hợp này CHỈ nên chứa (những) bệnh nhân MỚI, không lặp lại người
    // đã có trong `existingScheduleEntries`.
    existingScheduleEntries = [],
    // Khi thêm 1 bệnh nhân cụ thể vào lịch đã có, người dùng tự chọn giờ bắt
    // đầu mong muốn thay vì để hệ thống tự tính theo nhịp khám tuần tự — set
    // giá trị này (số phút từ 00:00) để ép TOÀN BỘ bệnh nhân trong `patients`
    // không được bắt đầu sớm hơn mốc này, bỏ qua bộ đếm nhịp khám tự động.
    forcedExamFloor = null,
    // Giá trị KHỞI ĐẦU của bộ đếm nhịp khám mỗi buổi (mảng song song với
    // `shifts`) — dùng khi cần "nối tiếp" đúng nhịp khám từ 1 lượt chạy
    // TRƯỚC đó (VD lượt chạy thử "còn nhận thêm được bao nhiêu người", chạy
    // nối tiếp ngay sau lượt chia thật, không được để nhịp khám reset về 0
    // rồi tính sai). Mặc định 0 cho mỗi buổi (hành vi cũ, không đổi).
    initialExamCounters = null,
  } = config;

  // Số suất muốn "để dành" (reservedSlotsByShift) KHÔNG còn được hiện thực
  // hoá bằng cách thu hẹp giờ kết thúc ca (đã bỏ — một suất để dành cần TRỌN
  // VẸN thời lượng 1 phác đồ thật, dài hơn NHIỀU so với vài phút nhịp khám,
  // nên thu hẹp vài phút không đủ đảm bảo giữ được chỗ khi danh sách ngoại
  // trú dài). Thay vào đó, số suất này được caller (api/ctt-generate.js) biến
  // thành các bệnh nhân "giữ chỗ" BNM cụ thể, xếp cùng danh sách và được ưu
  // tiên xếp TRƯỚC bệnh nhân ngoại trú (xem `tierOf`/`candidateShiftsFor` bên
  // dưới) — nhờ vậy suất để dành LUÔN THỰC SỰ được giữ, dù danh sách ngoại
  // trú dài bao nhiêu. `reservedSlotsByShift` chỉ còn dùng để HIỂN THỊ lại
  // đúng số suất đã yêu cầu trong phần tổng kết (shiftCapacity) bên dưới.
  const reservedByShift = reservedSlotsByShift || rawShifts.map(() => 0);
  const shifts = rawShifts.map((s) => ({ start: s.start, end: s.end }));

  // Mỗi bệnh nhân PHẢI hoàn tất cả 4 bước TRONG CÙNG 1 buổi (đến 1 lần, làm
  // xong rồi về — không quay lại buổi sau). `activeShifts` là buổi đang được
  // thử cho bệnh nhân hiện tại; mọi hàm tìm chỗ trống bên dưới đều tra cứu
  // biến này (qua closure) thay vì toàn bộ danh sách ca, để không bao giờ vô
  // tình xếp 1 người vắt sang buổi khác.
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
  // Luôn ưu tiên gọi BS trước YS trước DD, BẤT KỂ thứ tự vai trò được liệt kê
  // trong cấu hình — vì trong thực tế chỉ Y sĩ/Điều dưỡng được làm Xông hơi
  // (perform_roles của XH không có BS), nên YS là nguồn lực khan hiếm cần
  // dành riêng cho việc đó. Nếu để 1 thủ thuật khác (VD Cứu ngải) vô tình gọi
  // YS trước dù BS (nguồn lực dồi dào hơn) cũng làm được, sẽ làm giảm oan số
  // lượt Xông hơi thực hiện được trong ngày.
  const ROLE_PRIORITY = ['BS', 'YS', 'DD'];
  const staffPoolForRoles = (roles) => {
    const roleSet = new Set(roles);
    return ROLE_PRIORITY.filter((r) => roleSet.has(r)).flatMap((r) => staffByRole[r] || []);
  };

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
  function overlapsAny(intervals, start, end, gap = 0) {
    return intervals.some((iv) => iv.start - gap < end - MINUTE_EPS && iv.end + gap > start + MINUTE_EPS);
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
    return !overlapsAny(staffOccupiedIntervals(staffId), start, end, RESOURCE_HANDOFF_MINUTES);
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

  // ---- "Phát lại" lịch đã CHỐT từ lần chia trước (nếu có) ----
  // Chỉ dùng khi thêm bệnh nhân MỚI vào lịch đã có sẵn — nạp lại đúng những
  // khoảng tài nguyên đã bị chiếm bởi các lượt CŨ, để thuật toán biết mà
  // tránh, nhưng KHÔNG chạy lại logic xếp lịch cho những người cũ đó (nên
  // giờ giấc/nhân sự của họ tuyệt đối không đổi).
  {
    const countedComboPatientIds = new Set();
    for (const oldEntry of existingScheduleEntries) {
      scheduleEntries.push({ ...oldEntry, staffAssignments: oldEntry.staffAssignments.map((a) => ({ ...a })) });
      for (const a of oldEntry.staffAssignments) {
        if (a.roleType === 'monitor') {
          const mKey = oldEntry.procedureCode + ':' + a.staffId;
          getMonitorIntervals(mKey).push({ start: a.start, end: a.end });
        } else {
          if (!staffBusy.has(a.staffId)) staffBusy.set(a.staffId, []);
          staffBusy.get(a.staffId).push({ start: a.start, end: a.end });
        }
        staffWorkMinutes.set(a.staffId, (staffWorkMinutes.get(a.staffId) || 0) + (a.end - a.start));
      }
      if (oldEntry.machineId) {
        if (!machineBusy.has(oldEntry.machineId)) machineBusy.set(oldEntry.machineId, []);
        machineBusy.get(oldEntry.machineId).push({ start: oldEntry.start, end: oldEntry.end });
        machineUsedMinutes.set(oldEntry.machineId, (machineUsedMinutes.get(oldEntry.machineId) || 0) + (oldEntry.end - oldEntry.start));
      }
      if (oldEntry.comboCode && !countedComboPatientIds.has(oldEntry.patientId)) {
        countedComboPatientIds.add(oldEntry.patientId);
        comboCount[oldEntry.comboCode] = (comboCount[oldEntry.comboCode] || 0) + 1;
      }
    }
  }

  /** Chụp lại toàn bộ trạng thái tài nguyên đang dùng, để có thể HOÀN TÁC về
   * đúng lúc này (dù đã đi xa hơn hay đã lùi lại trước đó) — dùng khi 1 bệnh
   * nhân thử xếp dở trong 1 buổi rồi không xong, hoặc khi cần thử CẢ 2 buổi
   * rồi mới quyết định áp dụng đúng 1 kết quả. Lưu NGUYÊN VẸN nội dung
   * scheduleEntries (không chỉ độ dài) để có thể áp lại đúng, kể cả khi kết
   * quả cần áp lại "dài" hơn trạng thái hiện tại. */
  function snapshotState() {
    return {
      staffBusy: Array.from(staffBusy, ([k, v]) => [k, v.slice()]),
      machineBusy: Array.from(machineBusy, ([k, v]) => [k, v.slice()]),
      monitorLoad: Array.from(monitorLoad, ([k, v]) => [k, v.slice()]),
      staffWorkMinutes: Array.from(staffWorkMinutes),
      machineUsedMinutes: Array.from(machineUsedMinutes),
      scheduleEntries: scheduleEntries.slice(),
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
    scheduleEntries.splice(0, scheduleEntries.length, ...snap.scheduleEntries);
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
        const mSlot = findEarliestSlot(mBusy, activeShifts, proc.duration_minutes, notBefore, RESOURCE_HANDOFF_MINUTES);
        if (!mSlot) continue;
        const staffSlot = findEarliestStaffSlot(pool, staffOccupiedIntervals, activeShifts, proc.duration_minutes, mSlot.start, RESOURCE_HANDOFF_MINUTES);
        if (!staffSlot || staffSlot.start !== mSlot.start) {
          // máy rảnh nhưng đúng lúc đó không có nhân sự -> thử khớp lại: lấy
          // mốc muộn hơn giữa máy và người, xếp lại cả hai từ mốc đó.
          const notBefore2 = staffSlot ? Math.max(mSlot.start, staffSlot.start) : null;
          if (notBefore2 == null) continue;
          const mSlot2 = findEarliestSlot(mBusy, activeShifts, proc.duration_minutes, notBefore2, RESOURCE_HANDOFF_MINUTES);
          const staffSlot2 = mSlot2 ? findEarliestStaffSlot(pool, staffOccupiedIntervals, activeShifts, proc.duration_minutes, mSlot2.start, RESOURCE_HANDOFF_MINUTES) : null;
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
    const staffSlot = findEarliestStaffSlot(pool, staffOccupiedIntervals, activeShifts, proc.duration_minutes, notBefore, RESOURCE_HANDOFF_MINUTES);
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
          const mSlot = findEarliestSlot(mBusy, activeShifts, totalDur, t, RESOURCE_HANDOFF_MINUTES);
          if (!mSlot) break;
          const performStaffId = findFreeStaffAt(performPool, mSlot.start, mSlot.start + activeDur);
          if (performStaffId) {
            const monitorStart = mSlot.start + activeDur;
            const monitorEnd = monitorStart + monitorDur;
            for (const monitorStaffId of monitorCandidateIds) {
              const mKey = monitorKey(proc) + ':' + monitorStaffId;
              if (capacityFits(getMonitorIntervals(mKey), monitorStart, monitorEnd, capacity) && !overlapsAny(staffOccupiedIntervals(monitorStaffId, mKey), monitorStart, monitorEnd, RESOURCE_HANDOFF_MINUTES)) {
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
      const candidateStarts = new Set([notBefore, notBefore + activeDur]);
      for (const shift of activeShifts) {
        const shiftFloor = Math.max(notBefore, shift.start);
        candidateStarts.add(shiftFloor);
        // Mốc "người thực hiện bắt đầu đúng lúc ca/notBefore cho phép sớm
        // nhất" — nếu thiếu mốc này, khi notBefore > shift.start (VD do giãn
        // cách khám EXAM_PACING_MINUTES) và chưa có ai từng đặt lịch trước đó
        // (mảng bận rỗng), tập ứng viên có thể KHÔNG có mốc nào thoả performStart
        // >= notBefore, khiến thuật toán kết luận nhầm "hết chỗ" dù ca còn trống.
        candidateStarts.add(shiftFloor + activeDur);
      }
      for (const iv of monitorIntervals) if (iv.end >= notBefore) candidateStarts.add(iv.end);
      // QUAN TRỌNG: cũng thử các mốc mà TỪNG người thực hiện khả dĩ vừa rảnh ra
      // (không chỉ mốc người theo dõi rảnh) — nếu chỉ dựa vào lịch người theo
      // dõi, lúc TẤT CẢ người thực hiện (VD toàn bộ BS, riêng Thủy châm chỉ
      // BS được làm) đang bận đúng lúc `notBefore` thì thuật toán bỏ cuộc
      // ngay lập tức dù họ sắp rảnh trong vài phút tới và ca vẫn còn thừa thời
      // gian — đây chính là nguyên nhân khiến hệ thống kết luận nhầm "không
      // đủ chỗ" và chọn Cứu ngải thay vì Xông hơi dù máy Xông vẫn còn rảnh.
      for (const perf of performPool) {
        for (const iv of staffOccupiedIntervals(perf.id)) {
          const candidate = iv.end + RESOURCE_HANDOFF_MINUTES + activeDur;
          if (candidate >= notBefore) candidateStarts.add(candidate);
        }
      }
      const sortedStarts = Array.from(candidateStarts).sort((a, b) => a - b);

      for (const shift of activeShifts) {
        let foundInShift = null;
        for (const monitorStart of sortedStarts) {
          if (monitorStart < notBefore - MINUTE_EPS || monitorStart < shift.start - MINUTE_EPS) continue;
          const monitorEnd = monitorStart + monitorDur;
          if (monitorEnd > shift.end + MINUTE_EPS) continue;
          const performStart = monitorStart - activeDur;
          // Phải >= notBefore (không chỉ >= shift.start) — nếu không, khi
          // notBefore lớn hơn shift.start (VD do khoảng cách giãn cách khám
          // EXAM_PACING_MINUTES, hoặc cursor của bệnh nhân đã trôi qua vài
          // bước trước đó), người thực hiện có thể bị đẩy bắt đầu SỚM HƠN cả
          // notBefore — vi phạm đúng ràng buộc mà notBefore được truyền vào
          // để đảm bảo.
          if (performStart < notBefore - MINUTE_EPS) continue;
          if (!capacityFits(monitorIntervals, monitorStart, monitorEnd, capacity)) continue;
          if (overlapsAny(staffOccupiedIntervals(monitorStaffId, mKey), monitorStart, monitorEnd, RESOURCE_HANDOFF_MINUTES)) continue;
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
      // "Nghỉ sau" (VD Xông hơi 15') là BỆNH NHÂN cần nghỉ trước khi sang
      // bước kế tiếp — máy được dùng ngay cho người khác, không bị khoá.
      machineBusy.get(plan.machineId).push({ start: plan.start, end: plan.end });
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
    patientState.cursor = Math.max(patientState.cursor, plan.end + (proc.rest_after_minutes || 0) + transferBufferMinutes);
  }

  function commitSplit(proc, plan, patientState) {
    addStaffBusy(plan.performStaffId, plan.start, plan.start + proc.active_minutes);
    const mKey = monitorKey(proc) + ':' + plan.monitorStaffId;
    getMonitorIntervals(mKey).push({ start: plan.monitorStart, end: plan.monitorEnd });
    if (plan.machineId) {
      // Xem ghi chú ở commitSimple: "nghỉ sau" thuộc về bệnh nhân, không khoá máy.
      machineBusy.get(plan.machineId).push({ start: plan.start, end: plan.end });
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
    patientState.cursor = Math.max(patientState.cursor, plan.end + (proc.rest_after_minutes || 0) + transferBufferMinutes);
  }

  function fixedMonitorFor(proc) {
    return proc.fixed_monitor_staff_id || null;
  }

  /** Với 1 lượt "khe co dãn" (VD Điện châm/Hào châm, hoặc Xông hơi/Cứu ngải):
   *
   * - Chế độ 'max_xong' (mặc định): ưu tiên phương án "chính" (dùng máy —
   *   Điện châm/Xông hơi) hơn "dự phòng", NHƯNG chỉ khi chọn phương án chính
   *   không làm hỏng khả năng hoàn tất các bước còn lại của bệnh nhân. Dùng
   *   `checkStillFeasible(cursorAfter)` — thử THẬT (không heuristic phỏng
   *   đoán thời lượng) xem các bước còn lại có còn xếp được không nếu bệnh
   *   nhân rảnh từ `cursorAfter` — để không bỏ lỡ máy Xông/Châm còn trống
   *   chỉ vì ước lượng sai.
   * - Chế độ 'max_patients': bỏ hẳn thiên hướng ưu tiên máy, luôn chọn
   *   phương án nào cho bệnh nhân xong SỚM HƠN — để tối đa tổng số bệnh
   *   nhân phục vụ được trong ngày thay vì tối đa số lượt dùng máy Xông. */
  function chooseBiasedOption(primaryPlan, fallbackPlan, checkStillFeasible) {
    if (!primaryPlan && !fallbackPlan) return null;
    if (!fallbackPlan) return { plan: primaryPlan, usedPrimary: true };
    if (!primaryPlan) return { plan: fallbackPlan, usedPrimary: false };
    if (optimizationMode === 'max_patients') {
      return primaryPlan.end <= fallbackPlan.end
        ? { plan: primaryPlan, usedPrimary: true }
        : { plan: fallbackPlan, usedPrimary: false };
    }
    if (checkStillFeasible(primaryPlan.end + transferBufferMinutes)) {
      return { plan: primaryPlan, usedPrimary: true };
    }
    return { plan: fallbackPlan, usedPrimary: false };
  }

  // ---- Xử lý từng bệnh nhân, theo 3 tầng ưu tiên:
  //   Tầng 0: bệnh nhân "ra viện hôm nay" — luôn xếp trước tiên, vào khung giờ
  //     SỚM NHẤT của buổi SÁNG (bắt buộc, không được trôi sang buổi chiều).
  //   Tầng 1: bệnh nhân "giữ chỗ" BNM (buổi sáng/chiều) — xếp NGAY SAU người
  //     ra viện, TRƯỚC MỌI bệnh nhân ngoại trú, khoá cứng đúng 1 buổi theo
  //     `placeholderShift`. Xếp trước ngoại trú (thay vì sau) là ĐIỀU BẮT
  //     BUỘC để suất để dành LUÔN THỰC SỰ được giữ — nếu xếp sau, khi danh
  //     sách ngoại trú đủ dài để dùng hết công suất cả ngày (rất thường gặp),
  //     người giữ chỗ sẽ bị "ăn" mất chỗ hoàn toàn dù đã để dành. Cũng vì lý
  //     do này mà việc "để dành" KHÔNG thể chỉ đơn giản thu hẹp vài phút cuối
  //     ca (một phác đồ đầy đủ cần nhiều thời gian hơn nhiều so với vài phút
  //     nhịp khám) — phải giữ chỗ bằng cách xếp THẬT các bệnh nhân giữ chỗ
  //     trước, chiếm đúng tài nguyên cần thiết.
  //   Tầng 2: bệnh nhân ngoại trú đã nhập — xếp SAU CÙNG theo đúng nguyên
  //     tắc/thứ tự STT như cũ (linh hoạt buổi sáng/chiều, tối ưu Xông hơi...).
  const tierOf = (p) => (p.priorityDischarge ? 0 : (p.isPlaceholder ? 1 : 2));
  const sortedPatients = patients.slice().sort((a, b) => {
    const ta = tierOf(a), tb = tierOf(b);
    return ta !== tb ? ta - tb : a.stt - b.stt;
  });
  const procByCode = Object.fromEntries(Object.values(procedures).map((p) => [p.code, p]));

  // Buổi bắt buộc (chỉ số trong `shifts`) của 1 bệnh nhân, nếu có — null =
  // được xếp linh hoạt như bình thường (đa số bệnh nhân ngoại trú). 0 = buổi
  // sáng, 1 = buổi chiều (đúng quy ước 'morning'/'afternoon' dùng xuyên suốt
  // hệ thống).
  function forcedShiftIndexOf(patient) {
    if (patient.priorityDischarge) return 0; // ra viện hôm nay -> LUÔN buổi sáng
    if (patient.placeholderShift === 'morning') return 0;
    if (patient.placeholderShift === 'afternoon') return 1;
    return null;
  }
  /** Danh sách buổi được PHÉP thử cho 1 bệnh nhân — bị khoá cứng vào đúng 1
   * buổi cho người ra viện hôm nay / người giữ chỗ BNM, còn lại (ngoại trú)
   * được thử linh hoạt cả 2 buổi như thuật toán gốc. */
  function candidateShiftsFor(patient) {
    const idx = forcedShiftIndexOf(patient);
    if (idx != null && shifts[idx]) return [shifts[idx]];
    return shifts;
  }

  // Nhãn khung giờ ca hôm nay (VD "07:00-11:30 & 13:30-17:00") để ghi rõ vào
  // lý do cảnh báo — bệnh nhân trong `warnings` LUÔN là người đã thử HẾT mọi
  // buổi được PHÉP mà vẫn không đủ chỗ hoàn tất phác đồ trong khung giờ này.
  const shiftLabel = rawShifts.map((s) => `${minutesToHHMM(s.start)}-${minutesToHHMM(s.end)}`).join(' & ');

  /** Thử xếp đủ 4 bước cho 1 bệnh nhân, CHỈ TRONG PHẠM VI 1 buổi (shiftWindow).
   * `examFloor` là mốc SỚM NHẤT bệnh nhân này được phép bắt đầu BẤT KỲ bước
   * nào — vì chỉ có 1 bác sĩ khám (Mai Thị Thủy) khám tuần tự từng người rồi
   * mới chỉ định đi làm thủ thuật, người sau luôn phải chờ người trước khám
   * xong (xem EXAM_PACING_MINUTES). Trả về { ok, missing, comboCode }. Không
   * tự rollback — bên gọi (vòng lặp chính) chịu trách nhiệm chụp/khôi phục
   * trạng thái quanh lời gọi này. */
  function attemptPatientInShift(patient, shiftWindow, examFloor) {
    activeShifts = [shiftWindow];
    const comboOverride = patient.comboOverride && comboLabels[patient.comboOverride];
    const forceStep2 = comboOverride ? comboOverride.step2Code : null;
    const forceStep4 = comboOverride ? comboOverride.step4Code : null;

    const patientState = { id: patient.id, cursor: Math.max(shiftWindow.start, examFloor ?? shiftWindow.start) };
    let usedStep2 = null; // 'DC' | 'HC'
    let usedStep4 = null; // 'XH' | 'CN'
    const missing = [];

    // Cả 4 bước đều linh hoạt thứ tự — kể cả Xoa bóp bấm huyệt (step1) —
    // để có thể xếp Xông hơi ngay từ đầu ca khi máy còn rảnh, thay vì luôn
    // bắt bệnh nhân xoa bóp trước rồi mới tới lượt xông.
    const pendingFlexSteps = ['step2', 'step4'];
    let step1Done = false;
    let step3Done = false;

    // Kiểm tra THẬT (không ước lượng) xem, nếu bệnh nhân rảnh từ `cursorAfter`
    // trở đi, các bước CÒN LẠI (trừ bước đang xét) có còn xếp được không.
    function otherStepsStillFeasible(excludeKey, cursorAfter) {
      if (excludeKey !== 'step1' && !step1Done) {
        if (!planSimpleProcedure(procByCode.XBBH, cursorAfter)) return false;
      }
      if (excludeKey !== 'step2' && pendingFlexSteps.includes('step2')) {
        const okDC = (!forceStep2 || forceStep2 === 'DC') && !!planSplitProcedure(procByCode.DC, cursorAfter, fixedMonitorFor(procByCode.DC));
        const okHC = (!forceStep2 || forceStep2 === 'HC') && !!planSplitProcedure(procByCode.HC, cursorAfter, fixedMonitorFor(procByCode.HC));
        if (!okDC && !okHC) return false;
      }
      if (excludeKey !== 'step4' && pendingFlexSteps.includes('step4')) {
        const okXH = (!forceStep4 || forceStep4 === 'XH') && !!planSimpleProcedure(procByCode.XH, cursorAfter);
        const okCN = (!forceStep4 || forceStep4 === 'CN') && !!planSimpleProcedure(procByCode.CN, cursorAfter);
        if (!okXH && !okCN) return false;
      }
      if (excludeKey !== 'step3' && !step3Done) {
        if (!planSplitProcedure(procByCode.TC, cursorAfter, fixedMonitorFor(procByCode.TC))) return false;
      }
      return true;
    }

    while (!step1Done || pendingFlexSteps.length > 0 || !step3Done) {
      const options = [];

      if (!step1Done) {
        const plan = planSimpleProcedure(procByCode.XBBH, patientState.cursor);
        if (plan) options.push({ key: 'step1', finish: plan.end, choice: { plan, usedPrimary: true } });
      }
      if (pendingFlexSteps.includes('step2')) {
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
          : chooseBiasedOption(primaryPlan, fallbackPlan, (cursorAfter) => otherStepsStillFeasible('step2', cursorAfter));
        if (choice) {
          options.push({ key: 'step2', finish: choice.plan.end, choice });
        }
      }
      if (pendingFlexSteps.includes('step4')) {
        let primaryPlan = null;
        let fallbackPlan = null;
        // Xông hơi CHỈ được ghép cùng Điện châm (đúng combo 1 chính thức) —
        // "Hào châm + Xông hơi" KHÔNG nằm trong 3 combo chính thức của hồ sơ
        // gốc (chỉ có: XBBH+DC+TC+XH, XBBH+DC+TC+CN, XBBH+HC+TC+CN). Nếu
        // bước 2 đã chốt là Hào châm (hoặc chắc chắn sẽ là Hào châm vì Điện
        // châm hiện không khả thi), Xông hơi không còn là lựa chọn hợp lệ,
        // chỉ còn Cứu ngải.
        const dcStillPossible = !pendingFlexSteps.includes('step2')
          ? usedStep2 === 'DC'
          : (!forceStep2 || forceStep2 === 'DC') && !!planSplitProcedure(procByCode.DC, patientState.cursor, fixedMonitorFor(procByCode.DC));
        if (dcStillPossible && (!forceStep4 || forceStep4 === 'XH')) {
          primaryPlan = planSimpleProcedure(procByCode.XH, patientState.cursor);
        }
        if (!forceStep4 || forceStep4 === 'CN') {
          fallbackPlan = planSimpleProcedure(procByCode.CN, patientState.cursor);
        }
        const choice = forceStep4
          ? (forceStep4 === 'XH' ? (primaryPlan && { plan: primaryPlan, usedPrimary: true }) : (fallbackPlan && { plan: fallbackPlan, usedPrimary: false }))
          : chooseBiasedOption(primaryPlan, fallbackPlan, (cursorAfter) => otherStepsStillFeasible('step4', cursorAfter));
        if (choice) {
          options.push({ key: 'step4', finish: choice.plan.end, choice });
        }
      }
      if (!step3Done) {
        const plan = planSplitProcedure(procByCode.TC, patientState.cursor, fixedMonitorFor(procByCode.TC));
        if (plan) options.push({ key: 'step3', finish: plan.end, choice: { plan, usedPrimary: true } });
      }

      if (options.length === 0) {
        // không còn bước nào xếp được nữa trong ngày -> đánh dấu các bước còn thiếu
        if (!step1Done) missing.push('XBBH');
        if (pendingFlexSteps.includes('step2')) missing.push(forceStep2 || 'DC/HC');
        if (pendingFlexSteps.includes('step4')) missing.push(forceStep4 || 'XH/CN');
        if (!step3Done) missing.push('TC');
        break;
      }

      options.sort((a, b) => a.finish - b.finish);
      const winner = options[0];

      if (winner.key === 'step1') {
        commitSimple(procByCode.XBBH, winner.choice.plan, patientState);
        step1Done = true;
      } else if (winner.key === 'step2') {
        // Khi ép combo, procCode LUÔN đúng bằng chính giá trị ép (forceStep2)
        // bất kể đó là phương án "chính" (DC) hay "dự phòng" (HC) — trước đây
        // nhánh dự phòng bị suy luận sai thành 'DC' mỗi khi forceStep2==='HC'
        // (coi mọi giá trị ép khác 'DC' như thể không hề bị ép), khiến ép
        // Combo 3 (Hào châm) âm thầm xếp NHẦM thành Điện châm.
        const procCode = forceStep2 || (winner.choice.usedPrimary ? 'DC' : 'HC');
        const proc = procByCode[procCode];
        commitSplit(proc, winner.choice.plan, patientState);
        usedStep2 = procCode;
        pendingFlexSteps.splice(pendingFlexSteps.indexOf('step2'), 1);
      } else if (winner.key === 'step4') {
        // Tương tự step2: ép combo luôn ưu tiên đúng giá trị ép, kể cả khi đó
        // là phương án dự phòng (CN) — trước đây bị suy luận sai thành 'XH'.
        const procCode = forceStep4 || (winner.choice.usedPrimary ? 'XH' : 'CN');
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

    return { ok: missing.length === 0, missing, comboCode, usedStep4 };
  }

  // Số bước tối thiểu chấp nhận được khi phải RÚT GỌN phác đồ do không đủ
  // giờ (VD suất giữ chỗ bị ép sau mốc muộn 10h30/16h00, hoặc bệnh nhân mới
  // thêm vào sát giờ đóng cửa qua "+ Thêm 1 dòng") — dưới mức này coi như
  // không đủ để tính là 1 lượt khám có giá trị, báo thiếu giờ thay vì xếp.
  const MIN_REDUCED_STEPS = 2;

  /** Thử xếp CHÍNH XÁC danh sách mã thủ thuật `procCodes` (đã chọn cụ thể,
   * không còn phương án dự phòng nào khác) cho 1 bệnh nhân, theo thứ tự
   * LINH HOẠT (luôn chọn bước nào xong sớm nhất trước, giống hệt tinh thần
   * attemptPatientInShift) — dùng cho phác đồ RÚT GỌN khi không đủ giờ làm
   * trọn 4 bước. Không tự rollback — bên gọi chịu trách nhiệm chụp/khôi
   * phục trạng thái quanh lời gọi này. */
  function attemptStepsInShift(patientId, procCodes, shiftWindow, notBefore) {
    activeShifts = [shiftWindow];
    const patientState = { id: patientId, cursor: Math.max(shiftWindow.start, notBefore ?? shiftWindow.start) };
    const pending = new Set(procCodes);
    while (pending.size > 0) {
      let best = null;
      for (const code of pending) {
        const proc = procByCode[code];
        if (!proc) continue;
        const plan = proc.can_split
          ? planSplitProcedure(proc, patientState.cursor, fixedMonitorFor(proc))
          : planSimpleProcedure(proc, patientState.cursor);
        if (plan && (!best || plan.end < best.plan.end)) best = { code, plan };
      }
      if (!best) return { ok: false, missing: Array.from(pending) };
      const proc = procByCode[best.code];
      if (proc.can_split) commitSplit(proc, best.plan, patientState);
      else commitSimple(proc, best.plan, patientState);
      pending.delete(best.code);
    }
    return { ok: true, missing: [] };
  }

  /** Liệt kê mọi tổ hợp thủ thuật HỢP LỆ (Xoa bóp có/không + đúng 1 trong
   * Điện/Hào châm hoặc bỏ + Thủy châm có/không + đúng 1 trong Xông/Cứu ngải
   * hoặc bỏ), tối thiểu MIN_REDUCED_STEPS bước, sắp xếp theo TỔNG TIỀN giảm
   * dần — dùng để tìm phác đồ rút gọn "nhiều tiền nhất có thể" khi không đủ
   * giờ làm trọn 4 bước. Giá lấy từ `procedures[code].price` (đ/lượt). */
  function reducedComboCandidates() {
    const priceOf = (code) => (code && procByCode[code] ? procByCode[code].price || 0 : 0);
    const candidates = [];
    for (const a of ['XBBH', null]) {
      for (const b of ['DC', 'HC', null]) {
        for (const c of ['TC', null]) {
          for (const d of ['XH', 'CN', null]) {
            const codes = [a, b, c, d].filter(Boolean);
            if (codes.length < MIN_REDUCED_STEPS) continue;
            const price = codes.reduce((sum, code) => sum + priceOf(code), 0);
            candidates.push({ codes, price });
          }
        }
      }
    }
    candidates.sort((x, y) => y.price - x.price);
    return candidates;
  }

  /** Thử LẦN LƯỢT các tổ hợp rút gọn theo đúng thứ tự tiền giảm dần, trả về
   * tổ hợp ĐẦU TIÊN thực sự xếp được (đủ máy/nhân sự thật, không chỉ đủ về
   * mặt thời gian lý thuyết) trong `shiftWindow` kể từ `notBefore`. Tự
   * chụp/khôi phục trạng thái quanh mỗi lần thử — bên gọi không cần rollback
   * nếu hàm này trả về `ok:false` (đã tự dọn sạch). */
  function attemptBestRevenueComboInShift(patientId, shiftWindow, notBefore) {
    for (const cand of reducedComboCandidates()) {
      const snap = snapshotState();
      const result = attemptStepsInShift(patientId, cand.codes, shiftWindow, notBefore);
      if (result.ok) {
        for (const entry of scheduleEntries) {
          if (entry.patientId === patientId && !entry.comboCode) entry.comboCode = 'RUTGON:' + cand.codes.join('+');
        }
        return { ok: true, codes: cand.codes, price: cand.price };
      }
      restoreState(snap);
    }
    return { ok: false };
  }

  // Đếm số bệnh nhân đã được "khám xong, chỉ định đi làm thủ thuật" trong
  // TỪNG buổi (theo đúng thứ tự STT xử lý) — dùng để tính examFloor cho bệnh
  // nhân kế tiếp trong buổi đó (xem EXAM_PACING_MINUTES). Chỉ đếm bệnh nhân
  // THỰC SỰ được xếp vào buổi đó (kể cả khi họ thiếu bước), không đếm 2 lần
  // cho lượt "thử" ở buổi không được chọn.
  const examCounters = new Map(rawShifts.map((s, i) => [s.start, (initialExamCounters && initialExamCounters[i]) || 0]));

  // Bệnh nhân "giữ chỗ" BNM cần xếp vào các khung giờ MUỘN NHẤT có thể của
  // đúng buổi bị khoá (để đúng như hình dung "để dành chỗ cuối buổi" của
  // CEO), CHỨ KHÔNG xếp ngay từ đầu buổi như bệnh nhân bình thường — nhưng
  // vẫn phải được xử lý TRƯỚC bệnh nhân ngoại trú (xem `tierOf` ở trên) để
  // đảm bảo suất để dành không bị "ăn" mất. Vì vậy dùng bộ đếm/mốc RIÊNG
  // (không dùng chung examCounters với người ra viện hôm nay/ngoại trú):
  // mốc neo = giờ kết thúc buổi TRỪ ĐI thời lượng tối đa ước tính của 1 phác
  // đồ đầy đủ (đủ chỗ cho MỌI người giữ chỗ của buổi đó xếp nối tiếp nhau
  // theo đúng nhịp khám, vẫn kết thúc gọn trong buổi).
  function estimateMaxComboDuration() {
    // Phải cộng cả "nghỉ sau" (VD Xông hơi nghỉ 15') — đây là thời gian
    // THUỘC VỀ bệnh nhân (patientState.cursor vẫn trôi qua khoảng này dù máy
    // đã rảnh cho người khác), bỏ sót sẽ làm mốc neo tính MUỘN QUÁ so với
    // thực tế, khiến bước cuối luôn bị đẩy vượt quá giờ kết thúc ca.
    const totalOf = (code) => {
      const p = procByCode[code];
      return p ? (p.duration_minutes || 0) + (p.rest_after_minutes || 0) : 0;
    };
    const xbbh = totalOf('XBBH');
    const step2 = Math.max(totalOf('DC'), totalOf('HC'));
    const step3 = totalOf('TC');
    const step4 = Math.max(totalOf('XH'), totalOf('CN'));
    // Thêm chút dư an toàn (không phải lúc nào thứ tự linh hoạt cũng ghép
    // khít 100% liên tiếp — VD phải chờ đúng máy/người theo dõi rảnh) để
    // tránh cứ phải lùi về mốc sớm (fallback) một cách không cần thiết.
    return xbbh + step2 + step3 + step4 + 3 * transferBufferMinutes + 15;
  }
  const maxComboDuration = estimateMaxComboDuration();
  // Chỉ đếm nhóm "để dành muộn nhất có thể" (tail) — nhóm "ép sau mốc muộn"
  // (checkpoint, xem bên dưới) dùng mốc CỐ ĐỊNH riêng, không cộng dồn vào
  // đây (khác nhóm, không cạnh tranh cùng 1 mốc neo).
  const placeholderCountByShiftStart = new Map();
  for (const p of patients) {
    if (!p.isPlaceholder || p.placeholderTier === 'checkpoint') continue;
    const idx = p.placeholderShift === 'morning' ? 0 : (p.placeholderShift === 'afternoon' ? 1 : null);
    if (idx == null || !shifts[idx]) continue;
    const key = shifts[idx].start;
    placeholderCountByShiftStart.set(key, (placeholderCountByShiftStart.get(key) || 0) + 1);
  }
  const placeholderAnchorByShiftStart = new Map();
  for (const [shiftStart, count] of placeholderCountByShiftStart) {
    const shiftEnd = shifts.find((s) => s.start === shiftStart).end;
    const anchor = Math.max(shiftStart, shiftEnd - maxComboDuration - EXAM_PACING_MINUTES * (count - 1));
    placeholderAnchorByShiftStart.set(shiftStart, anchor);
  }
  const placeholderCounters = new Map();

  // Nhóm "ép sau mốc muộn" (VD tối thiểu 2 suất sau 10h30 buổi sáng / 16h00
  // buổi chiều) — mốc CỐ ĐỊNH = giờ kết thúc ca trừ LATE_CHECKPOINT_MINUTES_
  // BEFORE_END phút, KHÔNG đủ cho 1 phác đồ đầy đủ (~101 phút) nên nhóm này
  // sẽ tự động rơi vào phác đồ RÚT GỌN theo doanh thu (xem vòng lặp chính).
  const LATE_CHECKPOINT_MINUTES_BEFORE_END = 60;
  const checkpointAnchorByShiftStart = new Map();
  for (const s of shifts) checkpointAnchorByShiftStart.set(s.start, Math.max(s.start, s.end - LATE_CHECKPOINT_MINUTES_BEFORE_END));
  const checkpointCounters = new Map();

  function examFloorFor(patient, shiftWindow) {
    // Khi thêm 1 bệnh nhân cụ thể vào lịch có sẵn, người dùng tự chọn giờ
    // bắt đầu — bỏ qua nhịp khám tự động, chỉ đảm bảo không sớm hơn đầu ca.
    if (forcedExamFloor != null) return Math.max(shiftWindow.start, forcedExamFloor);
    if (patient.isPlaceholder && patient.placeholderTier === 'checkpoint') {
      const anchor = checkpointAnchorByShiftStart.get(shiftWindow.start) ?? shiftWindow.start;
      return anchor + EXAM_PACING_MINUTES * (checkpointCounters.get(shiftWindow.start) || 0);
    }
    if (patient.isPlaceholder) {
      const anchor = placeholderAnchorByShiftStart.get(shiftWindow.start) ?? shiftWindow.start;
      return anchor + EXAM_PACING_MINUTES * (placeholderCounters.get(shiftWindow.start) || 0);
    }
    return shiftWindow.start + EXAM_PACING_MINUTES * examCounters.get(shiftWindow.start);
  }
  function bumpCounterFor(patient, shiftWindow) {
    if (patient.isPlaceholder && patient.placeholderTier === 'checkpoint') {
      checkpointCounters.set(shiftWindow.start, (checkpointCounters.get(shiftWindow.start) || 0) + 1);
    } else if (patient.isPlaceholder) {
      placeholderCounters.set(shiftWindow.start, (placeholderCounters.get(shiftWindow.start) || 0) + 1);
    } else {
      examCounters.set(shiftWindow.start, examCounters.get(shiftWindow.start) + 1);
    }
  }

  for (const patient of sortedPatients) {
    const candidateShifts = candidateShiftsFor(patient);

    if (candidateShifts.length <= 1 || optimizationMode === 'max_patients') {
      // Chỉ 1 buổi được phép thử (bị khoá cứng, hoặc cấu hình chỉ có 1 ca),
      // hoặc đang ở chế độ tối đa số bệnh nhân (không cần rải đều Xông giữa
      // 2 buổi) -> giữ cách cũ: thử lần lượt, dùng buổi đầu tiên xong được.
      let outcome = null;
      let usedShift = null;
      for (const shiftWindow of candidateShifts) {
        const snap = snapshotState();
        const ownFloor = examFloorFor(patient, shiftWindow);
        outcome = attemptPatientInShift(patient, shiftWindow, ownFloor);
        if (outcome.ok) { usedShift = shiftWindow; break; }
        restoreState(snap);

        // Suất "ép sau mốc muộn" (checkpoint): mốc này KHÔNG đủ cho phác đồ
        // đầy đủ (~101 phút) trong khi chỉ còn ~60 phút tới hết ca — nên
        // trước khi lùi về mốc sớm, thử phác đồ RÚT GỌN nhiều tiền nhất có
        // thể (tối thiểu 2 bước) đúng ngay tại mốc muộn này, để vẫn giữ được
        // đúng Ý ĐỊNH "có người trực tới sát giờ đóng cửa".
        if (patient.isPlaceholder && patient.placeholderTier === 'checkpoint') {
          const snapR = snapshotState();
          const reduced = attemptBestRevenueComboInShift(patient.id, shiftWindow, ownFloor);
          if (reduced.ok) { outcome = { ok: true, missing: [], comboCode: null }; usedShift = shiftWindow; break; }
          restoreState(snapR);
        }

        // Bệnh nhân giữ chỗ BNM (cả 2 nhóm): nếu mốc riêng vẫn không đủ chỗ
        // (VD máy/nhân sự bận hơn dự tính, hoặc nhiều người giữ chỗ dồn vào
        // cuối buổi tranh nhau tài nguyên) -> BẮT BUỘC vẫn phải giữ được suất
        // này (yêu cầu cứng, không được phép thất bại), nên thử lại từ mốc
        // SỚM NHẤT (đã kiểm chứng luôn xếp được, vì được ưu tiên trước bệnh
        // nhân ngoại trú) — thà xếp sớm/rút gọn còn hơn mất hẳn suất.
        if (patient.isPlaceholder) {
          const snap2 = snapshotState();
          const earlyFloor = shiftWindow.start + EXAM_PACING_MINUTES * (placeholderCounters.get(shiftWindow.start) || 0);
          const fallbackOutcome = attemptPatientInShift(patient, shiftWindow, earlyFloor);
          if (fallbackOutcome.ok) { outcome = fallbackOutcome; usedShift = shiftWindow; break; }
          restoreState(snap2);
          const snapR2 = snapshotState();
          const reducedEarly = attemptBestRevenueComboInShift(patient.id, shiftWindow, earlyFloor);
          if (reducedEarly.ok) { outcome = { ok: true, missing: [], comboCode: null }; usedShift = shiftWindow; break; }
          restoreState(snapR2);
        }

        // Bệnh nhân THẬT thêm vào muộn (nút "+ Thêm 1 dòng") khi không đủ
        // giờ cho đủ 4 bước: cho phép rút gọn để vẫn nhận được (thu tiền
        // được) thay vì từ chối thẳng — đúng nguyên tắc bác sĩ đã thống nhất.
        if (!patient.isPlaceholder && patient.allowRevenueFallback) {
          const snapR3 = snapshotState();
          const reduced = attemptBestRevenueComboInShift(patient.id, shiftWindow, ownFloor);
          if (reduced.ok) { outcome = { ok: true, missing: [], comboCode: null }; usedShift = shiftWindow; break; }
          restoreState(snapR3);
        }
      }
      if (usedShift) bumpCounterFor(patient, usedShift);
      finalizePatientOutcome(patient, outcome);
      continue;
    }

    // Chế độ 'max_xong' với 2 buổi trở lên (bệnh nhân ngoại trú, không bị
    // khoá buổi): THỬ CẢ 2 BUỔI cho mỗi bệnh nhân (không dừng lại ở buổi đầu
    // tiên xong được) rồi chọn buổi nào cho bệnh nhân này dùng được Xông hơi
    // — kể cả khi đó là buổi CHIỀU — thay vì luôn nhét vào buổi sáng trước
    // rồi bỏ mặc máy Xông buổi chiều trống không. Máy Xông phải chạy hết
    // công suất ở CẢ 2 buổi trước khi chấp nhận cho ai đó dùng Cứu ngải thay
    // thế.
    const attempts = [];
    for (const shiftWindow of candidateShifts) {
      const snap = snapshotState();
      const outcome = attemptPatientInShift(patient, shiftWindow, examFloorFor(patient, shiftWindow));
      if (outcome.ok) {
        attempts.push({ shiftWindow, outcome, snap: snapshotState() });
      }
      restoreState(snap); // luôn hoàn tác — sẽ áp lại đúng 1 lựa chọn cuối cùng bên dưới
    }

    if (attempts.length === 0) {
      // Không buổi nào xong được đủ 4 bước -> báo thiếu theo lần thử cuối
      // cùng (buổi chiều) để có thông tin cụ thể nhất.
      const lastShift = candidateShifts[candidateShifts.length - 1];
      const snap = snapshotState();
      const lastOutcome = attemptPatientInShift(patient, lastShift, examFloorFor(patient, lastShift));
      restoreState(snap);
      finalizePatientOutcome(patient, lastOutcome);
      continue;
    }

    // Ưu tiên buổi nào cho Xông hơi; nếu cả 2 (hoặc chỉ 1) đều cho Xông hoặc
    // đều không, ưu tiên buổi có ÍT lượt Xông hơn tính đến giờ (rải đều tải
    // giữa 2 buổi thay vì dồn hết vào 1 buổi).
    function xongCountSoFar(shiftWindow) {
      return scheduleEntries.filter((e) => e.procedureCode === 'XH' && e.start >= shiftWindow.start && e.start < shiftWindow.end).length;
    }
    attempts.sort((a, b) => {
      const aXong = a.outcome.usedStep4 === 'XH' ? 1 : 0;
      const bXong = b.outcome.usedStep4 === 'XH' ? 1 : 0;
      if (aXong !== bXong) return bXong - aXong; // ưu tiên buổi cho Xông hơi trước
      return xongCountSoFar(a.shiftWindow) - xongCountSoFar(b.shiftWindow); // rồi tới buổi đang ít lượt Xông hơn
    });
    const chosen = attempts[0];
    restoreState(chosen.snap); // áp lại đúng kết quả đã chọn
    bumpCounterFor(patient, chosen.shiftWindow);
    finalizePatientOutcome(patient, chosen.outcome);
  }

  function finalizePatientOutcome(patient, outcome) {
    if (!outcome.ok) {
      warnings.push({
        patientId: patient.id,
        patientName: patient.name,
        stt: patient.stt,
        missingSteps: outcome.missing,
        reason: `Vượt khung giờ ca trong ngày (${shiftLabel}) — không còn đủ chỗ (máy/nhân sự) để hoàn tất phác đồ hôm nay. Cần hẹn chuyển sang ngày khác.`,
      });
    } else if (outcome.comboCode) {
      comboCount[outcome.comboCode] = (comboCount[outcome.comboCode] || 0) + 1;
    }
  }

  // ---- Tổng hợp số liệu ----
  const totalPatients = patients.length;
  const completedPatients = totalPatients - warnings.length;

  // Giá trị CUỐI của bộ đếm nhịp khám mỗi buổi — bên gọi dùng để "nối tiếp"
  // đúng nhịp khám khi cần chạy thêm 1 lượt mô phỏng tiếp theo (VD lượt thử
  // "còn nhận thêm được bao nhiêu người thật sự" bằng cách thử xếp thêm vài
  // bệnh nhân giả định, xem có xong không — chính xác hơn nhiều so với ước
  // lượng theo công thức, vì tôn trọng ĐẦY ĐỦ mọi ràng buộc thật (máy, nhân
  // sự...), không chỉ riêng nhịp khám).
  const examCountersByShift = rawShifts.map((s) => examCounters.get(s.start));

  const machineUtilization = machines.map((m) => {
    const capacityMinutes = rawShifts.reduce((sum, s) => sum + (s.end - s.start), 0);
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

  // Số lượt từng loại thủ thuật đã xếp được trong ngày (Xông hơi, Hào châm,
  // Thủy châm...) — theo đúng thứ tự khai báo trong `procedures` để hiển thị
  // ổn định, kể cả loại chưa có lượt nào (hiện 0, không ẩn đi).
  const procedureCount = Object.values(procedures).map((p) => ({
    code: p.code,
    name: p.name,
    count: scheduleEntries.reduce((n, e) => n + (e.procedureCode === p.code ? 1 : 0), 0),
  }));

  // ---- Tự kiểm tra: KHÔNG được có 1 nhân sự bị gán 2 việc "thực hiện"/"trông
  // cố định" chồng giờ nhau (2 người cùng "trông" 1 loại thủ thuật cùng lúc là
  // BÌNH THƯỜNG — đó là mô hình sức chứa). Đây là lưới an toàn cuối cùng: nếu
  // có bug nào đó lọt qua khiến 2 việc thật sự chồng giờ, NÉM LỖI NGAY thay vì
  // âm thầm trả về 1 lịch sai — để không bao giờ lặp lại tình huống người dùng
  // phải tự phát hiện xung đột qua việc đọc phiếu in.
  {
    const byStaff = new Map();
    for (const e of scheduleEntries) {
      for (const a of e.staffAssignments) {
        if (!byStaff.has(a.staffId)) byStaff.set(a.staffId, []);
        byStaff.get(a.staffId).push({ start: a.start, end: a.end, roleType: a.roleType, patientId: e.patientId, procedureCode: e.procedureCode });
      }
    }
    for (const [staffId, intervals] of byStaff) {
      const sorted = intervals.slice().sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          if (b.start >= a.end - MINUTE_EPS) break; // đã sort theo start -> không còn chồng lấn nữa
          if (a.roleType === 'monitor' && b.roleType === 'monitor') continue; // nhiều người cùng trông 1 lúc là bình thường
          throw new Error(`Lỗi chia lịch: nhân sự ${staffId} bị gán chồng giờ (${a.procedureCode} BN${a.patientId} ${minutesToHHMM(a.start)}-${minutesToHHMM(a.end)} vs ${b.procedureCode} BN${b.patientId} ${minutesToHHMM(b.start)}-${minutesToHHMM(b.end)}).`);
        }
      }
    }
  }

  return {
    scheduleEntries,
    warnings,
    summary: {
      totalPatients,
      completedPatients,
      incompletePatients: warnings.length,
      comboCount,
      procedureCount,
      // [{ start, end, reservedSlots, examCounter }] — song song với
      // rawShifts. `reservedSlots` chỉ để HIỂN THỊ lại đúng số suất CEO đã
      // yêu cầu để dành (suất này đã được hiện thực hoá thành các bệnh nhân
      // giữ chỗ BNM thật trong `patients`, không còn là 1 con số áp đặt lên
      // thuật toán). `examCounter` (giá trị bộ đếm nhịp khám cuối buổi) để
      // bên gọi TIẾP TỤC mô phỏng chính xác khi cần tính "còn nhận thêm được
      // bao nhiêu người" (xem examCountersByShift/initialExamCounters).
      shiftCapacity: rawShifts.map((s, i) => ({
        start: s.start,
        end: s.end,
        reservedSlots: reservedByShift[i] || 0,
        examCounter: examCountersByShift[i],
      })),
      machineUtilization,
      staffWorkload,
    },
  };
}

/** Ước lượng CHÍNH XÁC còn nhận thêm được bao nhiêu bệnh nhân trong 1 buổi,
 * bằng cách thực sự mô phỏng thử xếp thêm `batchSize` bệnh nhân giả định
 * (combo tự động) vào ĐÚNG trạng thái hiện có (existingScheduleEntries,
 * nối tiếp đúng nhịp khám qua examCounter) — tôn trọng ĐẦY ĐỦ mọi ràng buộc
 * thật (máy, nhân sự, giờ ca...), không phải ước lượng theo công thức. Nếu
 * `fit === batchSize`, có thể còn nhiều hơn nữa (chỉ thử tới batchSize) —
 * xem `atLeast`. KHÔNG ghi gì vào lịch thật, chỉ dùng để trả lời câu hỏi
 * "còn nhận thêm được bao nhiêu người hôm nay". */
function estimateRemainingCapacity(config, existingScheduleEntries, shiftIndex, examCounter, batchSize = 30) {
  const probeConfig = {
    ...config,
    shifts: [config.shifts[shiftIndex]],
    existingScheduleEntries,
    initialExamCounters: [examCounter],
    reservedSlotsByShift: undefined,
  };
  const probePatients = [];
  for (let k = 0; k < batchSize; k++) probePatients.push({ id: `__probe_${shiftIndex}_${k}`, stt: 9000000 + k, name: 'Probe' });
  const probeResult = generateSchedule(probeConfig, probePatients);
  const fit = probeResult.summary.completedPatients;
  return { fit, atLeast: fit >= batchSize };
}

module.exports = { generateSchedule, findEarliestSlot, findEarliestCapacitySlot, capacityFits, minutesToHHMM, estimateRemainingCapacity };
