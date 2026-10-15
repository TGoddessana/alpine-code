import { useMemo } from 'react';

import { useSession } from '@/shared/server';

import { workResult, type WorkResult } from './results';

/**
 * What the session's work changed and ran, or null when no session is connected (or it was deleted, or it belongs to
 * another project than `cwd`).
 */
export function useWorkResult(sessionId: string | null, cwd?: string): WorkResult | null {
  const session = useSession(sessionId);
  const data = session.data;
  const items = data && !data.deleted && (cwd === undefined || data.info.cwd === cwd) ? data.items : undefined;
  return useMemo(() => (items ? workResult(items) : null), [items]);
}
