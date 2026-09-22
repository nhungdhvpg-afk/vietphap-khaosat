-- ============================================================================
-- VIỆT PHÁP · ÉP LẠI ĐÚNG 3 COMBO CHÍNH THỨC (KHÔNG PHỤ THUỘC MÃ CŨ)
-- Chạy 1 lần trong Supabase SQL Editor.
--
-- File schema_ctt_combo_fix.sql trước đây giả định combo dự phòng cũ có mã
-- "C2B" — nếu CSDL thực tế không có đúng mã này, câu lệnh đổi tên không khớp
-- được dòng nào, dẫn tới sau khi chạy chỉ còn 2 combo (thiếu hẳn Combo 3).
-- File này AN TOÀN HƠN: ép thẳng đúng 3 dòng C1/C2/C3 cần có (tạo mới nếu
-- chưa có, cập nhật nếu đã có), rồi xoá sạch mọi combo khác ngoài 3 mã này —
-- không cần biết mã cũ là gì.
--
-- Combo 1 (ưu tiên cao nhất): XBBH + Điện châm + Thủy châm + Xông hơi
-- Combo 2 (ưu tiên thứ 2):    XBBH + Điện châm + Thủy châm + Cứu ngải
-- Combo 3 (ưu tiên thứ 3):    XBBH + Hào châm  + Thủy châm + Cứu ngải
-- ============================================================================

insert into ctt_combos (code, name, step2_code, step4_code, priority)
values
  ('C1', 'Combo 1 (XBBH + Điện châm + Thủy châm + Xông hơi) — ưu tiên cao nhất', 'DC', 'XH', 1),
  ('C2', 'Combo 2 (XBBH + Điện châm + Thủy châm + Cứu ngải) — ưu tiên thứ 2', 'DC', 'CN', 2),
  ('C3', 'Combo 3 (XBBH + Hào châm + Thủy châm + Cứu ngải) — ưu tiên thứ 3', 'HC', 'CN', 3)
on conflict (code) do update set
  name = excluded.name,
  step2_code = excluded.step2_code,
  step4_code = excluded.step4_code,
  priority = excluded.priority;

-- Dọn sạch mọi combo KHÁC ngoài đúng 3 mã C1/C2/C3 (VD combo dự phòng cũ còn
-- sót lại dưới mã khác, hoặc combo "Hào châm + Xông hơi" không hợp lệ).
delete from ctt_combos where code not in ('C1', 'C2', 'C3');

-- Kiểm tra lại: phải thấy ĐÚNG 3 dòng C1/C2/C3, đúng thứ tự ưu tiên 1-2-3.
select code, name, step2_code, step4_code, priority from ctt_combos order by priority;
