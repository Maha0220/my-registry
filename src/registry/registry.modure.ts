import { Module } from '@nestjs/common';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';
import { UploadsStore } from './uploads.store';

@Module({
  imports: [],
  controllers: [RegistryController],
  providers: [RegistryService, UploadsStore],
})
export class RegistryModule {}
