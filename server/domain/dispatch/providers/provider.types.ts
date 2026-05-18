export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'done' };

export interface AIProvider {
  readonly model: string;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
