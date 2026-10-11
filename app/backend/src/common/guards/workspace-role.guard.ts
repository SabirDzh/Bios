import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { JwtUserPayload } from '../types/user-payload.type';

export const MIN_WORKSPACE_ROLE_KEY = 'minWorkspaceRole';

/**
 * Минимальная роль роута: MEMBER пускает всех участников, OWNER —
 * только владельца. Ранг линейный — будущие роли встанут между/выше.
 */
export const MinRole = (role: WorkspaceRole) =>
  SetMetadata(MIN_WORKSPACE_ROLE_KEY, role);

const ROLE_RANK: Record<WorkspaceRole, number> = {
  [WorkspaceRole.MEMBER]: 1,
  [WorkspaceRole.OWNER]: 2,
};

export type WorkspaceRequest = Request & {
  user: JwtUserPayload;
  workspaceRole?: WorkspaceRole;
};

/**
 * DI-guard ролей воркспейса. Ставится рядом с JwtAuthGuard и СТРОГО
 * после него (нужен req.user): читает :workspaceId из пути, резолвит
 * роль одним findUnique и сравнивает с минимумом из @MinRole.
 * Ответ (404 без membership / 403 при слабой роли) — до хендлера.
 *
 * Без @MinRole пропускает: auth-only роуты (create/list/accept инвайта,
 * login) — там своя логика. Нет workspaceId в пути при выставленном
 * @MinRole — 404 (fail-closed, без oracle).
 *
 * Сервисные requireMembership остаются второй линией: прямые вызовы
 * сервисов и спеки идут мимо guards. Цена дублирования — один PK-lookup.
 */
@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const min = this.reflector.getAllAndOverride<WorkspaceRole | undefined>(
      MIN_WORKSPACE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!min) return true;
    const req = context.switchToHttp().getRequest<WorkspaceRequest>();
    // typeof-check: значение path-параметра теоретически может быть массивом.
    const workspaceId = req.params?.workspaceId;
    const userId = req.user?.userId;
    if (
      typeof workspaceId !== 'string' ||
      !workspaceId ||
      typeof userId !== 'string' ||
      !userId
    ) {
      throw new NotFoundException();
    }
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new NotFoundException();
    if (ROLE_RANK[membership.role] < ROLE_RANK[min]) {
      throw new ForbiddenException();
    }
    req.workspaceRole = membership.role;
    return true;
  }
}
