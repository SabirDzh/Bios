import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { Prisma, WorkspaceRole, InvitationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { getAppConfig } from '../../config/app-config.module';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import {
  CursorPage,
  CursorPaginationDto,
  decodeCursorOrThrow,
  encodeCursor,
  takePage,
} from '../../common/dto/cursor-pagination.dto';

export interface WorkspaceResponse {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvitationCreateResponse {
  id: string;
  workspaceId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  /** Открытый токен — возвращается только здесь, в БД лежит лишь его SHA-256. */
  token: string;
}

export interface MembershipResponse {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function toWorkspaceResponse(
  workspace: { id: string; name: string; createdAt: Date; updatedAt: Date },
  role: WorkspaceRole,
): WorkspaceResponse {
  return {
    id: workspace.id,
    name: workspace.name,
    role,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

@Injectable()
export class WorkspacesService {
  private readonly cfg: AppConfig;

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.cfg = config ?? getAppConfig();
  }

  async create(
    userId: string,
    dto: CreateWorkspaceDto,
  ): Promise<WorkspaceResponse> {
    // Defense in depth: DTO тримится ValidationPipe, но сервис могут
    // вызвать в обход него (прецедент — UsersService.create).
    const name = dto.name.trim();
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({ data: { name } });
      await tx.workspaceMember.create({
        data: { workspaceId: created.id, userId, role: WorkspaceRole.OWNER },
      });
      return created;
    });
    return toWorkspaceResponse(workspace, WorkspaceRole.OWNER);
  }

  async findAllForUser(
    userId: string,
    q: CursorPaginationDto,
  ): Promise<CursorPage<WorkspaceResponse>> {
    // Курсорная пагинация keyset (ts, id): стабильный обход без дублей
    // при конкурентных вступлениях; id — тайбрейк неуникального joinedAt.
    const limit = q.limit ?? 20;
    const cursor = q.cursor ? decodeCursorOrThrow(q.cursor) : null;
    const cursorTs = cursor ? new Date(cursor.ts) : null;
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        userId,
        ...(cursor && cursorTs
          ? {
              OR: [
                { joinedAt: { gt: cursorTs } },
                { joinedAt: cursorTs, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { workspace: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = takePage(memberships, limit, (m) =>
      encodeCursor(m.joinedAt, m.id),
    );
    return {
      items: page.items.map((m) => toWorkspaceResponse(m.workspace, m.role)),
      nextCursor: page.nextCursor,
    };
  }

  /** Нет membership — 404 без различия «нет доступа / нет объекта» (без oracle). */
  async findOneForUser(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceResponse> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (!membership) throw new NotFoundException();
    return toWorkspaceResponse(membership.workspace, membership.role);
  }

  /** Нет membership → 404 (неотличимо). Роль вне списка → 403. */
  async requireMembership(
    userId: string,
    workspaceId: string,
    roles?: WorkspaceRole[],
  ): Promise<WorkspaceRole> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new NotFoundException();
    if (roles && !roles.includes(membership.role))
      throw new ForbiddenException();
    return membership.role;
  }

  async invite(
    inviterId: string,
    workspaceId: string,
    email: string,
  ): Promise<InvitationCreateResponse> {
    await this.requireMembership(inviterId, workspaceId, [WorkspaceRole.OWNER]);
    const normalizedEmail = email.trim().toLowerCase();

    const existingMember = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email: normalizedEmail } },
    });
    if (existingMember) throw new ConflictException('already a member');

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    try {
      const invitation = await this.prisma.$transaction(async (tx) => {
        // Supersede: истёкшие PENDING -> EXPIRED, живые PENDING -> REVOKED.
        await tx.workspaceInvitation.updateMany({
          where: {
            workspaceId,
            email: normalizedEmail,
            status: InvitationStatus.PENDING,
            expiresAt: { lte: now },
          },
          data: { status: InvitationStatus.EXPIRED },
        });
        await tx.workspaceInvitation.updateMany({
          where: {
            workspaceId,
            email: normalizedEmail,
            status: InvitationStatus.PENDING,
          },
          data: { status: InvitationStatus.REVOKED },
        });
        return tx.workspaceInvitation.create({
          data: {
            workspaceId,
            email: normalizedEmail,
            tokenHash: hashInvitationToken(token),
            invitedById: inviterId,
            expiresAt: new Date(
              now.getTime() + this.cfg.invitations.ttlSec * 1000,
            ),
          },
        });
      });
      return {
        id: invitation.id,
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        token,
      };
    } catch (err) {
      // Гонка параллельных invite: partial unique index пропустил одного.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('invitation race, retry');
      }
      throw err;
    }
  }

  async accept(
    userId: string,
    workspaceId: string,
    token: string,
  ): Promise<MembershipResponse> {
    const now = new Date();
    const tokenHash = hashInvitationToken(token);

    // Проверки ДО consuming claim: email mismatch не должен сжигать токен.
    // Строка инвайта иммутабельна (меняется только status), поэтому
    // последующий atomic claim перепроверяет всё мутабельное сам.
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
    });
    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException();
    }
    if (
      invitation.status !== InvitationStatus.PENDING ||
      invitation.expiresAt <= now
    ) {
      if (invitation.status === InvitationStatus.PENDING) {
        await this.prisma.workspaceInvitation
          .update({
            where: { tokenHash },
            data: { status: InvitationStatus.EXPIRED },
          })
          .catch(() => undefined);
      }
      throw new NotFoundException();
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.email.trim().toLowerCase() !== invitation.email) {
      throw new ForbiddenException();
    }
    const alreadyMember = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (alreadyMember) throw new ConflictException('already a member');

    try {
      const membership = await this.prisma.$transaction(async (tx) => {
        // Atomic claim: выигрывает ровно один concurrent accept.
        const claimed = await tx.workspaceInvitation.updateMany({
          where: {
            tokenHash,
            workspaceId,
            status: InvitationStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          data: { status: InvitationStatus.ACCEPTED },
        });
        if (claimed.count !== 1) throw new NotFoundException();
        return tx.workspaceMember.create({
          data: { workspaceId, userId, role: WorkspaceRole.MEMBER },
        });
      });
      return {
        id: membership.id,
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        role: membership.role,
        joinedAt: membership.joinedAt,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      // Единственный реалистичный конфликт здесь — дубль membership.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('already a member');
      }
      throw err;
    }
  }
}
