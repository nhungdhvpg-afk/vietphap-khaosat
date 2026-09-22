-- ============================================================================
-- VIỆT PHÁP · SỬA LẠI ĐÚNG 3 COMBO CHÍNH THỨC THEO HỒ SƠ GỐC
-- Chạy 1 lần trong Supabase SQL Editor.
--
-- Combo 1 (ưu tiên cao nhất): XBBH + Điện châm + Thủy châm + Xông hơi
-- Combo 2 (ưu tiên thứ 2):    XBBH + Điện châm + Thủy châm + Cứu ngải
-- Combo 3 (ưu tiên thứ 3):    XBBH + Hào châm  + Thủy châm + Cứu ngải
--
-- Trước đây hệ thống có thêm 1 combo "C3 = Hào châm + Xông hơi" KHÔNG có
-- trong danh sách chính thức — xoá bỏ combo này, đổi "C2B" (Hào châm + Cứu
-- ngải) thành "C3" cho đúng số thứ tự ưu tiên chính thức.
-- ============================================================================

-- Xoá combo không hợp lệ (Hào châm + Xông hơi).
delete from ctt_combos where code = 'C3';

-- Đổi C2B (Hào châm + Cứu ngải) thành C3 theo đúng thứ tự ưu tiên chính thức.
update ctt_combos
   set code = 'C3',
       name = 'Combo 3 (XBBH + Hào châm + Thủy châm + Cứu ngải) — ưu tiên thứ 3',
       priority = 3
 where code = 'C2B';

update ctt_combos
   set name = 'Combo 1 (XBBH + Điện châm + Thủy châm + Xông hơi) — ưu tiên cao nhất',
       priority = 1
 where code = 'C1';

update ctt_combos
   set name = 'Combo 2 (XBBH + Điện châm + Thủy châm + Cứu ngải) — ưu tiên thứ 2',
       priority = 2
 where code = 'C2';

-- Kiểm tra lại: phải thấy đúng 3 dòng C1/C2/C3.
select code, name, step2_code, step4_code, priority from ctt_combos order by priority;
