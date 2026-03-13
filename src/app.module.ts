import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalyzeModule } from './modules/analyze/analyze.module';
import { RequestContextMiddleware } from './common/logging/request-context.middleware';
import { AppLogger } from './common/logging/app-logger.service';

@Module({
  imports: [AnalyzeModule],
  controllers: [AppController],
  providers: [AppService, AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
