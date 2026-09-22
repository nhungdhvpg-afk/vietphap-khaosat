# Hướng dẫn — Bảng chấm công Y sĩ - Bác sĩ

Module này đọc 3 báo cáo xuất từ phần mềm HIS (Bảng kê chi phí chi tiết, Sổ
kết quả CLS theo bác sĩ, Sổ thủ thuật trong ngày làm), tự động dựng bảng chấm
công theo ngày cho toàn bộ y sĩ/bác sĩ có tên trong 3 file, và phát hiện các
dấu hiệu nghi vấn (trùng giờ, ghi giờ hàng loạt, thời gian xử lý quá ngắn...)
có nguy cơ bị BHXH xuất toán khi giám định.

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
4. Bấm **"⚙ Xử lý & lập bảng chấm công"**. Sau vài giây, kết quả hiện ngay:
   - Bảng chấm công **chi tiết** (giờ hoạt động sớm nhất - muộn nhất mỗi người mỗi ngày).
   - Bảng chấm công **rút gọn** (chỉ đánh dấu "1" cho ngày có đi làm — dùng nhanh để đếm công).
   - Danh sách cảnh báo nghi vấn, xếp theo mức độ CAO trước.
5. Bấm **"⬇ Tải Excel đầy đủ (5 sheet)"** để lưu lại hồ sơ: Chấm công chi
   tiết · Chấm công rút gọn · Chi tiết hoạt động (nhật ký từng lượt) · Cảnh
   báo · Ghi chú & căn cứ pháp lý.
6. Với mọi dòng cảnh báo mức **CAO**, đối chiếu lại hồ sơ giấy/camera trước
   khi gửi hồ sơ đề nghị thanh toán BHYT.

**Lưu ý quan trọng:** "Giờ hoạt động" là giờ đầu-cuối các sự kiện hệ thống
HIS ghi nhận trong ngày — KHÔNG PHẢI giờ vào/ra qua máy chấm công vân
tay/camera thực tế. Dùng để rà soát/đối chiếu, không dùng trực tiếp để tính
lương. Chi tiết giả định xử lý dữ liệu xem trong sheet "4.GhiChu" của file
Excel xuất ra, hoặc tab "Cài đặt" của trang.

---
*Câu hỏi/lỗi phát sinh: xem lại đúng cấu trúc cột 3 file đầu vào trước, vì
công cụ đọc theo đúng tên/vị trí cột đã khảo sát từ bản mẫu ban đầu.*
