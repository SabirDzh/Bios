import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { ServersModule } from '../servers/servers.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import {
  DeploymentsController,
  DeploymentController,
} from './deployments.controller';
import { DeployRunnerService } from './deploy-runner.service';
import { DeploymentsService } from './deployments.service';

@Module({
  imports: [
    PrismaModule,
    WorkspacesModule,
    // SSH_RUNNER и ServersService — от них зависят loadForSsh и exec исполнителя
    ServersModule,
    // ProjectsService/DeployConfigsService: requireRow для области видимости
    ProjectsModule,
  ],
  controllers: [DeploymentsController, DeploymentController],
  providers: [DeploymentsService, DeployRunnerService],
})
export class DeploymentsModule {}
