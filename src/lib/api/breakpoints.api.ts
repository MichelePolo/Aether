import type {
  BreakpointPolicy, CategoryMode, ToolCategory, PreviewResult, ClassifiedTool,
} from '@/src/types/breakpoints.types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const breakpointsApi = {
  getPolicy: async (): Promise<BreakpointPolicy> =>
    jsonOrThrow<BreakpointPolicy>(await fetch('/api/breakpoints/policy')),

  setCategoryMode: async (category: ToolCategory, mode: CategoryMode): Promise<BreakpointPolicy> =>
    jsonOrThrow<BreakpointPolicy>(
      await fetch(`/api/breakpoints/policy/${category}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }),
    ),

  preview: async (input: { qualifiedName: string; args: Record<string, unknown> }): Promise<PreviewResult> =>
    jsonOrThrow<PreviewResult>(
      await fetch('/api/breakpoints/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),

  classify: async (input: { qualifiedName: string; args: Record<string, unknown> }): Promise<ClassifiedTool> => {
    const params = new URLSearchParams({
      qualifiedName: input.qualifiedName,
      argsJson: JSON.stringify(input.args ?? {}),
    });
    return jsonOrThrow<ClassifiedTool>(await fetch(`/api/breakpoints/classify?${params.toString()}`));
  },
};
