import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { UsersService } from '../users/users.service';
import {
  SessionsService,
  SessionInvalidError,
} from '../sessions/sessions.service';
import { JwtTokenService, hashToken } from './jwt-token.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { AuthLoginDto } from './dto/auth-login.dto';
import type { JwtUserPayload } from '../../common/types/user-payload.type';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private sessionsService: SessionsService,
    private jwtTokens: JwtTokenService,
    @Inject(AUTH_CONFIG) private config: AuthConfig,
  ) {}

  async login(authLoginDto: AuthLoginDto): Promise<TokenPair> {
    const user = await this.validateUser(authLoginDto);

    const familyId = uuidv7();
    const accessJti = uuidv7();
    const refreshJti = uuidv7();

    const accessToken = this.jwtTokens.signAccess({
      userId: user.id,
      username: user.username,
      email: user.email,
      familyId,
      jti: accessJti,
    });
    const refreshToken = this.jwtTokens.signRefresh({
      userId: user.id,
      familyId,
      jti: refreshJti,
    });

    // Сессия создаётся до возврата пары: при недоступности БД клиент не получит
    // токены, которые сервер не сможет потом проверить/отозвать.
    await this.sessionsService.create({
      jti: refreshJti,
      familyId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTtlSec * 1000),
    });

    return { accessToken, refreshToken };
  }

  /**
   * Ротация: R1 -> (A2, R2). Старый R1 после успеха мёртв; повторное
   * предъявление R1 отзывает всё семейство.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    if (!refreshToken) throw new UnauthorizedException('missing refresh token');
    const claims = this.jwtTokens.verifyRefresh(refreshToken);
    const user = await this.usersService.findById(claims.sub);

    // Новую пару подписываем до транзакции: если ротация в БД не удастся,
    // токены просто не будут возвращены и останутся неизвестны серверу.
    const newRefreshJti = uuidv7();
    const newRefreshToken = this.jwtTokens.signRefresh({
      userId: user.id,
      familyId: claims.sid,
      jti: newRefreshJti,
    });
    const accessToken = this.jwtTokens.signAccess({
      userId: user.id,
      username: user.username,
      email: user.email,
      familyId: claims.sid,
      jti: uuidv7(),
    });

    try {
      await this.sessionsService.rotate({
        presentedJti: claims.jti,
        presentedTokenHash: hashToken(refreshToken),
        jti: newRefreshJti,
        familyId: claims.sid,
        userId: claims.sub,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: new Date(Date.now() + this.config.refreshTtlSec * 1000),
      });
    } catch (err) {
      if (err instanceof SessionInvalidError) {
        throw new UnauthorizedException('invalid refresh token');
      }
      throw err;
    }

    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Logout: отзыв всего семейства (цепочки ротаций текущей сессии). */
  async logout(user: JwtUserPayload): Promise<void> {
    await this.sessionsService.revokeFamily(user.sid);
  }

  private async validateUser(authLoginDto: AuthLoginDto) {
    const { email, password } = authLoginDto;
    let user;
    try {
      user = await this.usersService.findByEmail(email);
    } catch {
      // Не раскрываем, существует ли email: та же 401, что и при неверном пароле.
      throw new UnauthorizedException();
    }

    if (!(await this.usersService.validateHash(password, user.password)))
      throw new UnauthorizedException();

    return user;
  }
}
