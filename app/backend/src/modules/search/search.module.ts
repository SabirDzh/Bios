import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { MeiliService } from './meili.service';
import { SERVER_SEARCH, ServerSearchService } from './server-search.service';

/**
 * Поиск (Meilisearch) как отдельный домен: транспорт (MeiliService) и
 * индексация серверов. Потребители внедряют порт SERVER_SEARCH, а не класс, —
 * тесты подменяют его двойником, как SSH_RUNNER.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    MeiliService,
    ServerSearchService,
    { provide: SERVER_SEARCH, useExisting: ServerSearchService },
  ],
  exports: [SERVER_SEARCH],
})
export class SearchModule {}
