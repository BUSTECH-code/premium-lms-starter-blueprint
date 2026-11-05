import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Structured logger with mandatory redaction of secrets and credentials.
 * Security-sensitive events are logged at the call sites with `logger.info`
 * / `logger.warn` and never include passwords, tokens or cookies.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'premium-lms-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        '*.password',
        'passwordHash',
        '*.passwordHash',
        'password_hash',
        '*.password_hash',
        'jwtSecret',
        '*.jwtSecret',
        'req.headers.cookie',
        'req.headers.authorization',
        'headers.cookie',
        'headers.authorization',
        'refreshToken',
        '*.refreshToken',
        'accessToken',
        '*.accessToken',
        'token',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
  });
}
