import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type {
  AnalyzeStreamEvent,
  AnalyzeStreamEventName,
  RequestState,
  RequestStatus,
} from '../orchestration.types';

@Injectable()
export class RequestStateService {
  private readonly requests = new Map<string, RequestState>();
  private readonly requestEventStreams = new Map<
    string,
    Subject<AnalyzeStreamEvent>
  >();

  get(requestId: string): RequestState | undefined {
    return this.requests.get(requestId);
  }

  set(request: RequestState): void {
    this.requests.set(request.requestId, request);
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
      const request = this.requests.get(requestId);
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
      const subscription = stream.subscribe({
        next: (event) => subscriber.next(this.toMessageEvent(event)),
        complete: () => subscriber.complete(),
      });

      return () => {
        subscription.unsubscribe();
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
        query: request.query,
        timeWindow: request.timeWindow,
        preferredChain: request.preferredChain,
        targets: request.targets,
        pendingTargets: request.targets
          .filter((target) => target.status === 'waiting_selection')
          .map((target) => target.targetKey),
        selectedCandidateId: request.selectedCandidateId,
        identity: request.identity,
        errorCode: request.errorCode,
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
}
