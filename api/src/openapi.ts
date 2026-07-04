// Export the OpenAPI spec to api/openapi.json WITHOUT starting the HTTP server.
// Run: pnpm --filter robyn-api openapi  (then web regenerates its types).
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger';

async function main() {
  // Build the app context without a DB connection where possible; we still need
  // the module graph, so create the full app but never listen.
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  const out = join(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`openapi.json written to ${out}`);
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('openapi export failed:', e);
  process.exit(1);
});
