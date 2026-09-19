-- ============================================================================
-- VIỆT PHÁP · CHIA THỦ THUẬT Y HỌC CỔ TRUYỀN
-- Schema riêng cho module chia thủ thuật (tách biệt hoàn toàn với module khảo
-- sát trải nghiệm khách hàng đã có — không sửa/xoá gì ở schema.sql cũ).
--
-- CÁCH DÙNG: Vào Supabase Dashboard > SQL Editor > New query, dán TOÀN BỘ nội
-- dung file này vào rồi bấm "Run". Chỉ cần chạy 1 lần (đã có dữ liệu mẫu sẵn
-- cho đúng danh sách nhân sự / thủ thuật / máy móc của Việt Pháp).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. NHÂN VIÊN Y TẾ (ctt_staff)
-- ----------------------------------------------------------------------------
create table if not exists ctt_staff (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  role         text not null check (role in ('BS', 'YS', 'DD')), -- Bác sĩ / Y sĩ / Điều dưỡng
  qualification text,                 -- văn bằng, chứng chỉ (ghi chú tham khảo)
  active       boolean not null default true, -- false = không tham gia chia thủ thuật
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. MÁY MÓC (ctt_machines) — 2 máy xông + 4 máy châm
-- ----------------------------------------------------------------------------
create table if not exists ctt_machines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  type       text not null check (type in ('XONG', 'CHAM')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. LOẠI THỦ THUẬT (ctt_procedure_types)
--    Mirror cấu trúc "chia đôi tay nghề / theo dõi" (VD: Điện châm = 6' đặt
--    kim (BS/YS) + 19' theo dõi (DD), cùng chiếm 1 máy Châm suốt 25').
-- ----------------------------------------------------------------------------
create table if not exists ctt_procedure_types (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,   -- MA_TT: XBBH, DC, HC, TC, XH, CN, GH, KH
  name                  text not null,
  duration_minutes      int not null,
  requires_machine      boolean not null default false,
  machine_type          text check (machine_type is null or machine_type in ('XONG', 'CHAM')),
  rest_after_minutes    int not null default 0, -- thời gian máy/giường phải nghỉ sau khi dùng (VD xông = 15')
  can_split             boolean not null default false, -- có tách "tay nghề" / "theo dõi" không
  active_minutes        int,     -- số phút đầu do người "thực hiện" đảm nhiệm (đặt kim/chích thuốc...)
  monitor_minutes       int,     -- số phút còn lại do người "theo dõi" đảm nhiệm
  monitor_max_patients  int not null default 10, -- 1 người theo dõi được tối đa bao nhiêu BN cùng lúc
  perform_roles         text[] not null,  -- vai trò được PHÉP thực hiện (VD: {BS,YS})
  monitor_roles         text[],           -- vai trò được phép theo dõi (null nếu can_split=false)
  is_exam               boolean not null default false, -- true = Khám/Chỉ định (không nằm trong phác đồ tự động)
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. GIÁM SÁT CỐ ĐỊNH (ctt_procedure_fixed_monitor)
--    VD: Vi Thị Hoá LUÔN trông Thủy châm, Đỗ Văn Thắng LUÔN trông Điện châm.
--    Nếu 1 thủ thuật không có dòng nào ở đây => ai trong monitor_roles cũng
--    được (không cố định người).
-- ----------------------------------------------------------------------------
create table if not exists ctt_procedure_fixed_monitor (
  procedure_type_id  uuid not null references ctt_procedure_types(id) on delete cascade,
  staff_id           uuid not null references ctt_staff(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (procedure_type_id, staff_id)
);

-- ----------------------------------------------------------------------------
-- 5. COMBO THAM KHẢO (chỉ để hiển thị nhãn C1/C2/C2B/C3 trên phiếu — thuật
--    toán tự chọn biến thể theo tình trạng máy/nhân lực thực tế, xem README).
-- ----------------------------------------------------------------------------
create table if not exists ctt_combos (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  step2_code text not null references ctt_procedure_types(code), -- DC hoặc HC
  step4_code text not null references ctt_procedure_types(code), -- XH hoặc CN
  priority   int not null, -- số nhỏ hơn = ưu tiên hơn
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. CẤU HÌNH CHUNG (ctt_settings)
-- ----------------------------------------------------------------------------
create table if not exists ctt_settings (
  key         text primary key,
  value       text not null,
  label       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. DANH SÁCH BỆNH NHÂN THEO NGÀY (ctt_patients) — nhập từ màn hình chia
--    thủ thuật (chỉ cần Họ tên + STT trong ngày).
-- ----------------------------------------------------------------------------
create table if not exists ctt_patients (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  stt          int not null,
  name         text not null,
  combo_override text, -- null = dùng phác đồ chuẩn tự động; hoặc mã combo ép buộc
  created_at   timestamptz not null default now(),
  unique (date, stt)
);

-- ----------------------------------------------------------------------------
-- 8. LỊCH CHIA THỦ THUẬT (ctt_schedules) — kết quả sau khi chạy thuật toán
-- ----------------------------------------------------------------------------
create table if not exists ctt_schedules (
  id                 uuid primary key default gen_random_uuid(),
  date               date not null,
  patient_id         uuid references ctt_patients(id) on delete cascade,
  procedure_type_id  uuid references ctt_procedure_types(id) on delete set null,
  machine_id         uuid references ctt_machines(id) on delete set null,
  combo_code         text,          -- nhãn C1/C2/C2B/C3 áp dụng cho lượt này (nếu có)
  start_time         int not null,  -- phút tính từ 00:00
  end_time           int not null,
  status             text not null default 'scheduled' check (status in ('scheduled', 'unassigned')),
  unassigned_reason  text,          -- lý do không xếp được (hết giờ/hết máy/hết người...)
  created_at         timestamptz not null default now()
);

create index if not exists idx_ctt_schedules_date on ctt_schedules (date);
create index if not exists idx_ctt_schedules_patient on ctt_schedules (patient_id);

-- ----------------------------------------------------------------------------
-- 9. NHÂN SỰ THAM GIA TỪNG LƯỢT (ctt_schedule_staffs) — 1 lượt có thể có
--    người "thực hiện" và người "theo dõi" khác nhau (thủ thuật chia đôi).
-- ----------------------------------------------------------------------------
create table if not exists ctt_schedule_staffs (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid references ctt_schedules(id) on delete cascade,
  staff_id     uuid references ctt_staff(id) on delete set null,
  start_time   int not null,
  end_time     int not null,
  role_type    text not null default 'performer' check (role_type in ('performer', 'monitor')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_ctt_schedule_staffs_schedule on ctt_schedule_staffs (schedule_id);
create index if not exists idx_ctt_schedule_staffs_staff on ctt_schedule_staffs (staff_id);

-- ============================================================================
-- DỮ LIỆU MẪU — đúng theo danh sách thực tế của Việt Pháp (có thể sửa lại
-- trong màn hình "Cài đặt" của module sau khi triển khai).
-- ============================================================================

-- 7 loại thủ thuật chuẩn của Việt Pháp
insert into ctt_procedure_types
  (code, name, duration_minutes, requires_machine, machine_type, rest_after_minutes,
   can_split, active_minutes, monitor_minutes, monitor_max_patients, perform_roles, monitor_roles, is_exam)
values
  ('XBBH', 'Xoa bóp bấm huyệt', 30, false, null, 0, false, null, null, 10, array['BS','YS','DD'], null, false),
  ('DC',   'Điện châm',         25, true,  'CHAM', 0, true,  6,   19,  4,  array['BS','YS'],    array['DD'], false),
  ('HC',   'Hào châm',          25, false, null,   0, true,  5,   20,  8,  array['BS','YS'],    array['DD'], false),
  ('TC',   'Thủy châm',         25, false, null,   0, true,  11,  14,  4,  array['BS'],         array['DD'], false),
  ('XH',   'Xông hơi',          15, true,  'XONG', 15, false, null, null, 10, array['DD','YS'],   null, false),
  ('CN',   'Cứu ngải',          15, false, null,   0, false, null, null, 10, array['DD','YS','BS'], null, false),
  ('GH',   'Giác hơi',          15, false, null,   0, false, null, null, 10, array['DD','YS','BS'], null, false),
  ('KH',   'Khám / Chỉ định',    5, false, null,   0, false, null, null, 10, array['BS'],         null, true)
on conflict (code) do nothing;

-- 4 combo tham khảo (nhãn hiển thị — thuật toán tự chọn biến thể tối ưu)
insert into ctt_combos (code, name, step2_code, step4_code, priority)
values
  ('C1',  'Combo 1 (ưu tiên)',        'DC', 'XH', 1),
  ('C2',  'Combo 2',                  'DC', 'CN', 2),
  ('C2B', 'Combo 2 – biến thể đông',  'HC', 'CN', 3),
  ('C3',  'Combo 3',                  'HC', 'XH', 4)
on conflict (code) do nothing;

-- Máy móc: 2 xông + 4 châm
insert into ctt_machines (name, type)
values
  ('Xông 1', 'XONG'),
  ('Xông 2', 'XONG'),
  ('Châm 1', 'CHAM'),
  ('Châm 2', 'CHAM'),
  ('Châm 3', 'CHAM'),
  ('Châm 4', 'CHAM')
on conflict (name) do nothing;

-- Cấu hình ca làm việc theo quy định BHYT (không thanh toán được ngoài khung giờ này)
insert into ctt_settings (key, value, label, description)
values
  ('shift1_start', '07:00', 'Giờ bắt đầu ca sáng', 'Theo quy định BHYT — không xếp thủ thuật trước giờ này'),
  ('shift1_end',   '11:30', 'Giờ kết thúc ca sáng', 'Theo quy định BHYT — không xếp thủ thuật vượt quá giờ này'),
  ('shift2_start', '13:30', 'Giờ bắt đầu ca chiều', 'Theo quy định BHYT — không xếp thủ thuật trước giờ này'),
  ('shift2_end',   '17:00', 'Giờ kết thúc ca chiều', 'Theo quy định BHYT — không xếp thủ thuật vượt quá giờ này'),
  ('transfer_buffer_minutes', '2', 'Thời gian di chuyển giữa 2 thủ thuật (phút)', 'Khoảng nghỉ ngắn bắt buộc để bệnh nhân di chuyển phòng/chờ đến lượt tiếp theo')
on conflict (key) do nothing;

-- Nhân sự Y học cổ truyền — Việt Pháp (theo danh sách đăng ký hành nghề)
insert into ctt_staff (name, role, qualification, active, note)
values
  ('Mai Thị Thủy',            'BS', 'Bác sĩ YHCT (2021)', true, 'Tài khoản khám/chỉ định'),
  ('Hoàng Thị Ngọc Bích',     'BS', 'Bác sĩ YHCT (2022)', true, null),
  ('Nguyễn Hồng Quân',        'YS', 'Y sĩ YHCT (2020)', true, null),
  ('Trần Đắc Hùng',           'YS', 'Y sĩ YHCT (2023)', true, null),
  ('Nguyễn Thanh Tuấn',       'YS', 'Y sĩ YHCT (2021), CC đào tạo YHPH', true, null),
  ('Đỗ Thị Hoa',              'BS', 'Bác sĩ YHCT (2019)', true, null),
  ('Nguyễn Thị Oanh',         'BS', 'Bác sĩ YHCT (2017)', true, null),
  ('Lý Hồng Vỹ',              'YS', 'Y sĩ YHCT (2015)', true, 'Đăng ký thứ 7 - CN'),
  ('Nguyễn Thị Mỹ Hồng',      'YS', 'Y sĩ YHCT (2023)', true, null),
  ('Nguyễn Văn Quân',         'YS', 'Y sĩ học cổ truyền (2021)', true, 'Đăng ký thứ 2 - thứ 6'),
  ('Trần Văn Quyết',          'YS', 'Y sĩ YHCT (2007)', true, null),
  ('Nguyễn Bá Đại',           'BS', 'Bác sĩ Y học cổ truyền (2018)', true, null),
  ('Bùi Đăng Hải',            'BS', 'Bác sĩ Y học cổ truyền (2017)', true, null),
  ('Lưu Trí Hòa',             'BS', 'Bác sĩ YHCT (2018)', true, null),
  ('Hà Thị Thanh Nhàn',       'BS', 'Bác sĩ YHCT (2020)', true, 'Đăng ký thứ 7 - CN'),
  ('Vi Thị Hoá',              'DD', 'Điều dưỡng (2016)', true, 'LUÔN trông Thủy châm'),
  ('Ngô Văn Thường',          'DD', 'Điều dưỡng (2022)', false, 'Làm hành chính khoa — KHÔNG tham gia chia thủ thuật'),
  ('Đỗ Văn Thắng',            'DD', 'Cao đẳng điều dưỡng (2009)', true, 'LUÔN trông Điện châm')
on conflict do nothing;

-- Gán giám sát cố định: Vi Thị Hoá -> Thủy châm, Đỗ Văn Thắng -> Điện châm
insert into ctt_procedure_fixed_monitor (procedure_type_id, staff_id)
select pt.id, s.id from ctt_procedure_types pt, ctt_staff s
where pt.code = 'TC' and s.name = 'Vi Thị Hoá'
on conflict do nothing;

insert into ctt_procedure_fixed_monitor (procedure_type_id, staff_id)
select pt.id, s.id from ctt_procedure_types pt, ctt_staff s
where pt.code = 'DC' and s.name = 'Đỗ Văn Thắng'
on conflict do nothing;


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) — giống schema.sql: toàn bộ đọc/ghi của module này
-- đi qua Vercel Functions dùng khoá service_role (bỏ qua RLS). Bật RLS ở đây
-- mà KHÔNG tạo policy nào = mặc định khoá hẳn truy cập trực tiếp bằng khoá
-- anon/authenticated lộ ra ở public/config.js, phòng trường hợp có ai đó thử
-- gọi thẳng Supabase Data API từ trình duyệt.
-- ============================================================================
alter table ctt_staff enable row level security;
alter table ctt_machines enable row level security;
alter table ctt_procedure_types enable row level security;
alter table ctt_procedure_fixed_monitor enable row level security;
alter table ctt_combos enable row level security;
alter table ctt_settings enable row level security;
alter table ctt_patients enable row level security;
alter table ctt_schedules enable row level security;
alter table ctt_schedule_staffs enable row level security;
