export type {
  ProviderTransport,
  ProviderDescriptor,
  RegistryIssue,
} from '@/server/domain/providers/registry';

export type { ProviderCapabilities } from '@/server/domain/dispatch/providers/provider.types';

import type { ProviderDescriptor, RegistryIssue } from '@/server/domain/providers/registry';

export interface ProvidersResponse {
  providers: ProviderDescriptor[];
  issues: RegistryIssue[];
}
