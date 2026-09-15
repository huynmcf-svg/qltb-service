import { EX } from '../../../common/swagger/example-values';
import { EXAMPLE_DEVICE_DETAIL } from '../../device/dto/device.examples';
import type { WarrantyFullView } from '../warranty.repository';

export const EXAMPLE_WARRANTY_FULL: WarrantyFullView = {
  ...EXAMPLE_DEVICE_DETAIL.warranty!,
  serial_number: EX.serial_number,
  enterprise_name: EX.enterprise_name,
};

export const EXAMPLE_WARRANTY_PAGE = { items: [EXAMPLE_WARRANTY_FULL], next_cursor: null };
