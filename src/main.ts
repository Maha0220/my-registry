import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(
    '/v2/:name/blobs/uploads',
    bodyParser.raw({ type: 'application/octet-stream', limit: '500mb' }),
  );
  await app.listen(process.env.PORT ?? 5000);
}
bootstrap();
