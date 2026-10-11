import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { WorkspaceRoleGuard } from '../../common/guards/workspace-role.guard';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceRoleGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
