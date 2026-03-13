import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('healthz')
  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readyz')
  async getReadiness() {
    const snapshot = await this.appService.getHealth();
    if (snapshot.status !== 'up') {
      throw new ServiceUnavailableException(snapshot);
    }
    return snapshot;
  }

  @Get('health')
  async getHealth() {
    return this.appService.getHealth();
  }
}
