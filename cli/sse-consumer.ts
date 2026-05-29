export interface SseEvent {
  event: string;
  data: unknown;
}

/** Returns a `feed(chunk)` function that buffers partial SSE text and invokes
 *  `onEvent` for each complete `event:`/`data:` block (separated by a blank line). */
export function createSseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buffer = '';

  return (chunk: string) => {
    buffer += chunk;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let name = 'message';
      let dataLine: string | null = null;
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice('event:'.length).trim();
        else if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
      }
      if (dataLine === null) continue;

      let data: unknown = dataLine;
      try {
        data = JSON.parse(dataLine);
      } catch {
        // leave as raw string
      }
      onEvent({ event: name, data });
    }
  };
}
