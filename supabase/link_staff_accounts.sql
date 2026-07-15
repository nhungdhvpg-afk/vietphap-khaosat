-- ============================================================================
-- GẮN TÀI KHOẢN ĐĂNG NHẬP VỚI VAI TRÒ (CEO / trưởng khoa)
--
-- Chạy file này SAU KHI đã tạo xong 8 tài khoản trong
-- Authentication > Users (1 CEO + 7 trưởng khoa) và SAU KHI đã chạy schema.sql.
--
-- Cách dùng: thay các email bên dưới bằng đúng email chị đã tạo ở bước
-- Authentication > Users, rồi dán toàn bộ vào SQL Editor > Run.
-- Có thể chạy lại nhiều lần an toàn (ON CONFLICT sẽ cập nhật thay vì lỗi).
-- ============================================================================

-- 1) Tài khoản CEO — xem toàn bộ 7 khoa
insert into staff_accounts (id, email, role, department)
select id, email, 'ceo', null
from auth.users
where email = 'ceo@vietphapclinic.vn'  -- <-- THAY bằng email CEO thực tế
on conflict (id) do update set role = excluded.role, department = excluded.department;

-- 2) Trưởng khoa — mỗi dòng ứng với 1 khoa, THAY email cho đúng người phụ trách
insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'Nội'
from auth.users where email = 'noikhoa@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'QL bệnh Huyết áp - Tiểu đường'
from auth.users where email = 'huyetap@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'Y học cổ truyền'
from auth.users where email = 'yhoccotruyen@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'Sản'
from auth.users where email = 'san@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'Nhi'
from auth.users where email = 'nhi@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'Ngoại'
from auth.users where email = 'ngoai@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

insert into staff_accounts (id, email, role, department)
select id, email, 'department_head', 'Cấp cứu'
from auth.users where email = 'capcuu@vietphapclinic.vn'  -- <-- THAY
on conflict (id) do update set role = excluded.role, department = excluded.department;

-- 3) Kiểm tra lại: chạy dòng dưới đây để xem đã gắn đúng chưa
select email, role, department from staff_accounts order by role, department;
