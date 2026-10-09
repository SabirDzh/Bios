import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TokensModule } from './modules/tokens/tokens.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ServersModule } from './modules/servers/servers.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    TokensModule,
    WorkspacesModule,
    ProjectsModule,
    ServersModule,
    DeploymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
