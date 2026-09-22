// Trả về quyền của tài khoản đang đăng nhập đối với module "Bảng chấm công
// Y sĩ - Bác sĩ". Module này KHÔNG lưu dữ liệu bệnh nhân/kết quả trên server
// (toàn bộ đọc file + tính toán chạy trong trình duyệt) — endpoint này chỉ
// gác cổng đăng nhập/phân quyền, giống hệt cơ chế "me" của module Chia thủ thuật.
const { getStaffFromRequest, canAccessChamCong, isChamCongManager } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const staffAcct = await getStaffFromRequest(req);
  if (!staffAcct) {
    res.status(401).json({ error: 'Chưa đăng nhập.' });
    return;
  }
  if (!canAccessChamCong(staffAcct)) {
    res.status(403).json({ error: 'Tài khoản này không có quyền vào module Bảng chấm công.' });
    return;
  }
  res.status(200).json({
    me: {
      email: staffAcct.email,
      role: staffAcct.role,
      cham_cong_manager: staffAcct.cham_cong_manager,
      canManage: isChamCongManager(staffAcct),
    },
  });
};
