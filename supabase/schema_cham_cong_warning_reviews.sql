-- ============================================================================
-- VIỆT PHÁP · GHI NHỚ QUYẾT ĐỊNH XEM XÉT CẢNH BÁO CỦA MODULE "BẢNG CHẤM CÔNG"
-- Chạy 1 lần trong Supabase SQL Editor (project vietphap-khaosat2).
--
-- Mỗi cảnh báo (VD "Trùng giờ thủ thuật/dịch vụ" của 1 người) lặp lại hàng
-- tháng vì dựa trên NGÀY/GIỜ thực tế trong file mới — nên quyết định xem xét
-- không thể lưu theo 1 ngày cụ thể mà lưu theo CẶP (người, loại cảnh báo):
--   - decision='error'     : người phụ trách đã kiểm tra, xác nhận ĐÚNG LÀ
--     LỖI/bất thường -> vẫn tiếp tục cảnh báo bình thường ở các tháng sau
--     (lưu lại chỉ để có dấu vết đã từng bị phát hiện + xác nhận).
--   - decision='dismissed' : người phụ trách đã kiểm tra, xác nhận đây là
--     tình huống bình thường (kèm lý do bắt buộc) -> các tháng sau KHÔNG
--     cảnh báo lại cho đúng cặp (người, loại cảnh báo) này nữa.
-- Bảng này KHÔNG chứa dữ liệu bệnh nhân/BHYT — chỉ chứa tên nhân sự + loại
-- cảnh báo + lý do, nên lưu trên server là hợp lý (khác với báo cáo gốc).
-- ============================================================================

create table if not exists cham_cong_warning_reviews (
  id              uuid primary key default gen_random_uuid(),
  person_key      text not null,          -- tên nhân sự đã chuẩn hoá (viết hoa, gộp khoảng trắng)
  person_display  text not null,          -- tên hiển thị đẹp, chỉ để tiện đọc khi tra bảng
  category        text not null,          -- đúng chuỗi "Loại cảnh báo" mà app sinh ra
  decision        text not null check (decision in ('error', 'dismissed')),
  note            text,                   -- lý do (bắt buộc khi decision='dismissed', ở tầng API)
  reviewed_by     text not null,          -- email tài khoản đã bấm xác nhận/bỏ qua
  reviewed_at     timestamptz not null default now(),
  unique (person_key, category)
);

create index if not exists cham_cong_warning_reviews_person_idx on cham_cong_warning_reviews (person_key);
