import {
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Observable, Subject, Subscription } from 'rxjs';
import type {
  AnalyzeStreamEvent,
  AnalyzeStreamEventName,
  RequestState,
  RequestStatus,
} from '../orchestration.types';

@Injectable()
export class RequestStateService implements OnModuleDestroy {
  private readonly logger = new Logger(RequestStateService.name);
  private readonly redisPersistenceEnabled =
    (process.env.REQUEST_STATE_REDIS_ENABLED ?? 'true').toLowerCase() !==
    'false';
  private readonly requests = new Map<string, RequestState>();
  private readonly requestEventStreams = new Map<
    string,
    Subject<AnalyzeStreamEvent>
  >();
  private readonly redisKeyPrefix =
    process.env.REQUEST_STATE_KEY_PREFIX ?? 'luria:request-state:';
  private readonly redisTtlSeconds = Number(
    process.env.REQUEST_STATE_TTL_SECONDS ?? 24 * 60 * 60,
  );
  private readonly redis?: Redis;
  private redisAvailable = true;

  constructor() {
    if (!this.redisPersistenceEnabled) {
      this.redisAvailable = false;
      return;
    }

    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    const password = process.env.REDIS_PASSWORD || undefined;

    this.redis = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 1500,
      commandTimeout: 1500,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.completeAllEventStreams();
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async get(requestId: string): Promise<RequestState | undefined> {
    const cached = this.requests.get(requestId);

    const persisted = await this.readFromRedis(requestId);
    if (persisted) {
      this.requests.set(requestId, persisted);
      return persisted;
    }

    return cached;
  }

  async set(request: RequestState): Promise<void> {
    this.requests.set(request.requestId, request);
    await this.writeToRedis(request);
  }

  emitEvent(
    requestId: string,
    event: AnalyzeStreamEventName,
    status: RequestStatus,
    data?: Record<string, unknown>,
  ): void {
    const stream = this.getOrCreateEventStream(requestId);
    stream.next({
      requestId,
      event,
      status,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  completeEventStream(requestId: string): void {
    const stream = this.requestEventStreams.get(requestId);
    if (!stream) {
      return;
    }
    stream.complete();
    this.requestEventStreams.delete(requestId);
  }

  completeAllEventStreams(): void {
    for (const stream of this.requestEventStreams.values()) {
      stream.complete();
    }
    this.requestEventStreams.clear();
  }

  stream(requestId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let subscription: Subscription | undefined;
      let cancelled = false;

      void this.startStream(requestId, subscriber)
        .then((streamSubscription) => {
          if (cancelled) {
            streamSubscription?.unsubscribe();
            return;
          }
          subscription = streamSubscription;
        })
        .catch((error) => {
          if (subscriber.closed || cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          subscriber.next(
            this.toMessageEvent({
              requestId,
              event: 'failed',
              status: 'failed',
              timestamp: new Date().toISOString(),
              data: {
                errorCode: 'REQUEST_STATE_UNAVAILABLE',
                errorMessage: message,
              },
            }),
          );
          subscriber.complete();
        });

      return () => {
        cancelled = true;
        subscription?.unsubscribe();
      };
    });
  }

  private toSnapshotEvent(request: RequestState): AnalyzeStreamEvent {
    return {
      requestId: request.requestId,
      event: 'snapshot',
      status: request.status,
      timestamp: new Date().toISOString(),
      data: {
        threadId: request.threadId,
        mode: request.mode,
        lang: request.lang,
        query: request.query,
        timeWindow: request.timeWindow,
        preferredChain: request.preferredChain,
        targets: request.targets,
        candidates: request.candidates,
        pendingTargets: request.targets
          .filter((target) => target.status === 'waiting_selection')
          .map((target) => target.targetKey),
        selectedCandidateId: request.selectedCandidateId,
        identity: request.identity,
        errorCode: request.errorCode,
        phase:
          typeof request.payload.phase === 'string' ? request.payload.phase : null,
        label:
          typeof request.payload.label === 'string' ? request.payload.label : null,
        progressPct:
          typeof request.payload.progressPct === 'number'
            ? request.payload.progressPct
            : null,
        note:
          typeof request.payload.note === 'string' ? request.payload.note : null,
      },
    };
  }

  private toMessageEvent(event: AnalyzeStreamEvent): MessageEvent {
    return {
      type: event.event,
      data: event,
      id: `${event.requestId}:${event.timestamp}`,
    };
  }

  private getOrCreateEventStream(
    requestId: string,
  ): Subject<AnalyzeStreamEvent> {
    const existing = this.requestEventStreams.get(requestId);
    if (existing) {
      return existing;
    }

    const stream = new Subject<AnalyzeStreamEvent>();
    this.requestEventStreams.set(requestId, stream);
    return stream;
  }

  private async startStream(
    requestId: string,
    subscriber: {
      closed: boolean;
      next: (value: MessageEvent) => void;
      complete: () => void;
    },
  ): Promise<Subscription | undefined> {
    const request = await this.get(requestId);
    if (subscriber.closed) {
      return undefined;
    }

    if (!request) {
      subscriber.next(
        this.toMessageEvent({
          requestId,
          event: 'failed',
          status: 'failed',
          timestamp: new Date().toISOString(),
          data: {
            errorCode: 'REQUEST_NOT_FOUND',
          },
        }),
      );
      subscriber.complete();
      return undefined;
    }

    subscriber.next(this.toMessageEvent(this.toSnapshotEvent(request)));

    if (request.status === 'ready' || request.status === 'failed') {
      subscriber.complete();
      return undefined;
    }

    const stream = this.getOrCreateEventStream(requestId);
    return stream.subscribe({
      next: (event) => subscriber.next(this.toMessageEvent(event)),
      complete: () => subscriber.complete(),
    });
  }

  private async readFromRedis(
    requestId: string,
  ): Promise<RequestState | undefined> {
    if (!this.redisPersistenceEnabled || !this.redis) {
      return undefined;
    }
    try {
      const raw = await this.redis.get(this.requestKey(requestId));
      this.markRedisRecovery();
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as RequestState;
      return parsed;
    } catch (error) {
      this.markRedisFailure(error, 'read');
      return undefined;
    }
  }

  private async writeToRedis(request: RequestState): Promise<void> {
    if (!this.redisPersistenceEnabled || !this.redis) {
      return;
    }
    try {
      const key = this.requestKey(request.requestId);
      const payload = JSON.stringify(request);
      if (this.redisTtlSeconds > 0) {
        await this.redis.set(key, payload, 'EX', this.redisTtlSeconds);
      } else {
        await this.redis.set(key, payload);
      }
      this.markRedisRecovery();
    } catch (error) {
      this.markRedisFailure(error, 'write');
    }
  }

  private requestKey(requestId: string): string {
    return `${this.redisKeyPrefix}${requestId}`;
  }

  private markRedisFailure(error: unknown, operation: 'read' | 'write'): void {
    if (!this.redisAvailable) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Redis request state ${operation} failed. Falling back to in-memory cache: ${message}`,
    );
    this.redisAvailable = false;
  }

  private markRedisRecovery(): void {
    if (this.redisAvailable) {
      return;
    }
    this.logger.log('Redis request state persistence recovered.');
    this.redisAvailable = true;
  }
}
