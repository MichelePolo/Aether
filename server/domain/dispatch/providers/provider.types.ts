export interface ProviderToolDecl {
  qualifiedName: string;
  description?: string;
  schema: {
    type?: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ProviderToolResultMessage {
  callId: string;
  qualifiedName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
  thinking?: boolean;
  mcpTools?: ProviderToolDecl[];
  /** When the dispatch loop continues after a tool call, providers receive
   *  the previously executed tool results to feed back to the model. */
  toolResults?: ProviderToolResultMessage[];
  /** Assistant-side text accumulated before the function_call, if any.
   *  Used by providers (e.g. Gemini) that need to replay the partial turn. */
  pendingAssistantText?: string;
}

export interface ProviderUsage {
  totalTokens?: number;
}

export interface ProviderFunctionCall {
  callId: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'function_call'; call: ProviderFunctionCall }
  | { type: 'done'; usage?: ProviderUsage };

export interface ProviderCapabilities {
  thinking: boolean;
  toolCalling: boolean;
}

export interface AIProvider {
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
