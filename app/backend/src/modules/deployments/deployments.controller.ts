import { Controller } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';

@Controller()
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}
}
