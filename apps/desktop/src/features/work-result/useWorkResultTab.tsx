import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { useWorkResult } from './useWorkResult';
import { SessionChanges } from './SessionChanges';

/** The dock's work result tab for a session (or none yet): one entry for the dock's tab list. */
export function useWorkResultTab(sessionId: string | null, cwd?: string) {
  const t = useMessages(messages);
  const result = useWorkResult(sessionId, cwd);
  return {
    id: 'work-result',
    keepMounted: true,
    label: t.title,
    content: <SessionChanges key={sessionId} sessionId={sessionId} result={result} />,
  };
}
