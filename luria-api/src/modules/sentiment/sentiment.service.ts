import { Injectable } from '@nestjs/common';

@Injectable()
export class SentimentService {
  readonly moduleName = 'sentiment';

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }
}
