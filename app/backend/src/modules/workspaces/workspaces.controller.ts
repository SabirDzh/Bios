import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create() {
    return this.workspacesService.create();
  }

  @Get()
  findAll() {
    return this.workspacesService.findAll();
  }

  @Get(':workspaceId')
  findOne(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.findOne(workspaceId);
  }

  @Patch(':workspaceId')
  update(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.update(workspaceId);
  }

  @Delete(':workspaceId')
  remove(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.remove(workspaceId);
  }
}
