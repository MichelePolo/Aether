import path from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  fakeProvider: boolean;
  geminiApiKey: string;
  openAIApiKey: string;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 3000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export function loadConfig(): AppConfig {
  return {
    port: parsePort(process.env.PORT),
    dataDir: process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
    fakeProvider: process.env.AETHER_FAKE_PROVIDER === '1',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    openAIApiKey: process.env.OPENAI_API_KEY ?? '',
  };
}
