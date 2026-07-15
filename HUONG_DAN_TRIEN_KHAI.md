# Hướng dẫn đưa app Khảo sát Việt Pháp lên mạng (miễn phí)

Tài liệu này dành cho người **không rành kỹ thuật**. Cứ làm theo đúng thứ tự,
mỗi bước đều nói rõ bấm vào đâu. Toàn bộ công cụ dùng ở đây đều **miễn phí**
ở quy mô 1 phòng khám.

Tổng cộng có 3 phần:
- **Phần 1 — Supabase**: nơi lưu dữ liệu khảo sát (cơ sở dữ liệu).
- **Phần 2 — Vercel**: nơi đưa app lên mạng để có link công khai.
- **Phần 3 — Mã QR**: tạo 4 mã QR dán ở 4 khu vực.

Chuẩn bị sẵn: 1 email của chị (dùng để tạo tài khoản), khoảng 20–30 phút.

---

## PHẦN 1 — Tạo cơ sở dữ liệu miễn phí trên Supabase

### Bước 1.1 — Tạo tài khoản Supabase
1. Mở trình duyệt, vào **https://supabase.com**
2. Bấm **"Start your project"** (hoặc **"Sign in"** nếu đã thấy nút đó).
3. Chọn **"Continue with GitHub"** (khuyên dùng — vì app đã có sẵn trên GitHub) hoặc đăng ký bằng email.
4. Nếu Supabase hỏi tạo **Organization**: đặt tên tuỳ ý, ví dụ `Viet Phap Clinic`, chọn gói **Free**, bấm **Create**.

### Bước 1.2 — Tạo Project (dự án)
1. Bấm **"New Project"**.
2. Điền:
   - **Name**: `vietphap-khaosat`
   - **Database Password**: đặt 1 mật khẩu mạnh — **chép mật khẩu này ra Note/Notepad lưu lại**, vì sẽ khó xem lại sau này.
   - **Region**: chọn **Southeast Asia (Singapore)** (gần Việt Nam nhất, tải trang nhanh hơn).
   - **Pricing Plan**: **Free**.
3. Bấm **"Create new project"**. Đợi khoảng 1–2 phút để Supabase khởi tạo xong (có thanh tiến trình).

### Bước 1.3 — Tạo cấu trúc dữ liệu (chạy 1 file SQL có sẵn)
1. Ở menu bên trái, bấm biểu tượng **SQL Editor** (hình `</>`).
2. Bấm **"New query"**.
3. Mở file `supabase/schema.sql` trong mã nguồn app (Claude đã tạo sẵn, nội dung
   nằm trong repo GitHub `nhungdhvpg-afk/vietphap-khaosat`, nhánh
   `claude/exciting-bell-mw1yx7`) — copy **toàn bộ nội dung file** rồi dán vào ô SQL Editor.
4. Bấm nút **"Run"** (hoặc `Ctrl+Enter` / `Cmd+Enter`).
5. Thấy dòng **"Success. No rows returned"** là xong — cấu trúc dữ liệu (bảng khảo sát,
   bảng giới thiệu, bảng tài khoản nội bộ) đã được tạo, kèm luôn cơ chế bảo mật
   để trưởng khoa chỉ xem được đúng khoa mình.

### Bước 1.4 — Lấy 2 thông tin kết nối (cần cho bước Vercel sau)
1. Ở menu bên trái, bấm **⚙️ Project Settings** > **API** (hoặc **"API Keys"**).
2. Chị sẽ thấy:
   - **Project URL** — dạng `https://xxxxxxxxxxxxx.supabase.co`
   - **anon public** key — một chuỗi ký tự dài.
3. **Copy cả 2 giá trị này, dán tạm vào Notepad** — sẽ dùng ở Phần 2.
   (2 giá trị này **không phải là bí mật tuyệt đối** — chúng được thiết kế để dùng công khai
   trong app trình duyệt, dữ liệu vẫn được bảo vệ nhờ cơ chế phân quyền đã bật ở Bước 1.3.)

### Bước 1.5 — Tạo tài khoản đăng nhập cho CEO và 7 trưởng khoa
1. Ở menu bên trái, bấm **Authentication** > tab **Users**.
2. Bấm **"Add user"** > **"Create new user"**.
3. Điền:
   - **Email**: ví dụ `ceo@vietphapclinic.vn` (hoặc dùng email thật của chị)
   - **Password**: đặt mật khẩu, ví dụ `Vietphap@2026`
   - **Bật (tick chọn) ô "Auto Confirm User"** — bắt buộc, nếu không bật thì tài khoản
     sẽ yêu cầu xác nhận qua email và không đăng nhập được ngay.
4. Bấm **"Create user"**.
5. Lặp lại bước 2–4 cho đủ **8 tài khoản**: 1 CEO + 7 trưởng khoa. Gợi ý đặt email
   dễ nhớ theo khoa, ví dụ:

   | Vai trò | Email gợi ý | Mật khẩu gợi ý |
   |---|---|---|
   | CEO | ceo@vietphapclinic.vn | (tự đặt, lưu lại) |
   | Trưởng khoa Nội | noikhoa@vietphapclinic.vn | |
   | Trưởng khoa QL Huyết áp - Tiểu đường | huyetap@vietphapclinic.vn | |
   | Trưởng khoa Y học cổ truyền | yhoccotruyen@vietphapclinic.vn | |
   | Trưởng khoa Sản | san@vietphapclinic.vn | |
   | Trưởng khoa Nhi | nhi@vietphapclinic.vn | |
   | Trưởng khoa Ngoại | ngoai@vietphapclinic.vn | |
   | Trưởng khoa Cấp cứu | capcuu@vietphapclinic.vn | |

   Chị có thể đổi email/mật khẩu tuỳ ý — chỉ cần **ghi nhớ lại chính xác** vì bước sau cần dùng đúng.

### Bước 1.6 — Gán vai trò (CEO xem hết / trưởng khoa chỉ xem khoa mình)
1. Quay lại **SQL Editor** > **"New query"**.
2. Mở file `supabase/link_staff_accounts.sql` trong mã nguồn app.
3. Copy nội dung, dán vào ô SQL Editor.
4. **Sửa lại từng email** trong file cho đúng với email chị đã tạo ở Bước 1.5
   (mỗi dòng `insert into staff_accounts...` có 1 chỗ ghi `-- <-- THAY` — sửa đúng email tương ứng).
5. Bấm **"Run"**.
6. Kéo xuống cuối kết quả — sẽ thấy bảng liệt kê 8 tài khoản với đúng vai trò
   (`ceo` hoặc `department_head`) và khoa tương ứng. Nếu thiếu dòng nào, kiểm tra
   lại email đã gõ đúng chưa rồi chạy lại (chạy lại nhiều lần không sao).

✅ **Xong Phần 1** — cơ sở dữ liệu đã sẵn sàng.

---

## PHẦN 2 — Đưa app lên mạng bằng Vercel (miễn phí)

### Bước 2.1 — Tạo tài khoản Vercel
1. Vào **https://vercel.com**
2. Bấm **"Sign Up"**.
3. Chọn **"Continue with GitHub"** — dùng đúng tài khoản GitHub đang chứa
   repo `nhungdhvpg-afk/vietphap-khaosat`.
4. Cho phép Vercel truy cập GitHub khi được hỏi (bấm **Authorize**).

### Bước 2.2 — Nhập (Import) project từ GitHub
1. Trong Vercel Dashboard, bấm **"Add New..."** > **"Project"**.
2. Nếu Vercel chưa thấy repo, bấm **"Adjust GitHub App Permissions"** (hoặc **"Configure GitHub App"**)
   → chọn **"Only select repositories"** → tick chọn `nhungdhvpg-afk/vietphap-khaosat` → **Save**.
3. Quay lại danh sách, tìm `vietphap-khaosat`, bấm **"Import"**.

### Bước 2.3 — Cấu hình rồi Deploy (quan trọng: điền biến môi trường TRƯỚC khi bấm Deploy)
1. Ở màn hình cấu hình project, phần **"Framework Preset"** để nguyên mặc định (Other) —
   app đã có sẵn file cấu hình `vercel.json` nên Vercel tự biết cách build.
2. Mở rộng mục **"Environment Variables"**. Thêm **2 biến**:

   | Name (Key) | Value |
   |---|---|
   | `SUPABASE_URL` | dán **Project URL** đã copy ở Bước 1.4 |
   | `SUPABASE_ANON_KEY` | dán **anon public key** đã copy ở Bước 1.4 |

   Với mỗi biến: gõ Name, dán Value, bấm **"Add"**.
3. Kiểm tra lại phần **"Git"** — đảm bảo nhánh được deploy là **`claude/exciting-bell-mw1yx7`**
   (đây là nhánh chứa toàn bộ code app; nếu Vercel hiện nhánh khác, đổi lại cho đúng).
4. Bấm **"Deploy"**. Đợi khoảng 30–60 giây.
5. Khi thấy pháo hoa 🎉 và nút **"Visit"** / **"Continue to Dashboard"** — bấm vào,
   chị sẽ thấy 1 link dạng **`https://vietphap-khaosat-xxxx.vercel.app`**.
   **Đây chính là link công khai để dán mã QR** và gửi cho mọi người.

### Bước 2.4 — Kiểm tra lần đầu
1. Mở link vừa có trên điện thoại.
2. Thử làm 1 lượt khảo sát (chọn khoa → 4 điểm chạm → NPS → góp ý → Gửi).
3. Bấm nút **"Xem như quản lý"** (góc trên bên phải), đăng nhập bằng tài khoản
   `ceo@vietphapclinic.vn` đã tạo ở Bước 1.5 — nếu thấy lượt khảo sát vừa làm
   hiện trong Dashboard là **thành công**.

Nếu trang báo **"Chưa cấu hình Supabase"**: quay lại Vercel > project > **Settings** >
**Environment Variables**, kiểm tra lại 2 giá trị đã dán đúng chưa, sửa nếu cần,
rồi vào tab **Deployments**, bấm vào bản mới nhất > nút **"..."** > **"Redeploy"**.

✅ **Xong Phần 2** — app đã có link công khai, chạy thật, lưu dữ liệu thật.

---

## PHẦN 3 — Tạo 4 mã QR dán tại 4 khu vực

Không cần cài phần mềm gì — dùng thẳng link tạo QR miễn phí sau, thay
`TEN-DU-AN-CUA-CHI.vercel.app` bằng link thật của chị ở Bước 2.3:

| Khu vực | Mở link này trên trình duyệt rồi lưu ảnh QR hiện ra |
|---|---|
| **Quầy Lễ tân** | `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=https://TEN-DU-AN-CUA-CHI.vercel.app` |
| **Mỗi phòng khám** | `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=https://TEN-DU-AN-CUA-CHI.vercel.app/?qr=kham` |
| **Khu Cận lâm sàng** (Xét nghiệm/X-quang) | `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=https://TEN-DU-AN-CUA-CHI.vercel.app/?qr=canlamsang` |
| **Quầy Nhà thuốc** | `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=https://TEN-DU-AN-CUA-CHI.vercel.app/?qr=nhathuoc` |

Cách lưu ảnh: mở link trên trình duyệt máy tính → chuột phải vào ảnh QR hiện ra →
**"Lưu ảnh thành..."** → in ra giấy, dán tại đúng khu vực. Bệnh nhân vẫn làm đủ
7 bước khảo sát bình thường dù quét QR nào — mã QR chỉ giúp biết họ *bắt đầu*
quét ở đâu để đối chiếu chéo.

---

## Vận hành hằng ngày

- **Xem báo cáo**: mở link app → **"Xem như quản lý"** → đăng nhập → xem KPI,
  biểu đồ, danh sách cần xử lý gấp, danh sách giới thiệu.
- **Đánh dấu đã xử lý** phản hồi tiêu cực: bấm nút **"Đánh dấu đã xử lý"** trong mục
  "Phản hồi cần chú ý".
- **Tải danh sách khách được giới thiệu**: bấm **"⬇ Export CSV giới thiệu"** — mở
  được bằng Excel.
- **Lọc theo thời gian**: dùng thanh **"Hôm nay / 7 ngày / 30 ngày / Toàn bộ / Tùy chọn"**.
- **Đổi mật khẩu tài khoản nội bộ**: vào Supabase > Authentication > Users > bấm vào
  tài khoản > đặt lại mật khẩu.
- **Dữ liệu cập nhật gần như ngay lập tức** — không cần bấm gì thêm, hoặc bấm
  **"↻ Làm mới"** nếu muốn chắc chắn.

---

## Xử lý sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Trang báo "Chưa cấu hình Supabase" | Vercel > Settings > Environment Variables — kiểm tra lại `SUPABASE_URL`, `SUPABASE_ANON_KEY`, rồi Redeploy. |
| Đăng nhập báo "Sai email hoặc mật khẩu" | Kiểm tra lại email/mật khẩu trong Supabase > Authentication > Users. Có thể đặt lại mật khẩu tại đó. |
| Đăng nhập báo "Tài khoản chưa được gán vai trò" | Chưa chạy (hoặc chạy sai email) ở Bước 1.6 — mở lại `link_staff_accounts.sql`, sửa đúng email, chạy lại. |
| Bệnh nhân gửi khảo sát bị lỗi mạng | App tự hiện thông báo đỏ và cho bấm "Gửi phản hồi" lại — dữ liệu đã nhập không bị mất. |
| Trưởng khoa thấy dữ liệu khoa khác | Không thể xảy ra do đã bật bảo mật ở cấp cơ sở dữ liệu (Bước 1.3) — nếu vẫn thấy, báo lại để kiểm tra bảng `staff_accounts`. |

---

## Những phần chưa làm (để sau nếu chị cần)

Theo đặc tả kỹ thuật, còn 2 việc thuộc **Giai đoạn 3** chưa triển khai trong lần này:

1. **Cảnh báo tự động qua Zalo OA** khi có phản hồi ≤ 2 sao — cần chị cung cấp
   Access Token của Zalo OA phòng khám (không nên gửi qua chat công khai).
2. **Tên miền riêng** (`khaosat.vietphapclinic.vn`) thay vì `*.vercel.app` — cần
   chị có quyền chỉnh DNS của tên miền `vietphapclinic.vn`.

Cả 2 việc này có thể bổ sung sau mà không ảnh hưởng gì tới phần đang chạy.
