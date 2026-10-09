import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig, type AppConfig } from './app.config';

// Единственная загрузка на процесс: и DI, и main.ts используют этот объект.
const appConfig: AppConfig = loadAppConfig();
export { appConfig };

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: appConfig }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
