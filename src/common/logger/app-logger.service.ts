import { Injectable } from '@nestjs/common';

/**
 * Log structured JSON, một dòng một sự kiện.
 *
 * Bắt buộc theo docs/rules/backend-structure.md:
 *   - mọi log có `request_id`
 *   - log liên quan thiết bị phải có `device_id`
 *   - KHÔNG log: mật khẩu, token, secret
 *
 * `redact()` bên dưới là lưới an toàn cuối, không phải giấy phép để cứ ném cả
 * object vào log.
 */
const SENSITIVE_KEYS = [
  'password',
  'new_password',
  'current_password',
  'password_hash',
  'refresh_token',
  'access_token',
  'token',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

export interface LogFields {
  request_id?: string;
  user_id?: string;
  device_id?: string;
  [key: string]: unknown;
}

type Level = 'info' | 'warn' | 'error';

@Injectable()
export class AppLogger {
  private emit(level: Level, message: string, fields: LogFields) {
    const line = {
      ts: new Date().toISOString(),
      level,
      service: 'qltb-service',
      message,
      ...(redact(fields) as LogFields),
    };
    const sink = level === 'error' ? process.stderr : process.stdout;
    sink.write(`${JSON.stringify(line)}\n`);
  }

  info(message: string, fields: LogFields = {}) {
    this.emit('info', message, fields);
  }

  warn(message: string, fields: LogFields = {}) {
    this.emit('warn', message, fields);
  }

  error(message: string, fields: LogFields = {}) {
    this.emit('error', message, fields);
  }
}
