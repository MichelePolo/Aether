import type { Message as StoredMessage } from '@/server/domain/history/history.types';
export interface Message extends StoredMessage { persisted?: boolean }
