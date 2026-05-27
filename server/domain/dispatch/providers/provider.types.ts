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

/** Outcome of executing one tool call. Mirrors McpToolResult without coupling
 *  provider.types to the mcp domain. */
export interface ProviderToolCallOutcome {
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
  attachments?: ProviderAttachment[];
  /** Provided by the dispatch layer for providers that run the agentic tool
   *  loop INTERNALLY (Anthropic via the Claude Agent SDK). The provider calls
   *  this once per tool the model invokes; the dispatch layer performs approval
   *  gating, execution, SSE events and tracing, then returns the outcome.
   *  Stateless REST providers (gemini/openai/ollama/fake) ignore it and instead
   *  yield `function_call` chunks for runDispatchLoop to handle. */
  runToolCall?: (call: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }) => Promise<ProviderToolCallOutcome>;
}

export interface ProviderUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
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
  vision: boolean;
}

export interface ProviderAttachment {
  name: string;
  mime: string;
  bytes: Buffer;
}

export interface AIProvider {
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
