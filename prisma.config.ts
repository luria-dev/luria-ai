import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

const explicitFile = process.env.LURIA_ENV_FILE?.trim();
const envName = normalizeEnvName(
  process.env.LURIA_ENV?.trim() ||
    process.env.APP_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    'dev',
);

const candidates = explicitFile
  ? [explicitFile, `.env.${envName}`, '.env']
  : [`.env.${envName}`, '.env'];

for (const candidate of candidates) {
  const fullPath = resolve(process.cwd(), candidate);
  if (!existsSync(fullPath)) {
    continue;
  }
  loadDotenv({ path: fullPath, override: false });
  break;
}

function normalizeEnvName(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === 'development') {
    return 'dev';
  }
  if (value === 'production') {
    return 'prod';
  }
  return value;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
