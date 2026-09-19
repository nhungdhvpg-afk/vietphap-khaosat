-- ============================================================================
-- VIỆT PHÁP · TÀI KHOẢN NHÂN VIÊN CHO MODULE "CHIA THỦ THUẬT YHCT"
-- Chạy 1 lần trong Supabase SQL Editor (project vietphap-khaosat2) TRƯỚC khi
-- dùng màn hình "Quản lý tài khoản" mới trong tab Cài đặt.
--
-- Bảng staff_accounts vốn dùng CHUNG cho cả module Khảo sát (role: ceo /
-- department_head) — file này KHÔNG đổi ý nghĩa 2 vai trò cũ, chỉ THÊM:
--   1. Vai trò mới 'ctt_staff' — dành cho nhân viên CHỈ dùng module Chia thủ
--      thuật (lễ tân, y tá...), KHÔNG có quyền xem dashboard khảo sát.
--   2. Cột ctt_manager (true/false) — ai được sửa tab "Cài đặt" của module
--      Chia thủ thuật (nhân sự/máy móc/giờ ca...) NGOÀI CEO. CEO luôn có toàn
--      quyền bất kể cột này.
-- ============================================================================

-- Nới CHECK constraint trên cột role để cho phép thêm giá trị 'ctt_staff'.
-- Dùng khối DO để tự tìm đúng tên constraint hiện có (tránh phải đoán tên),
-- rồi mới thêm lại constraint mới với đủ 3 giá trị.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'staff_accounts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table staff_accounts drop constraint %I', r.conname);
  end loop;
end $$;

alter table staff_accounts
  add constraint staff_accounts_role_check
  check (role in ('ceo', 'department_head', 'ctt_staff'));

alter table staff_accounts
  add constraint department_head_needs_department
  check (
    (role = 'ceo' and department is null) or
    (role = 'department_head' and department is not null) or
    (role = 'ctt_staff' and department is null)
  );

-- Cờ quyền quản lý Cài đặt của module Chia thủ thuật.
alter table staff_accounts add column if not exists ctt_manager boolean not null default false;

-- Kiểm tra lại sau khi chạy: phải thấy đủ 3 giá trị role hợp lệ và cột ctt_manager.
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'staff_accounts'::regclass and contype = 'c';
