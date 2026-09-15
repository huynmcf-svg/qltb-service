import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { PermissionsGuard } from './permissions.guard';

function ctx(required: string[] | undefined, permissions: string[]): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ auth_user: { permissions } }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  function guard(required: string[] | undefined) {
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  }

  it('không khai quyền thì cho qua', () => {
    expect(guard(undefined).canActivate(ctx(undefined, []))).toBe(true);
  });

  it('phải có ĐỦ mọi quyền (AND)', () => {
    expect(guard(['device.read', 'device.create']).canActivate(ctx([], ['device.read', 'device.create']))).toBe(true);
    expect(() => guard(['device.read', 'device.create']).canActivate(ctx([], ['device.read']))).toThrow(AppException);
  });

  it('nêu rõ quyền thiếu trong details', () => {
    try {
      guard(['device.assign']).canActivate(ctx([], ['device.read']));
      fail('phải ném');
    } catch (e) {
      expect((e as AppException).code).toBe('AUTHORIZATION_FAILED');
      expect((e as AppException).details.missing_permissions).toEqual(['device.assign']);
    }
  });
});
