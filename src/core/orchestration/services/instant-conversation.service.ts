import { Injectable } from '@nestjs/common';
import type { RequestMode } from '../orchestration.types';

type InstantConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  requestId: string;
  createdAt: string;
};

export type InstantConversationState = {
  threadId: string;
  mode: Extract<RequestMode, 'instant'>;
  lastResponseId: string | null;
  turns: InstantConversationTurn[];
  updatedAt: string;
};

@Injectable()
export class InstantConversationService {
  private readonly conversations = new Map<string, InstantConversationState>();
  private readonly maxTurns = 12;

  get(threadId: string): InstantConversationState | null {
    const key = this.toKey(threadId);
    if (!key) {
      return null;
    }
    return this.conversations.get(key) ?? null;
  }

  saveTurn(input: {
    threadId: string;
    requestId: string;
    userMessage: string;
    assistantMessage: string;
    responseId: string | null;
  }): InstantConversationState {
    const key = this.toKey(input.threadId);
    const now = new Date().toISOString();
    const existing = this.conversations.get(key);
    const turns = [
      ...(existing?.turns ?? []),
      {
        role: 'user' as const,
        content: input.userMessage,
        requestId: input.requestId,
        createdAt: now,
      },
      {
        role: 'assistant' as const,
        content: input.assistantMessage,
        requestId: input.requestId,
        createdAt: now,
      },
    ].slice(-this.maxTurns);

    const state: InstantConversationState = {
      threadId: input.threadId.trim(),
      mode: 'instant',
      lastResponseId: input.responseId,
      turns,
      updatedAt: now,
    };
    this.conversations.set(key, state);
    return state;
  }

  buildFallbackTranscript(threadId: string): string {
    const state = this.get(threadId);
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
    return `instant:${threadId.trim()}`;
  }
}
