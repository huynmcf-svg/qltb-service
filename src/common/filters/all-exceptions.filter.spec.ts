import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code';
import { mapException } from './all-exceptions.filter';

describe('mapException', () => {
  it('AppException giữ nguyên mã và details', () => {
    const mapped = mapException(AppException.notFound('thiết bị', 'abc'));
    expect(mapped).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'Không tìm thấy thiết bị',
      details: { resource: 'thiết bị', id: 'abc' },
    });
  });

  it('lỗi ValidationPipe gom vào details.violations', () => {
    const mapped = mapException(new BadRequestException(['code must be a string', 'name should not be empty']));
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe(ErrorCode.INVALID_PAYLOAD);
    expect(mapped.details.violations).toHaveLength(2);
  });

  it('HttpException trần được map mã theo status', () => {
    expect(mapException(new NotFoundException()).code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('lỗi lạ thành 500 với message cố định, không lộ chi tiết', () => {
    const mapped = mapException(new Error('relation "devices" does not exist'));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(mapped.message).toBe('Lỗi hệ thống');
  });
});
