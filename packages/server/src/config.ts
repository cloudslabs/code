import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATA_DIR: z.string().default('.cloudscode-data'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  MAX_BUDGET_USD: z.coerce.number().optional(),
  PROJECT_ROOT: z.string().default(process.cwd()),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config;

export function loadConfig(): Config {
  _config = configSchema.parse(process.env);
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return _config;
}
