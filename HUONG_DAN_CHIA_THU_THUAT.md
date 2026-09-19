# Hướng dẫn dùng module "Chia thủ thuật YHCT" — Việt Pháp

Module này là 1 trang **riêng biệt** (`/ctt/`) bên trong cùng app khảo sát đã
triển khai, dùng chung tài khoản đăng nhập, chung Supabase/Vercel — **không
cần tạo project mới**, chỉ cần chạy thêm 1 file SQL và bấm đưa lại code lên
Vercel.

## Module làm gì?

Nhập vào: **danh sách bệnh nhân trong ngày** (chỉ cần STT + Họ tên).

Hệ thống tự động:
1. Xếp cho mỗi bệnh nhân đủ 4 bước: **Xoa bóp bấm huyệt → Điện châm/Hào châm
   → Thủy châm → Xông hơi/Cứu ngải**.
2. Chọn máy (2 máy Xông, 4 máy Châm) và nhân viên phù hợp (đúng vai trò
   BS/YS/DD được phép làm từng thủ thuật), không bao giờ xếp trùng giờ 1
   người hoặc 1 máy cho 2 việc.
3. **Luôn ưu tiên dùng hết công suất 2 máy Xông** trước khi chuyển bệnh nhân
   sang Cứu ngải — chỉ chuyển sang Cứu ngải khi chờ máy Xông sẽ khiến bệnh
   nhân không kịp hoàn tất phác đồ trong ca. Tương tự với Điện châm so với
   Hào châm.
4. Tự gắn nhãn combo theo cách gọi quen thuộc: **C1** (Điện châm+Xông, tốt
   nhất), **C2** (Điện châm+Cứu ngải), **C2B** (Hào châm+Cứu ngải), **C3**
   (Hào châm+Xông).
5. Vi Thị Hoá **luôn** là người trông Thủy châm, Đỗ Văn Thắng **luôn** là
   người trông Điện châm (đúng thực tế phân công) — 2 quy tắc này chỉnh được
   trong màn hình **Cài đặt** nếu sau này đổi người.
6. Không bao giờ xếp thủ thuật ngoài khung giờ BHYT (07:00–11:30 và
   13:30–17:00) hoặc vắt qua giờ nghỉ trưa.
7. Ngô Văn Thường (hành chính khoa) không bị chia việc.

Đầu ra: bảng lịch xem theo **Bệnh nhân / Nhân viên / Máy**, cảnh báo bệnh
nhân nào thiếu bước (do hết giờ/hết chỗ), và nút xuất **Excel** + **In/Xuất
PDF**.

---

## Bước 1 — Chạy thêm 1 file SQL trong Supabase

1. Vào lại Supabase project đã tạo trước đó (Bước 1.2 trong
   `HUONG_DAN_TRIEN_KHAI.md`).
2. Vào **SQL Editor > New query**.
3. Mở file `supabase/schema_chia_thu_thuat.sql` trong mã nguồn, copy **toàn
   bộ nội dung**, dán vào rồi bấm **Run**.
4. Thấy **"Success"** là xong. File này đã có sẵn dữ liệu mẫu đúng theo danh
   sách 18 nhân sự, 7 loại thủ thuật, 6 máy (2 Xông + 4 Châm), khung giờ ca
   thực tế của Việt Pháp — **không cần nhập tay gì thêm**, dùng được ngay.

> Bảng mới (tên bắt đầu bằng `ctt_`) hoàn toàn tách biệt với bảng khảo sát
> cũ (`survey_responses`, `staff_accounts`...) — không đụng chạm dữ liệu cũ.

## Bước 2 — Đưa code lên Vercel (nếu chưa tự động)

Nếu Vercel đã nối với GitHub repo (đã làm ở lần triển khai app khảo sát),
việc đẩy code này lên nhánh và merge vào nhánh chính sẽ tự động build lại —
**không cần thêm biến môi trường mới** (dùng chung `SUPABASE_URL` và
`SUPABASE_SERVICE_ROLE_KEY` đã cấu hình sẵn).

## Bước 3 — Vào dùng

1. Mở app khảo sát như bình thường → **Xem như quản lý** → đăng nhập.
2. Bấm nút **"🩺 Chia thủ thuật YHCT"** ở đầu trang quản lý (hoặc vào thẳng
   đường dẫn `<link-app-của-chị>/ctt/index.html`).
3. Đăng nhập lại (dùng chung tài khoản email/mật khẩu).

### Chia thủ thuật cho 1 ngày
1. Chọn ngày.
2. Dán danh sách vào ô "Dán nhanh" — mỗi dòng 1 người, dạng `STT  Họ tên`
   (cách nhau bằng dấu Tab, dấu phẩy hoặc khoảng trắng đều được), rồi bấm
   **"↓ Thêm vào danh sách"**. Có thể sửa tay từng dòng trong bảng bên dưới,
   hoặc chọn ép 1 combo cụ thể cho từng người ở cột "Combo" (bình thường để
   trống cho hệ thống tự chọn tối ưu).
3. Bấm **"⚙ Chia thủ thuật"**. Kết quả hiện ngay bên dưới: tổng quan số
   liệu, cảnh báo (nếu có), và 3 bảng xem theo Bệnh nhân / Nhân viên / Máy.
4. Bấm **"⬇ Xuất Excel"** để lưu file, hoặc **"🖨 In / Xuất PDF"** để in trực
   tiếp hoặc lưu thành PDF.
5. Nếu cần sửa danh sách và chia lại: sửa bảng rồi bấm "Chia thủ thuật" lần
   nữa — lịch cũ của đúng ngày đó sẽ được thay bằng lịch mới.

### Xem lại lịch ngày trước
Vào tab **"Xem lại theo ngày"**, chọn ngày, bấm **"Tải lịch"**.

### Cài đặt
Vào tab **"Cài đặt"** để:
- Đổi giờ ca sáng/chiều (mặc định đúng khung BHYT 07:00–11:30, 13:30–17:00).
- Bật/tắt nhân sự đang tham gia chia thủ thuật (VD: khi có người nghỉ phép).
- Bật/tắt máy (khi máy hỏng, sửa chữa).
- Đổi người trông cố định cho Điện châm / Thủy châm.
- Đổi "sức chứa theo dõi" — 1 người theo dõi được tối đa bao nhiêu bệnh nhân
  cùng lúc cho từng loại thủ thuật (mặc định: Điện châm/Thủy châm = 4 người
  cùng lúc do dùng chung 4 máy Châm; Hào châm = 8).
- Thêm nhân sự/máy mới khi phòng khám mở rộng.

---

## Vì sao dữ liệu lưu trên Supabase mà không chỉ tính tại chỗ?

Để giữ được **lịch sử chia thủ thuật từng ngày** (tra cứu lại khi có khiếu
nại, đối chiếu công/lương, hoặc phân tích hiệu suất máy/nhân sự theo thời
gian) và cho phép **nhiều người cùng xem** (lễ tân nhập danh sách, điều
dưỡng trưởng xem lịch phân công) mà không cần gửi file qua lại.
