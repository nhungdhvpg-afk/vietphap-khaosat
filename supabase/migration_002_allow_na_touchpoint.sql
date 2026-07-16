-- ============================================================================
-- MIGRATION: cho phép "Không sử dụng dịch vụ" ở Cận lâm sàng và Nhà thuốc
--
-- Chạy 1 lần trong Supabase Dashboard > SQL Editor > New query > Run.
-- An toàn để chạy lại nhiều lần (không làm mất dữ liệu đã có).
-- ============================================================================

alter table survey_responses alter column score_canlamsang drop not null;
alter table survey_responses alter column score_nhathuoc drop not null;

alter table survey_responses drop constraint if exists survey_responses_score_canlamsang_check;
alter table survey_responses add constraint survey_responses_score_canlamsang_check
  check (score_canlamsang is null or score_canlamsang between 1 and 5);

alter table survey_responses drop constraint if exists survey_responses_score_nhathuoc_check;
alter table survey_responses add constraint survey_responses_score_nhathuoc_check
  check (score_nhathuoc is null or score_nhathuoc between 1 and 5);
