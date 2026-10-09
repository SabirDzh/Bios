import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { TokensModule } from '../tokens/tokens.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [PrismaModule, TokensModule, SessionsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
