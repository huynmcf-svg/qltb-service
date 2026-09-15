import { EX } from '../../../common/swagger/example-values';
import type { AlertView, NotificationView } from './alert.dto';

export const EXAMPLE_ALERT: AlertView = {
  alert_id: 'b8c9d0e1-0000-4000-8000-000000000008',
  device_id: EX.device_id,
  serial_number: EX.serial_number,
  enterprise_id: EX.enterprise_id,
  enterprise_name: EX.enterprise_name,
  type: 'QUOTA_BELOW_20',
  group: 'QUOTA',
  severity: 'INFO',
  message: 'Máy QLTB-24-000123 còn 17,5 % sản lượng (1.750 / 10.000)',
  payload: { remaining: 1750, total: 10000, remaining_pct: 17.5 },
  occurred_at: EX.now,
  resolved_at: null,
};

export const EXAMPLE_NOTIFICATION: NotificationView = {
  notification_id: 'c9d0e1f2-0000-4000-8000-000000000009',
  alert_id: EXAMPLE_ALERT.alert_id,
  title: 'Sản lượng còn dưới 20 %',
  body: EXAMPLE_ALERT.message,
  alert: { type: 'QUOTA_BELOW_20', severity: 'INFO', device_id: EX.device_id, serial_number: EX.serial_number },
  read_at: null,
  created_at: EX.now,
};
