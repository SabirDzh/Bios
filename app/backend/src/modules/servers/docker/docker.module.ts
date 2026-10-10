import { Module } from '@nestjs/common';
import { ServersModule } from '../servers.module';
import { DockerController } from './docker.controller';
import { DockerService } from './docker.service';

@Module({
  imports: [ServersModule],
  controllers: [DockerController],
  providers: [DockerService],
})
export class DockerModule {}
