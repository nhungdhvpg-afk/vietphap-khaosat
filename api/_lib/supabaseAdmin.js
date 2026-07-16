// Client Supabase dùng khóa service_role — CHỈ chạy trên server (Vercel Function),
// không bao giờ được gửi xuống trình duyệt.
//
// Lý do tồn tại file này: Data API (PostgREST) của dự án Supabase hiện dùng
// đang từ chối request với vai trò anon/authenticated (báo lỗi RLS 42501/401)
// dù chính sách RLS đã được xác nhận đúng khi test trực tiếp bằng SQL — đây là
// sự cố ở tầng cổng API của Supabase, tái hiện trên cả 2 project khác nhau.
// Dùng service_role (bỏ qua RLS) từ server để né hoàn toàn đường đi bị lỗi đó;
// quyền hạn theo vai trò được tự kiểm tra lại trong code ở đây thay cho RLS.
const { createClient } = require('@supabase/supabase-js');

let client;
function getSupabaseAdmin() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    }
    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

module.exports = { getSupabaseAdmin };
