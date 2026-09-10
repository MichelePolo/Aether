import { createHash } from 'node:crypto';
import type { ProviderRequest, ProviderToolRound } from './provider.types';

/** Stable, bounded names avoid collisions between punctuation-normalized names. */
export function toolWireName(name: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name) ? name : `aether_${createHash('sha256').update(name).digest('hex').slice(0,48)}`;
}

export function qualifiedToolName(wireName: string, req: ProviderRequest): string {
  return req.mcpTools?.find(t => toolWireName(t.qualifiedName) === wireName)?.qualifiedName ?? wireName;
}

export function toolRounds(req: ProviderRequest): ProviderToolRound[] {
  if (req.toolRounds) return req.toolRounds;
  return (req.toolResults ?? []).map(result => ({
    text: '',
    calls: [{ callId: result.callId, qualifiedName: result.qualifiedName, args: result.args ?? {} }],
    results: [result],
  }));
}
