import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig, type AppConfig } from './app.config';

// Ленивый синглтон: и DI, и main.ts, и валидаторы без DI используют один объект.
// Перезагрузка — только для тестов (прод код её не вызывает).
let cached: AppConfig | undefined;
export function getAppConfig(): AppConfig {
  if (!cached) cached = loadAppConfig();
  return cached;
}
export function reloadAppConfigForTests(): AppConfig {
  cached = loadAppConfig();
  return cached;
}
export const appConfig: AppConfig = getAppConfig();

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: getAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
