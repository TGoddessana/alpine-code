import type { MemoryInfo } from '@alpine/protocol';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const KINDS = ['rule', 'fact', 'lesson', 'user'] as const;

/** A memory's kind and scope in words. A kind the app does not know (the kinds can be replaced) shows as it is. */
export function useMemoryWords() {
  const t = useMessages(messages);
  return {
    kind: (kind: string) =>
      (KINDS as readonly string[]).includes(kind) ? t[`kind_${kind as (typeof KINDS)[number]}`] : kind,
    scope: (scope: MemoryInfo['scope']) => t[`scope_${scope}`],
  };
}
