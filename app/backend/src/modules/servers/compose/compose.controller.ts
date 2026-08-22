import { Controller } from '@nestjs/common';
import { ComposeService } from './compose.service';

@Controller('workspaces/:workspaceId/servers/:serverId/compose')
export class ComposeController {
  constructor(private readonly composeService: ComposeService) {}
}
