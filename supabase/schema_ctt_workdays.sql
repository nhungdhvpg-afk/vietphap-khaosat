-- ============================================================================
-- VIỆT PHÁP · NGÀY LÀM VIỆC TRONG TUẦN CỦA NHÂN SỰ (module Chia thủ thuật)
-- Chạy 1 lần trong Supabase SQL Editor TRƯỚC khi dùng tính năng "Ngày làm
-- việc" mới trong tab Cài đặt → Nhân sự.
--
-- Mặc định: KHÔNG ghi chú gì (work_days = NULL) = làm việc CẢ TUẦN (7 ngày),
-- đúng như hiện trạng của hầu hết nhân sự. Chỉ những ai làm việc GIỚI HẠN
-- một số ngày cụ thể mới cần set work_days.
-- ============================================================================

-- 0=Chủ nhật, 1=Thứ 2, 2=Thứ 3, 3=Thứ 4, 4=Thứ 5, 5=Thứ 6, 6=Thứ 7 (giống
-- quy ước JavaScript Date.getDay(), để phần chia lịch tính toán trực tiếp).
alter table ctt_staff add column if not exists work_days integer[] null;
comment on column ctt_staff.work_days is 'Các ngày trong tuần được xếp lịch (0=CN,1=T2,2=T3,3=T4,4=T5,5=T6,6=T7). NULL = làm tất cả các ngày (mặc định).';

-- Lý Hồng Vỹ: CHỈ làm thứ 7 (6) và Chủ nhật (0) — những ngày khác trong
-- tuần sẽ KHÔNG được thuật toán gán bất kỳ thủ thuật nào cho tài khoản này.
update ctt_staff set work_days = array[0,6] where name = 'Lý Hồng Vỹ';

-- Kiểm tra lại sau khi chạy:
select name, work_days from ctt_staff order by name;
