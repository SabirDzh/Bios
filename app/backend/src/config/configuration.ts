export interface AppConfig {
  port: number;
  databaseUrl?: string;
  jwtSecret?: string;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
  };
}
