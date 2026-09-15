import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { assertSystemAdmin, inScope } from '../../common/auth/scope';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AppException } from '../../common/errors/app.exception';
import { ApiAuthErrors, ApiEnvelopeResponse, ApiNoContentResponse, ApiNotFoundError, ApiValidationError } from '../../common/swagger/api-envelope';
import { AlertScanService } from './alert-scan.service';
import { AlertRepository } from './alert.repository';
import { ListAlertsDto, ListNotificationsDto } from './dto/alert.dto';
import { EXAMPLE_ALERT, EXAMPLE_NOTIFICATION } from './dto/alert.examples';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller()
export class AlertController {
  constructor(
    private readonly repo: AlertRepository,
    private readonly scanner: AlertScanService,
  ) {}

  @Get('alerts')
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'Danh sách cảnh báo', description: 'Cursor, mới nhất trước. Lọc `group` (QUOTA / WARRANTY / DEVICE), `severity`, `enterprise_id`, `device_id`, `from`/`to`, `resolved`. Mỗi `(device, type)` chỉ phát một lần cho một chu kỳ — không spam.' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: { items: [EXAMPLE_ALERT], next_cursor: null } })
  @ApiValidationError() @ApiAuthErrors()
  list(@Query() query: ListAlertsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.repo.list(query, actor.scope);
  }

  @Post('alerts/scan')
  @HttpCode(200)
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'Chạy job quét cảnh báo ngay', description: 'Chỉ admin hệ thống. Job này tự chạy mỗi 10 phút; gọi tay để test hoặc sau khi sửa dữ liệu. Idempotent — chạy lại không phát trùng. Khai TRƯỚC `alerts/{alert_id}`.' })
  @ApiEnvelopeResponse({ description: 'Kết quả quét.', example: { warranties_expired: 1, warranty_alerts: 3, quota_alerts_checked: 42, packages_locked: 0, offline_alerts: 2, online_resolved: 1, duration_ms: 180 } })
  @ApiAuthErrors()
  scan(@CurrentUser() actor: AuthenticatedUser) {
    assertSystemAdmin(actor, 'chạy được job quét');
    return this.scanner.scan();
  }

  @Get('alerts/:alert_id')
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'Chi tiết cảnh báo', description: '`payload` mang số liệu lúc phát (còn bao nhiêu, hết hạn ngày nào).' })
  @ApiParam({ name: 'alert_id', format: 'uuid', example: EXAMPLE_ALERT.alert_id })
  @ApiEnvelopeResponse({ description: 'Cảnh báo.', example: EXAMPLE_ALERT })
  @ApiAuthErrors() @ApiNotFoundError('cảnh báo')
  async get(@Param('alert_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    const alert = await this.repo.findById(id);
    if (!alert || !inScope(alert.enterprise_id, actor.scope)) throw AppException.notFound('cảnh báo', id);
    return alert;
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Thông báo của người đang đăng nhập', description: 'Cursor, mới nhất trước. `?unread=true` chỉ chưa đọc. Mỗi cảnh báo sinh một thông báo cho từng người nhận (người dùng DN + DN cha + admin hệ thống).' })
  @ApiEnvelopeResponse({ description: 'Một trang.', example: { items: [EXAMPLE_NOTIFICATION], next_cursor: null } })
  @ApiValidationError() @ApiAuthErrors()
  notifications(@Query() query: ListNotificationsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.repo.listNotifications(actor.user_id, query);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Đếm thông báo chưa đọc', description: 'Cho chuông thông báo. Web poll mỗi 30–60 giây, không nhanh hơn.' })
  @ApiEnvelopeResponse({ description: 'Số chưa đọc.', example: { count: 3 } })
  @ApiAuthErrors()
  async unreadCount(@CurrentUser() actor: AuthenticatedUser) {
    return { count: await this.repo.unreadCount(actor.user_id) };
  }

  @Put('notifications/read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả đã đọc', description: 'Khai TRƯỚC `notifications/{id}/read` kẻo `read-all` bị hiểu là id.' })
  @ApiEnvelopeResponse({ description: 'Số thông báo vừa đánh dấu.', example: { updated: 12 } })
  @ApiAuthErrors()
  async readAll(@CurrentUser() actor: AuthenticatedUser) {
    return { updated: await this.repo.markAllRead(actor.user_id) };
  }

  @Put('notifications/:notification_id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Đánh dấu một thông báo đã đọc', description: 'Của người khác → 404. Đã đọc rồi vẫn 204 (idempotent).' })
  @ApiParam({ name: 'notification_id', format: 'uuid', example: EXAMPLE_NOTIFICATION.notification_id })
  @ApiNoContentResponse('Đã đánh dấu.')
  @ApiAuthErrors() @ApiNotFoundError('thông báo')
  async read(@Param('notification_id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    if (!(await this.repo.markRead(actor.user_id, id))) throw AppException.notFound('thông báo', id);
  }
}
