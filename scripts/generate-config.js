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

// Tự động "phá cache" app.js/config.js mỗi lần deploy — nếu không, trình
// duyệt (đặc biệt trên máy CEO/nhân viên hay để tab mở lâu ngày) có thể tiếp
// tục dùng app.js CŨ đã tải trước đó dù server đã có bản sửa lỗi mới, khiến
// tưởng nhầm là lỗi chưa được sửa dù đã deploy thành công. Gắn thêm
// "?v=<mã bản build>" (theo đúng commit Vercel đang build, hoặc mốc giờ nếu
// chạy ở máy local) vào mọi thẻ <script src="app.js"|"config.js"|"../config.js">.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : String(Date.now());
const htmlFiles = ['index.html', 'ctt/index.html', 'cham-cong/index.html'];
for (const rel of htmlFiles) {
  const htmlPath = path.join(__dirname, '..', 'public', rel);
  if (!fs.existsSync(htmlPath)) continue;
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(/(src=")((?:\.\.\/)?(?:app|config)\.js)(?:\?v=[^"]*)?(")/g, `$1$2?v=${buildId}$3`);
  fs.writeFileSync(htmlPath, html, 'utf8');
}
console.log('[generate-config] Da gan cache-busting ?v=' + buildId + ' vao app.js/config.js');
