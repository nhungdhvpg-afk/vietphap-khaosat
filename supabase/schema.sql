-- ============================================================================
-- VIỆT PHÁP · ĐO LƯỜNG TRẢI NGHIỆM KHÁCH HÀNG
-- Schema cơ sở dữ liệu Supabase (Postgres) + Row Level Security (RLS)
--
-- CÁCH DÙNG: Vào Supabase Dashboard > SQL Editor > New query,
-- dán TOÀN BỘ nội dung file này vào rồi bấm "Run". Chỉ cần chạy 1 lần.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. BẢNG TÀI KHOẢN NỘI BỘ (staff_accounts)
--    Mỗi dòng gắn với 1 tài khoản đăng nhập (Supabase Auth) qua id = auth.users.id
--    Tài khoản Auth (email/mật khẩu) được tạo thủ công trong Authentication > Users,
--    sau đó insert dòng tương ứng vào bảng này (xem hướng dẫn triển khai).
-- ----------------------------------------------------------------------------
create table if not exists staff_accounts (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  role        text not null check (role in ('ceo', 'department_head')),
  department  text check (
                department is null or department in (
                  'Nội',
                  'QL bệnh Huyết áp - Tiểu đường',
                  'Y học cổ truyền',
                  'Sản',
                  'Nhi',
                  'Ngoại',
                  'Cấp cứu'
                )
              ),
  created_at  timestamptz not null default now(),
  constraint department_head_needs_department check (
    (role = 'ceo' and department is null) or
    (role = 'department_head' and department is not null)
  )
);

-- ----------------------------------------------------------------------------
-- 2. BẢNG PHẢN HỒI KHẢO SÁT (survey_responses)
-- ----------------------------------------------------------------------------
create table if not exists survey_responses (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  department        text not null check (
                        department in (
                          'Nội',
                          'QL bệnh Huyết áp - Tiểu đường',
                          'Y học cổ truyền',
                          'Sản',
                          'Nhi',
                          'Ngoại',
                          'Cấp cứu'
                        )
                      ),
  entry_point       text check (entry_point is null or entry_point in ('letan', 'kham', 'canlamsang', 'nhathuoc')),
  score_letan       smallint not null check (score_letan between 1 and 5),
  score_kham        smallint not null check (score_kham between 1 and 5),
  score_canlamsang  smallint not null check (score_canlamsang between 1 and 5),
  score_nhathuoc    smallint not null check (score_nhathuoc between 1 and 5),
  nps               smallint not null check (nps between 0 and 10),
  comment           text,
  resolved          boolean not null default false,
  resolved_by       text,
  resolved_at       timestamptz
);

create index if not exists idx_survey_responses_created_at on survey_responses (created_at desc);
create index if not exists idx_survey_responses_department on survey_responses (department);
create index if not exists idx_survey_responses_resolved on survey_responses (resolved) where resolved = false;

-- ----------------------------------------------------------------------------
-- 3. BẢNG NGƯỜI ĐƯỢC GIỚI THIỆU (referrals)
--    Tối đa 4 dòng cho mỗi survey_response (ứng dụng tự giới hạn ở phía giao diện)
-- ----------------------------------------------------------------------------
create table if not exists referrals (
  id                  uuid primary key default gen_random_uuid(),
  survey_response_id  uuid not null references survey_responses(id) on delete cascade,
  name                text,
  phone               text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_referrals_survey_response_id on referrals (survey_response_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Bắt buộc bật để: (1) bệnh nhân ẩn danh chỉ được GỬI khảo sát, không đọc được;
-- (2) trưởng khoa chỉ đọc được dữ liệu khoa mình; (3) CEO đọc được toàn bộ.
-- Số điện thoại người được giới thiệu là dữ liệu cá nhân — không public.
-- ============================================================================

alter table staff_accounts enable row level security;
alter table survey_responses enable row level security;
alter table referrals enable row level security;

-- ---- staff_accounts: mỗi tài khoản chỉ xem được chính dòng của mình ----
drop policy if exists "staff can view own account" on staff_accounts;
create policy "staff can view own account"
  on staff_accounts for select
  to authenticated
  using (id = auth.uid());

-- ---- survey_responses: bệnh nhân ẩn danh được GỬI (insert), không được đọc ----
drop policy if exists "anyone can submit survey" on survey_responses;
create policy "anyone can submit survey"
  on survey_responses for insert
  to anon, authenticated
  with check (true);

drop policy if exists "staff can view responses in scope" on survey_responses;
create policy "staff can view responses in scope"
  on survey_responses for select
  to authenticated
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.id = auth.uid()
        and (sa.role = 'ceo' or sa.department = survey_responses.department)
    )
  );

drop policy if exists "staff can resolve responses in scope" on survey_responses;
create policy "staff can resolve responses in scope"
  on survey_responses for update
  to authenticated
  using (
    exists (
      select 1 from staff_accounts sa
      where sa.id = auth.uid()
        and (sa.role = 'ceo' or sa.department = survey_responses.department)
    )
  )
  with check (
    exists (
      select 1 from staff_accounts sa
      where sa.id = auth.uid()
        and (sa.role = 'ceo' or sa.department = survey_responses.department)
    )
  );

-- ---- referrals: bệnh nhân ẩn danh được GỬI, chỉ nhân viên đúng khoa mới đọc được ----
drop policy if exists "anyone can submit referral" on referrals;
create policy "anyone can submit referral"
  on referrals for insert
  to anon, authenticated
  with check (true);

drop policy if exists "staff can view referrals in scope" on referrals;
create policy "staff can view referrals in scope"
  on referrals for select
  to authenticated
  using (
    exists (
      select 1 from survey_responses sr
      join staff_accounts sa on sa.id = auth.uid()
      where sr.id = referrals.survey_response_id
        and (sa.role = 'ceo' or sa.department = sr.department)
    )
  );

-- ============================================================================
-- REALTIME: cho phép dashboard tự cập nhật khi có khảo sát mới
-- (bọc trong DO block để chạy lại file này nhiều lần không bị lỗi)
-- ============================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table survey_responses;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table referrals;
  exception when duplicate_object then null;
  end;
end $$;
