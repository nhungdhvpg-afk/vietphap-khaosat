// Chạy tự động khi Vercel build. Đọc biến môi trường (Vercel > Settings >
// Environment Variables) và ghi ra public/config.js để trình duyệt dùng.
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[generate-config] CANH BAO: thieu bien moi truong SUPABASE_URL hoac SUPABASE_ANON_KEY. ' +
    'App se hien thong bao "Chua cau hinh Supabase" cho den khi bien duoc dien trong Vercel.'
  );
}

const content = `window.APP_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(SUPABASE_URL)},
  SUPABASE_ANON_KEY: ${JSON.stringify(SUPABASE_ANON_KEY)},
};
`;

const outPath = path.join(__dirname, '..', 'public', 'config.js');
fs.writeFileSync(outPath, content, 'utf8');
console.log('[generate-config] Da ghi', outPath);
