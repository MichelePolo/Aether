import path from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  fakeProvider: boolean;
  geminiApiKey: string;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    dataDir: process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
    fakeProvider: process.env.AETHER_FAKE_PROVIDER === '1',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  };
}
