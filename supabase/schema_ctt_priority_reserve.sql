-- ============================================================================
-- VIỆT PHÁP · ƯU TIÊN RA VIỆN + DÀNH SUẤT CHO BỆNH NHÂN THÊM SAU
-- Chạy 1 lần trong Supabase SQL Editor.
-- ============================================================================

-- Đánh dấu bệnh nhân "cần ra viện hôm nay" — được ưu tiên xếp vào khung giờ
-- SỚM NHẤT trong buổi để kịp làm hồ sơ ra viện. Mặc định false (bệnh nhân
-- ngoại trú bình thường, xếp theo đúng thứ tự STT như trước nay).
alter table ctt_patients add column if not exists priority_discharge boolean not null default false;

-- Số "suất" muốn chủ động để dành cho bệnh nhân mới nhập viện thêm sau
-- (dùng nút "+ Thêm 1 dòng" sau khi đã chia lần đầu trong ngày) — nhập 1 lần
-- trước khi bấm "Chia thủ thuật" lần đầu tiên của ngày đó.
create table if not exists ctt_reserved_slots (
  date            date primary key,
  morning_slots   int not null default 0,
  afternoon_slots int not null default 0,
  updated_at      timestamptz not null default now()
);

alter table ctt_reserved_slots enable row level security;
