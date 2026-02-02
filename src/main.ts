import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 5000);

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('Docker Registry API')
    .setDescription('Docker Registry HTTP API V2 호환 이미지 저장소')
    .setVersion('1.0')
    .addTag('registry', 'Docker Registry API')
    .addTag('catalog', 'Repository/Tag 목록')
    .addTag('blob', 'Blob(레이어) 관리')
    .addTag('manifest', 'Manifest 관리')
    .addTag('gc', 'Garbage Collection')
    .addTag('health', 'Health Check')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Global Exception Filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Registry server running on port ${port}`);
  logger.log(`Swagger docs available at http://localhost:${port}/api`);
}
void bootstrap();
