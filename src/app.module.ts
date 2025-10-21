import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RegistryModule } from './registry/registry.modure';

@Module({
  imports: [RegistryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
