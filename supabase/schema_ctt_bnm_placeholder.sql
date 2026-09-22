-- ============================================================================
-- VIỆT PHÁP · BỆNH NHÂN "GIỮ CHỖ" (BNM) CHO SUẤT ĐỂ DÀNH
-- Chạy 1 lần trong Supabase SQL Editor.
--
-- Trước đây "số suất để dành" chỉ là 1 con số trừu tượng (thu hẹp giờ kết
-- thúc ca vài phút) — không đủ đảm bảo giữ được chỗ thật khi danh sách ngoại
-- trú dài (1 phác đồ đầy đủ cần nhiều thời gian hơn nhiều so với vài phút
-- nhịp khám). Nay số suất này được biến thành các bệnh nhân "giữ chỗ" cụ thể
-- (tên tự động "BNM buổi sáng 1", "BNM buổi chiều 1"...), được xếp lịch THẬT
-- (chiếm đúng tài nguyên cần thiết) và ưu tiên xếp TRƯỚC bệnh nhân ngoại trú
-- — nên cần 2 cột mới để đánh dấu và ghi nhớ đúng buổi bị khoá của họ.
-- ============================================================================

alter table ctt_patients add column if not exists is_placeholder boolean not null default false;
alter table ctt_patients add column if not exists placeholder_shift text check (placeholder_shift in ('morning', 'afternoon'));
