import type {
  BreakpointPolicy, CategoryMode, ToolCategory, PreviewResult, ClassifiedTool,
} from '@/src/types/breakpoints.types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const breakpointsApi = {
  getPolicy: (): Promise<BreakpointPolicy> =>
    fetch('/api/breakpoints/policy').then(jsonOrThrow),

  setCategoryMode: (category: ToolCategory, mode: CategoryMode): Promise<BreakpointPolicy> =>
    fetch(`/api/breakpoints/policy/${category}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).then(jsonOrThrow),

  preview: (input: { qualifiedName: string; args: Record<string, unknown> }): Promise<PreviewResult> =>
    fetch('/api/breakpoints/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(jsonOrThrow),

  classify: (input: { qualifiedName: string; args: Record<string, unknown> }): Promise<ClassifiedTool> => {
    const params = new URLSearchParams({
      qualifiedName: input.qualifiedName,
      argsJson: JSON.stringify(input.args ?? {}),
    });
    return fetch(`/api/breakpoints/classify?${params.toString()}`).then(jsonOrThrow);
  },
};
