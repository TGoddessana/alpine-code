import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { useWorkResult } from './useWorkResult';
import { WorkResult } from './WorkResult';

/** The dock's work result tab for a session (or none yet): one entry for the dock's tab list. */
export function useWorkResultTab(sessionId: string | null, cwd?: string) {
  const t = useMessages(messages);
  const result = useWorkResult(sessionId, cwd);
  return { id: 'work-result', label: t.title, content: <WorkResult result={result} /> };
}
