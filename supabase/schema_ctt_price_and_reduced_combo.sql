-- ============================================================================
-- VIỆT PHÁP · GIÁ THỦ THUẬT + BỎ NGHỈ BẮT BUỘC SAU XÔNG HƠI
-- Chạy 1 lần trong Supabase SQL Editor.
--
-- Theo trao đổi với bác sĩ chuyên môn:
-- 1. Thời gian nghỉ bắt buộc sau Xông hơi (trước đây 15 phút) là KHÔNG cần
--    thiết — bỏ để phác đồ đầy đủ rút ngắn còn ~101 phút (từ ~116 phút),
--    có thêm dư giờ để xếp được nhiều bệnh nhân hơn vào cuối mỗi buổi.
-- 2. Bổ sung giá từng thủ thuật (đồng/lượt) — dùng để thuật toán tự chọn
--    phác đồ RÚT GỌN "nhiều tiền nhất có thể" khi không đủ giờ làm trọn 4
--    bước (áp dụng cho suất giữ chỗ bị ép sau mốc muộn 10h30/16h00, và bệnh
--    nhân mới thêm vào sát giờ đóng cửa qua "+ Thêm 1 dòng").
-- ============================================================================

update ctt_procedure_types set rest_after_minutes = 0 where code = 'XH';

alter table ctt_procedure_types add column if not exists price int not null default 0;

update ctt_procedure_types set price = 76000 where code = 'XBBH';
update ctt_procedure_types set price = 78300 where code = 'DC';
update ctt_procedure_types set price = 76300 where code = 'HC';
update ctt_procedure_types set price = 77100 where code = 'TC';
update ctt_procedure_types set price = 50000 where code = 'XH';
update ctt_procedure_types set price = 37000 where code = 'CN';

-- Số suất giữ chỗ BNM bắt buộc phải nằm sau mốc "muộn" của mỗi buổi (VD tối
-- thiểu 2 suất sau 10h30 sáng / 16h00 chiều) — phần còn lại (nếu để dành
-- nhiều hơn số này) vẫn xếp theo kiểu "muộn nhất có thể" như trước (ưu tiên
-- giữ trọn phác đồ đầy đủ khi còn đủ giờ).
alter table ctt_reserved_slots add column if not exists min_after_checkpoint_morning int not null default 0;
alter table ctt_reserved_slots add column if not exists min_after_checkpoint_afternoon int not null default 0;

-- Đánh dấu suất giữ chỗ nào thuộc nhóm "checkpoint" (ép sau mốc muộn, chấp
-- nhận phác đồ rút gọn) hay "tail" (muộn nhất có thể, vẫn ưu tiên đủ 4 bước).
alter table ctt_patients add column if not exists placeholder_tier text check (placeholder_tier in ('checkpoint', 'tail'));
