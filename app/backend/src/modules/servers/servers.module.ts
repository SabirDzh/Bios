import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ComposeModule } from './compose/compose.module';
import { GitModule } from './git/git.module';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { AgentService } from './agent.service';
import { CredentialCryptoService } from './credentials/credential-crypto.service';
import { NodeSshRunner } from './ssh/node-ssh.runner';
import { SSH_RUNNER } from './ssh/ssh-runner';

@Module({
  imports: [PrismaModule, WorkspacesModule, ComposeModule, GitModule],
  controllers: [ServersController],
  providers: [
    ServersService,
    AgentService,
    CredentialCryptoService,
    { provide: SSH_RUNNER, useClass: NodeSshRunner },
  ],
  // DockerService обязан проходить тот же guard/политику/пин, что test и install:
  // ему нужны именно эти два провайдера, а не весь модуль.
  exports: [ServersService, SSH_RUNNER],
})
export class ServersModule {}
