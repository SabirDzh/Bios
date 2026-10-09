import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TokensModule } from './modules/tokens/tokens.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ServersModule } from './modules/servers/servers.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';

@Module({
  imports: [
    // Глобальный лимит 120 req/min (in-memory; для нескольких инстансов нужен Redis).
    // Строгие лимиты на auth-роутах задаются декоратором @Throttle точечно.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 120 }] }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    TokensModule,
    MaintenanceModule,
    WorkspacesModule,
    ProjectsModule,
    ServersModule,
    DeploymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
