import { Module } from '@nestjs/common';
import { OpenResearchService } from './open-research.service';

@Module({
  providers: [OpenResearchService],
  exports: [OpenResearchService],
})
export class OpenResearchModule {}
