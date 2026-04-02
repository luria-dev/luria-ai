import { Injectable, Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { AnalyzeJobData, QueueMode } from '../orchestration.types';

@Injectable()
export class AnalyzeQueueService {
  private readonly logger = new Logger(AnalyzeQueueService.name);
  private readonly redisEnabled =
    (process.env.REDIS_ENABLED ?? 'true').toLowerCase() !== 'false';
  private readonly queueAllowed =
    this.redisEnabled &&
    (process.env.ANALYZE_QUEUE_ENABLED ?? 'true').toLowerCase() !== 'false';
  private queue?: Queue<AnalyzeJobData>;
  private worker?: Worker<AnalyzeJobData>;
  private queueInitPromise?: Promise<boolean>;
  private queueEnabled = false;
  private processor?: (data: AnalyzeJobData) => Promise<void>;

  async enqueue(
    data: AnalyzeJobData,
    processor: (data: AnalyzeJobData) => Promise<void>,
  ): Promise<QueueMode> {
    this.processor = processor;
    if (!this.queueAllowed) {
      setImmediate(() => {
        void processor(data);
      });
      return 'inline_fallback';
    }
    const ready = await this.ensureQueue();
    if (!ready || !this.queue) {
      setImmediate(() => {
        void processor(data);
      });
      return 'inline_fallback';
    }

    await this.queue.add('analyze', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
    return 'bullmq';
  }

  isQueueEnabled(): boolean {
    return this.queueEnabled;
  }

  async shutdown(): Promise<void> {
    await this.safeCloseQueueResources();
  }

  private async ensureQueue(): Promise<boolean> {
    if (this.queueEnabled) {
      return true;
    }
    if (this.queueInitPromise) {
      return this.queueInitPromise;
    }

    this.queueInitPromise = this.initQueue();
    const ok = await this.queueInitPromise;
    if (!ok) {
      this.queueInitPromise = undefined;
    }
    return ok;
  }

  private async initQueue(): Promise<boolean> {
    if (!this.processor) {
      return false;
    }

    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    const password = process.env.REDIS_PASSWORD || undefined;
    const concurrency = Number(process.env.ANALYZE_QUEUE_CONCURRENCY ?? 4);
    const readyTimeoutMs = Number(
      process.env.ANALYZE_QUEUE_READY_TIMEOUT_MS ?? 1500,
    );
    const queueName = this.resolveQueueName();
    const connection = {
      host,
      port,
      password,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
      connectTimeout: readyTimeoutMs,
      commandTimeout: readyTimeoutMs,
    };

    try {
      this.queue = new Queue<AnalyzeJobData>(queueName, { connection });
      this.worker = new Worker<AnalyzeJobData>(
        queueName,
        async (job) => {
          const requestId = job.data?.requestId ?? 'unknown';
          if (!this.processor) {
            this.logger.warn(
              `Worker received job ${requestId} (${job.id ?? 'unknown'}) but no processor is registered.`,
            );
            return;
          }

          this.logger.debug(
            `Worker started job ${requestId} (${job.id ?? 'unknown'}).`,
          );
          await this.processor(job.data);
          this.logger.debug(
            `Worker completed job ${requestId} (${job.id ?? 'unknown'}).`,
          );
        },
        {
          connection,
          concurrency,
        },
      );

      this.worker.on('failed', (job, error) => {
        const requestId = job?.data?.requestId;
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Worker failed job ${requestId ?? 'unknown'}.`,
          normalizedError,
        );
      });

      this.worker.on('completed', (job) => {
        const requestId = job?.data?.requestId;
        this.logger.debug(
          `Worker marked job ${requestId ?? 'unknown'} completed.`,
        );
      });

      await this.waitUntilReadyWithTimeout(
        this.queue.waitUntilReady(),
        readyTimeoutMs,
        'queue',
      );
      await this.waitUntilReadyWithTimeout(
        this.worker.waitUntilReady(),
        readyTimeoutMs,
        'worker',
      );
      this.queueEnabled = true;
      this.logger.log(
        `Analyze queue enabled on ${host}:${port} (${queueName}).`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Queue unavailable, fallback to inline execution: ${message}`,
      );
      await this.safeCloseQueueResources();
      this.queueEnabled = false;
      return false;
    }
  }

  private async safeCloseQueueResources(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch {
        // ignore shutdown error
      }
      this.worker = undefined;
    }

    if (this.queue) {
      try {
        await this.queue.close();
      } catch {
        // ignore shutdown error
      }
      this.queue = undefined;
    }

    this.queueEnabled = false;
      this.queueInitPromise = undefined;
  }

  private async waitUntilReadyWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: 'queue' | 'worker',
  ): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `BullMQ ${label} waitUntilReady timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  private resolveQueueName(): string {
    const explicitName = process.env.ANALYZE_QUEUE_NAME?.trim();
    if (explicitName) {
      return explicitName;
    }

    const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
    const isProduction = nodeEnv === 'production' || nodeEnv === 'prod';
    if (isProduction) {
      return 'analyze-jobs';
    }

    const port = process.env.PORT?.trim() || '3000';
    return `analyze-jobs-local-${port}`;
  }
}
