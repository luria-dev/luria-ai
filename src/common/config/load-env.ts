import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const explicitFile = process.env.LURIA_ENV_FILE?.trim();
const envName =
  process.env.LURIA_ENV?.trim() ||
  process.env.APP_ENV?.trim() ||
  process.env.NODE_ENV?.trim() ||
  'dev';

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
