export type SseEvent = { event: string; data: unknown };

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseEventBlock(rawEvent);
        if (parsed) yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event: 'parse_error', data: { raw: rawData } };
  }
}
