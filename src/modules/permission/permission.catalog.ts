/**
 * Danh mục quyền — nguồn sự thật, seed vào bảng `permissions`.
 *
 * Mã dạng `<group>.<action>`. `group` khớp cột `permissions.group` và bộ lọc
 * `module` của audit log. Thêm quyền = thêm dòng ở đây rồi `npm run db:seed`
 * (idempotent); guard đọc quyền từ DB qua vai trò, không đọc file này lúc chạy.
 */
export const PERMISSION_CATALOG = [
  // user
  { code: 'user.read', group: 'user', name: 'Xem người dùng' },
  { code: 'user.create', group: 'user', name: 'Tạo người dùng' },
  { code: 'user.update', group: 'user', name: 'Sửa người dùng' },
  { code: 'user.disable', group: 'user', name: 'Khoá / mở người dùng' },
  { code: 'user.assign_role', group: 'user', name: 'Gán vai trò' },
  { code: 'user.delete', group: 'user', name: 'Xoá người dùng' },
  { code: 'role.read', group: 'user', name: 'Xem vai trò' },
  { code: 'role.manage', group: 'user', name: 'Tạo / sửa / xoá vai trò và quyền' },
  // enterprise
  { code: 'enterprise.read', group: 'enterprise', name: 'Xem doanh nghiệp' },
  { code: 'enterprise.create', group: 'enterprise', name: 'Tạo doanh nghiệp' },
  { code: 'enterprise.update', group: 'enterprise', name: 'Sửa doanh nghiệp' },
  { code: 'enterprise.status', group: 'enterprise', name: 'Đổi trạng thái doanh nghiệp' },
  { code: 'enterprise.delete', group: 'enterprise', name: 'Xoá doanh nghiệp' },
  // device
  { code: 'device.read', group: 'device', name: 'Xem thiết bị' },
  { code: 'device.create', group: 'device', name: 'Nhập thiết bị vào kho' },
  { code: 'device.update', group: 'device', name: 'Sửa hồ sơ thiết bị' },
  { code: 'device.assign', group: 'device', name: 'Gán / thu hồi thiết bị' },
  { code: 'device.status', group: 'device', name: 'Đổi trạng thái thiết bị' },
  { code: 'device.delete', group: 'device', name: 'Xoá thiết bị' },
  // warranty
  { code: 'warranty.read', group: 'warranty', name: 'Xem bảo hành' },
  { code: 'warranty.manage', group: 'warranty', name: 'Tạo / gia hạn bảo hành' },
  // quota
  { code: 'quota.read', group: 'quota', name: 'Xem sản lượng' },
  { code: 'quota.grant', group: 'quota', name: 'Cấp sản lượng' },
  { code: 'quota.allocate', group: 'quota', name: 'Phân bổ sản lượng xuống chi nhánh' },
  { code: 'quota.lock', group: 'quota', name: 'Khoá / mở khoá máy' },
  { code: 'quota.update', group: 'quota', name: 'Sửa ngưỡng cảnh báo, thời gian gói' },
  { code: 'usage.read', group: 'quota', name: 'Xem lượt sử dụng' },
  // alert
  { code: 'alert.read', group: 'alert', name: 'Xem cảnh báo' },
  // exchange
  { code: 'exchange.read', group: 'exchange', name: 'Xem yêu cầu đổi trả' },
  { code: 'exchange.request', group: 'exchange', name: 'Tạo / sửa / xoá yêu cầu đổi trả' },
  { code: 'exchange.approve', group: 'exchange', name: 'Duyệt / từ chối đổi trả' },
  // report & audit
  { code: 'dashboard.admin', group: 'report', name: 'Xem dashboard quản trị' },
  { code: 'dashboard.business', group: 'report', name: 'Xem dashboard doanh nghiệp' },
  { code: 'report.export', group: 'report', name: 'Xuất báo cáo' },
  { code: 'audit.read', group: 'audit', name: 'Xem nhật ký kiểm toán' },
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number]['code'];

const all = PERMISSION_CATALOG.map((p) => p.code);

/** Vai trò seed. Vai trò là DỮ LIỆU — đây chỉ là bộ mặc định lúc dựng hệ thống. */
export const ROLE_SEED: Array<{
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: readonly Permission[];
}> = [
  {
    code: 'SYSTEM_ADMIN',
    name: 'Quản trị hệ thống',
    description: 'Toàn quyền. enterprise_id = NULL.',
    is_system: true,
    permissions: all,
  },
  {
    code: 'ENTERPRISE_ADMIN',
    name: 'Quản trị doanh nghiệp',
    description: 'Quản lý người dùng, thiết bị, sản lượng của doanh nghiệp mình và chi nhánh.',
    is_system: true,
    permissions: [
      'user.read', 'user.create', 'user.update', 'user.disable', 'user.assign_role', 'role.read',
      'enterprise.read',
      'device.read', 'device.update',
      'warranty.read',
      'quota.read', 'quota.allocate', 'usage.read',
      'alert.read',
      'exchange.read', 'exchange.request',
      'dashboard.business', 'report.export', 'audit.read',
    ],
  },
  {
    code: 'ENTERPRISE_USER',
    name: 'Nhân viên doanh nghiệp',
    description: 'Xem thiết bị, sản lượng, thông báo của doanh nghiệp mình.',
    is_system: true,
    permissions: ['device.read', 'warranty.read', 'quota.read', 'usage.read', 'alert.read', 'exchange.read', 'dashboard.business'],
  },
];
