import { Module } from '@nestjs/common';
import { RegistryController } from './registry.controller';

@Module({
  imports: [],
  controllers: [RegistryController],
  providers: [],
})
export class RegistryModule {}
