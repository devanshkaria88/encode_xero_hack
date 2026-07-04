import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger';
import { loadConfig } from './config/env';

async function bootstrap() {
  process.env.ROBYN_SERVE = '1'; // enable side-effectful lifecycle hooks
  const config = loadConfig(); // asserts required secrets at boot
  const app = await NestFactory.create(AppModule, { cors: true });

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`Robyn API on http://localhost:${config.port}  (docs: /api/docs)`);
}

bootstrap();
