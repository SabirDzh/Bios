import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
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
import { AppConfigModule } from './config/app-config.module';
import { APP_CONFIG, type AppConfig } from './config/app.config';
import { buildThrottlerOptions } from './common/throttle/throttle-options.factory';

@Module({
  imports: [
    AppConfigModule,
    // In-memory хранилище (для нескольких инстансов нужен Redis).
    // Профили лимитов — из AppConfig; strict-профили действуют только
    // на роутах с @ThrottleProfile, global — везде (effective = min).
    ThrottlerModule.forRootAsync({
      useFactory: (cfg: AppConfig, reflector: Reflector) =>
        buildThrottlerOptions(cfg, reflector),
      inject: [APP_CONFIG, Reflector],
    }),
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
