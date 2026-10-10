import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DeployConfigsService } from './deploy-configs.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule, WorkspacesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, DeployConfigsService],
  exports: [ProjectsService, DeployConfigsService],
})
export class ProjectsModule {}
