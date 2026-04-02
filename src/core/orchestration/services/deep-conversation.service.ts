import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export type DeepConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  requestId: string;
  createdAt: string;
};

export type DeepConversationState = {
  threadId: string;
  mode: 'deep';
  turns: DeepConversationTurn[];
  updatedAt: string;
};

@Injectable()
export class DeepConversationService implements OnModuleDestroy {
  private readonly conversations = new Map<string, DeepConversationState>();
  private readonly redisPersistenceEnabled =
    (process.env.DEEP_CONVERSATION_REDIS_ENABLED ?? 'true').toLowerCase() !==
    'false';
  private readonly redisKeyPrefix =
    process.env.DEEP_CONVERSATION_KEY_PREFIX ?? 'luria:deep-conversation:';
  private readonly redisTtlSeconds = Number(
    process.env.DEEP_CONVERSATION_TTL_SECONDS ?? 7 * 24 * 60 * 60,
  );
  private readonly maxTurns = Number(
    process.env.DEEP_CONVERSATION_MAX_TURNS ?? 24,
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
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async get(threadId: string): Promise<DeepConversationState | null> {
    const key = this.toKey(threadId);
    if (!key) {
      return null;
    }

    const cached = this.conversations.get(key);
    if (cached) {
      return cached;
    }

    const persisted = await this.readFromRedis(key);
    if (persisted) {
      this.conversations.set(key, persisted);
      return persisted;
    }

    return null;
  }

  async appendTurn(input: {
    threadId: string;
    requestId: string;
    role: 'user' | 'assistant';
    content: string;
  }): Promise<DeepConversationState> {
    const key = this.toKey(input.threadId);
    if (!key) {
      throw new Error('THREAD_ID_REQUIRED');
    }

    const now = new Date().toISOString();
    const existing = (await this.get(input.threadId)) ?? {
      threadId: input.threadId.trim(),
      mode: 'deep' as const,
      turns: [],
      updatedAt: now,
    };
    const content = input.content.trim();
    if (!content) {
      return existing;
    }

    const lastTurn = existing.turns[existing.turns.length - 1];
    const nextTurns =
      lastTurn &&
      lastTurn.role === input.role &&
      lastTurn.requestId === input.requestId &&
      lastTurn.content === content
        ? existing.turns
        : [
            ...existing.turns,
            {
              role: input.role,
              content,
              requestId: input.requestId,
              createdAt: now,
            },
          ].slice(-this.maxTurns);

    const state: DeepConversationState = {
      threadId: input.threadId.trim(),
      mode: 'deep',
      turns: nextTurns,
      updatedAt: now,
    };
    this.conversations.set(key, state);
    await this.writeToRedis(key, state);
    return state;
  }

  async buildRawTranscript(threadId: string): Promise<string> {
    const state = await this.get(threadId);
    if (!state || state.turns.length === 0) {
      return '';
    }

    return state.turns
      .map((turn) =>
        turn.role === 'user'
          ? `User: ${turn.content}`
          : `Assistant: ${turn.content}`,
      )
      .join('\n\n');
  }

  private toKey(threadId: string): string {
    const normalized = threadId.trim();
    return normalized ? `deep:${normalized}` : '';
  }

  private async readFromRedis(
    key: string,
  ): Promise<DeepConversationState | null> {
    if (!this.redisPersistenceEnabled || !this.redis || !this.redisAvailable) {
      return null;
    }

    try {
      const raw = await this.redis.get(this.redisKeyPrefix + key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as DeepConversationState;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      this.redisAvailable = false;
      return null;
    }
  }

  private async writeToRedis(
    key: string,
    state: DeepConversationState,
  ): Promise<void> {
    if (!this.redisPersistenceEnabled || !this.redis || !this.redisAvailable) {
      return;
    }

    try {
      await this.redis.set(
        this.redisKeyPrefix + key,
        JSON.stringify(state),
        'EX',
        this.redisTtlSeconds,
      );
    } catch {
      this.redisAvailable = false;
    }
  }
}
