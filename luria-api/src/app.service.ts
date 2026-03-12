import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';
import Redis from 'ioredis';

type ServiceStatus = {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
};

@Injectable()
export class AppService {
  async getHealth() {
    const processStatus: ServiceStatus = { status: 'up' };
    const postgres = await this.checkPostgres();
    const redis = await this.checkRedis();

    const status =
      postgres.status === 'up' && redis.status === 'up' ? 'up' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      services: {
        process: processStatus,
        postgres,
        redis,
      },
    };
  }

  private async checkPostgres(): Promise<ServiceStatus> {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      return { status: 'down', error: 'DATABASE_URL is missing' };
    }

    let host = '';
    let port = 5432;

    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      port = parsed.port ? Number(parsed.port) : 5432;
    } catch {
      return { status: 'down', error: 'DATABASE_URL is invalid' };
    }

    return this.checkTcp(host, port);
  }

  private async checkRedis(): Promise<ServiceStatus> {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    const password = process.env.REDIS_PASSWORD;
    const startedAt = Date.now();

    const redis = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 1500,
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        return { status: 'down', error: 'Redis ping failed' };
      }
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Redis check failed',
      };
    } finally {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
  }

  private checkTcp(host: string, port: number): Promise<ServiceStatus> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const socket = new Socket();

      socket.setTimeout(1500);

      socket.once('connect', () => {
        socket.destroy();
        resolve({ status: 'up', latencyMs: Date.now() - startedAt });
      });

      socket.once('error', (error) => {
        socket.destroy();
        resolve({ status: 'down', error: error.message });
      });

      socket.once('timeout', () => {
        socket.destroy();
        resolve({ status: 'down', error: 'Connection timeout' });
      });

      socket.connect(port, host);
    });
  }
}
