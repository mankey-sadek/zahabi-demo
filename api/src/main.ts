import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Databases } from './db/databases';
import { PluginRuntime } from './plugins/runtime';
import { OutboxWorker } from './plugins/outbox-worker';
import { AdminController, AuthController, PluginsController, ShopController } from './controllers';
import { TenantGuard } from './auth/auth';

const webDist = process.env.WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: existsSync(webDist) ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })] : [],
  controllers: [AuthController, ShopController, PluginsController, AdminController],
  providers: [Databases, PluginRuntime, OutboxWorker, TenantGuard],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors();
  app.enableShutdownHooks();
  await app.get(Databases).init();
  app.get(OutboxWorker).start();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Zahabi demo on http://localhost:${port}`);
}
bootstrap();
