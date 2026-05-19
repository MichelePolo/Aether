import type { AetherContext } from '@/server/domain/context/context.types';

export interface ProfileRecord {
  name: string;
  createdAt: number;
  updatedAt: number;
  context: AetherContext;
  thinkingEnabled: boolean;
}

export interface ProfileMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type ProfilesFile = Record<string, ProfileRecord>;
