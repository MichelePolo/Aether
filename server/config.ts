import path from 'node:path';
import { DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH } from './domain/dispatch/dispatch.service';
import { defaultLibraryDir } from './lib/library-dir';

export interface AppConfig {
  port: number;
  dataDir: string;
  libraryDir: string;
  fakeProvider: boolean;
  geminiApiKey: string;
  openAIApiKey: string;
  maxToolCallsPerDispatch: number;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 3000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

/** Parse a positive-integer env var, falling back to `fallback` for unset,
 *  non-numeric, or non-positive values. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: parsePort(process.env.PORT),
    dataDir: process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
    libraryDir: process.env.AETHER_LIBRARY_DIR ?? defaultLibraryDir(),
    fakeProvider: process.env.AETHER_FAKE_PROVIDER === '1',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    openAIApiKey: process.env.OPENAI_API_KEY ?? '',
    maxToolCallsPerDispatch: parsePositiveInt(
      process.env.AETHER_MAX_TOOL_CALLS,
      DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH,
    ),
  };
}
