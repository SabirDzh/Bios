import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DockerModule } from './docker/docker.module';
import { ComposeModule } from './compose/compose.module';
import { GitModule } from './git/git.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { AgentService } from './agent.service';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { NodeSshRunner } from './ssh/node-ssh.runner';
import { SSH_RUNNER } from './ssh/ssh-runner';

@Module({
  imports: [
    PrismaModule,
    WorkspacesModule,
    DockerModule,
    ComposeModule,
    GitModule,
  ],
  controllers: [ServersController],
  providers: [
    ServersService,
    AgentService,
    CredentialCryptoService,
    { provide: SSH_RUNNER, useClass: NodeSshRunner },
  ],
})
export class ServersModule {}
