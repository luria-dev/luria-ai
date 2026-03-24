import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../../core/persistence/persistence.module';
import { CachePolicyService } from './cache-policy.service';
import { DataCacheService } from './data-cache.service';
import { SearchCacheService } from './search-cache.service';

@Module({
  imports: [PersistenceModule],
  providers: [CachePolicyService, DataCacheService, SearchCacheService],
  exports: [DataCacheService, SearchCacheService],
})
export class CacheModule {}
