import { Injectable } from '@nestjs/common';
import type { AnalyzeIdentity } from '../../../data/contracts/analyze-contracts';
import type { RequestMode } from '../orchestration.types';

export type InstantTurnContext = {
  assetMention: string | null;
  timeWindow: '24h' | '7d' | '30d' | '60d' | null;
  goal: string | null;
  scope: 'single_asset' | 'comparison' | 'multi_asset' | 'general' | null;
};

type InstantConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  requestId: string;
  createdAt: string;
  context?: InstantTurnContext;
};

export type InstantConversationState = {
  threadId: string;
  mode: Extract<RequestMode, 'instant'>;
  lastResponseId: string | null;
  lastResolvedIdentity: AnalyzeIdentity | null;
  lastTimeWindow: '24h' | '7d' | '30d' | '60d' | null;
  lastGoal: string | null;
  lastScope: InstantTurnContext['scope'];
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
    resolvedIdentity?: AnalyzeIdentity | null;
    timeWindow?: '24h' | '7d' | '30d' | '60d' | null;
    goal?: string | null;
    scope?: InstantTurnContext['scope'];
    turnContext?: Partial<InstantTurnContext>;
  }): InstantConversationState {
    const key = this.toKey(input.threadId);
    const now = new Date().toISOString();
    const existing = this.conversations.get(key);
    const turnContext: InstantTurnContext = {
      assetMention: input.turnContext?.assetMention ?? null,
      timeWindow: input.turnContext?.timeWindow ?? null,
      goal: input.turnContext?.goal ?? null,
      scope: input.turnContext?.scope ?? null,
    };
    const turns = [
      ...(existing?.turns ?? []),
      {
        role: 'user' as const,
        content: input.userMessage,
        requestId: input.requestId,
        createdAt: now,
        context: turnContext,
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
      lastResolvedIdentity: input.resolvedIdentity ?? existing?.lastResolvedIdentity ?? null,
      lastTimeWindow: input.timeWindow ?? existing?.lastTimeWindow ?? null,
      lastGoal: input.goal ?? existing?.lastGoal ?? null,
      lastScope: input.scope ?? existing?.lastScope ?? null,
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
