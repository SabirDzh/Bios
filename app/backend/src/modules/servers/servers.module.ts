import { Module } from '@nestjs/common';
import { DockerModule } from './docker/docker.module';
import { ComposeModule } from './compose/compose.module';
import { GitModule } from './git/git.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  imports: [DockerModule, ComposeModule, GitModule],
  controllers: [ServersController],
  providers: [ServersService],
})
export class ServersModule {}
