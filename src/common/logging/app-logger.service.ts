import { Injectable, LoggerService } from '@nestjs/common';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { requestLogContext } from './request-context';

type LogArgs = {
  msg: string;
  context?: string;
  err?: Error;
  meta?: Record<string, unknown>;
};

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    const prettyEnabled =
      !isProd && (process.env.LOG_PRETTY ?? 'true').toLowerCase() !== 'false';
    const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

    const options: LoggerOptions = {
      level,
      base: {
        service: 'luria-ai',
        env: process.env.NODE_ENV ?? 'development',
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
    };

    if (prettyEnabled) {
      options.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
    }

    this.logger = pino(options);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const payload = this.buildPayload(message, optionalParams);
    this.logger.info(payload.fields, payload.msg);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const payload = this.buildPayload(message, optionalParams);
    this.logger.error(payload.fields, payload.msg);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const payload = this.buildPayload(message, optionalParams);
    this.logger.warn(payload.fields, payload.msg);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const payload = this.buildPayload(message, optionalParams);
    this.logger.debug(payload.fields, payload.msg);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const payload = this.buildPayload(message, optionalParams);
    this.logger.trace(payload.fields, payload.msg);
  }

  private buildPayload(message: unknown, optionalParams: unknown[]): {
    msg: string;
    fields: Record<string, unknown>;
  } {
    const parsed = this.parseArgs(message, optionalParams);
    const req = requestLogContext.get();

    const fields: Record<string, unknown> = {};
    if (parsed.context) {
      fields.context = parsed.context;
    }
    if (req?.requestId) {
      fields.requestId = req.requestId;
    }
    if (req?.traceId) {
      fields.traceId = req.traceId;
    }
    if (req?.userId) {
      fields.userId = req.userId;
    }
    if (req?.method) {
      fields.method = req.method;
    }
    if (req?.path) {
      fields.path = req.path;
    }
    if (parsed.meta) {
      Object.assign(fields, parsed.meta);
    }
    if (parsed.err) {
      fields.err = parsed.err;
    }

    return { msg: parsed.msg, fields };
  }

  private parseArgs(message: unknown, optionalParams: unknown[]): LogArgs {
    let context: string | undefined;
    let err: Error | undefined;
    const meta: Record<string, unknown> = {};

    if (message instanceof Error) {
      err = message;
      message = message.message;
    } else if (typeof message === 'object' && message !== null) {
      Object.assign(meta, message as Record<string, unknown>);
      message = 'Log event';
    }

    optionalParams.forEach((param, index) => {
      if (param instanceof Error) {
        err = param;
        return;
      }

      if (
        typeof param === 'string' &&
        index === optionalParams.length - 1 &&
        optionalParams.length > 0
      ) {
        context = param;
        return;
      }

      if (typeof param === 'object' && param !== null) {
        Object.assign(meta, param as Record<string, unknown>);
        return;
      }

      meta[`arg${index}`] = param;
    });

    return {
      msg: typeof message === 'string' ? message : String(message),
      context,
      err,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    };
  }
}
