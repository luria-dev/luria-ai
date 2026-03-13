import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestLogContext = {
  requestId: string;
  traceId: string;
  userId?: string;
  method?: string;
  path?: string;
};

const storage = new AsyncLocalStorage<RequestLogContext>();

export const requestLogContext = {
  run<T>(context: RequestLogContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestLogContext | undefined {
    return storage.getStore();
  },
};
