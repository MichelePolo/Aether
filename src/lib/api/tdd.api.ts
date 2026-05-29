export interface TddRunRequest {
  command: string;
  subAgentName: string;
  maxRetries?: number;
}

export const tddApi = {
  run: (req: TddRunRequest, signal: AbortSignal): Promise<Response> =>
    fetch('/api/tdd/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    }),
};
