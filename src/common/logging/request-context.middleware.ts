import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { requestLogContext } from './request-context';

type HeaderValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  user?: {
    id?: string | number;
  };
};

type ResponseLike = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  raw?: {
    setHeader?: (name: string, value: string) => unknown;
  };
};

function normalizeHeader(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    return first?.trim() ? first.trim() : undefined;
  }
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestLike, res: ResponseLike, next: () => void): void {
    const requestId = normalizeHeader(req.headers['x-request-id']) ?? randomUUID();
    const traceId = normalizeHeader(req.headers['x-trace-id']) ?? requestId;
    const userIdHeader = normalizeHeader(req.headers['x-user-id']);
    const userIdValue = userIdHeader ?? req.user?.id;
    const userId =
      typeof userIdValue === 'string'
        ? userIdValue
        : typeof userIdValue === 'number'
          ? String(userIdValue)
          : undefined;

    this.setResponseHeader(res, 'x-request-id', requestId);
    this.setResponseHeader(res, 'x-trace-id', traceId);

    requestLogContext.run(
      {
        requestId,
        traceId,
        userId,
        method: req.method,
        path: req.url,
      },
      next,
    );
  }

  private setResponseHeader(
    res: ResponseLike,
    name: string,
    value: string,
  ): void {
    if (typeof res.header === 'function') {
      res.header(name, value);
      return;
    }
    if (typeof res.setHeader === 'function') {
      res.setHeader(name, value);
      return;
    }
    if (typeof res.raw?.setHeader === 'function') {
      res.raw.setHeader(name, value);
    }
  }
}
