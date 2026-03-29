import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const isEnabled = process.env.DATABASE_ENABLED === 'true';

    if (!isEnabled) {
      const dummyPool = new Pool({
        connectionString: 'postgresql://dummy:dummy@localhost:5432/dummy',
        max: 1,
      });
      super({
        adapter: new PrismaPg(dummyPool, { schema: 'public' }),
      });
      this.pool = dummyPool;
      return;
    }

    const { connectionString, schema } = buildPgConfig(
      process.env.DATABASE_URL,
    );
    const pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 10),
    });

    super({
      adapter: new PrismaPg(pool, { schema }),
    });

    this.pool = pool;
  }

  isConfigured(): boolean {
    return process.env.DATABASE_ENABLED === 'true' && Boolean(process.env.DATABASE_URL?.trim());
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
      await this.pool.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Prisma disconnect failed: ${message}`);
    }
  }
}

function buildPgConfig(rawUrl: string | undefined): {
  connectionString: string;
  schema: string;
} {
  const fallback = {
    connectionString: 'postgresql://invalid:invalid@127.0.0.1:5432/invalid',
    schema: 'public',
  };

  if (!rawUrl?.trim()) {
    return fallback;
  }

  try {
    const url = new URL(rawUrl);
    const schema = url.searchParams.get('schema')?.trim() || 'public';
    url.search = '';

    return {
      connectionString: url.toString(),
      schema,
    };
  } catch {
    return fallback;
  }
}
