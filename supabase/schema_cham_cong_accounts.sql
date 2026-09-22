-- ============================================================================
-- VIỆT PHÁP · TÀI KHOẢN NHÂN VIÊN CHO MODULE "BẢNG CHẤM CÔNG Y SĨ - BÁC SĨ"
-- Chạy 1 lần trong Supabase SQL Editor (project vietphap-khaosat2) TRƯỚC khi
-- dùng màn hình "Quản lý tài khoản" trong tab Cài đặt của module này.
--
-- Bảng staff_accounts vốn dùng CHUNG cho module Khảo sát (role: ceo /
-- department_head) và module Chia thủ thuật (role: ctt_staff). File này
-- KHÔNG đổi ý nghĩa các vai trò cũ, chỉ THÊM:
--   1. Vai trò mới 'cham_cong_staff' — dành cho nhân viên (VD kế toán/nhân
--      sự) CHỈ dùng module Bảng chấm công, KHÔNG tự động có quyền vào module
--      Chia thủ thuật hay dashboard Khảo sát (và ngược lại: ctt_staff /
--      department_head KHÔNG tự động có quyền vào module này).
--   2. Cột cham_cong_manager (true/false) — ai được sửa Cài đặt (ngưỡng cảnh
--      báo, quản lý tài khoản) của module này NGOÀI CEO. CEO luôn có toàn
--      quyền ở mọi module bất kể các cột phân quyền riêng.
-- ============================================================================

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
  check (role in ('ceo', 'department_head', 'ctt_staff', 'cham_cong_staff'));

alter table staff_accounts
  add constraint department_head_needs_department
  check (
    (role = 'ceo' and department is null) or
    (role = 'department_head' and department is not null) or
    (role = 'ctt_staff' and department is null) or
    (role = 'cham_cong_staff' and department is null)
  );

-- Cờ quyền quản lý Cài đặt của module Bảng chấm công.
alter table staff_accounts add column if not exists cham_cong_manager boolean not null default false;

-- Kiểm tra lại sau khi chạy: phải thấy đủ 4 giá trị role hợp lệ và cột cham_cong_manager.
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'staff_accounts'::regclass and contype = 'c';
