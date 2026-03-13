import { Injectable } from '@nestjs/common';
import type {
  IntentMemoResolvedTarget,
  IntentMemoSnapshot,
  IntentOutput,
} from '../../../data/contracts/workflow-contracts';

@Injectable()
export class IntentMemoService {
  private readonly memos = new Map<string, IntentMemoSnapshot>();

  get(threadId: string): IntentMemoSnapshot | null {
    const key = threadId.trim();
    if (!key) {
      return null;
    }
    return this.memos.get(key) ?? null;
  }

  save(input: {
    threadId: string;
    intent: IntentOutput;
    resolvedTargets: IntentMemoResolvedTarget[];
    requestId: string;
  }): IntentMemoSnapshot {
    const key = input.threadId.trim();
    const snapshot: IntentMemoSnapshot = {
      threadId: key,
      lastIntent: input.intent,
      lastResolvedTargets: input.resolvedTargets,
      lastRequestId: input.requestId,
      updatedAt: new Date().toISOString(),
    };
    this.memos.set(key, snapshot);
    return snapshot;
  }
}
