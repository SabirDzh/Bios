import { Controller } from '@nestjs/common';
import { ServersService } from './servers.service';

@Controller('workspaces/:workspaceId/servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}
}
