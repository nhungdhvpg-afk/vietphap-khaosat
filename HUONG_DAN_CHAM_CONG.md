# Hướng dẫn — Bảng chấm công Y sĩ - Bác sĩ

Module này đọc 3 báo cáo xuất từ phần mềm HIS (Bảng kê chi phí chi tiết, Sổ
kết quả CLS theo bác sĩ, Sổ thủ thuật trong ngày làm), tự động tính **công**
cho toàn bộ y sĩ/bác sĩ có tên trong 3 file theo đúng khung giờ hành chính
(1 ca = 0,5 công; đủ sáng + chiều = 1 công), và phát hiện các dấu hiệu nghi
vấn (trùng giờ, ghi giờ hàng loạt, thời gian xử lý quá ngắn...) có nguy cơ
bị BHXH xuất toán khi giám định.

**Toàn bộ việc đọc file và tính toán chạy NGAY TRONG TRÌNH DUYỆT** — không có
dữ liệu bệnh nhân/BHYT nào được gửi lên server hay lưu vào Supabase. Kết quả
chỉ tồn tại trên máy đang mở trình duyệt, cho đến khi bấm tải file Excel về.

## 1. Thiết lập lần đầu (CEO làm 1 lần)

1. Mở `supabase/schema_cham_cong_accounts.sql`, copy toàn bộ, dán vào Supabase
   SQL Editor (project vietphap-khaosat2) rồi bấm Run — chỉ cần chạy 1 lần.
   File này thêm vai trò `cham_cong_staff` và cột `cham_cong_manager` vào bảng
   `staff_accounts` sẵn có — **không đụng đến** tài khoản của module Khảo sát
   hay Chia thủ thuật.
2. Vào `https://vietphap-khaosat.vercel.app/cham-cong/index.html`, đăng nhập
   bằng tài khoản CEO sẵn có (dùng chung 1 tài khoản CEO cho mọi module).
3. Vào tab **"Cài đặt"** → mục "Quản lý tài khoản đăng nhập" → tạo tài khoản
   cho người phụ trách (kế toán/nhân sự). Tài khoản này có vai trò
   `cham_cong_staff` — CHỈ dùng được module này, không tự động vào được Chia
   thủ thuật hay dashboard Khảo sát (và ngược lại).
4. Gửi email + mật khẩu tạm cho người đó.

## 2. Dùng hàng tháng (người phụ trách)

1. Xuất 3 báo cáo từ HIS cho đúng kỳ cần chấm công (giữ nguyên cấu trúc cột
   như bản mẫu — không đổi tên cột, không xoá cột).
2. Đăng nhập `cham-cong/index.html`.
3. Ở tab **"Chấm công"**, bấm chọn file rồi chọn CẢ 3 file cùng lúc (giữ
   Ctrl/Cmd khi chọn nhiều file) — không cần đúng thứ tự, hệ thống tự nhận
   diện file nào là gì dựa vào nội dung và hiện tên file vào đúng ô ① ② ③.
   Nếu 1 file không nhận diện được, khung màu đỏ sẽ báo tên file đó để kiểm
   tra lại (thường do đổi cấu trúc cột/tiêu đề so với bản mẫu).
4. Kiểm tra (hoặc sửa) **khung giờ hành chính** ngay dưới — mặc định Sáng
   07:00-11:30, Chiều 13:30-17:00. Bản ghi ngoài khung giờ này bị loại, không
   tính công.
5. Bấm **"⚙ Xử lý & lập bảng chấm công"**. Sau vài giây, kết quả hiện ngay:
   - **Chấm công BS theo ngày** — ma trận mỗi ô 1 (đủ công) / 0,5 (nửa công) / trống.
   - **Chấm công ngày (tổng hợp)** — rút gọn theo bác sĩ, có dòng TỔNG, dùng để chốt công cuối tháng.
   - **Chấm công chi tiết** — giờ hoạt động sớm nhất - muộn nhất mỗi người mỗi ngày (chỉ tính trong khung giờ).
   - Danh sách cảnh báo nghi vấn, xếp theo mức độ CAO trước.
6. Sửa khung giờ xong, bấm lại "⚙ Xử lý" để tính lại ngay — **không cần tải file lại**.
7. Bấm **"⬇ Tải Excel đầy đủ (6 sheet)"** để lưu lại hồ sơ: Chấm công BS ·
   Chấm công ngày · Chấm công chi tiết · Chi tiết hoạt động (nhật ký từng
   lượt, có cột Ca) · Cảnh báo · Ghi chú & căn cứ pháp lý.
8. Với mọi dòng cảnh báo mức **CAO**, đối chiếu lại hồ sơ giấy/camera trước
   khi gửi hồ sơ đề nghị thanh toán BHYT.

**Quy tắc chấm công theo ca (bắt buộc):** 1 bác sĩ được tính 1 ca ở 1 buổi
trong ngày nếu có ít nhất 1 bản ghi (từ bất kỳ nguồn nào) rơi trong khung giờ
hành chính của buổi đó — nhiều bản ghi cùng buổi vẫn chỉ tính 1 ca. Riêng Sổ
thủ thuật (có giờ bắt đầu-kết thúc): **cả 2 mốc** phải cùng nằm trong 1 khung
mới tính — ca lấn qua giờ nghỉ trưa hoặc ngoài giờ hành chính bị loại hoàn
toàn. 1 ca = 0,5 công; đủ sáng + chiều = 1 công.

**Lưu ý quan trọng:** "Giờ hoạt động" là giờ đầu-cuối các sự kiện hệ thống
HIS ghi nhận trong ngày — KHÔNG PHẢI giờ vào/ra qua máy chấm công vân
tay/camera thực tế. Dùng để rà soát/đối chiếu, không dùng trực tiếp để tính
lương. Chi tiết giả định xử lý dữ liệu xem trong sheet "6.GhiChu" của file
Excel xuất ra, hoặc tab "Cài đặt" của trang.

**Tự kiểm tra dữ liệu đầu vào:** công cụ tự lọc bỏ các sự kiện rơi ra ngoài
tháng đang chấm công (VD file "chi phí chi tiết" đôi khi kèm vài dòng gối
đầu từ cuối tháng trước) và báo rõ số lượng đã loại. Nếu 1 file có tỉ lệ
dòng không đọc được ngày/giờ vượt 20%, trang sẽ hiện khung đỏ cảnh báo nghi
ngờ HIS đã đổi cấu trúc cột — khi đó dừng lại, kiểm tra file gốc trước khi
dùng kết quả.

---
*Câu hỏi/lỗi phát sinh: xem lại đúng cấu trúc cột 3 file đầu vào trước, vì
công cụ đọc theo đúng tên/vị trí cột đã khảo sát từ bản mẫu ban đầu.*
