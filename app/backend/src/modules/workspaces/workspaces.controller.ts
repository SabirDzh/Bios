import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceIdDto } from './dto/workspace-id.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@User() user: JwtUserPayload, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(user.userId, dto);
  }

  @Get()
  findAll(@User() user: JwtUserPayload) {
    return this.workspacesService.findAllForUser(user.userId);
  }

  @Get(':workspaceId')
  findOne(@User() user: JwtUserPayload, @Param() params: WorkspaceIdDto) {
    return this.workspacesService.findOneForUser(
      user.userId,
      params.workspaceId,
    );
  }

  @Post(':workspaceId/invitations')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  invite(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspacesService.invite(
      user.userId,
      params.workspaceId,
      dto.email,
    );
  }

  @Post(':workspaceId/accept')
  @HttpCode(201)
  accept(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.workspacesService.accept(
      user.userId,
      params.workspaceId,
      dto.token,
    );
  }
}
