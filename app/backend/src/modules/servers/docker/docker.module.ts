import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma/prisma.module';
import { ServersModule } from '../servers.module';
import { WorkspaceRoleGuard } from '../../../common/guards/workspace-role.guard';
import { DockerController } from './docker.controller';
import { DockerService } from './docker.service';

@Module({
  imports: [PrismaModule, ServersModule],
  controllers: [DockerController],
  providers: [DockerService, WorkspaceRoleGuard],
})
export class DockerModule {}
