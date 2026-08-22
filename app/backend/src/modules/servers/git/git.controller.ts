import { Controller } from '@nestjs/common';
import { GitService } from './git.service';

@Controller('workspaces/:workspaceId/git')
export class GitController {
  constructor(private readonly gitService: GitService) {}
}
