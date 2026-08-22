import { Module } from '@nestjs/common';
import { ComposeController } from './compose.controller';
import { ComposeService } from './compose.service';

@Module({
  controllers: [ComposeController],
  providers: [ComposeService],
})
export class ComposeModule {}
