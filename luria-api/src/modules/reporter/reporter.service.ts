import { Injectable } from '@nestjs/common';

@Injectable()
export class ReporterService {
  readonly moduleName = 'reporter';

  getStatus() {
    return { module: this.moduleName, state: 'skeleton_ready' as const };
  }
}
